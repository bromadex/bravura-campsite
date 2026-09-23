import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import Denied from '../../components/Denied'
import DocumentViewer from '../../components/DocumentViewer'

const CATEGORIES = ['General','Policy','SOP','Manual','Certificate','Report','Contract','Drawing','Other']
const ALLOWED_TYPES = [
  'application/pdf',
  'image/png','image/jpeg','image/gif','image/webp','image/svg+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/acad','application/x-dwg','image/vnd.dwg',
  'text/plain','text/csv',
]
const MAX_FILE_SIZE = 10 * 1024 * 1024

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fileIcon(fileType) {
  if (!fileType) return 'description'
  if (fileType === 'application/pdf') return 'picture_as_pdf'
  if (fileType.startsWith('image/')) return 'image'
  if (fileType.includes('word') || fileType.includes('document')) return 'article'
  if (fileType.includes('sheet') || fileType.includes('excel')) return 'table_chart'
  if (fileType.includes('dwg') || fileType.includes('acad')) return 'architecture'
  return 'description'
}

function fileIconColor(fileType) {
  if (!fileType) return THEME.textLow
  if (fileType === 'application/pdf') return '#E53935'
  if (fileType.startsWith('image/')) return '#43A047'
  if (fileType.includes('word') || fileType.includes('document')) return '#1E88E5'
  if (fileType.includes('sheet') || fileType.includes('excel')) return '#2E7D32'
  if (fileType.includes('dwg') || fileType.includes('acad')) return '#F57C00'
  return THEME.textLow
}

