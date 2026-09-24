import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { Card, Button, Icon, Modal, showToast, PageHeader } from '../../components/ui'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = '#5C6BC0'

export const ENTITY_LABELS = {
  purchase_requisitions: { label: 'Requisition',      unit: '$',    icon: 'request_quote' },
  purchase_orders:       { label: 'Purchase order',   unit: '$',    icon: 'shopping_cart' },
  purchase_invoices:     { label: 'Supplier invoice', unit: '$',    icon: 'receipt_long' },
  fuel_requests:         { label: 'Fuel request',     unit: 'L',    icon: 'local_gas_station' },
  leave_requests:        { label: 'Leave',            unit: 'days', icon: 'flight_takeoff' },
  expense_claims:        { label: 'Expense claim',    unit: '$',    icon: 'receipt_long' },
}

const STATUS = {
  pending:   { bg: THEME.statusWarningBg, color: THEME.statusWarningText, label: 'Waiting' },
  approved:  { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Approved' },
  rejected:  { bg: THEME.statusErrorBg,   color: THEME.statusErrorText,   label: 'Rejected' },
  cancelled: { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Cancelled' },
}

const ACTION_TEXT = {
  submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected',
  skipped: 'Skipped', cancelled: 'Cancelled', resubmitted: 'Value changed — re-routed',
}

export function formatAmount(entity, amount) {
  const u = ENTITY_LABELS[entity]?.unit
  const n = Number(amount || 0)
  if (u === '$') return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${n.toLocaleString('en-US')} ${u || ''}`.trim()
}

function age(ts) {
  const h = Math.floor((Date.now() - new Date(ts).getTime()) / 3600000)
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const tab = active => ({
  padding: '8px 14px', border: 'none', borderBottom: `2px solid ${active ? ACCENT : 'transparent'}`,
  background: 'transparent', color: active ? ACCENT : THEME.textMed, fontWeight: active ? 600 : 400,
  fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer',
})

export default function ApprovalsInbox() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('approval_requests', {})

  const [view, setView] = useState('mine')
  const [inbox, setInbox] = useState([])
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [trail, setTrail] = useState({})
  const [busy, setBusy] = useState(null)
  const [rejectFor, setRejectFor] = useState(null)
  const [reason, setReason] = useState('')

  const canSeeAll = can('approvals.view')

  const load = useCallback(async () => {
    setLoading(true)
    const { data: mine, error } = await supabase.rpc('approval_inbox')
    if (error) showToast('Failed to load approvals', 'red')
    setInbox(mine || [])
    if (view !== 'mine' && profile?.id) {
      let q = supabase.from('approval_requests')
        .select('id, site_id, entity_type, entity_id, title, link, amount, status, current_step, created_at, decided_at, requested_by, requester:profiles!approval_requests_requested_by_fkey(full_name, username)')
        .order('created_at', { ascending: false }).limit(100)
      q = view === 'requested' ? q.eq('requested_by', profile.id) : q.eq('site_id', currentSiteId)
      const { data } = await q
      setList(data || [])
    }
    setLoading(false)
  }, [view, currentSiteId, profile?.id])

  useEffect(() => { load() }, [load, rt])

  async function toggleTrail(id) {
    if (openId === id) { setOpenId(null); return }
    setOpenId(id)
    if (!trail[id]) {
      const { data } = await supabase.from('approval_actions')
        .select('id, action, step_label, comment, created_at, actor:profiles!approval_actions_actor_id_fkey(full_name, username)')
        .eq('request_id', id).order('created_at')
      setTrail(t => ({ ...t, [id]: data || [] }))
    }
  }

  async function decide(id, approve, comment) {
    setBusy(id)
    const { data, error } = await supabase.rpc('approval_decide', { p_request_id: id, p_approve: approve, p_comment: comment || null })
    setBusy(null)
    if (error) { showToast(error.message, 'red'); return false }
    showToast(approve ? (data?.status === 'approved' ? 'Approved — all steps complete' : 'Approved — sent to the next approver') : 'Rejected', 'green')
    setTrail(t => ({ ...t, [id]: undefined }))
    load()
    return true
  }

  async function confirmReject() {
    if (!reason.trim()) { showToast('Give a reason so the requester knows what to fix', 'red'); return }
    if (await decide(rejectFor.id, false, reason.trim())) { setRejectFor(null); setReason('') }
  }

  const rows = view === 'mine' ? inbox : list

  return (
    <div>
      <PageHeader title="Approvals" />

      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${THEME.outlineVar}`, marginBottom: '16px', flexWrap: 'wrap' }}>
        <button style={tab(view === 'mine')} onClick={() => setView('mine')}>
          Waiting for me {inbox.length > 0 && <span style={{ marginLeft: '4px', padding: '0 7px', borderRadius: '999px', background: ACCENT, color: '#fff', fontSize: '11px' }}>{inbox.length}</span>}
        </button>
        <button style={tab(view === 'requested')} onClick={() => setView('requested')}>My requests</button>
        {canSeeAll && <button style={tab(view === 'site')} onClick={() => setView('site')}>All at this site</button>}
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: ACCENT }} /></div>
      ) : rows.length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="task_alt" size={32} style={{ color: THEME.outlineVar, marginBottom: '8px' }} />
          <div style={{ fontSize: '13px' }}>{view === 'mine' ? 'Nothing is waiting for your approval.' : 'No approval requests yet.'}</div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {rows.map(r => {
            const ent = ENTITY_LABELS[r.entity_type] || { label: r.entity_type, icon: 'description' }
            const st = STATUS[r.status || 'pending']
            const requester = r.requester_name || r.requester?.full_name || r.requester?.username || '—'
            return (
              <Card key={r.id} style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <Icon name={ent.icon} size={22} style={{ color: ACCENT, marginTop: '2px' }} />
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: THEME.text }}>{r.title}</span>
                      {view !== 'mine' && <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: st.bg, color: st.color }}>{st.label}</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '3px' }}>
                      {ent.label} · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatAmount(r.entity_type, r.amount)}</span> · from {requester}
                      {r.site_name && ` · ${r.site_name}`} · {age(r.created_at)}
                    </div>
                    {view === 'mine' && (
                      <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '4px' }}>
                        Step {r.current_step} of {r.total_steps}: <b>{r.step_label}</b>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {r.link && <Button size="sm" variant="text" icon="open_in_new" onClick={() => navigate(r.link)}>Open</Button>}
                    <Button size="sm" variant="text" icon={openId === r.id ? 'expand_less' : 'history'} onClick={() => toggleTrail(r.id)}>History</Button>
                    {view === 'mine' && <>
                      <Button size="sm" variant="outlined" disabled={busy === r.id} onClick={() => { setRejectFor(r); setReason('') }}
                        style={{ color: THEME.error, borderColor: THEME.error }}>Reject</Button>
                      <Button size="sm" variant="success" icon="check" disabled={busy === r.id} onClick={() => decide(r.id, true)}>Approve</Button>
                    </>}
                  </div>
                </div>

                {openId === r.id && (
                  <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'grid', gap: '6px' }}>
                    {!trail[r.id] ? <div style={{ fontSize: '12px', color: THEME.textLow }}>Loading…</div>
                      : trail[r.id].map(a => (
                        <div key={a.id} style={{ fontSize: '12px', color: THEME.textMed, display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ color: THEME.textLow, fontVariantNumeric: 'tabular-nums', minWidth: '120px' }}>{new Date(a.created_at).toLocaleString()}</span>
                          <span><b>{ACTION_TEXT[a.action] || a.action}</b>{a.step_label && ` — ${a.step_label}`}{a.actor && ` by ${a.actor.full_name || a.actor.username}`}</span>
                          {a.comment && <span style={{ color: THEME.text }}>“{a.comment}”</span>}
                        </div>
                      ))}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} title="Reject request"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="text" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmReject} disabled={busy === rejectFor?.id}>Reject</Button>
          </div>
        }>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '8px' }}>{rejectFor?.title}</div>
        <label htmlFor="reject-reason" style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Reason *</label>
        <textarea id="reject-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="What needs to change?"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit',
            border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text, resize: 'vertical' }} />
      </Modal>
    </div>
  )
}
