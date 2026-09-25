import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, money, useFinanceFonts } from '../../utils/financeTheme'
import { EVENTS } from './PostingRules'

// FI20 — "Set up the books" (Finance rewrite Phase 2, issue #49; migration 0202).
// Six steps; the database does the work (finance_setup_* RPCs) and reports progress.
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const STEPS = [
  { key: 'company', title: 'Company & year', hint: 'Financial year and the site these books are for' },
  { key: 'coa',     title: 'Chart of accounts', hint: 'Mining template — costs only, no sales or VAT' },
  { key: 'rules',   title: 'Posting rules', hint: 'Which accounts fuel, GRNs, payroll and assets post to' },
  { key: 'opening', title: 'Opening balances', hint: 'Bank, stock, suppliers owed and assets on day one' },
  { key: 'banks',   title: 'Bank accounts', hint: 'Link each bank account to its ledger account' },
  { key: 'live',    title: 'Review & go live', hint: 'Automatic postings start from the go-live date' },
]
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)

export default function FinanceSetup({ setPage }) {
  useFinanceFonts()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const canEdit = can('finance.edit')
  const [status, setStatus] = useState(null)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.rpc('finance_setup_status', { p_site: currentSiteId })
    if (error) { showToast(error.message, 'red'); return }
    setStatus(data)
    return data
  }, [currentSiteId])

  // Open on the first step that still needs doing.
  useEffect(() => {
    loadStatus().then(s => {
      if (!s) return
      const firstOpen = [s.company_done, s.accounts > 0, s.rules >= s.events, !!s.opening_journal_id, s.bank_accounts > 0, !!s.go_live_date].indexOf(false)
      setStep(firstOpen === -1 ? 5 : firstOpen)
    })
  }, [loadStatus])

  if (!can('finance.view') && !canEdit) return <Denied />
  if (!status) return <div style={{ padding: 48, color: FIN.muted, fontFamily: FIN.sans }}>Loading…</div>

  const done = [status.company_done, status.accounts > 0, status.rules >= status.events,
    !!status.opening_journal_id, status.bank_accounts > 0, !!status.go_live_date]
  const doneCount = done.filter(Boolean).length
  const next = () => { loadStatus(); setStep(s => Math.min(s + 1, 5)) }
  const props = { siteId: currentSiteId, status, canEdit, busy, setBusy, next, reload: loadStatus, setPage }

  return (
    <div style={{ fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px', minHeight: '100%', fontVariantNumeric: 'tabular-nums' }}>
      <div style={{ fontSize: 13, color: FIN.muted }}>
        <button onClick={() => setPage('fi_dashboard')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Finance</button> · {currentSite?.name || 'Site'}
      </div>
      <h1 style={{ margin: '4px 0 20px', fontFamily: FIN.serif, fontWeight: 600, fontSize: 30 }}>
        {status.go_live_date ? 'The books are live' : 'Set up the books'}
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, alignItems: 'start' }}>
        <section style={{ ...finCard, maxWidth: 360 }} aria-label="Setup steps">
          <div style={{ fontSize: 13, color: FIN.muted, marginBottom: 6 }}>{doneCount} of 6 steps done</div>
          <div style={{ height: 6, background: FIN.lineSoft, borderRadius: 3, marginBottom: 10 }}>
            <div style={{ width: `${(doneCount / 6) * 100}%`, height: 6, background: FIN.maroon, borderRadius: 3 }} />
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
            {STEPS.map((s, i) => {
              const active = i === step
              return (
                <li key={s.key}>
                  <button onClick={() => setStep(i)} aria-current={active ? 'step' : undefined}
                    style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', padding: 12, borderRadius: 10, border: 'none', textAlign: 'left',
                      background: active ? FIN.maroonTint : 'transparent', cursor: 'pointer', fontFamily: 'inherit', color: FIN.ink }}>
                    <span style={{ width: 28, height: 28, borderRadius: 14, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
                      ...(done[i] ? { background: FIN.good, color: '#fff' } : active ? { background: FIN.maroon, color: '#fff' } : { background: '#fff', color: FIN.muted, border: `1px solid ${FIN.field}` }) }}>
                      {done[i] ? '✓' : i + 1}
                    </span>
                    <span>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{s.title}</span>
                      <span style={{ fontSize: 12, color: FIN.muted }}>{s.hint}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>

        <section style={{ ...finCard, gridColumn: 'span 2', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!canEdit && <Note tone="warn">You can view the setup but need finance edit permission to change it.</Note>}
          {step === 0 && <CompanyStep {...props} />}
          {step === 1 && <CoaStep {...props} />}
          {step === 2 && <RulesStep {...props} />}
          {step === 3 && <OpeningStep {...props} />}
          {step === 4 && <BanksStep {...props} />}
          {step === 5 && <LiveStep {...props} done={done} goTo={setStep} canApprove={can('finance.approve')} />}
        </section>
      </div>
    </div>
  )
}

function StepHead({ title, children }) {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{title}</h2>
      {children && <div style={{ fontSize: 14, color: FIN.muted, marginTop: 4, maxWidth: 720 }}>{children}</div>}
    </div>
  )
}
function Note({ tone = 'info', children }) {
  const c = tone === 'warn' ? { bg: FIN.ochreTint, bd: FIN.ochreLine, fg: '#6B4208' } : tone === 'good' ? { bg: FIN.goodTint, bd: '#CFE3D6', fg: FIN.good } : { bg: FIN.blueTint, bd: '#C9D8EC', fg: FIN.blue }
  return <div style={{ background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>{children}</div>
}
function Footer({ children }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center', borderTop: `1px solid ${FIN.lineSoft}`, paddingTop: 14, flexWrap: 'wrap' }}>{children}</div>
}

// ── Step 1 ────────────────────────────────────────────────────────────────
function CompanyStep({ siteId, status, canEdit, busy, setBusy, next }) {
  const { currentSite } = useSite()
  const [fy, setFy] = useState(status.financial_year_start || 1)
  async function save() {
    setBusy(true)
    const { error } = await supabase.from('finance_setup').upsert({ site_id: siteId, financial_year_start: Number(fy), updated_at: new Date().toISOString() }, { onConflict: 'site_id' })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    next()
  }
  return (<>
    <StepHead title="Company & financial year">These books are kept per site. Bravura only buys, so every figure is USD and there are no sales or VAT accounts.</StepHead>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
      <div><div style={{ fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Site</div><div style={{ fontSize: 15, fontWeight: 600 }}>{currentSite?.name}</div></div>
      <div><div style={{ fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Currency</div><div style={{ fontSize: 15, fontWeight: 600 }}>USD</div></div>
      <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Financial year starts in</span>
        <select value={fy} onChange={e => setFy(e.target.value)} disabled={!canEdit || !!status.go_live_date} style={{ ...finInput, width: '100%' }}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select></label>
    </div>
    <Footer>{canEdit && !status.go_live_date && <button style={finBtn} disabled={busy} onClick={save}>Save and continue</button>}</Footer>
  </>)
}

// ── Step 2 ────────────────────────────────────────────────────────────────
function CoaStep({ siteId, canEdit, busy, setBusy, next }) {
  const [tpl, setTpl] = useState([])
  const [existing, setExisting] = useState(new Set())
  const [ticked, setTicked] = useState(new Set())
  const [open, setOpen] = useState(new Set(['1000', '2000', '3000', '6000']))
  useEffect(() => {
    Promise.all([supabase.rpc('finance_coa_template'), supabase.from('accounts').select('code').eq('site_id', siteId).eq('is_archived', false)])
      .then(([t, a]) => {
        const rows = t.data || []
        const have = new Set((a.data || []).map(x => x.code))
        setTpl(rows); setExisting(have)
        setTicked(new Set(rows.filter(r => !r.is_group).map(r => r.code)))
      })
  }, [siteId])
  const children = useMemo(() => {
    const m = {}; tpl.forEach(r => { (m[r.parent_code || 'root'] ||= []).push(r) }); return m
  }, [tpl])
  const leafCount = tpl.filter(r => !r.is_group).length
  const toggle = code => setTicked(prev => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n })
  async function apply() {
    setBusy(true)
    const { data, error } = await supabase.rpc('finance_setup_apply_template', { p_site: siteId, p_codes: [...ticked] })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(data ? `${data} accounts created` : 'Chart of accounts already in place')
    next()
  }
  function Row({ r, depth }) {
    const kids = children[r.code] || []
    const isOpen = open.has(r.code)
    return (<>
      <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr) 130px 64px', gap: 10, padding: '8px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 13, alignItems: 'center' }}>
        <span style={{ color: FIN.muted }}>{r.code}</span>
        <span style={{ paddingLeft: depth * 20, fontWeight: r.is_group ? 600 : 400 }}>
          {r.is_group
            ? <button onClick={() => setOpen(p => { const n = new Set(p); n.has(r.code) ? n.delete(r.code) : n.add(r.code); return n })} aria-expanded={isOpen}
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', fontWeight: 600, color: FIN.ink, cursor: 'pointer' }}>{isOpen ? '▾' : '▸'} {r.name}</button>
            : <>{r.name}{r.note && <span style={{ display: 'block', fontSize: 11, color: FIN.faint }}>{r.note}</span>}</>}
        </span>
        <span style={{ fontSize: 12, color: FIN.muted }}>{r.is_group ? '' : r.sub_type}</span>
        <span style={{ justifySelf: 'end', fontSize: 11, color: FIN.good }}>
          {existing.has(r.code) ? 'In use' : !r.is_group &&
            <input type="checkbox" checked={ticked.has(r.code)} onChange={() => toggle(r.code)} disabled={!canEdit} aria-label={`Use ${r.name}`}
              style={{ width: 18, height: 18, accentColor: FIN.maroon }} />}
        </span>
      </div>
      {r.is_group && isOpen && kids.map(k => <Row key={k.code} r={k} depth={depth + 1} />)}
    </>)
  }
  return (<>
    <StepHead title="Chart of accounts">Start from the mining template and untick anything Bravura doesn't use. You can rename or add accounts later under Chart of Accounts.</StepHead>
    {existing.size > 0 && <Note tone="good">{existing.size} accounts already exist for this site. Ticking more adds them; nothing is removed.</Note>}
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr) 130px 64px', gap: 10, padding: '6px 0', fontSize: 12, color: FIN.muted }}>
        <span>Code</span><span>Account</span><span>Type</span><span style={{ textAlign: 'right' }}>Use</span>
      </div>
      {(children.root || []).map(r => <Row key={r.code} r={r} depth={0} />)}
    </div>
    <Footer>
      <span style={{ fontSize: 12, color: FIN.muted }}>{ticked.size} of {leafCount} accounts ticked</span>
      {canEdit && <button style={finBtn} disabled={busy} onClick={apply}>{busy ? 'Creating…' : 'Create accounts and continue'}</button>}
    </Footer>
  </>)
}

// ── Step 3 ────────────────────────────────────────────────────────────────
function RulesStep({ siteId, status, canEdit, busy, setBusy, next, reload, setPage }) {
  const [rules, setRules] = useState([])
  const load = useCallback(async () => {
    const { data } = await supabase.from('gl_posting_rules')
      .select('event_code, debit:accounts!gl_posting_rules_debit_account_id_fkey(code, name), credit:accounts!gl_posting_rules_credit_account_id_fkey(code, name)')
      .eq('site_id', siteId).eq('is_archived', false)
    setRules(data || [])
  }, [siteId])
  useEffect(() => { load() }, [load])
  const byCode = Object.fromEntries(rules.map(r => [r.event_code, r]))
  async function suggest() {
    setBusy(true)
    const { data, error } = await supabase.rpc('finance_setup_suggest_rules', { p_site: siteId })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(`${data} rules filled in`); load(); reload()
  }
  const missing = EVENTS.filter(e => !byCode[e.code]).length
  return (<>
    <StepHead title="Posting rules">Every time something happens in the ERP — fuel issued, goods received, payroll approved — it posts to the ledger using these rules.</StepHead>
    {status.accounts === 0 && <Note tone="warn">Create the chart of accounts first.</Note>}
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {canEdit && missing > 0 && status.accounts > 0 && <button style={finBtn} disabled={busy} onClick={suggest}>Fill in the {missing} missing rules</button>}
      <button style={finBtn2} onClick={() => setPage('fi_posting_rules')}>Change a rule</button>
      <span style={{ fontSize: 13, color: missing ? FIN.ochreText : FIN.good, fontWeight: 600 }}>{EVENTS.length - missing} of {EVENTS.length} events covered</span>
    </div>
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 640 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 10, padding: '6px 0', fontSize: 12, color: FIN.muted }}>
          <span>When this happens</span><span>Debit</span><span>Credit</span>
        </div>
        {EVENTS.map(e => {
          const r = byCode[e.code]
          return (
            <div key={e.code} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 10, padding: '8px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 13 }}>
              <span><span style={{ fontSize: 11, color: FIN.faint, display: 'block' }}>{e.group}</span>{e.label}</span>
              <span style={{ color: r ? FIN.ink : FIN.ochreText }}>{r?.debit ? `${r.debit.code} ${r.debit.name}` : 'Not set'}</span>
              <span style={{ color: r ? FIN.ink : FIN.ochreText }}>{r?.credit ? `${r.credit.code} ${r.credit.name}` : 'Not set'}</span>
            </div>
          )
        })}
      </div>
    </div>
    <Footer><button style={finBtn} onClick={next}>Continue</button></Footer>
  </>)
}

// ── Step 4 ────────────────────────────────────────────────────────────────
function OpeningStep({ siteId, status, canEdit, busy, setBusy, next, reload, setPage }) {
  const { can } = usePermissions()
  const [mock, setMock] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [amounts, setAmounts] = useState({})
  const [date, setDate] = useState(yesterday())
  useEffect(() => {
    supabase.from('accounts').select('id, code, name, account_type, sub_type').eq('site_id', siteId).eq('is_archived', false)
      .in('account_type', ['Asset', 'Liability', 'Equity']).neq('sub_type', 'Group').neq('code', '3900').order('code')
      .then(({ data }) => setAccounts(data || []))
  }, [siteId])
  // Assets are normally debits; liabilities, equity and accumulated depreciation normally credits.
  const isCredit = a => a.account_type !== 'Asset' || a.sub_type === 'Contra asset'
  const totals = accounts.reduce((t, a) => {
    const v = Number(amounts[a.id] || 0); if (isCredit(a)) t.cr += v; else t.dr += v; return t
  }, { dr: 0, cr: 0 })
  const diff = Math.round((totals.dr - totals.cr) * 100) / 100
  async function post() {
    const lines = accounts.filter(a => Number(amounts[a.id]) > 0).map(a => ({ account_id: a.id, debit: isCredit(a) ? 0 : Number(amounts[a.id]), credit: isCredit(a) ? Number(amounts[a.id]) : 0 }))
    if (!lines.length) return showToast('Enter at least one balance', 'red')
    if (!window.confirm(`Post opening balances dated ${date}? They can't be edited afterwards — corrections are made with a journal entry.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('finance_setup_opening_balances', { p_site: siteId, p_date: date, p_lines: lines, p_mock: mock })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Opening balances posted'); next()
  }
  async function clearMock() {
    if (!window.confirm('Clear the MOCK opening balances? The mock journal is voided (kept for the record) and account balances go back to zero, so the real figures can be entered.')) return
    setBusy(true)
    const { error } = await supabase.rpc('finance_setup_clear_mock_opening', { p_site: siteId })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Mock opening balances cleared'); reload()
  }
  if (status.opening_journal_id) return (<>
    <StepHead title="Opening balances" />
    {status.opening_is_mock
      ? <Note tone="warn"><b>MOCK opening balances</b> (test figures, as at {status.opening_date}). Clear them before entering the real figures and going live.</Note>
      : <Note tone="good">Opening balances were posted on {status.opening_date}. To correct them, post a journal entry.</Note>}
    <Footer>
      {status.opening_is_mock && can('finance.approve') && <button style={{ ...finBtn2, color: FIN.bad, borderColor: FIN.bad }} disabled={busy} onClick={clearMock}>Clear mock balances</button>}
      <button style={finBtn2} onClick={() => setPage('fi_journal_detail:' + status.opening_journal_id)}>View the opening journal</button>
      <button style={finBtn} onClick={next}>Continue</button>
    </Footer>
  </>)
  const groups = [['Asset', 'What the site owns'], ['Liability', 'What the site owes'], ['Equity', 'Funding']]
  return (<>
    <StepHead title="Opening balances">Enter what each account held at the end of the day before the books start. Leave blank anything that was zero. The difference goes to 3900 Opening balance equity.</StepHead>
    {status.accounts === 0 && <Note tone="warn">Create the chart of accounts first.</Note>}
    <label style={{ maxWidth: 260 }}><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Balances as at</span>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...finInput, width: '100%' }} /></label>
    {groups.map(([type, label]) => {
      const rows = accounts.filter(a => a.account_type === type)
      if (!rows.length) return null
      return (
        <div key={type}>
          <div style={{ fontSize: 12, fontWeight: 600, color: FIN.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '6px 0' }}>{label}</div>
          {rows.map(a => (
            <label key={a.id} style={{ display: 'grid', gridTemplateColumns: '60px minmax(0, 1fr) 70px 170px', gap: 10, padding: '6px 0', borderTop: `1px solid ${FIN.lineSoft}`, alignItems: 'center', fontSize: 13 }}>
              <span style={{ color: FIN.muted }}>{a.code}</span><span>{a.name}</span>
              <span style={{ fontSize: 11, color: FIN.faint }}>{isCredit(a) ? 'Credit' : 'Debit'}</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={amounts[a.id] || ''} disabled={!canEdit}
                onChange={e => setAmounts(p => ({ ...p, [a.id]: e.target.value }))} placeholder="0.00" style={{ ...finInput, textAlign: 'right' }} />
            </label>
          ))}
        </div>
      )
    })}
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 14, background: FIN.ground, borderRadius: 10, padding: '12px 14px' }}>
      <span>Debits <b>${money(totals.dr)}</b></span><span>Credits <b>${money(totals.cr)}</b></span>
      <span style={{ color: diff ? FIN.ochreText : FIN.good }}>Opening balance equity {diff === 0 ? 'not needed' : <b>${money(Math.abs(diff))} {diff > 0 ? 'credit' : 'debit'}</b>}</span>
    </div>
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: FIN.muted }}>
      <input type="checkbox" checked={mock} onChange={e => setMock(e.target.checked)} style={{ width: 18, height: 18, accentColor: FIN.maroon }} />
      These are MOCK figures for testing (they can be cleared later)
    </label>
    <Footer>
      <button style={finBtn2} onClick={next}>Skip for now</button>
      {canEdit && <button style={finBtn} disabled={busy} onClick={post}>Post opening balances</button>}
    </Footer>
  </>)
}

// ── Step 5 ────────────────────────────────────────────────────────────────
function BanksStep({ siteId, canEdit, busy, setBusy, next, reload }) {
  const { can } = usePermissions()
  const [banks, setBanks] = useState([])
  const [gl, setGl] = useState([])
  const [form, setForm] = useState({ bank_name: '', account_name: '', account_number: '', branch: '', gl_account_id: '' })
  const load = useCallback(async () => {
    const [b, a] = await Promise.all([
      supabase.from('bank_accounts').select('id, bank_name, account_name, account_number, gl_account_id, gl:accounts!bank_accounts_gl_account_id_fkey(code, name)').eq('site_id', siteId).eq('is_archived', false),
      supabase.from('accounts').select('id, code, name').eq('site_id', siteId).eq('is_archived', false).in('sub_type', ['Bank', 'Cash']).order('code'),
    ])
    setBanks(b.data || []); setGl(a.data || [])
  }, [siteId])
  useEffect(() => { load() }, [load])
  async function add() {
    if (!form.bank_name.trim() || !form.account_name.trim() || !form.gl_account_id) return showToast('Enter the bank, account name and ledger account', 'red')
    setBusy(true)
    const { error } = await supabase.from('bank_accounts').insert({ ...form, site_id: siteId, currency: 'USD', is_active: true, is_archived: false })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    setForm({ bank_name: '', account_name: '', account_number: '', branch: '', gl_account_id: '' }); load(); reload()
  }
  async function link(id, glId) {
    const { error } = await supabase.from('bank_accounts').update({ gl_account_id: glId || null }).eq('id', id).eq('site_id', siteId)
    if (error) return showToast(error.message, 'red')
    load(); reload()
  }
  const lbl = { display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }
  return (<>
    <StepHead title="Bank accounts">Each bank account needs a ledger account so payments, statement imports and reconciliation post to the right place.</StepHead>
    {banks.map(b => (
      <div key={b.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(200px, 280px)', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${FIN.lineSoft}` }}>
        <div><div style={{ fontWeight: 600, fontSize: 14 }}>{b.bank_name} · {b.account_name}</div><div style={{ fontSize: 12, color: FIN.muted }}>{b.account_number || 'No number'}</div></div>
        <select aria-label={`Ledger account for ${b.account_name}`} value={b.gl_account_id || ''} disabled={!can('finance.edit')} onChange={e => link(b.id, e.target.value)} style={{ ...finInput, borderColor: b.gl_account_id ? FIN.field : FIN.ochre }}>
          <option value="">Choose a ledger account…</option>
          {gl.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
        </select>
      </div>
    ))}
    {banks.length === 0 && <div style={{ fontSize: 13, color: FIN.muted }}>No bank accounts yet.</div>}
    {can('finance.create') && (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, background: FIN.ground, borderRadius: 10, padding: 14, alignItems: 'end' }}>
        <label><span style={lbl}>Bank</span><input style={{ ...finInput, width: '100%' }} value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="e.g. CBZ" /></label>
        <label><span style={lbl}>Account name</span><input style={{ ...finInput, width: '100%' }} value={form.account_name} onChange={e => setForm({ ...form, account_name: e.target.value })} placeholder="e.g. Kamativi operations" /></label>
        <label><span style={lbl}>Account number</span><input style={{ ...finInput, width: '100%' }} value={form.account_number} onChange={e => setForm({ ...form, account_number: e.target.value })} /></label>
        <label><span style={lbl}>Ledger account</span>
          <select style={{ ...finInput, width: '100%' }} value={form.gl_account_id} onChange={e => setForm({ ...form, gl_account_id: e.target.value })}>
            <option value="">Choose…</option>{gl.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
          </select></label>
        <button style={finBtn} disabled={busy} onClick={add}>Add bank account</button>
      </div>
    )}
    <Footer><button style={canEdit ? finBtn : finBtn2} onClick={next}>Continue</button></Footer>
  </>)
}

