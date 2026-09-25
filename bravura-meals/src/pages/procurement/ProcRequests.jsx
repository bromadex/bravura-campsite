import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { Modal, showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

// PR07 — Requests (issue #52). One screen for asking for something, replacing the separate Stores and
// Procurement requisition screens. A request is either "buy" (goes to HQ Procurement once the department
// head approves) or "transfer" (stock another site already has — that site's stores sends it).
const STATUS = {
  draft:     { label: 'Draft',            bg: FIN.lineSoft,  fg: FIN.muted },
  submitted: { label: 'Waiting approval', bg: FIN.ochreTint, fg: FIN.ochreText },
  approved:  { label: 'Approved',         bg: FIN.blueTint,  fg: FIN.blue },
  rejected:  { label: 'Rejected',         bg: '#FDF3F2',     fg: FIN.bad },
  ordered:   { label: 'Ordered',          bg: FIN.goodTint,  fg: FIN.good },
  fulfilled: { label: 'Transferred',      bg: FIN.goodTint,  fg: FIN.good },
  cancelled: { label: 'Cancelled',        bg: FIN.lineSoft,  fg: FIN.faint },
}
const PRIORITY = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
const EMPTY_LINE = { item_id: '', item_text: '', description: '', unit: '', quantity: '', estimated_cost: '' }
const SELECT = `*, site:sites!purchase_requisitions_site_id_fkey(name), source:sites!purchase_requisitions_source_site_id_fkey(name),
  requester:profiles!purchase_requisitions_requested_by_fkey(full_name), department:departments(name),
  work_order:fleet_work_orders(work_order_number),
  lines:requisition_lines(id, item_id, description, unit, quantity, estimated_cost, ordered_qty, is_archived, item:items(item_code, description))`

const lineTotal = r => (r.lines || []).filter(l => !l.is_archived).reduce((a, l) => a + Number(l.quantity || 0) * Number(l.estimated_cost || 0), 0)
const lineName = l => l.item ? `${l.item.item_code} — ${l.item.description}` : l.description

function Pill({ status }) {
  const s = STATUS[status] || STATUS.draft
  return <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: s.bg, color: s.fg, whiteSpace: 'nowrap' }}>{s.label}</span>
}

