import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import Denied from '../../components/Denied'
import { useAskContext } from '../../components/AskBravura'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, money } from '../../utils/financeTheme'

// PR01 — Procurement Home (issue #51). What needs doing, across the sites the person looks after.
const TILES = [
  { key: 'requests_to_approve', group: 'Requests', label: 'Requests to approve', page: 'proc_requisitions', tone: 'warn' },
  { key: 'requests_to_order',   group: 'Requests', label: 'Approved, not ordered', page: 'proc_requisitions', tone: 'warn' },
  { key: 'transfers_to_send',   group: 'Requests', label: 'Transfers to send', page: 'proc_requisitions' },
  { key: 'pos_to_approve',      group: 'Orders', label: 'POs to approve', page: 'proc_orders', tone: 'warn' },
  { key: 'pos_draft',           group: 'Orders', label: 'Draft POs', page: 'proc_orders' },
  { key: 'pos_waiting',         group: 'Deliveries', label: 'Waiting for delivery', page: 'proc_orders' },
  { key: 'not_acknowledged',    group: 'Orders', label: 'Not confirmed by supplier', page: 'proc_orders', tone: 'warn' },
  { key: 'late_deliveries',     group: 'Deliveries', label: 'Late deliveries', page: 'proc_orders', tone: 'bad' },
  { key: 'received_not_billed', group: 'Deliveries', label: 'Received, not billed', page: 'proc_grn' },
]

