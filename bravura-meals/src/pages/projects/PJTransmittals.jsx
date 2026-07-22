import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, PageHeader, showToast, ModalOverlay } from '../../components/ui'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.projects

const METHODS = [
  { value: 'email', label: 'Email' },
  { value: 'portal', label: 'Portal' },
  { value: 'physical', label: 'Physical' },
  { value: 'courier', label: 'Courier' },
]

const STATUS_MAP = {
  draft: { label: 'Draft', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
  sent: { label: 'Sent', bg: '#E3F2FD', text: '#1565C0' },
  received: { label: 'Received', bg: '#FFF3E0', text: '#E65100' },
  acknowledged: { label: 'Acknowledged', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
}

export default function PJTransmittals({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const [transmittals, setTransmittals] = useState([])
  const [projects, setProjects] = useState([])
  const [projectDocs, setProjectDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  // Create/edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ project_id: '', transmittal_number: '', from_party: '', to_party: '', sent_date: '', method: 'email', status: 'draft', notes: '' })
  const [selectedDocs, setSelectedDocs] = useState([])
  const [saving, setSaving] = useState(false)

  // Detail drawer
  const [detailTx, setDetailTx] = useState(null)
  const [detailDocs, setDetailDocs] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [txRes, projRes] = await Promise.all([
        supabase.from('document_transmittals')
          .select('*, project:projects!document_transmittals_project_id_fkey(name, project_code, site_id), creator:profiles!document_transmittals_created_by_fkey(full_name)')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('projects').select('id, name, project_code').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
      ])
      if (txRes.error) throw txRes.error
      setTransmittals((txRes.data || []).filter(t => t.project?.site_id === currentSiteId))
      setProjects(projRes.data || [])
    } catch (err) {
      showToast('Failed to load transmittals', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetchAll() }, [currentSiteId, fetchAll])

  async function fetchProjectDocs(projectId) {
    if (!projectId) { setProjectDocs([]); return }
    const { data } = await supabase.from('project_documents')
      .select('id, doc_number, title, revision, status')
      .eq('project_id', projectId).eq('is_archived', false)
      .order('doc_number')
    setProjectDocs(data || [])
  }

  async function fetchDetail(tx) {
    setDetailTx(tx)
    setDetailLoading(true)
    const { data } = await supabase.from('transmittal_documents')
      .select('document_id, document:project_documents!transmittal_documents_document_id_fkey(id, doc_number, title, revision, status)')
      .eq('transmittal_id', tx.id)
    setDetailDocs((data || []).map(d => d.document).filter(Boolean))
    setDetailLoading(false)
  }

  const filtered = useMemo(() => {
    let list = transmittals
    if (filterProject) list = list.filter(t => t.project_id === filterProject)
    if (filterStatus) list = list.filter(t => t.status === filterStatus)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        t.transmittal_number.toLowerCase().includes(q) ||
        (t.to_party || '').toLowerCase().includes(q) ||
        (t.from_party || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [transmittals, search, filterProject, filterStatus])

  function openNew() {
    setEditId(null)
    const nextNum = `TX-${String(transmittals.length + 1).padStart(4, '0')}`
    setForm({ project_id: filterProject || '', transmittal_number: nextNum, from_party: 'Bravura Mining', to_party: '', sent_date: new Date().toISOString().slice(0, 10), method: 'email', status: 'draft', notes: '' })
    setSelectedDocs([])
    setProjectDocs([])
    if (filterProject) fetchProjectDocs(filterProject)
    setModalOpen(true)
  }

  function openEdit(tx) {
    setEditId(tx.id)
    setForm({
      project_id: tx.project_id, transmittal_number: tx.transmittal_number,
      from_party: tx.from_party || '', to_party: tx.to_party || '',
      sent_date: tx.sent_date || '', method: tx.method || 'email',
      status: tx.status, notes: tx.notes || '',
    })
    fetchProjectDocs(tx.project_id)
    supabase.from('transmittal_documents').select('document_id').eq('transmittal_id', tx.id)
      .then(({ data }) => setSelectedDocs((data || []).map(d => d.document_id)))
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.project_id || !form.transmittal_number.trim() || !form.to_party.trim()) {
      showToast('Project, transmittal number, and recipient are required', 'red'); return
    }
    setSaving(true)
    try {
      const payload = {
        project_id: form.project_id,
        transmittal_number: form.transmittal_number.trim().toUpperCase(),
        from_party: form.from_party.trim() || null,
        to_party: form.to_party.trim(),
        sent_date: form.sent_date || null,
        method: form.method,
        status: form.status,
        notes: form.notes.trim() || null,
      }
      let txId = editId
      if (editId) {
        const { error } = await supabase.from('document_transmittals').update(payload).eq('id', editId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('document_transmittals').insert({ ...payload, created_by: profile?.id }).select().single()
        if (error) throw error
        txId = data.id
      }

      // Sync junction table
      await supabase.from('transmittal_documents').delete().eq('transmittal_id', txId)
      if (selectedDocs.length > 0) {
        const { error: jErr } = await supabase.from('transmittal_documents').insert(
          selectedDocs.map(docId => ({ transmittal_id: txId, document_id: docId }))
        )
        if (jErr) throw jErr
      }

      showToast(editId ? 'Transmittal updated' : 'Transmittal created', 'green')
      setModalOpen(false)
      fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function changeStatus(txId, newStatus) {
    try {
      await supabase.from('document_transmittals').update({ status: newStatus }).eq('id', txId)
      showToast(`Status changed to ${STATUS_MAP[newStatus]?.label}`, 'green')
      fetchAll()
      if (detailTx?.id === txId) setDetailTx(prev => ({ ...prev, status: newStatus }))
    } catch (err) { showToast(err.message, 'red') }
  }

  function handleExport() {
    exportCsv('transmittals.csv',
      ['Transmittal #', 'Project', 'From', 'To', 'Method', 'Sent Date', 'Status', 'Created By'],
      filtered.map(t => [
        t.transmittal_number, t.project?.project_code || '', t.from_party || '',
        t.to_party || '', t.method || '', t.sent_date || '', t.status,
        t.creator?.full_name || '',
      ]))
  }

  if (!can('projects.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  const statusCounts = useMemo(() => {
    const c = { draft: 0, sent: 0, received: 0, acknowledged: 0 }
    transmittals.forEach(t => { if (c[t.status] !== undefined) c[t.status]++ })
    return c
  }, [transmittals])

  const DOC_STATUS = {
    draft: { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
    issued_for_review: { bg: '#FFF3E0', text: '#E65100' },
    issued_for_construction: { bg: '#E3F2FD', text: '#1565C0' },
    approved: { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
    superseded: { bg: THEME.statusErrorBg, text: THEME.statusErrorText },
  }

  return (
    <div>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_transmittals" />
      <PageHeader title="Transmittals" site={currentSite} actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button icon="download" onClick={handleExport}>Export</Button>
          {can('projects.edit') && <Button icon="add" variant="filled" onClick={openNew}>New Transmittal</Button>}
        </div>
      } />

      {/* Status pills */}
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

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search transmittals..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ ...inp, maxWidth: '200px' }}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} transmittals</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '48px' }}>
          <Icon name="send" size={40} style={{ color: THEME.outline }} />
          <div style={{ marginTop: '12px', color: THEME.textMed, fontSize: '14px' }}>No transmittals found.</div>
        </Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Transmittal #', 'Project', 'From', 'To', 'Method', 'Sent', 'Status', 'By', ''].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                const s = STATUS_MAP[tx.status] || STATUS_MAP.draft
                return (
                  <tr key={tx.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => fetchDetail(tx)}>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color, fontWeight: 700 }}>{tx.transmittal_number}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{tx.project?.project_code || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.text, fontSize: '12px' }}>{tx.from_party || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.text, fontSize: '12px', fontWeight: 600 }}>{tx.to_party || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px', textTransform: 'capitalize' }}>{tx.method}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px', whiteSpace: 'nowrap' }}>{tx.sent_date || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: s.bg, color: s.text }}>{s.label}</span>
                    </td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{tx.creator?.full_name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {can('projects.edit') && (
                        <Button size="sm" onClick={e => { e.stopPropagation(); openEdit(tx) }} style={{ fontSize: '11px' }}>
                          <Icon name="edit" size={14} />
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

      {/* ── DETAIL DRAWER ────────────────────────────────── */}
      {detailTx && (
        <ModalOverlay onClose={() => setDetailTx(null)} dirty={false} style={{ justifyContent: 'flex-end' }}>
          <div style={{
            background: THEME.surface, width: '520px', maxWidth: '95vw', height: '100vh',
            overflowY: 'auto', padding: '24px', boxShadow: THEME.shadow3,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', color, fontWeight: 700, marginBottom: '4px' }}>{detailTx.transmittal_number}</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginBottom: '6px' }}>
                  {detailTx.from_party || '—'} → {detailTx.to_party || '—'}
                </div>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  {(() => { const s = STATUS_MAP[detailTx.status] || STATUS_MAP.draft; return <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', background: s.bg, color: s.text }}>{s.label}</span> })()}
                  <span style={{ fontSize: '11px', color: THEME.textMed, textTransform: 'capitalize' }}>{detailTx.method}</span>
                  {detailTx.sent_date && <span style={{ fontSize: '11px', color: THEME.textLow }}>· Sent {detailTx.sent_date}</span>}
                </div>
              </div>
              <button onClick={() => setDetailTx(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.textLow }}>close</span>
              </button>
            </div>

            {/* Status actions */}
            {can('projects.edit') && (
              <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {detailTx.status === 'draft' && (
                  <button onClick={() => changeStatus(detailTx.id, 'sent')} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                    fontSize: '12px', fontWeight: 600, background: '#1565C0', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>send</span>Mark as Sent
                  </button>
                )}
                {detailTx.status === 'sent' && (
                  <button onClick={() => changeStatus(detailTx.id, 'received')} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                    fontSize: '12px', fontWeight: 600, background: '#E65100', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>mark_email_read</span>Mark as Received
                  </button>
                )}
                {(detailTx.status === 'sent' || detailTx.status === 'received') && (
                  <button onClick={() => changeStatus(detailTx.id, 'acknowledged')} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                    fontSize: '12px', fontWeight: 600, background: '#2E7D32', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>verified</span>Acknowledge
                  </button>
                )}
                <button onClick={() => openEdit(detailTx)} style={{
                  display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                  fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>edit</span>Edit
                </button>
              </div>
            )}

            {/* Metadata */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              {[
                ['Project', detailTx.project?.name || '—'],
                ['Method', detailTx.method || '—'],
                ['Created By', detailTx.creator?.full_name || '—'],
                ['Created', new Date(detailTx.created_at).toLocaleDateString()],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>{label}</div>
                  <div style={{ fontSize: '13px', color: THEME.text, textTransform: 'capitalize' }}>{val}</div>
                </div>
              ))}
            </div>

            {detailTx.notes && (
              <div style={{ padding: '12px', background: THEME.surfaceVar, borderRadius: '8px', fontSize: '13px', color: THEME.textMed, lineHeight: 1.5, marginBottom: '16px' }}>{detailTx.notes}</div>
            )}

            {/* Attached documents */}
            <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>description</span>
              Attached Documents ({detailDocs.length})
            </div>

            {detailLoading ? (
              <div style={{ textAlign: 'center', padding: '20px', color: THEME.textMed }}>Loading...</div>
            ) : detailDocs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: THEME.textLow, fontSize: '13px', background: THEME.surfaceVar, borderRadius: '10px' }}>No documents attached.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {detailDocs.map(doc => {
                  const ds = DOC_STATUS[doc.status] || DOC_STATUS.draft
                  return (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '10px', background: THEME.surfaceVar }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '18px', color }}>description</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text }}>{doc.doc_number}</div>
                        <div style={{ fontSize: '11px', color: THEME.textMed }}>{doc.title}</div>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: THEME.text }}>Rev {doc.revision}</span>
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: ds.bg, color: ds.text }}>{doc.status?.replace(/_/g, ' ')}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </ModalOverlay>
      )}

      {/* ── CREATE/EDIT MODAL ─────────────────────────────── */}
      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '560px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>{editId ? 'Edit Transmittal' : 'New Transmittal'}</div>

            <div style={fieldWrap}><label style={lbl}>Project *</label>
              <select style={inp} value={form.project_id} onChange={e => { setForm(f => ({ ...f, project_id: e.target.value })); fetchProjectDocs(e.target.value); setSelectedDocs([]) }}>
                <option value="">— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.project_code} — {p.name}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
              <div style={fieldWrap}><label style={lbl}>Transmittal # *</label>
                <input style={{ ...inp, textTransform: 'uppercase' }} value={form.transmittal_number} onChange={e => setForm(f => ({ ...f, transmittal_number: e.target.value }))} />
              </div>
              <div style={fieldWrap}><label style={lbl}>Method</label>
                <select style={inp} value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))}>
                  {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div style={fieldWrap}><label style={lbl}>From</label>
                <input style={inp} value={form.from_party} onChange={e => setForm(f => ({ ...f, from_party: e.target.value }))} placeholder="Bravura Mining" />
              </div>
              <div style={fieldWrap}><label style={lbl}>To *</label>
                <input style={inp} value={form.to_party} onChange={e => setForm(f => ({ ...f, to_party: e.target.value }))} placeholder="Contractor / Client name" />
              </div>
              <div style={fieldWrap}><label style={lbl}>Sent Date</label>
                <input type="date" style={inp} value={form.sent_date} onChange={e => setForm(f => ({ ...f, sent_date: e.target.value }))} />
              </div>
              <div style={fieldWrap}><label style={lbl}>Status</label>
                <select style={inp} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>

            <div style={fieldWrap}><label style={lbl}>Notes</label>
              <textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            {/* Document selector */}
            <div style={fieldWrap}>
              <label style={lbl}>Attach Documents ({selectedDocs.length} selected)</label>
              {!form.project_id ? (
                <div style={{ fontSize: '12px', color: THEME.textLow, padding: '12px', background: THEME.surfaceVar, borderRadius: '8px' }}>Select a project first to see available documents.</div>
              ) : projectDocs.length === 0 ? (
                <div style={{ fontSize: '12px', color: THEME.textLow, padding: '12px', background: THEME.surfaceVar, borderRadius: '8px' }}>No documents found for this project.</div>
              ) : (
                <div style={{ maxHeight: '200px', overflowY: 'auto', border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px' }}>
                  {projectDocs.map(doc => {
                    const sel = selectedDocs.includes(doc.id)
                    const ds = DOC_STATUS[doc.status] || DOC_STATUS.draft
                    return (
                      <div key={doc.id} onClick={() => setSelectedDocs(prev => sel ? prev.filter(id => id !== doc.id) : [...prev, doc.id])} style={{
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                        cursor: 'pointer', borderBottom: `1px solid ${THEME.outlineVar}`,
                        background: sel ? color + '08' : 'transparent',
                      }}>
                        <input type="checkbox" checked={sel} readOnly style={{ width: '16px', height: '16px', accentColor: color }} />
                        <div style={{ flex: 1 }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, fontFamily: 'monospace' }}>{doc.doc_number}</span>
                          <span style={{ fontSize: '12px', color: THEME.textMed, marginLeft: '8px' }}>{doc.title}</span>
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: THEME.textLow }}>Rev {doc.revision}</span>
                        <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: ds.bg, color: ds.text }}>{doc.status?.replace(/_/g, ' ')}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
              <button onClick={() => setModalOpen(false)} style={{ padding: '8px 16px', borderRadius: '10px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: color, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
