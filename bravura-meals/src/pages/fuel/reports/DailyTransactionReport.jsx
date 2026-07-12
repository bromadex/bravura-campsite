import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../hooks/usePermissions'
import { useSite } from '../../../contexts/SiteContext'
import { useFuel } from '../../../contexts/FuelContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'

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



const TX_COLORS = { delivery: THEME.success, issuance: THEME.warning, adjustment: THEME.info }

export default function DailyTransactionReport() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { tanks } = useFuel()

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('fuel_transactions')
      .select('*, tank:fuel_tanks(name), fleet_asset:fleet_assets(fleet_number, registration, asset_number, description), operator:fuel_operators(employees(name))')
      .eq('site_id', currentSiteId)
      .eq('is_deleted', false)
      .eq('transaction_date', date)
      .order('created_at', { ascending: true })
    if (error) console.error('DailyTransactionReport query failed:', error)
    setRows(data || [])
    setLoading(false)
  }, [currentSiteId, date])

  useEffect(() => { run() }, [run])

  // Group by tank
  const grouped = rows ? Object.values(
    rows.reduce((acc, t) => {
      const key = t.tank_id
      if (!acc[key]) acc[key] = { tankName: t.tank?.name || '—', txns: [], delivered: 0, issued: 0, adjusted: 0 }
      acc[key].txns.push(t)
      if (t.transaction_type === 'delivery') acc[key].delivered += Number(t.litres)
      if (t.transaction_type === 'issuance') acc[key].issued += Number(t.litres)
      if (t.transaction_type === 'adjustment') acc[key].adjusted += Number(t.litres)
      return acc
    }, {})
  ) : []

  const grandIssued    = grouped.reduce((s, g) => s + g.issued, 0)
  const grandDelivered = grouped.reduce((s, g) => s + g.delivered, 0)
  const grandNet       = grandDelivered - grandIssued

  const doExport = () => {
    const headers = ['Date', 'Docket #', 'Type', 'Tank', 'Asset', 'Operator', 'Litres']
    const data = rows.map(t => [
      t.transaction_date,
      t.docket_number || '',
      t.transaction_type,
      t.tank?.name || '',
      t.fleet_asset ? `${t.fleet_asset.fleet_number || t.fleet_asset.asset_number || ''}${t.fleet_asset.registration ? ` (${t.fleet_asset.registration})` : ''}`.trim() || t.fleet_asset.description || '' : t.asset_description || '',
      t.operator?.employees?.name || '',
      t.litres,
    ])
    exportCsv(`daily-transactions-${date}.csv`, headers, data)
  }

  const fmtDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Daily Transaction Report</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>All transactions for a single date, grouped by tank</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '24px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={selStyle} />
        </div>
        {loading && <span style={{ fontSize: '12px', color: THEME.textLow, paddingBottom: '10px' }}>Loading…</span>}
        {rows && can('fuel.edit') && (
          <button onClick={doExport} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        )}
      </div>

      {rows && (
        <>
          {/* Grand totals */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px', marginBottom: '20px' }}>
            {[
              { label: 'Total Issued', value: fmt(grandIssued) + ' L', color: THEME.warning, icon: 'output' },
              { label: 'Total Delivered', value: fmt(grandDelivered) + ' L', color: THEME.success, icon: 'local_gas_station' },
              { label: 'Net Change', value: (grandNet >= 0 ? '+' : '') + fmt(grandNet) + ' L', color: grandNet >= 0 ? THEME.success : THEME.warning, icon: 'swap_vert' },
            ].map(k => (
              <div key={k.label} style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '14px 18px', boxShadow: THEME.shadow1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 500 }}>{k.label}</span>
                  <Icon name={k.icon} size={14} style={{ color: k.color }} />
                </div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, marginBottom: '12px' }}>{fmtDate(date)}</div>

          {grouped.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, color: THEME.textMed }}>
              No transactions on this date.
            </div>
          ) : (
            grouped.map(g => (
              <div key={g.tankName} style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, marginBottom: '16px', overflow: 'hidden', boxShadow: THEME.shadow1 }}>
                <div style={{ padding: '12px 18px', background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px', color: THEME.text }}>{g.tankName}</span>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                    {g.delivered > 0 && <span style={{ color: THEME.success, fontWeight: 600 }}>+{fmt(g.delivered)} L delivered</span>}
                    {g.issued > 0 && <span style={{ color: THEME.warning, fontWeight: 600 }}>−{fmt(g.issued)} L issued</span>}
                    {g.adjusted !== 0 && <span style={{ color: THEME.info, fontWeight: 600 }}>{g.adjusted >= 0 ? '+' : ''}{fmt(g.adjusted)} L adj</span>}
                  </div>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      {['Docket #', 'Type', 'Asset', 'Operator', 'Litres'].map(h => (
                        <th key={h} style={{ padding: '8px 16px', textAlign: h === 'Litres' ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {g.txns.map(t => {
                      const asset = t.fleet_asset ? `${t.fleet_asset.fleet_number || t.fleet_asset.asset_number || ''}${t.fleet_asset.registration ? ` (${t.fleet_asset.registration})` : ''}`.trim() || t.fleet_asset.description || '—' : t.asset_description || '—'
                      return (
                        <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                          <td style={{ padding: '10px 16px', color: COLOR, fontWeight: 600 }}>{t.docket_number || '—'}</td>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, background: (TX_COLORS[t.transaction_type] || THEME.info) + '18', color: TX_COLORS[t.transaction_type] || THEME.info }}>
                              {t.transaction_type}
                            </span>
                          </td>
                          <td style={{ padding: '10px 16px', color: THEME.text }}>{asset}</td>
                          <td style={{ padding: '10px 16px', color: THEME.textMed }}>{t.operator?.employees?.name || '—'}</td>
                          <td style={{ padding: '10px 16px', color: TX_COLORS[t.transaction_type] || THEME.info, fontWeight: 700, textAlign: 'right' }}>
                            {t.transaction_type === 'issuance' ? '−' : t.transaction_type === 'delivery' ? '+' : ''}
                            {fmt(t.litres)} L
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </>
      )}
    </div>
  )
}