export default function ProcHome({ setPage }) {
  const { can } = usePermissions()
  const sc = useSiteScope()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [ins, setIns] = useState(null)

  useEffect(() => {
    if (!sc.siteIds.length) return
    let live = true
    setData(null); setErr(null); setIns(null)
    supabase.rpc('proc_home_insights', { p_site_ids: sc.siteIds }).then(({ data }) => { if (live) setIns(data || {}) })
    supabase.rpc('proc_home', { p_site_ids: sc.siteIds }).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(error.message); else setData(data)
    })
    return () => { live = false }
  }, [sc.siteIds])

  useAskContext(data ? { screen: 'Procurement Home', sites: sc.label, counts_waiting: data.tiles, ordered_this_month_vs_budget_by_site: data.spend_by_site,
    needs_attention: data.attention, insights: ins } : { screen: 'Procurement Home', loading: true })
  if (!can('procurement.view') && !can('inventory.view')) return <Denied />
  const t = data?.tiles || {}
  const maxSpend = Math.max(1, ...(data?.spend_by_site || []).map(s => Math.max(Number(s.ordered), Number(s.budget))))

  return (
    <ProcShell title="Procurement Home" subtitle="Requests, orders and deliveries that need someone" setPage={setPage} siteText={sc.label}
      actions={<>
        <SiteScopeToggle {...sc} siteName={sc.sites.find(s => s.id === sc.siteIds[0])?.name} />
        <button style={finBtn} onClick={() => setPage('proc_requisitions')}>New request</button>
      </>}>
      {err && <div role="alert" style={{ ...finCard, color: FIN.bad }}>{err}</div>}

      {t.mine_open > 0 && (
        <button onClick={() => setPage('proc_requisitions')} style={{ ...finCard, width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14, background: FIN.blueTint, borderColor: '#C9D7EA' }}>
          <span style={{ fontSize: 14, color: FIN.ink }}>You have <b>{t.mine_open}</b> open request{t.mine_open > 1 ? 's' : ''}</span>
          <span style={{ color: FIN.blue, fontSize: 13, fontWeight: 600 }}>See them →</span>
        </button>
      )}

      <Headline ins={ins} />

      {['Requests', 'Orders', 'Deliveries'].map(g => (
      <section key={g} aria-label={g} style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: FIN.faint, margin: '0 0 8px 2px' }}>{g}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
        {TILES.filter(x => x.group === g).map(x => {
          const n = data ? Number(t[x.key] || 0) : null
          const hot = n > 0 && x.tone
          const color = hot ? (x.tone === 'bad' ? FIN.bad : FIN.ochreText) : FIN.ink
          return (
            <button key={x.key} onClick={() => setPage(x.page)} style={{ ...finCard, textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: '14px 16px',
              borderColor: hot ? (x.tone === 'bad' ? '#E8B4B0' : FIN.ochreLine) : FIN.line, background: hot ? (x.tone === 'bad' ? '#FDF3F2' : FIN.ochreTint) : FIN.card }}>
              <div style={{ fontSize: 12.5, color: FIN.muted }}>{x.label}</div>
              <div style={{ fontSize: 30, fontWeight: 600, color, marginTop: 4, fontFamily: FIN.serif }}>{n == null ? '·' : n}</div>
            </button>
          )
        })}
        </div>
      </section>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 4 }}>
        <Trend ins={ins} />
        <TopSuppliers ins={ins} />
      </div>
      <Pipeline ins={ins} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 16 }}>
        <section aria-label="Ordered this month by site" style={finCard}>
          <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Ordered this month</h2>
          <div style={{ fontSize: 12.5, color: FIN.muted, marginBottom: 12 }}>Approved POs by site against this month's budget</div>
          {!data ? <div style={{ color: FIN.faint, fontSize: 13 }}>Loading…</div> : (data.spend_by_site || []).map(s => {
            const over = Number(s.budget) > 0 && Number(s.ordered) > Number(s.budget)
            return (
              <div key={s.site_id} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{s.site}</span>
                  <span style={{ color: over ? FIN.bad : FIN.muted }}>${money(s.ordered)}{Number(s.budget) > 0 ? ` of $${money(s.budget)}` : ' · no budget'}</span>
                </div>
                <div style={{ position: 'relative', height: 10, borderRadius: 5, background: FIN.lineSoft }}>
                  <div style={{ width: `${Math.min(100, Number(s.ordered) / maxSpend * 100)}%`, height: '100%', borderRadius: 5, background: over ? FIN.bad : FIN.blue }} />
                  {Number(s.budget) > 0 && <div title="Budget" style={{ position: 'absolute', top: -3, bottom: -3, width: 2, left: `${Math.min(100, Number(s.budget) / maxSpend * 100)}%`, background: FIN.ochre }} />}
                </div>
              </div>
            )
          })}
        </section>

        <section aria-label="Needs attention" style={finCard}>
          <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Needs attention</h2>
          {!data ? <div style={{ color: FIN.faint, fontSize: 13 }}>Loading…</div> : (data.attention || []).length === 0 ? (
            <div style={{ color: FIN.good, fontSize: 13 }}>Nothing urgent, late or due this week.</div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {data.attention.map((a, i) => (
                <li key={i}>
                  <button onClick={() => setPage(a.page)} style={{ width: '100%', display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 6px', border: 'none',
                    background: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', borderBottom: `1px solid ${FIN.lineSoft}` }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0, background: a.kind === 'late' ? FIN.bad : a.kind === 'urgent' ? FIN.maroon : FIN.ochre }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13.5, color: FIN.ink, fontWeight: 600 }}>{a.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: FIN.muted }}>{a.detail}</span>
                    </span>
                    {sc.scope === 'all' && <span style={{ fontSize: 11.5, color: FIN.faint, whiteSpace: 'nowrap' }}>{a.site}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </ProcShell>
  )
}

// ── Insights (0225 proc_home_insights) ───────────────────────────────────────
const dollars = n => '$' + money(n)
function Headline({ ins }) {
  const m = Number(ins?.ordered_this_month || 0), prev = Number(ins?.ordered_last_month_to_date || 0)
  const delta = prev > 0 ? Math.round((m - prev) / prev * 100) : null
  const items = [
    { label: 'Ordered this month', value: ins ? dollars(m) : '·', note: delta == null ? 'vs same point last month: —' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs same point last month`, tone: delta > 20 ? FIN.ochreText : FIN.muted },
    { label: 'Still to be delivered', value: ins ? dollars(ins.open_commitment) : '·', note: `${ins?.open_orders ?? 0} open order${ins?.open_orders === 1 ? '' : 's'}` },
    { label: 'On-time deliveries', value: ins?.on_time_pct == null ? '—' : `${ins.on_time_pct}%`, note: `${ins?.deliveries_90d ?? 0} deliveries, last 90 days`, tone: ins?.on_time_pct != null && ins.on_time_pct < 80 ? FIN.bad : FIN.muted },
    { label: 'Average lead time', value: ins?.avg_lead_days == null ? '—' : `${ins.avg_lead_days} days`, note: `order to delivery · ${ins?.active_suppliers_90d ?? 0} suppliers used` },
  ]
  return (
    <section aria-label="Headline figures" style={{ ...finCard, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 18, overflow: 'hidden' }}>
      {items.map((x, i) => (
        <div key={x.label} style={{ padding: '16px 18px', borderLeft: i ? `1px solid ${FIN.lineSoft}` : 'none' }}>
          <div style={{ fontSize: 12.5, color: FIN.muted }}>{x.label}</div>
          <div style={{ fontSize: 26, fontWeight: 600, fontFamily: FIN.serif, color: FIN.ink, margin: '4px 0 2px', fontVariantNumeric: 'tabular-nums' }}>{x.value}</div>
          <div style={{ fontSize: 12, color: x.tone || FIN.muted }}>{x.note}</div>
        </div>
      ))}
    </section>
  )
}
function Trend({ ins }) {
  const t = ins?.trend || []
  const max = Math.max(1, ...t.map(x => Number(x.ordered)))
  const W = 320, H = 130, bw = W / Math.max(1, t.length)
  return (
    <section aria-label="Ordered, last 6 months" style={finCard}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Ordered, last 6 months</h2>
      <div style={{ fontSize: 12.5, color: FIN.muted, marginBottom: 10 }}>Value of approved purchase orders per month</div>
      {!ins ? <div style={{ color: FIN.faint, fontSize: 13 }}>Loading…</div> : t.every(x => !Number(x.ordered)) ? <Empty text="No approved orders in the last 6 months yet." /> : (
        <svg viewBox={`0 0 ${W} ${H + 34}`} width="100%" role="img" aria-label="Monthly ordered value" style={{ display: 'block' }}>
          {t.map((x, i) => {
            const h = Number(x.ordered) / max * H, last = i === t.length - 1
            return (
              <g key={x.month}>
                <title>{`${x.label}: ${dollars(x.ordered)}`}</title>
                <rect x={i * bw + bw * 0.18} y={H - h} width={bw * 0.64} height={Math.max(h, 1)} rx="3" fill={last ? FIN.maroon : FIN.blue} opacity={last ? 1 : 0.75} />
                <text x={i * bw + bw / 2} y={H + 14} textAnchor="middle" fontSize="11" fill={FIN.muted}>{x.label}</text>
                {Number(x.ordered) > 0 && <text x={i * bw + bw / 2} y={H + 28} textAnchor="middle" fontSize="10" fill={FIN.faint}>{Number(x.ordered) >= 1000 ? `$${Math.round(Number(x.ordered) / 1000)}k` : dollars(x.ordered)}</text>}
              </g>
            )
          })}
        </svg>
      )}
    </section>
  )
}
function TopSuppliers({ ins }) {
  const list = ins?.top_suppliers || [], tot = Number(ins?.total_90d || 0)
  return (
    <section aria-label="Top suppliers" style={finCard}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Top suppliers</h2>
      <div style={{ fontSize: 12.5, color: FIN.muted, marginBottom: 12 }}>Share of ordered value, last 90 days{tot ? ` · ${dollars(tot)} in total` : ''}</div>
      {!ins ? <div style={{ color: FIN.faint, fontSize: 13 }}>Loading…</div> : !list.length ? <Empty text="No orders in the last 90 days yet." /> : list.map(x => {
        const pct = tot ? Math.round(Number(x.ordered) / tot * 100) : 0
        return (
          <div key={x.supplier} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.supplier}</span>
              <span style={{ color: FIN.muted, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{dollars(x.ordered)} · {pct}%</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: FIN.lineSoft }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 4, background: FIN.blue }} /></div>
          </div>
        )
      })}
    </section>
  )
}
function Pipeline({ ins }) {
  const p = ins?.pipeline_30d || {}
  const steps = [['requested', 'Requested'], ['approved', 'Approved'], ['ordered', 'Ordered'], ['received', 'Received'], ['billed', 'Billed'], ['paid', 'Paid']]
  return (
    <section aria-label="Last 30 days" style={{ ...finCard, margin: '16px 0' }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>Last 30 days, request to payment</h2>
      <div style={{ fontSize: 12.5, color: FIN.muted, marginBottom: 12 }}>How many went through each step</div>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8 }}>
        {steps.map(([k, label], i) => (
          <li key={k} style={{ position: 'relative', padding: '10px 12px', borderRadius: 10, background: i % 2 ? FIN.lineSoft : FIN.blueTint }}>
            <div style={{ fontSize: 11.5, color: FIN.muted }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 600, fontFamily: FIN.serif, color: FIN.ink, fontVariantNumeric: 'tabular-nums' }}>{ins ? Number(p[k] || 0) : '·'}</div>
            {i < steps.length - 1 && <span aria-hidden="true" style={{ position: 'absolute', right: -7, top: '50%', transform: 'translateY(-50%)', color: FIN.faint, fontSize: 12 }}>›</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
function Empty({ text }) { return <div style={{ color: FIN.faint, fontSize: 13, padding: '18px 0' }}>{text}</div> }
