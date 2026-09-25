import { useState, useEffect, useCallback, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, money, useFinanceFonts } from '../../utils/financeTheme'

// FI23 — Bank & cash (Finance rewrite Phase 5, issue #49; migration 0208).
// Import a bank statement (CSV / Excel) → lines are matched automatically to posted journals
// (same amount, ±5 days) or to rules ("contains ZESA → Electricity") → confirm with one click,
// or find a journal / post to an account yourself. Rules learn from what you post.
const STATUS = { suggested: ['Suggested', FIN.ochreText], unmatched: ['Unmatched', FIN.bad], matched: ['Matched', FIN.good] }
const FIELDS = [['date', 'Date', true], ['description', 'Description', true], ['reference', 'Reference', false],
  ['amount', 'Amount (money in +, out −)', false], ['debit', 'Money out (debit)', false], ['credit', 'Money in (credit)', false], ['balance', 'Balance', false]]

// Accepts 2026-09-25, 25/09/2026, 25-09-26, 25 Sep 2026, Excel serial numbers.
function toIsoDate(v, dayFirst) {
  if (v == null || v === '') return null
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null }
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/)
  if (m) {
    const [a, b] = dayFirst ? [m[1], m[2]] : [m[2], m[1]]
    const y = m[3].length === 2 ? `20${m[3]}` : m[3]
    return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
  }
  const d = new Date(s)
  return isNaN(d) ? null : d.toISOString().slice(0, 10)
}
const num = v => { if (v == null || v === '') return null; if (typeof v === 'number') return v
  const s = String(v).replace(/[\s,$]/g, ''); const neg = /^\(.*\)$/.test(s) || /-$/.test(s) || /DR$/i.test(s)
  const n = parseFloat(s.replace(/[()]/g, '').replace(/-$/, '').replace(/(CR|DR)$/i, '')); return isNaN(n) ? null : (neg ? -Math.abs(n) : n) }

