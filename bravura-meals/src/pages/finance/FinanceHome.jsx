import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { FIN, finCard, money, useFinanceFonts } from '../../utils/financeTheme'

// FI12 — Finance Home (Finance rewrite Phase 4, issue #49; data from fin_home() in migration 0207).
// Layout follows the agreed mock-up: setup banner → four key figures → 12-month spend vs budget with
// "Needs attention" → where the money went / cost by site / projects → payments due in 14 days.
const usd = n => '$' + Math.round(Number(n || 0)).toLocaleString('en-US')
const short = n => { const v = Math.abs(Number(n || 0)); return v >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(n / 1e3).toFixed(v >= 1e5 ? 0 : 1)}k` : usd(n) }
// Widgets people can reorder or hide (layout per person in finance_home_layouts, 0210), plus
// saved Explorer views added from Reports → Explorer.
const BUILTIN = [
  { key: 'kpis', label: 'Key figures' }, { key: 'trend', label: 'Spend vs budget & needs attention' },
  { key: 'breakdowns', label: 'Where the money went, sites and projects' }, { key: 'upcoming', label: 'Payments due' },
]
const ctl = { minHeight: 32, padding: '0 10px', borderRadius: 8, border: `1px solid ${FIN.field}`, background: '#fff', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', color: FIN.ink }
export function periodRange(p) {
  const t = new Date(); const y = t.getFullYear(), m = t.getMonth(); const iso = d => d.toISOString().slice(0, 10)
  if (p === 'last_month') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
  if (p === 'quarter') { const q = Math.floor(m / 3) * 3; return [iso(new Date(y, q, 1)), iso(new Date(y, q + 3, 0))] }
  if (p === 'ytd') return [iso(new Date(y, 0, 1)), iso(t)]
  return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
}
const MATCH = { matched: ['PO · GRN · bill', FIN.good], price_diff: ['Price differs', FIN.ochreText], qty_diff: ['Qty differs', FIN.ochreText],
  no_grn: ['Not received', FIN.bad], service: ['No PO (service)', FIN.muted], not_checked: ['Not checked', FIN.muted] }

export default function FinanceHome({ setPage }) {
  useFinanceFonts()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  const { profile } = useAuth()
  const [layout, setLayout] = useState({})
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!profile?.id) return
    supabase.from('finance_home_layouts').select('layout').eq('user_id', profile.id).maybeSingle().then(({ data }) => setLayout(data?.layout || {}))
  }, [profile?.id])
  const saveLayout = useCallback(async next => {
    setLayout(next)
    const { error } = await supabase.from('finance_home_layouts').upsert({ user_id: profile.id, layout: next, updated_at: new Date().toISOString() })
    if (error) showToast(error.message, 'red')
  }, [profile?.id])
  const move = (order, k, dir) => {
    const hidden = new Set(layout.hidden || []); const vis = order.filter(x => !hidden.has(x))
    const i = vis.indexOf(k), j = i + dir; if (j < 0 || j >= vis.length) return
    ;[vis[i], vis[j]] = [vis[j], vis[i]]
    saveLayout({ ...layout, order: [...vis, ...order.filter(x => hidden.has(x))] })
  }
  const removeView = id => saveLayout({ ...layout, views: (layout.views || []).filter(v => v.id !== id), order: (layout.order || []).filter(k => k !== 'view:' + id) })

  useEffect(() => {
    if (!currentSiteId || !can('finance.view')) return
    setD(null); setErr(null)
    supabase.rpc('fin_home', { p_site: currentSiteId, p_month: `${month}-01` }).then(({ data, error }) => {
      if (error) { setErr(error.message); showToast(error.message, 'red') } else setD(data)
    })
  }, [currentSiteId, month, can])

  if (!can('finance.view')) return <Denied />
  const monthName = new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  const card = { ...finCard, display: 'flex', flexDirection: 'column', gap: 6 }
  const h2 = { margin: 0, fontSize: 16, fontWeight: 600 }
  const link = { background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, textAlign: 'left' }

  return (
    <div style={{ fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px', minHeight: '100%', fontVariantNumeric: 'tabular-nums', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: FIN.muted }}>Finance · {currentSite?.name}</div>
          <h1 style={{ margin: '4px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 32, letterSpacing: '-0.01em' }}>{monthName} at a glance</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setEditing(e => !e)} aria-pressed={editing} style={{ minHeight: 40, padding: '0 14px', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
          ...(editing ? { border: 'none', background: FIN.maroon, color: '#fff', fontWeight: 600 } : { border: `1px solid ${FIN.line}`, background: '#fff', color: FIN.ink }) }}>{editing ? 'Done' : 'Customise'}</button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: FIN.muted }}>Month
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}
            style={{ minHeight: 40, padding: '6px 10px', borderRadius: 10, border: `1px solid ${FIN.line}`, background: '#fff', fontFamily: 'inherit', fontSize: 14, color: FIN.ink }} />
        </label>
        </div>
      </header>

      {err && <div style={{ ...finCard, color: FIN.bad }}>{err}</div>}
      {!d && !err && <div style={{ color: FIN.muted }}>Loading…</div>}
      {d && (() => {
        const W = {
          kpis: (
        <section aria-label="Key figures" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          <div style={card}>
            <div style={{ fontSize: 13, color: FIN.muted }}>Spent this month</div>
            <div style={{ fontFamily: FIN.serif, fontSize: 32, fontWeight: 600 }}>{usd(d.spent)}</div>
            {d.budget > 0 ? <>
              <div style={{ height: 8, background: FIN.lineSoft, borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (d.spent / d.budget) * 100)}%`, height: 8, background: d.spent > d.budget ? FIN.bad : FIN.ochre }} />
              </div>
              <div style={{ fontSize: 12, color: FIN.muted }}>{Math.round((d.spent / d.budget) * 100)}% of {usd(d.budget)} budget{d.days_left ? ` · ${d.days_left} days left` : ''}</div>
            </> : <button style={{ ...link, fontSize: 12 }} onClick={() => setPage('fi_budgets')}>No budget set — set budgets →</button>}
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, color: FIN.muted }}>Cash &amp; bank</div>
            <div style={{ fontFamily: FIN.serif, fontSize: 32, fontWeight: 600 }}>{usd(d.cash_bank)}</div>
            <div style={{ fontSize: 12, color: FIN.muted }}>{d.bank_count} bank account{d.bank_count === 1 ? '' : 's'} in the ledger{d.setup?.opening_is_mock ? ' · MOCK opening figures' : ''}</div>
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, color: FIN.muted }}>Owed to suppliers</div>
            <div style={{ fontFamily: FIN.serif, fontSize: 32, fontWeight: 600 }}>{usd(d.owed)}</div>
            <div style={{ display: 'flex', gap: 10, fontSize: 12, color: FIN.muted, flexWrap: 'wrap' }}>
              <span><b style={{ color: d.overdue ? FIN.bad : FIN.ink }}>{usd(d.overdue)}</b> overdue</span><span><b style={{ color: FIN.ink }}>{usd(d.due_7)}</b> next 7 days</span>
            </div>
            <button style={{ ...link, fontSize: 12 }} onClick={() => setPage('fi_pay_suppliers')}>Plan a payment run →</button>
          </div>
          <div style={card}>
            <div style={{ fontSize: 13, color: FIN.muted }}>Petty cash on hand</div>
            <div style={{ fontFamily: FIN.serif, fontSize: 32, fontWeight: 600 }}>{usd(d.petty_cash)}</div>
            <div style={{ fontSize: 12, color: FIN.muted }}>{d.petty_funds} fund{d.petty_funds === 1 ? '' : 's'}</div>
            {d.petty_low > 0 && <div style={{ fontSize: 12, color: FIN.ochreText, fontWeight: 600 }}>{d.petty_low} fund{d.petty_low === 1 ? '' : 's'} running low</div>}
          </div>
        </section>
          ),
          trend: (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div style={{ ...finCard, gridColumn: 'span 2', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={h2}>Spend vs budget, last 12 months</h2>
              <div style={{ display: 'flex', gap: 14, fontSize: 12, color: FIN.muted }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#9DB3D1' }} />Spend</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 14, borderTop: `2px dashed ${FIN.ochre}` }} />Budget</span>
              </div>
            </div>
            <TrendChart data={d.trend || []} />
          </div>
          <Attention a={d.attention} setPage={setPage} />
        </section>
          ),
          breakdowns: (
        <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={h2}>Where the money went</h2>
            {(d.categories || []).length === 0 && <div style={{ fontSize: 13, color: FIN.muted }}>No costs posted this month yet.</div>}
            {(d.categories || []).slice(0, 7).map(c => {
              const top = Number(d.categories[0].amount) || 1
              return (
                <div key={c.name} style={{ fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{c.name}</span><b>{usd(c.amount)}</b></div>
                  <div style={{ height: 6, background: FIN.lineSoft, borderRadius: 3, marginTop: 4 }}><div style={{ width: `${Math.max(2, (c.amount / top) * 100)}%`, height: 6, background: FIN.blue, borderRadius: 3 }} /></div>
                </div>
              )
            })}
          </div>

          <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={h2}>Cost by site this month</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 100px 60px', fontSize: 12, color: FIN.muted, padding: '4px 0' }}><span>Site</span><span style={{ textAlign: 'right' }}>Spent</span><span style={{ textAlign: 'right' }}>Budget</span></div>
            {(d.sites || []).map(s => {
              const pct = s.budget > 0 ? Math.round((s.spent / s.budget) * 100) : null
              return (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 100px 60px', fontSize: 13, padding: '8px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontWeight: s.current ? 600 : 400 }}>
                  <span>{s.name}</span><span style={{ textAlign: 'right' }}>{usd(s.spent)}</span>
                  <span style={{ textAlign: 'right', fontWeight: 600, color: pct == null ? FIN.muted : pct > 100 ? FIN.bad : pct >= 90 ? FIN.ochreText : FIN.good }}>{pct == null ? '—' : `${pct}%`}</span>
                </div>
              )
            })}
            <div style={{ fontSize: 12, color: FIN.muted }}>Total {usd((d.sites || []).reduce((t, s) => t + Number(s.spent), 0))} across the sites you can see</div>
          </div>

          <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 style={h2}>Projects</h2>
            {(d.projects || []).length === 0 && <div style={{ fontSize: 13, color: FIN.muted }}>No active projects at this site.</div>}
            {(d.projects || []).map(p => {
              const pct = p.budget > 0 ? Math.round((p.spent / p.budget) * 100) : null
              return (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 124px 56px', alignItems: 'center', gap: 6, fontSize: 13, padding: '6px 0', borderTop: `1px solid ${FIN.lineSoft}` }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <Sparkline values={p.weeks || []} color={pct != null && pct > 100 ? FIN.bad : FIN.blue} />
                  <span style={{ textAlign: 'right', fontWeight: 600, color: pct != null && pct > 100 ? FIN.bad : FIN.ink }}>{pct == null ? short(p.spent) : `${pct}%`}</span>
                </div>
              )
            })}
            <div style={{ fontSize: 12, color: FIN.muted }}>Weekly cost trend · % of the year's project budget used</div>
          </div>
        </section>
          ),
          upcoming: (
        <section style={finCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
            <h2 style={h2}>Payments due in the next 14 days</h2>
            <button style={link} onClick={() => setPage('fi_pay_suppliers')}>All bills →</button>
          </div>
          {(d.upcoming || []).length === 0 ? <div style={{ fontSize: 13, color: FIN.muted }}>Nothing due in the next two weeks.</div> : (
            <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1.4fr) minmax(0, 1fr) 130px 130px', fontSize: 12, color: FIN.muted, padding: '6px 0' }}><span>Due</span><span>Supplier</span><span>For</span><span style={{ textAlign: 'right' }}>Amount</span><span style={{ textAlign: 'right' }}>Match</span></div>
              {d.upcoming.map(u => {
                const late = u.due_date < new Date().toISOString().slice(0, 10); const m = MATCH[u.match] || MATCH.not_checked
                return (
                  <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1.4fr) minmax(0, 1fr) 130px 130px', fontSize: 14, padding: '10px 0', borderTop: `1px solid ${FIN.lineSoft}`, alignItems: 'center' }}>
                    <span style={{ color: late ? FIN.bad : FIN.ink, fontWeight: late ? 600 : 400 }}>{late ? 'Overdue' : new Date(u.due_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                    <span>{u.supplier}</span><span style={{ color: FIN.muted }}>{u.reference}</span>
                    <b style={{ textAlign: 'right' }}>${money(u.amount)}</b>
                    <span style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: m[1] }}>{u.status === 'pending_approval' ? 'Awaiting approval' : m[0]}</span>
                  </div>
                )
              })}
            </div></div>
          )}
        </section>
          ),
        }
        const views = layout.views || []
        const all = [...BUILTIN.map(b => b.key), ...views.map(v => 'view:' + v.id)]
        const order = [...(layout.order || []).filter(k => all.includes(k)), ...all.filter(k => !(layout.order || []).includes(k))]
        const hidden = new Set(layout.hidden || [])
        const shown = order.filter(k => !hidden.has(k))
        const label = k => k.startsWith('view:') ? (views.find(v => 'view:' + v.id === k)?.title || 'Saved view') : BUILTIN.find(b => b.key === k)?.label
        return <>
          <SetupBanner s={d.setup} setPage={setPage} />
          {shown.map((k, i) => (
            <div key={k} style={{ position: 'relative', ...(editing ? { outline: `2px dashed ${FIN.field}`, outlineOffset: 6, borderRadius: 14 } : {}) }}>
              {editing && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: FIN.muted, marginRight: 'auto', fontWeight: 600 }}>{label(k)}</span>
                  <button aria-label={`Move ${label(k)} up`} disabled={i === 0} onClick={() => move(order, k, -1)} style={ctl}>↑</button>
                  <button aria-label={`Move ${label(k)} down`} disabled={i === shown.length - 1} onClick={() => move(order, k, 1)} style={ctl}>↓</button>
                  {k.startsWith('view:')
                    ? <button onClick={() => removeView(k.slice(5))} style={{ ...ctl, color: FIN.bad }}>Remove</button>
                    : <button onClick={() => saveLayout({ ...layout, order, hidden: [...hidden, k] })} style={ctl}>Hide</button>}
                </div>
              )}
              {k.startsWith('view:') ? <SavedView view={views.find(v => 'view:' + v.id === k)} siteId={currentSiteId} setPage={setPage} /> : W[k]}
            </div>
          ))}
          {editing && hidden.size > 0 && (
            <div style={{ ...finCard, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: FIN.muted }}>Hidden:</span>
              {[...hidden].filter(k => all.includes(k)).map(k => <button key={k} onClick={() => saveLayout({ ...layout, order, hidden: [...hidden].filter(x => x !== k) })} style={ctl}>Show {label(k)}</button>)}
            </div>
          )}
          {editing && <div style={{ fontSize: 12, color: FIN.faint }}>Add your own widgets from Reports → Explorer with “Add to Finance Home”.</div>}
        </>
      })()}
    </div>
  )
}

