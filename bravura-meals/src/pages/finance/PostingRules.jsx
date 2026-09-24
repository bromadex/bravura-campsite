import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, Icon, showToast, PageHeader, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
import Denied from '../../components/Denied'

const FI_CLR = MODULE_COLORS.finance

// A mine only incurs costs: every event is an expense, stock or liability movement — no revenue.
const EVENTS = [
  { code: 'fuel_delivery',      group: 'Fuel',        label: 'Fuel delivered into site tanks',        debit: 'Fuel stock (asset)',               credit: 'Supplier payables (liability)' },
  { code: 'fuel_issue',         group: 'Fuel',        label: 'Fuel issued to vehicles & equipment',   debit: 'Fuel expense',                     credit: 'Fuel stock (asset)' },
  { code: 'grn_accepted',       group: 'Procurement', label: 'Goods received & accepted',             debit: 'Stores stock or expense',          credit: 'Goods received not invoiced' },
  { code: 'invoice_approved',   group: 'Procurement', label: 'Supplier invoice approved',             debit: 'Goods received not invoiced',      credit: 'Supplier payables (liability)' },
  { code: 'invoice_paid',       group: 'Procurement', label: 'Supplier invoice paid',                 debit: 'Supplier payables (liability)',    credit: 'Bank' },
  { code: 'payroll_net',        group: 'Payroll',     label: 'Payroll approved — net pay',            debit: 'Salaries & wages expense',         credit: 'Net pay payable' },
  { code: 'payroll_paye',       group: 'Payroll',     label: 'Payroll approved — PAYE & AIDS levy',   debit: 'Salaries & wages expense',         credit: 'PAYE payable (ZIMRA)' },
  { code: 'payroll_nssa',       group: 'Payroll',     label: 'Payroll approved — NSSA (employee)',    debit: 'Salaries & wages expense',         credit: 'NSSA payable' },
  { code: 'payroll_nssa_employer', group: 'Payroll',  label: 'Payroll approved — NSSA (employer)',    debit: 'Employer NSSA expense',            credit: 'NSSA payable' },
  { code: 'payroll_deductions', group: 'Payroll',     label: 'Payroll approved — other deductions (medical aid etc.)', debit: 'Salaries & wages expense', credit: 'Other deductions payable' },
  { code: 'payroll_paid',       group: 'Payroll',     label: 'Payroll paid to employees',             debit: 'Net pay payable',                  credit: 'Bank' },
  { code: 'meals_approved',     group: 'Meals',       label: 'Daily meals approved',                  debit: 'Catering expense',                 credit: 'Catering provider payable' },
  { code: 'expense_approved',   group: 'Expenses',    label: 'Expense claim approved',                debit: 'Staff expenses (by claim)',        credit: 'Employee claims payable' },
  { code: 'advance_settled',    group: 'Expenses',    label: 'Claim settled against an advance',      debit: 'Employee claims payable',          credit: 'Staff advances (asset)' },
  { code: 'expense_paid',       group: 'Expenses',    label: 'Expense claim paid by bank',            debit: 'Employee claims payable',          credit: 'Bank' },
  { code: 'expense_paid_cash',  group: 'Expenses',    label: 'Expense claim paid from petty cash',    debit: 'Employee claims payable',          credit: 'Petty cash (asset)' },
  { code: 'advance_paid',       group: 'Expenses',    label: 'Advance paid by bank',                  debit: 'Staff advances (asset)',           credit: 'Bank' },
  { code: 'advance_paid_cash',  group: 'Expenses',    label: 'Advance paid from petty cash',          debit: 'Staff advances (asset)',           credit: 'Petty cash (asset)' },
  { code: 'petty_cash_topup',   group: 'Petty cash',  label: 'Petty cash topped up',                  debit: 'Petty cash (asset)',               credit: 'Bank' },
  { code: 'petty_cash_expense', group: 'Petty cash',  label: 'Petty cash spent',                      debit: 'Sundry site expenses',             credit: 'Petty cash (asset)' },
  { code: 'petty_cash_short',   group: 'Petty cash',  label: 'Cash count short',                      debit: 'Cash shortages (expense)',         credit: 'Petty cash (asset)' },
  { code: 'petty_cash_over',    group: 'Petty cash',  label: 'Cash count over',                       debit: 'Petty cash (asset)',               credit: 'Cash shortages (reduces the expense — not revenue)' },
  { code: 'imtt',               group: 'Bank',        label: 'IMTT on payments (invoices, payroll, claims)', debit: 'Bank charges — IMTT',        credit: 'Bank' },
]
const EVENT_LABEL = Object.fromEntries(EVENTS.map(e => [e.code, e.label]))

