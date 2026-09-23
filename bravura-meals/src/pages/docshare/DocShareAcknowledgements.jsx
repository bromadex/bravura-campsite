import { useState, useEffect, useCallback } from 'react'
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

function isOverdue(requiredBy) {
  if (!requiredBy) return false
  return new Date(requiredBy) < new Date()
}

function daysUntil(requiredBy) {
  if (!requiredBy) return null
  const diff = Math.ceil((new Date(requiredBy) - new Date()) / (1000 * 60 * 60 * 24))
  return diff
}

export default function DocShareAcknowledgements({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  if (!can('ds.view')) return <Denied />

  const [tab, setTab] = useState('pending')
  const [acks, setAcks] = useState([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState(null)
  const [toast, setToast] = useState('')
  const [viewerUrl, setViewerUrl] = useState(null)
  const [viewerFile, setViewerFile] = useState(null)

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.id) setUserId(data.user.id)
    })
  }, [])

  const loadAcks = useCallback(async () => {
    if (!userId || !currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('ds_acknowledgements')
      .select('*, ds_versions!inner(*, ds_documents!inner(*))')
      .eq('user_id', userId)
      .eq('ds_versions.ds_documents.site_id', currentSiteId)
      .order('created_at', { ascending: false })
    if (data) setAcks(data)
    if (error) {
      // Fallback: load without nested filter if PostgREST rejects the deep filter
      const { data: fallback } = await supabase
        .from('ds_acknowledgements')
        .select('*, ds_versions(*, ds_documents(*))')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (fallback) {
        setAcks(fallback.filter(a => a.ds_versions?.ds_documents?.site_id === currentSiteId))
      }
    }
    setLoading(false)
  }, [userId, currentSiteId])

  useEffect(() => { loadAcks() }, [loadAcks])

  const pending = acks.filter(a => !a.acknowledged_at)
  const completed = acks.filter(a => a.acknowledged_at)
  const displayed = tab === 'pending' ? pending : completed

  async function handleAcknowledge(ackId) {
    const { error } = await supabase.from('ds_acknowledgements')
      .update({ acknowledged_at: new Date().toISOString() })
      .eq('id', ackId)
    if (error) return showToast('Failed: ' + error.message)
    loadAcks()
    showToast('Document acknowledged')
  }

  async function openViewer(doc) {
    if (!doc?.file_path) return showToast('No file to view')
    const { data, error } = await supabase.storage.from('docshare-files').createSignedUrl(doc.file_path, 300)
    if (error || !data?.signedUrl) return showToast('Could not open file')
    setViewerUrl(data.signedUrl)
    setViewerFile(doc)
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text }}>My Acknowledgements</div>
        <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 2 }}>Documents requiring your review and acknowledgement</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${THEME.outline}`, marginBottom: 16 }}>
        {[
          { key: 'pending', label: 'Pending', count: pending.length },
          { key: 'completed', label: 'Completed', count: completed.length },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: 'none', color: tab === t.key ? THEME.primary : THEME.textLow,
              borderBottom: tab === t.key ? `2px solid ${THEME.primary}` : '2px solid transparent',
              marginBottom: -2,
            }}>
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : displayed.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow, fontSize: 13 }}>
          {tab === 'pending' ? 'No pending acknowledgements' : 'No completed acknowledgements'}
        </div>
      ) : (
        <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Document</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Version</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>
                  {tab === 'pending' ? 'Required By' : 'Acknowledged'}
                </th>
                <th style={{ padding: '10px 12px', borderBottom: `1px solid ${THEME.outline}`, width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {displayed.map(a => {
                const ver = a.ds_versions
                const doc = ver?.ds_documents
                const overdue = tab === 'pending' && isOverdue(a.required_by)
                const days = daysUntil(a.required_by)
                return (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${THEME.outline}`, background: overdue ? THEME.statusErrorBg : 'transparent' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={() => doc && openViewer(doc)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.primary, fontWeight: 500, fontSize: 13, padding: 0, textAlign: 'left' }}>
                        {doc?.title || 'Unknown Document'}
                      </button>
                      <div style={{ fontSize: 11, color: THEME.textLow }}>{doc?.category || ''}</div>
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.text, fontWeight: 600 }}>
                      v{ver?.version_number || '?'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {tab === 'pending' ? (
                        <div>
                          <div style={{ color: overdue ? THEME.statusErrorText : THEME.text, fontWeight: overdue ? 600 : 400 }}>
                            {formatDate(a.required_by)}
                          </div>
                          {overdue && <div style={{ fontSize: 11, color: THEME.statusErrorText, fontWeight: 600 }}>OVERDUE</div>}
                          {!overdue && days !== null && days <= 7 && (
                            <div style={{ fontSize: 11, color: THEME.statusWarningText }}>{days} day{days !== 1 ? 's' : ''} left</div>
                          )}
                        </div>
                      ) : (
                        <div style={{ color: THEME.textLow }}>{formatDate(a.acknowledged_at)}</div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => doc && openViewer(doc)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.primary, padding: 2 }} title="View">
                          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>visibility</span>
                        </button>
                        {tab === 'pending' && (
                          <button onClick={() => handleAcknowledge(a.id)}
                            style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                            Acknowledge
                          </button>
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

      {/* Document Viewer Overlay */}
      {viewerUrl && viewerFile && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 1000, height: '85vh' }}>
            <DocumentViewer
              url={viewerUrl}
              fileName={viewerFile.file_name}
              fileType={viewerFile.file_type}
              title={viewerFile.title || 'Document'}
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