function SetupBanner({ s, setPage }) {
  if (!s) return null
  const mock = s.opening_is_mock
  if (s.go_live_date && !mock) return null
  return (
    <section aria-label="Setup" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', background: FIN.ochreTint, border: `1px solid ${FIN.ochreLine}`, borderRadius: 12, padding: '12px 16px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: '#6B4208' }}>{s.go_live_date ? 'Running on MOCK opening balances' : 'Finish setting up the books'}</div>
      <div style={{ fontSize: 13, color: '#6B4208', flex: 1, minWidth: 220 }}>
        {s.go_live_date
          ? `Live since ${s.go_live_date} for testing. Bank and asset figures include test amounts — clear them and enter the real balances before relying on these numbers.`
          : `${s.accounts ? `${s.accounts} accounts` : 'No chart of accounts yet'} · posting rules ${s.rules} of ${s.events} · opening balances ${s.opening_journal_id ? 'entered' : 'not entered'}. Ledger postings start once the books go live.`}
      </div>
      <button onClick={() => setPage('fi_setup')} style={{ minHeight: 36, padding: '0 14px', borderRadius: 8, border: 'none', background: FIN.maroon, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        {s.go_live_date ? 'Open setup' : 'Continue setup'}
      </button>
    </section>
  )
}

function Attention({ a, setPage }) {
  const items = [
    a.overdue_bills && { tone: FIN.bad, title: `${a.overdue_bills} bill${a.overdue_bills === 1 ? '' : 's'} overdue`, sub: 'Past the supplier due date', go: 'fi_pay_suppliers' },
    a.budgets_over_90 && { tone: FIN.ochre, title: `${a.budgets_over_90} budget${a.budgets_over_90 === 1 ? '' : 's'} at 90% or more`, sub: 'Spent plus committed this year', go: 'fi_budgets' },
    a.mismatched_bills && { tone: FIN.ochre, title: `${a.mismatched_bills} bill${a.mismatched_bills === 1 ? " doesn't" : "s don't"} match`, sub: 'Price or quantity differs, or not received', go: 'fi_pay_suppliers' },
    a.runs_to_approve && { tone: FIN.blue, title: `${a.runs_to_approve} payment run${a.runs_to_approve === 1 ? '' : 's'} to approve`, sub: 'Prepared and waiting for approval', go: 'fi_pay_suppliers' },
    a.claims_waiting && { tone: FIN.blue, title: `${a.claims_waiting} expense claim${a.claims_waiting === 1 ? '' : 's'} waiting`, sub: 'Submitted for approval', go: 'fi_expense_claims' },
    a.waiting_postings && { tone: FIN.blue, title: `${a.waiting_postings} posting${a.waiting_postings === 1 ? '' : 's'} waiting`, sub: 'Usually a missing posting rule', go: 'fi_posting_rules' },
    a.depreciation_due && { tone: FIN.blue, title: 'Depreciation not run this month', sub: 'Needed before month-end close', go: 'fi_asset_depreciation' },
  ].filter(Boolean)
  return (
    <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>Needs attention</h2>
      {items.length === 0 && <div style={{ fontSize: 13, color: FIN.good, fontWeight: 600, padding: '8px 0' }}>Nothing needs attention right now.</div>}
      {items.map(i => (
        <button key={i.title} onClick={() => setPage(i.go)} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '10px 0', borderTop: `1px solid ${FIN.lineSoft}`, borderLeft: 'none', borderRight: 'none', borderBottom: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', color: FIN.ink }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: i.tone, marginTop: 6, flexShrink: 0 }} />
          <span><span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{i.title}</span><span style={{ fontSize: 12, color: FIN.muted }}>{i.sub}</span></span>
        </button>
      ))}
    </div>
  )
}

