import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const STATUS_COLORS = {
  requested:           { bg: '#F5F5F5', color: '#9E9E9E', icon: 'schedule' },
  supervisor_approved: { bg: '#E3F2FD', color: '#1565C0', icon: 'check' },
  sheq_approved:       { bg: '#F3E5F5', color: '#7B1FA2', icon: 'verified_user' },
  area_approved:       { bg: '#E0F2F1', color: '#00695C', icon: 'verified' },
  active:              { bg: '#E8F5E9', color: '#2E7D32', icon: 'play_circle' },
  suspended:           { bg: '#FFF3E0', color: '#E65100', icon: 'pause_circle' },
  closed:              { bg: '#ECEFF1', color: '#37474F', icon: 'check_circle' },
  expired:             { bg: '#FFEBEE', color: '#D32F2F', icon: 'timer_off' },
  rejected:            { bg: '#FFEBEE', color: '#D32F2F', icon: 'cancel' },
}

const STATUS_TABS = ['all', 'requested', 'supervisor_approved', 'sheq_approved', 'area_approved', 'active', 'suspended', 'closed', 'expired']

function fmtLabel(s) {
  if (!s) return '--'
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function fmtDate(d) {
  if (!d) return '--'
  return new Date(d).toLocaleDateString('en-ZA')
}

function fmtDateTime(d) {
  if (!d) return '--'
  return new Date(d).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const textareaStyle = { ...inputStyle, minHeight: '70px', resize: 'vertical' }

function StatusBadge({ status }) {
  const m = STATUS_COLORS[status] || { label: status, bg: THEME.surfaceVar, color: THEME.textMed, icon: 'help' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: m.bg, color: m.color,
    }}>
      <Icon name={m.icon} size={11} style={{ color: 'inherit' }} />
      {fmtLabel(status)}
    </span>
  )
}

function Field({ label, children, required }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}{required && <span style={{ color: THEME.error }}> *</span>}
      </div>
      {children}
    </div>
  )
}

// ── Determine effective status (expired override) ─────────────────────────

function effectiveStatus(permit) {
  if (permit.status === 'active' && permit.end_date) {
    const today = new Date().toISOString().slice(0, 10)
    if (permit.end_date < today) return 'expired'
  }
  return permit.status
}

// ── Approval chain display ────────────────────────────────────────────────

function ApprovalChain({ permit, profiles }) {
  const steps = [
    { label: 'Supervisor', idField: 'supervisor_approved_by', atField: 'supervisor_approved_at' },
    { label: 'SHEQ Officer', idField: 'sheq_approved_by', atField: 'sheq_approved_at' },
    { label: 'Area Authority', idField: 'area_approved_by', atField: 'area_approved_at' },
  ]
  const profMap = useMemo(() => {
    const m = {}
    profiles.forEach(p => { m[p.id] = p.name })
    return m
  }, [profiles])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {steps.map(step => {
        const approvedBy = permit[step.idField]
        const approvedAt = permit[step.atField]
        const rejected = permit.status === 'rejected' && permit.rejected_by === approvedBy
        return (
          <div key={step.label} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '8px 12px', borderRadius: '8px',
            background: approvedBy ? (rejected ? '#FFEBEE' : '#E8F5E9') : THEME.surfaceVar,
          }}>
            <Icon
              name={approvedBy ? (rejected ? 'cancel' : 'check_circle') : 'radio_button_unchecked'}
              size={18}
              style={{ color: approvedBy ? (rejected ? '#D32F2F' : '#2E7D32') : THEME.textLow }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text }}>{step.label}</div>
              {approvedBy && (
                <div style={{ fontSize: '11px', color: THEME.textMed }}>
                  {profMap[approvedBy] || 'Unknown'} -- {fmtDateTime(approvedAt)}
                </div>
              )}
            </div>
          </div>
        )
      })}
      {permit.status === 'rejected' && permit.rejection_reason && (
        <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#FFEBEE', fontSize: '12px', color: '#D32F2F' }}>
          <strong>Rejection reason:</strong> {permit.rejection_reason}
        </div>
      )}
    </div>
  )
}

// ── Create/Edit Modal ─────────────────────────────────────────────────────

