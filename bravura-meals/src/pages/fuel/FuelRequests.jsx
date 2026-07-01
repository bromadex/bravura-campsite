import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, showToast } from '../../components/ui'
import { supabase } from '../../supabaseClient'

const FUEL_CLR = MODULE_COLORS.fuel

// ── Badge helpers ─────────────────────────────────────────────────────────────

const STATUS_META = {
  pending:   { label: 'Pending',   bg: THEME.statusWarningBg,  text: THEME.statusWarningText,  icon: 'schedule'       },
  approved:  { label: 'Approved',  bg: THEME.statusInfoBg,     text: THEME.statusInfoText,     icon: 'check_circle'   },
  rejected:  { label: 'Rejected',  bg: THEME.statusErrorBg,    text: THEME.statusErrorText,    icon: 'cancel'         },
  issued:    { label: 'Issued',    bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  icon: 'local_shipping' },
  cancelled: { label: 'Cancelled', bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText,  icon: 'block'          },
}

const PRIORITY_META = {
  normal:    { label: 'Normal',    color: THEME.textMed,  icon: 'circle'         },
  urgent:    { label: 'Urgent',    color: THEME.warning,  icon: 'warning'        },
  emergency: { label: 'Emergency', color: THEME.error,    icon: 'emergency_home' },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px',
      background: m.bg, color: m.text,
      fontSize: '11px', fontWeight: 600,
    }}>
      <Icon name={m.icon} size={12} style={{ color: m.text }} />
      {m.label}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const m = PRIORITY_META[priority] || PRIORITY_META.normal
  if (priority === 'normal') return <span style={{ fontSize: '12px', color: THEME.textLow }}>—</span>
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 8px', borderRadius: '6px',
      background: m.color + '18', color: m.color,
      fontSize: '11px', fontWeight: 600,
    }}>
      <Icon name={m.icon} size={11} style={{ color: m.color }} />
      {m.label}
    </span>
  )
}

// ── Approve modal ─────────────────────────────────────────────────────────────

