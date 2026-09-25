import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { exportCsv } from '../../utils/csv'
import { FIN, finCard, finBtn, finBtn2, finInput, money, useFinanceFonts } from '../../utils/financeTheme'
const ProcInvoices = lazy(() => import('../procurement/ProcInvoices'))

// FI21 — Pay suppliers (Finance rewrite Phase 3, issue #49; migration 0204).
// Bills are recorded and approved in Procurement → Purchase Invoices (PR09). Here finance sees what is
// owed, checks the three-way match, groups approved bills into a payment run, approves it and marks it
// paid — which posts invoice_paid + IMTT to the ledger for every bill.
const MATCH = {
  matched:     { label: 'PO · GRN · bill match', color: FIN.good },
  price_diff:  { label: 'Price differs',        color: FIN.ochreText },
  qty_diff:    { label: 'Quantity differs',     color: FIN.ochreText },
  no_grn:      { label: 'Not received yet',      color: FIN.bad },
  service:     { label: 'No PO (service)',       color: FIN.muted },
  not_checked: { label: 'Not checked',           color: FIN.muted },
}
const RUN_STATUS = { draft: FIN.ochreText, approved: FIN.blue, paid: FIN.good, cancelled: FIN.muted }
const todayIso = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)

function dueLabel(b) {
  if (!b.due_date) return { text: '—', color: FIN.muted }
  const d = daysBetween(b.due_date, todayIso())
  if (b.status === 'paid') return { text: new Date(b.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), color: FIN.muted }
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} late`, color: FIN.bad, bold: true }
  if (d === 0) return { text: 'Due today', color: FIN.ochreText, bold: true }
  return { text: new Date(b.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), color: FIN.ink }
}

export default function PaySuppliers({ setPage, initialTab = 'to_pay' }) {
  useFinanceFonts()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [bills, setBills] = useState([])
  const [runs, setRuns] = useState([])
  const [banks, setBanks] = useState([])
  const [tax, setTax] = useState(null)
  const [rules, setRules] = useState({})
  const [tab, setTab] = useState(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  const [picked, setPicked] = useState(new Set())
  const [openBill, setOpenBill] = useState(null)
  const [runForm, setRunForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const [b, r, bk, tx, gr] = await Promise.all([
      supabase.from('purchase_invoices')
        .select('*, supplier:procurement_suppliers(supplier_name, bank_name, bank_branch, bank_account_number, payment_terms_days), po:purchase_orders(po_number), grn:goods_received_notes(grn_number, received_date), invoice_lines(item_description, quantity, unit_price), run:ap_payment_runs!purchase_invoices_payment_run_fkey(run_number, status)')
        .eq('site_id', currentSiteId).neq('status', 'cancelled').order('due_date', { ascending: true, nullsFirst: false }),
      supabase.from('ap_payment_runs').select('*, bank:bank_accounts(bank_name, account_name)').eq('site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }).limit(50),
      supabase.from('bank_accounts').select('id, bank_name, account_name').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('finance_tax_settings').select('imtt_enabled, imtt_rate, imtt_cap').eq('site_id', currentSiteId).maybeSingle(),
      supabase.from('gl_posting_rules').select('event_code, debit:accounts!gl_posting_rules_debit_account_id_fkey(code, name), credit:accounts!gl_posting_rules_credit_account_id_fkey(code, name)')
        .eq('site_id', currentSiteId).eq('is_archived', false).in('event_code', ['invoice_paid', 'imtt']),
    ])
    if (b.error) showToast(b.error.message, 'red')
    setBills(b.data || []); setRuns(r.data || []); setBanks(bk.data || []); setTax(tx.data)
    setRules(Object.fromEntries((gr.data || []).map(x => [x.event_code, x])))
    setLoading(false)
  }, [currentSiteId])
  useEffect(() => { load() }, [load])

  const imttOn = useCallback(amount => {
    if (tax && tax.imtt_enabled === false) return 0
    const v = Number(amount || 0) * Number(tax?.imtt_rate ?? 2) / 100
    return Math.round((tax?.imtt_cap ? Math.min(v, Number(tax.imtt_cap)) : v) * 100) / 100
  }, [tax])

  const inOpenRun = b => b.payment_run_id && b.run && b.run.status !== 'cancelled'
  const groups = useMemo(() => {
    const t = todayIso()
    const payable = bills.filter(b => b.status === 'approved' && !inOpenRun(b))
    return {
      to_pay: payable,
      overdue: payable.filter(b => b.due_date && b.due_date < t),
      mismatch: bills.filter(b => ['price_diff', 'qty_diff', 'no_grn'].includes(b.match_status) && b.status !== 'paid'),
      awaiting: bills.filter(b => ['draft', 'pending_approval'].includes(b.status)),
      in_run: bills.filter(b => b.status === 'approved' && inOpenRun(b)),
      paid: bills.filter(b => b.status === 'paid').reverse(),
    }
  }, [bills])
  const kpi = useMemo(() => {
    const t = todayIso(); const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    const open = bills.filter(b => ['approved', 'pending_approval', 'draft'].includes(b.status))
    const sum = arr => arr.reduce((s, b) => s + Number(b.total_amount || 0), 0)
    return { owed: sum(open), overdue: sum(open.filter(b => b.due_date && b.due_date < t)), week: sum(open.filter(b => b.due_date && b.due_date >= t && b.due_date <= in7)), mismatch: groups.mismatch.length }
  }, [bills, groups])

  const list = ['runs', 'statements'].includes(tab) ? [] : groups[tab] || []
  const pickedBills = bills.filter(b => picked.has(b.id))
  const pickedTotal = pickedBills.reduce((s, b) => s + Number(b.total_amount || 0), 0)
  const pickedImtt = pickedBills.reduce((s, b) => s + imttOn(b.total_amount), 0)
  const canPick = b => b.status === 'approved' && !inOpenRun(b) && (can('finance.create') || can('finance.edit'))
  const toggle = id => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function createRun() {
    setBusy(true)
    const { error } = await supabase.rpc('ap_run_create', { p_site: currentSiteId, p_invoice_ids: [...picked], p_pay_date: runForm.pay_date, p_bank_account: runForm.bank_account_id || null, p_notes: runForm.notes || null })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Payment run prepared — it now needs approval'); setPicked(new Set()); setRunForm(null); setTab('runs'); load()
  }
  async function runAction(run, action) {
    let args = { p_run: run.id }
    if (action === 'ap_run_mark_paid') {
      const ref = window.prompt(`Bank reference for ${run.run_number} (e.g. the transfer batch number):`, '')
      if (ref === null) return
      args = { ...args, p_payment_ref: ref }
    } else if (action === 'ap_run_cancel' && !window.confirm(`Cancel ${run.run_number}? Its bills go back to "To pay".`)) return
    else if (action === 'ap_run_approve' && !window.confirm(`Approve ${run.run_number} for $${money(run.total_amount)} + IMTT $${money(run.imtt_amount)}?`)) return
    setBusy(true)
    const { error } = await supabase.rpc(action, args)
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(action === 'ap_run_mark_paid' ? 'Paid — ledger updated for every bill' : action === 'ap_run_approve' ? 'Run approved' : 'Run cancelled'); load()
  }
  function exportRun(run) {
    const rows = bills.filter(b => b.payment_run_id === run.id).map(b => [
      b.supplier?.supplier_name || '', b.supplier?.bank_name || '', b.supplier?.bank_branch || '', b.supplier?.bank_account_number || '',
      Number(b.total_amount || 0).toFixed(2), `${run.run_number} ${b.invoice_number}`,
    ])
    exportCsv(`${run.run_number}-bank-payments.csv`, ['Supplier', 'Bank', 'Branch', 'Account number', 'Amount (USD)', 'Reference'], rows)
  }

  if (!can('finance.view') && !can('finance.edit')) return <Denied />

  const tabs = [
    ['to_pay', 'To pay', groups.to_pay.length, FIN.ink], ['overdue', 'Overdue', groups.overdue.length, FIN.bad],
    ['mismatch', "Doesn't match", groups.mismatch.length, FIN.ochreText], ['awaiting', 'Awaiting approval', groups.awaiting.length, FIN.ink],
    ['in_run', 'In a payment run', groups.in_run.length, FIN.ink], ['paid', 'Paid', null, FIN.ink], ['runs', 'Payment runs', runs.filter(r => ['draft', 'approved'].includes(r.status)).length, FIN.blue], ['statements', 'Supplier statements', null, FIN.ink],
    ['bills', 'Record & approve bills', null, FIN.blue], ['hq', 'Head office & sites', null, FIN.ink],
  ]
  const Kpi = ({ label, value, sub, color }) => (
    <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 13, color: FIN.muted }}>{label}</div>
      <div style={{ fontFamily: FIN.serif, fontSize: 28, fontWeight: 600, color: color || FIN.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FIN.muted }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{ fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px', minHeight: '100%', fontVariantNumeric: 'tabular-nums', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: FIN.muted }}>
            <button onClick={() => setPage('fi_dashboard')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Finance</button> · {currentSite?.name}
          </div>
          <h1 style={{ margin: '4px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 30 }}>Pay suppliers</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {can('procurement.create') && <button style={finBtn2} onClick={() => setPage('proc_invoices')}>Record a bill</button>}
          {picked.size > 0 && <button style={finBtn} onClick={() => setRunForm({ pay_date: todayIso(), bank_account_id: banks[0]?.id || '', notes: '' })}>
            Pay {picked.size} selected · ${money(pickedTotal + pickedImtt)}
          </button>}
        </div>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Kpi label="Owed to suppliers" value={`$${money(kpi.owed)}`} sub="Recorded bills not yet paid" />
        <Kpi label="Overdue" value={`$${money(kpi.overdue)}`} color={kpi.overdue ? FIN.bad : FIN.ink} sub={`${groups.overdue.length} approved bill${groups.overdue.length === 1 ? '' : 's'} past due`} />
        <Kpi label="Due in the next 7 days" value={`$${money(kpi.week)}`} />
        <Kpi label="Don't match" value={kpi.mismatch} color={kpi.mismatch ? FIN.ochreText : FIN.ink} sub="Price, quantity or not received" />
      </section>

      <div role="tablist" aria-label="Bills" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {tabs.map(([k, label, n, color]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            style={{ minHeight: 40, padding: '0 14px', borderRadius: 20, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              ...(tab === k ? { border: 'none', background: FIN.ink, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color }) }}>
            {label}{n != null ? ` · ${n}` : ''}
          </button>
        ))}
      </div>

      {tab === 'statements' && <SupplierStatements siteId={currentSiteId} />}
      {tab === 'bills' && <Suspense fallback={<div style={{ ...finCard, color: FIN.faint }}>Loading…</div>}><ProcInvoices setPage={setPage} /></Suspense>}
      {tab === 'hq' && <HeadOffice />}

      {!['runs', 'statements', 'bills', 'hq'].includes(tab) && (
        <section style={{ ...finCard, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 760 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1.6fr) minmax(0, 1fr) 110px 150px 120px', gap: 8, padding: '10px 16px', fontSize: 12, color: FIN.muted, background: '#F7F9F8' }}>
                <span /><span>Supplier · bill</span><span>For</span><span>Due</span><span>Match</span><span style={{ textAlign: 'right' }}>Amount</span>
              </div>
              {loading && <div style={{ padding: 20, color: FIN.muted, fontSize: 13 }}>Loading…</div>}
              {!loading && list.length === 0 && <div style={{ padding: 20, color: FIN.muted, fontSize: 13 }}>
                {tab === 'to_pay' ? 'Nothing approved and waiting to be paid. Bills are recorded and approved in the Record & approve bills tab.' : 'Nothing here.'}
              </div>}
              {list.map(b => {
                const due = dueLabel(b); const m = MATCH[b.match_status] || MATCH.not_checked; const sel = openBill?.id === b.id
                return (
                  <div key={b.id} style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1.6fr) minmax(0, 1fr) 110px 150px 120px', gap: 8, padding: '12px 16px', borderTop: `1px solid ${FIN.lineSoft}`, alignItems: 'center',
                    background: sel ? FIN.blueTint : 'transparent', boxShadow: sel ? `inset 3px 0 0 ${FIN.blue}` : 'none' }}>
                    <span>{canPick(b) && <input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} aria-label={`Select bill ${b.invoice_number}`} style={{ width: 18, height: 18, accentColor: FIN.maroon }} />}</span>
                    <button onClick={() => setOpenBill(b)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: FIN.ink }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{b.supplier?.supplier_name || 'Supplier'}</span>
                      <span style={{ fontSize: 12, color: FIN.muted }}>{b.invoice_number}{b.run && b.run.status !== 'cancelled' ? ` · in ${b.run.run_number}` : ''}{b.status === 'pending_approval' ? ' · awaiting approval' : b.status === 'draft' ? ' · draft' : ''}</span>
                    </button>
                    <span style={{ fontSize: 13, color: FIN.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.po?.po_number || b.invoice_lines?.[0]?.item_description || '—'}</span>
                    <span style={{ fontSize: 13, color: due.color, fontWeight: due.bold ? 600 : 400 }}>{due.text}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.label}{b.match_status === 'price_diff' ? ` (${b.match_diff > 0 ? '+' : ''}$${money(b.match_diff)})` : ''}</span>
                    <b style={{ textAlign: 'right', fontSize: 14 }}>${money(b.total_amount)}</b>
                  </div>
                )
              })}
              {picked.size > 0 && (
                <div style={{ padding: '12px 16px', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 12, color: FIN.muted, display: 'flex', justifyContent: 'flex-end', gap: 16 }}>
                  <span>Selected <b style={{ color: FIN.ink }}>${money(pickedTotal)}</b></span><span>+ IMTT <b style={{ color: FIN.ink }}>${money(pickedImtt)}</b></span>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'runs' && (
        <section style={{ ...finCard, padding: 0, overflow: 'hidden' }}>
          {runs.length === 0 && <div style={{ padding: 20, color: FIN.muted, fontSize: 13 }}>No payment runs yet. Tick approved bills under "To pay" and press Pay.</div>}
          {runs.map(r => (
            <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '14px 16px', borderTop: `1px solid ${FIN.lineSoft}` }}>
              <div style={{ flex: '1 1 220px' }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{r.run_number} <span style={{ fontSize: 12, fontWeight: 600, color: RUN_STATUS[r.status], marginLeft: 6, textTransform: 'capitalize' }}>{r.status}</span></div>
                <div style={{ fontSize: 12, color: FIN.muted }}>{r.bill_count} bill{r.bill_count === 1 ? '' : 's'} · pay on {r.pay_date}{r.bank ? ` · from ${r.bank.bank_name} ${r.bank.account_name}` : ''}{r.payment_ref ? ` · ref ${r.payment_ref}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right', minWidth: 150 }}><b style={{ fontSize: 15 }}>${money(r.total_amount)}</b><div style={{ fontSize: 12, color: FIN.muted }}>+ IMTT ${money(r.imtt_amount)}</div></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button style={{ ...finBtn2, minHeight: 36 }} onClick={() => exportRun(r)}>Bank list (CSV)</button>
                {r.status === 'draft' && can('finance.approve') && <button style={{ ...finBtn, minHeight: 36 }} disabled={busy} onClick={() => runAction(r, 'ap_run_approve')}>Approve</button>}
                {r.status === 'approved' && (can('finance.approve') || can('finance.edit')) && <button style={{ ...finBtn, minHeight: 36 }} disabled={busy} onClick={() => runAction(r, 'ap_run_mark_paid')}>Mark paid</button>}
                {['draft', 'approved'].includes(r.status) && (can('finance.approve') || can('finance.edit')) && <button style={{ ...finBtn2, minHeight: 36 }} disabled={busy} onClick={() => runAction(r, 'ap_run_cancel')}>Cancel</button>}
              </div>
            </div>
          ))}
        </section>
      )}

      {runForm && (
        <div role="dialog" aria-modal="true" aria-label="Prepare payment run" style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ ...finCard, width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>Prepare payment run</h2>
            <div style={{ fontSize: 14 }}>{picked.size} bill{picked.size === 1 ? '' : 's'} · <b>${money(pickedTotal)}</b> + IMTT ${money(pickedImtt)}</div>
            <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Pay on</span>
              <input type="date" value={runForm.pay_date} onChange={e => setRunForm({ ...runForm, pay_date: e.target.value })} style={{ ...finInput, width: '100%' }} /></label>
            <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>From bank account</span>
              <select value={runForm.bank_account_id} onChange={e => setRunForm({ ...runForm, bank_account_id: e.target.value })} style={{ ...finInput, width: '100%' }}>
                <option value="">Not specified</option>{banks.map(b => <option key={b.id} value={b.id}>{b.bank_name} · {b.account_name}</option>)}
              </select></label>
            <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Note (optional)</span>
              <input value={runForm.notes} onChange={e => setRunForm({ ...runForm, notes: e.target.value })} style={{ ...finInput, width: '100%' }} /></label>
            <div style={{ fontSize: 12, color: FIN.muted }}>The run then needs approval by someone with finance approval permission before it is paid.</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button style={finBtn2} onClick={() => setRunForm(null)}>Cancel</button>
              <button style={finBtn} disabled={busy} onClick={createRun}>Prepare run</button>
            </div>
          </div>
        </div>
      )}

      {openBill && <BillDrawer bill={openBill} rules={rules} imtt={imttOn(openBill.total_amount)} onClose={() => setOpenBill(null)}
        onPick={canPick(openBill) ? () => { toggle(openBill.id); setOpenBill(null) } : null} picked={picked.has(openBill.id)} setPage={setPage} />}
    </div>
  )
}

