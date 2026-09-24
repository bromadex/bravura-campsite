import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { Card, Button, Icon, Modal, PageHeader, showToast, fmtDate } from '../../components/ui'
import Denied from '../../components/Denied'
import { StatusPill, usd, openReceipt } from '../me/shared'
import { EXPENSE_CATEGORIES } from '../me/MyExpenses'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const FI = MODULE_COLORS.finance
const CAT = Object.fromEntries(EXPENSE_CATEGORIES)
const TABS = [
  { id: 'submitted', label: 'To approve' },
  { id: 'approved',  label: 'To pay' },
  { id: 'paid',      label: 'Paid' },
  { id: 'all',       label: 'All' },
]
const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', border: `1px solid ${THEME.outlineVar}`,
  background: THEME.surface, color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const tabStyle = a => ({
  padding: '8px 14px', border: 'none', borderBottom: `2px solid ${a ? FI : 'transparent'}`, background: 'transparent',
  color: a ? FI : THEME.textMed, fontWeight: a ? 600 : 400, fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer',
})

export default function ExpenseClaims() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('expense_claims', { column: 'site_id', value: currentSiteId })
  const canApprove = can('expenses.approve')
  const canPay = can('expenses.edit')

  const [claims, setClaims] = useState(null)
  const [routed, setRouted] = useState(new Set())
  const [tab, setTab] = useState('submitted')
  const [openId, setOpenId] = useState(null)
  const [lines, setLines] = useState({})
  const [funds, setFunds] = useState([])
  const [payFor, setPayFor] = useState(null)
  const [pay, setPay] = useState({ method: 'bank', fund_id: '', reference: '' })
  const [rejectFor, setRejectFor] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const [c, r, f] = await Promise.all([
      supabase.from('expense_claims')
        .select('*, employee:employees!expense_claims_employee_id_fkey(name, employee_number)')
        .eq('site_id', currentSiteId).eq('is_archived', false).neq('status', 'draft')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('approval_requests').select('entity_id').eq('site_id', currentSiteId)
        .eq('entity_type', 'expense_claims').eq('status', 'pending'),
      supabase.from('petty_cash_funds').select('id, name, balance').eq('site_id', currentSiteId)
        .eq('is_active', true).eq('is_archived', false).order('name'),
    ])
    if (c.error) showToast(c.error.message, 'red')
    setClaims(c.data || [])
    setRouted(new Set((r.data || []).map(x => x.entity_id)))
    setFunds(f.data || [])
  }, [currentSiteId])

  useEffect(() => { load() }, [load, rt])

  const outstanding = useMemo(() => {
    const all = claims || []
    return all.filter(a => a.claim_type === 'advance' && a.status === 'paid').map(a => {
      const used = all.filter(c => c.advance_id === a.id && ['approved', 'paid'].includes(c.status))
        .reduce((s, c) => s + Number(c.settled_amount || 0), 0)
      return { ...a, outstanding: Number(a.total_amount) - used }
    }).filter(a => a.outstanding > 0.005)
  }, [claims])

  async function toggle(c) {
    if (openId === c.id) { setOpenId(null); return }
    setOpenId(c.id)
    if (!lines[c.id] && c.claim_type === 'reimbursement') {
      const { data } = await supabase.from('expense_claim_lines').select('*').eq('claim_id', c.id).eq('is_archived', false).order('expense_date')
      setLines(l => ({ ...l, [c.id]: data || [] }))
    }
  }

  async function approve(c) {
    setBusy(true)
    const { error } = await supabase.rpc('expense_decide', { p_claim_id: c.id, p_approve: true })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${c.claim_number} approved`, 'green'); load()
  }

  async function reject() {
    if (!reason.trim()) { showToast('Give a reason so the employee knows what to fix', 'red'); return }
    setBusy(true)
    const { error } = await supabase.rpc('expense_decide', { p_claim_id: rejectFor.id, p_approve: false, p_reason: reason.trim() })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    setRejectFor(null); setReason(''); load()
  }

  async function doPay() {
    if (pay.method === 'petty_cash' && !pay.fund_id) { showToast('Choose the petty cash fund', 'red'); return }
    setBusy(true)
    const { error } = await supabase.rpc('expense_pay', {
      p_claim_id: payFor.id, p_method: pay.method, p_fund_id: pay.method === 'petty_cash' ? pay.fund_id : null, p_reference: pay.reference || null,
    })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${payFor.claim_number} paid`, 'green')
    setPayFor(null); setPay({ method: 'bank', fund_id: '', reference: '' }); load()
  }

  if (!can('expenses.view') && !canApprove && !canPay) return <Denied />

  const list = (claims || []).filter(c => tab === 'all' || c.status === tab)
  const payable = c => c.claim_type === 'advance' ? Number(c.total_amount) : Number(c.total_amount) - Number(c.settled_amount || 0)

  return (
    <div>
      <PageHeader title="Expense Claims" />

      {outstanding.length > 0 && (
        <Card style={{ padding: '12px 16px', marginBottom: '14px', background: THEME.statusWarningBg }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.statusWarningText, marginBottom: '4px' }}>
            Advances not yet accounted for — {usd(outstanding.reduce((s, a) => s + a.outstanding, 0))}
          </div>
          <div style={{ display: 'grid', gap: '2px' }}>
            {outstanding.map(a => (
              <div key={a.id} style={{ fontSize: '12px', color: THEME.statusWarningText }}>
                {a.employee?.name} · {a.claim_number} · {a.purpose} — <b>{usd(a.outstanding)}</b> (paid {a.paid_at ? new Date(a.paid_at).toLocaleDateString() : ''})
              </div>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${THEME.outlineVar}`, marginBottom: '14px', flexWrap: 'wrap' }}>
        {TABS.map(t => {
          const n = t.id === 'all' ? null : (claims || []).filter(c => c.status === t.id).length
          return <button key={t.id} style={tabStyle(tab === t.id)} onClick={() => setTab(t.id)}>{t.label}{n ? ` (${n})` : ''}</button>
        })}
      </div>

      {!claims ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: FI }} /></div>
      ) : list.length === 0 ? (
        <Card style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>Nothing here.</Card>
      ) : (
        <div style={{ display: 'grid', gap: '8px' }}>
          {list.map(c => {
            const own = c.requested_by === profile?.id
            const onRoute = routed.has(c.id)
            return (
              <Card key={c.id} style={{ padding: '12px 16px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: THEME.text }}>{c.claim_type === 'advance' ? 'Advance' : 'Claim'} {c.claim_number}</span>
                      <StatusPill status={c.status} />
                    </div>
                    <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '2px' }}>
                      {c.employee?.name} · {c.purpose}
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px', fontVariantNumeric: 'tabular-nums' }}>
                      {usd(c.total_amount)}
                      {Number(c.settled_amount) > 0 && ` · ${usd(c.settled_amount)} against advance · ${usd(payable(c))} to pay`}
                      {c.submitted_at && ` · submitted ${new Date(c.submitted_at).toLocaleDateString()}`}
                      {c.status === 'paid' && ` · paid by ${c.payment_method === 'petty_cash' ? 'petty cash' : 'bank'}${c.payment_ref ? ` (${c.payment_ref})` : ''}`}
                    </div>
                    {c.rejected_reason && <div style={{ fontSize: '12px', color: THEME.error, marginTop: '2px' }}>{c.rejected_reason}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {c.claim_type === 'reimbursement' && (
                      <Button size="sm" variant="text" icon={openId === c.id ? 'expand_less' : 'list'} onClick={() => toggle(c)}>Lines</Button>
                    )}
                    {c.status === 'submitted' && canApprove && !own && (onRoute ? (
                      <span style={{ fontSize: '12px', color: THEME.textLow, alignSelf: 'center' }}>On an approval route — decide in the Approvals inbox</span>
                    ) : <>
                      <Button size="sm" variant="outlined" disabled={busy} onClick={() => { setRejectFor(c); setReason('') }} style={{ color: THEME.error, borderColor: THEME.error }}>Reject</Button>
                      <Button size="sm" variant="success" icon="check" disabled={busy} onClick={() => approve(c)}>Approve</Button>
                    </>)}
                    {c.status === 'approved' && canPay && (
                      <Button size="sm" icon="paid" disabled={busy} onClick={() => { setPayFor(c); setPay({ method: 'bank', fund_id: funds[0]?.id || '', reference: '' }) }}
                        style={{ background: FI, color: '#fff' }}>Pay {usd(payable(c))}</Button>
                    )}
                  </div>
                </div>
                {openId === c.id && (
                  <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'grid', gap: '4px' }}>
                    {(lines[c.id] || []).map(l => (
                      <div key={l.id} style={{ display: 'flex', gap: '10px', fontSize: '13px', color: THEME.textMed, flexWrap: 'wrap' }}>
                        <span style={{ minWidth: '84px', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(l.expense_date)}</span>
                        <span style={{ minWidth: '120px' }}>{CAT[l.category]}</span>
                        <span style={{ flex: 1, color: THEME.text }}>{l.description}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{usd(l.amount)}</span>
                        {l.receipt_path
                          ? <button onClick={() => openReceipt(l.receipt_path)} style={{ background: 'none', border: 'none', padding: 0, color: FI, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>Receipt</button>
                          : <span style={{ color: THEME.textLow }}>no receipt</span>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={!!payFor} onClose={() => setPayFor(null)} title={`Pay ${payFor?.claim_number || ''}`}
        footer={<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="text" onClick={() => setPayFor(null)}>Cancel</Button>
          <Button onClick={doPay} disabled={busy} style={{ background: FI, color: '#fff' }}>Record payment</Button>
        </div>}>
        {payFor && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div style={{ fontSize: '14px', color: THEME.text }}>{payFor.employee?.name} — <b>{usd(payable(payFor))}</b></div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {[['bank', 'Bank transfer (IMTT applies)'], ['petty_cash', 'Cash from petty cash']].map(([v, t]) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMed }}>
                  <input type="radio" name="pay-method" id={`pay-${v}`} checked={pay.method === v} onChange={() => setPay({ ...pay, method: v })} /> {t}
                </label>
              ))}
            </div>
            {pay.method === 'petty_cash' && (
              <div>
                <label htmlFor="pay-fund" style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>Fund</label>
                <select id="pay-fund" style={inp} value={pay.fund_id} onChange={e => setPay({ ...pay, fund_id: e.target.value })}>
                  <option value="">Choose fund…</option>
                  {funds.map(f => <option key={f.id} value={f.id}>{f.name} — {usd(f.balance)} available</option>)}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="pay-ref" style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>Reference (optional)</label>
              <input id="pay-ref" style={inp} value={pay.reference} placeholder="EFT or voucher number" onChange={e => setPay({ ...pay, reference: e.target.value })} />
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} title={`Reject ${rejectFor?.claim_number || ''}`}
        footer={<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="text" onClick={() => setRejectFor(null)}>Cancel</Button>
          <Button variant="danger" onClick={reject} disabled={busy}>Reject</Button>
        </div>}>
        <label htmlFor="rej-reason" style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Reason *</label>
        <textarea id="rej-reason" rows={3} style={{ ...inp, resize: 'vertical' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Receipt unreadable — please re-attach" />
      </Modal>
    </div>
  )
}