function PermitModal({ permit, permitTypes, projects, profiles, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!permit

  const [form, setForm] = useState(() => {
    if (permit) return {
      title: permit.title || '',
      permit_type_id: permit.permit_type_id || '',
      description: permit.description || '',
      work_description: permit.work_description || '',
      location: permit.location || '',
      start_date: permit.start_date || '',
      end_date: permit.end_date || '',
      start_time: permit.start_time || '',
      end_time: permit.end_time || '',
      project_id: permit.project_id || '',
      hazards_identified: permit.hazards_identified || '',
      ppe_required: permit.ppe_required || '',
      emergency_procedures: permit.emergency_procedures || '',
      closure_notes: permit.closure_notes || '',
      suspension_reason: permit.suspension_reason || '',
    }
    return {
      title: '', permit_type_id: '', description: '', work_description: '',
      location: '', start_date: new Date().toISOString().slice(0, 10),
      end_date: '', start_time: '', end_time: '', project_id: '',
      hazards_identified: '', ppe_required: '', emergency_procedures: '',
      closure_notes: '', suspension_reason: '',
    }
  })

  const [saving, setSaving] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.title || !form.permit_type_id || !form.start_date) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        permit_type_id: form.permit_type_id,
        description: form.description || null,
        work_description: form.work_description || null,
        location: form.location || null,
        start_date: form.start_date,
        end_date: form.end_date || null,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        project_id: form.project_id || null,
        hazards_identified: form.hazards_identified || null,
        ppe_required: form.ppe_required || null,
        emergency_procedures: form.emergency_procedures || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_permits')
          .update(payload)
          .eq('id', permit.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Permit updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'PTW', p_table: 'sheq_permits',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.permit_number = numData
        payload.requested_by = userId
        payload.status = 'requested'
        const { error } = await supabase.from('sheq_permits').insert(payload)
        if (error) throw error
        showToast(`Permit ${numData} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Approval actions ──────────────────────────────────────────────────

  const APPROVAL_FLOW = {
    requested:           { next: 'supervisor_approved', field: 'supervisor_approved_by', atField: 'supervisor_approved_at', label: 'Supervisor Approve' },
    supervisor_approved: { next: 'sheq_approved',       field: 'sheq_approved_by',       atField: 'sheq_approved_at',       label: 'SHEQ Approve' },
    sheq_approved:       { next: 'area_approved',       field: 'area_approved_by',       atField: 'area_approved_at',       label: 'Area Authority Approve' },
    area_approved:       { next: 'active',              field: null,                     atField: null,                     label: 'Activate Permit' },
  }

  async function handleApprove() {
    const step = APPROVAL_FLOW[permit.status]
    if (!step) return
    const updates = { status: step.next }
    if (step.field) {
      updates[step.field] = userId
      updates[step.atField] = new Date().toISOString()
    }
    const { error } = await supabase
      .from('sheq_permits')
      .update(updates)
      .eq('id', permit.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Permit advanced to ${fmtLabel(step.next)}`)
    onSaved()
  }

  async function handleReject() {
    if (!rejectReason.trim()) { showToast('Please provide a rejection reason', 'error'); return }
    const { error } = await supabase
      .from('sheq_permits')
      .update({ status: 'rejected', rejected_by: userId, rejected_at: new Date().toISOString(), rejection_reason: rejectReason })
      .eq('id', permit.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Permit rejected')
    onSaved()
  }

  async function handleSuspend() {
    if (!form.suspension_reason.trim()) { showToast('Please provide a suspension reason', 'error'); return }
    const { error } = await supabase
      .from('sheq_permits')
      .update({ status: 'suspended', suspension_reason: form.suspension_reason, suspended_by: userId, suspended_at: new Date().toISOString() })
      .eq('id', permit.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Permit suspended')
    onSaved()
  }

  async function handleResume() {
    const { error } = await supabase
      .from('sheq_permits')
      .update({ status: 'active', suspension_reason: null, suspended_by: null, suspended_at: null })
      .eq('id', permit.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Permit resumed')
    onSaved()
  }

  async function handleClose() {
    if (!form.closure_notes.trim()) { showToast('Please provide closure notes', 'error'); return }
    const { error } = await supabase
      .from('sheq_permits')
      .update({ status: 'closed', closure_notes: form.closure_notes, closed_by: userId, closed_at: new Date().toISOString() })
      .eq('id', permit.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Permit closed')
    onSaved()
  }

  const eff = isEdit ? effectiveStatus(permit) : 'requested'
  const canDoApproval = canApprove && isEdit && APPROVAL_FLOW[permit.status]
  const canSuspend = canApprove && isEdit && permit.status === 'active'
  const canResume = canApprove && isEdit && permit.status === 'suspended'
  const canClose = canApprove && isEdit && (permit.status === 'active' || permit.status === 'suspended')
  const canReject = canApprove && isEdit && ['requested', 'supervisor_approved', 'sheq_approved'].includes(permit.status)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '660px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${permit.permit_number}` : 'New Permit to Work'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isEdit && <StatusBadge status={eff} />}
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
              <Icon name="close" size={20} style={{ color: THEME.textMed }} />
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* ── Basic Info ── */}
          <SectionLabel>Basic Information</SectionLabel>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Permit title" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Permit Type" required>
              <select style={selectStyle} value={form.permit_type_id} onChange={e => set('permit_type_id', e.target.value)}>
                <option value="">Select type...</option>
                {permitTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Location">
              <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Processing Plant" />
            </Field>
          </div>
          <Field label="Description">
            <textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the work..." />
          </Field>
          <Field label="Work Description">
            <textarea style={textareaStyle} value={form.work_description} onChange={e => set('work_description', e.target.value)} placeholder="Detailed work description..." />
          </Field>

          {/* ── Schedule ── */}
          <SectionLabel>Schedule</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Start Date" required>
              <input style={inputStyle} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </Field>
            <Field label="End Date">
              <input style={inputStyle} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Start Time">
              <input style={inputStyle} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
            </Field>
            <Field label="End Time">
              <input style={inputStyle} type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
            </Field>
          </div>

          {/* ── Context ── */}
          <SectionLabel>Context</SectionLabel>
          <Field label="Project">
            <select style={selectStyle} value={form.project_id} onChange={e => set('project_id', e.target.value)}>
              <option value="">No project</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Hazards Identified">
            <textarea style={textareaStyle} value={form.hazards_identified} onChange={e => set('hazards_identified', e.target.value)} placeholder="List identified hazards..." />
          </Field>
          <Field label="PPE Required">
            <textarea style={textareaStyle} value={form.ppe_required} onChange={e => set('ppe_required', e.target.value)} placeholder="Required PPE..." />
          </Field>
          <Field label="Emergency Procedures">
            <textarea style={textareaStyle} value={form.emergency_procedures} onChange={e => set('emergency_procedures', e.target.value)} placeholder="Emergency procedures..." />
          </Field>

          {/* ── Approval Chain (edit only) ── */}
          {isEdit && (
            <>
              <SectionLabel>Approval Chain</SectionLabel>
              <ApprovalChain permit={permit} profiles={profiles} />
            </>
          )}

          {/* ── Suspension (when active) ── */}
          {canSuspend && (
            <>
              <SectionLabel>Suspend Permit</SectionLabel>
              <Field label="Suspension Reason">
                <textarea style={textareaStyle} value={form.suspension_reason} onChange={e => set('suspension_reason', e.target.value)} placeholder="Reason for suspending..." />
              </Field>
              <Button onClick={handleSuspend} icon="pause_circle" style={{ alignSelf: 'flex-start' }}>Suspend Permit</Button>
            </>
          )}

          {/* ── Closure (when active or suspended) ── */}
          {canClose && (
            <>
              <SectionLabel>Close Permit</SectionLabel>
              <Field label="Closure Notes">
                <textarea style={textareaStyle} value={form.closure_notes} onChange={e => set('closure_notes', e.target.value)} placeholder="Closure notes..." />
              </Field>
              <Button onClick={handleClose} icon="check_circle" style={{ alignSelf: 'flex-start' }}>Close Permit</Button>
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {canDoApproval && (
              <Button onClick={handleApprove} icon="check">
                {APPROVAL_FLOW[permit.status].label}
              </Button>
            )}
            {canResume && (
              <Button onClick={handleResume} icon="play_circle">Resume</Button>
            )}
            {canReject && !showReject && (
              <Button variant="ghost" onClick={() => setShowReject(true)} icon="cancel" style={{ color: '#D32F2F' }}>
                Reject
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {(permit?.status === 'requested' || !isEdit) && (
              <Button onClick={handleSave} disabled={saving} icon="save">
                {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Permit'}
              </Button>
            )}
          </div>
        </div>

        {/* Reject input */}
        {showReject && (
          <div style={{ marginTop: '12px', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Field label="Rejection Reason" required>
                <textarea style={{ ...textareaStyle, minHeight: '50px' }} value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Reason for rejection..." />
              </Field>
            </div>
            <Button onClick={handleReject} icon="cancel" style={{ background: '#D32F2F' }}>Reject</Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SheqPermits({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [permits, setPermits] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editPermit, setEditPermit] = useState(null)

  // Reference data
  const [permitTypes, setPermitTypes] = useState([])
  const [projects, setProjects] = useState([])
  const [profiles, setProfiles] = useState([])

  const canView    = can('sheq.view')
  const canCreate  = can('sheq.create')
  const canEdit    = can('sheq.edit')
  const canApprove = can('sheq.approve')

  async function fetchPermits() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_permits')
        .select('*, permit_type:sheq_permit_types!sheq_permits_permit_type_id_fkey(name)')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false })
      if (err) throw err
      setPermits(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRefData() {
    if (!currentSiteId) return
    const [types, projs, profs] = await Promise.all([
      supabase.from('sheq_permit_types').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
      supabase.from('projects').select('id, name').eq('site_id', currentSiteId).is('is_archived', false).order('name'),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    setPermitTypes(types.data || [])
    setProjects(projs.data || [])
    setProfiles(profs.data || [])
  }

  useEffect(() => { fetchPermits(); fetchRefData() }, [currentSiteId])

  // Derive effective statuses
  const permitsWithEff = useMemo(() =>
    permits.map(p => ({ ...p, _eff: effectiveStatus(p) })),
    [permits]
  )

  const filtered = useMemo(() => {
    let list = permitsWithEff
    if (statusFilter !== 'all') list = list.filter(p => p._eff === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.permit_number?.toLowerCase().includes(q) ||
        p.title?.toLowerCase().includes(q) ||
        p.location?.toLowerCase().includes(q)
      )
    }
    return list
  }, [permitsWithEff, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: permitsWithEff.length }
    STATUS_TABS.slice(1).forEach(s => { c[s] = 0 })
    permitsWithEff.forEach(p => {
      if (c[p._eff] !== undefined) c[p._eff]++
    })
    return c
  }, [permitsWithEff])

  // KPI cards
  const today = new Date().toISOString().slice(0, 10)
  const kpis = useMemo(() => ({
    active: permitsWithEff.filter(p => p._eff === 'active').length,
    pending: permitsWithEff.filter(p => ['requested', 'supervisor_approved', 'sheq_approved', 'area_approved'].includes(p._eff)).length,
    closedToday: permitsWithEff.filter(p => p._eff === 'closed' && p.closed_at?.slice(0, 10) === today).length,
    expired: permitsWithEff.filter(p => p._eff === 'expired').length,
  }), [permitsWithEff, today])

  function handleExport() {
    const headers = ['Permit #', 'Title', 'Type', 'Location', 'Start Date', 'End Date', 'Status', 'Requested By']
    const rows = filtered.map(p => [
      p.permit_number, p.title, p.permit_type?.name || '', p.location || '',
      p.start_date || '', p.end_date || '', fmtLabel(p._eff),
      profMap[p.requested_by] || '',
    ])
    exportCsv(`sheq-permits-${today}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(p) {
    if (!confirm(`Archive permit ${p.permit_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_permits')
      .update({ is_archived: true })
      .eq('id', p.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Permit archived')
    fetchPermits()
  }

  function onSaved() {
    setShowCreate(false)
    setEditPermit(null)
    fetchPermits()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_permits" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view permits.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_permits" />

      <PageHeader
        title="Permit to Work"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">New Permit</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Active Permits', value: kpis.active, color: '#2E7D32', icon: 'play_circle' },
          { label: 'Pending Approval', value: kpis.pending, color: '#1565C0', icon: 'schedule' },
          { label: 'Closed Today', value: kpis.closedToday, color: '#37474F', icon: 'check_circle' },
          { label: 'Expired', value: kpis.expired, color: '#D32F2F', icon: 'timer_off' },
        ].map(k => (
          <Card key={k.label} style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: k.color + '14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={k.icon} size={20} style={{ color: k.color }} />
            </div>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text }}>{k.value}</div>
              <div style={{ fontSize: '11px', color: THEME.textMed, fontWeight: 500 }}>{k.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {STATUS_TABS.map(tab => {
          const active = statusFilter === tab
          const meta = STATUS_COLORS[tab]
          return (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
                background: active ? (meta?.color || ACCENT) : THEME.surfaceVar,
                color: active ? '#fff' : THEME.textMed,
                transition: 'all .15s',
              }}
            >
              {tab === 'all' ? 'All' : fmtLabel(tab)} ({counts[tab] || 0})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px', maxWidth: '320px' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            style={{ ...inputStyle, paddingLeft: '32px' }}
            placeholder="Search permits..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      {error && (
        <Card style={{ padding: '20px', borderColor: THEME.error }}>
          <div style={{ color: THEME.error, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="error" size={18} style={{ color: THEME.error }} />
            {error}
          </div>
        </Card>
      )}

      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading permits...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="description" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {permits.length === 0 ? 'No permits created yet.' : 'No permits match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Permit #', 'Title', 'Type', 'Location', 'Dates', 'Status', 'Requested By', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr
                    key={p.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => (canEdit || canApprove) && setEditPermit(p)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{p.permit_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{p.permit_type?.name || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.location || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {fmtDate(p.start_date)}{p.end_date ? ` - ${fmtDate(p.end_date)}` : ''}
                    </td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={p._eff} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profMap[p.requested_by] || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(canEdit || canApprove) && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditPermit(p) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(p) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Archive"
                          >
                            <Icon name="archive" size={16} style={{ color: THEME.textLow }} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal */}
      {(showCreate || editPermit) && (
        <PermitModal
          permit={editPermit}
          permitTypes={permitTypes}
          projects={projects}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditPermit(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
