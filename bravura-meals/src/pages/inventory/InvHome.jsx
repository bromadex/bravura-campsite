import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, finBtn2, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { useAskContext } from '../../components/AskBravura'

// IN01 — Stores dashboard (issue #59, I4; design agreed in the inventory review). Top half: what needs me today.
// Bottom half: is the stock healthy. All figures come from inv_home(site_ids).
const n = v => Number(v || 0)
const k = v => { const a = Math.abs(n(v)); return a >= 1e6 ? `$${(n(v) / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(n(v) / 1e3).toFixed(1)}k` : `$${n(v).toFixed(0)}` }
const qty = v => n(v).toLocaleString('en-US', { maximumFractionDigits: 3 })
const link = { background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }
const MOVE = { issue: 'Issue', return: 'Return', grn: 'Received', opening: 'Opening stock', adjustment: 'Adjustment', stock_take: 'Count',
  transfer_out: 'Sent', transfer_in: 'Arrived', landed_cost: 'Landed cost' }

export default function InvHome({ setPage }) {
  const { can } = usePermissions()
  const { scope, setScope, siteIds, multi, label } = useSiteScope()
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!siteIds.length) return
    const { data, error } = await supabase.rpc('inv_home', { p_site_ids: siteIds })
    if (error) { showToast(friendlyError(error), 'red'); return }
    setD(data)
  }, [siteIds])
  useEffect(() => { load() }, [load])

  useAskContext(d ? { screen: 'Stores dashboard', sites: label, attention: d.attention, figures: d.kpi, reorder_now: d.reorder,
    issued_by_department_this_month: d.by_department, abc: d.abc, expiring: d.expiring } : { screen: 'Stores dashboard' })

  async function draftPOs() {
    setBusy(true)
    const { data, error } = await supabase.rpc('proc_po_from_reorder', { p_site: siteIds[0], p_item_ids: null })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(`${data.lines} item${data.lines === 1 ? '' : 's'} put on ${data.po_ids.length} draft order${data.po_ids.length === 1 ? '' : 's'} — review and confirm`, 'green')
    setPage('proc_orders')
  }

  if (!can('inventory.view') && !can('procurement.view')) return <Denied />
  const a = d?.attention || {}, f = d?.kpi || {}
  const change = f.value_month_start > 0 ? ((f.value - f.value_month_start) / f.value_month_start) * 100 : null
  const chips = [
    [a.out_of_stock, 'out of stock', FIN.bad, 'inv_position'],
    [a.below_reorder, 'below reorder', FIN.ochreText, 'inv_position'],
    [a.expiring, 'batches expire in 30 days', FIN.ochreText, 'inv_reorder'],
    [a.requests_to_issue, 'requests to issue from stock', FIN.blue, 'inv_requisitions'],
    [a.arriving, 'transfers arriving', FIN.blue, 'inv_transfers'],
    [a.counts_open, 'counts open', FIN.muted, 'inv_stock_take'],
  ].filter(c => n(c[0]) > 0)

  return (
    <FinShell module="Inventory" homePage="inv_dashboard" setPage={setPage} title="Stores" siteText={label}
      actions={<>
        <SiteScopeToggle scope={scope} setScope={setScope} multi={multi} />
        {can('inventory.create') && <button style={finBtn} onClick={() => setPage('inv_issues')}>Issue stock</button>}
      </>}>
      {!d ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : <>
        {/* What needs me today */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chips.length === 0 ? <div style={{ ...finCard, padding: '10px 14px', color: FIN.good, fontSize: 14 }}>Nothing needs attention in the stores.</div>
            : chips.map(([v, text, color, page]) => (
              <button key={text} onClick={() => setPage(page)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '10px 14px', borderRadius: 12,
                border: `1px solid ${FIN.line}`, background: FIN.card, cursor: 'pointer', font: 'inherit', color: FIN.ink }}>
                <strong style={{ fontSize: 20, fontFamily: FIN.serif, color }}>{v}</strong><span style={{ fontSize: 13 }}>{text}</span>
              </button>
            ))}
        </div>

        {/* Headline figures */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Kpi label="Stock value" value={`$${money(f.value)}`} sub={change === null ? `${f.items || 0} items in ${f.stores || 0} stores`
            : <span style={{ color: change >= 0 ? FIN.good : FIN.bad }}>{change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% since the 1st</span>} />
          <Kpi label="Issued this month" value={`$${money(f.issued_month)}`} sub={`to ${f.issued_departments || 0} department${f.issued_departments === 1 ? '' : 's'}`} />
          <Kpi label="Days of cover" value={f.days_cover ?? '—'} sub={f.days_cover ? 'at the last 30 days’ usage' : 'no usage yet'} />
          <Kpi label="Dead stock" value={k(f.dead_stock)} sub="no movement in 180 days" warn={n(f.dead_stock) > 0} />
          <Kpi label="Count accuracy" value={f.count_accuracy != null ? `${f.count_accuracy}%` : '—'} sub={f.count_accuracy != null ? 'by value, last 90 days' : 'no counts in 90 days'} />
          <Kpi label="Reserved" value={k(a.reserved_value)} sub="held for requests and work orders" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div style={finCard}>
            <h3 style={h3}>Stock value and usage, 6 months</h3>
            <div style={{ fontSize: 12, color: FIN.muted, marginBottom: 8 }}>Bars: issued per month · line: stock value at month end</div>
            <Trend rows={d.trend || []} />
          </div>
          <div style={finCard}>
            <h3 style={h3}>Where stock went this month</h3>
            <div style={{ fontSize: 12, color: FIN.muted, marginBottom: 10 }}>Issued value by department</div>
            {(d.by_department || []).length === 0 ? <Empty text="Nothing issued this month yet" /> : (() => {
              const max = Math.max(...d.by_department.map(x => n(x.value)), 1)
              return d.by_department.map(x => (
                <div key={x.name} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 140px) 1fr auto', gap: 10, alignItems: 'center', margin: '6px 0', fontSize: 13 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                  <div style={{ height: 10, background: FIN.lineSoft, borderRadius: 5 }}><div style={{ width: `${(n(x.value) / max) * 100}%`, height: '100%', background: FIN.blue, borderRadius: 5 }} /></div>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>${money(x.value)}</span>
                </div>
              ))
            })()}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div style={finCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <h3 style={h3}>Reorder now</h3>
              {can('procurement.create') && (d.reorder || []).length > 0 && scope !== 'all' &&
                <button style={{ ...finBtn, minHeight: 36 }} disabled={busy} onClick={draftPOs}>{busy ? 'Making…' : 'Make draft POs'}</button>}
            </div>
            <div style={{ fontSize: 12, color: FIN.muted, margin: '2px 0 8px' }}>Free + on order + on the way is at or below the store’s reorder point</div>
            {(d.reorder || []).length === 0 ? <Empty text="Nothing to reorder" /> : (
              <table style={tbl}><thead><tr><th style={th}>Item</th><th style={thr}>Free</th><th style={thr}>Reorder at</th><th style={thr}>Coming</th></tr></thead>
                <tbody>{d.reorder.map(r => (
                  <tr key={`${r.item_id}${r.warehouse}`}>
                    <td style={td}>{r.description}<div style={{ fontSize: 12, color: FIN.faint }}>{r.item_code} · {r.warehouse}</div></td>
                    <td style={{ ...tdr, color: n(r.available) <= 0 ? FIN.bad : FIN.ink, fontWeight: 600 }}>{qty(r.available)}</td>
                    <td style={tdr}>{qty(r.reorder_at)}</td>
                    <td style={{ ...tdr, color: FIN.blue }}>{n(r.on_order) + n(r.in_transit) ? qty(n(r.on_order) + n(r.in_transit)) : '—'}</td>
                  </tr>
                ))}</tbody></table>
            )}
          </div>
          <div style={finCard}>
            <h3 style={h3}>Stock health</h3>
            <div style={{ fontSize: 12, color: FIN.muted, margin: '2px 0 10px' }}>ABC by value issued in the last 12 months</div>
            {!(d.abc || []).length ? <Empty text="Needs a few months of issues" /> : (() => {
              const tot = d.abc.reduce((s, x) => s + n(x.value), 0) || 1
              const col = { A: FIN.maroon, B: FIN.blue, C: FIN.field }
              return <>
                <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden' }}>
                  {d.abc.map(x => <div key={x.class} title={`${x.class}: $${money(x.value)}`} style={{ width: `${(n(x.value) / tot) * 100}%`, background: col[x.class] }} />)}
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
                  {d.abc.map(x => <span key={x.class}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: col[x.class], marginRight: 6 }} />
                    <strong>{x.class}</strong> · {x.items} item{x.items === 1 ? '' : 's'} · {Math.round((n(x.value) / tot) * 100)}%</span>)}
                </div>
              </>
            })()}
            <div style={{ fontSize: 12, color: FIN.muted, margin: '16px 0 6px' }}>Batches expiring in 60 days</div>
            {(d.expiring || []).length === 0 ? <Empty text="No batches expiring soon" /> : (
              <table style={tbl}><tbody>{d.expiring.map((b, i) => (
                <tr key={i}><td style={td}>{b.description}<div style={{ fontSize: 12, color: FIN.faint }}>{b.batch_no} · {b.warehouse}</div></td>
                  <td style={tdr}>{qty(b.qty)}</td>
                  <td style={{ ...tdr, color: new Date(b.expiry_date) < new Date(Date.now() + 30 * 864e5) ? FIN.bad : FIN.ochreText }}>{new Date(b.expiry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</td></tr>
              ))}</tbody></table>
            )}
          </div>
        </div>

        <div style={finCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h3 style={h3}>Latest moves</h3>
            <button style={link} onClick={() => setPage('inv_ledger')}>Open the ledger →</button>
          </div>
          {(d.latest || []).length === 0 ? <Empty text="No stock moves yet — import items or receive a delivery to start" /> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={tbl}><thead><tr><th style={th}>When</th><th style={th}>Move</th><th style={th}>Item</th><th style={thr}>Qty</th><th style={thr}>Value</th></tr></thead>
                <tbody>{d.latest.map((m, i) => (
                  <tr key={i}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: FIN.muted }}>{new Date(m.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                    <td style={td}>{MOVE[m.movement_type] || m.movement_type}{m.department ? ` → ${m.department}` : ''}<div style={{ fontSize: 12, color: FIN.faint }}>{m.voucher_no} · {m.warehouse}</div></td>
                    <td style={td}>{m.description}</td>
                    <td style={{ ...tdr, color: n(m.quantity) < 0 ? FIN.bad : FIN.good }}>{n(m.quantity) > 0 ? '+' : ''}{qty(m.quantity)}</td>
                    <td style={tdr}>${money(Math.abs(n(m.value)))}</td>
                  </tr>
                ))}</tbody></table>
            </div>
          )}
        </div>
      </>}
    </FinShell>
  )
}

