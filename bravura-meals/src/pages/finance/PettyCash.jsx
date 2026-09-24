import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { Card, Button, Icon, Modal, PageHeader, showToast, fmtDate, today } from '../../components/ui'
import Denied from '../../components/Denied'
import { usd, uploadReceipt, openReceipt } from '../me/shared'
import { EXPENSE_CATEGORIES } from '../me/MyExpenses'

const FI = MODULE_COLORS.finance
const CAT = Object.fromEntries(EXPENSE_CATEGORIES)
const TYPE_LABEL = { top_up: 'Top-up', expense: 'Spending', claim_payment: 'Claim paid', advance: 'Advance paid', adjustment: 'Count adjustment' }
const inp = {
  width: '100%', minHeight: '40px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', border: `1px solid ${THEME.outlineVar}`,
  background: THEME.surface, color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }

export default function PettyCash() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const canEdit = can('pettycash.edit')

  const [funds, setFunds] = useState(null)
  const [fundId, setFundId] = useState(null)
  const [txns, setTxns] = useState([])
  const [counts, setCounts] = useState([])
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(null)   // 'spend' | 'topup' | 'count' | 'fund' | {void: txn}
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const loadFunds = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.from('petty_cash_funds')
      .select('*, custodian:profiles!petty_cash_funds_custodian_id_fkey(full_name, username)')
      .eq('site_id', currentSiteId).eq('is_archived', false).order('name')
    if (error) showToast(error.message, 'red')
    setFunds(data || [])
    setFundId(id => (data || []).some(f => f.id === id) ? id : (data || [])[0]?.id || null)
  }, [currentSiteId])

  const loadFund = useCallback(async () => {
    if (!fundId) { setTxns([]); setCounts([]); return }
    const [t, c] = await Promise.all([
      supabase.from('petty_cash_transactions').select('*').eq('fund_id', fundId).eq('site_id', currentSiteId)
        .order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('petty_cash_counts').select('*').eq('fund_id', fundId).eq('site_id', currentSiteId)
        .order('created_at', { ascending: false }).limit(5),
    ])
    setTxns(t.data || [])
    setCounts(c.data || [])
  }, [fundId, currentSiteId])

  useEffect(() => { loadFunds() }, [loadFunds])
  useEffect(() => { loadFund() }, [loadFund])
  useEffect(() => {
    if (!canEdit || !currentSiteId) return
    supabase.from('user_roles').select('profile:profiles!user_roles_user_id_fkey(id, full_name, username)')
      .or(`site_id.eq.${currentSiteId},site_id.is.null`).then(({ data }) => {
        const m = new Map(); (data || []).forEach(r => r.profile && m.set(r.profile.id, r.profile))
        setUsers([...m.values()].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')))
      })
  }, [canEdit, currentSiteId])

  const fund = (funds || []).find(f => f.id === fundId)
  const isCustodian = fund?.custodian_id === profile?.id
  const canSpend = can('pettycash.create') || isCustodian

  function open(kind, defaults = {}) { setForm(defaults); setModal(kind) }

  async function run(fn, done) {
    setBusy(true)
    try { await fn(); showToast(done, 'green'); setModal(null); await loadFunds(); await loadFund() }
    catch (err) { showToast(err.message || String(err), 'red') }
    setBusy(false)
  }

  const rpc = async (name, args) => { const { data, error } = await supabase.rpc(name, args); if (error) throw error; return data }

  function saveSpend() {
    run(async () => {
      const receipt = form.file ? await uploadReceipt(form.file, currentSiteId, profile.id) : null
      await rpc('petty_cash_record', { p_fund_id: fundId, p_type: 'expense', p_amount: Number(form.amount), p_description: form.description || '',
        p_category: form.category || 'other', p_date: form.date || today(), p_receipt_path: receipt, p_reference: form.reference || null })
    }, 'Spending recorded')
  }
  function saveTopUp() {
    run(() => rpc('petty_cash_record', { p_fund_id: fundId, p_type: 'top_up', p_amount: Number(form.amount),
      p_description: form.description || 'Top-up from bank', p_date: form.date || today(), p_reference: form.reference || null }), 'Fund topped up')
  }
  function saveCount() {
    run(async () => {
      const r = await rpc('petty_cash_count', { p_fund_id: fundId, p_counted: Number(form.counted), p_notes: form.notes || null })
      if (Number(r.variance) !== 0) showToast(`Difference of ${usd(r.variance)} booked`, 'orange')
    }, 'Cash count saved')
  }
  function saveVoid() {
    run(() => rpc('petty_cash_void', { p_txn_id: modal.void.id, p_reason: form.reason || '' }), 'Entry voided')
  }
  function saveFund() {
    if (!form.name?.trim()) { showToast('Name the fund', 'red'); return }
    run(async () => {
      const row = { name: form.name.trim(), custodian_id: form.custodian_id || null, float_amount: Number(form.float_amount || 0), updated_at: new Date().toISOString() }
      const q = form.id
        ? supabase.from('petty_cash_funds').update(row).eq('id', form.id).eq('site_id', currentSiteId)
        : supabase.from('petty_cash_funds').insert({ ...row, site_id: currentSiteId, created_by: profile.id })
      const { error } = await q
      if (error) throw error
    }, form.id ? 'Fund updated' : 'Fund created — top it up to start')
  }

  if (!can('pettycash.view') && !canEdit && !(funds || []).some(f => f.custodian_id === profile?.id)) {
    if (funds === null) return <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: FI }} /></div>
    return <Denied />
  }

  const topUpNeeded = fund ? Math.max(0, Number(fund.float_amount) - Number(fund.balance)) : 0

  return (
    <div>
      <PageHeader title="Petty Cash"
        actions={canEdit && <Button icon="add" onClick={() => open('fund', { float_amount: '' })} style={{ background: FI, color: '#fff' }}>New fund</Button>} />

      {funds === null ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: FI }} /></div>
      ) : funds.length === 0 ? (
        <Card style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
          No petty cash funds at this site yet.{canEdit && ' Create one, choose a custodian and top it up.'}
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', marginBottom: '16px' }}>
            {funds.map(f => {
              const low = Number(f.float_amount) > 0 && Number(f.balance) < Number(f.float_amount) * 0.25
              return (
                <button key={f.id} onClick={() => setFundId(f.id)} style={{
                  textAlign: 'left', padding: '14px 16px', borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit',
                  border: `2px solid ${f.id === fundId ? FI : THEME.outlineVar}`, background: THEME.surface,
                }}>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{f.name}{!f.is_active && <span style={{ color: THEME.textLow, fontWeight: 400 }}> · paused</span>}</div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: low ? THEME.error : THEME.text, fontVariantNumeric: 'tabular-nums', margin: '4px 0' }}>{usd(f.balance)}</div>
                  <div style={{ fontSize: '12px', color: THEME.textLow }}>Float {usd(f.float_amount)} · {f.custodian?.full_name || f.custodian?.username || 'no custodian'}</div>
                </button>
              )
            })}
          </div>

          {fund && (
            <>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                {canSpend && <Button icon="shopping_bag" onClick={() => open('spend', { date: today(), category: 'tools' })} style={{ background: FI, color: '#fff' }}>Record spending</Button>}
                {canEdit && <Button variant="outlined" icon="add_card" onClick={() => open('topup', { date: today(), amount: topUpNeeded ? topUpNeeded.toFixed(2) : '' })}>
                  Top up{topUpNeeded > 0 ? ` (${usd(topUpNeeded)} to float)` : ''}
                </Button>}
                {(canEdit || isCustodian) && <Button variant="outlined" icon="calculate" onClick={() => open('count', {})}>Count cash</Button>}
                {canEdit && <Button variant="text" icon="edit" onClick={() => open('fund', { id: fund.id, name: fund.name, custodian_id: fund.custodian_id || '', float_amount: fund.float_amount })}>Edit fund</Button>}
              </div>

              {counts[0] && (
                <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '10px' }}>
                  Last count {new Date(counts[0].created_at).toLocaleDateString()}: {usd(counts[0].counted_amount)} counted
                  {Number(counts[0].variance) !== 0
                    ? <span style={{ color: THEME.error }}> ({Number(counts[0].variance) > 0 ? 'over' : 'short'} {usd(Math.abs(counts[0].variance))})</span>
                    : ' — balanced'}
                </div>
              )}

              <Card style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '560px' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                      {['Date', 'Entry', 'Description', 'In', 'Out', ''].map(h => <th key={h} style={{ padding: '10px 12px', fontWeight: 600, textAlign: ['In', 'Out'].includes(h) ? 'right' : 'left' }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {txns.length === 0 && <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: THEME.textLow }}>No entries yet.</td></tr>}
                    {txns.map(t => (
                      <tr key={t.id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, opacity: t.status === 'void' ? 0.5 : 1 }}>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(t.txn_date)}</td>
                        <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{TYPE_LABEL[t.txn_type]}{t.category ? ` · ${CAT[t.category] || t.category}` : ''}</td>
                        <td style={{ padding: '8px 12px', color: THEME.text }}>
                          <span style={{ textDecoration: t.status === 'void' ? 'line-through' : 'none' }}>{t.description}</span>
                          {t.reference && <span style={{ color: THEME.textLow }}> · {t.reference}</span>}
                          {t.receipt_path && <> · <button onClick={() => openReceipt(t.receipt_path)} style={{ background: 'none', border: 'none', padding: 0, color: FI, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>receipt</button></>}
                          {t.status === 'void' && <div style={{ fontSize: '12px', color: THEME.error }}>Voided: {t.void_reason}</div>}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.statusSuccessText }}>{t.direction === 'in' ? usd(t.amount) : ''}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.direction === 'out' ? usd(t.amount) : ''}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                          {canEdit && t.status === 'posted' && !['claim_payment', 'advance'].includes(t.txn_type) && (
                            <button onClick={() => open({ void: t }, {})} style={{ background: 'none', border: 'none', color: THEME.textLow, cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px' }}>Void</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </>
      )}

      <Modal open={modal === 'spend'} onClose={() => setModal(null)} title={`Record spending — ${fund?.name || ''}`}
        footer={<Footer busy={busy} onCancel={() => setModal(null)} onSave={saveSpend} label="Record" />}>
        <div style={{ display: 'grid', gap: '10px' }}>
          <Two>
            <Field id="ps-amount" label="Amount (USD)"><input id="ps-amount" type="number" inputMode="decimal" step="0.01" style={inp} value={form.amount || ''} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field id="ps-date" label="Date"><input id="ps-date" type="date" style={inp} value={form.date || ''} max={today()} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          </Two>
          <Field id="ps-cat" label="Type">
            <select id="ps-cat" style={inp} value={form.category || 'other'} onChange={e => setForm({ ...form, category: e.target.value })}>
              {EXPENSE_CATEGORIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </Field>
          <Field id="ps-desc" label="What was bought"><input id="ps-desc" style={inp} value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} /></Field>
          <Field id="ps-file" label={`Receipt ${Number(form.amount) > 20 ? '(required over $20)' : '(optional)'}`}>
            <input id="ps-file" type="file" accept="image/*,application/pdf" capture="environment" style={inp} onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
          </Field>
          <div style={{ fontSize: '12px', color: THEME.textLow }}>Available: {usd(fund?.balance)}</div>
        </div>
      </Modal>

      <Modal open={modal === 'topup'} onClose={() => setModal(null)} title={`Top up — ${fund?.name || ''}`}
        footer={<Footer busy={busy} onCancel={() => setModal(null)} onSave={saveTopUp} label="Top up" />}>
        <div style={{ display: 'grid', gap: '10px' }}>
          <Two>
            <Field id="pt-amount" label="Amount (USD)"><input id="pt-amount" type="number" step="0.01" style={inp} value={form.amount || ''} onChange={e => setForm({ ...form, amount: e.target.value })} /></Field>
            <Field id="pt-date" label="Date"><input id="pt-date" type="date" style={inp} value={form.date || ''} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          </Two>
          <Field id="pt-ref" label="Bank withdrawal / cheque reference"><input id="pt-ref" style={inp} value={form.reference || ''} onChange={e => setForm({ ...form, reference: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={modal === 'count'} onClose={() => setModal(null)} title={`Count cash — ${fund?.name || ''}`}
        footer={<Footer busy={busy} onCancel={() => setModal(null)} onSave={saveCount} label="Save count" />}>
        <div style={{ display: 'grid', gap: '10px' }}>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>The books say there should be <b>{usd(fund?.balance)}</b>. Count the notes and coins in the box.</div>
          <Field id="pc-counted" label="Cash counted (USD)"><input id="pc-counted" type="number" inputMode="decimal" step="0.01" style={inp} value={form.counted ?? ''} onChange={e => setForm({ ...form, counted: e.target.value })} /></Field>
          {form.counted !== undefined && form.counted !== '' && Number(form.counted) !== Number(fund?.balance) && (
            <div style={{ fontSize: '13px', color: THEME.error }}>
              {Number(form.counted) > Number(fund?.balance) ? 'Over' : 'Short'} by {usd(Math.abs(Number(form.counted) - Number(fund?.balance)))} — explain below.
            </div>
          )}
          <Field id="pc-notes" label="Notes"><textarea id="pc-notes" rows={2} style={{ ...inp, resize: 'vertical' }} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={!!modal?.void} onClose={() => setModal(null)} title="Void entry"
        footer={<Footer busy={busy} onCancel={() => setModal(null)} onSave={saveVoid} label="Void" danger />}>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '8px' }}>{modal?.void?.description} — {usd(modal?.void?.amount)}. The fund balance and ledger are reversed.</div>
        <Field id="pv-reason" label="Reason"><input id="pv-reason" style={inp} value={form.reason || ''} onChange={e => setForm({ ...form, reason: e.target.value })} /></Field>
      </Modal>

      <Modal open={modal === 'fund'} onClose={() => setModal(null)} title={form.id ? 'Edit fund' : 'New petty cash fund'}
        footer={<Footer busy={busy} onCancel={() => setModal(null)} onSave={saveFund} label="Save" />}>
        <div style={{ display: 'grid', gap: '10px' }}>
          <Field id="pf-name" label="Name"><input id="pf-name" style={inp} value={form.name || ''} placeholder="e.g. Kamativi site office" onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field id="pf-cust" label="Custodian (keeps the cash box)">
            <select id="pf-cust" style={inp} value={form.custodian_id || ''} onChange={e => setForm({ ...form, custodian_id: e.target.value })}>
              <option value="">Choose…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </select>
          </Field>
          <Field id="pf-float" label="Float (USD) — the amount the box is topped back up to"><input id="pf-float" type="number" step="0.01" style={inp} value={form.float_amount ?? ''} onChange={e => setForm({ ...form, float_amount: e.target.value })} /></Field>
        </div>
      </Modal>
    </div>
  )
}

function Field({ id, label, children }) {
  return <div><label htmlFor={id} style={lbl}>{label}</label>{children}</div>
}
function Two({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>{children}</div>
}
function Footer({ busy, onCancel, onSave, label, danger }) {
  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
      <Button variant="text" onClick={onCancel}>Cancel</Button>
      <Button variant={danger ? 'danger' : 'filled'} onClick={onSave} disabled={busy} style={danger ? undefined : { background: FI, color: '#fff' }}>{busy ? 'Saving…' : label}</Button>
    </div>
  )
}