function TrendChart({ data }) {
  const W = 770, H = 220, L = 52, T = 14
  const max = useMemo(() => {
    const m = Math.max(1, ...data.map(x => Math.max(Number(x.spent), Number(x.budget))))
    const mag = Math.pow(10, Math.floor(Math.log10(m))); return Math.ceil(m / mag) * mag
  }, [data])
  if (!data.length) return null
  const cw = (W - L) / data.length, bw = Math.min(30, cw * 0.6)
  const y = v => T + H - (Number(v) / max) * H
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max)
  const hasBudget = data.some(x => Number(x.budget) > 0)
  const last = data[data.length - 1]
  return (
    <svg viewBox={`0 0 ${W + 10} ${H + 44}`} width="100%" role="img" aria-label={`Monthly spend for the last 12 months, latest ${short(last.spent)}`} style={{ display: 'block', marginTop: 10 }}>
      {ticks.map(t => (<g key={t}><line x1={L} x2={W} y1={y(t)} y2={y(t)} stroke={FIN.line} strokeWidth="1" />
        <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={FIN.muted}>{short(t)}</text></g>))}
      {data.map((x, i) => {
        const bx = L + i * cw + (cw - bw) / 2, isLast = i === data.length - 1
        return (<g key={x.start}>
          <rect x={bx} y={y(x.spent)} width={bw} height={Math.max(0, T + H - y(x.spent))} rx="4" fill={isLast ? FIN.blue : '#9DB3D1'}><title>{`${x.month}: ${usd(x.spent)} spent${Number(x.budget) ? ` of ${usd(x.budget)}` : ''}`}</title></rect>
          <text x={bx + bw / 2} y={T + H + 18} textAnchor="middle" fontSize="11" fill={isLast ? FIN.ink : FIN.muted} fontWeight={isLast ? 600 : 400}>{x.month}</text>
        </g>)
      })}
      {hasBudget && <polyline points={data.map((x, i) => `${L + i * cw + cw / 2},${y(x.budget)}`).join(' ')} fill="none" stroke={FIN.ochre} strokeWidth="2" strokeDasharray="6 4" />}
      {Number(last.spent) > 0 && <text x={L + (data.length - 1) * cw + cw / 2} y={Math.max(12, y(last.spent) - 6)} textAnchor="middle" fontSize="11" fontWeight="600" fill={FIN.blue}>{short(last.spent)}</text>}
    </svg>
  )
}

