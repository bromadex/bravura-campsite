import { useState, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { useFuel } from '../../contexts/FuelContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'

const COLOR = MODULE_COLORS.fuel

const Icon = ({ name, size = 18, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', color: 'inherit', ...style }}>{name}</span>
)

const btn = (extra = {}) => ({
  border: 'none', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 600, fontSize: '13px', padding: '8px 16px',
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  ...extra,
})

const SHIFT_WINDOWS = {
  morning:   { label: 'Morning',   start: '06:00', end: '14:00', icon: 'wb_sunny' },
  afternoon: { label: 'Afternoon', start: '14:00', end: '22:00', icon: 'wb_twilight' },
  night:     { label: 'Night',     start: '22:00', end: '06:00', icon: 'nights_stay' },
}

const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function ShiftReport() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { tanks, operators } = useFuel()

  const [operatorId, setOperatorId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [shift, setShift] = useState('morning')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)

  const generate = useCallback(async () => {
    setLoading(true)
    setReport(null)

    const shiftMeta = SHIFT_WINDOWS[shift]

    // Dip readings for this shift on this date (and next date for night shift end)
    const nextDate = (() => {
      const d = new Date(date + 'T00:00:00')
      d.setDate(d.getDate() + 1)
      return d.toISOString().slice(0, 10)
    })()

    const dipQ = supabase.from('fuel_dip_readings')
      .select('*, tank:fuel_tanks(tank_name, capacity_litres), operator:fuel_operators(full_name)')
      .eq('site_id', currentSiteId)
      .in('reading_date', shift === 'night' ? [date, nextDate] : [date])
      .order('reading_date', { ascending: true })
      .order('reading_time', { ascending: true })

    if (shift !== null) dipQ.eq('shift', shift)

    const [{ data: dips }, { data: transactions }] = await Promise.all([
      dipQ,
      // All transactions for the date (operator filter if selected)
      supabase.from('fuel_transactions')
        .select('*, tank:fuel_tanks(tank_name), fleet_asset:fleet_assets(fleet_number, registration, asset_number, description, serial_number), operator:fuel_operators(full_name)')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
        .eq('transaction_date', date)
        .then(r => {
          if (operatorId && r.data) {
            return { data: r.data.filter(t => t.operator_id === operatorId), error: r.error }
          }
          return r
        }),
    ])

    // Group dips by tank — first = opening, last = closing
    const dipsByTank = {}
    for (const d of dips || []) {
      if (!dipsByTank[d.tank_id]) dipsByTank[d.tank_id] = []
      dipsByTank[d.tank_id].push(d)
    }

    // Per-tank summary
    const tankSummaries = tanks
      .filter(t => t.status === 'active' && !t.is_archived)
      .map(tank => {
        const tankDips = dipsByTank[tank.id] || []
        const openingDip  = tankDips[0] || null
        const closingDip  = tankDips[tankDips.length - 1] || null
        const tankTxns    = (transactions || []).filter(t => t.tank_id === tank.id)
        const delivered   = tankTxns.filter(t => t.transaction_type === 'delivery').reduce((s, t) => s + Number(t.litres), 0)
        const issued      = tankTxns.filter(t => t.transaction_type === 'issuance').reduce((s, t) => s + Number(t.litres), 0)
        const adjustments = tankTxns.filter(t => t.transaction_type === 'adjustment').reduce((s, t) => s + Number(t.litres), 0)

        const openingLevel = openingDip?.level_litres ?? null
        const closingLevel = closingDip?.level_litres ?? null
        const expectedClosing = openingLevel != null ? openingLevel + delivered - issued + adjustments : null
        const variance = (closingLevel != null && expectedClosing != null) ? closingLevel - expectedClosing : null

        return { tank, openingDip, closingDip, delivered, issued, adjustments, openingLevel, closingLevel, expectedClosing, variance }
      })
      .filter(s => s.openingDip || s.closingDip || s.issued > 0 || s.delivered > 0)

    const issuances  = (transactions || []).filter(t => t.transaction_type === 'issuance')
    const deliveries = (transactions || []).filter(t => t.transaction_type === 'delivery')
    const totalIssued   = issuances.reduce((s, t) => s + Number(t.litres), 0)
    const totalDelivered = deliveries.reduce((s, t) => s + Number(t.litres), 0)

    const selectedOp = operators.find(o => o.id === operatorId)

    setReport({ date, shift, shiftMeta, operatorName: selectedOp?.full_name || 'All operators', tankSummaries, issuances, deliveries, totalIssued, totalDelivered, dips: dips || [] })
    setLoading(false)
  }, [currentSiteId, date, shift, operatorId, tanks, operators])

  const printReport = () => window.print()

  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <style>{`@media print { .no-print { display: none !important; } body { background: white !important; } }`}</style>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Shift Report</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>Per-shift summary of dip readings, issuances, and deliveries</p>
        </div>
      </div>

      {/* Form */}
      <div className="no-print" style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, padding: '20px 24px', marginBottom: '24px', boxShadow: THEME.shadow1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Operator (optional)</label>
            <select value={operatorId} onChange={e => setOperatorId(e.target.value)} style={selStyle}>
              <option value="">All Operators</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={selStyle} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Shift</label>
            <select value={shift} onChange={e => setShift(e.target.value)} style={selStyle}>
              <option value="morning">Morning (06:00–14:00)</option>
              <option value="afternoon">Afternoon (14:00–22:00)</option>
              <option value="night">Night (22:00–06:00)</option>
            </select>
          </div>
          <button onClick={generate} disabled={loading} style={{ ...btn({ background: COLOR, color: '#fff', opacity: loading ? 0.6 : 1 }) }}>
            <Icon name="analytics" size={15} /> Generate
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px', color: THEME.textLow }}>Generating report…</div>
      )}

      {report && (
        <div id="shift-report-content">
          {/* Header */}
          <div style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, padding: '20px 24px', marginBottom: '16px', boxShadow: THEME.shadow1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 600, color: THEME.text }}>
                  {report.shiftMeta.label} Shift Report
                </div>
                <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>
                  {fmtDate(report.date)} &nbsp;·&nbsp; {report.shiftMeta.start}–{report.shiftMeta.end}
                </div>
                <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '2px' }}>
                  Operator: <strong style={{ color: THEME.text }}>{report.operatorName}</strong>
                </div>
              </div>
              <div className="no-print" style={{ display: 'flex', gap: '8px' }}>
                <button onClick={printReport} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>
                  <Icon name="print" size={15} /> Print
                </button>
              </div>
            </div>

            {/* KPI row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginTop: '20px' }}>
              {[
                { label: 'Total Issued', value: fmt(report.totalIssued) + ' L', icon: 'output', color: THEME.warning },
                { label: 'Total Delivered', value: fmt(report.totalDelivered) + ' L', icon: 'local_gas_station', color: THEME.success },
                { label: 'Issuance Events', value: report.issuances.length, icon: 'receipt_long', color: COLOR },
                { label: 'Tanks Tracked', value: report.tankSummaries.length, icon: 'propane_tank', color: COLOR },
              ].map(k => (
                <div key={k.label} style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 500 }}>{k.label}</div>
                    <Icon name={k.icon} size={14} style={{ color: k.color }} />
                  </div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: k.color, marginTop: '4px' }}>{k.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Tank-level summary */}
          {report.tankSummaries.length > 0 && (
            <div style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, padding: '20px 24px', marginBottom: '16px', boxShadow: THEME.shadow1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '14px' }}>Tank Levels</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    {['Tank', 'Opening (L)', 'Delivered', 'Issued', 'Expected Close', 'Actual Close', 'Variance'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Tank' ? 'left' : 'right', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.tankSummaries.map(s => {
                    const varPct = s.variance != null && s.openingLevel > 0 ? (s.variance / s.openingLevel) * 100 : null
                    const varColor = s.variance == null ? THEME.textLow
                      : Math.abs(s.variance) < 5 ? THEME.success
                      : Math.abs(s.variance) < 50 ? THEME.warning : THEME.error
                    return (
                      <tr key={s.tank.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '10px 12px', color: THEME.text, fontWeight: 500 }}>{s.tank.tank_name}</td>
                        <td style={{ padding: '10px 12px', color: THEME.text, textAlign: 'right' }}>{fmt(s.openingLevel)}</td>
                        <td style={{ padding: '10px 12px', color: THEME.success, textAlign: 'right' }}>{s.delivered > 0 ? '+' + fmt(s.delivered) : '—'}</td>
                        <td style={{ padding: '10px 12px', color: THEME.warning, textAlign: 'right' }}>{s.issued > 0 ? '−' + fmt(s.issued) : '—'}</td>
                        <td style={{ padding: '10px 12px', color: THEME.textMed, textAlign: 'right' }}>{fmt(s.expectedClosing)}</td>
                        <td style={{ padding: '10px 12px', color: THEME.text, fontWeight: 600, textAlign: 'right' }}>{fmt(s.closingLevel)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <span style={{ color: varColor, fontWeight: 600, fontSize: '12px' }}>
                            {s.variance != null ? (s.variance >= 0 ? '+' : '') + fmt(s.variance) + ' L' : '—'}
                            {varPct != null && <span style={{ fontSize: '10px', marginLeft: '4px' }}>({varPct >= 0 ? '+' : ''}{varPct.toFixed(1)}%)</span>}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Issuances */}
          {report.issuances.length > 0 && (
            <div style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, padding: '20px 24px', marginBottom: '16px', boxShadow: THEME.shadow1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '14px' }}>Issuances</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    {['Docket #', 'Tank', 'Asset', 'Operator', 'Litres'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Litres' ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.issuances.map(t => {
                    const asset = t.fleet_asset ? `${t.fleet_asset.fleet_number || t.fleet_asset.asset_number || ''}${t.fleet_asset.registration ? ` (${t.fleet_asset.registration})` : ''}`.trim() || t.fleet_asset.description || '—' : t.asset_description || '—'
                    return (
                      <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '9px 12px', color: COLOR, fontWeight: 600 }}>{t.docket_number || '—'}</td>
                        <td style={{ padding: '9px 12px', color: THEME.text }}>{t.tank?.tank_name || '—'}</td>
                        <td style={{ padding: '9px 12px', color: THEME.text }}>{asset}</td>
                        <td style={{ padding: '9px 12px', color: THEME.textMed }}>{t.operator?.full_name || '—'}</td>
                        <td style={{ padding: '9px 12px', color: THEME.warning, fontWeight: 700, textAlign: 'right' }}>{fmt(t.litres)} L</td>
                      </tr>
                    )
                  })}
                  <tr style={{ borderTop: `2px solid ${THEME.outline}` }}>
                    <td colSpan={4} style={{ padding: '9px 12px', fontWeight: 700, color: THEME.text }}>TOTAL ISSUED</td>
                    <td style={{ padding: '9px 12px', fontWeight: 700, color: THEME.warning, textAlign: 'right' }}>{fmt(report.totalIssued)} L</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Deliveries */}
          {report.deliveries.length > 0 && (
            <div style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, padding: '20px 24px', marginBottom: '16px', boxShadow: THEME.shadow1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '14px' }}>Deliveries</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    {['Docket #', 'Tank', 'Supplier', 'Litres'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Litres' ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.deliveries.map(t => (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '9px 12px', color: COLOR, fontWeight: 600 }}>{t.docket_number || '—'}</td>
                      <td style={{ padding: '9px 12px', color: THEME.text }}>{t.tank?.tank_name || '—'}</td>
                      <td style={{ padding: '9px 12px', color: THEME.textMed }}>{t.supplier || '—'}</td>
                      <td style={{ padding: '9px 12px', color: THEME.success, fontWeight: 700, textAlign: 'right' }}>{fmt(t.litres)} L</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: `2px solid ${THEME.outline}` }}>
                    <td colSpan={3} style={{ padding: '9px 12px', fontWeight: 700, color: THEME.text }}>TOTAL DELIVERED</td>
                    <td style={{ padding: '9px 12px', fontWeight: 700, color: THEME.success, textAlign: 'right' }}>{fmt(report.totalDelivered)} L</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Dip readings */}
          {report.dips.length > 0 && (
            <div style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, padding: '20px 24px', boxShadow: THEME.shadow1 }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '14px' }}>Dip Readings This Shift</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    {['Tank', 'Time', 'Dip (mm)', 'Level (L)', 'System (L)', 'Variance'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.dips.map(d => {
                    const pct = d.variance_percent
                    const vc = pct == null ? THEME.textLow : Math.abs(pct) > 5 ? THEME.error : Math.abs(pct) > 2 ? THEME.warning : THEME.success
                    return (
                      <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '9px 12px', color: THEME.text, fontWeight: 500 }}>{d.tank?.tank_name || '—'}</td>
                        <td style={{ padding: '9px 12px', color: THEME.textMed }}>{d.reading_time?.slice(0, 5) || '—'}</td>
                        <td style={{ padding: '9px 12px', color: THEME.text }}>{d.dip_mm != null ? fmt(d.dip_mm) : '—'}</td>
                        <td style={{ padding: '9px 12px', color: THEME.text, fontWeight: 500 }}>{fmt(d.level_litres)} L</td>
                        <td style={{ padding: '9px 12px', color: THEME.textMed }}>{d.system_level_litres != null ? fmt(d.system_level_litres) + ' L' : '—'}</td>
                        <td style={{ padding: '9px 12px', color: vc, fontWeight: 600, fontSize: '12px' }}>
                          {pct != null ? `${pct >= 0 ? '+' : ''}${Number(pct).toFixed(1)}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {report.tankSummaries.length === 0 && report.issuances.length === 0 && report.deliveries.length === 0 && (
            <div style={{ textAlign: 'center', padding: '60px', background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, color: THEME.textMed }}>
              No activity recorded for this shift.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
