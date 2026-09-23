import { useState, useEffect, useCallback, useRef } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import Denied from '../../components/Denied'
import DocumentViewer from '../../components/DocumentViewer'

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const STATUS_STYLES = {
  draft: { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Draft' },
  in_review: { bg: THEME.statusWarningBg, color: THEME.statusWarningText, label: 'In Review' },
  approved: { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Approved' },
  superseded: { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Superseded' },
}

export default function DocShareDetail({ setPage, docId }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  if (!can('ds.view')) return <Denied />

  const [doc, setDoc] = useState(null)
  const [versions, setVersions] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [viewerUrl, setViewerUrl] = useState(null)
  const [viewerFile, setViewerFile] = useState(null)
  const [showUploadVersion, setShowUploadVersion] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [changeSummary, setChangeSummary] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [reviewComment, setReviewComment] = useState('')
  const fileInputRef = useRef(null)

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadData = useCallback(async () => {
    if (!docId || !currentSiteId) return
    setLoading(true)
    const [docRes, verRes] = await Promise.all([
      supabase.from('ds_documents').select('*')
        .eq('id', docId).eq('site_id', currentSiteId).maybeSingle(),
      supabase.from('ds_versions').select('*')
        .eq('document_id', docId)
        .order('version_number', { ascending: false }),
    ])
    if (docRes.data) setDoc(docRes.data)
    if (verRes.data) setVersions(verRes.data)
    setLoading(false)
  }, [docId, currentSiteId])

  useEffect(() => { loadData() }, [loadData])

  async function openViewer(filePath, fileName, fileType) {
    const { data, error } = await supabase.storage.from('docshare-files').createSignedUrl(filePath, 300)
    if (error || !data?.signedUrl) return showToast('Could not open file')
    setViewerUrl(data.signedUrl)
    setViewerFile({ file_name: fileName, file_type: fileType })
  }

  async function handleUploadVersion() {
    if (!uploadFile) return showToast('Select a file')
    if (!changeSummary.trim()) return showToast('Enter a change summary')
    setUploading(true)
    const fileId = crypto.randomUUID()
    const ext = uploadFile.name.split('.').pop()
    const path = `${currentSiteId}/${fileId}.${ext}`
    const { error: upErr } = await supabase.storage.from('docshare-files').upload(path, uploadFile)
    if (upErr) { setUploading(false); return showToast('Upload failed: ' + upErr.message) }
    const nextVersion = versions.length > 0 ? Math.max(...versions.map(v => v.version_number)) + 1 : 1
    const { error: dbErr } = await supabase.from('ds_versions').insert({
      document_id: docId,
      version_number: nextVersion,
      file_path: path,
      file_name: uploadFile.name,
      file_size: uploadFile.size,
      change_summary: changeSummary.trim(),
      status: 'draft',
    })
    setUploading(false)
    if (dbErr) return showToast('Save failed: ' + dbErr.message)
    setShowUploadVersion(false)
    setChangeSummary('')
    setUploadFile(null)
    loadData()
    showToast('New version uploaded')
  }

  async function handleReview(versionId, action) {
    if (!can('ds.approve')) return showToast('No permission')
    if (action === 'approved') {
      // Supersede previous approved versions
      const prev = versions.filter(v => v.status === 'approved')
      for (const p of prev) {
        await supabase.from('ds_versions').update({ status: 'superseded' }).eq('id', p.id)
      }
    }
    const update = { status: action }
    if (action === 'approved') update.approved_at = new Date().toISOString()
    const { error } = await supabase.from('ds_versions').update(update).eq('id', versionId)
    if (error) return showToast('Failed: ' + error.message)
    setReviewComment('')
    loadData()
    showToast(action === 'approved' ? 'Version approved' : 'Version rejected')
  }

  const currentApproved = versions.find(v => v.status === 'approved')
  const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${THEME.outline}`, borderRadius: 6, background: THEME.surface, color: THEME.text }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: THEME.text, marginBottom: 4, display: 'block' }

  if (!docId) {
    return (
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>No document selected.</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => setPage('ds_library')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.primary, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: 0 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span> Back
          </button>
        </div>
        {can('ds.create') && doc?.doc_mode === 'controlled' && (
          <button onClick={() => setShowUploadVersion(true)}
            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>upload_file</span> Upload New Version
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : !doc ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>Document not found.</div>
      ) : (
        <>
          {/* Document Info */}
          <div style={{ background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: THEME.text }}>{doc.title}</div>
              <span style={{ fontSize: 10, padding: '2px 8px', background: doc.doc_mode === 'controlled' ? '#E3F2FD' : THEME.surfaceVar, color: doc.doc_mode === 'controlled' ? '#1565C0' : THEME.textLow, borderRadius: 4, fontWeight: 600, textTransform: 'uppercase' }}>
                {doc.doc_mode}
              </span>
            </div>
            {doc.description && <div style={{ fontSize: 13, color: THEME.textLow, marginBottom: 12 }}>{doc.description}</div>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: THEME.textLow }}>
              <div><span style={{ fontWeight: 600, color: THEME.text }}>Category:</span> {doc.category || '—'}</div>
              <div><span style={{ fontWeight: 600, color: THEME.text }}>File:</span> {doc.file_name}</div>
              <div><span style={{ fontWeight: 600, color: THEME.text }}>Size:</span> {formatBytes(doc.file_size)}</div>
              <div><span style={{ fontWeight: 600, color: THEME.text }}>Created:</span> {formatDate(doc.created_at)}</div>
              {doc.tags?.length > 0 && (
                <div><span style={{ fontWeight: 600, color: THEME.text }}>Tags:</span> {doc.tags.join(', ')}</div>
              )}
            </div>
            {/* View original file */}
            <button onClick={() => openViewer(doc.file_path, doc.file_name, doc.file_type)}
              style={{ marginTop: 12, padding: '6px 14px', fontSize: 12, fontWeight: 600, background: THEME.surfaceVar, color: THEME.primary, border: `1px solid ${THEME.outline}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16 }}>visibility</span> View Original
            </button>
          </div>

          {/* Current Approved Version */}
          {currentApproved && (
            <div style={{ background: THEME.statusSuccessBg, border: `1px solid ${THEME.outline}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: THEME.statusSuccessText, marginBottom: 6 }}>
                Current Approved Version: v{currentApproved.version_number}
              </div>
              <div style={{ fontSize: 12, color: THEME.textLow }}>{currentApproved.change_summary || 'No summary'}</div>
              <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 4 }}>
                Approved {formatDate(currentApproved.approved_at)} | File: {currentApproved.file_name}
              </div>
              <button onClick={() => openViewer(currentApproved.file_path, currentApproved.file_name, doc.file_type)}
                style={{ marginTop: 8, padding: '6px 12px', fontSize: 12, background: THEME.surface, color: THEME.primary, border: `1px solid ${THEME.outline}`, borderRadius: 6, cursor: 'pointer' }}>
                View
              </button>
            </div>
          )}

          {/* Version History */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 10 }}>Version History</div>
            {versions.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: THEME.textLow, fontSize: 13 }}>No versions yet. Upload the first version to begin.</div>
            ) : (
              <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: THEME.surfaceVar }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Version</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Status</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Summary</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Date</th>
                      <th style={{ padding: '10px 12px', borderBottom: `1px solid ${THEME.outline}`, width: 120 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map(v => {
                      const st = STATUS_STYLES[v.status] || STATUS_STYLES.draft
                      return (
                        <tr key={v.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>v{v.version_number}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ fontSize: 11, padding: '2px 8px', background: st.bg, color: st.color, borderRadius: 4, fontWeight: 600 }}>{st.label}</span>
                          </td>
                          <td style={{ padding: '10px 12px', color: THEME.textLow, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v.change_summary || '—'}
                          </td>
                          <td style={{ padding: '10px 12px', color: THEME.textLow }}>{formatDate(v.created_at)}</td>
                          <td style={{ padding: '10px 12px' }}>
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              <button onClick={() => openViewer(v.file_path, v.file_name, doc.file_type)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.primary, padding: 2, fontSize: 12, display: 'flex', alignItems: 'center', gap: 2 }}>
                                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>visibility</span>
                              </button>
                              {can('ds.approve') && v.status === 'in_review' && (
                                <>
                                  <button onClick={() => handleReview(v.id, 'approved')}
                                    style={{ padding: '3px 8px', fontSize: 11, fontWeight: 600, background: THEME.success, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                                    Approve
                                  </button>
                                  <button onClick={() => handleReview(v.id, 'draft')}
                                    style={{ padding: '3px 8px', fontSize: 11, fontWeight: 600, background: THEME.error, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Upload New Version Modal */}
      {showUploadVersion && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
          onClick={() => !uploading && setShowUploadVersion(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: THEME.surface, borderRadius: 12, padding: 24, width: '90%', maxWidth: 480 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text, marginBottom: 16 }}>Upload New Version</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>File *</label>
                <input ref={fileInputRef} type="file" onChange={e => setUploadFile(e.target.files?.[0] || null)}
                  style={{ fontSize: 12, color: THEME.text }} />
              </div>
              <div>
                <label style={labelStyle}>Change Summary *</label>
                <textarea value={changeSummary} onChange={e => setChangeSummary(e.target.value)}
                  rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="What changed in this version?" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowUploadVersion(false)} disabled={uploading}
                style={{ padding: '8px 16px', fontSize: 13, background: THEME.surfaceVar, color: THEME.text, border: `1px solid ${THEME.outline}`, borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleUploadVersion} disabled={uploading}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Document Viewer Overlay */}
      {viewerUrl && viewerFile && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 1000, height: '85vh' }}>
            <DocumentViewer
              url={viewerUrl}
              fileName={viewerFile.file_name}
              fileType={viewerFile.file_type}
              title={doc?.title || 'Document'}
              onClose={() => { setViewerUrl(null); setViewerFile(null) }}
            />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#333', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