export default function FinanceBank({ setPage }) {
  useFinanceFonts()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [banks, setBanks] = useState([])
  const [bankId, setBankId] = useState('')
  const [sum, setSum] = useState(null)
  const [lines, setLines] = useState([])
  const [tab, setTab] = useState('open')
  const [open, setOpen] = useState(null)
  const [imp, setImp] = useState(null)
  const [rules, setRules] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [centres, setCentres] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    Promise.all([
      supabase.from('bank_accounts').select('id, bank_name, account_name, account_number, gl_account_id').eq('site_id', currentSiteId).eq('is_archived', false).order('bank_name'),
      supabase.from('accounts').select('id, code, name, account_type, sub_type').eq('site_id', currentSiteId).eq('is_archived', false).neq('sub_type', 'Group').order('code'),
      supabase.from('cost_centres').select('id, code, name').eq('site_id', currentSiteId).order('code'),
    ]).then(([b, a, c]) => {
      setBanks(b.data || []); setAccounts(a.data || []); setCentres(c.data || [])
      setBankId(prev => prev && (b.data || []).some(x => x.id === prev) ? prev : (b.data?.[0]?.id || ''))
    })
  }, [currentSiteId])

  const load = useCallback(async () => {
    if (!bankId) { setSum(null); setLines([]); return }
    const [s, l] = await Promise.all([
      supabase.rpc('bank_rec_summary', { p_bank: bankId }),
      supabase.from('bank_statement_lines').select('*, rule:bank_match_rules!bank_statement_lines_rule_fkey(name), journal:journal_entries!bank_statement_lines_matched_journal_id_fkey(entry_number, description)')
        .eq('bank_account_id', bankId).eq('is_archived', false).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
    ])
    if (s.error) showToast(s.error.message, 'red')
    if (l.error) showToast(l.error.message, 'red')
    setSum(s.data); setLines(l.data || [])
  }, [bankId])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => lines.filter(l => tab === 'all' ? true : tab === 'open' ? !l.is_reconciled
    : tab === 'suggested' ? !l.is_reconciled && l.match_status === 'suggested' : tab === 'unmatched' ? !l.is_reconciled && l.match_status === 'unmatched' : l.is_reconciled), [lines, tab])

  async function confirm(l, mode, extra = {}) {
    setBusy(true)
    const { error } = await supabase.rpc('bank_confirm_line', { p_line: l.id, p_mode: mode, ...extra })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Reconciled'); setOpen(null); load()
  }
  async function confirmAllSuggested() {
    const todo = lines.filter(l => !l.is_reconciled && l.match_status === 'suggested')
    if (!todo.length || !window.confirm(`Confirm all ${todo.length} suggested matches?`)) return
    setBusy(true); let ok = 0
    for (const l of todo) { const { error } = await supabase.rpc('bank_confirm_line', { p_line: l.id, p_mode: l.suggested_journal_id ? 'journal' : 'rule' }); if (!error) ok++ }
    setBusy(false); showToast(`${ok} of ${todo.length} reconciled`); load()
  }
  async function unmatch(l) {
    if (!window.confirm(l.created_journal_id ? 'Unmatch this line? The journal it created will be voided.' : 'Unmatch this line?')) return
    const { error } = await supabase.rpc('bank_unmatch_line', { p_line: l.id })
    if (error) return showToast(error.message, 'red')
    setOpen(null); load()
  }

  if (!can('finance.view')) return <Denied />
  const bank = banks.find(b => b.id === bankId)
  const Kpi = ({ label, value, sub, color }) => (
    <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 13, color: FIN.muted }}>{label}</div>
      <div style={{ fontFamily: FIN.serif, fontSize: 26, fontWeight: 600, color: color || FIN.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FIN.muted }}>{sub}</div>}
    </div>
  )
  const grid = '76px minmax(0, 1.3fr) 120px minmax(0, 1.5fr) 100px 150px'

  return (
    <div style={{ fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px', minHeight: '100%', fontVariantNumeric: 'tabular-nums', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: FIN.muted }}>
            <button onClick={() => setPage('fi_dashboard')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Finance</button> · Bank &amp; cash · {currentSite?.name}
          </div>
          <h1 style={{ margin: '4px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 30 }}>{bank ? `${bank.bank_name} — ${bank.account_name}` : 'Bank & cash'}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {banks.length > 1 && <select aria-label="Bank account" value={bankId} onChange={e => setBankId(e.target.value)} style={finInput}>{banks.map(b => <option key={b.id} value={b.id}>{b.bank_name} · {b.account_name}</option>)}</select>}
          {bankId && <button style={finBtn2} onClick={() => setRules(true)}>Matching rules ({sum?.rules ?? 0})</button>}
          {bankId && can('finance.create') && <button style={finBtn} onClick={() => setImp({ step: 'file' })}>Import statement</button>}
        </div>
      </header>

      {banks.length === 0 && <div style={{ ...finCard, fontSize: 14 }}>No bank accounts yet. Add one in <button onClick={() => setPage('fi_setup')} style={{ background: 'none', border: 'none', color: FIN.blue, cursor: 'pointer', font: 'inherit', padding: 0, fontWeight: 600 }}>Set Up the Books → Bank accounts</button>.</div>}

      {sum && <>
        {!sum.ledger_linked && <div style={{ background: FIN.ochreTint, border: `1px solid ${FIN.ochreLine}`, color: '#6B4208', borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>This bank account isn't linked to a ledger account, so lines can only be matched to journals by hand. Link it in Set Up the Books → Bank accounts.</div>}
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
          <Kpi label="Balance per bank" value={`$${money(sum.statement_balance)}`} sub={sum.statement_to ? `Statement to ${sum.statement_to}${sum.balance_from_statement ? '' : ' (worked out from lines)'}` : 'No statement imported yet'} />
          <Kpi label="Balance per books" value={sum.books_balance == null ? '—' : `$${money(sum.books_balance)}`}
            sub={sum.difference == null ? 'Not linked to the ledger' : Number(sum.difference) === 0 ? 'Agrees with the bank' : `$${money(Math.abs(sum.difference))} still to explain`}
            color={sum.difference && Number(sum.difference) !== 0 ? FIN.ochreText : FIN.ink} />
          <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 13, color: FIN.muted }}>Reconciled</div>
            <div style={{ fontFamily: FIN.serif, fontSize: 26, fontWeight: 600 }}>{sum.matched} of {sum.total}</div>
            <div style={{ height: 8, background: FIN.lineSoft, borderRadius: 4, overflow: 'hidden', marginTop: 4 }}><div style={{ width: `${sum.total ? (sum.matched / sum.total) * 100 : 0}%`, height: 8, background: FIN.good }} /></div>
          </div>
          <Kpi label="Waiting for you" value={`${Number(sum.suggested) + Number(sum.unmatched)} lines`} sub={`${sum.suggested} suggested · ${sum.unmatched} unmatched`} />
        </section>

        <section style={{ ...finCard, padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', gap: 6, padding: '12px 16px', flexWrap: 'wrap', alignItems: 'center' }}>
            {[['open', 'To reconcile'], ['suggested', `Suggested · ${sum.suggested}`], ['unmatched', `Unmatched · ${sum.unmatched}`], ['matched', 'Reconciled'], ['all', 'All']].map(([k, label]) => (
              <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)} style={{ minHeight: 36, padding: '0 14px', borderRadius: 18, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
                ...(tab === k ? { border: 'none', background: FIN.ink, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: k === 'unmatched' ? FIN.bad : k === 'suggested' ? FIN.ochreText : FIN.ink }) }}>{label}</button>
            ))}
            <span style={{ flex: 1 }} />
            {Number(sum.suggested) > 0 && can('finance.edit') && <button style={{ ...finBtn, minHeight: 36 }} disabled={busy} onClick={confirmAllSuggested}>Confirm all suggestions</button>}
          </div>
          <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 860 }}>
            <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '8px 16px', fontSize: 12, color: FIN.muted, background: '#F7F9F8' }}>
              <span>Date</span><span>Bank description</span><span style={{ textAlign: 'right' }}>Amount</span><span>Matched to</span><span>Status</span><span />
            </div>
            {shown.length === 0 && <div style={{ padding: 20, fontSize: 13, color: FIN.muted }}>{lines.length ? 'Nothing here.' : 'No statement lines yet. Press Import statement.'}</div>}
            {shown.map(l => {
              const st = l.is_reconciled ? STATUS.matched : STATUS[l.match_status] || STATUS.unmatched
              const amt = Number(l.credit) > 0 ? Number(l.credit) : -Number(l.debit)
              return (
                <div key={l.id} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '11px 16px', borderTop: `1px solid ${FIN.lineSoft}`, alignItems: 'center', fontSize: 14,
                  background: !l.is_reconciled && l.match_status === 'suggested' ? '#FFFBF3' : 'transparent' }}>
                  <span style={{ fontSize: 13, color: FIN.muted }}>{new Date(l.transaction_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.description}>{l.description || l.reference || '—'}</span>
                  <b style={{ textAlign: 'right', color: amt > 0 ? FIN.good : FIN.ink }}>{amt > 0 ? '+' : '−'}${money(Math.abs(amt))}</b>
                  <span style={{ fontSize: 13, minWidth: 0 }}>
                    {l.is_reconciled ? <>{l.journal?.entry_number} <span style={{ color: FIN.muted }}>{l.journal?.description}</span></> : <span style={{ color: FIN.muted, fontSize: 12 }}>{l.suggest_reason || 'No match found'}</span>}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: st[1] }}>{st[0]}</span>
                  <span style={{ justifySelf: 'end', display: 'flex', gap: 6 }}>
                    {!l.is_reconciled && l.match_status === 'suggested' && can('finance.edit') && <button style={{ ...finBtn, minHeight: 34, padding: '0 12px', fontSize: 13 }} disabled={busy} onClick={() => confirm(l, l.suggested_journal_id ? 'journal' : 'rule')}>Confirm</button>}
                    <button style={{ ...finBtn2, minHeight: 34, padding: '0 12px', fontSize: 13 }} onClick={() => setOpen(l)}>{l.is_reconciled ? 'Details' : l.match_status === 'suggested' ? 'Other' : 'Find or post'}</button>
                  </span>
                </div>
              )
            })}
          </div></div>
        </section>
      </>}

      {open && <LineDrawer line={open} accounts={accounts} centres={centres} bankId={bankId} busy={busy} onClose={() => setOpen(null)}
        onConfirm={confirm} onUnmatch={unmatch} onRuleSaved={() => { setOpen(null); load() }} canEdit={can('finance.edit')} />}
      {imp && <ImportDialog state={imp} setState={setImp} bankId={bankId} onDone={r => { setImp(null); showToast(`Imported ${r.imported} line(s)${r.duplicates ? `, ${r.duplicates} already there` : ''}${r.skipped ? `, ${r.skipped} skipped` : ''} · ${r.journal_suggestions + r.rule_suggestions} matched automatically`); load() }} />}
      {rules && <RulesDialog bankId={bankId} siteId={currentSiteId} accounts={accounts} centres={centres} canEdit={can('finance.edit')} onClose={() => { setRules(null); load() }} />}
    </div>
  )
}

