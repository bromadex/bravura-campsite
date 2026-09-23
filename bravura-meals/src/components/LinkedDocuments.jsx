import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { THEME } from '../utils/permissions'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { useAuth } from '../auth/AuthContext'
import DocumentViewer from './DocumentViewer'

const FILE_ICONS = {
  'application/pdf': 'picture_as_pdf',
  'image/png': 'image', 'image/jpeg': 'image', 'image/gif': 'image', 'image/webp': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'description',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'table_chart',
  'application/vnd.ms-excel': 'table_chart',
}

function fileIcon(fileType) {
  return FILE_ICONS[fileType] || 'description'
}

function fileTypeBadge(fileType) {
  if (!fileType) return '?'
  if (fileType.includes('pdf')) return 'PDF'
  if (fileType.includes('image')) return 'IMG'
  if (fileType.includes('word') || fileType.includes('document')) return 'DOCX'
  if (fileType.includes('sheet') || fileType.includes('excel')) return 'XLSX'
  if (fileType.includes('dwg') || fileType.includes('acad')) return 'DWG'
  const ext = fileType.split('/').pop()
  return ext ? ext.toUpperCase().slice(0, 4) : '?'
}

export default function LinkedDocuments({ linkedTable, linkedId, canAttach }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewerDoc, setViewerDoc] = useState(null)
  const [viewerUrl, setViewerUrl] = useState(null)
  const [showAttach, setShowAttach] = useState(false)
  const [searchDocs, setSearchDocs] = useState([])
  const [searchQ, setSearchQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [attaching, setAttaching] = useState(false)

  const canView = can('ds.view')

  const fetchLinked = useCallback(async () => {
    if (!linkedTable || !linkedId || !currentSiteId || !canView) return
    setLoading(true)
    const { data } = await supabase
      .from('ds_document_links')
      .select('id, document_id, ds_documents(id, title, file_path, file_name, file_size, file_type, category)')
      .eq('linked_table', linkedTable)
      .eq('linked_id', linkedId)
    setDocs((data || []).filter(d => d.ds_documents && !d.ds_documents.is_archived))
    setLoading(false)
  }, [linkedTable, linkedId, currentSiteId, canView])

  useEffect(() => { fetchLinked() }, [fetchLinked])

  async function handleView(doc) {
    const d = doc.ds_documents || doc
    if (!d.file_path) return
    const { data } = await supabase.storage.from('docshare-files').createSignedUrl(d.file_path, 3600)
    if (data?.signedUrl) {
      setViewerDoc(d)
      setViewerUrl(data.signedUrl)
    }
  }

  async function handleSearch(q) {
    setSearchQ(q)
    if (!q || q.length < 2) { setSearchDocs([]); return }
    setSearching(true)
    const { data } = await supabase
      .from('ds_documents')
      .select('id, title, file_name, file_type, category')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .ilike('title', `%${q}%`)
      .limit(20)
    setSearchDocs(data || [])
    setSearching(false)
  }

  async function handleAttach(docId) {
    setAttaching(true)
    await supabase.from('ds_document_links').insert({
      document_id: docId,
      linked_table: linkedTable,
      linked_id: linkedId,
      created_by: profile?.id,
    })
    setAttaching(false)
    setShowAttach(false)
    setSearchQ('')
    setSearchDocs([])
    fetchLinked()
  }

  if (!canView) return null

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16, color: THEME.primary }}>folder_open</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.04em' }}>Linked Documents</span>
        </div>
        {canAttach && (
          <button
            onClick={() => setShowAttach(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px', borderRadius: 6, border: `1px solid ${THEME.outline}`,
              background: THEME.surface, cursor: 'pointer', fontSize: 11, fontWeight: 600,
              color: THEME.primary, fontFamily: 'inherit',
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>attach_file</span>
            Attach
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: THEME.textLow, padding: '8px 0' }}>Loading...</div>
      ) : docs.length === 0 ? (
        <div style={{ fontSize: 12, color: THEME.textLow, padding: '8px 0' }}>No documents linked.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {docs.map(link => {
            const d = link.ds_documents
            return (
              <div key={link.id} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                borderRadius: 6, border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: 18, color: THEME.primary }}>{fileIcon(d.file_type)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || d.file_name}</div>
                </div>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  background: THEME.surfaceVar, color: THEME.textMed, letterSpacing: '.03em',
                }}>{fileTypeBadge(d.file_type)}</span>
                <button
                  onClick={() => handleView(link)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3, padding: '3px 8px',
                    borderRadius: 4, border: 'none', background: THEME.primary,
                    color: THEME.onPrimary, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: 13 }}>visibility</span>
                  View
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Viewer overlay */}
      {viewerDoc && viewerUrl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
          onClick={() => { setViewerDoc(null); setViewerUrl(null) }}
        >
          <div style={{ width: '90vw', height: '85vh', maxWidth: 1200 }} onClick={e => e.stopPropagation()}>
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

      {/* Attach modal */}
      {showAttach && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9997,
          background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24,
        }}
          onClick={() => { setShowAttach(false); setSearchQ(''); setSearchDocs([]) }}
        >
          <div
            style={{
              background: THEME.surface, borderRadius: 12, width: 440, maxWidth: '95vw',
              maxHeight: '70vh', display: 'flex', flexDirection: 'column',
              boxShadow: THEME.shadow3, overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${THEME.outline}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: THEME.text }}>Attach Document</span>
              <button onClick={() => { setShowAttach(false); setSearchQ(''); setSearchDocs([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 20, color: THEME.textMed }}>close</span>
              </button>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <input
                autoFocus
                placeholder="Search documents by title..."
                value={searchQ}
                onChange={e => handleSearch(e.target.value)}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8,
                  border: `1px solid ${THEME.outline}`, background: THEME.surface,
                  color: THEME.text, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
                }}
              />
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 16px' }}>
              {searching && <div style={{ fontSize: 12, color: THEME.textLow, padding: 8 }}>Searching...</div>}
              {!searching && searchQ.length >= 2 && searchDocs.length === 0 && (
                <div style={{ fontSize: 12, color: THEME.textLow, padding: 8 }}>No documents found.</div>
              )}
              {searchDocs.map(d => {
                const alreadyLinked = docs.some(l => l.document_id === d.id)
                return (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px',
                    borderBottom: `1px solid ${THEME.outlineVar}`,
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: 18, color: THEME.primary }}>{fileIcon(d.file_type)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title || d.file_name}</div>
                      {d.category && <div style={{ fontSize: 11, color: THEME.textLow }}>{d.category}</div>}
                    </div>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: THEME.surfaceVar, color: THEME.textMed }}>{fileTypeBadge(d.file_type)}</span>
                    {alreadyLinked ? (
                      <span style={{ fontSize: 11, color: THEME.textLow, fontWeight: 600 }}>Linked</span>
                    ) : (
                      <button
                        disabled={attaching}
                        onClick={() => handleAttach(d.id)}
                        style={{
                          padding: '4px 10px', borderRadius: 6, border: 'none',
                          background: THEME.primary, color: THEME.onPrimary,
                          fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        Attach
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
