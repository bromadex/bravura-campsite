import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Card, Icon, PageHeader, showToast, fmtDate, today } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, StatusPill, usd, bigBtn, field, label, uploadReceipt, openReceipt } from './shared'

export const EXPENSE_CATEGORIES = [
  ['travel', 'Travel & transport'], ['accommodation', 'Accommodation'], ['meals', 'Meals'], ['fuel', 'Fuel'],
  ['tools', 'Tools & supplies'], ['medical', 'Medical'], ['communication', 'Airtime & data'], ['other', 'Other'],
]
const CAT = Object.fromEntries(EXPENSE_CATEGORIES)
const EMPTY_LINE = { expense_date: today(), category: 'travel', description: '', amount: '', file: null }

export default function MyExpenses() {
  const { me, loading } = useMe()
  const { profile } = useAuth()
  const [claims, setClaims] = useState(null)
  const [advances, setAdvances] = useState([])
  const [editing, setEditing] = useState(null)   // claim being edited (draft)
  const [lines, setLines] = useState([])
  const [newLine, setNewLine] = useState(EMPTY_LINE)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(null)          // 'advance' form

  const load = useCallback(async () => {
    const [c, a] = await Promise.all([
      supabase.from('expense_claims').select('*').eq('requested_by', profile.id).eq('is_archived', false)
        .order('created_at', { ascending: false }).limit(50),
      supabase.rpc('ess_my_open_advances'),
    ])
    if (c.error) showToast(c.error.message, 'red')
    setClaims(c.data || [])
    setAdvances(a.data || [])
  }, [profile?.id])
  useEffect(() => { if (me?.linked && profile?.id) load() }, [me?.linked, profile?.id, load])

  async function loadLines(claimId) {
    const { data } = await supabase.from('expense_claim_lines').select('*').eq('claim_id', claimId).eq('is_archived', false).order('expense_date')
    setLines(data || [])
  }

  async function startClaim() {
    setBusy(true)
    const { data, error } = await supabase.from('expense_claims').insert({
      site_id: me.site_id, employee_id: me.employee_id, requested_by: profile.id,
      claim_type: 'reimbursement', purpose: 'Expense claim',
    }).select().single()
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    setEditing(data); setLines([]); setNewLine(EMPTY_LINE); load()
  }

  async function openDraft(c) {
    setEditing(c); setNewLine(EMPTY_LINE); await loadLines(c.id)
  }

  async function saveHeader(patch) {
    const next = { ...editing, ...patch }
    setEditing(next)
    const { error } = await supabase.from('expense_claims').update(patch).eq('id', editing.id)
    if (error) showToast(error.message, 'red')
  }

  async function addLine() {
    const amt = parseFloat(newLine.amount)
    if (!newLine.description.trim() || !(amt > 0)) { showToast('Describe the expense and enter an amount', 'red'); return }
    if (amt > 20 && !newLine.file) { showToast('Attach a photo of the receipt for amounts over $20', 'red'); return }
    setBusy(true)
    try {
      const receipt_path = newLine.file ? await uploadReceipt(newLine.file, me.site_id, profile.id) : null
      const { error } = await supabase.from('expense_claim_lines').insert({
        claim_id: editing.id, expense_date: newLine.expense_date, category: newLine.category,
        description: newLine.description.trim(), amount: amt, receipt_path,
      })
      if (error) throw error
      setNewLine({ ...EMPTY_LINE, expense_date: newLine.expense_date })
      await loadLines(editing.id)
    } catch (err) { showToast(err.message, 'red') }
    setBusy(false)
  }

  async function removeLine(id) {
    const { error } = await supabase.from('expense_claim_lines').update({ is_archived: true }).eq('id', id)
    if (error) { showToast(error.message, 'red'); return }
    loadLines(editing.id)
  }

  async function submit(claim) {
    setBusy(true)
    const { error } = await supabase.rpc('expense_submit', { p_claim_id: claim.id })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Submitted — you will be notified when it is approved and paid', 'green')
    setEditing(null); setMode(null); load()
  }

  async function cancel(claim) {
    if (!window.confirm(`Cancel ${claim.claim_number}?`)) return
    const { error } = await supabase.rpc('expense_cancel', { p_claim_id: claim.id })
    if (error) { showToast(error.message, 'red'); return }
    if (editing?.id === claim.id) setEditing(null)
    load()
  }

  async function requestAdvance(form) {
    const amt = parseFloat(form.amount)
    if (!form.purpose.trim() || !(amt > 0)) { showToast('Say what the advance is for and how much you need', 'red'); return }
    setBusy(true)
    const { data, error } = await supabase.from('expense_claims').insert({
      site_id: me.site_id, employee_id: me.employee_id, requested_by: profile.id,
      claim_type: 'advance', purpose: form.purpose.trim(), total_amount: amt,
    }).select().single()
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    submit(data)
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />
  if (!claims) return <Loading />

  const total = lines.reduce((s, l) => s + Number(l.amount), 0)

  if (editing) {
    return (
      <div style={{ maxWidth: '640px' }}>
        <button onClick={() => { setEditing(null); load() }} style={{ background: 'none', border: 'none', color: ME_COLOR, fontFamily: 'inherit', fontSize: '14px', cursor: 'pointer', padding: '6px 0', marginBottom: '6px' }}>
          <Icon name="arrow_back" size={16} style={{ verticalAlign: 'middle' }} /> My expenses
        </button>
        <PageHeader title={`Claim ${editing.claim_number || ''}`} />
        <Card style={{ padding: '16px', display: 'grid', gap: '12px', marginBottom: '12px' }}>
          <div>
            <label htmlFor="ex-purpose" style={label}>What was it for?</label>
            <input id="ex-purpose" style={field} value={editing.purpose} placeholder="e.g. Trip to Harare for parts"
              onChange={e => setEditing({ ...editing, purpose: e.target.value })} onBlur={e => saveHeader({ purpose: e.target.value.trim() || 'Expense claim' })} />
          </div>
          {advances.length > 0 && (
            <div>
              <label htmlFor="ex-adv" style={label}>Account for an advance you received?</label>
              <select id="ex-adv" style={field} value={editing.advance_id || ''} onChange={e => saveHeader({ advance_id: e.target.value || null })}>
                <option value="">No — reimburse me in full</option>
                {advances.map(a => <option key={a.id} value={a.id}>{a.claim_number} — {usd(a.outstanding)} still to account for</option>)}
              </select>
            </div>
          )}
        </Card>

        <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
          {lines.map(l => (
            <Card key={l.id} style={{ padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: THEME.text, overflowWrap: 'anywhere' }}>{l.description}</div>
                <div style={{ fontSize: '12px', color: THEME.textLow }}>{fmtDate(l.expense_date)} · {CAT[l.category]}
                  {l.receipt_path && <> · <button onClick={() => openReceipt(l.receipt_path)} style={{ background: 'none', border: 'none', padding: 0, color: ME_COLOR, cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px' }}>receipt</button></>}
                </div>
              </div>
              <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{usd(l.amount)}</span>
              <button onClick={() => removeLine(l.id)} aria-label="Remove line" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', color: THEME.textLow }}>
                <Icon name="close" size={18} />
              </button>
            </Card>
          ))}
        </div>

        <Card style={{ padding: '14px 16px', display: 'grid', gap: '10px', marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>Add an expense</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="nl-date" style={label}>Date</label>
              <input id="nl-date" type="date" style={field} value={newLine.expense_date} max={today()} onChange={e => setNewLine({ ...newLine, expense_date: e.target.value })} />
            </div>
            <div>
              <label htmlFor="nl-cat" style={label}>Type</label>
              <select id="nl-cat" style={field} value={newLine.category} onChange={e => setNewLine({ ...newLine, category: e.target.value })}>
                {EXPENSE_CATEGORIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="nl-desc" style={label}>Description</label>
            <input id="nl-desc" style={field} value={newLine.description} placeholder="e.g. Bus fare Kamativi – Hwange" onChange={e => setNewLine({ ...newLine, description: e.target.value })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="nl-amt" style={label}>Amount (USD)</label>
              <input id="nl-amt" type="number" inputMode="decimal" step="0.01" style={field} value={newLine.amount} onChange={e => setNewLine({ ...newLine, amount: e.target.value })} />
            </div>
            <div>
              <label htmlFor="nl-file" style={label}>Receipt photo {parseFloat(newLine.amount) > 20 ? '(required)' : '(optional)'}</label>
              <input id="nl-file" type="file" accept="image/*,application/pdf" capture="environment" style={{ ...field, padding: '8px' }}
                onChange={e => setNewLine({ ...newLine, file: e.target.files?.[0] || null })} />
            </div>
          </div>
          <button style={{ ...bigBtn(THEME.surfaceVar, THEME.text), opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={addLine}>
            <Icon name="add" size={18} /> Add to claim
          </button>
        </Card>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '4px 2px 12px' }}>
          <span style={{ color: THEME.textMed }}>Total</span>
          <span style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{usd(total)}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button style={{ ...bigBtn(THEME.surfaceVar, THEME.error), flex: 1 }} onClick={() => cancel(editing)}>Discard</button>
          <button style={{ ...bigBtn(ME_COLOR), flex: 2, opacity: busy || !lines.length ? 0.6 : 1 }} disabled={busy || !lines.length} onClick={() => submit(editing)}>
            Submit for approval
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Expenses" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginBottom: '14px' }}>
        <button style={{ ...bigBtn(ME_COLOR), opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={startClaim}><Icon name="add_card" size={18} /> Claim expenses</button>
        <button style={bigBtn(THEME.surfaceVar, THEME.text)} onClick={() => setMode(mode === 'advance' ? null : 'advance')}><Icon name="request_quote" size={18} /> Ask for an advance</button>
      </div>

      {mode === 'advance' && <AdvanceForm busy={busy} onCancel={() => setMode(null)} onSubmit={requestAdvance} />}

      {advances.length > 0 && (
        <Card style={{ padding: '12px 14px', marginBottom: '14px', background: THEME.statusWarningBg }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.statusWarningText, marginBottom: '4px' }}>Advances to account for</div>
          {advances.map(a => (
            <div key={a.id} style={{ fontSize: '13px', color: THEME.statusWarningText }}>
              {a.claim_number} · {a.purpose} — <b>{usd(a.outstanding)}</b> of {usd(a.total_amount)}
            </div>
          ))}
          <div style={{ fontSize: '12px', color: THEME.statusWarningText, marginTop: '4px' }}>Claim your receipts against it; anything not accounted for may be recovered.</div>
        </Card>
      )}

      {claims.length === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No claims yet.</Card>
      ) : (
        <div style={{ display: 'grid', gap: '8px' }}>
          {claims.map(c => (
            <Card key={c.id} style={{ padding: '12px 14px' }} onClick={c.status === 'draft' ? () => openDraft(c) : undefined}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: THEME.text, overflowWrap: 'anywhere' }}>
                    {c.claim_type === 'advance' ? 'Advance' : 'Claim'} {c.claim_number} · {usd(c.total_amount)}
                  </div>
                  <div style={{ fontSize: '13px', color: THEME.textMed, overflowWrap: 'anywhere' }}>{c.purpose}</div>
                  {c.settled_amount > 0 && <div style={{ fontSize: '12px', color: THEME.textLow }}>{usd(c.settled_amount)} covered by your advance</div>}
                  {c.rejected_reason && <div style={{ fontSize: '12px', color: THEME.error }}>{c.rejected_reason}</div>}
                  {c.status === 'draft' && <div style={{ fontSize: '12px', color: ME_COLOR }}>Tap to continue</div>}
                </div>
                <StatusPill status={c.status} />
              </div>
              {c.status === 'submitted' && (
                <button onClick={e => { e.stopPropagation(); cancel(c) }} style={{ marginTop: '6px', background: 'none', border: 'none', padding: '6px 0', color: THEME.error, fontFamily: 'inherit', fontSize: '13px', cursor: 'pointer' }}>
                  Cancel claim
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function AdvanceForm({ busy, onCancel, onSubmit }) {
  const [form, setForm] = useState({ purpose: '', amount: '' })
  return (
    <Card style={{ padding: '16px', display: 'grid', gap: '12px', marginBottom: '14px' }}>
      <div>
        <label htmlFor="adv-purpose" style={label}>What is it for?</label>
        <input id="adv-purpose" style={field} value={form.purpose} placeholder="e.g. Travel to Bulawayo for NSSA office" onChange={e => setForm({ ...form, purpose: e.target.value })} />
      </div>
      <div>
        <label htmlFor="adv-amount" style={label}>Amount needed (USD)</label>
        <input id="adv-amount" type="number" inputMode="decimal" step="0.01" style={field} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
      </div>
      <div style={{ fontSize: '12px', color: THEME.textLow }}>After the trip, claim your receipts against the advance. Anything you don't account for can be recovered.</div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button style={{ ...bigBtn(THEME.surfaceVar, THEME.text), flex: 1 }} onClick={onCancel}>Cancel</button>
        <button style={{ ...bigBtn(ME_COLOR), flex: 2, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => onSubmit(form)}>Request advance</button>
      </div>
    </Card>
  )
}