function BillDrawer({ bill: b, rules, imtt, onClose, onPick, picked, setPage }) {
  const m = MATCH[b.match_status] || MATCH.not_checked
  const billedQty = (b.invoice_lines || []).reduce((s, l) => s + Number(l.quantity || 0), 0)
  const box = ok => ({ border: `1px solid ${ok ? '#CFE3D6' : FIN.ochreLine}`, background: ok ? FIN.goodTint : FIN.ochreTint, borderRadius: 10, padding: '10px 12px', fontSize: 13 })
  const paidRule = rules.invoice_paid, imttRule = rules.imtt
  const acct = a => a ? `${a.code} ${a.name}` : 'No rule set'
  return (
    <aside aria-label="Bill details" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', background: '#fff', borderLeft: `1px solid ${FIN.field}`, boxShadow: '-12px 0 32px rgba(22,33,29,0.10)', zIndex: 900, overflowY: 'auto', padding: '24px 28px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 18, fontFamily: FIN.sans, color: FIN.ink, fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><div style={{ fontSize: 12, color: FIN.muted }}>Bill {b.invoice_number}</div>
          <h2 style={{ margin: '2px 0 0', fontFamily: FIN.serif, fontSize: 22, fontWeight: 600 }}>{b.supplier?.supplier_name}</h2></div>
        <button onClick={onClose} aria-label="Close details" style={{ width: 40, height: 40, borderRadius: 8, border: `1px solid ${FIN.line}`, background: '#fff', fontSize: 18, color: FIN.muted, cursor: 'pointer' }}>×</button>
      </div>
      <div style={{ fontFamily: FIN.serif, fontSize: 34, fontWeight: 600 }}>${money(b.total_amount)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 16px', fontSize: 13 }}>
        <div><div style={{ color: FIN.muted, fontSize: 12 }}>Due</div>{b.due_date || '—'}{b.supplier?.payment_terms_days != null ? ` · ${b.supplier.payment_terms_days} days` : ''}</div>
        <div><div style={{ color: FIN.muted, fontSize: 12 }}>Status</div><span style={{ textTransform: 'capitalize' }}>{String(b.status).replace('_', ' ')}</span></div>
        <div><div style={{ color: FIN.muted, fontSize: 12 }}>Invoice date</div>{b.invoice_date || '—'}</div>
        <div><div style={{ color: FIN.muted, fontSize: 12 }}>Pay to</div>{b.supplier?.bank_name ? `${b.supplier.bank_name} ${b.supplier.bank_account_number || ''}` : <span style={{ color: FIN.ochreText }}>No bank details</span>}</div>
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Three-way match · <span style={{ color: m.color }}>{m.label}</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
          <div style={box(!!b.po_id)}><div style={{ fontSize: 12, fontWeight: 600, color: b.po_id ? FIN.good : FIN.ochreText }}>Ordered {b.po_id ? '✓' : '—'}</div>{b.po?.po_number || 'No PO'}</div>
          <div style={box(!!b.grn_id)}><div style={{ fontSize: 12, fontWeight: 600, color: b.grn_id ? FIN.good : FIN.ochreText }}>Received {b.grn_id ? '✓' : '—'}</div>{b.grn?.grn_number || 'No GRN'}</div>
          <div style={box(b.match_status === 'matched' || b.match_status === 'service')}><div style={{ fontSize: 12, fontWeight: 600, color: b.match_status === 'matched' ? FIN.good : FIN.ochreText }}>Billed {b.match_status === 'matched' ? '✓' : '!'}</div>{billedQty ? `${billedQty} units` : b.invoice_number}</div>
        </div>
        {b.match_status === 'price_diff' && <div style={{ fontSize: 12, color: FIN.ochreText, marginTop: 6 }}>The bill is ${money(Math.abs(b.match_diff))} {b.match_diff > 0 ? 'more' : 'less'} than what was received at the PO price.</div>}
        {b.match_status === 'qty_diff' && <div style={{ fontSize: 12, color: FIN.ochreText, marginTop: 6 }}>The quantity billed differs from the quantity accepted on the GRN.</div>}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Ledger posting when paid</div>
        <div style={{ fontSize: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 90px', padding: '6px 0', color: FIN.muted, fontSize: 12 }}><span>Account</span><span style={{ textAlign: 'right' }}>Debit</span><span style={{ textAlign: 'right' }}>Credit</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 90px', padding: '6px 0', borderTop: `1px solid ${FIN.lineSoft}` }}><span>{acct(paidRule?.debit)}</span><span style={{ textAlign: 'right' }}>{money(b.total_amount)}</span><span /></div>
          {imtt > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 90px', padding: '6px 0', borderTop: `1px solid ${FIN.lineSoft}` }}><span>{acct(imttRule?.debit)}</span><span style={{ textAlign: 'right' }}>{money(imtt)}</span><span /></div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 90px', padding: '6px 0', borderTop: `1px solid ${FIN.lineSoft}` }}><span>{acct(paidRule?.credit)}</span><span /><span style={{ textAlign: 'right' }}>{money(Number(b.total_amount || 0) + imtt)}</span></div>
        </div>
      </div>
      {(b.invoice_lines || []).length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Lines</div>
          {b.invoice_lines.map((l, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '5px 0', borderTop: `1px solid ${FIN.lineSoft}` }}><span>{l.item_description} × {l.quantity}</span><span>${money(Number(l.quantity) * Number(l.unit_price))}</span></div>)}
        </div>
      )}
      <div style={{ marginTop: 'auto', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {onPick && <button style={{ ...finBtn, flexGrow: 1 }} onClick={onPick}>{picked ? 'Remove from payment' : 'Add to payment'}</button>}
        <button style={finBtn2} onClick={() => setPage('proc_invoices')}>Open in Procurement</button>
      </div>
    </aside>
  )
}

