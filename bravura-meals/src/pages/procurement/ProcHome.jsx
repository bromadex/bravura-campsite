import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import Denied from '../../components/Denied'
import { useAskContext } from '../../components/AskBravura'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, money } from '../../utils/financeTheme'

// PR01 — Procurement Home (issue #51). What needs doing, across the sites the person looks after.
const TILES = [
  { key: 'requests_to_approve', label: 'Requests to approve', page: 'proc_requisitions', tone: 'warn' },
  { key: 'requests_to_order',   label: 'Approved, not ordered', page: 'proc_requisitions', tone: 'warn' },
  { key: 'transfers_to_send',   label: 'Transfers to send', page: 'proc_requisitions' },
  { key: 'pos_to_approve',      label: 'POs to approve', page: 'proc_orders', tone: 'warn' },
  { key: 'pos_draft',           label: 'Draft POs', page: 'proc_orders' },
  { key: 'pos_waiting',         label: 'Waiting for delivery', page: 'proc_orders' },
  { key: 'not_acknowledged',    label: 'Not confirmed by supplier', page: 'proc_orders', tone: 'warn' },
  { key: 'late_deliveries',     label: 'Late deliveries', page: 'proc_orders', tone: 'bad' },
  { key: 'received_not_billed', label: 'Received, not billed', page: 'proc_grn' },
]

export default function ProcHome({ setPage }) {
  const { can } = usePermissions()
  const sc = useSiteScope()
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!sc.siteIds.length) return
    let live = true
    setData(null); setErr(null)
    supabase.rpc('proc_home', { p_site_ids: sc.siteIds }).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(error.message); else setData(data)
    })
    return () => { live = false }
  }, [sc.siteIds])

  useAskContext(data ? { screen: 'Procurement Home', sites: sc.label, counts_waiting: data.tiles, ordered_this_month_vs_budget_by_site: data.spend_by_site,
    needs_attention: data.attention } : { screen: 'Procurement Home', loading: true })
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

      <section aria-label="Work waiting" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
        {TILES.map(x => {
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
      </section>

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