function ApproveModal({ req, onConfirm, onClose, saving }) {
  const [note, setNote] = useState('')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: THEME.surface, borderRadius: '6px', padding: '28px 32px',
          width: '480px', maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: THEME.statusInfoBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check_circle" size={20} style={{ color: THEME.statusInfoText }} />
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Approve Request</div>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>{req.request_number}</div>
          </div>
        </div>

        <div style={{ background: THEME.surfaceVar, borderRadius: '12px', padding: '14px 16px', marginBottom: '18px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {[
              ['Requested By', req.requested_by_profile?.full_name || '—'],
              ['Asset', req.fuel_vehicles ? req.fuel_vehicles.fleet_number : req.fuel_equipment?.name || '—'],
              ['Fuel Type', req.fuel_types?.name || '—'],
              ['Quantity', `${Number(req.quantity_requested).toLocaleString()} L`],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text, marginTop: '2px' }}>{value}</div>
              </div>
            ))}
          </div>
          {req.intended_use && (
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>Intended Use</div>
              <div style={{ fontSize: '13px', color: THEME.text, marginTop: '2px' }}>{req.intended_use}</div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Approval Note <span style={{ color: THEME.textLow, fontWeight: 400, textTransform: 'none' }}>(optional)</span>
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Any instructions for the issuer (e.g. use Tank A, limit to 200L)…"
            rows={2}
            style={{
              width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
              borderRadius: '12px', fontSize: '14px', color: THEME.text,
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
              background: THEME.surface, resize: 'vertical',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '10px 20px', borderRadius: '12px', border: `1px solid ${THEME.outline}`,
            background: THEME.surface, color: THEME.textMed,
            fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={() => onConfirm(note.trim())}
            disabled={saving}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '10px 20px', borderRadius: '12px', border: 'none',
              background: saving ? THEME.outline : FUEL_CLR, color: '#fff',
              fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? <><Icon name="progress_activity" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Approving…</>
              : <><Icon name="check_circle" size={15} /> Approve</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Reject modal ──────────────────────────────────────────────────────────────

function RejectModal({ req, onConfirm, onClose, saving }) {
  const [reason, setReason] = useState('')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: THEME.surface, borderRadius: '6px', padding: '28px 32px',
          width: '440px', maxWidth: '95vw', boxShadow: '0 8px 40px rgba(0,0,0,.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: THEME.statusErrorBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="cancel" size={20} style={{ color: THEME.statusErrorText }} />
          </div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Reject Request</div>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>{req.request_number}</div>
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Reason <span style={{ color: THEME.error }}>*</span>
          </label>
          <textarea
            autoFocus
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Explain why this request is being rejected…"
            rows={3}
            style={{
              width: '100%', padding: '10px 14px', border: `1px solid ${reason.trim() ? THEME.outline : THEME.error}`,
              borderRadius: '12px', fontSize: '14px', color: THEME.text,
              fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
              background: THEME.surface, resize: 'vertical',
            }}
          />
          {!reason.trim() && <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px' }}>A reason is required</div>}
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '10px 20px', borderRadius: '12px', border: `1px solid ${THEME.outline}`,
            background: THEME.surface, color: THEME.textMed,
            fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={saving || !reason.trim()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '10px 20px', borderRadius: '12px', border: 'none',
              background: saving || !reason.trim() ? THEME.outline : THEME.error, color: '#fff',
              fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: saving || !reason.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? <><Icon name="progress_activity" size={15} style={{ animation: 'spin 1s linear infinite' }} /> Rejecting…</>
              : <><Icon name="cancel" size={15} /> Reject</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Detail slide-over ─────────────────────────────────────────────────────────

function DetailPanel({ req, onClose, onApprove, onReject, onIssue, canApprove, canIssue }) {
  if (!req) return null
  const s = STATUS_META[req.status] || STATUS_META.pending
  const p = PRIORITY_META[req.priority] || PRIORITY_META.normal

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={onClose} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 100,
        width: '380px', background: THEME.surface,
        borderLeft: `1px solid ${THEME.outlineVar}`,
        boxShadow: '-4px 0 24px rgba(0,0,0,.08)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.text, fontFamily: 'monospace' }}>{req.request_number}</div>
            <StatusBadge status={req.status} />
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', flex: 1 }}>
          {[
            ['Requested By', req.requested_by_profile?.full_name || '—'],
            ['Date', new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })],
            ['Asset', req.fuel_vehicles ? `${req.fuel_vehicles.fleet_number}${req.fuel_vehicles.registration ? ' (' + req.fuel_vehicles.registration + ')' : ''}` : req.fuel_equipment ? `${req.fuel_equipment.name} (${req.fuel_equipment.equipment_number || '—'})` : '—'],
            ['Fuel Type', req.fuel_types?.name || '—'],
            ['Quantity Requested', `${Number(req.quantity_requested).toLocaleString()} L`],
            ['Intended Use', req.intended_use || '—'],
            ['Priority', <PriorityBadge key="p" priority={req.priority} />],
          ].map(([label, value]) => (
            <div key={label} style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>{label}</div>
              <div style={{ fontSize: '13px', color: THEME.text }}>{value}</div>
            </div>
          ))}

          {req.notes && (
            <div style={{ marginBottom: '14px' }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>Notes</div>
              <div style={{ fontSize: '13px', color: THEME.text }}>{req.notes}</div>
            </div>
          )}

          {req.status === 'approved' && req.approved_by_profile && (
            <div style={{ background: THEME.statusInfoBg, borderRadius: '10px', padding: '12px', marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.statusInfoText, marginBottom: '4px' }}>Approved by {req.approved_by_profile.full_name}</div>
              <div style={{ fontSize: '11px', color: THEME.statusInfoText }}>{new Date(req.approved_at).toLocaleString('en-GB')}</div>
              {req.notes && req.status === 'approved' && <div style={{ fontSize: '11px', color: THEME.statusInfoText, marginTop: '4px' }}>{req.notes}</div>}
            </div>
          )}

          {req.status === 'rejected' && req.rejected_reason && (
            <div style={{ background: THEME.statusErrorBg, borderRadius: '10px', padding: '12px', marginBottom: '14px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.statusErrorText, marginBottom: '2px' }}>Rejection Reason</div>
              <div style={{ fontSize: '12px', color: THEME.statusErrorText }}>{req.rejected_reason}</div>
            </div>
          )}
        </div>

        {/* Actions */}
        {(req.status === 'pending' && canApprove) && (
          <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', gap: '10px' }}>
            <button onClick={() => onReject(req)} style={{
              flex: 1, padding: '10px', borderRadius: '12px', border: `1px solid ${THEME.error}55`,
              background: THEME.statusErrorBg, color: THEME.error,
              fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}>
              <Icon name="cancel" size={15} /> Reject
            </button>
            <button onClick={() => onApprove(req)} style={{
              flex: 1, padding: '10px', borderRadius: '12px', border: 'none',
              background: FUEL_CLR, color: '#fff',
              fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            }}>
              <Icon name="check_circle" size={15} /> Approve
            </button>
          </div>
        )}
        {(req.status === 'approved' && canIssue) && (
          <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}` }}>
            <button onClick={() => onIssue(req)} style={{
              width: '100%', padding: '11px', borderRadius: '12px', border: 'none',
              background: FUEL_CLR, color: '#fff',
              fontFamily: 'inherit', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}>
              <Icon name="output" size={16} /> Issue Fuel Against This Request
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const ALL_STATUSES = ['pending','approved','rejected','issued','cancelled']

export default function FuelRequests({ setPage }) {
  const { can }                      = usePermissions()
  const { currentSiteId }            = useSite()
  const { profile }                  = useAuth()

  const [requests,    setRequests]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [actionSaving, setActionSaving] = useState(false)

  // Filters
  const [filterStatus,   setFilterStatus]   = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [search,         setSearch]         = useState('')

  // Modal state
  const [approveTarget, setApproveTarget] = useState(null)
  const [rejectTarget,  setRejectTarget]  = useState(null)
  const [detailReq,     setDetailReq]     = useState(null)

  const canApprove = can('fuel.approve')
  const canIssue   = can('fuel.create')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fuel_requests')
      .select(`
        *,
        requested_by_profile:profiles!fuel_requests_requested_by_fkey(id, full_name),
        approved_by_profile:profiles!fuel_requests_approved_by_fkey(id, full_name),
        fuel_types(id, name, code),
        fuel_vehicles(id, fleet_number, registration),
        fuel_equipment(id, name, equipment_number)
      `)
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); showToast('Failed to load requests', 'red') }
    setRequests(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  // Filtered rows
  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (filterStatus !== 'all' && r.status !== filterStatus) return false
      if (filterPriority !== 'all' && r.priority !== filterPriority) return false
      if (dateFrom && r.created_at.slice(0, 10) < dateFrom) return false
      if (dateTo   && r.created_at.slice(0, 10) > dateTo)   return false
      if (search) {
        const q = search.toLowerCase()
        const reqNo    = r.request_number?.toLowerCase() || ''
        const requester = r.requested_by_profile?.full_name?.toLowerCase() || ''
        const asset    = (r.fuel_vehicles?.fleet_number || r.fuel_equipment?.name || '').toLowerCase()
        if (!reqNo.includes(q) && !requester.includes(q) && !asset.includes(q)) return false
      }
      return true
    })
  }, [requests, filterStatus, filterPriority, dateFrom, dateTo, search])

  // Pending count for summary
  const pendingCount = requests.filter(r => r.status === 'pending').length

  async function handleApprove(note) {
    if (!approveTarget) return
    setActionSaving(true)
    try {
      const { error } = await supabase
        .from('fuel_requests')
        .update({
          status:      'approved',
          approved_by: profile.id,
          approved_at: new Date().toISOString(),
          notes:       note || null,
        })
        .eq('id', approveTarget.id)
      if (error) throw error
      showToast(`Request ${approveTarget.request_number} approved`, 'green')
      setApproveTarget(null)
      setDetailReq(null)
      await load()
    } catch (err) {
      showToast(err.message || 'Failed to approve request', 'red')
    } finally {
      setActionSaving(false)
    }
  }

  async function handleReject(reason) {
    if (!rejectTarget) return
    setActionSaving(true)
    try {
      const { error } = await supabase
        .from('fuel_requests')
        .update({
          status:          'rejected',
          rejected_reason: reason,
        })
        .eq('id', rejectTarget.id)
      if (error) throw error
      showToast(`Request ${rejectTarget.request_number} rejected`, 'red')
      setRejectTarget(null)
      setDetailReq(null)
      await load()
    } catch (err) {
      showToast(err.message || 'Failed to reject request', 'red')
    } finally {
      setActionSaving(false)
    }
  }

  function handleIssue(req) {
    // Pass the request to FuelIssuance via sessionStorage
    sessionStorage.setItem('fuel_request_prefill', JSON.stringify({
      request_id:         req.id,
      request_number:     req.request_number,
      vehicle_id:         req.vehicle_id   || null,
      equipment_id:       req.equipment_id || null,
      asset_type:         req.vehicle_id ? 'vehicle' : 'equipment',
      quantity_requested: req.quantity_requested,
      fuel_type_id:       req.fuel_type_id,
    }))
    setPage('fuel_issuance')
  }

  if (!can('fuel.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p style={{ fontSize: '14px' }}>You do not have access to Fuel.</p>
    </div>
  )

  const inpStyle = {
    padding: '8px 12px', border: `1px solid ${THEME.outline}`,
    borderRadius: '10px', fontSize: '13px', color: THEME.text,
    fontFamily: 'inherit', outline: 'none', background: THEME.surface,
  }

  const selStyle = { ...inpStyle, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: '1100px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 300, color: THEME.text }}>Fuel Requests</div>
          <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>
            {pendingCount > 0
              ? <span style={{ color: THEME.warning, fontWeight: 600 }}>{pendingCount} pending approval</span>
              : 'All requests up to date'}
          </div>
        </div>
        <button
          onClick={() => setPage('fuel_request_form')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px',
            padding: '10px 20px', borderRadius: '12px', border: 'none',
            background: FUEL_CLR, color: '#fff',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Icon name="add" size={16} /> New Request
        </button>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center',
        background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '14px', padding: '14px 16px', marginBottom: '16px',
      }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search request no, requester, asset…"
          style={{ ...inpStyle, width: '220px' }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
          <option value="all">All Statuses</option>
          {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={selStyle}>
          <option value="all">All Priorities</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
          <option value="emergency">Emergency</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inpStyle} title="From date" />
        <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   style={inpStyle} title="To date" />
        {(search || filterStatus !== 'all' || filterPriority !== 'all' || dateFrom || dateTo) && (
          <button
            onClick={() => { setSearch(''); setFilterStatus('all'); setFilterPriority('all'); setDateFrom(''); setDateTo('') }}
            style={{ ...inpStyle, color: THEME.textMed, cursor: 'pointer', border: 'none', background: THEME.surfaceVar }}
          >
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
          {filtered.length} of {requests.length}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
          <Icon name="inbox" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
          <div style={{ fontSize: '14px' }}>No requests found</div>
        </div>
      ) : (
        <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                {['Request No', 'Date', 'Requested By', 'Asset', 'Fuel Type', 'Qty (L)', 'Priority', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{
                    padding: '12px 14px', textAlign: 'left',
                    fontSize: '11px', fontWeight: 600, color: THEME.textMed,
                    textTransform: 'uppercase', letterSpacing: '.05em',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((req, i) => {
                const asset = req.fuel_vehicles
                  ? req.fuel_vehicles.fleet_number
                  : req.fuel_equipment?.name || '—'
                const isHighPriority = req.priority !== 'normal'
                const rowBg = req.status === 'pending' && isHighPriority
                  ? (req.priority === 'emergency' ? THEME.error + '08' : THEME.warning + '08')
                  : 'transparent'

                return (
                  <tr
                    key={req.id}
                    onClick={() => setDetailReq(req)}
                    style={{
                      borderBottom: i < filtered.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                      background: rowBg, cursor: 'pointer', transition: 'background .12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = rowBg}
                  >
                    <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontSize: '12px', fontWeight: 700, color: FUEL_CLR, whiteSpace: 'nowrap' }}>
                      {req.request_number}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>
                      {new Date(req.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: THEME.text }}>
                      {req.requested_by_profile?.full_name || '—'}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: THEME.text, whiteSpace: 'nowrap' }}>
                      {asset}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: THEME.text }}>
                      {req.fuel_types?.name || '—'}
                    </td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: THEME.text, textAlign: 'right', fontFamily: 'monospace' }}>
                      {Number(req.quantity_requested).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <PriorityBadge priority={req.priority} />
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <StatusBadge status={req.status} />
                    </td>
                    <td style={{ padding: '12px 14px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {req.status === 'pending' && canApprove && (
                          <>
                            <button
                              onClick={() => setApproveTarget(req)}
                              title="Approve"
                              style={{
                                padding: '5px 10px', borderRadius: '8px', border: 'none',
                                background: FUEL_CLR, color: '#fff',
                                fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                              }}
                            >
                              <Icon name="check" size={13} /> Approve
                            </button>
                            <button
                              onClick={() => setRejectTarget(req)}
                              title="Reject"
                              style={{
                                padding: '5px 10px', borderRadius: '8px',
                                border: `1px solid ${THEME.error}55`,
                                background: THEME.statusErrorBg, color: THEME.error,
                                fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                              }}
                            >
                              <Icon name="close" size={13} /> Reject
                            </button>
                          </>
                        )}
                        {req.status === 'approved' && canIssue && (
                          <button
                            onClick={() => handleIssue(req)}
                            title="Issue fuel for this request"
                            style={{
                              padding: '5px 10px', borderRadius: '8px', border: 'none',
                              background: FUEL_CLR, color: '#fff',
                              fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                            }}
                          >
                            <Icon name="output" size={13} /> Issue
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {approveTarget && (
        <ApproveModal
          req={approveTarget}
          saving={actionSaving}
          onConfirm={handleApprove}
          onClose={() => setApproveTarget(null)}
        />
      )}
      {rejectTarget && (
        <RejectModal
          req={rejectTarget}
          saving={actionSaving}
          onConfirm={handleReject}
          onClose={() => setRejectTarget(null)}
        />
      )}
      <DetailPanel
        req={detailReq}
        onClose={() => setDetailReq(null)}
        onApprove={r => { setDetailReq(null); setApproveTarget(r) }}
        onReject={r  => { setDetailReq(null); setRejectTarget(r)  }}
        onIssue={handleIssue}
        canApprove={canApprove}
        canIssue={canIssue}
      />
    </div>
  )
}
