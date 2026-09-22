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

const RISK_COLORS = {
  low:      { bg: '#E8F5E9', color: '#2E7D32' },
  medium:   { bg: '#FFF8E1', color: '#F59E0B' },
  high:     { bg: '#FFF3E0', color: '#E65100' },
  critical: { bg: '#FFEBEE', color: '#D32F2F' },
}

const STATUS_META = {
  active:     { label: 'Active',     bg: '#E3F2FD', color: '#1565C0', icon: 'radio_button_checked' },
  controlled: { label: 'Controlled', bg: '#E8F5E9', color: '#2E7D32', icon: 'verified_user' },
  closed:     { label: 'Closed',     bg: '#F5F5F5', color: '#9E9E9E', icon: 'check_circle' },
}

const STATUS_TABS = ['all', 'active', 'controlled', 'closed']

const CATEGORIES = [
  'air_emissions', 'water_discharge', 'waste', 'noise', 'land_contamination',
  'resource_use', 'biodiversity', 'chemical_storage', 'energy', 'other',
]

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

function RiskBadge({ level }) {
  const s = RISK_COLORS[level] || { bg: THEME.surfaceVar, color: THEME.textMed }
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

function CategoryBadge({ category }) {
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 10px', borderRadius: '6px',
      fontSize: '11px', fontWeight: 600, background: '#EDE7F6', color: '#5E35B1',
    }}>
      {fmtType(category)}
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

function RiskScoreCell({ score }) {
  let color = THEME.textMed
  if (score >= 20) color = '#D32F2F'
  else if (score >= 12) color = '#E65100'
  else if (score >= 6) color = '#F59E0B'
  else if (score >= 1) color = '#2E7D32'
  return (
    <span style={{ fontWeight: 700, fontSize: '13px', color }}>{score ?? '--'}</span>
  )
}

// ── Status flow ───────────────────────────────────────────────────────────

const STATUS_FLOW = {
  active: 'controlled',
  controlled: 'closed',
}

// ── Create/Edit Modal ─────────────────────────────────────────────────────

