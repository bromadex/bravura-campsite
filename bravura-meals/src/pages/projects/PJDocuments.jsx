import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast, ModalOverlay } from '../../components/ui'
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

const REVIEW_STATUS = {
  pending: { label: 'Pending', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
  reviewed: { label: 'Reviewed', bg: '#E3F2FD', text: '#1565C0' },
  approved: { label: 'Approved', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  rejected: { label: 'Rejected', bg: THEME.statusErrorBg, text: THEME.statusErrorText },
  skipped: { label: 'Skipped', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const CYCLE_STATUS = {
  open: { label: 'Open', bg: '#FFF3E0', text: '#E65100' },
  in_review: { label: 'In Review', bg: '#E3F2FD', text: '#1565C0' },
  approved: { label: 'Approved', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  rejected: { label: 'Rejected', bg: THEME.statusErrorBg, text: THEME.statusErrorText },
  cancelled: { label: 'Cancelled', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
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
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ project_id: '', area_id: '', doc_number: '', title: '', doc_type: 'drawing', discipline: '', revision: 'A', status: 'draft', notes: '' })
  const [saving, setSaving] = useState(false)

  // Detail drawer state
  const [detailDoc, setDetailDoc] = useState(null)
  const [cycles, setCycles] = useState([])
  const [reviewers, setReviewers] = useState([])
  const [comments, setComments] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [reviewModal, setReviewModal] = useState(false)
  const [reviewForm, setReviewForm] = useState({ reviewer_ids: [], due_date: '', notes: '' })
  const [reviewSaving, setReviewSaving] = useState(false)
  const [detailTab, setDetailTab] = useState('overview')

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

  async function fetchMembers(projectId) {
    if (!projectId) return
    const { data } = await supabase.from('project_members')
      .select('user_id, role, user:profiles!project_members_user_id_fkey(id, full_name, username)')
      .eq('project_id', projectId).eq('is_active', true)
    setMembers(data || [])
  }

  async function fetchDocDetail(doc) {
    setDetailDoc(doc)
    setDetailTab('overview')
    setDetailLoading(true)
    setCommentText('')
    await fetchMembers(doc.project_id)
    const [cycleRes, commentRes] = await Promise.all([
      supabase.from('document_review_cycles').select('*').eq('document_id', doc.id).order('cycle_number', { ascending: false }),
      supabase.from('document_comments')
        .select('*, author:profiles!document_comments_author_id_fkey(full_name)')
        .eq('document_id', doc.id).order('created_at', { ascending: false }),
    ])
    const cyclesData = cycleRes.data || []
    setCycles(cyclesData)
    setComments(commentRes.data || [])

    if (cyclesData.length > 0) {
      const cycleIds = cyclesData.map(c => c.id)
      const { data: revData } = await supabase.from('document_reviewers')
        .select('*, reviewer:profiles!document_reviewers_reviewer_id_fkey(full_name)')
        .in('cycle_id', cycleIds)
      setReviewers(revData || [])
    } else {
      setReviewers([])
    }
    setDetailLoading(false)
  }

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
      if (detailDoc?.id === d.id) fetchDocDetail({ ...d, revision: nextRev, status: 'draft' })
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  // Review cycle management
  async function startReviewCycle() {
    if (reviewForm.reviewer_ids.length === 0) { showToast('Add at least one reviewer', 'red'); return }
    setReviewSaving(true)
    try {
      const maxCycle = cycles.reduce((m, c) => Math.max(m, c.cycle_number), 0)
      const { data: cycle, error: cErr } = await supabase.from('document_review_cycles').insert({
        document_id: detailDoc.id, cycle_number: maxCycle + 1, status: 'in_review',
        initiated_by: profile?.id, due_date: reviewForm.due_date || null, notes: reviewForm.notes || null,
      }).select().single()
      if (cErr) throw cErr

      const revInserts = reviewForm.reviewer_ids.map(uid => ({ cycle_id: cycle.id, reviewer_id: uid }))
      const { error: rErr } = await supabase.from('document_reviewers').insert(revInserts)
      if (rErr) throw rErr

      await supabase.from('project_documents').update({ status: 'issued_for_review', updated_at: new Date().toISOString() }).eq('id', detailDoc.id)

      await supabase.from('document_comments').insert({
        document_id: detailDoc.id, cycle_id: cycle.id, author_id: profile?.id,
        comment: `Started review cycle ${cycle.cycle_number} with ${reviewForm.reviewer_ids.length} reviewer(s)`,
        comment_type: 'status_change',
      })

      showToast('Review cycle started', 'green')
      setReviewModal(false)
      setReviewForm({ reviewer_ids: [], due_date: '', notes: '' })
      fetchDocDetail({ ...detailDoc, status: 'issued_for_review' })
      fetch()
    } catch (err) { showToast(err.message, 'red') }
    setReviewSaving(false)
  }

  async function submitReview(cycleId, status, comment) {
    try {
      await supabase.from('document_reviewers').update({
        status, reviewed_at: new Date().toISOString(), comment: comment || null,
      }).eq('cycle_id', cycleId).eq('reviewer_id', profile?.id)

      const typeMap = { approved: 'approval', rejected: 'rejection', reviewed: 'comment' }
      await supabase.from('document_comments').insert({
        document_id: detailDoc.id, cycle_id: cycleId, author_id: profile?.id,
        comment: comment || `${status.charAt(0).toUpperCase() + status.slice(1)} the document`,
        comment_type: typeMap[status] || 'comment',
      })

      const { data: allRevs } = await supabase.from('document_reviewers').select('status').eq('cycle_id', cycleId)
      const allDone = allRevs?.every(r => r.status !== 'pending')
      const anyRejected = allRevs?.some(r => r.status === 'rejected')
      const allApproved = allRevs?.every(r => r.status === 'approved' || r.status === 'skipped')

      if (allDone) {
        const cycleStatus = anyRejected ? 'rejected' : allApproved ? 'approved' : 'approved'
        await supabase.from('document_review_cycles').update({ status: cycleStatus, closed_at: new Date().toISOString() }).eq('id', cycleId)
        if (allApproved) {
          await supabase.from('project_documents').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', detailDoc.id)
        }
      }

      showToast(`Review submitted: ${status}`, 'green')
      fetchDocDetail(detailDoc)
      fetch()
    } catch (err) { showToast(err.message, 'red') }
  }

  async function closeCycle(cycleId, status) {
    try {
      await supabase.from('document_review_cycles').update({ status, closed_at: new Date().toISOString() }).eq('id', cycleId)
      const docStatus = status === 'approved' ? 'approved' : status === 'rejected' ? 'draft' : detailDoc.status
      if (docStatus !== detailDoc.status) {
        await supabase.from('project_documents').update({ status: docStatus, updated_at: new Date().toISOString() }).eq('id', detailDoc.id)
      }
      await supabase.from('document_comments').insert({
        document_id: detailDoc.id, cycle_id: cycleId, author_id: profile?.id,
        comment: `Review cycle ${status}`, comment_type: 'status_change',
      })
      showToast(`Cycle ${status}`, 'green')
      fetchDocDetail({ ...detailDoc, status: docStatus })
      fetch()
    } catch (err) { showToast(err.message, 'red') }
  }

  async function addComment() {
    if (!commentText.trim()) return
    setCommentSaving(true)
    try {
      await supabase.from('document_comments').insert({
        document_id: detailDoc.id, author_id: profile?.id,
        comment: commentText.trim(), comment_type: 'comment',
        cycle_id: cycles.find(c => c.status === 'in_review' || c.status === 'open')?.id || null,
      })
      setCommentText('')
      fetchDocDetail(detailDoc)
    } catch (err) { showToast(err.message, 'red') }
    setCommentSaving(false)
  }

  async function resolveComment(cId) {
    await supabase.from('document_comments').update({ is_resolved: true, resolved_by: profile?.id, resolved_at: new Date().toISOString() }).eq('id', cId)
    fetchDocDetail(detailDoc)
  }

  async function changeDocStatus(docId, newStatus) {
    try {
      await supabase.from('project_documents').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', docId)
      await supabase.from('document_comments').insert({
        document_id: docId, author_id: profile?.id,
        comment: `Changed status to ${STATUS_MAP[newStatus]?.label || newStatus}`,
        comment_type: 'status_change',
      })
      showToast(`Status changed to ${STATUS_MAP[newStatus]?.label}`, 'green')
      fetchDocDetail({ ...detailDoc, status: newStatus })
      fetch()
    } catch (err) { showToast(err.message, 'red') }
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

  const activeCycle = cycles.find(c => c.status === 'in_review' || c.status === 'open')
  const myReview = activeCycle ? reviewers.find(r => r.cycle_id === activeCycle.id && r.reviewer_id === profile?.id) : null

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
                  <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => fetchDocDetail(d)}>
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
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {can('projects.edit') && (
                          <Button size="sm" onClick={e => { e.stopPropagation(); openEdit(d) }} style={{ fontSize: '11px' }}>
                            <Icon name="edit" size={14} />
                          </Button>
                        )}
                        {can('projects.edit') && d.status !== 'superseded' && (
                          <Button size="sm" onClick={e => { e.stopPropagation(); handleRevise(d) }} style={{ fontSize: '11px' }} disabled={saving}>
                            <Icon name="history" size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── DOCUMENT DETAIL DRAWER ───────────────────────────── */}
      {detailDoc && (
        <ModalOverlay onClose={() => setDetailDoc(null)} dirty={false} style={{ justifyContent: 'flex-end' }}>
          <div style={{
            background: THEME.surface, width: '560px', maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', padding: '24px', boxShadow: THEME.shadow3,
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', color, fontWeight: 700, marginBottom: '4px' }}>{detailDoc.doc_number} · Rev {detailDoc.revision}</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginBottom: '6px' }}>{detailDoc.title}</div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {(() => { const s = STATUS_MAP[detailDoc.status] || STATUS_MAP.draft; return <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', background: s.bg, color: s.text }}>{s.label}</span> })()}
                  <span style={{ fontSize: '11px', color: THEME.textMed, textTransform: 'capitalize' }}>{detailDoc.doc_type?.replace('_', ' ')}</span>
                  {detailDoc.discipline && <span style={{ fontSize: '11px', color: THEME.textLow }}>· {detailDoc.discipline}</span>}
                </div>
              </div>
              <button onClick={() => setDetailDoc(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.textLow }}>close</span>
              </button>
            </div>

            {/* Action bar */}
            {can('projects.edit') && (
              <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {detailDoc.status === 'draft' && (
                  <button onClick={() => { setReviewForm({ reviewer_ids: [], due_date: '', notes: '' }); setReviewModal(true) }} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                    fontSize: '12px', fontWeight: 600, background: '#E65100', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>rate_review</span>
                    Send for Review
                  </button>
                )}
                {detailDoc.status === 'approved' && (
                  <button onClick={() => changeDocStatus(detailDoc.id, 'issued_for_construction')} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                    fontSize: '12px', fontWeight: 600, background: '#1565C0', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>construction</span>
                    Issue for Construction
                  </button>
                )}
                {detailDoc.status !== 'superseded' && (
                  <button onClick={() => handleRevise(detailDoc)} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                    fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed,
                    border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                  }} disabled={saving}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>history</span>
                    New Revision
                  </button>
                )}
              </div>
            )}

            {/* My pending review banner */}
            {myReview && myReview.status === 'pending' && (
              <div style={{ padding: '12px 16px', borderRadius: '10px', background: '#FFF3E0', border: '1px solid #FFB74D', marginBottom: '16px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#E65100', marginBottom: '8px' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>rate_review</span>
                  Your review is requested
                </div>
                <textarea placeholder="Add your review comment..." value={commentText} onChange={e => setCommentText(e.target.value)}
                  style={{ ...inp, fontSize: '12px', marginBottom: '8px', minHeight: '60px', resize: 'vertical' }} />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => { submitReview(activeCycle.id, 'approved', commentText); setCommentText('') }} style={{
                    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                    background: '#2E7D32', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '2px' }}>check</span>Approve
                  </button>
                  <button onClick={() => { submitReview(activeCycle.id, 'reviewed', commentText); setCommentText('') }} style={{
                    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                    background: '#1565C0', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '2px' }}>comment</span>Reviewed
                  </button>
                  <button onClick={() => { submitReview(activeCycle.id, 'rejected', commentText); setCommentText('') }} style={{
                    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                    background: '#C62828', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '2px' }}>close</span>Reject
                  </button>
                </div>
              </div>
            )}

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: `1px solid ${THEME.outlineVar}`, paddingBottom: '8px' }}>
              {[{ id: 'overview', label: 'Overview', icon: 'info' }, { id: 'reviews', label: 'Reviews', icon: 'rate_review' }, { id: 'comments', label: 'Comments', icon: 'chat' }].map(t => (
                <button key={t.id} onClick={() => setDetailTab(t.id)} style={{
                  display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                  fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: detailTab === t.id ? color : 'transparent', color: detailTab === t.id ? '#fff' : THEME.textMed,
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>{t.icon}</span>
                  {t.label}
                  {t.id === 'reviews' && cycles.length > 0 && <span style={{ fontSize: '10px', padding: '0 4px', borderRadius: '4px', background: detailTab === t.id ? 'rgba(255,255,255,0.3)' : THEME.outlineVar }}>{cycles.length}</span>}
                  {t.id === 'comments' && comments.length > 0 && <span style={{ fontSize: '10px', padding: '0 4px', borderRadius: '4px', background: detailTab === t.id ? 'rgba(255,255,255,0.3)' : THEME.outlineVar }}>{comments.length}</span>}
                </button>
              ))}
            </div>

            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</div>
            ) : (
              <>
                {/* Overview tab */}
                {detailTab === 'overview' && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      {[
                        ['Project', detailDoc.project?.name || '—'],
                        ['Area', detailDoc.area?.area_code?.code ? `${detailDoc.area.area_code.code} — ${detailDoc.area.area_code.name}` : '—'],
                        ['Type', (detailDoc.doc_type || '').replace('_', ' ')],
                        ['Discipline', detailDoc.discipline || '—'],
                        ['Revision', detailDoc.revision],
                        ['Created By', detailDoc.creator?.full_name || '—'],
                        ['Created', new Date(detailDoc.created_at).toLocaleDateString()],
                        ['Updated', detailDoc.updated_at ? new Date(detailDoc.updated_at).toLocaleDateString() : '—'],
                      ].map(([label, val]) => (
                        <div key={label}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>{label}</div>
                          <div style={{ fontSize: '13px', color: THEME.text, textTransform: 'capitalize' }}>{val}</div>
                        </div>
                      ))}
                    </div>
                    {detailDoc.notes && (
                      <div style={{ padding: '12px', background: THEME.surfaceVar, borderRadius: '8px', fontSize: '13px', color: THEME.textMed, lineHeight: 1.5 }}>{detailDoc.notes}</div>
                    )}

                    {/* Status workflow */}
                    {can('projects.edit') && (
                      <div style={{ marginTop: '16px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.textMed, marginBottom: '8px' }}>Change Status</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                          {Object.entries(STATUS_MAP).filter(([k]) => k !== detailDoc.status).map(([k, v]) => (
                            <button key={k} onClick={() => changeDocStatus(detailDoc.id, k)} style={{
                              padding: '5px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                              background: v.bg, color: v.text, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                            }}>{v.label}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Reviews tab */}
                {detailTab === 'reviews' && (
                  <div>
                    {cycles.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow, fontSize: '13px' }}>
                        No review cycles yet.
                        {can('projects.edit') && detailDoc.status === 'draft' && ' Send this document for review to start the first cycle.'}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {cycles.map(c => {
                          const cs = CYCLE_STATUS[c.status] || CYCLE_STATUS.open
                          const cycleReviewers = reviewers.filter(r => r.cycle_id === c.id)
                          return (
                            <div key={c.id} style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', overflow: 'hidden' }}>
                              <div style={{ padding: '12px 16px', background: THEME.surfaceVar, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <span style={{ fontSize: '13px', fontWeight: 700, color: THEME.text }}>Cycle {c.cycle_number}</span>
                                  <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: cs.bg, color: cs.text }}>{cs.label}</span>
                                  {c.due_date && <span style={{ marginLeft: '8px', fontSize: '11px', color: THEME.textLow }}>Due {c.due_date}</span>}
                                </div>
                                {can('projects.edit') && (c.status === 'in_review' || c.status === 'open') && (
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <button onClick={() => closeCycle(c.id, 'approved')} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: '#2E7D32', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Approve</button>
                                    <button onClick={() => closeCycle(c.id, 'rejected')} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: '#C62828', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Reject</button>
                                    <button onClick={() => closeCycle(c.id, 'cancelled')} style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                                  </div>
                                )}
                              </div>
                              <div style={{ padding: '12px 16px' }}>
                                {c.notes && <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>{c.notes}</div>}
                                {cycleReviewers.length === 0 ? (
                                  <div style={{ fontSize: '12px', color: THEME.textLow }}>No reviewers assigned.</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {cycleReviewers.map(r => {
                                      const rs = REVIEW_STATUS[r.status] || REVIEW_STATUS.pending
                                      return (
                                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', borderRadius: '8px', background: THEME.surfaceVar }}>
                                          <div style={{
                                            width: '28px', height: '28px', borderRadius: '50%',
                                            background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '10px', fontWeight: 700, flexShrink: 0,
                                          }}>{(r.reviewer?.full_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}</div>
                                          <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text }}>{r.reviewer?.full_name || 'Unknown'}</div>
                                            {r.comment && <div style={{ fontSize: '11px', color: THEME.textMed, marginTop: '2px' }}>{r.comment}</div>}
                                          </div>
                                          <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: rs.bg, color: rs.text }}>{rs.label}</span>
                                          {r.reviewed_at && <span style={{ fontSize: '10px', color: THEME.textLow }}>{new Date(r.reviewed_at).toLocaleDateString()}</span>}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Comments tab */}
                {detailTab === 'comments' && (
                  <div>
                    {/* Add comment */}
                    <div style={{ marginBottom: '16px' }}>
                      <textarea placeholder="Add a comment..." value={commentText} onChange={e => setCommentText(e.target.value)}
                        style={{ ...inp, fontSize: '13px', minHeight: '60px', resize: 'vertical', marginBottom: '6px' }} />
                      <button onClick={addComment} disabled={commentSaving || !commentText.trim()} style={{
                        padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                        background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        opacity: commentSaving || !commentText.trim() ? 0.5 : 1,
                      }}>{commentSaving ? 'Posting...' : 'Post Comment'}</button>
                    </div>

                    {comments.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '24px', color: THEME.textLow, fontSize: '13px' }}>No comments yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                        {comments.map(c => {
                          const typeIcon = { comment: 'chat', approval: 'check_circle', rejection: 'cancel', revision_request: 'edit', status_change: 'swap_horiz' }
                          const typeColor = { comment: THEME.textMed, approval: '#2E7D32', rejection: '#C62828', revision_request: '#E65100', status_change: '#1565C0' }
                          return (
                            <div key={c.id} style={{ display: 'flex', gap: '10px', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}`, opacity: c.is_resolved ? 0.5 : 1 }}>
                              <div style={{
                                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                                background: (typeColor[c.comment_type] || THEME.textMed) + '18',
                                color: typeColor[c.comment_type] || THEME.textMed,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>{typeIcon[c.comment_type] || 'chat'}</span>
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '12px', marginBottom: '2px' }}>
                                  <span style={{ fontWeight: 600, color: THEME.text }}>{c.author?.full_name || 'System'}</span>
                                  <span style={{ color: THEME.textLow, marginLeft: '8px', fontSize: '11px' }}>{new Date(c.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div style={{ fontSize: '13px', color: THEME.text, lineHeight: 1.4 }}>{c.comment}</div>
                                {!c.is_resolved && c.comment_type === 'comment' && can('projects.edit') && (
                                  <button onClick={() => resolveComment(c.id)} style={{
                                    marginTop: '4px', fontSize: '11px', color: THEME.textLow, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
                                  }}>Resolve</button>
                                )}
                                {c.is_resolved && <span style={{ fontSize: '10px', color: THEME.textLow }}>Resolved</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* ── START REVIEW MODAL ─────────────────────────────── */}
      {reviewModal && (
        <ModalOverlay onClose={() => setReviewModal(false)} dirty={true}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '480px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>Start Review Cycle</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '12px' }}>
              Select team members to review <strong>{detailDoc?.doc_number}</strong> Rev {detailDoc?.revision}
            </div>

            <div style={{ marginBottom: '14px' }}>
              <SectionLabel>Reviewers *</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                {members.filter(m => m.user_id !== profile?.id).map(m => {
                  const selected = reviewForm.reviewer_ids.includes(m.user_id)
                  return (
                    <div key={m.user_id} onClick={() => setReviewForm(f => ({
                      ...f, reviewer_ids: selected ? f.reviewer_ids.filter(id => id !== m.user_id) : [...f.reviewer_ids, m.user_id]
                    }))} style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px',
                      cursor: 'pointer', background: selected ? color + '12' : THEME.surfaceVar,
                      border: selected ? `1px solid ${color}40` : `1px solid transparent`,
                    }}>
                      <input type="checkbox" checked={selected} readOnly style={{ width: '16px', height: '16px', accentColor: color }} />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{m.user?.full_name || m.user?.username || 'Unknown'}</div>
                        <div style={{ fontSize: '11px', color: THEME.textLow }}>{m.role}</div>
                      </div>
                    </div>
                  )
                })}
                {members.filter(m => m.user_id !== profile?.id).length === 0 && (
                  <div style={{ fontSize: '12px', color: THEME.textLow, padding: '12px' }}>No team members found. Add members to the project first.</div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
              <div>
                <SectionLabel>Due Date</SectionLabel>
                <input type="date" style={inp} value={reviewForm.due_date} onChange={e => setReviewForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <SectionLabel>Notes</SectionLabel>
              <textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={reviewForm.notes} onChange={e => setReviewForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional instructions for reviewers..." />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setReviewModal(false)} style={{ padding: '8px 16px', borderRadius: '10px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>Cancel</button>
              <button onClick={startReviewCycle} disabled={reviewSaving} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: '#E65100', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, opacity: reviewSaving ? 0.6 : 1 }}>
                {reviewSaving ? 'Starting...' : `Start Review (${reviewForm.reviewer_ids.length})`}
              </button>
            </div>
          </div>
        </ModalOverlay>
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
