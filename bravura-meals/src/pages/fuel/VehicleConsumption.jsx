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

function ratioFlag(ratio) {
  if (ratio == null) return null
  if (ratio > 1.2) return { color: THEME.error,   bg: THEME.statusErrorBg,   label: 'Excessive',  icon: 'trending_up' }
  if (ratio < 0.8) return { color: THEME.warning,  bg: THEME.statusWarningBg, label: 'Low use',    icon: 'trending_down' }
  return              { color: THEME.success,  bg: THEME.statusSuccessBg, label: 'Normal',     icon: 'check_circle' }
}

function BarChart({ rows, color }) {
  const top = [...rows].sort((a, b) => b.totalLitres - a.totalLitres).slice(0, 10)
  if (!top.length) return null
  const max = Math.max(...top.map(r => r.totalLitres), 1)
  const W = 560, BAR_H = 20, GAP = 8, PAD_L = 110

  return (
    <svg viewBox={`0 0 ${W} ${top.length * (BAR_H + GAP)}`} style={{ width: '100%', overflow: 'visible' }}>
      {top.map((r, i) => {
        const barW = Math.max(2, (r.totalLitres / max) * (W - PAD_L - 80))
        const y = i * (BAR_H + GAP)
        const flag = ratioFlag(r.ratio)
        const barColor = flag ? flag.color : color
        return (
          <g key={r.vehicleId}>
            <text x={0} y={y + BAR_H * 0.72} fontSize={10} fill={THEME.textMed} fontFamily="inherit">
              {r.label.length > 15 ? r.label.slice(0, 14) + '…' : r.label}
            </text>
            <rect x={PAD_L} y={y + 2} width={barW} height={BAR_H - 4} rx={4} fill={barColor} opacity={0.85} />
            <text x={PAD_L + barW + 6} y={y + BAR_H * 0.72} fontSize={10} fill={THEME.textMed} fontFamily="inherit">
              {fmt(r.totalLitres)} L
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export default function VehicleConsumption() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  if (!can('fuel.view')) return (
    <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>
      <Icon name="lock" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      Access denied
    </div>
  )

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo]     = useState(today)
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [sortKey, setSortKey] = useState('totalLitres')
  const [sortDir, setSortDir] = useState(-1)
  const [view, setView]       = useState('table')
  const [fleetIntegration, setFleetIntegration] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('fuel_settings')
      .select('fleet_integration_enabled')
      .eq('site_id', currentSiteId)
      .maybeSingle()
      .then(({ data }) => setFleetIntegration(!!data?.fleet_integration_enabled))
  }, [currentSiteId])

  const run = useCallback(async () => {
    setLoading(true)
    setExpanded(null)
    const { data: txns } = await supabase
      .from('fuel_transactions')
      .select('vehicle_id, litres, meter_start, meter_end, transaction_date, docket_number, tank:fuel_tanks(tank_name), vehicle:fuel_vehicles(fleet_number, registration, department_id, expected_consumption_lpkm, fuel_types(name))')
      .eq('site_id', currentSiteId)
      .eq('transaction_type', 'issuance')
      .not('vehicle_id', 'is', null)
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .order('transaction_date', { ascending: false })

    const map = {}
    for (const t of (txns || [])) {
      const vId = t.vehicle_id
      if (!map[vId]) {
        const v = t.vehicle || {}
        map[vId] = {
          vehicleId: vId,
          label: v.fleet_number ? `${v.fleet_number}${v.registration ? ` (${v.registration})` : ''}` : vId,
          fleetNumber: v.fleet_number,
          registration: v.registration,
          departmentId: v.department_id,
          fuelType: v.fuel_types?.name || '—',
          expectedLpkm: v.expected_consumption_lpkm ? Number(v.expected_consumption_lpkm) : null,
          totalLitres: 0,
          issueCount: 0,
          totalKm: 0,
          kmCount: 0,
          txns: [],
        }
      }
      const row = map[vId]
      row.totalLitres += Number(t.litres)
      row.issueCount += 1
      if (t.meter_start != null && t.meter_end != null) {
        const km = Number(t.meter_end) - Number(t.meter_start)
        if (km > 0) { row.totalKm += km; row.kmCount += 1 }
      }
      row.txns.push(t)
    }

    for (const row of Object.values(map)) {
      row.avgLitresPerIssue = row.issueCount > 0 ? row.totalLitres / row.issueCount : null
      row.actualLpkm = row.totalKm > 0 ? row.totalLitres / row.totalKm : null
      row.ratio = row.actualLpkm != null && row.expectedLpkm ? row.actualLpkm / row.expectedLpkm : null
    }

    setRows(Object.values(map))
    setLoading(false)
  }, [currentSiteId, from, to])

  const sorted = useMemo(() => {
    if (!rows) return []
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity
      const bv = b[sortKey] ?? -Infinity
      return sortDir * (av < bv ? -1 : av > bv ? 1 : 0)
    })
  }, [rows, sortKey, sortDir])

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d)
    else { setSortKey(key); setSortDir(-1) }
  }

  const doExport = () => {
    if (!rows) return
    exportCsv(`vehicle-consumption-${from}-to-${to}.csv`,
      ['Vehicle', 'Registration', 'Fuel Type', 'Total Litres', 'Issues', 'Avg L/Issue', 'Total km', 'Actual L/km', 'Expected L/km', 'Ratio %', 'Status'],
      rows.map(r => {
        const f = ratioFlag(r.ratio)
        return [
          r.fleetNumber, r.registration, r.fuelType,
          r.totalLitres.toFixed(1), r.issueCount,
          r.avgLitresPerIssue?.toFixed(1) ?? '',
          r.totalKm > 0 ? r.totalKm.toFixed(0) : '',
          r.actualLpkm?.toFixed(3) ?? '',
          r.expectedLpkm?.toFixed(3) ?? '',
          r.ratio != null ? (r.ratio * 100).toFixed(1) : '',
          f?.label ?? '',
        ]
      })
    )
  }

  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  const ThSort = ({ label, k }) => (
    <th
      onClick={() => toggleSort(k)}
      style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: sortKey === k ? COLOR : THEME.textMed, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label} {sortKey === k ? (sortDir < 0 ? '↓' : '↑') : ''}
    </th>
  )

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Vehicle Consumption Analysis</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>
          Actual vs expected fuel consumption per vehicle — flag excessive or unusual use
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '24px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selStyle} />
        </div>
        <button onClick={run} disabled={loading} style={{ ...btn({ background: COLOR, color: '#fff', opacity: loading ? 0.6 : 1 }) }}>
          <Icon name="analytics" size={15} /> {loading ? 'Loading…' : 'Analyse'}
        </button>
        {rows && can('fuel.edit') && (
          <button onClick={doExport} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        )}
        {rows && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', background: THEME.surface, borderRadius: '8px', padding: '3px', border: `1px solid ${THEME.outlineVar}` }}>
            {[['table', 'table_rows'], ['chart', 'bar_chart']].map(([v, icon]) => (
              <button key={v} onClick={() => setView(v)} style={{ ...btn({ padding: '5px 10px', background: view === v ? COLOR : 'transparent', color: view === v ? '#fff' : THEME.textMed, borderRadius: '6px' }) }}>
                <Icon name={icon} size={15} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      {rows && (
        <div style={{ display: 'flex', gap: '14px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[
            { color: THEME.success, label: 'Normal (80–120% of expected)' },
            { color: THEME.error,   label: 'Excessive (>120%)' },
            { color: THEME.warning, label: 'Low use (<80%)' },
          ].map(l => (
            <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: THEME.textMed }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: l.color, display: 'inline-block', flexShrink: 0 }} />{l.label}
            </span>
          ))}
          <span style={{ fontSize: '11px', color: THEME.textLow }}>— Ratio requires odometer readings and expected L/km set on vehicle</span>
        </div>
      )}

      {rows && view === 'chart' && (
        <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '20px', marginBottom: '20px', boxShadow: THEME.shadow1 }}>
          <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '16px' }}>
            Top 10 Consumers by Volume
          </div>
          <BarChart rows={sorted} color={COLOR} />
        </div>
      )}

      {rows && view === 'table' && (
        <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Vehicle</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Fuel Type</th>
                <ThSort label="Total (L)" k="totalLitres" />
                <ThSort label="Issues" k="issueCount" />
                <ThSort label="Avg L/Issue" k="avgLitresPerIssue" />
                <ThSort label="Actual L/km" k="actualLpkm" />
                <ThSort label="Expected L/km" k="expectedLpkm" />
                <ThSort label="Ratio" k="ratio" />
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Status</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>
                  Maintenance
                  {!fleetIntegration && (
                    <span style={{ marginLeft: '6px', fontSize: '9px', fontWeight: 700, color: THEME.textLow, letterSpacing: '.04em' }}>(FLEET)</span>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No vehicle issuances in this period.</td></tr>
              ) : sorted.map(row => {
                const flag = ratioFlag(row.ratio)
                const isExpanded = expanded === row.vehicleId
                return (
                  <>
                    <tr
                      key={row.vehicleId}
                      onClick={() => setExpanded(isExpanded ? null : row.vehicleId)}
                      style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', background: isExpanded ? COLOR + '08' : 'transparent' }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = THEME.surfaceVar }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Icon name={isExpanded ? 'expand_less' : 'chevron_right'} size={15} style={{ color: THEME.textLow }} />
                          {row.label}
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{row.fuelType}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: COLOR }}>{fmt(row.totalLitres)} L</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.text }}>{row.issueCount}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.textMed }}>{fmt(row.avgLitresPerIssue, 2)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.text }}>{row.actualLpkm != null ? fmt(row.actualLpkm, 3) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.textMed }}>{row.expectedLpkm != null ? fmt(row.expectedLpkm, 3) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: flag?.color || THEME.textLow }}>
                        {row.ratio != null ? (row.ratio * 100).toFixed(0) + '%' : '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {flag ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, background: flag.bg, color: flag.color }}>
                            <Icon name={flag.icon} size={12} />{flag.label}
                          </span>
                        ) : <span style={{ color: THEME.textLow, fontSize: '11px' }}>No data</span>}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '11px' }}>
                        {fleetIntegration ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: THEME.textLow, fontStyle: 'italic' }}>
                            <Icon name="sync" size={12} />awaiting Fleet data
                          </span>
                        ) : (
                          <span style={{ color: THEME.textLow }}>N/A <span style={{ fontSize: '10px' }}>(Fleet module pending)</span></span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={row.vehicleId + '_exp'} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td colSpan={10} style={{ padding: '0 0 0 40px', background: THEME.surfaceVar }}>
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
                                return (
                                  <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                                    <td style={{ padding: '7px 12px', color: THEME.textMed }}>{t.transaction_date}</td>
                                    <td style={{ padding: '7px 12px', color: COLOR, fontWeight: 600 }}>{t.docket_number || '—'}</td>
                                    <td style={{ padding: '7px 12px', color: THEME.text }}>{t.tank?.tank_name || '—'}</td>
                                    <td style={{ padding: '7px 12px', textAlign: 'right', fontWeight: 600, color: THEME.warning }}>{fmt(t.litres)} L</td>
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
      )}
    </div>
  )
}
