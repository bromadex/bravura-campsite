import { useState, useCallback, useMemo, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'

const COLOR = MODULE_COLORS.fuel

const Icon = ({ name, size = 18, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', color: 'inherit', ...style }}>{name}</span>
)

const btn = (extra = {}) => ({
  border: 'none', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 600, fontSize: '13px', padding: '8px 16px',
  display: 'inline-flex', alignItems: 'center', gap: '6px', ...extra,
})

const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'

function exportCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function KpiTile({ icon, label, value, sub, color }) {
  return (
    <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '16px 20px', boxShadow: THEME.shadow1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <Icon name={icon} size={16} style={{ color: color || THEME.textMed }} />
        <span style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</span>
      </div>
      <div style={{ fontSize: '26px', fontWeight: 700, color: color || THEME.text, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '3px' }}>{sub}</div>}
    </div>
  )
}

export default function VehicleConsumption() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const today = new Date().toISOString().slice(0, 10)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(ninetyDaysAgo)
  const [to, setTo]     = useState(today)
  const [filter, setFilter] = useState('')
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('totalLitres')
  const [sortDir, setSortDir] = useState(-1)

  const run = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    setExpanded(null)
    const { data: txns, error } = await supabase
      .from('fuel_transactions')
      .select('vehicle_id, equipment_id, litres, meter_start, meter_end, transaction_date, docket_number, notes, tank:fuel_tanks(name), vehicle:fuel_vehicles(fleet_number, registration, expected_consumption_lpkm, fuel_types(name)), equipment:fuel_equipment(name, equipment_number, fuel_types(name))')
      .eq('site_id', currentSiteId)
      .eq('transaction_type', 'issuance')
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .order('transaction_date', { ascending: false })
    if (error) console.error('VehicleConsumption query failed:', error)

    const map = {}
    for (const t of (txns || [])) {
      const key = t.vehicle_id || t.equipment_id
      if (!key) continue
      if (!map[key]) {
        const v = t.vehicle, e = t.equipment
        map[key] = {
          assetId: key,
          label: v ? (v.registration || v.fleet_number || key) : (e?.name || key),
          subLabel: v ? v.fleet_number : e?.equipment_number,
          fuelType: v?.fuel_types?.name || e?.fuel_types?.name || 'Diesel',
          expectedLpkm: v?.expected_consumption_lpkm ? Number(v.expected_consumption_lpkm) : null,
          totalLitres: 0, fills: 0, totalKm: 0,
          minFill: null, maxFill: null, lastOdometer: null,
          txns: [],
        }
      }
      const row = map[key]
      const litres = Number(t.litres)
      row.totalLitres += litres
      row.fills += 1
      row.minFill = row.minFill == null ? litres : Math.min(row.minFill, litres)
      row.maxFill = row.maxFill == null ? litres : Math.max(row.maxFill, litres)
      if (t.meter_start != null && t.meter_end != null) {
        const km = Number(t.meter_end) - Number(t.meter_start)
        if (km > 0) row.totalKm += km
      }
      if (t.meter_end != null) {
        row.lastOdometer = row.lastOdometer == null ? Number(t.meter_end) : Math.max(row.lastOdometer, Number(t.meter_end))
      }
      row.txns.push(t)
    }

    for (const row of Object.values(map)) {
      row.avgFill = row.fills > 0 ? row.totalLitres / row.fills : null
      row.lp100km = row.totalKm > 0 ? (row.totalLitres / row.totalKm) * 100 : null
      // abnormal fills: single draws ≥ 2.5× this asset's average
      row.abnormal = row.fills >= 3 ? row.txns.filter(t => Number(t.litres) >= 2.5 * row.avgFill).length : 0
    }

    setRows(Object.values(map))
    setLoading(false)
  }, [currentSiteId, from, to])

  useEffect(() => { run() }, [run])

  const visible = useMemo(() => {
    if (!rows) return []
    const q = filter.toLowerCase().trim()
    const list = q
      ? rows.filter(r => `${r.label} ${r.subLabel || ''}`.toLowerCase().includes(q))
      : rows
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir * (av < bv ? -1 : av > bv ? 1 : 0)
    })
  }, [rows, filter, sortKey, sortDir])

  const kpis = useMemo(() => {
    if (!rows) return null
    const totalLitres = rows.reduce((s, r) => s + r.totalLitres, 0)
    const totalKm     = rows.reduce((s, r) => s + r.totalKm, 0)
    const abnormal    = rows.reduce((s, r) => s + r.abnormal, 0)
    return {
      vehicles: rows.length,
      totalLitres,
      fleetLp100: totalKm > 0 ? (totalLitres / totalKm) * 100 : null,
      abnormal,
    }
  }, [rows])

  if (!can('fuel.view')) return (
    <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>
      <Icon name="lock" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      Access denied
    </div>
  )

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d)
    else { setSortKey(key); setSortDir(-1) }
  }

  const doExport = () => {
    if (!rows) return
    exportCsv(`vehicle-consumption-${from}-to-${to}.csv`,
      ['Vehicle', 'Fleet/Equip #', 'Fuel Type', 'Fills', 'Total Litres', 'Avg Fill (L)', 'Min (L)', 'Max (L)', 'Last Odometer', 'Avg L/100km', 'Abnormal Fills'],
      visible.map(r => [
        r.label, r.subLabel || '', r.fuelType, r.fills,
        r.totalLitres.toFixed(1), r.avgFill?.toFixed(1) ?? '',
        r.minFill?.toFixed(1) ?? '', r.maxFill?.toFixed(1) ?? '',
        r.lastOdometer ?? '', r.lp100km?.toFixed(1) ?? '', r.abnormal,
      ])
    )
  }

  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  const ThSort = ({ label, k, align = 'right' }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{ padding: '10px 14px', textAlign: align, fontSize: '11px', fontWeight: 600, color: sortKey === k ? COLOR : THEME.textMed, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label} {sortKey === k ? (sortDir < 0 ? '↓' : '↑') : ''}
    </th>
  )

  return (
    <div style={{ maxWidth: '1150px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Vehicle Consumption Analytics</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>
            Per-vehicle fuel efficiency, benchmarking and abnormal usage detection
          </p>
        </div>
        {rows && (
          <button onClick={doExport} style={{ ...btn({ background: THEME.surfaceVar, color: COLOR }) }}>
            <Icon name="download" size={15} /> CSV
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '20px', padding: '14px 16px', background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 200px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Vehicle</label>
          <input
            type="text" value={filter} onChange={e => setFilter(e.target.value)}
            placeholder="Filter by vehicle…"
            style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        {loading && <span style={{ fontSize: '12px', color: THEME.textLow, paddingBottom: '9px' }}>Loading…</span>}
      </div>

      {/* KPI tiles */}
      {kpis && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px', marginBottom: '20px' }}>
          <KpiTile icon="directions_car" label="Total Vehicles" value={kpis.vehicles} />
          <KpiTile icon="local_gas_station" label="Total Litres" value={`${kpis.totalLitres.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} color={COLOR} />
          <KpiTile icon="speed" label="Avg L/100km" value={kpis.fleetLp100 != null ? kpis.fleetLp100.toFixed(1) : '—'} sub="fleet average" />
          <KpiTile icon="warning" label="Abnormal Fills" value={kpis.abnormal} color={kpis.abnormal > 0 ? THEME.error : THEME.text} sub={kpis.abnormal > 0 ? '≥ 2.5× vehicle average' : null} />
        </div>
      )}

      {/* Table */}
      <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: THEME.surfaceVar }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Vehicle</th>
                <ThSort label="Fills" k="fills" />
                <ThSort label="Total Litres" k="totalLitres" />
                <ThSort label="Last Odometer" k="lastOdometer" />
                <ThSort label="Avg L/100km" k="lp100km" />
                <ThSort label="Min" k="minFill" />
                <ThSort label="Max" k="maxFill" />
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>
                  {loading ? 'Loading…' : 'No issuances in this period.'}
                </td></tr>
              ) : visible.map(row => {
                const isExpanded = expanded === row.assetId
                const status = row.abnormal > 0
                  ? { label: `${row.abnormal} abnormal`, bg: THEME.statusErrorBg, color: THEME.statusErrorText }
                  : row.lp100km == null
                  ? { label: 'No km data', bg: THEME.surfaceVar, color: THEME.textLow }
                  : { label: 'Normal', bg: THEME.statusSuccessBg, color: THEME.statusSuccessText }
                return (
                  <>
                    <tr
                      key={row.assetId}
                      onClick={() => setExpanded(isExpanded ? null : row.assetId)}
                      style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', background: isExpanded ? COLOR + '08' : 'transparent' }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = THEME.surfaceVar }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '11px 14px', color: THEME.text, fontWeight: 600 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Icon name={isExpanded ? 'expand_more' : 'chevron_right'} size={15} style={{ color: THEME.textLow }} />
                          <div>
                            {row.label}
                            {row.subLabel && row.subLabel !== row.label && (
                              <div style={{ fontSize: '10px', fontWeight: 400, color: THEME.textLow, fontFamily: 'monospace' }}>{row.subLabel}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', color: THEME.text }}>{row.fills}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: COLOR }}>{fmt(row.totalLitres, 2)} L</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', color: row.lastOdometer != null ? THEME.text : THEME.textLow }}>
                        {row.lastOdometer != null ? row.lastOdometer.toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', color: row.lp100km != null ? THEME.text : THEME.textLow }}>
                        {row.lp100km != null ? fmt(row.lp100km, 1) : '—'}
                      </td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', color: THEME.textMed }}>{row.minFill != null ? fmt(row.minFill, 0) : '—'}</td>
                      <td style={{ padding: '11px 14px', textAlign: 'right', color: THEME.textMed }}>{row.maxFill != null ? fmt(row.maxFill, 0) : '—'}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: status.bg, color: status.color, whiteSpace: 'nowrap' }}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={row.assetId + '_exp'} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td colSpan={8} style={{ padding: '0 0 0 40px', background: THEME.surfaceVar }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead>
                              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                                {['Date', 'Docket #', 'Tank', 'Litres', 'Meter Start', 'Meter End', 'km'].map(h => (
                                  <th key={h} style={{ padding: '7px 12px', textAlign: ['Litres', 'Meter Start', 'Meter End', 'km'].includes(h) ? 'right' : 'left', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {row.txns.map((t, i) => {
                                const km = t.meter_start != null && t.meter_end != null ? Number(t.meter_end) - Number(t.meter_start) : null
                                const isAbnormal = row.avgFill != null && row.fills >= 3 && Number(t.litres) >= 2.5 * row.avgFill
                                return (
                                  <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: isAbnormal ? THEME.error + '08' : 'transparent' }}>
                                    <td style={{ padding: '7px 12px', color: THEME.textMed }}>{t.transaction_date}</td>
                                    <td style={{ padding: '7px 12px', color: COLOR, fontWeight: 600 }}>{t.docket_number || '—'}</td>
                                    <td style={{ padding: '7px 12px', color: THEME.text }}>{t.tank?.name || '—'}</td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, color: isAbnormal ? THEME.error : THEME.warning }}>
                                      {fmt(t.litres)} L{isAbnormal && ' ⚠'}
                                    </td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', color: THEME.textMed }}>{t.meter_start != null ? Number(t.meter_start).toLocaleString() : '—'}</td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', color: THEME.textMed }}>{t.meter_end != null ? Number(t.meter_end).toLocaleString() : '—'}</td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', color: km != null ? THEME.text : THEME.textLow }}>{km != null ? km.toLocaleString() + ' km' : '—'}</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