// Supplier statement reconciliation (0210): their statement balance vs what our books say we owe
// on that date. Tick our bills that appear on their statement; what is left over is what to query.
function SupplierStatements({ siteId }) {
  const { can } = usePermissions()
  const [suppliers, setSuppliers] = useState([])
  const [recs, setRecs] = useState([])
  const [f, setF] = useState({ supplier: '', date: todayIso(), balance: '' })
  const [pos, setPos] = useState(null)
  const [ticked, setTicked] = useState(new Set())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const loadRecs = useCallback(async () => {
    const { data } = await supabase.from('supplier_statement_recs').select('*, supplier:procurement_suppliers(supplier_name)')
      .eq('site_id', siteId).eq('is_archived', false).order('statement_date', { ascending: false }).limit(20)
    setRecs(data || [])
  }, [siteId])
  useEffect(() => {
    supabase.from('procurement_suppliers').select('id, supplier_name').eq('site_id', siteId).order('supplier_name').then(({ data }) => setSuppliers(data || []))
    loadRecs()
  }, [siteId, loadRecs])
  useEffect(() => {
    setPos(null)
    if (!f.supplier || !f.date) return
    supabase.rpc('ap_supplier_position', { p_site: siteId, p_supplier: f.supplier, p_date: f.date }).then(({ data, error }) => {
      if (error) return showToast(error.message, 'red')
      setPos(data); setTicked(new Set((data?.bills || []).map(b => b.id)))
    })
  }, [siteId, f.supplier, f.date])
  const books = Number(pos?.balance || 0)
  const theirs = f.balance === '' ? null : Number(f.balance)
  const notOnTheirs = (pos?.bills || []).filter(b => !ticked.has(b.id)).reduce((s, b) => s + Number(b.amount), 0)
  const diff = theirs == null ? null : Math.round((theirs - books) * 100) / 100
  const unexplained = theirs == null ? null : Math.round((theirs - (books - notOnTheirs)) * 100) / 100
  async function save(agreed) {
    if (theirs == null) return showToast("Enter the balance on the supplier's statement", 'red')
    setBusy(true)
    const { error } = await supabase.from('supplier_statement_recs').insert({ site_id: siteId, supplier_id: f.supplier, statement_date: f.date,
      statement_balance: theirs, books_balance: books, on_statement: [...ticked], notes: notes || null, status: agreed ? 'agreed' : 'open' })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(agreed ? 'Statement agreed' : 'Saved with differences to follow up'); setNotes(''); loadRecs()
  }
  const lbl = { display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      <section style={{ ...finCard, gridColumn: 'span 2', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div><h2 style={{ margin: 0, fontSize: 18 }}>Check a supplier statement</h2>
          <div style={{ fontSize: 13, color: FIN.muted }}>Enter the closing balance on their statement. Tick each of our bills that appears on it — the rest explains the difference.</div></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label><span style={lbl}>Supplier</span><select value={f.supplier} onChange={e => setF({ ...f, supplier: e.target.value })} style={{ ...finInput, width: '100%' }}>
            <option value="">Choose…</option>{suppliers.map(x => <option key={x.id} value={x.id}>{x.supplier_name}</option>)}</select></label>
          <label><span style={lbl}>Statement date</span><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} style={{ ...finInput, width: '100%' }} /></label>
          <label><span style={lbl}>Balance on their statement</span><input type="number" inputMode="decimal" step="0.01" value={f.balance} onChange={e => setF({ ...f, balance: e.target.value })} placeholder="0.00" style={{ ...finInput, width: '100%' }} /></label>
        </div>
        {pos && (<>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[["Their statement", theirs == null ? '—' : `$${money(theirs)}`, FIN.ink], ['Our books', `$${money(books)}`, FIN.ink],
              ['Difference', diff == null ? '—' : `$${money(diff)}`, diff ? FIN.ochreText : FIN.good], ['Still unexplained', unexplained == null ? '—' : `$${money(unexplained)}`, unexplained ? FIN.bad : FIN.good]].map(([l, v, c]) => (
              <div key={l} style={{ background: FIN.ground, borderRadius: 10, padding: '10px 12px' }}><div style={{ fontSize: 12, color: FIN.muted }}>{l}</div><div style={{ fontFamily: FIN.serif, fontSize: 22, fontWeight: 600, color: c }}>{v}</div></div>
            ))}
          </div>
          {Number(pos.paid_since) > 0 && <div style={{ fontSize: 12, color: FIN.muted }}>${money(pos.paid_since)} of these bills was paid after the statement date — their statement may not show those payments yet.</div>}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Our unpaid bills on {f.date} · tick if on their statement</div>
            {pos.bills.length === 0 && <div style={{ fontSize: 13, color: FIN.muted }}>We owed this supplier nothing on that date.</div>}
            {pos.bills.map(b => (
              <label key={b.id} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) 110px 120px', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={ticked.has(b.id)} onChange={() => setTicked(p => { const n = new Set(p); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n })} style={{ width: 18, height: 18, accentColor: FIN.maroon }} />
                <span>{b.invoice_number}{b.po ? ` · ${b.po}` : ''}<span style={{ display: 'block', fontSize: 11, color: FIN.muted }}>{b.status.replace('_', ' ')}</span></span>
                <span style={{ color: FIN.muted }}>{b.invoice_date}</span>
                <b style={{ textAlign: 'right', color: ticked.has(b.id) ? FIN.ink : FIN.ochreText }}>${money(b.amount)}</b>
              </label>
            ))}
          </div>
          {notOnTheirs > 0 && <div style={{ fontSize: 13, color: FIN.ochreText }}>${money(notOnTheirs)} of our bills is not on their statement — ask whether they received those invoices or have credited them.</div>}
          {unexplained != null && unexplained !== 0 && <div style={{ fontSize: 13, color: FIN.bad }}>${money(Math.abs(unexplained))} {unexplained > 0 ? 'more on their statement than we have — a bill we have not recorded, or a payment they have not applied' : 'less on their statement — a credit note or payment we have not recorded'}.</div>}
          {can('finance.edit') && <>
            <label><span style={lbl}>Notes (what to follow up)</span><input value={notes} onChange={e => setNotes(e.target.value)} style={{ ...finInput, width: '100%' }} /></label>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button style={finBtn2} disabled={busy} onClick={() => save(false)}>Save — follow up differences</button>
              <button style={finBtn} disabled={busy || unexplained !== 0} onClick={() => save(true)}>Agree statement</button>
            </div>
          </>}
        </>)}
      </section>
      <section style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Recent statement checks</h2>
        {recs.length === 0 && <div style={{ fontSize: 13, color: FIN.muted }}>None yet.</div>}
        {recs.map(r => (
          <div key={r.id} style={{ padding: '8px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{r.supplier?.supplier_name}</b>
              <span style={{ fontSize: 12, fontWeight: 600, color: r.status === 'agreed' ? FIN.good : FIN.ochreText }}>{r.status === 'agreed' ? 'Agreed' : 'Follow up'}</span></div>
            <div style={{ color: FIN.muted, fontSize: 12 }}>{r.statement_date} · theirs ${money(r.statement_balance)} · ours ${money(r.books_balance)}{Number(r.difference) ? ` · diff $${money(r.difference)}` : ''}</div>
            {r.notes && <div style={{ fontSize: 12 }}>{r.notes}</div>}
          </div>
        ))}
      </section>
    </div>
  )
}

// Head office & sites (#56): who pays for each site, and what each site owes head office (account 2500).
function HeadOffice() {
  const { can } = usePermissions()
  const { accessibleSites } = useSite()
  const [rows, setRows] = useState(null)
  const load = useCallback(() => supabase.rpc('fin_intersite_balances').then(({ data, error }) => { if (error) showToast(error.message, 'red'); setRows(data || []) }), [])
  useEffect(() => { load() }, [load])
  async function setFunder(site, funder) {
    const { error } = await supabase.rpc('finance_set_funded_by', { p_site: site, p_funder: funder || null })
    if (error) return showToast(error.message, 'red')
    showToast('Saved'); load()
  }
  if (!rows) return <div style={{ ...finCard, color: FIN.faint }}>Loading…</div>
  return (
    <section style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13.5, color: FIN.muted, maxWidth: 760 }}>
        When head office pays a site's bill or tops up its petty cash, the site's books show the cost and an amount <b>owed to head office</b>;
        head office's books show the bank payment and an amount <b>owed by the site</b> (account 2500). Head office postings are skipped until
        head office has its own books set up in Set Up the Books.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead><tr style={{ textAlign: 'left', color: FIN.muted, fontSize: 12 }}>
            <th style={{ padding: '8px 6px' }}>Site</th><th style={{ padding: '8px 6px' }}>Bills and petty cash paid by</th>
            <th style={{ padding: '8px 6px', textAlign: 'right' }}>2500 balance</th><th style={{ padding: '8px 6px' }}>Books</th>
          </tr></thead>
          <tbody>{rows.map(r => {
            const bal = Number(r.balance)
            return (
              <tr key={r.site_id} style={{ borderTop: `1px solid ${FIN.lineSoft}` }}>
                <td style={{ padding: '8px 6px', fontWeight: 600 }}>{r.site}{r.site_type === 'head_office' && <span style={{ fontSize: 11, color: FIN.faint, marginLeft: 6 }}>head office</span>}</td>
                <td style={{ padding: '8px 6px' }}>
                  {r.site_type === 'head_office' ? '—' : (
                    <select disabled={!can('finance.approve')} value={r.funded_by_site_id || ''} onChange={e => setFunder(r.site_id, e.target.value)} style={finInput}>
                      <option value="">The site itself</option>
                      {(accessibleSites || []).filter(s => s.id !== r.site_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}
                </td>
                <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: bal > 0 ? FIN.ink : FIN.muted }}>
                  {bal === 0 ? '—' : bal > 0 ? `owes HQ $${money(bal)}` : `owed $${money(-bal)}`}
                </td>
                <td style={{ padding: '8px 6px', fontSize: 12.5, color: r.has_books ? FIN.good : FIN.ochreText }}>{r.has_books ? 'Set up' : 'Not set up yet'}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </section>
  )
}
