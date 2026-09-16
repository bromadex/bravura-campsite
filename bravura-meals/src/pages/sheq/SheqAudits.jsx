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

const AUDIT_TYPES = {
  internal: 'Internal', external: 'External', iso: 'ISO', regulatory: 'Regulatory',
  supplier: 'Supplier', management_review: 'Management Review', other: 'Other',
}

const STATUS_META = {
  planned:     { label: 'Planned',     bg: '#E3F2FD', color: '#1565C0', icon: 'schedule' },
  in_progress: { label: 'In Progress', bg: '#FFF8E1', color: '#F59E0B', icon: 'pending' },
  completed:   { label: 'Completed',   bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  closed:      { label: 'Closed',      bg: '#F3E5F5', color: '#7B1FA2', icon: 'verified' },
}

const STATUS_FLOW = { planned: 'in_progress', in_progress: 'completed', completed: 'closed' }

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const textareaStyle = { ...inputStyle, minHeight: '70px', resize: 'vertical' }

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

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, bg: THEME.surfaceVar, color: THEME.textMed, icon: 'help' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: m.bg, color: m.color }}>
      <Icon name={m.icon} size={11} style={{ color: 'inherit' }} /> {m.label}
    </span>
  )
}

function AuditModal({ audit, profiles, departments, projects, siteId, onClose, onSaved }) {
  const isEdit = !!audit
  const [form, setForm] = useState(() => {
    if (audit) return {
      title: audit.title || '', audit_type: audit.audit_type || '',
      standard: audit.standard || '', scope: audit.scope || '',
      audit_date: audit.audit_date || '', end_date: audit.end_date || '',
      lead_auditor_id: audit.lead_auditor_id || '', department_id: audit.department_id || '',
      project_id: audit.project_id || '', summary: audit.summary || '',
      status: audit.status || 'planned',
    }
    return { title: '', audit_type: '', standard: '', scope: '', audit_date: new Date().toISOString().slice(0, 10), end_date: '', lead_auditor_id: '', department_id: '', project_id: '', summary: '', status: 'planned' }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.title || !form.audit_type) { showToast('Title and type are required', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        title: form.title, audit_type: form.audit_type,
        standard: form.standard || null, scope: form.scope || null,
        audit_date: form.audit_date, end_date: form.end_date || null,
        lead_auditor_id: form.lead_auditor_id || null,
        department_id: form.department_id || null, project_id: form.project_id || null,
        summary: form.summary || null, status: form.status,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_audits').update(payload).eq('id', audit.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Audit updated')
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'AUD', p_table: 'sheq_audits' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.audit_number = num
        const { error } = await supabase.from('sheq_audits').insert(payload)
        if (error) throw error
        showToast(`Audit ${num} created`)
      }
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '620px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${audit.audit_number}` : 'New Audit'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Title" required><input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Audit title" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Audit Type" required>
              <select style={selectStyle} value={form.audit_type} onChange={e => set('audit_type', e.target.value)}>
                <option value="">Select...</option>
                {Object.entries(AUDIT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Standard"><input style={inputStyle} value={form.standard} onChange={e => set('standard', e.target.value)} placeholder="e.g. ISO 45001" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Start Date" required><input style={inputStyle} type="date" value={form.audit_date} onChange={e => set('audit_date', e.target.value)} /></Field>
            <Field label="End Date"><input style={inputStyle} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Lead Auditor">
              <select style={selectStyle} value={form.lead_auditor_id} onChange={e => set('lead_auditor_id', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.employee_number} — {p.name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Department">
              <select style={selectStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
                <option value="">None</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
            <Field label="Project">
              <select style={selectStyle} value={form.project_id} onChange={e => set('project_id', e.target.value)}>
                <option value="">None</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Scope"><input style={inputStyle} value={form.scope} onChange={e => set('scope', e.target.value)} placeholder="Audit scope" /></Field>
          <Field label="Summary"><textarea style={textareaStyle} value={form.summary} onChange={e => set('summary', e.target.value)} placeholder="Audit summary..." /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqAudits({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [audRes, profRes, deptRes, projRes] = await Promise.all([
      supabase.from('sheq_audits').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('audit_date', { ascending: false }).limit(500),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId),
      supabase.from('projects').select('id, name').eq('site_id', currentSiteId),
    ])
    if (audRes.error) showToast(audRes.error.message, 'error')
    setRows(audRes.data || [])
    setProfiles(profRes.data || [])
    setDepartments(deptRes.data || [])
    setProjects(projRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  const filtered = rows.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (search) {
      const s = search.toLowerCase()
      return (r.audit_number || '').toLowerCase().includes(s) || (r.title || '').toLowerCase().includes(s)
    }
    return true
  })

  async function handleArchive(r) {
    if (!confirm(`Archive audit ${r.audit_number}?`)) return
    const { error } = await supabase.from('sheq_audits').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  async function handleAdvance(r) {
    const next = STATUS_FLOW[r.status]
    if (!next) return
    const { error } = await supabase.from('sheq_audits').update({ status: next }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast(`Advanced to ${STATUS_META[next]?.label}`); load() }
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view audits.</div>

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_audits" />
      <PageHeader title="Audit Programme" subtitle={`${rows.length} audits`} icon="verified" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search audits..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...selectStyle, width: 'auto', minWidth: '140px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {can('sheq.create') && <Button style={{ background: ACCENT, color: '#fff' }} onClick={() => setModal('new')}><Icon name="add" size={16} style={{ color: '#fff' }} /> New Audit</Button>}
        <Button variant="ghost" onClick={() => exportCsv(filtered, `audits_${currentSiteId}`)}><Icon name="download" size={16} /> Export</Button>
      </div>

      <Card style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Audit #', 'Date', 'Title', 'Type', 'Lead Auditor', 'Findings', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No audits found</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.audit_number}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.audit_date}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.title}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{AUDIT_TYPES[r.audit_type] || r.audit_type}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{profileMap[r.lead_auditor_id] || '--'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {r.findings_count > 0 ? (
                      <span style={{ fontSize: '12px' }}>
                        {r.ncr_major > 0 && <span style={{ color: '#D32F2F', fontWeight: 600 }}>{r.ncr_major} Major </span>}
                        {r.ncr_minor > 0 && <span style={{ color: '#E65100', fontWeight: 600 }}>{r.ncr_minor} Minor </span>}
                        {r.observations_count > 0 && <span style={{ color: '#1565C0' }}>{r.observations_count} Obs</span>}
                      </span>
                    ) : <span style={{ color: THEME.textLow }}>--</span>}
                  </td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge status={r.status} /></td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {can('sheq.edit') && STATUS_FLOW[r.status] && <button onClick={() => handleAdvance(r)} title={`Advance to ${STATUS_META[STATUS_FLOW[r.status]]?.label}`} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="arrow_forward" size={16} style={{ color: '#1565C0' }} /></button>}
                      {can('sheq.edit') && <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                      {can('sheq.delete') && <button onClick={() => handleArchive(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="archive" size={16} style={{ color: THEME.textMed }} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <AuditModal
          audit={modal === 'new' ? null : modal}
          profiles={profiles} departments={departments} projects={projects}
          siteId={currentSiteId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