function Sparkline({ values, color }) {
  const w = 120, h = 28
  if (!values.length) return <span />
  const max = Math.max(...values.map(Number)), min = Math.min(...values.map(Number)), span = max - min || 1
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - 2 - ((Number(v) - min) / span) * (h - 6)}`).join(' ')
  return <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><polyline points={pts} fill="none" stroke={max === 0 ? FIN.line : color} strokeWidth="2" /></svg>
}

// A saved Explorer view as a Finance Home widget.
const PERIOD_LABEL = { this_month: 'This month', last_month: 'Last month', quarter: 'This quarter', ytd: 'Year to date' }
function SavedView({ view, siteId, setPage }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    if (!view) return
    const [from, to] = periodRange(view.period)
    supabase.rpc('fin_explore', { p_site: siteId, p_from: from, p_to: to, p_group: view.group, p_heading: view.heading || null })
      .then(({ data }) => setRows(data || []))
  }, [view, siteId])
  if (!view) return null
  const max = Math.max(1, ...(rows || []).map(r => Math.abs(Number(r.amount))))
  return (
    <section style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{view.title}</h2>
        <button onClick={() => setPage('fi_reports')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>{PERIOD_LABEL[view.period] || ''} · open Explorer →</button>
      </div>
      {rows === null ? <div style={{ fontSize: 13, color: FIN.muted }}>Loading…</div> : rows.length === 0 ? <div style={{ fontSize: 13, color: FIN.muted }}>No costs in this period yet.</div> :
        rows.slice(0, 8).map(r => (
          <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(0, 2fr) 110px', gap: 10, alignItems: 'center', fontSize: 13 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
            <div style={{ height: 10, background: FIN.lineSoft, borderRadius: 4 }}><div style={{ width: `${Math.max(1, (Math.abs(Number(r.amount)) / max) * 100)}%`, height: 10, background: FIN.blue, borderRadius: 4 }} /></div>
            <b style={{ textAlign: 'right' }}>{usd(r.amount)}</b>
          </div>
        ))}
    </section>
  )
}
