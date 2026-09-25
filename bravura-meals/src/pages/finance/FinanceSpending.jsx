import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { showToast, today } from '../../components/ui'
import Denied from '../../components/Denied'
import FinShell from '../../components/FinShell'
import { FIN, finCard, finBtn, finInput, money } from '../../utils/financeTheme'
import { uploadReceipt } from '../me/shared'
import { EXPENSE_CATEGORIES } from '../me/MyExpenses'
import PettyCash from './PettyCash'
import ExpenseClaims from './ExpenseClaims'

// FI27 — Claims & petty cash hub (was Expense Claims FI14 + Petty Cash FI15). Opens with a
// phone-friendly "Quick spend" card: amount, what for, photo of the slip — three taps on site.
const TABS = [
  { key: 'petty', label: 'Petty cash', hint: 'Site cash funds: spending, top-ups and cash counts' },
  { key: 'claims', label: 'Expense claims', hint: 'Staff claims and advances — approve and pay' },
]

export default function FinanceSpending({ setPage, initialTab = 'petty' }) {
  const { can } = usePermissions()
  const [tab, setTab] = useState(initialTab)
  const [bump, setBump] = useState(0)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  if (!can('pettycash.view') && !can('expenses.view') && !can('finance.view')) return <Denied />
  const t = TABS.find(x => x.key === tab) || TABS[0]
  return (
    <FinShell title="Claims & petty cash" subtitle={t.hint} tabs={TABS} tab={tab} onTab={setTab} setPage={setPage}>
      {tab === 'petty' && <>
        <QuickSpend onSaved={() => setBump(b => b + 1)} />
        <div style={{ height: 16 }} />
        {can('pettycash.view') ? <PettyCash key={bump} setPage={setPage} /> : <Denied />}
      </>}
      {tab === 'claims' && (can('expenses.view') ? <ExpenseClaims setPage={setPage} /> : <Denied />)}
    </FinShell>
  )
}

// Big touch targets, one column on a phone. Only funds the person looks after (or all, for
// petty-cash editors). Recording goes through petty_cash_record, which checks the rules server-side.
function QuickSpend({ onSaved }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const [funds, setFunds] = useState([])
  const [f, setF] = useState({ fund: '', amount: '', what: '', category: 'other', file: null })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase.from('petty_cash_funds').select('id, name, balance, custodian_id').eq('site_id', currentSiteId).eq('is_archived', false).eq('is_active', true).order('name')
    const mine = (data || []).filter(x => can('pettycash.create') || can('pettycash.edit') || x.custodian_id === profile?.id)
    setFunds(mine)
    setF(p => ({ ...p, fund: mine.some(x => x.id === p.fund) ? p.fund : (mine[0]?.id || '') }))
  }, [currentSiteId, can, profile?.id])
  useEffect(() => { load() }, [load])

  if (!funds.length) return null
  const fund = funds.find(x => x.id === f.fund)
  async function save() {
    const amount = Number(f.amount)
    if (!(amount > 0)) return showToast('Enter the amount spent', 'red')
    if (!f.what.trim()) return showToast('Say what it was for', 'red')
    if (fund && amount > Number(fund.balance)) return showToast(`Only $${money(fund.balance)} left in ${fund.name}`, 'red')
    setBusy(true)
    try {
      const receipt = f.file ? await uploadReceipt(f.file, currentSiteId, profile.id) : null
      const { error } = await supabase.rpc('petty_cash_record', { p_fund_id: f.fund, p_type: 'expense', p_amount: amount, p_description: f.what.trim(),
        p_category: f.category, p_date: today(), p_receipt_path: receipt, p_reference: null })
      if (error) throw error
      setDone(`$${money(amount)} for ${f.what.trim()} recorded`)
      setF(p => ({ ...p, amount: '', what: '', file: null }))
      load(); onSaved?.()
    } catch (e) { showToast(e.message, 'red') }
    setBusy(false)
  }
  const big = { ...finInput, width: '100%', minHeight: 52, fontSize: 18 }
  return (
    <section aria-label="Quick spend" style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Quick spend</h2>
        {fund && <span style={{ fontSize: 13, color: FIN.muted }}>{fund.name}: <b style={{ color: Number(fund.balance) < 50 ? FIN.bad : FIN.ink }}>${money(fund.balance)}</b> left</span>}
      </div>
      {funds.length > 1 && (
        <div role="radiogroup" aria-label="Fund" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {funds.map(x => (
            <button key={x.id} role="radio" aria-checked={f.fund === x.id} onClick={() => setF({ ...f, fund: x.id })}
              style={{ minHeight: 44, padding: '0 14px', borderRadius: 22, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
                ...(f.fund === x.id ? { border: 'none', background: FIN.maroon, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{x.name}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Amount (USD)</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} placeholder="0.00" style={big} /></label>
        <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>What for</span>
          <input value={f.what} onChange={e => setF({ ...f, what: e.target.value })} placeholder="e.g. bread for the canteen" style={big} /></label>
      </div>
      <div role="radiogroup" aria-label="Category" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {EXPENSE_CATEGORIES.map(([k, l]) => (
          <button key={k} role="radio" aria-checked={f.category === k} onClick={() => setF({ ...f, category: k })}
            style={{ minHeight: 36, padding: '0 12px', borderRadius: 18, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              ...(f.category === k ? { border: `1px solid ${FIN.ink}`, background: FIN.ink, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{l}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ flex: '1 1 200px', minHeight: 48, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', border: `1px dashed ${FIN.field}`, borderRadius: 10, cursor: 'pointer', fontSize: 14, color: f.file ? FIN.good : FIN.muted }}>
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={e => setF({ ...f, file: e.target.files?.[0] || null })} style={{ display: 'none' }} />
          {f.file ? `Slip attached: ${f.file.name}` : 'Photo of the slip (optional)'}
        </label>
        <button style={{ ...finBtn, minHeight: 52, fontSize: 16, flex: '1 1 160px' }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Record spend'}</button>
      </div>
      {done && <div role="status" style={{ fontSize: 13, color: FIN.good, fontWeight: 600 }}>✓ {done}</div>}
    </section>
  )
}
