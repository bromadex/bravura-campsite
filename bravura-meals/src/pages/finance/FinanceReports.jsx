import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { exportCsv } from '../../utils/csv'
import { FIN, finCard, finBtn2, finInput, money, useFinanceFonts } from '../../utils/financeTheme'

// FI24 — Finance reports (Finance rewrite Phase 6, issue #49; migration 0209).
// Operating costs (the cost-only P&L), balance sheet, trial balance, cash flow and a spend
// Explorer — all computed in the database from posted journals (fin_statements / fin_explore).
const TABS = [['costs', 'Operating costs'], ['bs', 'Balance sheet'], ['tb', 'Trial balance'], ['cash', 'Cash flow'], ['explore', 'Explorer']]
const iso = d => d.toISOString().slice(0, 10)
function presetRange(p) {
  const t = new Date(); const y = t.getFullYear(), m = t.getMonth()
  if (p === 'this_month') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
  if (p === 'last_month') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
  if (p === 'quarter') { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))] }
  if (p === 'ytd') return [iso(new Date(y, 0, 1)), iso(t)]
  return null
}
const amt = n => { const v = Number(n || 0); return v < 0 ? `(${money(-v)})` : money(v) }

export default function FinanceReports({ setPage, initialTab = 'costs' }) {
  useFinanceFonts()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [tab, setTab] = useState(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  const [preset, setPreset] = useState('this_month')
  const [range, setRange] = useState(presetRange('this_month'))
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!currentSiteId || !can('finance.view') || tab === 'explore') return
    setLoading(true)
    supabase.rpc('fin_statements', { p_site: currentSiteId, p_from: range[0], p_to: range[1] }).then(({ data, error }) => {
      setLoading(false)
      if (error) return showToast(error.message, 'red')
      setD(data)
    })
  }, [currentSiteId, range, tab, can])

  if (!can('finance.view')) return <Denied />
  const fmtD = s => new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const period = `${fmtD(range[0])} – ${fmtD(range[1])}`

  return (
    <div style={{ fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px', minHeight: '100%', fontVariantNumeric: 'tabular-nums', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: FIN.muted }}>
            <button onClick={() => setPage('fi_dashboard')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Finance</button> · {currentSite?.name}
          </div>
          <h1 style={{ margin: '4px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 30 }}>Reports</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select aria-label="Period" value={preset} onChange={e => { setPreset(e.target.value); const r = presetRange(e.target.value); if (r) setRange(r) }} style={finInput}>
            <option value="this_month">This month</option><option value="last_month">Last month</option><option value="quarter">This quarter</option><option value="ytd">Year to date</option><option value="custom">Custom…</option>
          </select>
          {preset === 'custom' && <>
            <input type="date" aria-label="From" value={range[0]} onChange={e => setRange([e.target.value, range[1]])} style={finInput} />
            <input type="date" aria-label="To" value={range[1]} onChange={e => setRange([range[0], e.target.value])} style={finInput} />
          </>}
          <button style={finBtn2} onClick={() => window.print()}>Print</button>
        </div>
      </header>

      <div role="tablist" aria-label="Report" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ minHeight: 40, padding: '0 14px', borderRadius: 20, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            ...(tab === k ? { border: 'none', background: FIN.ink, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{label}</button>
        ))}
      </div>

      {tab === 'explore' ? <Explorer siteId={currentSiteId} range={range} period={period} /> : loading || !d ? <div style={{ color: FIN.muted }}>Loading…</div> : (
        <section style={{ ...finCard, padding: '22px 26px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
            <div>
              <h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>{TABS.find(t => t[0] === tab)[1]}</h2>
              <div style={{ fontSize: 13, color: FIN.muted }}>{currentSite?.name} · {tab === 'bs' ? `as at ${fmtD(range[1])}` : period}</div>
            </div>
            <CsvButton tab={tab} d={d} name={`${currentSite?.name || 'site'}-${tab}-${range[0]}-${range[1]}`} />
          </div>
          {tab === 'costs' && <Costs d={d} />}
          {tab === 'bs' && <BalanceSheet d={d} />}
          {tab === 'tb' && <TrialBalance d={d} />}
          {tab === 'cash' && <CashFlow d={d} />}
        </section>
      )}
    </div>
  )
}

const row = (cols, bold, top) => ({ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '8px 0', borderTop: top ? `2px solid ${FIN.ink}` : `1px solid ${FIN.lineSoft}`, fontSize: 14, fontWeight: bold ? 600 : 400 })
const head = cols => ({ display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '6px 0', fontSize: 12, color: FIN.muted })
const R = { textAlign: 'right' }

function Costs({ d }) {
  const cols = 'minmax(0, 1fr) 130px 130px 90px 140px'
  const t = d.costs.reduce((a, c) => ({ p: a.p + Number(c.period), pr: a.pr + Number(c.prior), y: a.y + Number(c.ytd) }), { p: 0, pr: 0, y: 0 })
  const chg = (a, b) => Number(b) ? `${Math.round(((a - b) / Math.abs(b)) * 100)}%` : '—'
  return (<>
    <div style={{ fontSize: 13, color: FIN.muted, marginBottom: 8 }}>Bravura only buys, so this is a statement of costs — there is no revenue section.</div>
    <div style={head(cols)}><span>Cost heading</span><span style={R}>This period</span><span style={R}>Period before</span><span style={R}>Change</span><span style={R}>Year to date</span></div>
    {d.costs.length === 0 && <div style={{ fontSize: 13, color: FIN.muted, padding: '8px 0' }}>No costs posted in this period.</div>}
    {d.costs.map(c => (
      <div key={c.heading} style={row(cols)}>
        <span>{c.heading}<span style={{ display: 'block', fontSize: 11, color: FIN.faint }}>{(c.accounts || []).map(a => a.code).join(', ')}</span></span>
        <span style={R}>{amt(c.period)}</span><span style={{ ...R, color: FIN.muted }}>{amt(c.prior)}</span>
        <span style={{ ...R, color: Number(c.period) > Number(c.prior) ? FIN.ochreText : FIN.good, fontSize: 13 }}>{chg(Number(c.period), Number(c.prior))}</span>
        <span style={R}>{amt(c.ytd)}</span>
      </div>
    ))}
    <div style={row(cols, true, true)}><span>Total operating costs</span><span style={R}>{amt(t.p)}</span><span style={R}>{amt(t.pr)}</span><span style={R}>{chg(t.p, t.pr)}</span><span style={R}>{amt(t.y)}</span></div>
  </>)
}

function BalanceSheet({ d }) {
  const cols = 'minmax(0, 1fr) 160px'
  const by = type => d.balance_sheet.filter(x => x.type === type)
  const sum = arr => arr.reduce((s, x) => s + Number(x.amount), 0)
  const assets = sum(by('Asset')), liab = sum(by('Liability')), eq = sum(by('Equity')), costs = Number(d.costs_to_date)
  const Block = ({ title, items, total, extra }) => (<>
    <div style={{ fontSize: 12, fontWeight: 600, color: FIN.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 4px' }}>{title}</div>
    {items.map(x => <div key={x.heading} style={row(cols)}><span>{x.heading}</span><span style={R}>{amt(x.amount)}</span></div>)}
    {extra}
    <div style={row(cols, true, true)}><span>Total {title.toLowerCase()}</span><span style={R}>{amt(total)}</span></div>
  </>)
  return (<>
    <Block title="Assets" items={by('Asset')} total={assets} />
    <Block title="Liabilities" items={by('Liability')} total={liab} />
    <Block title="Funding & equity" items={by('Equity')} total={eq - costs}
      extra={<div style={row(cols)}><span>Less: operating costs to date</span><span style={R}>{amt(-costs)}</span></div>} />
    <div style={{ ...row(cols, true, true), marginTop: 10 }}><span>Liabilities + funding</span><span style={R}>{amt(liab + eq - costs)}</span></div>
    <div style={{ fontSize: 12, marginTop: 8, color: Math.abs(assets - (liab + eq - costs)) < 0.01 ? FIN.good : FIN.bad, fontWeight: 600 }}>
      {Math.abs(assets - (liab + eq - costs)) < 0.01 ? 'Balances ✓' : `Out of balance by ${money(assets - (liab + eq - costs))}`}
    </div>
  </>)
}

function TrialBalance({ d }) {
  const cols = '70px minmax(0, 1fr) 120px 120px 120px 130px'
  const t = d.trial_balance.reduce((a, r) => ({ dr: a.dr + Number(r.debit), cr: a.cr + Number(r.credit) }), { dr: 0, cr: 0 })
  return (<div style={{ overflowX: 'auto' }}><div style={{ minWidth: 720 }}>
    <div style={head(cols)}><span>Code</span><span>Account</span><span style={R}>Opening</span><span style={R}>Debits</span><span style={R}>Credits</span><span style={R}>Closing</span></div>
    {d.trial_balance.map(r => (
      <div key={r.id} style={row(cols)}><span style={{ color: FIN.muted }}>{r.code}</span><span>{r.name}<span style={{ display: 'block', fontSize: 11, color: FIN.faint }}>{r.type} · {r.heading}</span></span>
        <span style={R}>{amt(r.opening)}</span><span style={R}>{Number(r.debit) ? money(r.debit) : ''}</span><span style={R}>{Number(r.credit) ? money(r.credit) : ''}</span><span style={{ ...R, fontWeight: 600 }}>{amt(r.closing)}</span></div>
    ))}
    <div style={row(cols, true, true)}><span /><span>Totals for the period</span><span /><span style={R}>{money(t.dr)}</span><span style={R}>{money(t.cr)}</span><span style={{ ...R, color: Math.abs(t.dr - t.cr) < 0.01 ? FIN.good : FIN.bad }}>{Math.abs(t.dr - t.cr) < 0.01 ? 'Balanced ✓' : 'Out by ' + money(t.dr - t.cr)}</span></div>
  </div></div>)
}

function CashFlow({ d }) {
  const cols = 'minmax(0, 1fr) 160px'
  const ins = d.cash_flow.filter(x => Number(x.amount) > 0), outs = d.cash_flow.filter(x => Number(x.amount) < 0)
  const sum = a => a.reduce((s, x) => s + Number(x.amount), 0)
  return (<>
    <div style={row(cols, true)}><span>Cash & bank at the start</span><span style={R}>{amt(d.cash_opening)}</span></div>
    <div style={{ fontSize: 12, fontWeight: 600, color: FIN.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 4px' }}>Money in</div>
    {ins.length === 0 && <div style={{ fontSize: 13, color: FIN.muted, padding: '4px 0' }}>None</div>}
    {ins.map(x => <div key={x.heading} style={row(cols)}><span>{x.heading}</span><span style={{ ...R, color: FIN.good }}>{amt(x.amount)}</span></div>)}
    <div style={{ fontSize: 12, fontWeight: 600, color: FIN.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 4px' }}>Money out</div>
    {outs.length === 0 && <div style={{ fontSize: 13, color: FIN.muted, padding: '4px 0' }}>None</div>}
    {outs.map(x => <div key={x.heading} style={row(cols)}><span>{x.heading}</span><span style={R}>{amt(x.amount)}</span></div>)}
    <div style={row(cols, true, true)}><span>Net movement</span><span style={R}>{amt(sum(d.cash_flow))}</span></div>
    <div style={row(cols, true)}><span>Cash & bank at the end</span><span style={R}>{amt(d.cash_closing)}</span></div>
    <div style={{ fontSize: 12, color: FIN.faint, marginTop: 8 }}>Each bank or cash movement is shown under the account on the other side of the journal (e.g. supplier payments under Trade payables). Opening balances count as opening cash.</div>
  </>)
}

function CsvButton({ tab, d, name }) {
  function go() {
    if (tab === 'costs') exportCsv(`${name}.csv`, ['Heading', 'This period', 'Period before', 'Year to date'], d.costs.map(c => [c.heading, c.period, c.prior, c.ytd]))
    if (tab === 'bs') exportCsv(`${name}.csv`, ['Type', 'Heading', 'Amount'], [...d.balance_sheet.map(x => [x.type, x.heading, x.amount]), ['Equity', 'Less: operating costs to date', -Number(d.costs_to_date)]])
    if (tab === 'tb') exportCsv(`${name}.csv`, ['Code', 'Account', 'Type', 'Opening', 'Debits', 'Credits', 'Closing'], d.trial_balance.map(r => [r.code, r.name, r.type, r.opening, r.debit, r.credit, r.closing]))
    if (tab === 'cash') exportCsv(`${name}.csv`, ['Heading', 'Amount'], [['Opening cash', d.cash_opening], ...d.cash_flow.map(x => [x.heading, x.amount]), ['Closing cash', d.cash_closing]])
  }
  return <button style={{ ...finBtn2, minHeight: 36 }} onClick={go}>Export CSV</button>
}

const GROUPS = [['heading', 'Cost heading'], ['account', 'Account'], ['cost_centre', 'Cost centre'], ['project', 'Project'], ['month', 'Month'], ['source', 'Where it came from']]
function Explorer({ siteId, range, period }) {
  const [group, setGroup] = useState('heading')
  const [heading, setHeading] = useState('')
  const [rows, setRows] = useState(null)
  const [headings, setHeadings] = useState([])
  useEffect(() => {
    supabase.rpc('fin_explore', { p_site: siteId, p_from: range[0], p_to: range[1], p_group: 'heading', p_heading: null }).then(({ data }) => setHeadings((data || []).map(r => r.label)))
  }, [siteId, range])
  useEffect(() => {
    setRows(null)
    supabase.rpc('fin_explore', { p_site: siteId, p_from: range[0], p_to: range[1], p_group: group, p_heading: heading || null }).then(({ data, error }) => {
      if (error) return showToast(error.message, 'red')
      setRows(data || [])
    })
  }, [siteId, range, group, heading])
  const max = useMemo(() => Math.max(1, ...(rows || []).map(r => Math.abs(Number(r.amount)))), [rows])
  const total = (rows || []).reduce((s, r) => s + Number(r.amount), 0)
  return (
    <section style={{ ...finCard, padding: '22px 26px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>Explorer</h2><div style={{ fontSize: 13, color: FIN.muted }}>Costs · {period}</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: FIN.muted }}>Group by<br /><select value={group} onChange={e => setGroup(e.target.value)} style={finInput}>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={{ fontSize: 12, color: FIN.muted }}>Only<br /><select value={heading} onChange={e => setHeading(e.target.value)} style={finInput}><option value="">All costs</option>{headings.map(h => <option key={h} value={h}>{h}</option>)}</select></label>
          <button style={{ ...finBtn2, alignSelf: 'flex-end', minHeight: 40 }} onClick={() => exportCsv(`explore-${group}-${range[0]}-${range[1]}.csv`, [GROUPS.find(g => g[0] === group)[1], 'Amount', 'Ledger lines'], (rows || []).map(r => [r.label, r.amount, r.lines]))}>Export CSV</button>
        </div>
      </div>
      {rows === null ? <div style={{ color: FIN.muted }}>Loading…</div> : rows.length === 0 ? <div style={{ fontSize: 13, color: FIN.muted }}>No costs posted in this period.</div> : (<>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(0, 2fr) 130px', gap: 12, alignItems: 'center', fontSize: 14 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>{r.label}</span>
            <div style={{ height: 14, background: FIN.lineSoft, borderRadius: 4 }}><div title={`${r.lines} ledger line(s)`} style={{ width: `${Math.max(1, (Math.abs(Number(r.amount)) / max) * 100)}%`, height: 14, background: FIN.blue, borderRadius: 4 }} /></div>
            <b style={R}>${money(r.amount)}</b>
          </div>
        ))}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(0, 2fr) 130px', gap: 12, borderTop: `2px solid ${FIN.ink}`, paddingTop: 8, fontSize: 14, fontWeight: 600 }}><span>Total</span><span /><span style={R}>${money(total)}</span></div>
      </>)}
    </section>
  )
}