function Overlay({ children, label, onClose, width = 560 }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={label} onClick={e => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...finCard, width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, fontFamily: FIN.sans, color: FIN.ink }}>{children}</div>
    </div>
  )
}
const lbl = { display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }

function LineDrawer({ line: l, accounts, centres, bankId, busy, onClose, onConfirm, onUnmatch, onRuleSaved, canEdit }) {
  const [cands, setCands] = useState(null)
  const [acct, setAcct] = useState('')
  const [cc, setCc] = useState('')
  const [memo, setMemo] = useState('')
  const [makeRule, setMakeRule] = useState(false)
  const [ruleText, setRuleText] = useState(() => (l.description || '').split(/\s+/).slice(0, 2).join(' '))
  const out = Number(l.debit) > 0
  useEffect(() => { if (!l.is_reconciled) supabase.rpc('bank_line_candidates', { p_line: l.id }).then(({ data }) => setCands(data || [])) }, [l])
  async function post() {
    if (!acct) return showToast('Choose an account', 'red')
    if (makeRule) {
      const { error } = await supabase.rpc('bank_save_rule', { p_bank: bankId, p_rule: null, p_name: ruleText, p_text: ruleText, p_direction: out ? 'out' : 'in', p_account: acct, p_cost_centre: cc || null, p_project: null, p_active: true })
      if (error) return showToast(error.message, 'red')
    }
    await onConfirm(l, 'account', { p_account: acct, p_cost_centre: cc || null, p_memo: memo || null })
    if (makeRule) onRuleSaved()
  }
  const opts = accounts.filter(a => !['Bank'].includes(a.sub_type) && (out ? a.account_type !== 'Revenue' : true))
  return (
    <Overlay label="Statement line" onClose={onClose}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div><div style={{ fontSize: 12, color: FIN.muted }}>{l.transaction_date}{l.reference ? ` · ${l.reference}` : ''}</div>
          <h2 style={{ margin: '2px 0 0', fontSize: 16, fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-word' }}>{l.description || 'Statement line'}</h2></div>
        <div style={{ fontFamily: FIN.serif, fontSize: 24, fontWeight: 600, color: out ? FIN.ink : FIN.good, whiteSpace: 'nowrap' }}>{out ? '−' : '+'}${money(out ? l.debit : l.credit)}</div>
      </div>
      {l.is_reconciled ? (<>
        <div style={{ background: FIN.goodTint, border: '1px solid #CFE3D6', color: FIN.good, borderRadius: 10, padding: '10px 14px', fontSize: 13 }}>
          Reconciled to {l.journal?.entry_number} — {l.journal?.description}{l.created_journal_id ? ' (posted from this line)' : ''}.
        </div>
        {canEdit && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={{ ...finBtn2, color: FIN.bad, borderColor: FIN.bad }} onClick={() => onUnmatch(l)}>Unmatch</button></div>}
      </>) : (<>
        {l.suggest_reason && <div style={{ background: FIN.ochreTint, border: `1px solid ${FIN.ochreLine}`, color: '#6B4208', borderRadius: 10, padding: '10px 14px', fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
          <span>Suggested: {l.suggest_reason}</span>
          {canEdit && <button style={{ ...finBtn, minHeight: 34 }} disabled={busy} onClick={() => onConfirm(l, l.suggested_journal_id ? 'journal' : 'rule')}>Confirm</button>}
        </div>}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Match to an existing journal</div>
          {cands === null ? <div style={{ fontSize: 13, color: FIN.muted }}>Looking…</div> : cands.length === 0 ? <div style={{ fontSize: 13, color: FIN.muted }}>No unmatched journals on this bank within 30 days.</div> :
            cands.sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 8).map(c => (
              <div key={c.journal_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 110px 80px', gap: 8, alignItems: 'center', padding: '7px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 13 }}>
                <span>{c.entry_number} · {c.entry_date}<span style={{ display: 'block', fontSize: 12, color: FIN.muted }}>{c.description}</span></span>
                <span style={{ textAlign: 'right', color: c.exact ? FIN.good : FIN.ink, fontWeight: c.exact ? 600 : 400 }}>${money(c.amount)}</span>
                {canEdit && <button style={{ ...finBtn2, minHeight: 32, padding: '0 10px', fontSize: 12 }} disabled={busy} onClick={() => onConfirm(l, 'journal', { p_journal: c.journal_id })}>Match</button>}
              </div>
            ))}
        </div>
        {canEdit && <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${FIN.lineSoft}`, paddingTop: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Or post it to an account</div>
          <label><span style={lbl}>{out ? 'What was it for?' : 'Where did it come from?'}</span>
            <select value={acct} onChange={e => setAcct(e.target.value)} style={{ ...finInput, width: '100%' }}><option value="">Choose an account…</option>{opts.map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label>
          <label><span style={lbl}>Cost centre (optional)</span>
            <select value={cc} onChange={e => setCc(e.target.value)} style={{ ...finInput, width: '100%' }}><option value="">—</option>{centres.map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
          <label><span style={lbl}>Note (optional)</span><input value={memo} onChange={e => setMemo(e.target.value)} style={{ ...finInput, width: '100%' }} placeholder={l.description || ''} /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={makeRule} onChange={e => setMakeRule(e.target.checked)} style={{ width: 18, height: 18, accentColor: FIN.maroon }} />
            Remember: lines containing
            <input value={ruleText} onChange={e => setRuleText(e.target.value)} disabled={!makeRule} aria-label="Text to match" style={{ ...finInput, minHeight: 32, width: 160 }} /> go here next time
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button style={finBtn2} onClick={onClose}>Close</button>
            <button style={finBtn} disabled={busy} onClick={post}>Post and reconcile</button>
          </div>
        </div>}
      </>)}
    </Overlay>
  )
}

function ImportDialog({ state, setState, bankId, onDone }) {
  const [busy, setBusy] = useState(false)
  async function readFile(f) {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' }).filter(r => r.some(c => String(c).trim() !== ''))
      // header row = first row with at least 3 text cells
      const hi = Math.max(0, rows.findIndex(r => r.filter(c => typeof c === 'string' && c.trim()).length >= 3))
      const headers = rows[hi].map((h, i) => String(h || `Column ${i + 1}`).trim())
      const guess = k => headers.findIndex(h => ({
        date: /date|value/i, description: /desc|narr|detail|particular|transaction/i, reference: /ref|cheque|chq/i,
        amount: /^amount$|amount \(|net/i, debit: /debit|withdraw|money out|dr\b|paid out/i, credit: /credit|deposit|money in|cr\b|paid in/i, balance: /balance|bal\b/i,
      })[k].test(h))
      const map = Object.fromEntries(FIELDS.map(([k]) => [k, guess(k)]))
      if (map.debit >= 0 || map.credit >= 0) map.amount = -1
      setState({ step: 'map', name: f.name, headers, rows: rows.slice(hi + 1), map, dayFirst: true })
    } catch (e) { showToast('Could not read that file: ' + e.message, 'red') }
  }
  const parsed = useMemo(() => {
    if (state.step !== 'map') return []
    const { rows, map, dayFirst } = state
    const g = (r, k) => map[k] >= 0 ? r[map[k]] : undefined
    return rows.map(r => ({
      date: toIsoDate(g(r, 'date'), dayFirst), description: String(g(r, 'description') ?? '').trim(), reference: String(g(r, 'reference') ?? '').trim(),
      amount: map.amount >= 0 ? num(g(r, 'amount')) : null, debit: map.amount >= 0 ? null : num(g(r, 'debit')), credit: map.amount >= 0 ? null : num(g(r, 'credit')), balance: num(g(r, 'balance')),
    })).filter(x => x.date && ((x.amount && x.amount !== 0) || x.debit || x.credit))
  }, [state])
  async function go() {
    setBusy(true)
    const { data, error } = await supabase.rpc('bank_import_lines', { p_bank: bankId, p_lines: parsed, p_batch: state.name })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    onDone(data)
  }
  return (
    <Overlay label="Import statement" onClose={() => setState(null)} width={760}>
      <h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>Import bank statement</h2>
      {state.step === 'file' && (<>
        <div style={{ fontSize: 14, color: FIN.muted }}>Download the statement from internet banking as CSV or Excel and choose it here. Lines already imported are skipped automatically.</div>
        <label style={{ border: `2px dashed ${FIN.field}`, borderRadius: 12, padding: 28, textAlign: 'center', cursor: 'pointer', fontSize: 14 }}>
          <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={e => e.target.files?.[0] && readFile(e.target.files[0])} style={{ display: 'block', margin: '0 auto 8px' }} />
          CSV, XLSX or XLS
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={finBtn2} onClick={() => setState(null)}>Cancel</button></div>
      </>)}
      {state.step === 'map' && (<>
        <div style={{ fontSize: 13, color: FIN.muted }}>{state.name} · {state.rows.length} rows. Check which column is which:</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {FIELDS.map(([k, label, req]) => (
            <label key={k}><span style={lbl}>{label}{req ? ' *' : ''}</span>
              <select value={state.map[k]} onChange={e => setState({ ...state, map: { ...state.map, [k]: Number(e.target.value) } })} style={{ ...finInput, width: '100%' }}>
                <option value={-1}>— not in file —</option>{state.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </select></label>
          ))}
          <label><span style={lbl}>Dates look like</span>
            <select value={state.dayFirst ? 'd' : 'm'} onChange={e => setState({ ...state, dayFirst: e.target.value === 'd' })} style={{ ...finInput, width: '100%' }}>
              <option value="d">25/09/2026 (day first)</option><option value="m">09/25/2026 (month first)</option></select></label>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Preview · {parsed.length} lines will be imported</div>
        <div style={{ overflowX: 'auto', border: `1px solid ${FIN.line}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ background: '#F7F9F8', color: FIN.muted }}>{['Date', 'Description', 'Reference', 'Out', 'In', 'Balance'].map(h => <th key={h} style={{ textAlign: h === 'Date' || h === 'Description' || h === 'Reference' ? 'left' : 'right', padding: '6px 8px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{parsed.slice(0, 8).map((x, i) => {
              const o = x.amount != null ? Math.max(-x.amount, 0) : Math.abs(x.debit || 0), n = x.amount != null ? Math.max(x.amount, 0) : Math.abs(x.credit || 0)
              return <tr key={i} style={{ borderTop: `1px solid ${FIN.lineSoft}` }}><td style={{ padding: '6px 8px' }}>{x.date}</td><td style={{ padding: '6px 8px' }}>{x.description}</td><td style={{ padding: '6px 8px' }}>{x.reference}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{o ? money(o) : ''}</td><td style={{ padding: '6px 8px', textAlign: 'right', color: FIN.good }}>{n ? money(n) : ''}</td><td style={{ padding: '6px 8px', textAlign: 'right' }}>{x.balance != null ? money(x.balance) : ''}</td></tr>
            })}</tbody>
          </table>
        </div>
        {parsed.length === 0 && <div style={{ fontSize: 13, color: FIN.bad }}>No usable lines — check the date and amount columns.</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button style={finBtn2} onClick={() => setState({ step: 'file' })}>Choose another file</button>
          <button style={finBtn} disabled={busy || parsed.length === 0} onClick={go}>{busy ? 'Importing…' : `Import ${parsed.length} lines`}</button>
        </div>
      </>)}
    </Overlay>
  )
}

function RulesDialog({ bankId, siteId, accounts, centres, canEdit, onClose }) {
  const [rules, setRules] = useState([])
  const [form, setForm] = useState(null)
  const load = useCallback(() => {
    supabase.from('bank_match_rules').select('*, account:accounts(code, name), cc:cost_centres(code, name)').eq('site_id', siteId).eq('is_archived', false).order('priority').order('name')
      .then(({ data }) => setRules(data || []))
  }, [siteId])
  useEffect(() => { load() }, [load])
  async function save() {
    if (!form.match_text?.trim() || !form.account_id) return showToast('Enter the text to look for and choose an account', 'red')
    const { error } = await supabase.rpc('bank_save_rule', { p_bank: bankId, p_rule: form.id || null, p_name: form.name || form.match_text, p_text: form.match_text,
      p_direction: form.direction || 'out', p_account: form.account_id, p_cost_centre: form.cost_centre_id || null, p_project: null, p_active: form.is_active !== false })
    if (error) return showToast(error.message, 'red')
    setForm(null); load(); showToast('Rule saved — matching re-run')
  }
  async function archive(r) {
    const { error } = await supabase.from('bank_match_rules').update({ is_archived: true }).eq('id', r.id).eq('site_id', siteId)
    if (error) return showToast(error.message, 'red')
    load()
  }
  return (
    <Overlay label="Matching rules" onClose={onClose} width={720}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>Matching rules</h2>
        {canEdit && !form && <button style={finBtn} onClick={() => setForm({ direction: 'out', is_active: true })}>Add rule</button>}
      </div>
      <div style={{ fontSize: 13, color: FIN.muted }}>When a statement line's description contains the text, it is suggested for that account and cost centre. Rules also come from "Remember" when you post a line.</div>
      {form && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, background: FIN.ground, borderRadius: 10, padding: 14 }}>
          <label><span style={lbl}>Description contains *</span><input value={form.match_text || ''} onChange={e => setForm({ ...form, match_text: e.target.value })} style={{ ...finInput, width: '100%' }} placeholder="e.g. ZESA" /></label>
          <label><span style={lbl}>Name</span><input value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} style={{ ...finInput, width: '100%' }} placeholder="e.g. Electricity" /></label>
          <label><span style={lbl}>Applies to</span><select value={form.direction} onChange={e => setForm({ ...form, direction: e.target.value })} style={{ ...finInput, width: '100%' }}><option value="out">Money out</option><option value="in">Money in</option><option value="any">Both</option></select></label>
          <label><span style={lbl}>Account *</span><select value={form.account_id || ''} onChange={e => setForm({ ...form, account_id: e.target.value })} style={{ ...finInput, width: '100%' }}><option value="">Choose…</option>{accounts.filter(a => a.sub_type !== 'Bank').map(a => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></label>
          <label><span style={lbl}>Cost centre</span><select value={form.cost_centre_id || ''} onChange={e => setForm({ ...form, cost_centre_id: e.target.value })} style={{ ...finInput, width: '100%' }}><option value="">—</option>{centres.map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}><button style={finBtn2} onClick={() => setForm(null)}>Cancel</button><button style={finBtn} onClick={save}>Save</button></div>
        </div>
      )}
      {rules.length === 0 && <div style={{ fontSize: 13, color: FIN.muted }}>No rules yet.</div>}
      {rules.map(r => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10, alignItems: 'center', padding: '8px 0', borderTop: `1px solid ${FIN.lineSoft}`, opacity: r.is_active ? 1 : 0.5 }}>
          <div style={{ fontSize: 13 }}><b>{r.name}</b> — contains "<span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{r.match_text}</span>" ({r.direction === 'out' ? 'money out' : r.direction === 'in' ? 'money in' : 'both'})
            <span style={{ display: 'block', fontSize: 12, color: FIN.muted }}>→ {r.account?.code} {r.account?.name}{r.cc ? ` · ${r.cc.name}` : ''} · used {r.times_used}×</span></div>
          {canEdit && <div style={{ display: 'flex', gap: 6 }}><button style={{ ...finBtn2, minHeight: 32, padding: '0 10px', fontSize: 12 }} onClick={() => setForm(r)}>Edit</button><button style={{ ...finBtn2, minHeight: 32, padding: '0 10px', fontSize: 12, color: FIN.bad }} onClick={() => archive(r)}>Remove</button></div>}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={finBtn2} onClick={onClose}>Close</button></div>
    </Overlay>
  )
}
