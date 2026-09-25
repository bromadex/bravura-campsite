import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Modal, showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ProcTracking = lazy(() => import('./ProcTracking'))

// PR04 — Purchase Orders hub (issue #53). One record from quote to delivery (Odoo style):
// Quote requested → Quote sent → (choose) → Waiting approval → Ordered (locked) → Part received → Received.
// Quotes to several suppliers are "alternatives"; choosing one cancels the others.
const STATUS = {
  rfq:                { label: 'Quote requested',  bg: FIN.lineSoft,  fg: FIN.muted },
  rfq_sent:           { label: 'Quote sent',       bg: FIN.blueTint,  fg: FIN.blue },
  draft:              { label: 'Draft order',      bg: FIN.lineSoft,  fg: FIN.muted },
  pending_approval:   { label: 'Waiting approval', bg: FIN.ochreTint, fg: FIN.ochreText },
  sent:               { label: 'Ordered',          bg: FIN.blueTint,  fg: FIN.blue },
  partially_received: { label: 'Part received',    bg: FIN.ochreTint, fg: FIN.ochreText },
  received:           { label: 'Received',         bg: FIN.goodTint,  fg: FIN.good },
  cancelled:          { label: 'Cancelled',        bg: FIN.lineSoft,  fg: FIN.faint },
}
const EDITABLE = ['draft', 'rfq', 'rfq_sent']
const PRIORITY = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }

function Pill({ status }) {
  const s = STATUS[status] || STATUS.draft
  return <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{s.label}</span>
}
function Received({ r }) {
  if (!r.receipt) return null
  const t = { none: ['Nothing received', FIN.muted], partial: ['Part received', FIN.ochreText], full: ['All received', FIN.good] }[r.receipt]
  const billed = Number(r.billed) >= Number(r.total) - 0.005 && Number(r.total) > 0 ? ['Fully billed', FIN.good] : Number(r.billed) > 0 ? ['Part billed', FIN.ochreText] : ['Not billed', FIN.muted]
  return <span style={{ fontSize: 12, color: FIN.muted }}><span style={{ color: t[1] }}>{t[0]}</span> · <span style={{ color: billed[1] }}>{billed[0]}</span></span>
}

