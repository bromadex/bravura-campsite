import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { showToast, ModalOverlay, Icon } from '../../components/ui'
import { KpiCard, DashCard, SectionTitle, ProgressRow } from '../../components/dash'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.projects
const DISCIPLINES = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Piping', 'Instrumentation', 'Process', 'Architectural', 'HVAC', 'Fire Protection']
const COLORS = ['#1B5E20', '#0D47A1', '#BF360C', '#4A148C', '#006064', '#E65100', '#1A237E', '#880E4F', '#33691E', '#263238']
const inp = { width: '100%', padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
const lbl = { fontSize: '11px', fontWeight: 700, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const STATUS_COLORS = { done: '#2E7D32', in_progress: '#1565C0', backlog: '#FF9800', overdue: '#C62828' }

export default function PJAreas({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('area_codes', null)

  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterDisc, setFilterDisc] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ code: '', name: '', description: '', discipline: '', color: '#1B5E20', sort_order: 0 })
  const [saving, setSaving] = useState(false)

  const [selectedArea, setSelectedArea] = useState(null)
  const [detailTab, setDetailTab] = useState('overview')
  const [areaTasks, setAreaTasks] = useState([])
  const [areaColumns, setAreaColumns] = useState([])
  const [areaDocs, setAreaDocs] = useState([])
  const [areaPhotos, setAreaPhotos] = useState([])
  const [areaEmployees, setAreaEmployees] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photoCaption, setPhotoCaption] = useState('')

  const fetchAreas = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.from('area_codes').select('*').eq('is_active', true).order('sort_order').order('code')
    if (error) showToast('Failed to load area codes', 'red')
    setAreas(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAreas() }, [fetchAreas, rt])

  async function fetchAreaDetail(area) {
    setDetailLoading(true)
    const areaName = area.name.toLowerCase()
    const areaCode = area.code.replace('AC-', '')

    const [tRes, cRes, dRes, pRes, eRes] = await Promise.all([
      supabase.from('project_tasks').select('*').eq('is_archived', false),
      supabase.from('project_board_columns').select('id, project_id, name, is_done_column'),
      supabase.from('project_documents').select('*, project:projects!project_documents_project_id_fkey(name, project_code)').eq('is_archived', false),
      supabase.from('area_code_photos').select('*').eq('area_code_id', area.id).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, position_title').eq('site_id', currentSiteId).eq('is_archived', false),
    ])

    const matchingTasks = (tRes.data || []).filter(t => {
      if (t.area_id === area.id) return true
      const title = (t.title || '').toLowerCase()
      return title.includes(`area code ${areaCode} `) || title.includes(`area code ${areaCode}/`) || title.startsWith(`area code ${areaCode}`)
    })

    const matchingDocs = (dRes.data || []).filter(d => d.area_id === area.id)

    setAreaTasks(matchingTasks)
    setAreaColumns(cRes.data || [])
    setAreaDocs(matchingDocs)
    setAreaPhotos(pRes.data || [])
    setAreaEmployees(eRes.data || [])
    setDetailLoading(false)
  }

  function openDetail(area) {
    setSelectedArea(area)
    setDetailTab('overview')
    fetchAreaDetail(area)
  }

  function closeDetail() { setSelectedArea(null) }

  const filtered = useMemo(() => {
    let list = areas
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || (a.discipline || '').toLowerCase().includes(q))
    }
    if (filterDisc) list = list.filter(a => a.discipline === filterDisc)
    return list
  }, [areas, search, filterDisc])

  const tasksByArea = useMemo(() => {
    return areas.map(a => {
      const areaCode = a.code.replace('AC-', '')
      return { id: a.id, code: a.code, name: a.name }
    })
  }, [areas])

  function openNew() {
    setEditId(null)
    setForm({ code: '', name: '', description: '', discipline: '', color: COLORS[areas.length % COLORS.length], sort_order: (areas.length + 1) * 10 })
    setModalOpen(true)
  }

  function openEdit(a, e) {
    e?.stopPropagation()
    setEditId(a.id)
    setForm({ code: a.code, name: a.name, description: a.description || '', discipline: a.discipline || '', color: a.color || '#1B5E20', sort_order: a.sort_order || 0 })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and name are required', 'red'); return }
    setSaving(true)
    const payload = { code: form.code.trim().toUpperCase(), name: form.name.trim(), description: form.description.trim() || null, discipline: form.discipline || null, color: form.color, sort_order: parseInt(form.sort_order) || 0 }
    if (editId) {
      const { error } = await supabase.from('area_codes').update(payload).eq('id', editId)
      if (error) showToast(error.message, 'red')
      else { showToast('Updated', 'green'); setModalOpen(false); fetchAreas() }
    } else {
      const { error } = await supabase.from('area_codes').insert(payload)
      if (error) showToast(error.message, 'red')
      else { showToast('Created', 'green'); setModalOpen(false); fetchAreas() }
    }
    setSaving(false)
  }

  async function handleArchive(a, e) {
    e?.stopPropagation()
    if (!confirm(`Archive area code ${a.code}?`)) return
    await supabase.from('area_codes').update({ is_active: false }).eq('id', a.id)
    showToast('Archived', 'green')
    fetchAreas()
  }

  async function uploadPhoto(e) {
    const files = e.target.files
    if (!files?.length || !selectedArea) return
    setUploading(true)
    for (const f of files) {
      const ext = f.name.split('.').pop()
      const path = `area-photos/${selectedArea.id}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: upErr } = await supabase.storage.from('project-files').upload(path, f)
      if (upErr) { showToast(upErr.message, 'red'); continue }
      const { data: urlData } = supabase.storage.from('project-files').getPublicUrl(path)
      await supabase.from('area_code_photos').insert({
        area_code_id: selectedArea.id,
        file_url: path,
        file_name: f.name,
        file_size: f.size,
        caption: photoCaption || null,
        uploaded_by: profile?.id,
        taken_date: new Date().toISOString().slice(0, 10),
      })
    }
    setPhotoCaption('')
    showToast('Photo(s) uploaded', 'green')
    fetchAreaDetail(selectedArea)
    setUploading(false)
  }

  async function viewPhoto(photo) {
    const { data, error } = await supabase.storage.from('project-files').createSignedUrl(photo.file_url, 300)
    if (error) { showToast(error.message, 'red'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function archivePhoto(photo) {
    if (!confirm('Remove this photo?')) return
    await supabase.from('area_code_photos').update({ is_archived: true }).eq('id', photo.id)
    showToast('Photo removed', 'green')
    fetchAreaDetail(selectedArea)
  }

  function empName(id) {
    return areaEmployees.find(e => e.id === id)?.name || 'Unknown'
  }

  if (!can('projects.view')) {
    return <DashCard style={{ textAlign: 'center', padding: '40px' }}><div style={{ color: THEME.textMed }}>No access.</div></DashCard>
  }

  // ── DETAIL VIEW ─────────────────────────────────────────────────
  if (selectedArea) {
    const colMap = {}
    areaColumns.forEach(c => { colMap[c.id] = c })
    const doneTasks = areaTasks.filter(t => colMap[t.column_id]?.is_done_column || t.percent_complete === 100)
    const inProgressTasks = areaTasks.filter(t => (t.percent_complete || 0) > 0 && (t.percent_complete || 0) < 100 && !colMap[t.column_id]?.is_done_column)
    const overdueTasks = areaTasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && !t.completed_date)
    const avgPct = areaTasks.length > 0 ? Math.round(areaTasks.reduce((s, t) => s + (t.percent_complete || 0), 0) / areaTasks.length) : 0

    const DETAIL_TABS = [
      { id: 'overview', label: 'Overview', icon: 'dashboard' },
      { id: 'tasks', label: `Tasks (${areaTasks.length})`, icon: 'task' },
      { id: 'documents', label: `Documents (${areaDocs.length})`, icon: 'description' },
      { id: 'photos', label: `Photos (${areaPhotos.length})`, icon: 'photo_library' },
    ]

    return (
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
        <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_areas" />

        <button onClick={closeDetail} style={{ background: 'none', border: 'none', color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px', padding: 0, fontFamily: 'inherit' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>arrow_back</span>
          All Area Codes
        </button>

        {/* Header */}
        <div style={{ borderRadius: '14px', overflow: 'hidden', border: `1px solid ${THEME.outlineVar}`, marginBottom: '20px' }}>
          <div style={{ height: '8px', background: selectedArea.color || color }} />
          <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                width: '52px', height: '52px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: (selectedArea.color || color) + '18', color: selectedArea.color || color, fontWeight: 800, fontSize: '16px',
              }}>{selectedArea.code}</div>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text }}>{selectedArea.name}</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                  {selectedArea.discipline && <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', background: (selectedArea.color || color) + '18', color: selectedArea.color || color }}>{selectedArea.discipline}</span>}
                  <span style={{ fontSize: '12px', color: THEME.textLow }}>{areaTasks.length} tasks · {avgPct}% complete</span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Progress ring */}
              <svg width="56" height="56" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" stroke={THEME.outlineVar} strokeWidth="4" />
                <circle cx="28" cy="28" r="24" fill="none" stroke={avgPct >= 100 ? '#2E7D32' : selectedArea.color || color} strokeWidth="4"
                  strokeDasharray={`${(avgPct / 100) * 150.8} 150.8`} strokeLinecap="round" transform="rotate(-90 28 28)" />
                <text x="28" y="32" textAnchor="middle" fill={THEME.text} fontSize="13" fontWeight="700">{avgPct}%</text>
              </svg>
              {can('projects.edit') && (
                <button onClick={(e) => openEdit(selectedArea, e)} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px',
                  fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>edit</span>Edit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {DETAIL_TABS.map(t => (
            <button key={t.id} onClick={() => setDetailTab(t.id)} style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '8px 16px', borderRadius: '10px',
              fontSize: '13px', fontWeight: 600, background: detailTab === t.id ? (selectedArea.color || color) : THEME.surfaceVar,
              color: detailTab === t.id ? '#fff' : THEME.textMed, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
            <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
          </div>
        ) : (
          <>
            {/* OVERVIEW */}
            {detailTab === 'overview' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                  <KpiCard label="Total Tasks" value={areaTasks.length} icon="task" accent={selectedArea.color || color} />
                  <KpiCard label="Completed" value={doneTasks.length} icon="task_alt" accent="#2E7D32" />
                  <KpiCard label="In Progress" value={inProgressTasks.length} icon="pending" accent="#1565C0" />
                  <KpiCard label="Overdue" value={overdueTasks.length} icon="warning" accent={overdueTasks.length > 0 ? '#C62828' : '#999'} />
                  <KpiCard label="Documents" value={areaDocs.length} icon="description" accent="#6A1B9A" />
                  <KpiCard label="Photos" value={areaPhotos.length} icon="photo_library" accent="#00838F" />
                </div>

                {selectedArea.description && (
                  <DashCard style={{ marginBottom: '16px' }}>
                    <SectionTitle title="Description" />
                    <div style={{ fontSize: '13px', color: THEME.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{selectedArea.description}</div>
                  </DashCard>
                )}

                {/* Progress bar */}
                <DashCard style={{ marginBottom: '16px' }}>
                  <SectionTitle title="Completion Progress" subtitle={`${doneTasks.length} of ${areaTasks.length} tasks done`} />
                  <div style={{ height: '12px', borderRadius: '6px', background: THEME.outlineVar, overflow: 'hidden', marginBottom: '12px' }}>
                    <div style={{ height: '100%', width: `${avgPct}%`, background: avgPct >= 100 ? '#2E7D32' : selectedArea.color || color, borderRadius: '6px', transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                    <span style={{ color: '#2E7D32', fontWeight: 600 }}>{doneTasks.length} Done</span>
                    <span style={{ color: '#1565C0', fontWeight: 600 }}>{inProgressTasks.length} In Progress</span>
                    <span style={{ color: '#FF9800', fontWeight: 600 }}>{areaTasks.length - doneTasks.length - inProgressTasks.length} Not Started</span>
                    {overdueTasks.length > 0 && <span style={{ color: '#C62828', fontWeight: 600 }}>{overdueTasks.length} Overdue</span>}
                  </div>
                </DashCard>

                {/* Timeline bars */}
                {areaTasks.length > 0 && (
                  <DashCard>
                    <SectionTitle title="Timeline" />
                    {areaTasks.sort((a, b) => new Date(a.start_date || '9999') - new Date(b.start_date || '9999')).map(t => {
                      const pct = t.percent_complete || 0
                      const isDone = pct === 100 || colMap[t.column_id]?.is_done_column
                      const isOd = t.due_date && new Date(t.due_date) < new Date() && !t.completed_date
                      return (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                          <span className="material-symbols-rounded" style={{ fontSize: '16px', color: isDone ? '#2E7D32' : isOd ? '#C62828' : '#1565C0' }}>
                            {isDone ? 'check_circle' : isOd ? 'error' : 'pending'}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                            <div style={{ fontSize: '10px', color: THEME.textLow }}>{t.start_date || '—'} → {t.due_date || '—'}{t.planned_duration ? ` · ${t.planned_duration}d` : ''}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '70px' }}>
                            <div style={{ flex: 1, height: '5px', borderRadius: '3px', background: THEME.outlineVar, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: isDone ? '#2E7D32' : pct >= 50 ? '#1565C0' : '#FF9800', borderRadius: '3px' }} />
                            </div>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: isDone ? '#2E7D32' : THEME.text, minWidth: '28px' }}>{pct}%</span>
                          </div>
                        </div>
                      )
                    })}
                  </DashCard>
                )}
              </>
            )}

            {/* TASKS TAB */}
            {detailTab === 'tasks' && (
              <DashCard>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                        {['#', 'Task', 'Status', 'Duration', 'Start', 'Finish', 'Actual Start', 'Actual Finish', '% Complete', 'Assigned To'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: THEME.textMed, whiteSpace: 'nowrap', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {areaTasks.length === 0 ? (
                        <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No tasks linked to this area code.</td></tr>
                      ) : areaTasks.sort((a, b) => (a.position || 0) - (b.position || 0)).map((t, i) => {
                        const col = colMap[t.column_id]
                        const colName = col?.name || '—'
                        const pct = t.percent_complete || 0
                        const isDone = col?.is_done_column || pct === 100
                        const isOverdue = t.due_date && new Date(t.due_date) < new Date() && !t.completed_date
                        const statusColor = isDone ? '#2E7D32' : pct > 0 ? '#1565C0' : isOverdue ? '#C62828' : THEME.textLow
                        return (
                          <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: isDone ? '#F1F8E9' : isOverdue ? '#FFF8E1' : 'transparent' }}>
                            <td style={{ padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px' }}>{i + 1}</td>
                            <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600, maxWidth: '260px' }}>{t.title}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: statusColor + '18', color: statusColor, whiteSpace: 'nowrap' }}>{colName}</span>
                            </td>
                            <td style={{ padding: '8px 10px', color: THEME.textMed, textAlign: 'center' }}>{t.planned_duration ? `${t.planned_duration}d` : '—'}</td>
                            <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.start_date || '—'}</td>
                            <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.due_date || '—'}</td>
                            <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.actual_start || '—'}</td>
                            <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.actual_end || '—'}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '70px' }}>
                                <div style={{ flex: 1, height: '5px', borderRadius: '3px', background: THEME.outlineVar, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${pct}%`, background: isDone ? '#2E7D32' : pct >= 50 ? '#1565C0' : '#FF9800', borderRadius: '3px' }} />
                                </div>
                                <span style={{ fontSize: '10px', fontWeight: 700, color: isDone ? '#2E7D32' : THEME.text, minWidth: '28px' }}>{pct}%</span>
                              </div>
                            </td>
                            <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                              {t.assigned_to ? (
                                <span onClick={() => setPage('wf_employee_detail', t.assigned_to)}
                                  style={{ fontSize: '12px', fontWeight: 600, color, cursor: 'pointer', textDecoration: 'underline' }}>
                                  {empName(t.assigned_to)}
                                </span>
                              ) : <span style={{ color: THEME.textLow }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </DashCard>
            )}

            {/* DOCUMENTS TAB */}
            {detailTab === 'documents' && (
              <DashCard>
                <SectionTitle title="Documents" subtitle={`${areaDocs.length} documents`} />
                {areaDocs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>
                    No documents linked to this area code. Add documents from the Document Register (PJ07) with this area selected.
                  </div>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                          {['Doc #', 'Title', 'Type', 'Rev', 'Status', 'Project'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: THEME.textMed, fontSize: '11px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {areaDocs.map(d => {
                          const sc = d.status === 'approved' ? '#2E7D32' : d.status === 'issued_for_review' ? '#1565C0' : '#FF9800'
                          return (
                            <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                              <td style={{ padding: '8px 10px', color, fontWeight: 600, fontFamily: 'monospace', fontSize: '11px' }}>{d.doc_number}</td>
                              <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600 }}>{d.title}</td>
                              <td style={{ padding: '8px 10px', color: THEME.textMed }}>{d.doc_type || '—'}</td>
                              <td style={{ padding: '8px 10px', color: THEME.textMed, fontFamily: 'monospace' }}>{d.revision || '—'}</td>
                              <td style={{ padding: '8px 10px' }}>
                                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: sc + '18', color: sc }}>{d.status || 'draft'}</span>
                              </td>
                              <td style={{ padding: '8px 10px', color: THEME.textLow, fontSize: '11px' }}>{d.project?.project_code || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </DashCard>
            )}

            {/* PHOTOS TAB */}
            {detailTab === 'photos' && (
              <>
                {can('projects.edit') && (
                  <DashCard style={{ marginBottom: '16px' }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="text" placeholder="Caption (optional)" value={photoCaption} onChange={e => setPhotoCaption(e.target.value)}
                        style={{ ...inp, maxWidth: '300px' }} />
                      <label style={{
                        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '10px',
                        fontSize: '13px', fontWeight: 600, background: selectedArea.color || color, color: '#fff',
                        cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.6 : 1,
                      }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>{uploading ? 'progress_activity' : 'add_photo_alternate'}</span>
                        {uploading ? 'Uploading...' : 'Upload Photos'}
                        <input type="file" accept="image/*" multiple onChange={uploadPhoto} style={{ display: 'none' }} disabled={uploading} />
                      </label>
                    </div>
                  </DashCard>
                )}

                {areaPhotos.length === 0 ? (
                  <DashCard>
                    <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '40px', display: 'block', marginBottom: '8px' }}>photo_library</span>
                      No photos yet. Upload site photos to track progress visually.
                    </div>
                  </DashCard>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                    {areaPhotos.map(p => (
                      <DashCard key={p.id} style={{ padding: '0', overflow: 'hidden', cursor: 'pointer' }} onClick={() => viewPhoto(p)}>
                        <div style={{ height: '140px', background: THEME.surfaceVar, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <span className="material-symbols-rounded" style={{ fontSize: '40px', color: THEME.textLow }}>image</span>
                        </div>
                        <div style={{ padding: '10px 12px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.caption || p.file_name || 'Photo'}</div>
                          <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{new Date(p.created_at).toLocaleDateString()}</span>
                            {can('projects.edit') && (
                              <button onClick={e => { e.stopPropagation(); archivePhoto(p) }} style={{ background: 'none', border: 'none', color: THEME.textLow, cursor: 'pointer', padding: '2px' }}>
                                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>delete</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </DashCard>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    )
  }

  // ── LIST VIEW ─────────────────────────────────────────────────
  const disciplines = [...new Set(areas.map(a => a.discipline).filter(Boolean))].sort()

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_areas" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Area Codes</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => exportCsv('area_codes.csv', ['Code', 'Name', 'Discipline', 'Description'], filtered.map(a => [a.code, a.name, a.discipline || '', a.description || '']))} style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px',
            fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>download</span>Export
          </button>
          {can('projects.edit') && (
            <button onClick={openNew} style={{
              display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
              fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>Add Area Code
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search areas..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
        <select value={filterDisc} onChange={e => setFilterDisc(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="">All Disciplines</option>
          {disciplines.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} area codes</span>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : filtered.length === 0 ? (
        <DashCard style={{ textAlign: 'center', padding: '48px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '40px', color: THEME.outline }}>location_city</span>
          <div style={{ marginTop: '12px', color: THEME.textMed, fontSize: '14px' }}>No area codes found.</div>
        </DashCard>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' }}>
          {filtered.map(a => (
            <DashCard key={a.id} style={{ padding: '0', overflow: 'hidden', cursor: 'pointer' }} onClick={() => openDetail(a)}>
              <div style={{ height: '6px', background: a.color || color }} />
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{
                    width: '42px', height: '42px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: (a.color || color) + '18', color: a.color || color, fontWeight: 800, fontSize: '12px',
                  }}>{a.code}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{a.name}</div>
                    {a.discipline && <div style={{ fontSize: '11px', color: THEME.textMed }}>{a.discipline}</div>}
                  </div>
                  <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textLow }}>chevron_right</span>
                </div>
                {a.description && <div style={{ fontSize: '11px', color: THEME.textLow, lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{a.description}</div>}
              </div>
            </DashCard>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '480px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>{editId ? 'Edit Area Code' : 'Add Area Code'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', marginBottom: '12px' }}>
              <div><label style={lbl}>Code *</label><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="AC-01" maxLength={10} style={{ ...inp, textTransform: 'uppercase' }} /></div>
              <div><label style={lbl}>Name *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Field feed bin" style={inp} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div><label style={lbl}>Discipline</label>
                <select value={form.discipline} onChange={e => setForm({ ...form, discipline: e.target.value })} style={inp}>
                  <option value="">— None —</option>
                  {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Sort Order</label><input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} style={inp} /></div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={lbl}>Color</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setForm({ ...form, color: c })} style={{
                    width: '28px', height: '28px', borderRadius: '8px', background: c, cursor: 'pointer',
                    border: form.color === c ? '3px solid ' + THEME.text : '2px solid transparent',
                  }} />
                ))}
              </div>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={lbl}>Description</label>
              <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setModalOpen(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
