import { useState, useCallback, useMemo, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'

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

// Monthly consumption trend — bins each vehicle's fills into calendar months,
// computes L/100km per month using odometer deltas within that month, and
// draws an inline SVG line chart. A dashed line marks the expected L/100km
// so drift is visible at a glance (rising trend = engine wear or leaks).
function MonthlyTrendChart({ row, expectedL100 }) {
  const monthly = useMemo(() => {
    const buckets = {}
    // Walk chronologically so we can capture odometer delta per fill
    let prevOdo = null
    for (const t of row.txns) {
      const ym = String(t.transaction_date).slice(0, 7)   // 'YYYY-MM'
      if (!buckets[ym]) buckets[ym] = { ym, litres: 0, km: 0 }
      buckets[ym].litres += Number(t.litres)
      const thisOdo = t.odometer_km != null ? Number(t.odometer_km) : null
      if (thisOdo != null && prevOdo != null && thisOdo > prevOdo) {
        buckets[ym].km += thisOdo - prevOdo
      }
      if (thisOdo != null) prevOdo = thisOdo
    }
    return Object.values(buckets)
      .sort((a, b) => a.ym.localeCompare(b.ym))
      .map(b => ({ ...b, lp100: b.km > 0 ? (b.litres / b.km) * 100 : null }))
  }, [row])

  if (monthly.length < 2 || monthly.every(m => m.lp100 == null)) {
    return (
      <div style={{ padding: '10px 0', fontSize: '12px', color: THEME.textLow }}>
        <Icon name="show_chart" size={14} style={{ verticalAlign: 'middle', marginRight: '4px', color: THEME.textLow }} />
        Not enough monthly data yet — need at least 2 months of odometer readings for a trend.
      </div>
    )
  }

  const values = monthly.map(m => m.lp100).filter(v => v != null)
  const maxV = Math.max(...values, expectedL100 || 0) * 1.15
  const minV = 0
  const W = 640, H = 140, pad = { l: 40, r: 12, t: 12, b: 26 }
  const chartW = W - pad.l - pad.r
  const chartH = H - pad.t - pad.b
  const xFor = i => pad.l + (monthly.length === 1 ? chartW / 2 : (i / (monthly.length - 1)) * chartW)
  const yFor = v => pad.t + chartH - ((v - minV) / (maxV - minV)) * chartH

  const points = monthly
    .map((m, i) => m.lp100 != null ? `${xFor(i)},${yFor(m.lp100)}` : null)
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '8px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          Monthly L/100km trend
        </div>
        {expectedL100 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: THEME.textLow }}>
            <span style={{ display: 'inline-block', width: '14px', borderTop: `2px dashed ${THEME.textLow}` }} />
            Expected: {expectedL100.toFixed(1)} L/100km
          </div>
        )}
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: THEME.surface, borderRadius: '8px', border: `1px solid ${THEME.outlineVar}`, maxWidth: '640px' }}>
        {/* Y-axis grid */}
        {[0.25, 0.5, 0.75, 1].map((f, i) => {
          const y = pad.t + chartH * (1 - f)
          const v = minV + (maxV - minV) * f
          return (
            <g key={i}>
              <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke={THEME.outlineVar} strokeWidth="1" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill={THEME.textLow}>{v.toFixed(0)}</text>
            </g>
          )
        })}
        {/* Expected line */}
        {expectedL100 && expectedL100 >= minV && expectedL100 <= maxV && (
          <line
            x1={pad.l} y1={yFor(expectedL100)} x2={W - pad.r} y2={yFor(expectedL100)}
            stroke={THEME.textLow} strokeWidth="1.5" strokeDasharray="4 4"
          />
        )}
        {/* Trend line */}
        <polyline points={points} fill="none" stroke={COLOR} strokeWidth="2" />
        {/* Data points */}
        {monthly.map((m, i) => m.lp100 != null && (
          <g key={m.ym}>
            <circle
              cx={xFor(i)} cy={yFor(m.lp100)} r="4"
              fill={expectedL100 && m.lp100 > expectedL100 * 1.2 ? '#C62828' : COLOR}
            />
            <title>{m.ym}: {m.lp100.toFixed(1)} L/100km ({m.km} km, {m.litres.toFixed(1)} L)</title>
          </g>
        ))}
        {/* X-axis labels */}
        {monthly.map((m, i) => (
          <text
            key={m.ym + '_x'}
            x={xFor(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={THEME.textLow}
          >
            {m.ym.slice(2)}
          </text>
        ))}
      </svg>
    </div>
  )
}

