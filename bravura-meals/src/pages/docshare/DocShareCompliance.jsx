import { useState, useEffect, useCallback } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import Denied from '../../components/Denied'

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function daysUntil(d) {
  if (!d) return null
  return Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24))
}

export default function DocShareCompliance({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  if (!can('ds.view')) return <Denied />

  const [loading, setLoading] = useState(true)
  const [documents, setDocuments] = useState([])
  const [versions, setVersions] = useState([])
  const [acknowledgements, setAcknowledgements] = useState([])
  const [expiryRules, setExpiryRules] = useState([])

  const loadData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [docRes, verRes, ackRes, expRes] = await Promise.all([
      supabase.from('ds_documents').select('*')
        .eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('ds_versions').select('*, ds_documents!inner(site_id)')
        .eq('ds_documents.site_id', currentSiteId),
      supabase.from('ds_acknowledgements').select('*, ds_versions!inner(ds_documents!inner(site_id))')
        .eq('ds_versions.ds_documents.site_id', currentSiteId),
      supabase.from('ds_expiry_rules').select('*, ds_documents!inner(site_id, title, category)')
        .eq('ds_documents.site_id', currentSiteId),
    ])
    if (docRes.data) setDocuments(docRes.data)
    if (verRes.data) setVersions(verRes.data)
    // If nested filter fails, fallback
    if (ackRes.data) setAcknowledgements(ackRes.data)
    else {
      const { data: fb } = await supabase.from('ds_acknowledgements').select('*, ds_versions(ds_documents(site_id))')
      if (fb) setAcknowledgements(fb.filter(a => a.ds_versions?.ds_documents?.site_id === currentSiteId))
    }
    if (expRes.data) setExpiryRules(expRes.data)
    else {
      const { data: fb2 } = await supabase.from('ds_expiry_rules').select('*, ds_documents(site_id, title, category)')
      if (fb2) setExpiryRules(fb2.filter(e => e.ds_documents?.site_id === currentSiteId))
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { loadData() }, [loadData])

  // KPIs
  const totalDocs = documents.length
  const pendingReviews = versions.filter(v => v.status === 'in_review').length
  const overdueAcks = acknowledgements.filter(a => !a.acknowledged_at && a.required_by && new Date(a.required_by) < new Date()).length
  const pendingAcks = acknowledgements.filter(a => !a.acknowledged_at).length

  // Expiring soon (within 30 days) — derive from expiry_rules
  const now = new Date()
  const expiringSoon = expiryRules.filter(r => {
    if (!r.expiry_months || !r.ds_documents) return false
    // Find the approved version date for this doc
    const docVersions = versions.filter(v => v.document_id === r.document_id && v.status === 'approved')
    if (docVersions.length === 0) return false
    const latest = docVersions.sort((a, b) => b.version_number - a.version_number)[0]
    const approvedDate = new Date(latest.approved_at || latest.created_at)
    const expiryDate = new Date(approvedDate)
    expiryDate.setMonth(expiryDate.getMonth() + r.expiry_months)
    const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24))
    r._expiryDate = expiryDate
    r._daysLeft = daysLeft
    r._docTitle = r.ds_documents?.title
    r._docCategory = r.ds_documents?.category
    return daysLeft <= 30 && daysLeft >= 0
  })

  // Category breakdown
  const categoryMap = {}
  documents.forEach(d => {
    const cat = d.category || 'Uncategorized'
    if (!categoryMap[cat]) categoryMap[cat] = { total: 0, controlled: 0, general: 0 }
    categoryMap[cat].total++
    categoryMap[cat][d.doc_mode || 'general']++
  })
  const categoryRows = Object.entries(categoryMap).sort((a, b) => b[1].total - a[1].total)

  // Acknowledgement rates
  const totalAckCount = acknowledgements.length
  const completedAckCount = acknowledgements.filter(a => a.acknowledged_at).length
  const ackRate = totalAckCount > 0 ? Math.round((completedAckCount / totalAckCount) * 100) : 0

  const kpiStyle = { flex: 1, minWidth: 140, padding: 16, background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 8, textAlign: 'center' }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text }}>Compliance Dashboard</div>
        <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 2 }}>Document compliance overview and expiry tracking</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: 32, animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : (
        <>
          {/* KPI Row */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={kpiStyle}>
              <div style={{ fontSize: 28, fontWeight: 700, color: THEME.primary }}>{totalDocs}</div>
              <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 4 }}>Total Documents</div>
            </div>
            <div style={kpiStyle}>
              <div style={{ fontSize: 28, fontWeight: 700, color: THEME.warning }}>{expiringSoon.length}</div>
              <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 4 }}>Expiring Soon</div>
            </div>
            <div style={kpiStyle}>
              <div style={{ fontSize: 28, fontWeight: 700, color: THEME.error }}>{overdueAcks}</div>
              <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 4 }}>Overdue Acknowledgements</div>
            </div>
            <div style={kpiStyle}>
              <div style={{ fontSize: 28, fontWeight: 700, color: THEME.info }}>{pendingReviews}</div>
              <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 4 }}>Pending Reviews</div>
            </div>
          </div>

          {/* Acknowledgement Completion */}
          <div style={{ background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>Acknowledgement Completion</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ height: 8, background: THEME.surfaceVar, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${ackRate}%`, background: ackRate >= 80 ? THEME.success : ackRate >= 50 ? THEME.warning : THEME.error, borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text, minWidth: 50, textAlign: 'right' }}>{ackRate}%</div>
            </div>
            <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 6 }}>
              {completedAckCount} of {totalAckCount} acknowledgements completed | {pendingAcks} pending ({overdueAcks} overdue)
            </div>
          </div>

          {/* Category Breakdown */}
          <div style={{ background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>Documents by Category</div>
            {categoryRows.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: THEME.textLow, fontSize: 13 }}>No documents yet</div>
            ) : (
              <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: THEME.surfaceVar }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Category</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Total</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Controlled</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>General</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryRows.map(([cat, counts]) => (
                      <tr key={cat} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                        <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>{cat}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.text, fontWeight: 600 }}>{counts.total}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textLow }}>{counts.controlled}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: THEME.textLow }}>{counts.general}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Expiring Documents */}
          <div style={{ background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 8, padding: 20, marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>Expiring Documents (Next 30 Days)</div>
            {expiringSoon.length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: THEME.textLow, fontSize: 13 }}>No documents expiring in the next 30 days</div>
            ) : (
              <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: THEME.surfaceVar }}>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Document</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Category</th>
                      <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Expiry Date</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Days Left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiringSoon.sort((a, b) => a._daysLeft - b._daysLeft).map(r => (
                      <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}`, background: r._daysLeft <= 7 ? THEME.statusErrorBg : 'transparent' }}>
                        <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>{r._docTitle}</td>
                        <td style={{ padding: '8px 12px', color: THEME.textLow }}>{r._docCategory || '—'}</td>
                        <td style={{ padding: '8px 12px', color: THEME.textLow }}>{formatDate(r._expiryDate)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: r._daysLeft <= 7 ? THEME.error : THEME.warning }}>
                          {r._daysLeft} day{r._daysLeft !== 1 ? 's' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
