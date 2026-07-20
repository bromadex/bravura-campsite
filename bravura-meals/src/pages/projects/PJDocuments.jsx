import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.projects

const DOC_TYPES = [
  { value: 'drawing', label: 'Drawing' },
  { value: 'specification', label: 'Specification' },
  { value: 'method_statement', label: 'Method Statement' },
  { value: 'report', label: 'Report' },
  { value: 'correspondence', label: 'Correspondence' },
  { value: 'permit', label: 'Permit' },
  { value: 'other', label: 'Other' },
]

const STATUS_MAP = {
  draft: { label: 'Draft', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
  issued_for_review: { label: 'Issued for Review', bg: '#FFF3E0', text: '#E65100' },
  issued_for_construction: { label: 'Issued for Construction', bg: '#E3F2FD', text: '#1565C0' },
  approved: { label: 'Approved', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  superseded: { label: 'Superseded', bg: THEME.statusErrorBg, text: THEME.statusErrorText },
}

const DISCIPLINES = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Piping', 'Instrumentation', 'Process', 'Architectural']

export default function PJDocuments({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('project_documents', null)
  const [docs, setDocs] = useState([])
  const [projects, setProjects] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ project_id: '', area_id: '', doc_number: '', title: '', doc_type: 'drawing', discipline: '', revision: 'A', status: 'draft', notes: '' })
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [docRes, projRes, areaRes] = await Promise.all([
        supabase.from('project_documents')
          .select('*, project:projects!project_documents_project_id_fkey(name, project_code, site_id), area:project_areas!project_documents_area_id_fkey(id, area_code:area_codes(code, name)), creator:profiles!project_documents_created_by_fkey(full_name)')
          .eq('is_archived', false)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('projects').select('id, name, project_code').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
        supabase.from('project_areas').select('id, project_id, area_code:area_codes(code, name)').order('sort_order'),
      ])
      if (docRes.error) throw docRes.error
      setDocs((docRes.data || []).filter(d => d.project?.site_id === currentSiteId))
      setProjects(projRes.data || [])
      setAreas(areaRes.data || [])
    } catch (err) {
      console.error('PJDocuments:', err)
      showToast('Failed to load documents', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch, rt])

  const filtered = useMemo(() => {
    let list = docs
    if (filterProject) list = list.filter(d => d.project_id === filterProject)
    if (filterStatus) list = list.filter(d => d.status === filterStatus)
    if (filterType) list = list.filter(d => d.doc_type === filterType)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        d.doc_number.toLowerCase().includes(q) ||
        d.title.toLowerCase().includes(q) ||
        (d.discipline || '').toLowerCase().includes(q) ||
        (d.area?.area_code?.code || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [docs, search, filterProject, filterStatus, filterType])

  const filteredAreas = useMemo(() => {
    if (!form.project_id) return []
    return areas.filter(a => a.project_id === form.project_id)
  }, [areas, form.project_id])

  function openNew() {
    setEditId(null)
    setForm({ project_id: filterProject || '', area_id: '', doc_number: '', title: '', doc_type: 'drawing', discipline: '', revision: 'A', status: 'draft', notes: '' })
    setModalOpen(true)
  }

  function openEdit(d) {
    setEditId(d.id)
    setForm({
      project_id: d.project_id, area_id: d.area_id || '', doc_number: d.doc_number,
      title: d.title, doc_type: d.doc_type, discipline: d.discipline || '',
      revision: d.revision, status: d.status, notes: d.notes || '',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.project_id || !form.doc_number.trim() || !form.title.trim()) {
      showToast('Project, document number, and title are required', 'red'); return
    }
    setSaving(true)
    try {
      const payload = {
        project_id: form.project_id,
        area_id: form.area_id || null,
        doc_number: form.doc_number.trim().toUpperCase(),
        title: form.title.trim(),
        doc_type: form.doc_type,
        discipline: form.discipline || null,
        revision: form.revision.trim().toUpperCase() || 'A',
        status: form.status,
        notes: form.notes.trim() || null,
      }
      if (editId) {
        const { error } = await supabase.from('project_documents').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId)
        if (error) throw error
        showToast('Document updated', 'green')
      } else {
        const { error } = await supabase.from('project_documents').insert({ ...payload, created_by: profile?.id })
        if (error) throw error
        showToast('Document registered', 'green')
      }
      setModalOpen(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function handleRevise(d) {
    const nextRev = String.fromCharCode(d.revision.charCodeAt(0) + 1)
    setSaving(true)
    try {
      await supabase.from('document_revisions').insert({
        document_id: d.id, revision: d.revision, file_url: d.file_url,
        change_description: 'Superseded by revision ' + nextRev, created_by: profile?.id,
      })
      const { error } = await supabase.from('project_documents').update({ revision: nextRev, status: 'draft', updated_at: new Date().toISOString() }).eq('id', d.id)
      if (error) throw error
      showToast(`Revised to Rev ${nextRev}`, 'green')
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  function handleExport() {
    exportCsv('document_register.csv',
      ['Doc Number', 'Title', 'Type', 'Discipline', 'Revision', 'Status', 'Project', 'Area', 'Created By', 'Date'],
      filtered.map(d => [
        d.doc_number, d.title, d.doc_type, d.discipline || '', d.revision, d.status,
        d.project?.name || '', d.area?.area_code?.code || '', d.creator?.full_name || '',
        new Date(d.created_at).toLocaleDateString(),
      ]))
  }

  if (!can('projects.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  const statusCounts = useMemo(() => {
    const c = { draft: 0, issued_for_review: 0, issued_for_construction: 0, approved: 0, superseded: 0 }
    docs.forEach(d => { if (c[d.status] !== undefined) c[d.status]++ })
    return c
  }, [docs])

  return (
    <div>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_documents" />
      <PageHeader title="Document Register" site={currentSite} actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button icon="download" onClick={handleExport}>Export</Button>
          {can('projects.edit') && <Button icon="add" variant="filled" onClick={openNew}>Register Document</Button>}
        </div>
      } />

      {/* Status summary pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {Object.entries(STATUS_MAP).map(([key, s]) => (
          <div key={key} onClick={() => setFilterStatus(filterStatus === key ? '' : key)} style={{
            padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            background: filterStatus === key ? s.text : s.bg, color: filterStatus === key ? '#fff' : s.text,
            transition: 'all 0.15s',
          }}>
            {s.label} ({statusCounts[key]})
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search documents..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ ...inp, maxWidth: '200px' }}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="">All Types</option>
          {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} documents</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '48px' }}>
          <Icon name="description" size={40} style={{ color: THEME.outline }} />
          <div style={{ marginTop: '12px', color: THEME.textMed, fontSize: '14px' }}>No documents found.</div>
        </Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Doc Number', 'Title', 'Type', 'Discipline', 'Rev', 'Status', 'Project', 'Area', 'By', 'Date', ''].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const s = STATUS_MAP[d.status] || STATUS_MAP.draft
                return (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => can('projects.edit') && openEdit(d)}>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: color, fontWeight: 700 }}>{d.doc_number}</td>
                    <td style={{ padding: '8px 10px', color: THEME.text, maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px', textTransform: 'capitalize' }}>{d.doc_type.replace('_', ' ')}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{d.discipline || '—'}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: THEME.text, textAlign: 'center' }}>{d.revision}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: s.bg, color: s.text }}>{s.label}</span>
                    </td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{d.project?.project_code || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{d.area?.area_code?.code || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{d.creator?.full_name || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px', whiteSpace: 'nowrap' }}>{new Date(d.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {can('projects.edit') && d.status !== 'superseded' && (
                        <Button size="sm" onClick={e => { e.stopPropagation(); handleRevise(d) }} style={{ fontSize: '11px' }} disabled={saving}>
                          <Icon name="history" size={14} /> Revise
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal dirty={true} open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Document' : 'Register Document'}
        footer={<>
          <Button variant="text" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="filled" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <SectionLabel>Project *</SectionLabel>
            <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value, area_id: '' })} style={inp}>
              <option value="">— Select project —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Document Number *</SectionLabel>
              <input value={form.doc_number} onChange={e => setForm({ ...form, doc_number: e.target.value })} placeholder="A100-CIV-001" style={{ ...inp, textTransform: 'uppercase' }} />
            </div>
            <div>
              <SectionLabel>Area</SectionLabel>
              <select value={form.area_id} onChange={e => setForm({ ...form, area_id: e.target.value })} style={inp}>
                <option value="">— None —</option>
                {filteredAreas.map(a => <option key={a.id} value={a.id}>{a.area_code?.code} — {a.area_code?.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <SectionLabel>Title *</SectionLabel>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Foundation Layout Plan" style={inp} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Type</SectionLabel>
              <select value={form.doc_type} onChange={e => setForm({ ...form, doc_type: e.target.value })} style={inp}>
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Discipline</SectionLabel>
              <select value={form.discipline} onChange={e => setForm({ ...form, discipline: e.target.value })} style={inp}>
                <option value="">— None —</option>
                {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Revision</SectionLabel>
              <input value={form.revision} onChange={e => setForm({ ...form, revision: e.target.value })} maxLength={10} style={{ ...inp, textTransform: 'uppercase' }} />
            </div>
          </div>
          <div>
            <SectionLabel>Status</SectionLabel>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp}>
              {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