function KpiTile({ icon, label, value, sub, color, onClick, active }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: active ? (color || COLOR) + '10' : THEME.surface,
        borderRadius: '12px',
        border: `1.5px solid ${active ? (color || COLOR) : THEME.outlineVar}`,
        padding: '16px 20px', boxShadow: THEME.shadow1,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color .15s, background .15s',
      }}
      onMouseEnter={e => { if (onClick && !active) e.currentTarget.style.borderColor = (color || COLOR) + '80' }}
      onMouseLeave={e => { if (onClick && !active) e.currentTarget.style.borderColor = THEME.outlineVar }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon name={icon} size={16} style={{ color: color || THEME.textMed }} />
          <span style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.07em' }}>{label}</span>
        </div>
        {onClick && active && <Icon name="filter_alt" size={14} style={{ color: color || COLOR }} />}
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
  const [statusFilter, setStatusFilter] = useState(null) // null | 'abnormal' | 'noKmData' | 'overExpected'
  const [alertPct, setAlertPct] = useState(20)  // alert when actual > expected by this many %

  const run = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    setExpanded(null)
    const { data: txns, error } = await supabase
      .from('fuel_transactions')
      .select('fleet_asset_id, litres, odometer_km, transaction_date, docket_number, notes, tank:fuel_tanks(name), fleet_asset:fleet_assets(fleet_number, registration, asset_number, description, serial_number, expected_consumption_lpkm, fuel_types(name))')
      .eq('site_id', currentSiteId)
      .eq('is_deleted', false)
      .eq('transaction_type', 'issuance')
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .order('transaction_date', { ascending: true })   // ASC so odometer diffs work chronologically

    if (error) console.error('VehicleConsumption query failed:', error)

    const map = {}
    for (const t of (txns || [])) {
      const key = t.fleet_asset_id
      if (!key) continue
      if (!map[key]) {
        const a = t.fleet_asset
        map[key] = {
          assetId: key,
          label: a ? (a.registration || a.fleet_number || a.asset_number || key) : key,
          subLabel: a?.fleet_number || a?.serial_number,
          fuelType: a?.fuel_types?.name || 'Diesel',
          expectedLpkm: a?.expected_consumption_lpkm ? Number(a.expected_consumption_lpkm) : null,
          totalLitres: 0, fills: 0, totalKm: 0,
          minFill: null, maxFill: null, lastOdometer: null, firstOdometer: null,
          txns: [],
        }
      }
      const row = map[key]
      const litres = Number(t.litres)
      row.totalLitres += litres
      row.fills += 1
      row.minFill = row.minFill == null ? litres : Math.min(row.minFill, litres)
      row.maxFill = row.maxFill == null ? litres : Math.max(row.maxFill, litres)
      // Vehicle odometer at this fill — used for distance calc.
      const odo = t.odometer_km != null ? Number(t.odometer_km) : null
      if (odo != null) {
        if (row.firstOdometer == null) row.firstOdometer = odo
        row.lastOdometer = odo
      }
      row.txns.push(t)
    }

    for (const row of Object.values(map)) {
      // Distance travelled in the window = odometer at last fill - odometer at first fill
      if (row.firstOdometer != null && row.lastOdometer != null && row.lastOdometer > row.firstOdometer) {
        row.totalKm = row.lastOdometer - row.firstOdometer
      }
      row.avgFill = row.fills > 0 ? row.totalLitres / row.fills : null
      row.lp100km = row.totalKm > 0 ? (row.totalLitres / row.totalKm) * 100 : null
      // Over-expected alert: needs both an expected value and actual km data
      const expectedL100 = row.expectedLpkm ? row.expectedLpkm * 100 : null
      row.overThreshold = expectedL100 && row.lp100km
        ? row.lp100km > expectedL100 * (1 + alertPct / 100)
        : false
      row.overPct = expectedL100 && row.lp100km
        ? ((row.lp100km - expectedL100) / expectedL100) * 100
        : null
      // abnormal fills: single draws ≥ 2.5× this asset's average
      row.abnormal = row.fills >= 3 ? row.txns.filter(t => Number(t.litres) >= 2.5 * row.avgFill).length : 0
    }

    setRows(Object.values(map))
    setLoading(false)
  }, [currentSiteId, from, to, alertPct])

  useEffect(() => { run() }, [run])

  useEffect(() => {
    if (statusFilter === 'abnormal' && rows) {
      const firstAbnormal = rows.find(r => r.abnormal > 0)
      if (firstAbnormal) setExpanded(firstAbnormal.assetId)
    }
  }, [statusFilter, rows])

  const visible = useMemo(() => {
    if (!rows) return []
    const q = filter.toLowerCase().trim()
    let list = q
      ? rows.filter(r => `${r.label} ${r.subLabel || ''}`.toLowerCase().includes(q))
      : rows
    if (statusFilter === 'abnormal')     list = list.filter(r => r.abnormal > 0)
    if (statusFilter === 'noKmData')     list = list.filter(r => r.lp100km == null)
    if (statusFilter === 'overExpected') list = list.filter(r => r.overThreshold)
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir * (av < bv ? -1 : av > bv ? 1 : 0)
    })
  }, [rows, filter, sortKey, sortDir, statusFilter])

  const kpis = useMemo(() => {
    if (!rows) return null
    const totalLitres = rows.reduce((s, r) => s + r.totalLitres, 0)
    const totalKm     = rows.reduce((s, r) => s + r.totalKm, 0)
    const abnormal    = rows.reduce((s, r) => s + r.abnormal, 0)
    const overCount   = rows.filter(r => r.overThreshold).length
    return {
      vehicles: rows.length,
      totalLitres,
      fleetLp100: totalKm > 0 ? (totalLitres / totalKm) * 100 : null,
      abnormal,
      overCount,
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
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px', marginBottom: statusFilter ? '10px' : '20px' }}>
            <KpiTile
              icon="directions_car" label="Total Vehicles" value={kpis.vehicles}
              active={statusFilter === null} onClick={() => setStatusFilter(null)}
            />
            <KpiTile icon="local_gas_station" label="Total Litres" value={`${kpis.totalLitres.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} color={COLOR} />
            <KpiTile
              icon="speed" label="No Odometer Data" value={rows ? rows.filter(r => r.lp100km == null).length : 0}
              sub="click to filter" color={THEME.textMed}
              active={statusFilter === 'noKmData'} onClick={() => setStatusFilter(statusFilter === 'noKmData' ? null : 'noKmData')}
            />
            <KpiTile
              icon="warning" label="Abnormal Fills" value={kpis.abnormal}
              color={kpis.abnormal > 0 ? THEME.error : THEME.text}
              sub={kpis.abnormal > 0 ? '≥ 2.5× vehicle average — click to view' : null}
              active={statusFilter === 'abnormal'}
              onClick={kpis.abnormal > 0 ? () => setStatusFilter(statusFilter === 'abnormal' ? null : 'abnormal') : undefined}
            />
            <KpiTile
              icon="trending_up" label={`Over Expected (>${alertPct}%)`} value={kpis.overCount}
              color={kpis.overCount > 0 ? '#C62828' : THEME.text}
              sub={kpis.overCount > 0 ? 'consuming above rated — click to view' : 'all vehicles within tolerance'}
              active={statusFilter === 'overExpected'}
              onClick={kpis.overCount > 0 ? () => setStatusFilter(statusFilter === 'overExpected' ? null : 'overExpected') : undefined}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', fontSize: '12px', color: THEME.textMed }}>
            <Icon name="tune" size={14} style={{ color: COLOR }} />
            <span>Alert threshold: vehicles consuming more than <b>{alertPct}%</b> above expected L/100km</span>
            <input
              type="range" min="5" max="100" step="5"
              value={alertPct}
              onChange={e => setAlertPct(Number(e.target.value))}
              style={{ flex: 1, maxWidth: '200px' }}
            />
          </div>
          {statusFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '12px', color: THEME.textMed }}>
              <Icon name="filter_alt" size={14} style={{ color: COLOR }} />
              Filtered: {
                statusFilter === 'abnormal' ? 'vehicles with abnormal fills'
                : statusFilter === 'overExpected' ? `vehicles consuming >${alertPct}% above expected`
                : 'vehicles with no odometer data'
              }
              <button
                onClick={() => setStatusFilter(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLOR, fontWeight: 600, fontSize: '12px', fontFamily: 'inherit', padding: 0 }}
              >
                Clear
              </button>
            </div>
          )}
        </>
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
                  : row.overThreshold
                  ? { label: `+${Math.round(row.overPct)}% over expected`, bg: '#C6282814', color: '#C62828' }
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
                        <td colSpan={8} style={{ padding: '14px 20px 20px 40px', background: THEME.surfaceVar }}>
                          {/* Monthly trend graph */}
                          <MonthlyTrendChart row={row} expectedL100={row.expectedLpkm ? row.expectedLpkm * 100 : null} />
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '14px' }}>
                            <thead>
                              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                                {['Date', 'Docket #', 'Tank', 'Litres', 'Odometer (km)', 'km since prev'].map(h => (
                                  <th key={h} style={{ padding: '7px 12px', textAlign: ['Litres', 'Odometer (km)', 'km since prev'].includes(h) ? 'right' : 'left', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {row.txns.map((t, i) => {
                                const prevOdo = i > 0 && row.txns[i - 1].odometer_km != null ? Number(row.txns[i - 1].odometer_km) : null
                                const thisOdo = t.odometer_km != null ? Number(t.odometer_km) : null
                                const km = prevOdo != null && thisOdo != null && thisOdo > prevOdo ? thisOdo - prevOdo : null
                                const isAbnormal = row.avgFill != null && row.fills >= 3 && Number(t.litres) >= 2.5 * row.avgFill
                                return (
                                  <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: isAbnormal ? THEME.error + '08' : 'transparent' }}>
                                    <td style={{ padding: '7px 12px', color: THEME.textMed }}>{t.transaction_date}</td>
                                    <td style={{ padding: '7px 12px', color: COLOR, fontWeight: 600 }}>{t.docket_number || '—'}</td>
                                    <td style={{ padding: '7px 12px', color: THEME.text }}>{t.tank?.name || '—'}</td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, color: isAbnormal ? THEME.error : THEME.warning }}>
                                      {fmt(t.litres)} L{isAbnormal && ' ⚠'}
                                    </td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', color: thisOdo != null ? THEME.text : THEME.textLow }}>{thisOdo != null ? thisOdo.toLocaleString() : '—'}</td>
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