export default function DocShareLibrary({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  if (!can('ds.view')) return <Denied />

  const [documents, setDocuments] = useState([])
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [currentFolderId, setCurrentFolderId] = useState(null)
  const [viewMode, setViewMode] = useState('grid')
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortDesc, setSortDesc] = useState(true)

  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState('General')
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [uploadDocMode, setUploadDocMode] = useState('general')
  const fileInputRef = useRef(null)

  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const [viewerDoc, setViewerDoc] = useState(null)
  const [viewerUrl, setViewerUrl] = useState(null)

  const [toast, setToast] = useState('')
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadDocuments = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [docRes, folderRes] = await Promise.all([
      supabase.from('ds_documents').select('*')
        .eq('site_id', currentSiteId).eq('is_archived', false)
        .order('updated_at', { ascending: false }),
      supabase.from('ds_folders').select('*')
        .eq('site_id', currentSiteId).eq('is_archived', false)
        .order('name'),
    ])
    if (docRes.data) setDocuments(docRes.data)
    if (folderRes.data) setFolders(folderRes.data)
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { loadDocuments() }, [loadDocuments])

  const breadcrumbs = useMemo(() => {
    const trail = [{ id: null, name: 'All Documents' }]
    if (!currentFolderId) return trail
    let fid = currentFolderId
    const visited = new Set()
    while (fid && !visited.has(fid)) {
      visited.add(fid)
      const f = folders.find(x => x.id === fid)
      if (f) { trail.push({ id: f.id, name: f.name }); fid = f.parent_id }
      else break
    }
    return trail.reverse()
  }, [currentFolderId, folders])

  const filteredDocs = useMemo(() => {
    let list = documents.filter(d => d.folder_id === currentFolderId)
    if (categoryFilter !== 'All') list = list.filter(d => d.category === categoryFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(d =>
        (d.title || '').toLowerCase().includes(q) ||
        (d.file_name || '').toLowerCase().includes(q) ||
        (d.description || '').toLowerCase().includes(q) ||
        (d.tags || []).some(t => t.toLowerCase().includes(q))
      )
    }
    list.sort((a, b) => {
      const va = a[sortBy], vb = b[sortBy]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (sortBy === 'file_size') return sortDesc ? vb - va : va - vb
      return sortDesc ? String(vb).localeCompare(String(va)) : String(va).localeCompare(String(vb))
    })
    return list
  }, [documents, currentFolderId, categoryFilter, searchQuery, sortBy, sortDesc])

  const currentSubFolders = useMemo(() =>
    folders.filter(f => f.parent_id === currentFolderId),
  [folders, currentFolderId])

  async function handleUpload() {
    if (!uploadFile) return showToast('Select a file')
    if (!uploadTitle.trim()) return showToast('Enter a title')
    if (uploadFile.size > MAX_FILE_SIZE) return showToast('File exceeds 10 MB limit')
    if (!ALLOWED_TYPES.includes(uploadFile.type) && uploadFile.type) {
      return showToast('File type not allowed')
    }
    setUploading(true)
    const fileId = crypto.randomUUID()
    const ext = uploadFile.name.split('.').pop()
    const path = `${currentSiteId}/${fileId}.${ext}`
    const { error: upErr } = await supabase.storage.from('docshare-files').upload(path, uploadFile)
    if (upErr) { setUploading(false); return showToast('Upload failed: ' + upErr.message) }
    const { error: dbErr } = await supabase.from('ds_documents').insert({
      site_id: currentSiteId,
      title: uploadTitle.trim(),
      description: uploadDescription.trim() || null,
      category: uploadCategory,
      doc_mode: uploadDocMode,
      folder_id: currentFolderId || null,
      file_path: path,
      file_name: uploadFile.name,
      file_size: uploadFile.size,
      file_type: uploadFile.type || null,
    })
    setUploading(false)
    if (dbErr) return showToast('Save failed: ' + dbErr.message)
    setShowUpload(false)
    setUploadTitle(''); setUploadDescription(''); setUploadFile(null)
    setUploadCategory('General'); setUploadDocMode('general')
    loadDocuments()
    showToast('Document uploaded')
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return
    const { error } = await supabase.from('ds_folders').insert({
      site_id: currentSiteId,
      name: newFolderName.trim(),
      parent_id: currentFolderId || null,
    })
    if (error) return showToast('Failed: ' + error.message)
    setShowNewFolder(false); setNewFolderName('')
    loadDocuments()
    showToast('Folder created')
  }

  async function handleArchiveDoc(doc) {
    if (!can('ds.delete')) return showToast('No permission')
    const { error } = await supabase.from('ds_documents').update({ is_archived: true }).eq('id', doc.id)
    if (error) return showToast('Failed: ' + error.message)
    loadDocuments()
    showToast('Document archived')
  }

  async function handleArchiveFolder(folder) {
    if (!can('ds.delete')) return showToast('No permission')
    const { error } = await supabase.from('ds_folders').update({ is_archived: true }).eq('id', folder.id)
    if (error) return showToast('Failed: ' + error.message)
    loadDocuments()
    showToast('Folder archived')
  }

  async function openViewer(doc) {
    const { data, error } = await supabase.storage.from('docshare-files').createSignedUrl(doc.file_path, 300)
    if (error || !data?.signedUrl) return showToast('Could not open file')
    setViewerDoc(doc)
    setViewerUrl(data.signedUrl)
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0]
    if (file) {
      setUploadFile(file)
      setUploadTitle(file.name.replace(/\.[^.]+$/, ''))
      setShowUpload(true)
    }
  }

  const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${THEME.outline}`, borderRadius: 6, background: THEME.surface, color: THEME.text }
  const labelStyle = { fontSize: 12, fontWeight: 600, color: THEME.text, marginBottom: 4, display: 'block' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}
      onDragOver={e => e.preventDefault()} onDrop={handleDrop}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text }}>Document Library</div>
          <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 2 }}>Upload, organize, and view documents</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('ds.create') && (
            <>
              <button onClick={() => setShowNewFolder(true)}
                style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: THEME.surfaceVariant, color: THEME.text, border: `1px solid ${THEME.outline}`, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>create_new_folder</span> New Folder
              </button>
              <button onClick={() => setShowUpload(true)}
                style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 16 }}>upload_file</span> Upload
              </button>
            </>
          )}
        </div>
      </div>

      {/* Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: THEME.textLow, marginBottom: 12, flexWrap: 'wrap' }}>
        {breadcrumbs.map((b, i) => (
          <span key={b.id || 'root'} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ color: THEME.outline }}>/</span>}
            <button onClick={() => setCurrentFolderId(b.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: i === breadcrumbs.length - 1 ? THEME.text : THEME.primary, fontWeight: i === breadcrumbs.length - 1 ? 600 : 400, fontSize: 12, padding: 0 }}>
              {b.name}
            </button>
          </span>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span className="material-symbols-rounded" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 18, color: THEME.textLow }}>search</span>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search documents..." style={{ ...inputStyle, paddingLeft: 34 }} />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          style={{ ...inputStyle, width: 140 }}>
          <option value="All">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{ display: 'flex', border: `1px solid ${THEME.outline}`, borderRadius: 6, overflow: 'hidden' }}>
          {['list','grid'].map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              style={{ padding: '6px 10px', background: viewMode === mode ? THEME.primary : THEME.surface, color: viewMode === mode ? '#fff' : THEME.textLow, border: 'none', cursor: 'pointer' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{mode === 'list' ? 'view_list' : 'grid_view'}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : (
        <>
          {viewMode === 'list' ? (
            <>
              {/* Sub-folders — list mode (Explorer-style large icons) */}
              {currentSubFolders.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginBottom: 16 }}>
                  {currentSubFolders.map(f => (
                    <div key={f.id}
                      onClick={() => setCurrentFolderId(f.id)}
                      style={{ position: 'relative', padding: '12px 8px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVariant}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <svg width="72" height="60" viewBox="0 0 72 60" fill="none">
                        <path d="M4 10C4 6.686 6.686 4 10 4H24L30 12H62C65.314 12 68 14.686 68 18V50C68 53.314 65.314 56 62 56H10C6.686 56 4 53.314 4 50V10Z" fill="#FFC107" />
                        <path d="M4 18H68V50C68 53.314 65.314 56 62 56H10C6.686 56 4 53.314 4 50V18Z" fill="#FFD54F" />
                        <path d="M4 18H68V22H4V18Z" fill="#FFCA28" opacity="0.5" />
                      </svg>
                      <div style={{ fontSize: 12, fontWeight: 500, color: THEME.text, textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px' }}>
                        {f.name}
                      </div>
                      {can('ds.delete') && (
                        <button onClick={e => { e.stopPropagation(); handleArchiveFolder(f) }}
                          style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: 2, opacity: 0.5 }} title="Archive folder">
                          <span className="material-symbols-rounded" style={{ fontSize: 14 }}>archive</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Documents — list mode */}
              <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: THEME.surfaceVariant }}>
                      {[{ key: 'title', label: 'Name' }, { key: 'category', label: 'Category' }, { key: 'file_size', label: 'Size' }, { key: 'updated_at', label: 'Modified' }].map(col => (
                        <th key={col.key} onClick={() => { setSortBy(col.key); setSortDesc(sortBy === col.key ? !sortDesc : true) }}
                          style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, cursor: 'pointer', borderBottom: `1px solid ${THEME.outline}`, whiteSpace: 'nowrap', userSelect: 'none' }}>
                          {col.label} {sortBy === col.key && (sortDesc ? '↓' : '↑')}
                        </th>
                      ))}
                      <th style={{ padding: '10px 12px', borderBottom: `1px solid ${THEME.outline}`, width: 80 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.length === 0 && (
                      <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: THEME.textLow }}>
                        {searchQuery ? 'No documents match your search' : 'No documents yet — upload one to get started'}
                      </td></tr>
                    )}
                    {filteredDocs.map(d => (
                      <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outline}`, cursor: 'pointer' }}
                        onClick={() => openViewer(d)}>
                        <td style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="material-symbols-rounded" style={{ fontSize: 20, color: fileIconColor(d.file_type) }}>{fileIcon(d.file_type)}</span>
                          <div>
                            <div style={{ fontWeight: 500, color: THEME.text }}>{d.title}</div>
                            <div style={{ fontSize: 11, color: THEME.textLow }}>{d.file_name}</div>
                          </div>
                          {d.doc_mode === 'controlled' && (
                            <span style={{ fontSize: 10, padding: '2px 6px', background: '#E3F2FD', color: '#1565C0', borderRadius: 4, fontWeight: 600 }}>CONTROLLED</span>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', color: THEME.textLow }}>{d.category || '—'}</td>
                        <td style={{ padding: '10px 12px', color: THEME.textLow, fontVariantNumeric: 'tabular-nums' }}>{formatBytes(d.file_size)}</td>
                        <td style={{ padding: '10px 12px', color: THEME.textLow }}>{formatDate(d.updated_at)}</td>
                        <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => openViewer(d)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.primary, padding: 2 }} title="View">
                              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>visibility</span>
                            </button>
                            {can('ds.delete') && (
                              <button onClick={() => handleArchiveDoc(d)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: 2 }} title="Archive">
                                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>archive</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
              {/* Folders — grid mode (Explorer-style large icons) */}
              {currentSubFolders.map(f => (
                  <div key={f.id}
                    onClick={() => setCurrentFolderId(f.id)}
                    style={{ position: 'relative', padding: '12px 8px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVariant}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <svg width="72" height="60" viewBox="0 0 72 60" fill="none">
                      <path d="M4 10C4 6.686 6.686 4 10 4H24L30 12H62C65.314 12 68 14.686 68 18V50C68 53.314 65.314 56 62 56H10C6.686 56 4 53.314 4 50V10Z" fill="#FFC107" />
                      <path d="M4 18H68V50C68 53.314 65.314 56 62 56H10C6.686 56 4 53.314 4 50V18Z" fill="#FFD54F" />
                      <path d="M4 18H68V22H4V18Z" fill="#FFCA28" opacity="0.5" />
                    </svg>
                    <div style={{ fontSize: 12, fontWeight: 500, color: THEME.text, textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px' }}>
                      {f.name}
                    </div>
                    {can('ds.delete') && (
                      <button onClick={e => { e.stopPropagation(); handleArchiveFolder(f) }}
                        style={{ position: 'absolute', top: 4, right: 4, background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: 2, opacity: 0.5 }} title="Archive folder">
                        <span className="material-symbols-rounded" style={{ fontSize: 14 }}>archive</span>
                      </button>
                    )}
                  </div>
                )
              )}

              {/* Documents — grid mode (Explorer-style file icons) */}
              {filteredDocs.map(d => (
                <div key={d.id} onClick={() => openViewer(d)}
                  style={{ position: 'relative', padding: '12px 8px 10px', borderRadius: 6, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVariant}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  {/* File icon — large page with colored type badge */}
                  <div style={{ position: 'relative', width: 72, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="56" height="60" viewBox="0 0 56 60" fill="none">
                      <path d="M4 4C4 1.79 5.79 0 8 0H34L52 18V56C52 58.21 50.21 60 48 60H8C5.79 60 4 58.21 4 56V4Z" fill="#E8E8E8" />
                      <path d="M34 0L52 18H38C35.79 18 34 16.21 34 14V0Z" fill="#BDBDBD" />
                    </svg>
                    <div style={{ position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)', background: fileIconColor(d.file_type), color: '#fff', fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.5px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                      {d.file_type === 'application/pdf' ? 'PDF'
                        : d.file_type?.startsWith('image/') ? 'IMG'
                        : (d.file_type?.includes('word') || d.file_type?.includes('document')) ? 'DOCX'
                        : (d.file_type?.includes('sheet') || d.file_type?.includes('excel')) ? 'XLS'
                        : (d.file_type?.includes('dwg') || d.file_type?.includes('acad')) ? 'DWG'
                        : d.file_name?.split('.').pop()?.toUpperCase()?.slice(0, 4) || 'FILE'}
                    </div>
                    {d.doc_mode === 'controlled' && (
                      <div style={{ position: 'absolute', top: 2, right: -4, background: '#1565C0', color: '#fff', fontSize: 7, fontWeight: 700, padding: '1px 4px', borderRadius: 3 }}>CTRL</div>
                    )}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: THEME.text, textAlign: 'center', width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '16px' }}>
                    {d.title}
                  </div>
                  <div style={{ fontSize: 10, color: THEME.textLow }}>{formatBytes(d.file_size)}</div>
                </div>
              ))}

              {currentSubFolders.length === 0 && filteredDocs.length === 0 && (
                <div style={{ gridColumn: '1 / -1', padding: 60, textAlign: 'center', color: THEME.textLow }}>
                  {searchQuery ? 'No documents match your search' : 'No documents yet — upload one to get started'}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
          onClick={() => !uploading && setShowUpload(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: THEME.surface, borderRadius: 12, padding: 24, width: '90%', maxWidth: 480, maxHeight: '80vh', overflow: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text, marginBottom: 16 }}>Upload Document</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>Title *</label>
                <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} style={inputStyle} placeholder="Document title" />
              </div>
              <div>
                <label style={labelStyle}>Description</label>
                <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Optional description" />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Category</label>
                  <select value={uploadCategory} onChange={e => setUploadCategory(e.target.value)} style={inputStyle}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Document Mode</label>
                  <select value={uploadDocMode} onChange={e => setUploadDocMode(e.target.value)} style={inputStyle}>
                    <option value="general">General</option>
                    <option value="controlled">Controlled</option>
                  </select>
                </div>
              </div>
              <div>
                <label style={labelStyle}>File *</label>
                <input ref={fileInputRef} type="file" onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) { setUploadFile(f); if (!uploadTitle.trim()) setUploadTitle(f.name.replace(/\.[^.]+$/, '')) }
                }} style={{ fontSize: 12, color: THEME.text }} />
                {uploadFile && <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 4 }}>{uploadFile.name} · {formatBytes(uploadFile.size)}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowUpload(false)} disabled={uploading}
                style={{ padding: '8px 16px', fontSize: 13, background: THEME.surfaceVariant, color: THEME.text, border: `1px solid ${THEME.outline}`, borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleUpload} disabled={uploading}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', opacity: uploading ? 0.6 : 1 }}>
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowNewFolder(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: THEME.surface, borderRadius: 12, padding: 24, width: '90%', maxWidth: 360 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>New Folder</div>
            <input value={newFolderName} onChange={e => setNewFolderName(e.target.value)} style={inputStyle}
              placeholder="Folder name" onKeyDown={e => e.key === 'Enter' && handleCreateFolder()} autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowNewFolder(false)}
                style={{ padding: '8px 16px', fontSize: 13, background: THEME.surfaceVariant, color: THEME.text, border: `1px solid ${THEME.outline}`, borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreateFolder}
                style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Document Viewer Overlay */}
      {viewerDoc && viewerUrl && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 1000, height: '85vh' }}>
            <DocumentViewer
              url={viewerUrl}
              fileName={viewerDoc.file_name}
              fileType={viewerDoc.file_type}
              title={viewerDoc.title}
              onClose={() => { setViewerDoc(null); setViewerUrl(null) }}
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
