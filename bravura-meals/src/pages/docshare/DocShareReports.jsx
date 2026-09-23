import { useState, useEffect, useCallback } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import Denied from '../../components/Denied'
import { exportCsv } from '../../utils/csv'

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

export default function DocShareReports({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  if (!can('ds.view')) return <Denied />

  const [loading, setLoading] = useState(true)
  const [documents, setDocuments] = useState([])
  const [versions, setVersions] = useState([])
  const [acknowledgements, setAcknowledgements] = useState([])
  const [toast, setToast] = useState('')
  const [activeReport, setActiveReport] = useState('register')

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [docRes, verRes, ackRes] = await Promise.all([
      supabase.from('ds_documents').select('*')
        .eq('site_id', currentSiteId).eq('is_archived', false)
        .order('title'),
      supabase.from('ds_versions').select('*, ds_documents!inner(site_id)')
        .eq('ds_documents.site_id', currentSiteId)
        .order('created_at', { ascending: false }),
      supabase.from('ds_acknowledgements').select('*, ds_versions!inner(ds_documents!inner(site_id, title))')
        .eq('ds_versions.ds_documents.site_id', currentSiteId),
    ])
    if (docRes.data) setDocuments(docRes.data)
    if (verRes.data) setVersions(verRes.data)
    if (ackRes.data) setAcknowledgements(ackRes.data)
    else {
      // Fallback for nested filter
      const { data: fb } = await supabase.from('ds_acknowledgements').select('*, ds_versions(ds_documents(site_id, title))')
      if (fb) setAcknowledgements(fb.filter(a => a.ds_versions?.ds_documents?.site_id === currentSiteId))
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { loadData() }, [loadData])

  function exportDocumentRegister() {
    if (documents.length === 0) return showToast('No documents to export')
    const headers = ['Title', 'Category', 'Mode', 'File Name', 'File Size', 'Created', 'Updated']
    const rows = documents.map(d => [
      d.title, d.category || '', d.doc_mode || 'general', d.file_name || '',
      formatBytes(d.file_size), formatDate(d.created_at), formatDate(d.updated_at),
    ])
    exportCsv('document_register.csv', headers, rows)
    showToast('Document register exported')
  }

  function exportAcknowledgements() {
    if (acknowledgements.length === 0) return showToast('No acknowledgements to export')
    const headers = ['Document', 'User ID', 'Required By', 'Acknowledged At', 'Status']
    const rows = acknowledgements.map(a => [
      a.ds_versions?.ds_documents?.title || 'Unknown',
      a.user_id || '',
      formatDate(a.required_by),
      formatDate(a.acknowledged_at),
      a.acknowledged_at ? 'Completed' : 'Pending',
    ])
    exportCsv('acknowledgement_report.csv', headers, rows)
    showToast('Acknowledgement report exported')
  }

  // Storage usage by category
  const storageByCategory = {}
  documents.forEach(d => {
    const cat = d.category || 'Uncategorized'
    storageByCategory[cat] = (storageByCategory[cat] || 0) + (d.file_size || 0)
  })
  const storageRows = Object.entries(storageByCategory).sort((a, b) => b[1] - a[1])
  const totalStorage = documents.reduce((sum, d) => sum + (d.file_size || 0), 0)

  // Recent version activity
  const recentVersions = versions.slice(0, 20)

  // Acknowledgement summary by status
  const totalAcks = acknowledgements.length
  const completedAcks = acknowledgements.filter(a => a.acknowledged_at).length
  const pendingAcks = totalAcks - completedAcks
  const overdueAcks = acknowledgements.filter(a => !a.acknowledged_at && a.required_by && new Date(a.required_by) < new Date()).length

  const tabStyle = (key) => ({
    padding: '10px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: 'none', color: activeReport === key ? THEME.primary : THEME.textLow,
    borderBottom: activeReport === key ? `2px solid ${THEME.primary}` : '2px solid transparent',
    marginBottom: -2,
  })

  const cardStyle = { background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 8, padding: 20, marginBottom: 16 }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text }}>Document Reports</div>
        <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 2 }}>Export reports and review document activity</div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${THEME.outline}`, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => setActiveReport('register')} style={tabStyle('register')}>Document Register</button>
        <button onClick={() => setActiveReport('acknowledgements')} style={tabStyle('acknowledgements')}>Acknowledgements</button>
        <button onClick={() => setActiveReport('versions')} style={tabStyle('versions')}>Version History</button>
        <button onClick={() => setActiveReport('storage')} style={tabStyle('storage')}>Storage Usage</button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : (
        <>
          {/* Document Register */}
          {activeReport === 'register' && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text }}>Document Register</div>
                <button onClick={exportDocumentRegister}
                  style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>download</span> Export CSV
                </button>
              </div>
              <div style={{ fontSize: 12, color: THEME.textLow, marginBottom: 12 }}>{documents.length} document{documents.length !== 1 ? 's' : ''}</div>
              {documents.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: THEME.textLow, fontSize: 13 }}>No documents</div>
              ) : (
                <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: THEME.surfaceVar }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}`, whiteSpace: 'nowrap' }}>Title</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Category</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Mode</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Size</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.map(d => (
                        <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                          <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>{d.title}</td>
                          <td style={{ padding: '8px 12px', color: THEME.textLow }}>{d.category || '—'}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{ fontSize: 11, padding: '2px 6px', background: d.doc_mode === 'controlled' ? '#E3F2FD' : THEME.surfaceVar, color: d.doc_mode === 'controlled' ? '#1565C0' : THEME.textLow, borderRadius: 4, fontWeight: 600 }}>
                              {(d.doc_mode || 'general').toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textLow, fontVariantNumeric: 'tabular-nums' }}>{formatBytes(d.file_size)}</td>
                          <td style={{ padding: '8px 12px', color: THEME.textLow }}>{formatDate(d.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Acknowledgements */}
          {activeReport === 'acknowledgements' && (
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text }}>Acknowledgement Compliance</div>
                <button onClick={exportAcknowledgements}
                  style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 16 }}>download</span> Export CSV
                </button>
              </div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 12, color: THEME.textLow }}>
                  <span style={{ fontWeight: 600, color: THEME.text }}>Total:</span> {totalAcks}
                </div>
                <div style={{ fontSize: 12, color: THEME.success }}>
                  <span style={{ fontWeight: 600 }}>Completed:</span> {completedAcks}
                </div>
                <div style={{ fontSize: 12, color: THEME.warning }}>
                  <span style={{ fontWeight: 600 }}>Pending:</span> {pendingAcks}
                </div>
                <div style={{ fontSize: 12, color: THEME.error }}>
                  <span style={{ fontWeight: 600 }}>Overdue:</span> {overdueAcks}
                </div>
              </div>
              {totalAcks === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: THEME.textLow, fontSize: 13 }}>No acknowledgements recorded</div>
              ) : (
                <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: THEME.surfaceVar }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Document</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Required By</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Status</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Acknowledged</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acknowledgements.map(a => {
                        const isOverdue = !a.acknowledged_at && a.required_by && new Date(a.required_by) < new Date()
                        return (
                          <tr key={a.id} style={{ borderBottom: `1px solid ${THEME.outline}`, background: isOverdue ? THEME.statusErrorBg : 'transparent' }}>
                            <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>
                              {a.ds_versions?.ds_documents?.title || 'Unknown'}
                            </td>
                            <td style={{ padding: '8px 12px', color: THEME.textLow }}>{formatDate(a.required_by)}</td>
                            <td style={{ padding: '8px 12px' }}>
                              {a.acknowledged_at ? (
                                <span style={{ fontSize: 11, padding: '2px 8px', background: THEME.statusSuccessBg, color: THEME.statusSuccessText, borderRadius: 4, fontWeight: 600 }}>Completed</span>
                              ) : isOverdue ? (
                                <span style={{ fontSize: 11, padding: '2px 8px', background: THEME.statusErrorBg, color: THEME.statusErrorText, borderRadius: 4, fontWeight: 600 }}>Overdue</span>
                              ) : (
                                <span style={{ fontSize: 11, padding: '2px 8px', background: THEME.statusWarningBg, color: THEME.statusWarningText, borderRadius: 4, fontWeight: 600 }}>Pending</span>
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', color: THEME.textLow }}>{formatDate(a.acknowledged_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Version History */}
          {activeReport === 'versions' && (
            <div style={cardStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>Recent Version Activity</div>
              {recentVersions.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: THEME.textLow, fontSize: 13 }}>No version history</div>
              ) : (
                <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: THEME.surfaceVar }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>File</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Version</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Status</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Summary</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentVersions.map(v => (
                        <tr key={v.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                          <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>{v.file_name || '—'}</td>
                          <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 600 }}>v{v.version_number}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <span style={{
                              fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                              background: v.status === 'approved' ? THEME.statusSuccessBg : v.status === 'in_review' ? THEME.statusWarningBg : THEME.statusNeutralBg,
                              color: v.status === 'approved' ? THEME.statusSuccessText : v.status === 'in_review' ? THEME.statusWarningText : THEME.statusNeutralText,
                            }}>
                              {(v.status || 'draft').replace('_', ' ').toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '8px 12px', color: THEME.textLow, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {v.change_summary || '—'}
                          </td>
                          <td style={{ padding: '8px 12px', color: THEME.textLow }}>{formatDate(v.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Storage Usage */}
          {activeReport === 'storage' && (
            <div style={cardStyle}>
              <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>Storage Usage by Category</div>
              <div style={{ fontSize: 13, color: THEME.textLow, marginBottom: 12 }}>
                Total: <span style={{ fontWeight: 700, color: THEME.text }}>{formatBytes(totalStorage)}</span> across {documents.length} document{documents.length !== 1 ? 's' : ''}
              </div>
              {storageRows.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: THEME.textLow, fontSize: 13 }}>No storage data</div>
              ) : (
                <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: THEME.surfaceVar }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Category</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Size</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>% of Total</th>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }} />
                      </tr>
                    </thead>
                    <tbody>
                      {storageRows.map(([cat, bytes]) => {
                        const pct = totalStorage > 0 ? Math.round((bytes / totalStorage) * 100) : 0
                        return (
                          <tr key={cat} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                            <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>{cat}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{formatBytes(bytes)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textLow }}>{pct}%</td>
                            <td style={{ padding: '8px 12px', width: 120 }}>
                              <div style={{ height: 6, background: THEME.surfaceVar, borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: THEME.primary, borderRadius: 3 }} />
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
          )}
        </>
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