// ── Step 6 ────────────────────────────────────────────────────────────────
function LiveStep({ siteId, status, done, goTo, canApprove, busy, setBusy, reload, setPage }) {
  const [date, setDate] = useState(status.opening_date ? (() => { const d = new Date(status.opening_date); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10) })() : today())
  async function goLive() {
    if (!window.confirm(`Go live on ${date}? From this date every approved fuel issue, GRN, payroll run and payment posts to the ledger automatically. Anything dated earlier is treated as covered by the opening balances.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('finance_setup_go_live', { p_site: siteId, p_date: date })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('The books are live'); reload()
  }
  const checks = [
    ['Chart of accounts', `${status.accounts} accounts`, done[1], 1],
    ['Posting rules', `${status.rules} of ${status.events} events`, done[2], 2],
    ['Opening balances', status.opening_date ? `${status.opening_is_mock ? 'MOCK figures — clear before going live · ' : ''}Posted as at ${status.opening_date}` : 'Not entered — everything starts at zero', done[3] && !status.opening_is_mock, 3],
    ['Bank accounts', `${status.bank_accounts} linked`, done[4], 4],
  ]
  if (status.go_live_date) return (<>
    <StepHead title="The books are live" />
    <Note tone="good">Automatic postings started on {status.go_live_date}. Postings dated earlier are skipped because the opening balances cover them.</Note>
    {status.skipped_postings > 0 && <Note tone="warn">{status.skipped_postings} postings are waiting — usually a missing rule. Review them under Posting Rules.</Note>}
    <Footer>
      <button style={finBtn2} onClick={() => setPage('fi_posting_rules')}>Posting rules & log</button>
      <button style={finBtn} onClick={() => setPage('fi_dashboard')}>Go to Finance</button>
    </Footer>
  </>)
  return (<>
    <StepHead title="Review & go live">Check each step, then choose the go-live date. This needs finance approval permission.</StepHead>
    <div>
      {checks.map(([t, d, ok, i]) => (
        <div key={t} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: `1px solid ${FIN.lineSoft}` }}>
          <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, background: ok ? FIN.good : FIN.ochre, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ok ? '✓' : '!'}</span>
          <span><b style={{ fontSize: 14 }}>{t}</b><span style={{ display: 'block', fontSize: 12, color: FIN.muted }}>{d}</span></span>
          {!ok && <button onClick={() => goTo(i)} style={{ background: 'none', border: 'none', color: FIN.blue, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600 }}>Fix</button>}
        </div>
      ))}
    </div>
    {!done[1] && <Note tone="warn">The chart of accounts is required before going live.</Note>}
    <label style={{ maxWidth: 260 }}><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Go-live date</span>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...finInput, width: '100%' }} /></label>
    <Footer>
      {!canApprove && <span style={{ fontSize: 12, color: FIN.muted }}>Ask someone with finance approval permission to go live.</span>}
      {canApprove && <button style={finBtn} disabled={busy || !done[1]} onClick={goLive}>Go live on {date}</button>}
    </Footer>
  </>)
}