const STATUS = {
  posted:   { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Posted' },
  skipped:  { bg: THEME.statusWarningBg, color: THEME.statusWarningText, label: 'Waiting' },
  reversed: { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Reversed' },
}

const sel = {
  width: '100%', padding: '6px 8px', borderRadius: '6px', fontSize: '12px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit',
}
const hint = { fontSize: '11px', color: THEME.textLow, marginTop: '3px' }
const money = n => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PostingRules({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const canEdit = can('finance.edit')

  const [accounts, setAccounts] = useState([])
  const [centres, setCentres] = useState([])
  const [rules, setRules] = useState({})
  const [drafts, setDrafts] = useState({})
  const [log, setLog] = useState([])
  const [counts, setCounts] = useState({ posted: 0, skipped: 0, reversed: 0 })
  const [filter, setFilter] = useState('skipped')
  const [loading, setLoading] = useState(true)
  const [savingCode, setSavingCode] = useState(null)
  const [retrying, setRetrying] = useState(false)
  const [tax, setTax] = useState(null)
  const [savingTax, setSavingTax] = useState(false)

  useEffect(() => { if (currentSiteId) loadSetup() }, [currentSiteId])
  useEffect(() => { if (currentSiteId) loadLog() }, [currentSiteId, filter])

  async function loadSetup() {
    setLoading(true)
    const [acc, cc, rl, tx] = await Promise.all([
      supabase.from('accounts').select('id, code, name, account_type').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
      supabase.from('cost_centres').select('id, code, name').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
      supabase.from('gl_posting_rules').select('*').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('finance_tax_settings').select('*').eq('site_id', currentSiteId).maybeSingle(),
    ])
    setTax(tx.data ? { ...tx.data, imtt_cap: tx.data.imtt_cap ?? '' } : null)
    if (acc.error || rl.error) showToast('Failed to load posting setup', 'red')
    setAccounts(acc.data || [])
    setCentres(cc.data || [])
    const byCode = Object.fromEntries((rl.data || []).map(r => [r.event_code, r]))
    setRules(byCode)
    setDrafts(Object.fromEntries(EVENTS.map(e => [e.code, {
      debit_account_id: byCode[e.code]?.debit_account_id || '',
      credit_account_id: byCode[e.code]?.credit_account_id || '',
      cost_centre_id: byCode[e.code]?.cost_centre_id || '',
      is_active: byCode[e.code]?.is_active ?? true,
    }])))
    setLoading(false)
  }

  async function loadLog() {
    const base = () => supabase.from('gl_posting_log').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId)
    const [list, p, s, r] = await Promise.all([
      supabase.from('gl_posting_log').select('*').eq('site_id', currentSiteId)
        .eq('status', filter).order('created_at', { ascending: false }).limit(100),
      base().eq('status', 'posted'),
      base().eq('status', 'skipped'),
      base().eq('status', 'reversed'),
    ])
    setLog(list.data || [])
    setCounts({ posted: p.count || 0, skipped: s.count || 0, reversed: r.count || 0 })
  }

  function setDraft(code, patch) {
    setDrafts(d => ({ ...d, [code]: { ...d[code], ...patch } }))
  }

  function isDirty(code) {
    const d = drafts[code], r = rules[code]
    if (!d) return false
    return (d.debit_account_id || null) !== (r?.debit_account_id || null)
      || (d.credit_account_id || null) !== (r?.credit_account_id || null)
      || (d.cost_centre_id || null) !== (r?.cost_centre_id || null)
      || d.is_active !== (r?.is_active ?? true)
  }

  async function saveRule(code) {
    const d = drafts[code]
    if (!d.debit_account_id || !d.credit_account_id) { showToast('Pick both a debit and a credit account', 'red'); return }
    if (d.debit_account_id === d.credit_account_id) { showToast('Debit and credit accounts must be different', 'red'); return }
    setSavingCode(code)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('gl_posting_rules').upsert({
      site_id: currentSiteId,
      event_code: code,
      debit_account_id: d.debit_account_id,
      credit_account_id: d.credit_account_id,
      cost_centre_id: d.cost_centre_id || null,
      is_active: d.is_active,
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'site_id,event_code' })
    setSavingCode(null)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Posting rule saved', 'green')
    loadSetup()
  }

  async function saveTax() {
    const rate = Number(tax.imtt_rate)
    if (isNaN(rate) || rate < 0 || rate > 100) { showToast('Enter an IMTT rate between 0 and 100', 'red'); return }
    setSavingTax(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('finance_tax_settings').update({
      imtt_enabled: tax.imtt_enabled,
      imtt_rate: rate,
      imtt_cap: tax.imtt_cap === '' ? null : Number(tax.imtt_cap),
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    }).eq('id', tax.id).eq('site_id', currentSiteId)
    setSavingTax(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('IMTT settings saved', 'green')
  }

  async function retrySkipped() {
    setRetrying(true)
    const { data, error } = await supabase.rpc('gl_retry_skipped', { p_site_id: currentSiteId })
    setRetrying(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${data.posted} posted, ${data.still_skipped} still waiting`, data.posted ? 'green' : 'orange')
    loadLog()
  }

  const accountOptions = useMemo(() => accounts.map(a => (
    <option key={a.id} value={a.id}>{a.code} · {a.name} ({a.account_type})</option>
  )), [accounts])

  if (!can('finance.view') && !canEdit) return <Denied />

  const configured = EVENTS.filter(e => rules[e.code]?.debit_account_id && rules[e.code]?.credit_account_id && rules[e.code]?.is_active).length

  return (
    <div>
      <PageHeader title="Posting Rules" />

      <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px', background: THEME.statusInfoBg }}>
        <Icon name="info" size={18} style={{ color: FI_CLR, flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.6 }}>
          When fuel, stores, invoices, payroll or meals are approved on site, the ledger is updated automatically using these rules.
          Posted journals are locked — to correct one, change or cancel the source record and the journal is reversed and re-posted.
          Events with no rule wait in the queue below; set the rule, then press <b>Post waiting items</b>.
        </div>
      </Card>

      {accounts.length === 0 && !loading && (
        <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', background: THEME.statusWarningBg }}>
          <Icon name="warning" size={18} style={{ color: THEME.statusWarningText }} />
          <div style={{ fontSize: '12px', color: THEME.statusWarningText, flex: 1 }}>
            This site has no ledger accounts yet. Create them in the Chart of Accounts first.
          </div>
          <Button size="sm" variant="outlined" onClick={() => setPage('fi_chart_of_accounts')}>Chart of Accounts</Button>
        </Card>
      )}

      {tax && (
        <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'flex-end', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>IMTT (bank transfer tax)</div>
            <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px' }}>Charged on each supplier payment and each employee's net pay transfer.</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMed }}>
            <input id="imtt-enabled" type="checkbox" checked={tax.imtt_enabled} disabled={!canEdit}
              onChange={e => setTax({ ...tax, imtt_enabled: e.target.checked })} />
            Post IMTT
          </label>
          <div>
            <label htmlFor="imtt-rate" style={{ fontSize: '11px', color: THEME.textLow, display: 'block' }}>Rate %</label>
            <input id="imtt-rate" type="number" step="0.01" style={{ ...sel, width: '90px' }} value={tax.imtt_rate} disabled={!canEdit}
              onChange={e => setTax({ ...tax, imtt_rate: e.target.value })} />
          </div>
          <div>
            <label htmlFor="imtt-cap" style={{ fontSize: '11px', color: THEME.textLow, display: 'block' }}>Max per transfer (USD)</label>
            <input id="imtt-cap" type="number" step="0.01" placeholder="No cap" style={{ ...sel, width: '130px' }} value={tax.imtt_cap} disabled={!canEdit}
              onChange={e => setTax({ ...tax, imtt_cap: e.target.value })} />
          </div>
          {canEdit && (
            <Button size="sm" onClick={saveTax} disabled={savingTax} style={{ background: FI_CLR, color: '#fff' }}>
              {savingTax ? 'Saving…' : 'Save'}
            </Button>
          )}
        </Card>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '4px 0 8px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>Rules</div>
        <div style={{ fontSize: '12px', color: THEME.textLow }}>{configured} of {EVENTS.length} events posting</div>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: FI_CLR }} /></div>
      ) : (
        <TableWrap>
          <THead color={FI_CLR}>
            {['Event', 'Debit', 'Credit', 'Cost centre', 'Active', ''].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {EVENTS.map(e => {
              const d = drafts[e.code] || {}
              return (
                <TRow key={e.code}>
                  <Td style={{ minWidth: '200px' }}>
                    <div style={{ fontSize: '11px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{e.group}</div>
                    <div style={{ fontWeight: 600, color: THEME.text, fontSize: '13px' }}>{e.label}</div>
                  </Td>
                  <Td style={{ minWidth: '190px' }}>
                    <select style={sel} value={d.debit_account_id} disabled={!canEdit} onChange={ev => setDraft(e.code, { debit_account_id: ev.target.value })}>
                      <option value="">— choose account —</option>{accountOptions}
                    </select>
                    <div style={hint}>Usually: {e.debit}</div>
                  </Td>
                  <Td style={{ minWidth: '190px' }}>
                    <select style={sel} value={d.credit_account_id} disabled={!canEdit} onChange={ev => setDraft(e.code, { credit_account_id: ev.target.value })}>
                      <option value="">— choose account —</option>{accountOptions}
                    </select>
                    <div style={hint}>Usually: {e.credit}</div>
                  </Td>
                  <Td style={{ minWidth: '140px' }}>
                    <select style={sel} value={d.cost_centre_id} disabled={!canEdit} onChange={ev => setDraft(e.code, { cost_centre_id: ev.target.value })}>
                      <option value="">None</option>
                      {centres.map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                    </select>
                  </Td>
                  <Td>
                    <input type="checkbox" checked={!!d.is_active} disabled={!canEdit}
                      onChange={ev => setDraft(e.code, { is_active: ev.target.checked })}
                      aria-label={`${e.label} active`} />
                  </Td>
                  <Td>
                    {canEdit && (
                      <Button size="sm" onClick={() => saveRule(e.code)} disabled={!isDirty(e.code) || savingCode === e.code}
                        style={{ background: isDirty(e.code) ? FI_CLR : THEME.surfaceVar, color: isDirty(e.code) ? '#fff' : THEME.textLow }}>
                        {savingCode === e.code ? 'Saving…' : 'Save'}
                      </Button>
                    )}
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', margin: '24px 0 8px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>Posting activity</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {Object.entries(STATUS).map(([k, s]) => (
            <button key={k} onClick={() => setFilter(k)}
              style={{ padding: '5px 12px', borderRadius: '999px', fontSize: '12px', fontFamily: 'inherit', cursor: 'pointer',
                border: `1px solid ${filter === k ? s.color : THEME.outlineVar}`,
                background: filter === k ? s.bg : THEME.surface, color: filter === k ? s.color : THEME.textMed, fontWeight: filter === k ? 600 : 400 }}>
              {s.label} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{counts[k]}</span>
            </button>
          ))}
          {canEdit && counts.skipped > 0 && (
            <Button size="sm" icon="replay" onClick={retrySkipped} disabled={retrying} style={{ background: FI_CLR, color: '#fff' }}>
              {retrying ? 'Posting…' : 'Post waiting items'}
            </Button>
          )}
        </div>
      </div>

      {log.length === 0 ? (
        <Card style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
          Nothing {STATUS[filter].label.toLowerCase()} yet.
        </Card>
      ) : (
        <TableWrap>
          <THead color={FI_CLR}>
            {['Date', 'Event', 'Description', 'Amount', filter === 'posted' ? 'Journal' : 'Reason'].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {log.map(l => (
              <TRow key={l.id}>
                <Td style={{ fontSize: '12px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{l.entry_date}</Td>
                <Td style={{ fontSize: '12px' }}>{EVENT_LABEL[l.event_code] || l.event_code}</Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{l.description}</Td>
                <Td style={{ fontSize: '12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(l.amount)}</Td>
                <Td style={{ fontSize: '12px' }}>
                  {filter === 'posted' && l.journal_id
                    ? <button onClick={() => setPage(`fi_journal_detail:${l.journal_id}`)}
                        style={{ background: 'none', border: 'none', padding: 0, color: FI_CLR, cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', textDecoration: 'underline' }}>
                        Open journal
                      </button>
                    : <span style={{ color: THEME.textMed }}>{l.message}</span>}
                </Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}
    </div>
  )
}