export default function ProcRequests({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const sc = useSiteScope()
  const rt = useRealtimeRefresh('purchase_requisitions', { column: 'site_id', value: currentSiteId })
  const [rows, setRows] = useState(null)
  const [approvals, setApprovals] = useState({})  // requisition id → { id, canAct, step }
  const [tab, setTab] = useState('mine')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null)   // null | {} (new) | request
  const [open, setOpen] = useState(null)         // request shown in detail

  const load = useCallback(async () => {
    if (!sc.siteIds.length) return
    const [a, b] = await Promise.all([
      supabase.from('purchase_requisitions').select(SELECT).in('site_id', sc.siteIds).eq('is_archived', false).order('created_at', { ascending: false }).limit(500),
      supabase.from('purchase_requisitions').select(SELECT).in('source_site_id', sc.siteIds).eq('request_type', 'transfer').eq('is_archived', false).order('created_at', { ascending: false }).limit(200),
    ])
    if (a.error) { showToast(a.error.message, 'red'); setRows([]); return }
    const byId = new Map([...(a.data || []), ...(b.data || [])].map(r => [r.id, r]))
    const list = [...byId.values()].sort((x, y) => y.created_at.localeCompare(x.created_at))
    setRows(list)
    const waiting = list.filter(r => r.status === 'submitted').map(r => r.id)
    if (!waiting.length) { setApprovals({}); return }
    const { data: reqs } = await supabase.from('approval_requests').select('id, entity_id, current_step')
      .eq('entity_type', 'purchase_requisitions').eq('status', 'pending').in('entity_id', waiting)
    const acts = await Promise.all((reqs || []).map(r => supabase.rpc('approval_can_act', { p_request_id: r.id }).then(x => [r, !!x.data])))
    setApprovals(Object.fromEntries(acts.map(([r, ok]) => [r.entity_id, { id: r.id, canAct: ok, step: r.current_step }])))
  }, [sc.siteIds])
  useEffect(() => { load() }, [load, rt])

  const counts = useMemo(() => {
    const r = rows || []
    return {
      mine: r.filter(x => x.requested_by === profile?.id && !['cancelled'].includes(x.status)).length,
      approve: r.filter(x => approvals[x.id]?.canAct).length,
      order: r.filter(x => x.status === 'approved' && x.request_type === 'buy').length,
      send: r.filter(x => x.status === 'approved' && x.request_type === 'transfer' && sc.siteIds.includes(x.source_site_id)).length,
    }
  }, [rows, approvals, profile?.id, sc.siteIds])

  const shown = useMemo(() => {
    let r = rows || []
    if (tab === 'mine') r = r.filter(x => x.requested_by === profile?.id)
    if (tab === 'approve') r = r.filter(x => x.status === 'submitted')
    if (tab === 'order') r = r.filter(x => x.status === 'approved' && x.request_type === 'buy')
    if (tab === 'send') r = r.filter(x => x.status === 'approved' && x.request_type === 'transfer' && sc.siteIds.includes(x.source_site_id))
    if (q) {
      const s = q.toLowerCase()
      r = r.filter(x => `${x.requisition_no} ${x.title || ''} ${x.requester?.full_name || ''} ${(x.lines || []).map(lineName).join(' ')}`.toLowerCase().includes(s))
    }
    return r
  }, [rows, tab, q, profile?.id, sc.siteIds])

  if (!can('procurement.view') && !can('inventory.view') && !can('procurement.create') && !can('inventory.create')) return <Denied />
  const canCreate = can('procurement.create') || can('inventory.create')
  const TABS = [
    { key: 'mine', label: 'My requests', count: counts.mine },
    { key: 'approve', label: 'Waiting approval', count: counts.approve },
    (can('procurement.view') || can('procurement.create')) && { key: 'order', label: 'To order', count: counts.order },
    { key: 'send', label: 'Transfers to send', count: counts.send },
    { key: 'all', label: 'All' },
  ]

  return (
    <ProcShell title="Requests" subtitle="Ask for goods or services — stores checks stock first, then HQ buys" setPage={setPage}
      siteText={sc.label} tabs={TABS} tab={tab} onTab={setTab}
      actions={<>
        <SiteScopeToggle {...sc} siteName={sc.sites.find(s => s.id === currentSiteId)?.name} />
        {canCreate && <button style={finBtn} onClick={() => setEditing({})}>New request</button>}
      </>}>
      <input aria-label="Search requests" placeholder="Search number, title, item or person" value={q} onChange={e => setQ(e.target.value)}
        style={{ ...finInput, width: '100%', maxWidth: 420, marginBottom: 12 }} />
      {!rows ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : shown.length === 0 ? (
        <div style={{ ...finCard, color: FIN.muted, fontSize: 14 }}>
          {tab === 'mine' ? 'You have no requests yet. Press New request to ask for something.' : 'Nothing here.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(r => {
            const total = lineTotal(r)
            const active = (r.lines || []).filter(l => !l.is_archived)
            const late = r.needed_by && r.needed_by < new Date().toISOString().slice(0, 10) && ['submitted', 'approved'].includes(r.status)
            return (
              <button key={r.id} onClick={() => setOpen(r)} style={{ ...finCard, padding: '12px 16px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 12px', alignItems: 'center' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: FIN.blue, fontSize: 13 }}>{r.requisition_no}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: FIN.ink }}>{r.title || lineName(active[0] || {}) || 'Request'}</span>
                    {r.priority === 'urgent' || r.priority === 'high' ? <span style={{ fontSize: 11, fontWeight: 700, color: r.priority === 'urgent' ? FIN.bad : FIN.ochreText, textTransform: 'uppercase', letterSpacing: '.06em' }}>{PRIORITY[r.priority]}</span> : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: FIN.muted, marginTop: 2 }}>
                    {r.request_type === 'transfer' ? `Transfer ${r.source?.name || ''} → ${r.site?.name || ''}` : `For ${r.site?.name || ''}`}
                    {' · '}{active.length} line{active.length === 1 ? '' : 's'}
                    {total > 0 && ` · ~$${money(total)}`}
                    {r.requester?.full_name && ` · ${r.requester.full_name}`}
                    {r.needed_by && <span style={{ color: late ? FIN.bad : FIN.muted }}> · needed {new Date(r.needed_by).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>}
                  </div>
                </div>
                <Pill status={r.status} />
              </button>
            )
          })}
        </div>
      )}

      {editing && <RequestForm initial={editing} sites={sc.sites} currentSiteId={currentSiteId} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setOpen(null); load() }} />}
      {open && <RequestDetail r={open} approval={approvals[open.id]} profileId={profile?.id} onClose={() => setOpen(null)}
        onEdit={() => { setEditing(open); setOpen(null) }} onChanged={() => { setOpen(null); load() }} />}
    </ProcShell>
  )
}

