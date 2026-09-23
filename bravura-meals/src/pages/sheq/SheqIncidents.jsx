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
import { pushNotificationToPermission } from '../../utils/notificationEngine'
import LinkedDocuments from '../../components/LinkedDocuments'
import DiscussButton from '../../components/DiscussButton'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const SEVERITY_COLORS = {
  low:      { bg: '#E8F5E9', color: '#2E7D32' },
  medium:   { bg: '#FFF8E1', color: '#F59E0B' },
  high:     { bg: '#FFF3E0', color: '#E65100' },
  critical: { bg: '#FFEBEE', color: '#D32F2F' },
}

const STATUS_META = {
  reported:              { label: 'Reported',           bg: '#F5F5F5', color: '#9E9E9E', icon: 'description' },
  under_investigation:   { label: 'Under Investigation', bg: '#E3F2FD', color: '#1565C0', icon: 'search' },
  root_cause_identified: { label: 'Root Cause',         bg: '#F3E5F5', color: '#7B1FA2', icon: 'psychology' },
  corrective_action:     { label: 'Corrective Action',  bg: '#FFF3E0', color: '#E65100', icon: 'build' },
  verification:          { label: 'Verification',       bg: '#FFF8E1', color: '#F59E0B', icon: 'verified' },
  closed:                { label: 'Closed',             bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
}

const STATUS_TABS = ['all', 'reported', 'under_investigation', 'root_cause_identified', 'corrective_action', 'verification', 'closed']

const INCIDENT_TYPES = [
  'fatality', 'lost_time_injury', 'medical_treatment', 'first_aid', 'near_miss',
  'property_damage', 'environmental', 'vehicle_traffic', 'equipment_failure',
  'fire', 'security', 'unsafe_act', 'unsafe_condition',
]

const ROOT_CAUSE_METHODS = ['five_why', 'fishbone', 'other']

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

function SeverityBadge({ severity }) {
  const s = SEVERITY_COLORS[severity] || { bg: THEME.surfaceVar, color: THEME.textMed }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {severity ? fmtType(severity) : '--'}
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

// ── Status flow helper ─────────────────────────────────────────────────────

const STATUS_FLOW = {
  reported: 'under_investigation',
  under_investigation: 'root_cause_identified',
  root_cause_identified: 'corrective_action',
  corrective_action: 'verification',
  verification: 'closed',
}

// ── Create/Edit Modal ──────────────────────────────────────────────────────

function IncidentModal({ incident, categories, profiles, siteId, userId, canApprove, onClose, onSaved, setPage }) {
  const { can: canPerm } = usePermissions()
  const isEdit = !!incident

  const [form, setForm] = useState(() => {
    if (incident) return {
      incident_date: incident.incident_date || '',
      incident_time: incident.incident_time || '',
      location: incident.location || '',
      incident_type: incident.incident_type || '',
      category_id: incident.category_id || '',
      severity: incident.severity || '',
      potential_severity: incident.potential_severity || '',
      description: incident.description || '',
      immediate_actions: incident.immediate_actions || '',
      people_involved: incident.people_involved || '',
      witnesses: incident.witnesses || '',
      investigation_team: incident.investigation_team || '',
      root_cause_method: incident.root_cause_method || '',
      five_why_1: incident.five_why_1 || '',
      five_why_2: incident.five_why_2 || '',
      five_why_3: incident.five_why_3 || '',
      five_why_4: incident.five_why_4 || '',
      five_why_5: incident.five_why_5 || '',
      fishbone_people: incident.fishbone_people || '',
      fishbone_process: incident.fishbone_process || '',
      fishbone_equipment: incident.fishbone_equipment || '',
      fishbone_materials: incident.fishbone_materials || '',
      fishbone_environment: incident.fishbone_environment || '',
      fishbone_management: incident.fishbone_management || '',
      root_cause: incident.root_cause || '',
      status: incident.status || 'reported',
      fleet_asset_id: incident.fleet_asset_id || '',
      estimated_cost: incident.estimated_cost ?? '',
      actual_cost: incident.actual_cost ?? '',
      cost_category: incident.cost_category || '',
      insurance_claim: incident.insurance_claim || false,
      days_lost: incident.days_lost ?? '',
    }
    return {
      incident_date: new Date().toISOString().slice(0, 10),
      incident_time: new Date().toTimeString().slice(0, 5),
      location: '', incident_type: '', category_id: '', severity: 'low',
      potential_severity: '', description: '', immediate_actions: '',
      people_involved: '', witnesses: '', investigation_team: '',
      root_cause_method: '', five_why_1: '', five_why_2: '', five_why_3: '',
      five_why_4: '', five_why_5: '', fishbone_people: '', fishbone_process: '',
      fishbone_equipment: '', fishbone_materials: '', fishbone_environment: '',
      fishbone_management: '', root_cause: '', status: 'reported',
      fleet_asset_id: '', estimated_cost: '', actual_cost: '',
      cost_category: '', insurance_claim: false, days_lost: '',
    }
  })

  const [saving, setSaving] = useState(false)
  const [fleetAssets, setFleetAssets] = useState([])

  useEffect(() => {
    supabase.from('fleet_assets').select('id, asset_number, description').eq('site_id', siteId).order('asset_number').then(({ data }) => {
      if (data) setFleetAssets(data)
    })
  }, [siteId])

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  const showInvestigation = isEdit && form.status !== 'reported'

  async function handleSave() {
    if (!form.incident_date || !form.incident_type || !form.severity || !form.description) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        incident_date: form.incident_date,
        incident_time: form.incident_time || null,
        location: form.location || null,
        incident_type: form.incident_type,
        category_id: form.category_id || null,
        severity: form.severity,
        potential_severity: form.potential_severity || null,
        description: form.description,
        immediate_actions: form.immediate_actions || null,
        people_involved: form.people_involved || null,
        witnesses: form.witnesses || null,
        investigation_team: form.investigation_team || null,
        root_cause_method: form.root_cause_method || null,
        five_why_1: form.five_why_1 || null,
        five_why_2: form.five_why_2 || null,
        five_why_3: form.five_why_3 || null,
        five_why_4: form.five_why_4 || null,
        five_why_5: form.five_why_5 || null,
        fishbone_people: form.fishbone_people || null,
        fishbone_process: form.fishbone_process || null,
        fishbone_equipment: form.fishbone_equipment || null,
        fishbone_materials: form.fishbone_materials || null,
        fishbone_environment: form.fishbone_environment || null,
        fishbone_management: form.fishbone_management || null,
        root_cause: form.root_cause || null,
        status: form.status,
        fleet_asset_id: form.fleet_asset_id || null,
        estimated_cost: form.estimated_cost !== '' ? Number(form.estimated_cost) : null,
        actual_cost: form.actual_cost !== '' ? Number(form.actual_cost) : null,
        cost_category: form.cost_category || null,
        insurance_claim: form.insurance_claim || false,
        days_lost: form.days_lost !== '' ? Number(form.days_lost) : null,
      }

      if (isEdit) {
        if (form.status === 'closed' && incident.status !== 'closed') {
          payload.closed_by = userId
          payload.closed_at = new Date().toISOString()
        }
        if (form.status === 'under_investigation' && incident.status === 'reported') {
          payload.investigated_by = userId
        }
        const { error } = await supabase
          .from('sheq_incidents')
          .update(payload)
          .eq('id', incident.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Incident updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'INC', p_table: 'sheq_incidents',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.incident_number = numData
        payload.reported_by = userId
        payload.status = 'reported'
        const { error } = await supabase.from('sheq_incidents').insert(payload)
        if (error) throw error
        showToast(`Incident ${numData} created`)
        pushNotificationToPermission('sheq.approve', siteId, {
          type: 'incident_reported', title: 'New SHEQ Incident',
          message: `Incident ${numData} (${form.incident_type}, ${form.severity} severity) reported.`,
          link: '/sheq/sheq_incidents', category: 'general',
        })
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusAdvance() {
    const next = STATUS_FLOW[incident.status]
    if (!next) return
    if (next === 'closed' && !canApprove) {
      showToast('You need approval permission to close incidents', 'error'); return
    }
    const updates = { status: next }
    if (next === 'under_investigation') updates.investigated_by = userId
    if (next === 'closed') { updates.closed_by = userId; updates.closed_at = new Date().toISOString() }
    const { error } = await supabase
      .from('sheq_incidents')
      .update(updates)
      .eq('id', incident.id)
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
            {isEdit ? `Edit ${incident.incident_number}` : 'New Incident'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* ── Basic Info ── */}
          <SectionLabel>Basic Information</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Incident Date" required>
              <input style={inputStyle} type="date" value={form.incident_date} onChange={e => set('incident_date', e.target.value)} />
            </Field>
            <Field label="Incident Time">
              <input style={inputStyle} type="time" value={form.incident_time} onChange={e => set('incident_time', e.target.value)} />
            </Field>
          </div>
          <Field label="Location">
            <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Processing Plant, Block A" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Incident Type" required>
              <select style={selectStyle} value={form.incident_type} onChange={e => set('incident_type', e.target.value)}>
                <option value="">Select type...</option>
                {INCIDENT_TYPES.map(t => (
                  <option key={t} value={t}>{fmtType(t)}</option>
                ))}
              </select>
            </Field>
            <Field label="Category">
              <select style={selectStyle} value={form.category_id} onChange={e => set('category_id', e.target.value)}>
                <option value="">Select category...</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Severity" required>
              <select style={selectStyle} value={form.severity} onChange={e => set('severity', e.target.value)}>
                <option value="">Select...</option>
                {['low', 'medium', 'high', 'critical'].map(s => (
                  <option key={s} value={s}>{fmtType(s)}</option>
                ))}
              </select>
            </Field>
            <Field label="Potential Severity">
              <select style={selectStyle} value={form.potential_severity} onChange={e => set('potential_severity', e.target.value)}>
                <option value="">Select...</option>
                {['low', 'medium', 'high', 'critical'].map(s => (
                  <option key={s} value={s}>{fmtType(s)}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* ── Fleet & Cost ── */}
          <SectionLabel>Fleet & Cost Impact</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Fleet Asset">
              <select style={selectStyle} value={form.fleet_asset_id} onChange={e => set('fleet_asset_id', e.target.value)}>
                <option value="">None</option>
                {fleetAssets.map(a => (
                  <option key={a.id} value={a.id}>{a.asset_number} — {a.description}</option>
                ))}
              </select>
            </Field>
            <Field label="Cost Category">
              <select style={selectStyle} value={form.cost_category} onChange={e => set('cost_category', e.target.value)}>
                <option value="">Select...</option>
                {['property_damage', 'vehicle_damage', 'medical', 'environmental', 'production_loss', 'legal', 'other'].map(c => (
                  <option key={c} value={c}>{fmtType(c)}</option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Estimated Cost ($)">
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.estimated_cost} onChange={e => set('estimated_cost', e.target.value)} />
            </Field>
            <Field label="Actual Cost ($)">
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.actual_cost} onChange={e => set('actual_cost', e.target.value)} />
            </Field>
            <Field label="Days Lost">
              <input style={inputStyle} type="number" min="0" value={form.days_lost} onChange={e => set('days_lost', e.target.value)} />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: THEME.textMed, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.insurance_claim} onChange={e => set('insurance_claim', e.target.checked)} />
            Insurance claim filed
          </label>

          {/* ── Description ── */}
          <SectionLabel>Description</SectionLabel>
          <Field label="Description" required>
            <textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the incident..." />
          </Field>
          <Field label="Immediate Actions Taken">
            <textarea style={textareaStyle} value={form.immediate_actions} onChange={e => set('immediate_actions', e.target.value)} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="People Involved">
              <input style={inputStyle} value={form.people_involved} onChange={e => set('people_involved', e.target.value)} />
            </Field>
            <Field label="Witnesses">
              <input style={inputStyle} value={form.witnesses} onChange={e => set('witnesses', e.target.value)} />
            </Field>
          </div>

          {/* ── Investigation (edit + past reported) ── */}
          {showInvestigation && (
            <>
              <SectionLabel>Investigation</SectionLabel>
              <Field label="Investigation Team">
                <input style={inputStyle} value={form.investigation_team} onChange={e => set('investigation_team', e.target.value)} />
              </Field>
              <Field label="Root Cause Method">
                <select style={selectStyle} value={form.root_cause_method} onChange={e => set('root_cause_method', e.target.value)}>
                  <option value="">Select method...</option>
                  {ROOT_CAUSE_METHODS.map(m => (
                    <option key={m} value={m}>{fmtType(m)}</option>
                  ))}
                </select>
              </Field>

              {form.root_cause_method === 'five_why' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <Field key={n} label={`Why ${n}?`}>
                      <textarea style={{ ...textareaStyle, minHeight: '50px' }} value={form[`five_why_${n}`]} onChange={e => set(`five_why_${n}`, e.target.value)} />
                    </Field>
                  ))}
                </div>
              )}

              {form.root_cause_method === 'fishbone' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  {['people', 'process', 'equipment', 'materials', 'environment', 'management'].map(f => (
                    <Field key={f} label={fmtType(f)}>
                      <textarea style={{ ...textareaStyle, minHeight: '50px' }} value={form[`fishbone_${f}`]} onChange={e => set(`fishbone_${f}`, e.target.value)} />
                    </Field>
                  ))}
                </div>
              )}

              <Field label="Root Cause">
                <textarea style={textareaStyle} value={form.root_cause} onChange={e => set('root_cause', e.target.value)} />
              </Field>
            </>
          )}
        </div>

        {/* Linked documents */}
        {isEdit && <LinkedDocuments linkedTable="sheq_incidents" linkedId={incident.id} canAttach={canPerm('ds.create')} />}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            {isEdit && STATUS_FLOW[incident.status] && (
              <Button onClick={handleStatusAdvance} icon="arrow_forward">
                Advance to {STATUS_META[STATUS_FLOW[incident.status]]?.label}
              </Button>
            )}
            {isEdit && <DiscussButton linkedTable="sheq_incidents" linkedId={incident.id} label={`Incident: ${incident.incident_number || ''}`} setPage={setPage} />}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Incident'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SheqIncidents({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_incidents', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [incidents, setIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editIncident, setEditIncident] = useState(null)

  // Reference data
  const [categories, setCategories] = useState([])
  const [profiles, setProfiles] = useState([])

  const canView    = can('sheq.view')
  const canCreate  = can('sheq.create')
  const canEdit    = can('sheq.edit')
  const canApprove = can('sheq.approve')

  async function fetchIncidents() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_incidents')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('incident_date', { ascending: false })
      if (err) throw err
      setIncidents(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRefData() {
    if (!currentSiteId) return
    const [cats, profs] = await Promise.all([
      supabase.from('sheq_incident_categories').select('id, name').eq('site_id', currentSiteId).eq('is_active', true),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    setCategories(cats.data || [])
    setProfiles(profs.data || [])
  }

  useEffect(() => { fetchIncidents(); fetchRefData() }, [currentSiteId, rt])

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  const filtered = useMemo(() => {
    let list = incidents
    if (statusFilter !== 'all') list = list.filter(i => i.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.incident_number?.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) ||
        i.location?.toLowerCase().includes(q)
      )
    }
    return list
  }, [incidents, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: incidents.length }
    STATUS_TABS.slice(1).forEach(s => { c[s] = 0 })
    incidents.forEach(i => { if (c[i.status] !== undefined) c[i.status]++ })
    return c
  }, [incidents])

  function handleExport() {
    const headers = ['Incident #', 'Date', 'Type', 'Severity', 'Location', 'Status', 'Reported By', 'Description']
    const rows = filtered.map(i => [
      i.incident_number, i.incident_date, fmtType(i.incident_type),
      i.severity, i.location || '', STATUS_META[i.status]?.label || i.status,
      profileMap[i.reported_by] || '', i.description || '',
    ])
    exportCsv(`sheq-incidents-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(inc) {
    if (!confirm(`Archive incident ${inc.incident_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_incidents')
      .update({ is_archived: true })
      .eq('id', inc.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Incident archived')
    fetchIncidents()
  }

  function onSaved() {
    setShowCreate(false)
    setEditIncident(null)
    fetchIncidents()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_incidents" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view incidents.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_incidents" />

      <PageHeader
        title="Incident Management"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">Report Incident</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

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
            placeholder="Search incidents..."
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading incidents...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="warning" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {incidents.length === 0 ? 'No incidents reported yet.' : 'No incidents match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Incident #', 'Date', 'Type', 'Severity', 'Location', 'Status', 'Reported By', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inc => (
                  <tr
                    key={inc.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditIncident(inc)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{inc.incident_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{inc.incident_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{fmtType(inc.incident_type)}</td>
                    <td style={{ padding: '10px 12px' }}><SeverityBadge severity={inc.severity} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.location || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={inc.status} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[inc.reported_by] || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditIncident(inc) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(inc) }}
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
      {(showCreate || editIncident) && (
        <IncidentModal
          incident={editIncident}
          categories={categories}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditIncident(null) }}
          onSaved={onSaved}
          setPage={setPage}
        />
      )}
    </div>
  )
}
