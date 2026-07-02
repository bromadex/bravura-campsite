import { useState, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../hooks/usePermissions'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'

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

const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'

function exportCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

const STATUS_COLORS = {
  approved:  { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  submitted: { bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  draft:     { bg: THEME.surfaceVar,       text: THEME.textMed },
  queried:   { bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
}

export default function VarianceReport() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const today = new Date().toISOString().slice(0, 10)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(ninetyDaysAgo)
  const [to, setTo]     = useState(today)
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fuel_reconciliations')
      .select('*, tank:fuel_tanks(name)')
      .eq('site_id', currentSiteId)
      .gte('period_end', from)
      .lte('period_end', to)
      .order('period_end', { ascending: false })
    if (error) console.error('VarianceReport query failed:', error)
    setRows(data || [])
    setLoading(false)
  }, [currentSiteId, from, to])

  const highVarianceCount = rows ? rows.filter(r => r.variance_percent != null && Math.abs(Number(r.variance_percent)) > 5).length : 0

  const doExport = () => {
    if (!rows) return
    const headers = ['Ref', 'Tank', 'Period Start', 'Period End', 'Expected Close (L)', 'Actual Close (L)', 'Variance (L)', 'Variance %', 'Status']
    const data = rows.map(r => [
      r.reconciliation_number || '',
      r.tank?.name || '',
      r.period_start,
      r.period_end,
      r.closing_level_expected ?? '',
      r.closing_level_actual ?? '',
      r.variance_litres ?? '',
      r.variance_percent != null ? Number(r.variance_percent).toFixed(2) : '',
      r.status || '',
    ])
    exportCsv(`variance-report-${from}-to-${to}.csv`, headers, data)
  }

  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Variance Report</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>Tank reconciliation variances for the selected period — entries above 5% are highlighted</p>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '24px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Period End From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Period End To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selStyle} />
        </div>
        <button onClick={run} disabled={loading} style={{ ...btn({ background: COLOR, color: '#fff', opacity: loading ? 0.6 : 1 }) }}>
          <Icon name="bar_chart" size={15} /> {loading ? 'Loading…' : 'Run Report'}
        </button>
        {rows && can('fuel.edit') && (
          <button onClick={doExport} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        )}
      </div>

      {rows && (
        <>
          {highVarianceCount > 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 14px', background: THEME.statusErrorBg, border: `1px solid ${THEME.statusErrorText}30`, borderRadius: '10px', marginBottom: '16px', fontSize: '13px', color: THEME.statusErrorText, fontWeight: 600 }}>
              <Icon name="warning" size={16} />
              {highVarianceCount} reconciliation{highVarianceCount > 1 ? 's' : ''} with variance above 5% — requires investigation
            </div>
          )}

          <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  {['Ref', 'Tank', 'Period', 'Expected Close', 'Actual Close', 'Variance (L)', 'Variance %', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: ['Expected Close', 'Actual Close', 'Variance (L)', 'Variance %'].includes(h) ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No reconciliations found in this period.</td></tr>
                ) : (
                  rows.map(r => {
                    const varPct = r.variance_percent != null ? Number(r.variance_percent) : null
                    const isHigh = varPct != null && Math.abs(varPct) > 5
                    const varColor = varPct == null ? THEME.textMed : isHigh ? THEME.error : Math.abs(varPct) > 2 ? THEME.warning : THEME.success
                    const sc = STATUS_COLORS[r.status] || { bg: THEME.surfaceVar, text: THEME.textMed }
                    return (
                      <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: isHigh ? THEME.error + '06' : 'transparent' }}>
                        <td style={{ padding: '10px 14px', color: COLOR, fontWeight: 600 }}>{r.reconciliation_number || '—'}</td>
                        <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{r.tank?.name || '—'}</td>
                        <td style={{ padding: '10px 14px', color: THEME.textMed, fontSize: '12px' }}>
                          {r.period_start} → {r.period_end}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.textMed }}>{fmt(r.closing_level_expected)} L</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: THEME.text }}>{r.closing_level_actual != null ? fmt(r.closing_level_actual) + ' L' : '—'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: varColor }}>
                          {r.variance_litres != null ? (Number(r.variance_litres) >= 0 ? '+' : '') + fmt(r.variance_litres) + ' L' : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                          {varPct != null ? (
                            <span style={{ fontWeight: 700, color: varColor, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              {isHigh && <Icon name="warning" size={13} style={{ color: THEME.error }} />}
                              {(varPct >= 0 ? '+' : '') + varPct.toFixed(2) + '%'}
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, background: sc.bg, color: sc.text }}>
                            {r.status || '—'}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
