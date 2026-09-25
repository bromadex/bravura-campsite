import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, PageHeader, showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.inventory || '#6D4C41'
const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })
const th = { padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px' }
const tdn = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

export default function InvReorderExpiry({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [tab, setTab] = useState('reorder')
  const [sugg, setSugg] = useState(null)
  const [batches, setBatches] = useState(null)
  const [within, setWithin] = useState(90)
  const [busy, setBusy] = useState(false)

  const loadSugg = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.rpc('inv_reorder_suggestions', { p_site_id: currentSiteId })
    if (error) showToast(error.message, 'red')
    setSugg(data || [])
  }, [currentSiteId])
  useEffect(() => { loadSugg() }, [loadSugg])
  useEffect(() => {
    if (!currentSiteId) return
    setBatches(null)
    supabase.rpc('inv_batches', { p_site_id: currentSiteId, p_within_days: within === 'all' ? null : Number(within) })
      .then(({ data, error }) => { if (error) showToast(error.message, 'red'); setBatches(data || []) })
  }, [currentSiteId, within])

  async function raise() {
    setBusy(true)
    const { data: n, error } = await supabase.rpc('inv_run_reorder', { p_site_id: currentSiteId })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(n ? `${n} item${n > 1 ? 's' : ''} added to automatic requisitions — review and submit them` : 'Nothing new to reorder', 'green')
    loadSugg()
  }

  const tabBtn = k => ({ minHeight: '40px', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', fontWeight: 600,
    border: `1px solid ${tab === k ? ACCENT : THEME.outline}`, background: tab === k ? ACCENT : THEME.surface, color: tab === k ? '#fff' : THEME.textMed })
  const expiryColor = d => d == null ? THEME.textLow : d < 0 ? THEME.error : d <= 30 ? THEME.statusWarningText : THEME.text

  return (
    <div>
      <PageHeader title="Reorder & Expiry" />
      <div role="tablist" style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        <button role="tab" aria-selected={tab === 'reorder'} style={tabBtn('reorder')} onClick={() => setTab('reorder')}>Below reorder level{sugg?.length ? ` (${sugg.length})` : ''}</button>
        <button role="tab" aria-selected={tab === 'expiry'} style={tabBtn('expiry')} onClick={() => setTab('expiry')}>Batches & expiry</button>
      </div>

      {tab === 'reorder' && (
        <>
          <Card style={{ padding: '12px 14px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: THEME.textMed }}>
            <span style={{ flex: '1 1 320px' }}>
              When an issue takes an item to its reorder level (counting what's already on order or requested), it's added automatically to that store's draft requisition.
              Set reorder levels and quantities on each item.
            </span>
            {can('inventory.create') && <Button onClick={raise} disabled={busy || !sugg?.length}>Add all to requisitions</Button>}
            <Button variant="outlined" onClick={() => setPage?.('inv_requisitions')}>Open requisitions</Button>
          </Card>
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            {!sugg ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : sugg.length === 0 ? (
              <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>Nothing is below its reorder level.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
                <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed }}>
                  <th style={th}>Item</th><th style={th}>Store</th><th style={{ ...th, textAlign: 'right' }}>On hand</th><th style={{ ...th, textAlign: 'right' }}>On order</th>
                  <th style={{ ...th, textAlign: 'right' }}>Reorder level</th><th style={{ ...th, textAlign: 'right' }}>Order</th><th style={{ ...th, textAlign: 'right' }}>Est. cost</th></tr></thead>
                <tbody>{sugg.map(r => (
                  <tr key={r.item_id + r.warehouse_id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                    <td style={td}>{r.item_code} {r.description}</td><td style={td}>{r.warehouse}</td>
                    <td style={{ ...tdn, color: Number(r.on_hand) <= 0 ? THEME.error : THEME.text }}>{num(r.on_hand)}</td>
                    <td style={tdn}>{num(r.on_order)}</td><td style={tdn}>{num(r.reorder_level)}</td>
                    <td style={{ ...tdn, fontWeight: 700 }}>{num(r.suggested_qty)}</td><td style={tdn}>{usd(r.suggested_qty * r.unit_cost)}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {tab === 'expiry' && (
        <>
          <Card style={{ padding: '12px 14px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="bx-within" style={{ fontSize: '13px', color: THEME.textMed }}>Show</label>
            <select id="bx-within" value={within} onChange={e => setWithin(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              style={{ minHeight: '40px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }}>
              <option value={0}>Expired</option><option value={30}>Expiring within 30 days</option><option value={90}>Within 90 days</option><option value="all">All batches in stock</option>
            </select>
            <span style={{ fontSize: '12px', color: THEME.textLow, flex: '1 1 260px' }}>Record the batch number and expiry date when receiving goods; issues pick the earliest-expiring batch first.</span>
            {batches?.length > 0 && <Button variant="outlined" icon="download" onClick={() => exportCsv('batches.csv', ['Item', 'Description', 'Store', 'Batch', 'Expiry', 'Days left', 'Qty', 'Value'],
              batches.map(b => [b.item_code, b.description, b.warehouse, b.batch_no, b.expiry_date, b.days_left, b.qty_remaining, b.value]))}>CSV</Button>}
          </Card>
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            {!batches ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : batches.length === 0 ? (
              <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No batches in this range.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
                <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed }}>
                  <th style={th}>Item</th><th style={th}>Store</th><th style={th}>Batch</th><th style={th}>Expiry</th>
                  <th style={{ ...th, textAlign: 'right' }}>Qty left</th><th style={{ ...th, textAlign: 'right' }}>Value</th></tr></thead>
                <tbody>{batches.map(b => (
                  <tr key={b.batch_id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                    <td style={td}>{b.item_code} {b.description}</td><td style={td}>{b.warehouse}</td><td style={td}>{b.batch_no}</td>
                    <td style={{ ...td, color: expiryColor(b.days_left), fontWeight: b.days_left != null && b.days_left <= 30 ? 600 : 400 }}>
                      {b.expiry_date || '—'}{b.days_left != null && ` · ${b.days_left < 0 ? `expired ${-b.days_left} d ago` : `${b.days_left} d`}`}</td>
                    <td style={tdn}>{num(b.qty_remaining)}</td><td style={tdn}>{usd(b.value)}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