// ── Detail: lines, stock at every site, approval trail, actions ─────────────────
function RequestDetail({ r, approval, profileId, onClose, onEdit, onChanged }) {
  const { can } = usePermissions()
  const [stock, setStock] = useState(null)
  const [trail, setTrail] = useState([])
  const [busy, setBusy] = useState(false)
  const [send, setSend] = useState(null)   // { from, to, fromList, toList }
  const lines = (r.lines || []).filter(l => !l.is_archived)

  useEffect(() => {
    const ids = lines.map(l => l.item_id).filter(Boolean)
    if (ids.length) supabase.rpc('proc_stock_check', { p_item_ids: ids }).then(({ data }) => setStock(data || []))
    else setStock([])
    supabase.from('approval_requests').select('id, status, approval_actions(action, comment, step_label, created_at, actor:profiles(full_name))')
      .eq('entity_type', 'purchase_requisitions').eq('entity_id', r.id).order('created_at').then(({ data }) =>
        setTrail((data || []).flatMap(x => x.approval_actions || []).sort((a, b) => a.created_at.localeCompare(b.created_at))))
  }, [r.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const mine = r.requested_by === profileId
  const canEdit = ['draft', 'rejected'].includes(r.status) && (mine || can('procurement.edit') || can('inventory.edit'))
  const canCancel = !['ordered', 'fulfilled', 'cancelled'].includes(r.status) && (mine || can('procurement.edit') || can('inventory.edit'))

  async function run(fn, ok) {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(ok); onChanged()
  }
  const submit = () => run(() => supabase.rpc('proc_request_submit', { p_id: r.id }), 'Sent for approval')
  const decide = approve => {
    const comment = approve ? '' : window.prompt('Why is this request rejected?') || ''
    if (!approve && !comment) return
    run(() => supabase.rpc('approval_decide', { p_request_id: approval.id, p_approve: approve, p_comment: comment || null }), approve ? 'Approved' : 'Rejected')
  }
  const cancel = () => {
    const why = window.prompt('Cancel this request? Add a reason (optional)')
    if (why === null) return
    run(() => supabase.rpc('proc_request_cancel', { p_id: r.id, p_reason: why }), 'Request cancelled')
  }
  async function openSend() {
    const [f, t] = await Promise.all([
      supabase.from('warehouses').select('id, name').eq('site_id', r.source_site_id).eq('is_active', true).order('name'),
      supabase.from('warehouses').select('id, name').eq('site_id', r.site_id).eq('is_active', true).order('name'),
    ])
    setSend({ fromList: f.data || [], toList: t.data || [], from: f.data?.[0]?.id || '', to: t.data?.[0]?.id || '' })
  }
  const doSend = () => run(() => supabase.rpc('proc_request_fulfil_transfer', { p_id: r.id, p_from_warehouse: send.from, p_to_warehouse: send.to }), 'Stock transferred')

  const stockFor = id => (stock || []).filter(s => s.item_id === id)
  const canSend = r.request_type === 'transfer' && r.status === 'approved' && (can('inventory.edit') || can('inventory.create'))

  return (
    <Modal open onClose={onClose} title={`${r.requisition_no}${r.title ? ' · ' + r.title : ''}`} maxWidth={760}
      footer={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', width: '100%' }}>
        {canCancel && <button style={finBtn2} disabled={busy} onClick={cancel}>Cancel request</button>}
        {canEdit && <button style={finBtn2} disabled={busy} onClick={onEdit}>Edit</button>}
        {['draft', 'rejected'].includes(r.status) && (mine || can('procurement.edit') || can('inventory.edit')) && <button style={finBtn} disabled={busy} onClick={submit}>Send for approval</button>}
        {approval?.canAct && <>
          <button style={finBtn2} disabled={busy} onClick={() => decide(false)}>Reject</button>
          <button style={finBtn} disabled={busy} onClick={() => decide(true)}>Approve</button>
        </>}
        {canSend && !send && <button style={finBtn} disabled={busy} onClick={openSend}>Send the stock</button>}
      </div>}>
      <div style={{ fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, color: FIN.muted }}>
          <Pill status={r.status} />
          <span>{r.request_type === 'transfer' ? `Transfer from ${r.source?.name} to ${r.site?.name}` : `Buy for ${r.site?.name}`}</span>
          <span>· {PRIORITY[r.priority]} priority</span>
          {r.needed_by && <span>· needed by {new Date(r.needed_by).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          {r.department?.name && <span>· {r.department.name}</span>}
          {r.work_order?.work_order_number && <span>· work order {r.work_order.work_order_number}</span>}
          {r.requester?.full_name && <span>· asked by {r.requester.full_name}</span>}
        </div>
        {r.notes && <div style={{ fontSize: 13, color: FIN.ink, whiteSpace: 'pre-wrap' }}>{r.notes}</div>}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ color: FIN.muted, textAlign: 'left' }}>
              <th style={{ padding: '6px 4px', fontWeight: 600 }}>What</th>
              <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Qty</th>
              <th style={{ padding: '6px 4px', fontWeight: 600, textAlign: 'right' }}>Est. each</th>
              <th style={{ padding: '6px 4px', fontWeight: 600 }}>In stock now</th>
            </tr></thead>
            <tbody>{lines.map(l => {
              const st = l.item_id ? stockFor(l.item_id) : []
              const here = st.filter(s => s.site_id === r.site_id).reduce((a, s) => a + Number(s.on_hand), 0)
              const elsewhere = st.filter(s => s.site_id !== r.site_id)
              return (
                <tr key={l.id} style={{ borderTop: `1px solid ${FIN.lineSoft}`, verticalAlign: 'top' }}>
                  <td style={{ padding: '8px 4px' }}>{lineName(l)}{!l.item_id && <span style={{ color: FIN.faint }}> · service / not stocked</span>}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>{Number(l.quantity)} {l.unit || ''}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'right' }}>{l.estimated_cost ? `$${money(l.estimated_cost)}` : '—'}</td>
                  <td style={{ padding: '8px 4px', fontSize: 12.5 }}>
                    {!l.item_id ? '—' : stock === null ? '…' : (
                      <>
                        <span style={{ color: here >= Number(l.quantity) ? FIN.good : FIN.muted, fontWeight: here > 0 ? 600 : 400 }}>{here} here</span>
                        {elsewhere.map(s => <span key={s.warehouse_id} style={{ display: 'block', color: FIN.blue }}>{Number(s.on_hand)} at {s.site} ({s.warehouse})</span>)}
                      </>
                    )}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
        {r.request_type === 'buy' && ['draft', 'submitted'].includes(r.status) && (stock || []).some(s => s.site_id !== r.site_id) && (
          <div style={{ fontSize: 12.5, padding: '8px 12px', borderRadius: 8, background: FIN.blueTint, color: FIN.blue }}>
            Another site has some of these items. Consider a transfer request instead of buying.
          </div>
        )}

        {send && (
          <section aria-label="Send the stock" style={{ border: `1px solid ${FIN.line}`, borderRadius: 10, padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, alignItems: 'end' }}>
            <label style={{ fontSize: 12, color: FIN.muted }}>From store ({r.source?.name})
              <select value={send.from} onChange={e => setSend({ ...send, from: e.target.value })} style={{ ...finInput, width: '100%', marginTop: 4 }}>
                {send.fromList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></label>
            <label style={{ fontSize: 12, color: FIN.muted }}>Into store ({r.site?.name})
              <select value={send.to} onChange={e => setSend({ ...send, to: e.target.value })} style={{ ...finInput, width: '100%', marginTop: 4 }}>
                {send.toList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></label>
            <button style={finBtn} disabled={busy || !send.from || !send.to} onClick={doSend}>Move stock now</button>
          </section>
        )}

        {trail.length > 0 && (
          <section aria-label="Approval history">
            <div style={{ fontSize: 12, fontWeight: 600, color: FIN.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>History</div>
            {trail.map((a, i) => (
              <div key={i} style={{ fontSize: 12.5, color: FIN.ink, padding: '3px 0' }}>
                <span style={{ color: FIN.faint }}>{new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                {' · '}{a.actor?.full_name || 'System'} {a.action}{a.step_label ? ` (${a.step_label})` : ''}{a.comment ? ` — ${a.comment}` : ''}
              </div>
            ))}
          </section>
        )}
      </div>
    </Modal>
  )
}

// ── New / edit ──────────────────────────────────────────────────────────────────
function RequestForm({ initial, sites, currentSiteId, onClose, onSaved }) {
  const isNew = !initial.id
  const [f, setF] = useState(() => ({
    site_id: initial.site_id || currentSiteId, request_type: initial.request_type || 'buy', source_site_id: initial.source_site_id || '',
    title: initial.title || '', priority: initial.priority || 'normal', needed_by: initial.needed_by || '',
    department_id: initial.department_id || '', cost_centre_id: initial.cost_centre_id || '', project_id: initial.project_id || '',
    work_order_id: initial.work_order_id || '', notes: initial.notes || '',
  }))
  const [lines, setLines] = useState(() => {
    const l = (initial.lines || []).filter(x => !x.is_archived).map(x => ({ item_id: x.item_id || '', item_text: x.item ? `${x.item.item_code} — ${x.item.description}` : '',
      description: x.description || '', unit: x.unit || '', quantity: x.quantity, estimated_cost: x.estimated_cost ?? '' }))
    return l.length ? l : [{ ...EMPTY_LINE }]
  })
  const [ref, setRef] = useState({ items: [], depts: [], ccs: [], projects: [], wos: [] })
  const [stock, setStock] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('items').select('id, item_code, description, average_cost').eq('is_archived', false).order('description').limit(5000),
      supabase.from('departments').select('id, name').eq('site_id', f.site_id).eq('is_archived', false).order('name'),
      supabase.from('cost_centres').select('id, code, name').eq('site_id', f.site_id).eq('is_archived', false).order('code'),
      supabase.from('projects').select('id, project_code, name').eq('site_id', f.site_id).eq('is_archived', false).order('name'),
      supabase.from('fleet_work_orders').select('id, work_order_number, fault_description, status').eq('site_id', f.site_id).not('status', 'in', '(completed,closed,cancelled)').order('created_at', { ascending: false }).limit(200),
    ]).then(([i, d, c, p, w]) => setRef({ items: i.data || [], depts: d.data || [], ccs: c.data || [], projects: p.data || [], wos: w.data || [] }))
  }, [f.site_id])

  const itemIds = lines.map(l => l.item_id).filter(Boolean).join(',')
  useEffect(() => {
    if (!itemIds) { setStock([]); return }
    supabase.rpc('proc_stock_check', { p_item_ids: itemIds.split(',') }).then(({ data }) => setStock(data || []))
  }, [itemIds])

  const itemLabel = it => `${it.item_code} — ${it.description}`
  function setLine(i, patch) { setLines(ls => ls.map((l, k) => k === i ? { ...l, ...patch } : l)) }
  function pickItem(i, text) {
    const it = ref.items.find(x => itemLabel(x) === text)
    setLine(i, { item_text: text, item_id: it?.id || '', estimated_cost: it && !lines[i].estimated_cost && it.average_cost ? Number(it.average_cost).toFixed(2) : lines[i].estimated_cost })
  }

  async function save(submit) {
    setBusy(true)
    const payload = { ...f, id: initial.id || null, submit,
      lines: lines.map(l => ({ item_id: l.item_id || null, description: l.item_id ? null : (l.description || l.item_text), unit: l.unit, quantity: l.quantity, estimated_cost: l.estimated_cost })) }
    const { error } = await supabase.rpc('proc_request_save', { p: payload })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(submit ? 'Request sent for approval' : 'Draft saved')
    onSaved()
  }

  const lab = { display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }
  const inp = { ...finInput, width: '100%' }
  const total = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.estimated_cost || 0), 0)
  const otherSites = sites.filter(s => s.id !== f.site_id)

  return (
    <Modal open onClose={onClose} dirty title={isNew ? 'New request' : `Edit ${initial.requisition_no}`} maxWidth={820}
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
        <button style={finBtn2} onClick={onClose}>Close</button>
        <button style={finBtn2} disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button style={finBtn} disabled={busy} onClick={() => save(true)}>{busy ? 'Saving…' : 'Send for approval'}</button>
      </div>}>
      <div style={{ fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div role="radiogroup" aria-label="Type of request" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {[['buy', 'Buy it', 'HQ Procurement buys from a supplier'], ['transfer', 'Transfer from another site', 'Another site already has the stock']].map(([k, t, d]) => (
            <button key={k} role="radio" aria-checked={f.request_type === k} onClick={() => setF({ ...f, request_type: k })}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
                border: `1.5px solid ${f.request_type === k ? FIN.maroon : FIN.field}`, background: f.request_type === k ? FIN.maroonTint : '#fff' }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: FIN.ink }}>{t}</div>
              <div style={{ fontSize: 12, color: FIN.muted }}>{d}</div>
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label><span style={lab}>For site</span>
            <select id="req-site" value={f.site_id} onChange={e => setF({ ...f, site_id: e.target.value, department_id: '', cost_centre_id: '', project_id: '', work_order_id: '' })} style={inp}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          {f.request_type === 'transfer' && (
            <label><span style={lab}>Transfer from</span>
              <select id="req-source" value={f.source_site_id} onChange={e => setF({ ...f, source_site_id: e.target.value })} style={inp}>
                <option value="">Choose a site</option>
                {otherSites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
          )}
          <label style={{ gridColumn: 'span 2' }}><span style={lab}>What is it for?</span>
            <input id="req-title" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Tyres for dump truck DT-04" style={inp} /></label>
          <label><span style={lab}>Needed by</span>
            <input id="req-needed" type="date" value={f.needed_by} onChange={e => setF({ ...f, needed_by: e.target.value })} style={inp} /></label>
          <label><span style={lab}>Priority</span>
            <select id="req-priority" value={f.priority} onChange={e => setF({ ...f, priority: e.target.value })} style={inp}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label><span style={lab}>Department</span>
            <select id="req-dept" value={f.department_id} onChange={e => setF({ ...f, department_id: e.target.value })} style={inp}>
              <option value="">—</option>{ref.depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select></label>
          <label><span style={lab}>Cost centre</span>
            <select id="req-cc" value={f.cost_centre_id} onChange={e => setF({ ...f, cost_centre_id: e.target.value })} style={inp}>
              <option value="">—</option>{ref.ccs.map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
            </select></label>
          <label><span style={lab}>Project</span>
            <select id="req-project" value={f.project_id} onChange={e => setF({ ...f, project_id: e.target.value })} style={inp}>
              <option value="">—</option>{ref.projects.map(p => <option key={p.id} value={p.id}>{p.project_code ? p.project_code + ' ' : ''}{p.name}</option>)}
            </select></label>
          <label><span style={lab}>Fleet work order</span>
            <select id="req-wo" value={f.work_order_id} onChange={e => setF({ ...f, work_order_id: e.target.value })} style={inp}>
              <option value="">—</option>{ref.wos.map(w => <option key={w.id} value={w.id}>{w.work_order_number} {w.fault_description ? '· ' + w.fault_description.slice(0, 40) : ''}</option>)}
            </select></label>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>What do you need?</span>
            {total > 0 && <span style={{ fontSize: 12.5, color: FIN.muted }}>About ${money(total)}</span>}
          </div>
          <datalist id="req-items">{ref.items.map(it => <option key={it.id} value={itemLabel(it)} />)}</datalist>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lines.map((l, i) => {
              const st = l.item_id ? stock.filter(s => s.item_id === l.item_id) : []
              const here = st.filter(s => s.site_id === f.site_id).reduce((a, s) => a + Number(s.on_hand), 0)
              const away = st.filter(s => s.site_id !== f.site_id)
              return (
                <div key={i} style={{ border: `1px solid ${FIN.line}`, borderRadius: 10, padding: 10 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 3fr) repeat(3, minmax(80px, 1fr)) auto', gap: 8, alignItems: 'end' }}>
                    <label><span style={lab}>Stock item, or describe it</span>
                      <input list="req-items" value={l.item_id ? l.item_text : (l.item_text || l.description)} onChange={e => pickItem(i, e.target.value)}
                        placeholder="Search the catalogue or type a service" style={inp} /></label>
                    <label><span style={lab}>Qty</span>
                      <input type="number" inputMode="decimal" min="0" step="any" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} style={inp} /></label>
                    <label><span style={lab}>Unit</span>
                      <input value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} placeholder="ea" style={inp} /></label>
                    <label><span style={lab}>Est. each ($)</span>
                      <input type="number" inputMode="decimal" min="0" step="0.01" value={l.estimated_cost} onChange={e => setLine(i, { estimated_cost: e.target.value })} style={inp} /></label>
                    <button aria-label="Remove line" onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, k) => k !== i) : ls)}
                      style={{ ...finBtn2, minHeight: 40, padding: '0 12px' }}>✕</button>
                  </div>
                  {l.item_id && (
                    <div style={{ fontSize: 12, marginTop: 6, color: FIN.muted }}>
                      In stock: <b style={{ color: here >= Number(l.quantity || 0) && here > 0 ? FIN.good : FIN.ink }}>{here} at this site</b>
                      {away.map(s => <span key={s.warehouse_id} style={{ color: FIN.blue }}> · {Number(s.on_hand)} at {s.site}</span>)}
                      {here >= Number(l.quantity || 0) && here > 0 && f.request_type === 'buy' && <span style={{ color: FIN.good }}> — ask your stores to issue it instead</span>}
                    </div>
                  )}
                  {!l.item_id && (l.item_text || '').trim() && f.request_type === 'transfer' && (
                    <div style={{ fontSize: 12, marginTop: 6, color: FIN.bad }}>Transfers can only include catalogue stock items.</div>
                  )}
                </div>
              )
            })}
          </div>
          <button style={{ ...finBtn2, marginTop: 8 }} onClick={() => setLines(ls => [...ls, { ...EMPTY_LINE }])}>Add a line</button>
        </div>

        <label><span style={lab}>Notes for the approver or buyer</span>
          <textarea id="req-notes" rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} style={{ ...inp, resize: 'vertical' }} /></label>
      </div>
    </Modal>
  )
}
