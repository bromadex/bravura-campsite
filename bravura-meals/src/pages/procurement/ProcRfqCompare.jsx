import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, Icon, Modal, PageHeader, showToast } from '../../components/ui'

const ACCENT = MODULE_COLORS.procurement
const usd = n => n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inp = { width: '100%', minHeight: '40px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', border: `1px solid ${THEME.outlineVar}`,
  background: THEME.surface, color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box' }
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }

export default function ProcRfqCompare({ rfqId, setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [rfq, setRfq] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [modal, setModal] = useState(null)   // 'quote' | {award: response}
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!rfqId) return
    const { data, error } = await supabase.from('rfqs')
      .select('*, rfq_lines(*), rfq_responses(*, supplier:procurement_suppliers(supplier_name), lines:rfq_response_lines(*))')
      .eq('id', rfqId).eq('site_id', currentSiteId).maybeSingle()
    if (error) showToast(error.message, 'red')
    setRfq(data || false)
  }, [rfqId, currentSiteId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('procurement_suppliers').select('id, supplier_name').eq('site_id', currentSiteId).eq('status', 'active').order('supplier_name')
      .then(({ data }) => setSuppliers(data || []))
  }, [currentSiteId])

  const quotes = useMemo(() => (rfq?.rfq_responses || []).filter(r => r.status !== 'rejected' || rfq.status === 'awarded')
    .sort((a, b) => Number(a.total_amount || 0) - Number(b.total_amount || 0)), [rfq])
  const lowest = quotes.length ? Math.min(...quotes.map(q => Number(q.total_amount || Infinity))) : null
  const lines = rfq?.rfq_lines || []
  const priceOf = (q, lineId) => q.lines?.find(l => l.rfq_line_id === lineId)?.unit_price
  const bestLine = lineId => {
    const ps = quotes.map(q => priceOf(q, lineId)).filter(p => p != null).map(Number)
    return ps.length ? Math.min(...ps) : null
  }

  if (rfq === null) return <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div>
  if (rfq === false) return <Card style={{ padding: '24px' }}>RFQ not found at this site.</Card>

  const open = !['awarded', 'cancelled'].includes(rfq.status)

  async function saveQuote() {
    setBusy(true)
    const { error } = await supabase.rpc('proc_record_quote', {
      p_rfq_id: rfq.id, p_supplier_id: form.supplier_id || null, p_lead_time_days: form.lead ? Number(form.lead) : null,
      p_validity_days: form.validity ? Number(form.validity) : null, p_notes: form.notes || null,
      p_lines: lines.map(l => ({ rfq_line_id: l.id, unit_price: form[`p_${l.id}`] ?? '' })),
    })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Quote recorded', 'green'); setModal(null); load()
  }
  async function award() {
    setBusy(true)
    const { data: poId, error } = await supabase.rpc('proc_award_rfq', { p_response_id: modal.award.id, p_reason: form.reason || null })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Awarded — a draft purchase order was created', 'green'); setModal(null); load()
    if (poId) setTimeout(() => setPage?.('proc_orders'), 600)
  }

  return (
    <div>
      <button onClick={() => setPage?.('proc_rfqs')} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', padding: '4px 0', display: 'inline-flex', gap: '4px', alignItems: 'center' }}>
        <Icon name="arrow_back" size={16} /> RFQs
      </button>
      <PageHeader title={`Compare quotes · ${rfq.rfq_number}`} actions={open && can('procurement.create') &&
        <Button icon="add" onClick={() => { setForm({}); setModal('quote') }}>Record a quote</Button>} />
      <div style={{ fontSize: '14px', color: THEME.textMed, marginBottom: '14px' }}>
        {rfq.title}{rfq.deadline ? ` · deadline ${rfq.deadline}` : ''} · <span style={{ textTransform: 'capitalize' }}>{rfq.status.replace('_', ' ')}</span>
        {rfq.award_reason && <> · award reason: <i>{rfq.award_reason}</i></>}
      </div>

      {quotes.length === 0 ? (
        <Card style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No quotes yet. Record each supplier's prices as they come in.</Card>
      ) : (
        <Card style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: `${260 + quotes.length * 160}px` }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar, color: THEME.textMed, textAlign: 'left' }}>
                <th style={{ padding: '10px' }}>Item</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Qty</th>
                {quotes.map(q => (
                  <th key={q.id} style={{ padding: '10px', textAlign: 'right', color: THEME.text }}>
                    {q.supplier?.supplier_name}
                    {q.status === 'awarded' && <div style={{ fontSize: '11px', color: THEME.statusSuccessText }}>Awarded</div>}
                  </th>))}
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const best = bestLine(l.id)
                return (
                  <tr key={l.id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                    <td style={{ padding: '8px 10px' }}>{l.description}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(l.quantity)} {l.unit || ''}</td>
                    {quotes.map(q => {
                      const p = priceOf(q, l.id)
                      const isBest = p != null && Number(p) === best
                      return <td key={q.id} style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                        background: isBest ? THEME.statusSuccessBg : 'transparent', color: isBest ? THEME.statusSuccessText : THEME.text, fontWeight: isBest ? 600 : 400 }}>
                        {p != null ? usd(p) : '—'}</td>
                    })}
                  </tr>
                )
              })}
              <tr style={{ borderTop: `2px solid ${THEME.outline}`, fontWeight: 700, color: THEME.text }}>
                <td style={{ padding: '10px' }} colSpan={2}>Total</td>
                {quotes.map(q => <td key={q.id} style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: Number(q.total_amount) === lowest ? THEME.statusSuccessText : THEME.text }}>{usd(q.total_amount)}{Number(q.total_amount) === lowest && quotes.length > 1 ? ' · lowest' : ''}</td>)}
              </tr>
              <tr style={{ color: THEME.textMed }}>
                <td style={{ padding: '6px 10px' }} colSpan={2}>Lead time</td>
                {quotes.map(q => <td key={q.id} style={{ padding: '6px 10px', textAlign: 'right' }}>{q.lead_time_days != null ? `${q.lead_time_days} days` : '—'}</td>)}
              </tr>
              <tr style={{ color: THEME.textMed }}>
                <td style={{ padding: '6px 10px' }} colSpan={2}>Valid for</td>
                {quotes.map(q => <td key={q.id} style={{ padding: '6px 10px', textAlign: 'right' }}>{q.validity_days != null ? `${q.validity_days} days` : '—'}</td>)}
              </tr>
              {open && can('procurement.approve') && (
                <tr>
                  <td colSpan={2} />
                  {quotes.map(q => <td key={q.id} style={{ padding: '10px', textAlign: 'right' }}>
                    <Button size="sm" onClick={() => { setForm({}); setModal({ award: q }) }}>Award</Button></td>)}
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modal === 'quote'} onClose={() => setModal(null)} title="Record a supplier quote" maxWidth={560}
        footer={<><Button variant="text" onClick={() => setModal(null)}>Cancel</Button><Button onClick={saveQuote} disabled={busy}>Save quote</Button></>}>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div><label htmlFor="q-sup" style={lbl}>Supplier</label>
            <select id="q-sup" style={inp} value={form.supplier_id || ''} onChange={e => setForm({ ...form, supplier_id: e.target.value })}>
              <option value="">Choose…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></div>
          {lines.map(l => (
            <div key={l.id}><label htmlFor={`q-${l.id}`} style={lbl}>{l.description} — unit price for {Number(l.quantity)} {l.unit || ''}</label>
              <input id={`q-${l.id}`} type="number" step="0.01" style={inp} value={form[`p_${l.id}`] ?? ''} onChange={e => setForm({ ...form, [`p_${l.id}`]: e.target.value })} /></div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div><label htmlFor="q-lead" style={lbl}>Lead time (days)</label><input id="q-lead" type="number" style={inp} value={form.lead || ''} onChange={e => setForm({ ...form, lead: e.target.value })} /></div>
            <div><label htmlFor="q-val" style={lbl}>Quote valid for (days)</label><input id="q-val" type="number" style={inp} value={form.validity || ''} onChange={e => setForm({ ...form, validity: e.target.value })} /></div>
          </div>
          <div><label htmlFor="q-notes" style={lbl}>Notes</label><input id="q-notes" style={inp} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
      </Modal>

      <Modal open={!!modal?.award} onClose={() => setModal(null)} title={`Award to ${modal?.award?.supplier?.supplier_name || ''}`}
        footer={<><Button variant="text" onClick={() => setModal(null)}>Cancel</Button><Button onClick={award} disabled={busy}>Award & create PO</Button></>}>
        <div style={{ display: 'grid', gap: '12px', fontSize: '14px', color: THEME.text }}>
          <div>Total {usd(modal?.award?.total_amount)}. The other quotes are marked unsuccessful and a draft purchase order is created with these prices.</div>
          {modal?.award && Number(modal.award.total_amount) > lowest && (
            <div><label htmlFor="aw-reason" style={lbl}>This isn't the lowest quote — why choose it?</label>
              <input id="aw-reason" style={inp} placeholder="e.g. Delivers in 3 days vs 3 weeks" value={form.reason || ''} onChange={e => setForm({ ...form, reason: e.target.value })} /></div>
          )}
        </div>
      </Modal>
    </div>
  )
}