export default function ProcOrders({ setPage, initialTab = 'orders' }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const sc = useSiteScope()
  const rt = useRealtimeRefresh('purchase_orders', { column: 'site_id', value: currentSiteId })
  const [tab, setTab] = useState(initialTab)
  const [rows, setRows] = useState(null)
  const [toOrder, setToOrder] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('open')
  const [openId, setOpenId] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  useEffect(() => { setTab(initialTab) }, [initialTab])

  const load = useCallback(async () => {
    if (!sc.siteIds.length) return
    const [a, b, s] = await Promise.all([
      supabase.rpc('proc_po_list', { p_site_ids: sc.siteIds }),
      supabase.rpc('proc_lines_to_order', { p_site_ids: sc.siteIds }),
      supabase.from('procurement_suppliers').select('id, supplier_name, site_id, status').eq('status', 'active').order('supplier_name'),
    ])
    if (a.error) showToast(a.error.message, 'red')
    setRows(a.data || []); setToOrder(b.data || []); setSuppliers(s.data || [])
  }, [sc.siteIds])
  useEffect(() => { load() }, [load, rt])

  const quotes = useMemo(() => {
    const groups = new Map()
    for (const r of (rows || []).filter(x => ['rfq', 'rfq_sent'].includes(x.status) || (x.rfq_group_id && ['draft', 'cancelled'].includes(x.status)))) {
      const key = r.rfq_group_id || r.id
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(r)
    }
    return [...groups.values()].filter(g => g.some(x => ['rfq', 'rfq_sent'].includes(x.status)))
  }, [rows])

  const orders = useMemo(() => {
    let r = (rows || []).filter(x => !['rfq', 'rfq_sent'].includes(x.status))
    if (filter === 'open') r = r.filter(x => ['draft', 'pending_approval', 'sent', 'partially_received'].includes(x.status))
    if (filter === 'late') r = r.filter(x => x.late)
    if (filter === 'approval') r = r.filter(x => x.status === 'pending_approval')
    if (filter === 'unbilled') r = r.filter(x => x.receipt && x.receipt !== 'none' && Number(x.billed) < Number(x.total) - 0.005)
    if (filter === 'closed') r = r.filter(x => ['received', 'cancelled'].includes(x.status))
    if (q) { const s = q.toLowerCase(); r = r.filter(x => `${x.po_number} ${x.supplier || ''} ${x.requests || ''} ${x.site}`.toLowerCase().includes(s)) }
    return r
  }, [rows, filter, q])

  if (!can('procurement.view') && !can('inventory.view')) return <Denied />
  const canCreate = can('procurement.create')
  const TABS = [
    { key: 'toorder', label: 'To order', count: toOrder?.length || 0 },
    { key: 'quotes', label: 'Quotes', count: quotes.length },
    { key: 'orders', label: 'Orders' },
    { key: 'tracking', label: 'Tracking' },
  ]

  async function newBlank() {
    const { data, error } = await supabase.rpc('proc_po_save', { p: { site_id: currentSiteId, lines: [] } })
    if (error) return showToast(error.message, 'red')
    load(); setOpenId(data)
  }

  return (
    <ProcShell title="Purchase Orders" subtitle="Quotes, orders and deliveries — one record from quote to goods received" setPage={setPage}
      siteText={sc.label} tabs={TABS} tab={tab} onTab={setTab}
      actions={<>
        <SiteScopeToggle {...sc} siteName={sc.sites.find(s => s.id === currentSiteId)?.name} />
        {canCreate && <button style={finBtn2} onClick={newBlank}>Blank order</button>}
      </>}>
      {tab === 'toorder' && <ToOrder lines={toOrder} suppliers={suppliers} canCreate={canCreate}
        onDone={ids => { load(); if (ids?.length === 1) setOpenId(ids[0]); else setTab('quotes') }} />}

      {tab === 'quotes' && (!rows ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : quotes.length === 0 ? (
        <div style={{ ...finCard, color: FIN.muted, fontSize: 14 }}>No open quotes. From <b>To order</b>, pick request lines and two or more suppliers to ask for prices.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {quotes.map((g, i) => {
            const live = g.filter(x => x.status !== 'cancelled')
            const priced = live.filter(x => Number(x.total) > 0)
            const best = priced.length ? priced.reduce((a, b) => Number(a.total) <= Number(b.total) ? a : b) : null
            return (
              <section key={i} style={{ ...finCard, padding: '12px 16px' }}>
                <div style={{ fontSize: 13, color: FIN.muted, marginBottom: 8 }}>
                  {g[0].site} · {g[0].lines} line{g[0].lines === 1 ? '' : 's'}{g[0].requests ? ` · from ${g[0].requests}` : ''}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                  {live.map(x => (
                    <button key={x.id} onClick={() => setOpenId(x.id)} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1.5px solid ${best?.id === x.id ? FIN.good : FIN.line}`, background: best?.id === x.id ? FIN.goodTint : '#fff' }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: FIN.ink }}>{x.supplier || 'No supplier'}</div>
                      <div style={{ fontSize: 12, color: FIN.muted }}>{x.po_number} · <Pill status={x.status} /></div>
                      <div style={{ fontSize: 18, fontFamily: FIN.serif, marginTop: 6, color: Number(x.total) > 0 ? FIN.ink : FIN.faint }}>
                        {Number(x.total) > 0 ? `$${money(x.total)}` : 'No price yet'}
                      </div>
                      {best?.id === x.id && priced.length > 1 && <div style={{ fontSize: 11.5, color: FIN.good, fontWeight: 600 }}>Cheapest so far</div>}
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ))}

      {tab === 'orders' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <div role="radiogroup" aria-label="Show" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[['open', 'Open'], ['approval', 'Waiting approval'], ['late', 'Late'], ['unbilled', 'Received, not billed'], ['closed', 'Closed'], ['all', 'All']].map(([k, t]) => (
              <button key={k} role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} style={{ minHeight: 34, padding: '0 12px', borderRadius: 17, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                ...(filter === k ? { border: 'none', background: FIN.maroon, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{t}</button>
            ))}
          </div>
          <input aria-label="Search orders" placeholder="PO, supplier, request or site" value={q} onChange={e => setQ(e.target.value)} style={{ ...finInput, marginLeft: 'auto', minWidth: 220 }} />
        </div>
        {!rows ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : orders.length === 0 ? (
          <div style={{ ...finCard, color: FIN.muted, fontSize: 14 }}>No orders here.</div>
        ) : (
          <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ textAlign: 'left', color: FIN.muted, fontSize: 12 }}>
                {['Order', 'Supplier', 'Site', 'Status', 'Delivery', 'Total'].map(h => <th key={h} style={{ padding: '10px 12px', fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, textAlign: h === 'Total' ? 'right' : 'left' }}>{h}</th>)}
              </tr></thead>
              <tbody>{orders.map(r => (
                <tr key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${FIN.lineSoft}` }}>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: FIN.blue, fontWeight: 600 }}>{r.po_number}</span>
                    {r.priority === 'urgent' && <span title="Urgent" style={{ color: FIN.maroon, marginLeft: 6 }}>★</span>}
                    {r.requests && <div style={{ fontSize: 11.5, color: FIN.faint }}>{r.requests}</div>}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{r.supplier || '—'}</td>
                  <td style={{ padding: '10px 12px', color: FIN.muted }}>{r.site}</td>
                  <td style={{ padding: '10px 12px' }}><Pill status={r.status} />{r.status === 'cancelled' && r.cancel_reason && <div style={{ fontSize: 11.5, color: FIN.faint }}>{r.cancel_reason}</div>}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {r.expected_date && <div style={{ fontSize: 12.5, color: r.late ? FIN.bad : FIN.muted }}>{r.late ? 'Late · ' : 'Due '}{new Date(r.expected_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
                    <Received r={r} />
                    {['sent', 'partially_received'].includes(r.status) && <div style={{ fontSize: 11.5, color: r.acknowledged_at ? FIN.good : FIN.ochreText }}>{r.acknowledged_at ? `Confirmed by ${r.ack_by_name || 'supplier'}` : 'Not confirmed by supplier'}</div>}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${money(r.total)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </>}

      {tab === 'tracking' && <Suspense fallback={<div style={{ ...finCard, color: FIN.faint }}>Loading…</div>}><ProcTracking setPage={setPage} /></Suspense>}

      {openId && <OrderDetail id={openId} suppliers={suppliers} onClose={() => setOpenId(null)} onOpen={setOpenId} onChanged={load} />}
    </ProcShell>
  )
}

// ── Approved request lines → quotes or orders ───────────────────────────────────
function ToOrder({ lines, suppliers, canCreate, onDone }) {
  const [picked, setPicked] = useState(new Set())
  const [sups, setSups] = useState([])
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  if (!lines) return <div style={{ ...finCard, color: FIN.faint }}>Loading…</div>
  if (!lines.length) return <div style={{ ...finCard, color: FIN.muted, fontSize: 14 }}>Nothing waiting — approved purchase requests appear here until they're on an order.</div>
  const sites = new Set(lines.filter(l => picked.has(l.line_id)).map(l => l.site_id))
  function toggle(id) { setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }) }
  async function go() {
    setBusy(true)
    const { data, error } = await supabase.rpc('proc_po_from_requests', { p_line_ids: [...picked], p_supplier_ids: sups, p_warehouse_id: null, p_expected: expected || null })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(sups.length > 1 ? `Quotes started with ${sups.length} suppliers` : 'Draft order created')
    setPicked(new Set()); setSups([])
    onDone(data?.po_ids)
  }
  const preferred = new Set(lines.filter(l => picked.has(l.line_id)).map(l => l.preferred_supplier_id).filter(Boolean))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
      <section aria-label="Approved request lines" style={{ ...finCard, padding: 0, overflowX: 'auto', gridColumn: 'span 2' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
          <thead><tr style={{ textAlign: 'left', color: FIN.muted, fontSize: 12 }}>
            <th style={{ padding: '10px 12px', width: 30 }} />
            {['Request', 'What', 'Qty', 'Est. / last price', 'Site'].map(h => <th key={h} style={{ padding: '10px 12px', fontWeight: 600, borderBottom: `1px solid ${FIN.line}` }}>{h}</th>)}
          </tr></thead>
          <tbody>{lines.map(l => (
            <tr key={l.line_id} onClick={() => toggle(l.line_id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${FIN.lineSoft}`, background: picked.has(l.line_id) ? FIN.maroonTint : 'transparent' }}>
              <td style={{ padding: '10px 12px' }}><input type="checkbox" aria-label={`Pick ${l.what}`} checked={picked.has(l.line_id)} onChange={() => toggle(l.line_id)} onClick={e => e.stopPropagation()} /></td>
              <td style={{ padding: '10px 12px' }}>
                <span style={{ color: FIN.blue, fontWeight: 600 }}>{l.requisition_no}</span>
                {l.priority === 'urgent' && <span style={{ color: FIN.bad, fontSize: 11, fontWeight: 700, marginLeft: 6 }}>URGENT</span>}
                {l.needed_by && <div style={{ fontSize: 11.5, color: FIN.faint }}>needed {new Date(l.needed_by).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}
              </td>
              <td style={{ padding: '10px 12px' }}>{l.what}{l.title && <div style={{ fontSize: 11.5, color: FIN.faint }}>{l.title}</div>}</td>
              <td style={{ padding: '10px 12px', fontVariantNumeric: 'tabular-nums' }}>{Number(l.remaining)} {l.unit || ''}</td>
              <td style={{ padding: '10px 12px', fontVariantNumeric: 'tabular-nums', color: FIN.muted }}>
                {l.estimated_cost ? `$${money(l.estimated_cost)}` : '—'}{l.last_price ? <span style={{ color: FIN.blue }}> · last ${money(l.last_price)}</span> : ''}
              </td>
              <td style={{ padding: '10px 12px', color: FIN.muted }}>{l.site}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>
      {canCreate && (
        <section aria-label="Order the picked lines" style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Order {picked.size || ''} line{picked.size === 1 ? '' : 's'}</h2>
          {sites.size > 1 && <div style={{ fontSize: 12.5, color: FIN.bad }}>Pick lines for one site at a time.</div>}
          <div style={{ fontSize: 12.5, color: FIN.muted }}>One supplier makes a draft order. Two or more asks each for a price, so you can compare and choose.</div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${FIN.line}`, borderRadius: 8, padding: 6 }}>
            {suppliers.map(s => (
              <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 4px', fontSize: 13.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={sups.includes(s.id)} onChange={() => setSups(v => v.includes(s.id) ? v.filter(x => x !== s.id) : [...v, s.id])} />
                {s.supplier_name}{preferred.has(s.id) && <span style={{ fontSize: 11, color: FIN.good, fontWeight: 600 }}>preferred</span>}
              </label>
            ))}
          </div>
          <label style={{ fontSize: 12, color: FIN.muted }}>Delivery wanted by
            <input type="date" value={expected} onChange={e => setExpected(e.target.value)} style={{ ...finInput, width: '100%', marginTop: 4 }} /></label>
          <button style={finBtn} disabled={busy || !picked.size || !sups.length || sites.size > 1} onClick={go}>
            {sups.length > 1 ? `Ask ${sups.length} suppliers for quotes` : 'Create draft order'}
          </button>
        </section>
      )}
    </div>
  )
}

// ── One order / quote ───────────────────────────────────────────────────────────
function OrderDetail({ id, suppliers, onClose, onOpen, onChanged }) {
  const { can } = usePermissions()
  const [po, setPo] = useState(null)
  const [lines, setLines] = useState([])
  const [alts, setAlts] = useState([])
  const [ref, setRef] = useState({ items: [], whs: [], ccs: [], projects: [] })
  const [hist, setHist] = useState([])
  const [approval, setApproval] = useState(null)
  const [busy, setBusy] = useState(false)
  const [addSup, setAddSup] = useState('')

  const load = useCallback(async () => {
    const { data: p, error } = await supabase.from('purchase_orders')
      .select('*, supplier:procurement_suppliers(supplier_name, email, phone, hold_type, hold_reason), site:sites(name), lines:po_lines(id, item_id, description, unit, quantity, unit_cost, received_qty, promised_date, is_archived, requisition_line_id, item:items(item_code, description))')
      .eq('id', id).single()
    if (error) { showToast(error.message, 'red'); return }
    setPo(p)
    const ls = (p.lines || []).filter(l => !l.is_archived).map(l => ({ ...l, item_text: l.item ? `${l.item.item_code} — ${l.item.description}` : '' }))
    setLines(ls)
    const [w, c, pj, it, al, ap] = await Promise.all([
      supabase.from('warehouses').select('id, name').eq('site_id', p.site_id).eq('is_active', true).order('name'),
      supabase.from('cost_centres').select('id, code, name').eq('site_id', p.site_id).eq('is_archived', false).order('code'),
      supabase.from('projects').select('id, project_code, name').eq('site_id', p.site_id).eq('is_archived', false).order('name'),
      supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description').limit(5000),
      p.rfq_group_id ? supabase.from('purchase_orders').select('id, po_number, status, total_amount, supplier:procurement_suppliers(supplier_name), lines:po_lines(item_id, description, quantity, unit_cost, is_archived, requisition_line_id)')
        .eq('rfq_group_id', p.rfq_group_id).neq('status', 'cancelled') : Promise.resolve({ data: [] }),
      supabase.from('approval_requests').select('id, current_step').eq('entity_type', 'purchase_orders').eq('entity_id', id).eq('status', 'pending').maybeSingle(),
    ])
    setRef({ whs: w.data || [], ccs: c.data || [], projects: pj.data || [], items: it.data || [] })
    setAlts(al.data || [])
    if (ap.data) {
      const { data: ok } = await supabase.rpc('approval_can_act', { p_request_id: ap.data.id })
      setApproval({ ...ap.data, canAct: !!ok })
    } else setApproval(null)
    const ids = ls.map(l => l.item_id).filter(Boolean)
    if (ids.length) supabase.rpc('proc_item_price_history', { p_item_ids: ids }).then(({ data }) => setHist(data || []))
  }, [id])
  useEffect(() => { load() }, [load])

  if (!po) return <Modal open onClose={onClose} title="Order"><div style={{ color: FIN.faint }}>Loading…</div></Modal>
  const editable = EDITABLE.includes(po.status) && (can('procurement.edit') || can('procurement.create'))
  const isQuote = ['rfq', 'rfq_sent'].includes(po.status)
  const total = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0)
  const set = patch => setPo(p => ({ ...p, ...patch }))
  const setLine = (i, patch) => setLines(ls => ls.map((l, k) => k === i ? { ...l, ...patch } : l))
  const itemLabel = it => `${it.item_code} — ${it.description}`

  async function act(fn, ok, after) {
    setBusy(true)
    const res = await fn()
    setBusy(false)
    if (res.error) return showToast(res.error.message.replace(/^OVER_BUDGET: /, ''), 'red')
    if (ok) showToast(typeof ok === 'function' ? ok(res.data) : ok)
    onChanged(); after ? after(res.data) : load()
  }
  const payload = () => ({ id: po.id, supplier_id: po.supplier_id, warehouse_id: po.warehouse_id, expected_date: po.expected_date, delivery_address: po.delivery_address,
    notes: po.notes, priority: po.priority, cost_centre_id: po.cost_centre_id, project_id: po.project_id, supplier_ref: po.supplier_ref,
    lines: lines.map(l => ({ id: l.id, item_id: l.item_id || null, description: l.item_id ? null : (l.description || l.item_text), unit: l.unit, quantity: l.quantity, unit_cost: l.unit_cost })) })
  const save = () => act(() => supabase.rpc('proc_po_save', { p: payload() }), 'Saved')
  const confirm = async () => {
    const s = await supabase.rpc('proc_po_save', { p: payload() })
    if (s.error) return showToast(s.error.message, 'red')
    act(() => supabase.rpc('proc_po_confirm', { p_po: po.id }), d => d?.status === 'pending_approval' ? 'Sent for approval' : 'Order confirmed')
  }
  const markSent = () => act(() => supabase.rpc('proc_rfq_mark_sent', { p_po: po.id }), 'Marked as sent to the supplier')
  const cancel = () => { const why = window.prompt('Cancel this order? Give a reason'); if (why === null) return; act(() => supabase.rpc('proc_po_cancel', { p_po: po.id, p_reason: why }), 'Cancelled') }
  const amend = () => { const why = window.prompt('Amend: this order is cancelled and copied to a new draft version. What needs to change?'); if (why === null) return
    act(() => supabase.rpc('proc_po_amend', { p_po: po.id, p_reason: why }), 'New version created', d => onOpen(d)) }
  const decide = ok => { const c = ok ? '' : window.prompt('Why is this order rejected?'); if (!ok && !c) return
    act(() => supabase.rpc('approval_decide', { p_request_id: approval.id, p_approve: ok, p_comment: c || null }), ok ? 'Approved' : 'Rejected') }
  const addSupplier = () => act(() => supabase.rpc('proc_rfq_add_supplier', { p_po: po.id, p_supplier: addSup }), 'Supplier added to the quote', () => { setAddSup(''); load() })

  const lab = { display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }
  const inp = { ...finInput, width: '100%' }
  const histFor = itemId => hist.filter(h => h.item_id === itemId)
  // Compare alternatives line by line (matched on the request line, or on item / description).
  const altKey = l => l.requisition_line_id || l.item_id || l.description
  const compareRows = alts.length > 1 ? lines.map(l => ({ l, prices: alts.map(a => (a.lines || []).find(x => !x.is_archived && altKey(x) === altKey(l))?.unit_cost) })) : []

  return (
    <Modal open onClose={onClose} dirty={editable} maxWidth={900}
      title={`${po.po_number}${po.revision ? ` (version ${po.revision + 1})` : ''} · ${po.supplier?.supplier_name || 'No supplier'}`}
      footer={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
        {!['cancelled', 'received'].includes(po.status) && (can('procurement.edit') || (EDITABLE.includes(po.status) && can('procurement.create'))) && !(po.lines || []).some(l => Number(l.received_qty) > 0) && <button style={finBtn2} disabled={busy} onClick={cancel}>Cancel order</button>}
        {['pending_approval', 'sent'].includes(po.status) && can('procurement.edit') && <button style={finBtn2} disabled={busy} onClick={amend}>Amend</button>}
        {editable && <button style={finBtn2} disabled={busy} onClick={save}>Save</button>}
        {editable && po.status === 'rfq' && <button style={finBtn2} disabled={busy} onClick={markSent}>Mark quote sent</button>}
        {editable && <button style={finBtn} disabled={busy} onClick={confirm}>{isQuote ? 'Choose this supplier' : 'Confirm order'}</button>}
        {approval?.canAct && <><button style={finBtn2} disabled={busy} onClick={() => decide(false)}>Reject</button><button style={finBtn} disabled={busy} onClick={() => decide(true)}>Approve</button></>}
      </div>}>
      <div style={{ fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: FIN.muted }}>
          <Pill status={po.status} /><span>For {po.site?.name}</span>
          {po.order_date && <span>· ordered {new Date(po.order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          {po.amended_from && <button onClick={() => onOpen(po.amended_from)} style={{ background: 'none', border: 'none', color: FIN.blue, cursor: 'pointer', padding: 0, font: 'inherit' }}>· previous version</button>}
          {po.status === 'cancelled' && po.cancel_reason && <span>· {po.cancel_reason}</span>}
          {!editable && ['pending_approval', 'sent', 'partially_received', 'received'].includes(po.status) && <span style={{ color: FIN.faint }}>· locked — use Amend to change</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label><span style={lab}>Supplier</span>
            <select disabled={!editable || isQuote} value={po.supplier_id || ''} onChange={e => set({ supplier_id: e.target.value || null })} style={inp}>
              <option value="">Choose…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
            </select></label>
          <label><span style={lab}>Deliver into store</span>
            <select disabled={!editable} value={po.warehouse_id || ''} onChange={e => set({ warehouse_id: e.target.value || null })} style={inp}>
              <option value="">— services only —</option>{ref.whs.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          <label><span style={lab}>Delivery by</span>
            <input disabled={!editable} type="date" value={po.expected_date || ''} onChange={e => set({ expected_date: e.target.value })} style={inp} /></label>
          <label><span style={lab}>Priority</span>
            <select disabled={!editable} value={po.priority || 'normal'} onChange={e => set({ priority: e.target.value })} style={inp}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label><span style={lab}>Cost centre</span>
            <select disabled={!editable} value={po.cost_centre_id || ''} onChange={e => set({ cost_centre_id: e.target.value || null })} style={inp}>
              <option value="">—</option>{ref.ccs.map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
            </select></label>
          <label><span style={lab}>Project</span>
            <select disabled={!editable} value={po.project_id || ''} onChange={e => set({ project_id: e.target.value || null })} style={inp}>
              <option value="">—</option>{ref.projects.map(p => <option key={p.id} value={p.id}>{p.project_code ? p.project_code + ' ' : ''}{p.name}</option>)}
            </select></label>
          <label><span style={lab}>Supplier's quote / ref</span>
            <input disabled={!editable} value={po.supplier_ref || ''} onChange={e => set({ supplier_ref: e.target.value })} style={inp} /></label>
          <label><span style={lab}>Delivery address</span>
            <input disabled={!editable} value={po.delivery_address || ''} onChange={e => set({ delivery_address: e.target.value })} placeholder={po.site?.name} style={inp} /></label>
        </div>

        <div>
          <datalist id="po-items">{ref.items.map(it => <option key={it.id} value={itemLabel(it)} />)}</datalist>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead><tr style={{ textAlign: 'left', color: FIN.muted, fontSize: 12 }}>
                <th style={{ padding: '6px 4px' }}>Item or service</th><th style={{ padding: '6px 4px', width: 90 }}>Qty</th><th style={{ padding: '6px 4px', width: 70 }}>Unit</th>
                <th style={{ padding: '6px 4px', width: 120 }}>Price each ($)</th><th style={{ padding: '6px 4px', textAlign: 'right' }}>Amount</th>
                {!editable && <th style={{ padding: '6px 4px', textAlign: 'right' }}>Received</th>}{editable && <th />}
              </tr></thead>
              <tbody>{lines.map((l, i) => {
                const h = l.item_id ? histFor(l.item_id) : []
                return (
                  <tr key={l.id || i} style={{ borderTop: `1px solid ${FIN.lineSoft}`, verticalAlign: 'top' }}>
                    <td style={{ padding: '6px 4px', minWidth: 220 }}>
                      {editable ? <input list="po-items" value={l.item_id ? l.item_text : (l.item_text || l.description || '')} style={inp}
                        onChange={e => { const it = ref.items.find(x => itemLabel(x) === e.target.value); setLine(i, { item_text: e.target.value, item_id: it?.id || null, description: it ? null : e.target.value }) }} />
                        : <span>{l.item ? itemLabel(l.item) : l.description}</span>}
                      {h.length > 0 && <div style={{ fontSize: 11.5, color: FIN.blue, marginTop: 3 }}>Last paid ${money(h[0].unit_cost)} · {h[0].supplier} · {new Date(h[0].date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}</div>}
                    </td>
                    <td style={{ padding: '6px 4px' }}>{editable ? <input type="number" min="0" step="any" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} style={inp} /> : Number(l.quantity)}</td>
                    <td style={{ padding: '6px 4px' }}>{editable ? <input value={l.unit || ''} onChange={e => setLine(i, { unit: e.target.value })} style={inp} /> : l.unit}</td>
                    <td style={{ padding: '6px 4px' }}>{editable ? <input type="number" min="0" step="0.01" value={l.unit_cost} onChange={e => setLine(i, { unit_cost: e.target.value })} style={{ ...inp, borderColor: Number(l.unit_cost) > 0 ? FIN.field : FIN.ochre }} /> : `$${money(l.unit_cost)}`}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${money(Number(l.quantity || 0) * Number(l.unit_cost || 0))}</td>
                    {!editable && <td style={{ padding: '6px 4px', textAlign: 'right', color: Number(l.received_qty) >= Number(l.quantity) ? FIN.good : FIN.muted }}>{Number(l.received_qty || 0)} / {Number(l.quantity)}{l.promised_date && <div style={{ fontSize: 11, color: FIN.faint }}>promised {new Date(l.promised_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>}</td>}
                    {editable && <td style={{ padding: '6px 4px' }}><button aria-label="Remove line" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))} style={{ ...finBtn2, minHeight: 36, padding: '0 10px' }}>✕</button></td>}
                  </tr>
                )
              })}</tbody>
              <tfoot><tr><td colSpan={4} style={{ padding: '8px 4px', fontWeight: 600 }}>Total</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 700, fontFamily: FIN.serif, fontSize: 16 }}>${money(total)}</td></tr></tfoot>
            </table>
          </div>
          {editable && <button style={{ ...finBtn2, marginTop: 8 }} onClick={() => setLines(ls => [...ls, { item_id: null, item_text: '', description: '', unit: '', quantity: 1, unit_cost: 0 }])}>Add a line</button>}
        </div>

        {po.supplier?.hold_type && po.supplier.hold_type !== 'none' && (
          <div role="alert" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, background: '#FDF3F2', color: FIN.bad }}>
            {po.supplier.supplier_name} is on hold ({po.supplier.hold_type === 'all' ? 'no new orders' : po.supplier.hold_type === 'bills' ? 'bills' : 'payments'}): {po.supplier.hold_reason}
          </div>
        )}
        {['sent', 'partially_received'].includes(po.status) && <AckPanel po={po} onChanged={load} />}

        {compareRows.length > 0 && (
          <section aria-label="Compare quotes" style={{ border: `1px solid ${FIN.line}`, borderRadius: 10, padding: 12, overflowX: 'auto' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Compare quotes</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr style={{ color: FIN.muted, textAlign: 'left' }}><th style={{ padding: '4px' }}>Line</th>
                {alts.map(a => <th key={a.id} style={{ padding: '4px', textAlign: 'right' }}>
                  <button onClick={() => onOpen(a.id)} style={{ background: 'none', border: 'none', color: a.id === po.id ? FIN.ink : FIN.blue, fontWeight: 600, cursor: 'pointer', font: 'inherit' }}>{a.supplier?.supplier_name || a.po_number}</button>
                </th>)}</tr></thead>
              <tbody>
                {compareRows.map(({ l, prices }, i) => {
                  const valid = prices.filter(p => Number(p) > 0)
                  const min = valid.length ? Math.min(...valid.map(Number)) : null
                  return (
                    <tr key={i} style={{ borderTop: `1px solid ${FIN.lineSoft}` }}>
                      <td style={{ padding: '4px' }}>{l.item ? itemLabel(l.item) : l.description} × {Number(l.quantity)}</td>
                      {prices.map((p, k) => <td key={k} style={{ padding: '4px', textAlign: 'right', color: Number(p) > 0 && Number(p) === min ? FIN.good : Number(p) > 0 ? FIN.ink : FIN.faint, fontWeight: Number(p) === min ? 600 : 400 }}>{Number(p) > 0 ? `$${money(p)}` : '—'}</td>)}
                    </tr>
                  )
                })}
                <tr style={{ borderTop: `1px solid ${FIN.line}`, fontWeight: 600 }}><td style={{ padding: '4px' }}>Total</td>
                  {alts.map(a => <td key={a.id} style={{ padding: '4px', textAlign: 'right' }}>{Number(a.total_amount) > 0 ? `$${money(a.total_amount)}` : '—'}</td>)}</tr>
              </tbody>
            </table>
          </section>
        )}

        {editable && (can('procurement.create') || can('procurement.edit')) && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <label style={{ flex: '1 1 240px' }}><span style={lab}>Ask another supplier for a price on the same lines</span>
              <select value={addSup} onChange={e => setAddSup(e.target.value)} style={inp}>
                <option value="">Choose a supplier…</option>
                {suppliers.filter(s => s.id !== po.supplier_id && !alts.some(a => a.supplier?.supplier_name === s.supplier_name)).map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
              </select></label>
            <button style={finBtn2} disabled={!addSup || busy} onClick={addSupplier}>Add to quote</button>
          </div>
        )}

        <label><span style={lab}>Notes to the supplier</span>
          <textarea disabled={!editable} rows={2} value={po.notes || ''} onChange={e => set({ notes: e.target.value })} style={{ ...inp, resize: 'vertical' }} /></label>
      </div>
    </Modal>
  )
}

// Supplier confirmation link (#54): the supplier opens it without logging in, confirms and gives dates.
function AckPanel({ po, onChanged }) {
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(false)
  async function make() {
    setBusy(true)
    const { data, error } = await supabase.rpc('proc_po_ack_link', { p_po: po.id })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    setUrl(`${window.location.origin}/ack/${data}`)
    onChanged?.()
  }
  const msg = url ? `Hello, please confirm Bravura purchase order ${po.po_number} and your delivery dates here: ${url}` : ''
  return (
    <section aria-label="Supplier confirmation" style={{ border: `1px solid ${FIN.line}`, borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Supplier confirmation</span>
        <span style={{ fontSize: 13, color: po.acknowledged_at ? FIN.good : FIN.ochreText }}>
          {po.acknowledged_at ? `Confirmed by ${po.ack_by_name} on ${new Date(po.acknowledged_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not confirmed yet'}
        </span>
      </div>
      {po.ack_note && <div style={{ fontSize: 13, color: FIN.muted }}>“{po.ack_note}”</div>}
      {!url ? (
        <button style={{ ...finBtn2, alignSelf: 'flex-start' }} disabled={busy} onClick={make}>{po.acknowledged_at ? 'New link to update dates' : 'Create confirmation link'}</button>
      ) : (
        <>
          <input readOnly value={url} onFocus={e => e.target.select()} aria-label="Confirmation link" style={{ ...finInput, width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={finBtn2} onClick={() => { navigator.clipboard?.writeText(url); showToast('Link copied') }}>Copy link</button>
            <a style={{ ...finBtn2, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
              href={`mailto:${po.supplier?.email || ''}?subject=${encodeURIComponent('Purchase order ' + po.po_number)}&body=${encodeURIComponent(msg)}`}>Email</a>
            <a style={{ ...finBtn2, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }} target="_blank" rel="noreferrer"
              href={`https://wa.me/${(po.supplier?.phone || '').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`}>WhatsApp</a>
          </div>
          <div style={{ fontSize: 12, color: FIN.faint }}>The link works for 30 days; making a new one cancels the old one.</div>
        </>
      )}
    </section>
  )
}