const h3 = { margin: 0, fontFamily: FIN.serif, fontSize: 17, fontWeight: 600 }
const tbl = { width: '100%', borderCollapse: 'collapse' }
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}` }
const thr = { ...th, textAlign: 'right' }
const td = { padding: '7px 8px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 13 }
const tdr = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

function Kpi({ label, value, sub, warn }) {
  return (
    <div style={{ ...finCard, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: FIN.muted }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontFamily: FIN.serif, marginTop: 2, color: warn ? FIN.ochreText : FIN.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FIN.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Empty({ text }) { return <div style={{ color: FIN.faint, fontSize: 13, padding: '8px 0' }}>{text}</div> }

// Bars = issued per month, line = stock value at month end, on one shared scale.
function Trend({ rows }) {
  const W = 520, H = 170, L = 44, B = 22
  const max = Math.max(1, ...rows.map(r => Math.max(n(r.issued), n(r.value_end))))
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p })()
  const y = v => H - B - (n(v) / nice) * (H - B - 8)
  const bw = (W - L) / Math.max(rows.length, 1)
  const pts = rows.map((r, i) => `${L + i * bw + bw / 2},${y(r.value_end)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Stock value and usage by month" style={{ display: 'block' }}>
      {[0, 0.5, 1].map(t => (
        <g key={t}><line x1={L} x2={W} y1={y(nice * t)} y2={y(nice * t)} stroke={FIN.lineSoft} />
          <text x={L - 6} y={y(nice * t) + 4} textAnchor="end" fontSize="10" fill={FIN.faint}>{k(nice * t)}</text></g>
      ))}
      {rows.map((r, i) => (
        <g key={r.month}>
          <rect x={L + i * bw + bw * 0.25} y={y(r.issued)} width={bw * 0.5} height={Math.max(H - B - y(r.issued), 0)} rx="3" fill={FIN.blue} opacity={i === rows.length - 1 ? 1 : 0.6}>
            <title>{r.month}: issued ${money(r.issued)}, value ${money(r.value_end)}</title></rect>
          <text x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="11" fill={FIN.muted}>{r.month}</text>
        </g>
      ))}
      <polyline points={pts} fill="none" stroke={FIN.maroon} strokeWidth="2" />
      {rows.map((r, i) => <circle key={i} cx={L + i * bw + bw / 2} cy={y(r.value_end)} r={i === rows.length - 1 ? 4 : 2.5} fill={FIN.maroon} />)}
    </svg>
  )
}
