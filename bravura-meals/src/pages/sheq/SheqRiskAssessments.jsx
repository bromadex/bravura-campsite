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

const ASSESSMENT_TYPES = ['jsa', 'jha', 'task', 'environmental', 'project', 'activity']

const TYPE_COLORS = {
  jsa:           { bg: '#E3F2FD', color: '#1565C0' },
  jha:           { bg: '#F3E5F5', color: '#7B1FA2' },
  task:          { bg: '#FFF8E1', color: '#F59E0B' },
  environmental: { bg: '#E8F5E9', color: '#2E7D32' },
  project:       { bg: '#FFF3E0', color: '#E65100' },
  activity:      { bg: '#F5F5F5', color: '#546E7A' },
}

const STATUS_META = {
  draft:      { label: 'Draft',      bg: '#F5F5F5', color: '#9E9E9E', icon: 'edit_note' },
  in_review:  { label: 'In Review',  bg: '#FFF8E1', color: '#F59E0B', icon: 'rate_review' },
  approved:   { label: 'Approved',   bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  expired:    { label: 'Expired',    bg: '#FFEBEE', color: '#D32F2F', icon: 'schedule' },
}

const STATUS_TABS = ['all', 'draft', 'in_review', 'approved', 'expired']

const STATUS_FLOW = {
  draft: 'in_review',
  in_review: 'approved',
}

function fmtType(t) {
  if (!t) return '--'
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const textareaStyle = { ...inputStyle, minHeight: '70px', resize: 'vertical' }

function TypeBadge({ type }) {
  const s = TYPE_COLORS[type] || { bg: THEME.surfaceVar, color: THEME.textMed }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.color, textTransform: 'uppercase',
    }}>
      {type || '--'}
    </span>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, bg: THEME.surfaceVar, color: THEME.textMed, icon: 'help' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: m.bg, color: m.color,
    }}>
      <Icon name={m.icon} size={11} style={{ color: 'inherit' }} />
      {m.label}
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

// ── Derive display status (approved + past review = expired) ───────────────

function displayStatus(assessment) {
  if (assessment.status === 'approved' && assessment.review_date) {
    const today = new Date().toISOString().slice(0, 10)
    if (assessment.review_date < today) return 'expired'
  }
  return assessment.status
}

// ── Blank item ─────────────────────────────────────────────────────────────

function blankItem(order) {
  return {
    step_order: order,
    activity: '', hazard: '', consequence: '', existing_controls: '',
    likelihood: '', severity: '', additional_controls: '',
    residual_likelihood: '', residual_severity: '', responsible: '',
  }
}

// ── Create/Edit Modal ──────────────────────────────────────────────────────

