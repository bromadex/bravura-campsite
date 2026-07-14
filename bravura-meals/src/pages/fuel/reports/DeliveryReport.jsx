import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../hooks/usePermissions'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { DashCard, KpiCard, SectionTitle, ProgressRow } from '../../../components/dash'

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
const fmtCost = n => n != null ? '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'



export default function DeliveryReport() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo]     = useState(today)
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('fuel_transactions')
      .select('*, tank:fuel_tanks(name, fuel_types(name))')
      .eq('site_id', currentSiteId)
      .eq('is_deleted', false)
      .eq('transaction_type', 'delivery')
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .order('transaction_date', { ascending: true })
    if (error) console.error('DeliveryReport query failed:', error)
    setRows(data || [])
    setLoading(false)
  }, [currentSiteId, from, to])

  useEffect(() => { run() }, [run])

  const rowCostOf = r => r.total_cost != null ? Number(r.total_cost)
    : r.unit_price && r.litres ? Number(r.unit_price) * Number(r.litres) : null

  const totalLitres = rows ? rows.reduce((s, r) => s + Number(r.litres), 0) : 0
  const totalCost   = rows ? rows.reduce((s, r) => s + (rowCostOf(r) || 0), 0) : 0

  const doExport = () => {
    if (!rows) return
    const headers = ['Date', 'Tank', 'Supplier', 'Quantity (L)', 'Unit Price', 'Total Cost', 'Docket #']
    const data = rows.map(r => [
      r.transaction_date,
      r.tank?.name || '',
      r.supplier || '',
      r.litres,
      r.unit_price || '',
      rowCostOf(r) != null ? rowCostOf(r).toFixed(2) : '',
      r.docket_number || '',
    ])
    exportCsv(`deliveries-${from}-to-${to}.csv`, headers, data)
  }

  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Delivery Report</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>All fuel deliveries received in the selected date range</p>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '24px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selStyle} />
        </div>
        {loading && <span style={{ fontSize: '12px', color: THEME.textLow, paddingBottom: '10px' }}>Loading…</span>}
        {rows && can('fuel.edit') && (
          <button onClick={doExport} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        )}
      </div>

      {(() => {
        if (!rows) return null
        const byTank = {}
        rows.forEach(r => { const k = r.tank?.name || '—'; byTank[k] = (byTank[k] || 0) + Number(r.litres) })
        const tankEntries = Object.entries(byTank).sort(([, a], [, b]) => b - a)
        return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            <KpiCard icon="local_gas_station" label="Total Volume" value={fmt(totalLitres) + ' L'} accent={THEME.success}
              sub={`${rows.length} deliver${rows.length === 1 ? 'y' : 'ies'} in period`} />
            <KpiCard icon="payments" label="Total Cost" value={fmtCost(totalCost)} accent={COLOR}
              sub={totalLitres > 0 && totalCost > 0 ? `Avg ${fmtCost(totalCost / totalLitres)}/L` : undefined} />
          </div>

          {totalLitres > 0 && tankEntries.length > 1 && (
            <DashCard style={{ marginBottom: '20px' }}>
              <SectionTitle title="Delivered Volume by Tank" subtitle={`${from} → ${to}`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {tankEntries.map(([name, litres]) => (
                  <ProgressRow key={name} label={name} value={fmt(litres) + ' L'} pct={(litres / totalLitres) * 100} color={COLOR} />
                ))}
              </div>
            </DashCard>
          )}

          <DashCard style={{ padding: '20px 22px 8px' }}>
            <SectionTitle title="Deliveries" subtitle={`${from} → ${to}`} />
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Date', 'Tank', 'Supplier', 'Docket #', 'Quantity', 'Unit Price', 'Total Cost'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: ['Quantity', 'Unit Price', 'Total Cost'].includes(h) ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No deliveries in this period.</td></tr>
                ) : (
                  rows.map(r => {
                    const rowCost = rowCostOf(r)
                    return (
                      <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '10px 14px', color: THEME.textMed }}>{r.transaction_date}</td>
                        <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{r.tank?.name || '—'}</td>
                        <td style={{ padding: '10px 14px', color: THEME.text }}>{r.supplier || '—'}</td>
                        <td style={{ padding: '10px 14px', color: COLOR, fontWeight: 600 }}>{r.docket_number || '—'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: THEME.success }}>{fmt(r.litres)} L</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.textMed }}>{r.unit_price ? fmtCost(r.unit_price) + '/L' : '—'}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: THEME.text }}>{fmtCost(rowCost)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr style={{ borderTop: `2px solid ${THEME.outlineVar}` }}>
                    <td colSpan={4} style={{ padding: '11px 14px', fontWeight: 700, color: THEME.text, fontSize: '13px' }}>TOTAL</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: THEME.success }}>{fmt(totalLitres)} L</td>
                    <td />
                    <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: COLOR }}>{fmtCost(totalCost)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            </div>
          </DashCard>
        </>
        )
      })()}
    </div>
  )
}
