import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const RISK_LEVEL_COLORS = {
  low:      { bg: '#E8F5E9', color: '#2E7D32' },
  medium:   { bg: '#FFF8E1', color: '#F59E0B' },
  high:     { bg: '#FFF3E0', color: '#E65100' },
  critical: { bg: '#FFEBEE', color: '#D32F2F' },
}

const STATUS_META = {
  active:    { label: 'Active',    bg: '#E3F2FD', color: '#1565C0', icon: 'radio_button_checked' },
  mitigated: { label: 'Mitigated', bg: '#FFF8E1', color: '#F59E0B', icon: 'verified_user' },
  closed:    { label: 'Closed',    bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
}

const STATUS_TABS = ['all', 'active', 'mitigated', 'closed']

const STATUS_FLOW = {
  active: 'mitigated',
  mitigated: 'closed',
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

function RiskLevelBadge({ level }) {
  const s = RISK_LEVEL_COLORS[level] || { bg: THEME.surfaceVar, color: THEME.textMed }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {level ? fmtType(level) : '--'}
    </span>
  )
}

function RiskScoreBadge({ likelihood, severity }) {
  if (!likelihood || !severity) return <span style={{ color: THEME.textLow }}>--</span>
  const score = likelihood * severity
  let level = 'low'
  if (score >= 20) level = 'critical'
  else if (score >= 12) level = 'high'
  else if (score >= 6) level = 'medium'
  const s = RISK_LEVEL_COLORS[level]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {likelihood}x{severity}={score}
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

// ── Derive risk level from matrix ──────────────────────────────────────────

function deriveLevel(likelihood, severity, matrix) {
  if (!likelihood || !severity || !matrix.length) {
    const score = (likelihood || 0) * (severity || 0)
    if (score >= 20) return 'critical'
    if (score >= 12) return 'high'
    if (score >= 6) return 'medium'
    return 'low'
  }
  const match = matrix.find(m => m.likelihood === likelihood && m.severity === severity)
  return match?.risk_level || 'low'
}

// ── Create/Edit Modal ──────────────────────────────────────────────────────

function RiskModal({ risk, profiles, departments, projects, matrix, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!risk

  const [form, setForm] = useState(() => {
    if (risk) return {
      title: risk.title || '',
      hazard: risk.hazard || '',
      consequence: risk.consequence || '',
      description: risk.description || '',
      project_id: risk.project_id || '',
      department_id: risk.department_id || '',
      owner_id: risk.owner_id || '',
      review_date: risk.review_date || '',
      existing_controls: risk.existing_controls || '',
      likelihood: risk.likelihood || '',
      severity: risk.severity || '',
      additional_controls: risk.additional_controls || '',
      residual_likelihood: risk.residual_likelihood || '',
      residual_severity: risk.residual_severity || '',
      status: risk.status || 'active',
    }
    return {
      title: '', hazard: '', consequence: '', description: '',
      project_id: '', department_id: '', owner_id: '', review_date: '',
      existing_controls: '', likelihood: '', severity: '',
      additional_controls: '', residual_likelihood: '', residual_severity: '',
      status: 'active',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  const inherentLevel = useMemo(() =>
    deriveLevel(Number(form.likelihood), Number(form.severity), matrix),
    [form.likelihood, form.severity, matrix]
  )

  const residualLevel = useMemo(() =>
    deriveLevel(Number(form.residual_likelihood), Number(form.residual_severity), matrix),
    [form.residual_likelihood, form.residual_severity, matrix]
  )

  async function handleSave() {
    if (!form.title || !form.hazard) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        hazard: form.hazard,
        consequence: form.consequence || null,
        description: form.description || null,
        project_id: form.project_id || null,
        department_id: form.department_id || null,
        owner_id: form.owner_id || null,
        review_date: form.review_date || null,
        existing_controls: form.existing_controls || null,
        likelihood: form.likelihood ? Number(form.likelihood) : null,
        severity: form.severity ? Number(form.severity) : null,
        risk_level: inherentLevel,
        additional_controls: form.additional_controls || null,
        residual_likelihood: form.residual_likelihood ? Number(form.residual_likelihood) : null,
        residual_severity: form.residual_severity ? Number(form.residual_severity) : null,
        residual_risk_level: residualLevel,
        status: form.status,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_risk_register')
          .update(payload)
          .eq('id', risk.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Risk updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'RSK', p_table: 'sheq_risk_register',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.risk_number = numData
        payload.created_by = userId
        const { error } = await supabase.from('sheq_risk_register').insert(payload)
        if (error) throw error
        showToast(`Risk ${numData} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusAdvance() {
    const next = STATUS_FLOW[risk.status]
    if (!next) return
    if (next === 'closed' && !canApprove) {
      showToast('You need approval permission to close risks', 'error'); return
    }
    const { error } = await supabase
      .from('sheq_risk_register')
      .update({ status: next })
      .eq('id', risk.id)
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
          width: '660px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${risk.risk_number}` : 'New Risk'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Basic */}
          <SectionLabel>Basic Information</SectionLabel>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Risk title" />
          </Field>
          <Field label="Hazard" required>
            <textarea style={textareaStyle} value={form.hazard} onChange={e => set('hazard', e.target.value)} placeholder="Describe the hazard..." />
          </Field>
          <Field label="Consequence">
            <textarea style={textareaStyle} value={form.consequence} onChange={e => set('consequence', e.target.value)} placeholder="Potential consequence..." />
          </Field>
          <Field label="Description">
            <textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Additional details..." />
          </Field>

          {/* Context */}
          <SectionLabel>Context</SectionLabel>
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
            <Field label="Owner">
              <select style={selectStyle} value={form.owner_id} onChange={e => set('owner_id', e.target.value)}>
                <option value="">Unassigned</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.employee_number} — {p.name}</option>)}
              </select>
            </Field>
            <Field label="Review Date">
              <input style={inputStyle} type="date" value={form.review_date} onChange={e => set('review_date', e.target.value)} />
            </Field>
          </div>

          {/* Inherent Risk */}
          <SectionLabel>Inherent Risk Assessment</SectionLabel>
          <Field label="Existing Controls">
            <textarea style={textareaStyle} value={form.existing_controls} onChange={e => set('existing_controls', e.target.value)} placeholder="Controls already in place..." />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', alignItems: 'end' }}>
            <Field label="Likelihood (1-5)">
              <select style={selectStyle} value={form.likelihood} onChange={e => set('likelihood', e.target.value)}>
                <option value="">Select...</option>
                {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Severity (1-5)">
              <select style={selectStyle} value={form.severity} onChange={e => set('severity', e.target.value)}>
                <option value="">Select...</option>
                {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Inherent Risk
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '38px' }}>
                <RiskScoreBadge likelihood={Number(form.likelihood)} severity={Number(form.severity)} />
                <RiskLevelBadge level={inherentLevel} />
              </div>
            </div>
          </div>

          {/* Residual Risk */}
          <SectionLabel>Residual Risk Assessment</SectionLabel>
          <Field label="Additional Controls">
            <textarea style={textareaStyle} value={form.additional_controls} onChange={e => set('additional_controls', e.target.value)} placeholder="Additional controls to reduce risk..." />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', alignItems: 'end' }}>
            <Field label="Residual Likelihood (1-5)">
              <select style={selectStyle} value={form.residual_likelihood} onChange={e => set('residual_likelihood', e.target.value)}>
                <option value="">Select...</option>
                {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Residual Severity (1-5)">
              <select style={selectStyle} value={form.residual_severity} onChange={e => set('residual_severity', e.target.value)}>
                <option value="">Select...</option>
                {likelihoodOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                Residual Risk
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '38px' }}>
                <RiskScoreBadge likelihood={Number(form.residual_likelihood)} severity={Number(form.residual_severity)} />
                <RiskLevelBadge level={residualLevel} />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            {isEdit && STATUS_FLOW[risk.status] && (
              <Button onClick={handleStatusAdvance} icon="arrow_forward">
                Advance to {STATUS_META[STATUS_FLOW[risk.status]]?.label}
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Risk'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SheqRiskRegister({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_risk_register', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [risks, setRisks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editRisk, setEditRisk] = useState(null)

  // Reference data
  const [profiles, setProfiles] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [matrix, setMatrix] = useState([])

  const canView    = can('sheq.view')
  const canCreate  = can('sheq.create')
  const canEdit    = can('sheq.edit')
  const canApprove = can('sheq.approve')

  async function fetchRisks() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_risk_register')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false })
      if (err) throw err
      setRisks(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRefData() {
    if (!currentSiteId) return
    const [profs, depts, projs, mat] = await Promise.all([
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId),
      supabase.from('projects').select('id, name').eq('site_id', currentSiteId),
      supabase.from('sheq_risk_matrix').select('likelihood, severity, risk_level').eq('site_id', currentSiteId),
    ])
    setProfiles(profs.data || [])
    setDepartments(depts.data || [])
    setProjects(projs.data || [])
    setMatrix(mat.data || [])
  }

  useEffect(() => { fetchRisks(); fetchRefData() }, [currentSiteId, rt])

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  const filtered = useMemo(() => {
    let list = risks
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.risk_number?.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q) ||
        r.hazard?.toLowerCase().includes(q)
      )
    }
    return list
  }, [risks, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: risks.length, active: 0, mitigated: 0, closed: 0 }
    risks.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [risks])

  // KPI computations
  const kpis = useMemo(() => {
    const active = risks.filter(r => r.status === 'active')
    const critical = active.filter(r => r.risk_level === 'critical').length
    const high = active.filter(r => r.risk_level === 'high').length
    const scores = active.map(r => (r.likelihood || 0) * (r.severity || 0)).filter(s => s > 0)
    const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '--'
    return { activeCount: active.length, critical, high, avg }
  }, [risks])

  function handleExport() {
    const headers = ['Risk #', 'Title', 'Hazard', 'L', 'S', 'Inherent Score', 'Risk Level', 'Residual L', 'Residual S', 'Residual Level', 'Owner', 'Status', 'Review Date']
    const rows = filtered.map(r => [
      r.risk_number, r.title, r.hazard || '',
      r.likelihood || '', r.severity || '', (r.likelihood || 0) * (r.severity || 0) || '',
      r.risk_level || '', r.residual_likelihood || '', r.residual_severity || '',
      r.residual_risk_level || '', profileMap[r.owner_id] || '', r.status, r.review_date || '',
    ])
    exportCsv(`sheq-risks-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(risk) {
    if (!confirm(`Archive risk ${risk.risk_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_risk_register')
      .update({ is_archived: true })
      .eq('id', risk.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Risk archived')
    fetchRisks()
  }

  function onSaved() {
    setShowCreate(false)
    setEditRisk(null)
    fetchRisks()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_risk_register" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view the risk register.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_risk_register" />

      <PageHeader
        title="Risk Register"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">New Risk</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Active Risks', value: kpis.activeCount, icon: 'shield', color: '#1565C0' },
          { label: 'Critical', value: kpis.critical, icon: 'error', color: '#D32F2F' },
          { label: 'High', value: kpis.high, icon: 'warning', color: '#E65100' },
          { label: 'Avg Risk Score', value: kpis.avg, icon: 'analytics', color: '#7B1FA2' },
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
            placeholder="Search risks..."
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading risks...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="shield" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {risks.length === 0 ? 'No risks registered yet.' : 'No risks match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Risk #', 'Title', 'Hazard', 'Inherent Risk', 'Risk Level', 'Residual Risk', 'Residual Level', 'Owner', 'Status', 'Review Date', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditRisk(r)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.risk_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.hazard || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><RiskScoreBadge likelihood={r.likelihood} severity={r.severity} /></td>
                    <td style={{ padding: '10px 12px' }}><RiskLevelBadge level={r.risk_level} /></td>
                    <td style={{ padding: '10px 12px' }}><RiskScoreBadge likelihood={r.residual_likelihood} severity={r.residual_severity} /></td>
                    <td style={{ padding: '10px 12px' }}><RiskLevelBadge level={r.residual_risk_level} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.owner_id] || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={r.status} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.review_date || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditRisk(r) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(r) }}
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
      {(showCreate || editRisk) && (
        <RiskModal
          risk={editRisk}
          profiles={profiles}
          departments={departments}
          projects={projects}
          matrix={matrix}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditRisk(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
