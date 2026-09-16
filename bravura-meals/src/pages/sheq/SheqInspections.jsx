import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const STATUS_META = {
  planned:     { label: 'Planned',     bg: '#E3F2FD', color: '#1565C0', icon: 'schedule' },
  in_progress: { label: 'In Progress', bg: '#FFF8E1', color: '#F59E0B', icon: 'pending' },
  completed:   { label: 'Completed',   bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  reviewed:    { label: 'Reviewed',    bg: '#F3E5F5', color: '#7B1FA2', icon: 'verified' },
}

const STATUS_FLOW = { planned: 'in_progress', in_progress: 'completed', completed: 'reviewed' }

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

function InspectionModal({ record, templates, profiles, departments, projects, siteId, userId, onClose, onSaved }) {
  const isEdit = !!record
  const [form, setForm] = useState(() => {
    if (record) return {
      title: record.title || '', template_id: record.template_id || '',
      inspection_date: record.inspection_date || '', location: record.location || '',
      inspector_id: record.inspector_id || '', department_id: record.department_id || '',
      project_id: record.project_id || '', summary: record.summary || '',
      score_pct: record.score_pct ?? '', status: record.status || 'planned',
    }
    return { title: '', template_id: '', inspection_date: new Date().toISOString().slice(0, 10), location: '', inspector_id: userId || '', department_id: '', project_id: '', summary: '', score_pct: '', status: 'planned' }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.title) { showToast('Title is required', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        title: form.title, template_id: form.template_id || null,
        inspection_date: form.inspection_date, location: form.location || null,
        inspector_id: form.inspector_id || null, department_id: form.department_id || null,
        project_id: form.project_id || null, summary: form.summary || null,
        score_pct: form.score_pct !== '' ? Number(form.score_pct) : null,
        status: form.status,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_inspections').update(payload).eq('id', record.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Inspection updated')
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'INS', p_table: 'sheq_inspections' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.inspection_number = num
        const { error } = await supabase.from('sheq_inspections').insert(payload)
        if (error) throw error
        showToast(`Inspection ${num} created`)
      }
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '600px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${record.inspection_number}` : 'New Inspection'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Title" required><input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Inspection title" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Template">
              <select style={selectStyle} value={form.template_id} onChange={e => set('template_id', e.target.value)}>
                <option value="">None</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.template_code} — {t.name}</option>)}
              </select>
            </Field>
            <Field label="Date" required><input style={inputStyle} type="date" value={form.inspection_date} onChange={e => set('inspection_date', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Location"><input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} /></Field>
            <Field label="Inspector">
              <select style={selectStyle} value={form.inspector_id} onChange={e => set('inspector_id', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Score (%)"><input style={inputStyle} type="number" min="0" max="100" step="0.01" value={form.score_pct} onChange={e => set('score_pct', e.target.value)} /></Field>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Summary"><textarea style={textareaStyle} value={form.summary} onChange={e => set('summary', e.target.value)} placeholder="Inspection summary and key findings..." /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqInspections({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [templates, setTemplates] = useState([])
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
    const [insRes, tplRes, profRes, deptRes, projRes] = await Promise.all([
      supabase.from('sheq_inspections').select('*, profiles!sheq_inspections_inspector_id_fkey(full_name)').eq('site_id', currentSiteId).eq('is_archived', false).order('inspection_date', { ascending: false }).limit(500),
      supabase.from('sheq_inspection_templates').select('id, template_code, name').eq('site_id', currentSiteId).eq('is_active', true).eq('is_archived', false),
      supabase.from('profiles').select('id, full_name'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId),
      supabase.from('projects').select('id, name').eq('site_id', currentSiteId),
    ])
    if (insRes.error) showToast(insRes.error.message, 'error')
    setRows(insRes.data || [])
    setTemplates(tplRes.data || [])
    setProfiles(profRes.data || [])
    setDepartments(deptRes.data || [])
    setProjects(projRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const filtered = rows.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (search) {
      const s = search.toLowerCase()
      return (r.inspection_number || '').toLowerCase().includes(s) || (r.title || '').toLowerCase().includes(s) || (r.location || '').toLowerCase().includes(s)
    }
    return true
  })

  async function handleArchive(r) {
    if (!confirm(`Archive inspection ${r.inspection_number}?`)) return
    const { error } = await supabase.from('sheq_inspections').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  async function handleAdvance(r) {
    const next = STATUS_FLOW[r.status]
    if (!next) return
    const upd = { status: next }
    if (next === 'reviewed') { upd.reviewed_by = user?.id; upd.reviewed_at = new Date().toISOString() }
    const { error } = await supabase.from('sheq_inspections').update(upd).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast(`Advanced to ${STATUS_META[next]?.label}`); load() }
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view inspections.</div>

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_inspections" />
      <PageHeader title="Inspections" subtitle={`${rows.length} inspections`} icon="checklist" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search inspections..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...selectStyle, width: 'auto', minWidth: '140px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {can('sheq.create') && <Button style={{ background: ACCENT, color: '#fff' }} onClick={() => setModal('new')}><Icon name="add" size={16} style={{ color: '#fff' }} /> New Inspection</Button>}
        <Button variant="ghost" onClick={() => exportCsv(filtered, `inspections_${currentSiteId}`)}><Icon name="download" size={16} /> Export</Button>
      </div>

      <Card style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Inspection #', 'Date', 'Title', 'Location', 'Inspector', 'Score', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No inspections found</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.inspection_number}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.inspection_date}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.title}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.location || '--'}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.profiles?.full_name || '--'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    {r.score_pct != null ? (
                      <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: r.score_pct >= 80 ? '#E8F5E9' : r.score_pct >= 60 ? '#FFF8E1' : '#FFEBEE', color: r.score_pct >= 80 ? '#2E7D32' : r.score_pct >= 60 ? '#F59E0B' : '#D32F2F' }}>
                        {Number(r.score_pct).toFixed(0)}%
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
        <InspectionModal
          record={modal === 'new' ? null : modal}
          templates={templates} profiles={profiles} departments={departments} projects={projects}
          siteId={currentSiteId} userId={user?.id}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