function EnvironmentalModal({ aspect, profiles, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!aspect

  const [form, setForm] = useState(() => {
    if (aspect) return {
      title: aspect.title || '',
      activity: aspect.activity || '',
      aspect: aspect.aspect || '',
      impact: aspect.impact || '',
      description: aspect.description || '',
      category: aspect.category || '',
      legal_requirement: aspect.legal_requirement || '',
      control_measures: aspect.control_measures || '',
      project: aspect.project || '',
      department: aspect.department || '',
      responsible: aspect.responsible || '',
      likelihood: aspect.likelihood || 1,
      severity: aspect.severity || 1,
      residual_likelihood: aspect.residual_likelihood || 1,
      residual_severity: aspect.residual_severity || 1,
      status: aspect.status || 'active',
      review_date: aspect.review_date || '',
    }
    return {
      title: '', activity: '', aspect: '', impact: '', description: '',
      category: '', legal_requirement: '', control_measures: '',
      project: '', department: '', responsible: '',
      likelihood: 1, severity: 1, residual_likelihood: 1, residual_severity: 1,
      status: 'active', review_date: '',
    }
  })

  const [saving, setSaving] = useState(false)
  const [riskMatrix, setRiskMatrix] = useState([])

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  useEffect(() => {
    supabase.from('sheq_risk_matrix').select('likelihood,severity,risk_level')
      .eq('site_id', siteId)
      .then(({ data }) => setRiskMatrix(data || []))
  }, [siteId])

  function lookupLevel(l, s) {
    const score = l * s
    const entry = riskMatrix.find(r => r.likelihood === l && r.severity === s)
    if (entry) return entry.risk_level
    if (score >= 20) return 'critical'
    if (score >= 12) return 'high'
    if (score >= 6) return 'medium'
    return 'low'
  }

  const riskScore = form.likelihood * form.severity
  const riskLevel = lookupLevel(Number(form.likelihood), Number(form.severity))
  const residualScore = form.residual_likelihood * form.residual_severity
  const residualLevel = lookupLevel(Number(form.residual_likelihood), Number(form.residual_severity))

  async function handleSave() {
    if (!form.title || !form.activity || !form.category) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        activity: form.activity,
        aspect: form.aspect || null,
        impact: form.impact || null,
        description: form.description || null,
        category: form.category,
        legal_requirement: form.legal_requirement || null,
        control_measures: form.control_measures || null,
        project: form.project || null,
        department: form.department || null,
        responsible: form.responsible || null,
        likelihood: Number(form.likelihood),
        severity: Number(form.severity),
        risk_score: riskScore,
        risk_level: riskLevel,
        residual_likelihood: Number(form.residual_likelihood),
        residual_severity: Number(form.residual_severity),
        residual_risk: residualScore,
        residual_risk_level: residualLevel,
        status: form.status,
        review_date: form.review_date || null,
      }

      if (isEdit) {
        if (form.status === 'closed' && aspect.status !== 'closed') {
          payload.closed_by = userId
          payload.closed_at = new Date().toISOString()
        }
        const { error } = await supabase
          .from('sheq_environmental_aspects')
          .update(payload)
          .eq('id', aspect.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Environmental aspect updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'ENV', p_table: 'sheq_environmental_aspects',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.aspect_number = numData
        payload.created_by = userId
        payload.status = 'active'
        const { error } = await supabase.from('sheq_environmental_aspects').insert(payload)
        if (error) throw error
        showToast(`Aspect ${numData} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusAdvance() {
    const next = STATUS_FLOW[aspect.status]
    if (!next) return
    if (next === 'closed' && !canApprove) {
      showToast('You need approval permission to close aspects', 'error'); return
    }
    const updates = { status: next }
    if (next === 'closed') { updates.closed_by = userId; updates.closed_at = new Date().toISOString() }
    const { error } = await supabase
      .from('sheq_environmental_aspects')
      .update(updates)
      .eq('id', aspect.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Status advanced to ${STATUS_META[next]?.label || next}`)
    onSaved()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '620px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${aspect.aspect_number}` : 'New Environmental Aspect'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Basic */}
          <SectionLabel>Basic Information</SectionLabel>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. Dust Emissions from Crushing" />
          </Field>
          <Field label="Activity" required>
            <input style={inputStyle} value={form.activity} onChange={e => set('activity', e.target.value)} placeholder="e.g. Ore Crushing Operations" />
          </Field>
          <Field label="Aspect">
            <textarea style={textareaStyle} value={form.aspect} onChange={e => set('aspect', e.target.value)} placeholder="Environmental aspect..." />
          </Field>
          <Field label="Impact">
            <textarea style={textareaStyle} value={form.impact} onChange={e => set('impact', e.target.value)} placeholder="Environmental impact..." />
          </Field>
          <Field label="Description">
            <textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>

          {/* Context */}
          <SectionLabel>Context</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Category" required>
              <select style={selectStyle} value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="">Select category...</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{fmtType(c)}</option>)}
              </select>
            </Field>
            <Field label="Responsible">
              <select style={selectStyle} value={form.responsible} onChange={e => set('responsible', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.employee_number} — {p.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Legal Requirement">
            <textarea style={textareaStyle} value={form.legal_requirement} onChange={e => set('legal_requirement', e.target.value)} />
          </Field>
          <Field label="Control Measures">
            <textarea style={textareaStyle} value={form.control_measures} onChange={e => set('control_measures', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Project">
              <input style={inputStyle} value={form.project} onChange={e => set('project', e.target.value)} />
            </Field>
            <Field label="Department">
              <input style={inputStyle} value={form.department} onChange={e => set('department', e.target.value)} />
            </Field>
          </div>

          {/* Risk Assessment */}
          <SectionLabel>Risk Assessment</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Likelihood (1-5)">
              <select style={selectStyle} value={form.likelihood} onChange={e => set('likelihood', Number(e.target.value))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Severity (1-5)">
              <select style={selectStyle} value={form.severity} onChange={e => set('severity', Number(e.target.value))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Risk Score">
              <div style={{ ...inputStyle, background: THEME.surfaceVar, display: 'flex', alignItems: 'center' }}>
                <RiskScoreCell score={riskScore} />
              </div>
            </Field>
            <Field label="Risk Level">
              <div style={{ ...inputStyle, background: THEME.surfaceVar, display: 'flex', alignItems: 'center' }}>
                <RiskBadge level={riskLevel} />
              </div>
            </Field>
          </div>

          {/* Residual Risk */}
          <SectionLabel>Residual Risk</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Residual L (1-5)">
              <select style={selectStyle} value={form.residual_likelihood} onChange={e => set('residual_likelihood', Number(e.target.value))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Residual S (1-5)">
              <select style={selectStyle} value={form.residual_severity} onChange={e => set('residual_severity', Number(e.target.value))}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </Field>
            <Field label="Residual Score">
              <div style={{ ...inputStyle, background: THEME.surfaceVar, display: 'flex', alignItems: 'center' }}>
                <RiskScoreCell score={residualScore} />
              </div>
            </Field>
            <Field label="Residual Level">
              <div style={{ ...inputStyle, background: THEME.surfaceVar, display: 'flex', alignItems: 'center' }}>
                <RiskBadge level={residualLevel} />
              </div>
            </Field>
          </div>

          {/* Status & Review */}
          <SectionLabel>Status</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)} disabled={!isEdit}>
                {['active', 'controlled', 'closed'].map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
              </select>
            </Field>
            <Field label="Review Date">
              <input style={inputStyle} type="date" value={form.review_date} onChange={e => set('review_date', e.target.value)} />
            </Field>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            {isEdit && STATUS_FLOW[aspect.status] && (
              <Button onClick={handleStatusAdvance} icon="arrow_forward">
                Advance to {STATUS_META[STATUS_FLOW[aspect.status]]?.label}
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Aspect'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function SheqEnvironmental({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_environmental_aspects', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [aspects, setAspects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editAspect, setEditAspect] = useState(null)

  const [profiles, setProfiles] = useState([])

  const canView    = can('sheq.view')
  const canCreate  = can('sheq.create')
  const canEdit    = can('sheq.edit')
  const canApprove = can('sheq.approve')

  async function fetchAspects() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_environmental_aspects')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false })
      if (err) throw err
      setAspects(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRefData() {
    if (!currentSiteId) return
    const { data } = await supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name')
    setProfiles(data || [])
  }

  useEffect(() => { fetchAspects(); fetchRefData() }, [currentSiteId, rt])

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  const filtered = useMemo(() => {
    let list = aspects
    if (statusFilter !== 'all') list = list.filter(a => a.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        a.aspect_number?.toLowerCase().includes(q) ||
        a.title?.toLowerCase().includes(q) ||
        a.activity?.toLowerCase().includes(q)
      )
    }
    return list
  }, [aspects, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: aspects.length, active: 0, controlled: 0, closed: 0 }
    aspects.forEach(a => { if (c[a.status] !== undefined) c[a.status]++ })
    return c
  }, [aspects])

  // KPI calculations
  const kpis = useMemo(() => {
    const active = aspects.filter(a => a.status === 'active')
    const highRisk = active.filter(a => a.risk_level === 'high' || a.risk_level === 'critical')
    const controlled = aspects.filter(a => a.status === 'controlled')
    const now = new Date()
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const reviewDue = aspects.filter(a => a.status !== 'closed' && a.review_date && new Date(a.review_date) <= thirtyDays)
    return {
      totalActive: active.length,
      highRisk: highRisk.length,
      controlled: controlled.length,
      reviewDue: reviewDue.length,
    }
  }, [aspects])

  function handleExport() {
    const headers = ['Aspect #', 'Title', 'Activity', 'Category', 'Impact', 'Risk Score', 'Risk Level', 'Residual Risk', 'Status', 'Responsible']
    const rows = filtered.map(a => [
      a.aspect_number, a.title, a.activity || '', fmtType(a.category),
      a.impact || '', a.risk_score ?? '', a.risk_level || '',
      a.residual_risk ?? '', a.status, profileMap[a.responsible] || '',
    ])
    exportCsv(`sheq-environmental-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(item) {
    if (!confirm(`Archive aspect ${item.aspect_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_environmental_aspects')
      .update({ is_archived: true })
      .eq('id', item.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Aspect archived')
    fetchAspects()
  }

  function onSaved() {
    setShowCreate(false)
    setEditAspect(null)
    fetchAspects()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_environmental" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view environmental aspects.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_environmental" />

      <PageHeader
        title="Environmental Aspects & Impacts"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">New Aspect</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Active', value: kpis.totalActive, icon: 'eco', color: '#1565C0' },
          { label: 'High Risk', value: kpis.highRisk, icon: 'warning', color: '#E65100' },
          { label: 'Controlled', value: kpis.controlled, icon: 'verified_user', color: '#2E7D32' },
          { label: 'Review Due (30d)', value: kpis.reviewDue, icon: 'event', color: '#F59E0B' },
        ].map(k => (
          <Card key={k.label} style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: k.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={k.icon} size={20} style={{ color: k.color }} />
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{k.value}</div>
              <div style={{ fontSize: '11px', color: THEME.textMed, fontWeight: 500 }}>{k.label}</div>
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
            placeholder="Search aspects..."
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading environmental aspects...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="eco" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {aspects.length === 0 ? 'No environmental aspects registered yet.' : 'No aspects match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Aspect #', 'Title', 'Activity', 'Category', 'Impact', 'Risk', 'Level', 'Residual', 'Status', 'Responsible', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr
                    key={item.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditAspect(item)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{item.aspect_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.activity || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><CategoryBadge category={item.category} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.impact || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><RiskScoreCell score={item.risk_score} /></td>
                    <td style={{ padding: '10px 12px' }}><RiskBadge level={item.risk_level} /></td>
                    <td style={{ padding: '10px 12px' }}><RiskScoreCell score={item.residual_risk} /></td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={item.status} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[item.responsible] || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditAspect(item) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(item) }}
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
      {(showCreate || editAspect) && (
        <EnvironmentalModal
          aspect={editAspect}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditAspect(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