function AssessmentModal({ assessment, profiles, departments, projects, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!assessment

  const [form, setForm] = useState(() => {
    if (assessment) return {
      title: assessment.title || '',
      assessment_type: assessment.assessment_type || '',
      description: assessment.description || '',
      location: assessment.location || '',
      project_id: assessment.project_id || '',
      department_id: assessment.department_id || '',
      assessment_date: assessment.assessment_date || '',
      review_date: assessment.review_date || '',
    }
    return {
      title: '', assessment_type: '', description: '', location: '',
      project_id: '', department_id: '',
      assessment_date: new Date().toISOString().slice(0, 10),
      review_date: '',
    }
  })

  const [items, setItems] = useState([blankItem(1)])
  const [saving, setSaving] = useState(false)
  const [loadingItems, setLoadingItems] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  // Load existing items on edit
  useEffect(() => {
    if (!assessment) return
    setLoadingItems(true)
    supabase
      .from('sheq_risk_assessment_items')
      .select('*')
      .eq('assessment_id', assessment.id)
      .order('step_order', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data?.length) {
          setItems(data.map(d => ({
            step_order: d.step_order,
            activity: d.activity || '',
            hazard: d.hazard || '',
            consequence: d.consequence || '',
            existing_controls: d.existing_controls || '',
            likelihood: d.likelihood || '',
            severity: d.severity || '',
            additional_controls: d.additional_controls || '',
            residual_likelihood: d.residual_likelihood || '',
            residual_severity: d.residual_severity || '',
            responsible: d.responsible || '',
          })))
        }
        setLoadingItems(false)
      })
  }, [assessment])

  function setItem(idx, k, v) {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [k]: v } : item))
  }

  function addItem() {
    setItems(prev => [...prev, blankItem(prev.length + 1)])
  }

  function removeItem(idx) {
    if (items.length <= 1) return
    setItems(prev => prev.filter((_, i) => i !== idx).map((item, i) => ({ ...item, step_order: i + 1 })))
  }

  async function handleSave() {
    if (!form.title || !form.assessment_type) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        assessment_type: form.assessment_type,
        description: form.description || null,
        location: form.location || null,
        project_id: form.project_id || null,
        department_id: form.department_id || null,
        assessment_date: form.assessment_date || null,
        review_date: form.review_date || null,
      }

      let assessmentId

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_risk_assessments')
          .update(payload)
          .eq('id', assessment.id)
          .eq('site_id', siteId)
        if (error) throw error
        assessmentId = assessment.id

        // Delete existing items and re-insert
        const { error: delErr } = await supabase
          .from('sheq_risk_assessment_items')
          .delete()
          .eq('assessment_id', assessment.id)
        if (delErr) throw delErr
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'RA', p_table: 'sheq_risk_assessments',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.assessment_number = numData
        payload.assessed_by = userId
        payload.status = 'draft'
        const { data, error } = await supabase.from('sheq_risk_assessments').insert(payload).select('id').single()
        if (error) throw error
        assessmentId = data.id
        showToast(`Assessment ${numData} created`)
      }

      // Insert items
      const validItems = items.filter(it => it.activity || it.hazard)
      if (validItems.length > 0) {
        const itemPayloads = validItems.map((it, idx) => ({
          assessment_id: assessmentId,
          step_order: idx + 1,
          activity: it.activity || null,
          hazard: it.hazard || null,
          consequence: it.consequence || null,
          existing_controls: it.existing_controls || null,
          likelihood: it.likelihood ? Number(it.likelihood) : null,
          severity: it.severity ? Number(it.severity) : null,
          additional_controls: it.additional_controls || null,
          residual_likelihood: it.residual_likelihood ? Number(it.residual_likelihood) : null,
          residual_severity: it.residual_severity ? Number(it.residual_severity) : null,
          responsible: it.responsible || null,
        }))
        const { error: itemErr } = await supabase.from('sheq_risk_assessment_items').insert(itemPayloads)
        if (itemErr) throw itemErr
      }

      if (isEdit) showToast('Assessment updated')
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusAdvance() {
    const next = STATUS_FLOW[assessment.status]
    if (!next) return
    if (next === 'approved' && !canApprove) {
      showToast('You need approval permission to approve assessments', 'error'); return
    }
    const updates = { status: next }
    if (next === 'approved') {
      updates.approved_by = userId
      updates.approved_at = new Date().toISOString()
    }
    const { error } = await supabase
      .from('sheq_risk_assessments')
      .update(updates)
      .eq('id', assessment.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Status advanced to ${STATUS_META[next]?.label || next}`)
    onSaved()
  }

  const likelihoodOptions = [1, 2, 3, 4, 5]

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '820px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${assessment.assessment_number}` : 'New Risk Assessment'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Header Info */}
          <SectionLabel>Assessment Details</SectionLabel>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Assessment title" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Assessment Type" required>
              <select style={selectStyle} value={form.assessment_type} onChange={e => set('assessment_type', e.target.value)}>
                <option value="">Select type...</option>
                {ASSESSMENT_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </Field>
            <Field label="Location">
              <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Processing Plant" />
            </Field>
          </div>
          <Field label="Description">
            <textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Scope and purpose of this assessment..." />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Project">
              <select style={selectStyle} value={form.project_id} onChange={e => set('project_id', e.target.value)}>
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select style={selectStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Assessment Date">
              <input style={inputStyle} type="date" value={form.assessment_date} onChange={e => set('assessment_date', e.target.value)} />
            </Field>
            <Field label="Review Date">
              <input style={inputStyle} type="date" value={form.review_date} onChange={e => set('review_date', e.target.value)} />
            </Field>
          </div>

          {/* Steps / Items */}
          <SectionLabel>Assessment Steps</SectionLabel>
          {loadingItems ? (
            <div style={{ color: THEME.textMed, fontSize: '13px', padding: '12px 0' }}>Loading items...</div>
          ) : (
            <>
              {items.map((item, idx) => (
                <Card key={idx} style={{ padding: '14px', position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: ACCENT }}>Step {item.step_order}</div>
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(idx)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}
                        title="Remove step"
                      >
                        <Icon name="delete" size={16} style={{ color: THEME.textLow }} />
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <Field label="Activity">
                      <input style={inputStyle} value={item.activity} onChange={e => setItem(idx, 'activity', e.target.value)} placeholder="Task / activity" />
                    </Field>
                    <Field label="Hazard">
                      <input style={inputStyle} value={item.hazard} onChange={e => setItem(idx, 'hazard', e.target.value)} placeholder="Hazard identified" />
                    </Field>
                    <Field label="Consequence">
                      <input style={inputStyle} value={item.consequence} onChange={e => setItem(idx, 'consequence', e.target.value)} placeholder="Potential consequence" />
                    </Field>
                    <Field label="Existing Controls">
                      <input style={inputStyle} value={item.existing_controls} onChange={e => setItem(idx, 'existing_controls', e.target.value)} placeholder="Current controls" />
                    </Field>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '8px', marginTop: '8px' }}>
                    <Field label="Likelihood">
                      <select style={selectStyle} value={item.likelihood} onChange={e => setItem(idx, 'likelihood', e.target.value)}>
                        <option value="">-</option>
                        {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                    <Field label="Severity">
                      <select style={selectStyle} value={item.severity} onChange={e => setItem(idx, 'severity', e.target.value)}>
                        <option value="">-</option>
                        {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                    <Field label="Additional Controls">
                      <input style={inputStyle} value={item.additional_controls} onChange={e => setItem(idx, 'additional_controls', e.target.value)} />
                    </Field>
                    <Field label="Res. Likelihood">
                      <select style={selectStyle} value={item.residual_likelihood} onChange={e => setItem(idx, 'residual_likelihood', e.target.value)}>
                        <option value="">-</option>
                        {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                    <Field label="Res. Severity">
                      <select style={selectStyle} value={item.residual_severity} onChange={e => setItem(idx, 'residual_severity', e.target.value)}>
                        <option value="">-</option>
                        {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div style={{ marginTop: '8px' }}>
                    <Field label="Responsible Person">
                      <input style={inputStyle} value={item.responsible} onChange={e => setItem(idx, 'responsible', e.target.value)} placeholder="Name or role" />
                    </Field>
                  </div>
                </Card>
              ))}
              <Button variant="ghost" onClick={addItem} icon="add">Add Step</Button>
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            {isEdit && STATUS_FLOW[assessment.status] && (
              <Button onClick={handleStatusAdvance} icon="arrow_forward">
                {STATUS_FLOW[assessment.status] === 'approved' ? 'Approve' : `Advance to ${STATUS_META[STATUS_FLOW[assessment.status]]?.label}`}
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Assessment'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SheqRiskAssessments({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [assessments, setAssessments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editAssessment, setEditAssessment] = useState(null)

  // Reference data
  const [profiles, setProfiles] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])

  const canView    = can('sheq.view')
  const canCreate  = can('sheq.create')
  const canEdit    = can('sheq.edit')
  const canApprove = can('sheq.approve')

  async function fetchAssessments() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_risk_assessments')
        .select('*, assessor:profiles!sheq_risk_assessments_assessed_by_fkey(full_name)')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false })
      if (err) throw err
      setAssessments(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRefData() {
    if (!currentSiteId) return
    const [profs, depts, projs] = await Promise.all([
      supabase.from('profiles').select('id, full_name'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId),
      supabase.from('projects').select('id, name').eq('site_id', currentSiteId),
    ])
    setProfiles(profs.data || [])
    setDepartments(depts.data || [])
    setProjects(projs.data || [])
  }

  useEffect(() => { fetchAssessments(); fetchRefData() }, [currentSiteId])

  // Derive display statuses
  const withDisplayStatus = useMemo(() =>
    assessments.map(a => ({ ...a, _displayStatus: displayStatus(a) })),
    [assessments]
  )

  const filtered = useMemo(() => {
    let list = withDisplayStatus
    if (statusFilter !== 'all') list = list.filter(a => a._displayStatus === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.assessment_number?.toLowerCase().includes(q) ||
        a.title?.toLowerCase().includes(q)
      )
    }
    return list
  }, [withDisplayStatus, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: withDisplayStatus.length, draft: 0, in_review: 0, approved: 0, expired: 0 }
    withDisplayStatus.forEach(a => { if (c[a._displayStatus] !== undefined) c[a._displayStatus]++ })
    return c
  }, [withDisplayStatus])

  // KPI computations
  const kpis = useMemo(() => {
    const approved = withDisplayStatus.filter(a => a._displayStatus === 'approved').length
    const drafts = withDisplayStatus.filter(a => a._displayStatus === 'draft').length
    const today = new Date()
    const soon = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10)
    const todayStr = today.toISOString().slice(0, 10)
    const expiring = withDisplayStatus.filter(a =>
      a.status === 'approved' && a.review_date && a.review_date >= todayStr && a.review_date <= soon
    ).length
    return { total: withDisplayStatus.length, approved, expiring, drafts }
  }, [withDisplayStatus])

  function handleExport() {
    const headers = ['Assessment #', 'Title', 'Type', 'Assessed By', 'Assessment Date', 'Review Date', 'Status']
    const rows = filtered.map(a => [
      a.assessment_number, a.title, (a.assessment_type || '').toUpperCase(),
      a.assessor?.full_name || '', a.assessment_date || '', a.review_date || '',
      STATUS_META[a._displayStatus]?.label || a._displayStatus,
    ])
    exportCsv(`sheq-risk-assessments-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(assessment) {
    if (!confirm(`Archive assessment ${assessment.assessment_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_risk_assessments')
      .update({ is_archived: true })
      .eq('id', assessment.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Assessment archived')
    fetchAssessments()
  }

  function onSaved() {
    setShowCreate(false)
    setEditAssessment(null)
    fetchAssessments()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_risk_assessments" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view risk assessments.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_risk_assessments" />

      <PageHeader
        title="Risk Assessments"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">New Assessment</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Assessments', value: kpis.total, icon: 'assignment', color: '#1565C0' },
          { label: 'Approved', value: kpis.approved, icon: 'check_circle', color: '#2E7D32' },
          { label: 'Expiring Soon', value: kpis.expiring, icon: 'schedule', color: '#E65100' },
          { label: 'Draft', value: kpis.drafts, icon: 'edit_note', color: '#9E9E9E' },
        ].map(kpi => (
          <Card key={kpi.label} style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: kpi.color + '14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={kpi.icon} size={20} style={{ color: kpi.color }} />
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{kpi.value}</div>
              <div style={{ fontSize: '11px', color: THEME.textMed }}>{kpi.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {STATUS_TABS.map(tab => {
          const active = statusFilter === tab
          const meta = STATUS_META[tab]
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
              {tab === 'all' ? 'All' : meta?.label || tab} ({counts[tab] || 0})
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
            placeholder="Search assessments..."
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading assessments...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="assignment" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {assessments.length === 0 ? 'No risk assessments yet.' : 'No assessments match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Assessment #', 'Title', 'Type', 'Assessed By', 'Assessment Date', 'Review Date', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => (
                  <tr
                    key={a.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditAssessment(a)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{a.assessment_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</td>
                    <td style={{ padding: '10px 12px' }}><TypeBadge type={a.assessment_type} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{a.assessor?.full_name || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{a.assessment_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{a.review_date || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={a._displayStatus} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditAssessment(a) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(a) }}
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
      {(showCreate || editAssessment) && (
        <AssessmentModal
          assessment={editAssessment}
          profiles={profiles}
          departments={departments}
          projects={projects}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditAssessment(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
