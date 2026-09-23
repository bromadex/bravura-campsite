import { useState, useEffect, useCallback, useMemo } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { pushNotificationToPermission } from '../../utils/notificationEngine'
import { exportCsv } from '../../utils/csv'
import Denied from '../../components/Denied'

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: 13,
  border: `1px solid ${THEME.outline}`, borderRadius: 6,
  background: THEME.surface, color: THEME.text, boxSizing: 'border-box',
}

const btnPrimary = {
  padding: '8px 18px', fontSize: 13, fontWeight: 600, border: 'none',
  borderRadius: 6, background: THEME.primary, color: THEME.onPrimary, cursor: 'pointer',
}

const btnSecondary = {
  padding: '8px 18px', fontSize: 13, fontWeight: 600, border: `1px solid ${THEME.outline}`,
  borderRadius: 6, background: THEME.surface, color: THEME.text, cursor: 'pointer',
}

const statusColors = {
  draft: { bg: THEME.surfaceVar, color: THEME.textMed },
  published: { bg: '#d4edda', color: '#155724' },
  archived: { bg: THEME.surfaceVar, color: THEME.textLow },
}

export default function Policies({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()

  if (!can('governance.view')) return <Denied />

  const [loading, setLoading] = useState(true)
  const [policies, setPolicies] = useState([])
  const [responses, setResponses] = useState([])
  const [versions, setVersions] = useState([])
  const [users, setUsers] = useState([])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editPolicy, setEditPolicy] = useState(null)
  const [detailPolicy, setDetailPolicy] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')

  // Form state
  const [form, setForm] = useState({ title: '', body: '', category: '', version: '1.0', is_mandatory: false, acknowledge_by: '' })

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const loadData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [polRes, respRes, verRes, usrRes] = await Promise.all([
      supabase.from('governance_documents').select('*')
        .eq('site_id', currentSiteId).eq('doc_type', 'policy')
        .order('updated_at', { ascending: false }),
      supabase.from('governance_responses').select('*, governance_documents!inner(site_id, doc_type)')
        .eq('governance_documents.site_id', currentSiteId)
        .eq('governance_documents.doc_type', 'policy'),
      supabase.from('governance_versions').select('*, governance_documents!inner(site_id, doc_type)')
        .eq('governance_documents.site_id', currentSiteId)
        .eq('governance_documents.doc_type', 'policy')
        .order('created_at', { ascending: false }),
      supabase.from('app_users').select('id, full_name, email')
        .eq('site_id', currentSiteId),
    ])
    if (polRes.data) setPolicies(polRes.data)
    // Fallback for responses if nested filter fails
    if (respRes.data) setResponses(respRes.data)
    else {
      const { data: fb } = await supabase.from('governance_responses').select('*, governance_documents(site_id, doc_type)')
      if (fb) setResponses(fb.filter(r => r.governance_documents?.site_id === currentSiteId && r.governance_documents?.doc_type === 'policy'))
    }
    if (verRes.data) setVersions(verRes.data)
    else {
      const { data: fb } = await supabase.from('governance_versions').select('*, governance_documents(site_id, doc_type)')
      if (fb) setVersions(fb.filter(v => v.governance_documents?.site_id === currentSiteId && v.governance_documents?.doc_type === 'policy'))
    }
    if (usrRes.data) setUsers(usrRes.data)
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { loadData() }, [loadData])

  // Derived data
  const filtered = useMemo(() => {
    let list = policies.filter(p => showArchived ? p.is_archived : !p.is_archived)
    if (categoryFilter) list = list.filter(p => p.category === categoryFilter)
    return list
  }, [policies, categoryFilter, showArchived])

  const categories = useMemo(() => [...new Set(policies.map(p => p.category).filter(Boolean))], [policies])

  const activePolicies = policies.filter(p => !p.is_archived)
  const mandatoryPolicies = activePolicies.filter(p => p.is_mandatory && p.status === 'published')
  const today = new Date().toISOString().slice(0, 10)

  const overdueCount = mandatoryPolicies.filter(p => {
    if (!p.acknowledge_by || p.acknowledge_by >= today) return false
    const policyResponses = responses.filter(r => r.document_id === p.id)
    return policyResponses.length < users.length
  }).length

  const complianceRate = mandatoryPolicies.length === 0 ? 100 : Math.round(
    (mandatoryPolicies.filter(p => {
      const pResp = responses.filter(r => r.document_id === p.id && r.response === 'accepted')
      return pResp.length >= users.length && users.length > 0
    }).length / mandatoryPolicies.length) * 100
  )

  // My response for a policy
  function myResponse(policyId) {
    return responses.find(r => r.document_id === policyId && r.user_id === profile?.id)
  }

  // Create / Edit
  function openCreate() {
    setEditPolicy(null)
    setForm({ title: '', body: '', category: '', version: '1.0', is_mandatory: false, acknowledge_by: '' })
    setShowModal(true)
  }

  function openEdit(p) {
    setEditPolicy(p)
    setForm({
      title: p.title || '', body: p.body || '', category: p.category || '',
      version: p.version || '1.0', is_mandatory: !!p.is_mandatory,
      acknowledge_by: p.acknowledge_by || '',
    })
    setShowModal(true)
  }

  async function savePolicy() {
    if (!form.title.trim()) return showToast('Title is required')
    setSaving(true)
    const now = new Date().toISOString()
    if (editPolicy) {
      // If published and body changed, bump version and create version entry
      const bodyChanged = editPolicy.body !== form.body
      const newVersion = bodyChanged && editPolicy.status === 'published'
        ? bumpVersion(editPolicy.version || '1.0') : form.version

      const { error } = await supabase.from('governance_documents').update({
        title: form.title, body: form.body, body_html: form.body,
        category: form.category || null, version: newVersion,
        is_mandatory: form.is_mandatory,
        acknowledge_by: form.acknowledge_by || null, updated_at: now,
      }).eq('id', editPolicy.id).eq('site_id', currentSiteId)

      if (error) { showToast('Save failed: ' + (error.message || 'Unknown error')); setSaving(false); return }

      if (bodyChanged && editPolicy.status === 'published') {
        await supabase.from('governance_versions').insert({
          id: crypto.randomUUID(), document_id: editPolicy.id,
          version: newVersion, body: form.body, body_html: form.body,
          change_notes: 'Updated policy content', created_by: profile?.id, created_at: now,
        })
      }
      showToast('Policy updated')
    } else {
      const { error } = await supabase.from('governance_documents').insert({
        id: crypto.randomUUID(), site_id: currentSiteId, doc_type: 'policy',
        title: form.title, body: form.body, body_html: form.body,
        category: form.category || null, version: form.version || '1.0',
        is_mandatory: form.is_mandatory, acknowledge_by: form.acknowledge_by || null,
        status: 'draft', is_pinned: false, is_archived: false,
        priority: 'normal', created_by: profile?.id, created_at: now, updated_at: now,
      })
      if (error) { showToast('Create failed: ' + (error.message || 'Unknown error')); setSaving(false); return }
      showToast('Policy created as draft')
    }
    setSaving(false)
    setShowModal(false)
    loadData()
  }

  function bumpVersion(v) {
    const parts = (v || '1.0').split('.')
    const minor = parseInt(parts[1] || '0', 10) + 1
    return parts[0] + '.' + minor
  }

  // Publish
  async function publishPolicy(p) {
    if (!can('governance.approve')) return showToast('Requires governance.approve permission')
    const now = new Date().toISOString()
    const { error } = await supabase.from('governance_documents').update({
      status: 'published', published_by: profile?.id,
      published_by_name: profile?.full_name || profile?.email || '', updated_at: now,
    }).eq('id', p.id).eq('site_id', currentSiteId)
    if (error) return showToast('Publish failed')

    await supabase.from('governance_versions').insert({
      id: crypto.randomUUID(), document_id: p.id,
      version: p.version || '1.0', body: p.body, body_html: p.body_html,
      change_notes: 'Initial publication', created_by: profile?.id, created_at: now,
    })

    pushNotificationToPermission('governance.view', currentSiteId, {
      type: 'policy_published', title: 'New Policy Published',
      message: `Policy "${p.title}" has been published and requires your attention.`,
      link: '/governance/policies', category: 'general',
    })
    showToast('Policy published')
    loadData()
  }

  // Archive
  async function archivePolicy(p) {
    if (!can('governance.delete')) return showToast('Requires governance.delete permission')
    const { error } = await supabase.from('governance_documents').update({
      is_archived: true, status: 'archived', updated_at: new Date().toISOString(),
    }).eq('id', p.id).eq('site_id', currentSiteId)
    if (error) return showToast('Archive failed')
    showToast('Policy archived')
    loadData()
  }

  // Acknowledge
  async function respond(policyId, resp) {
    const { error } = await supabase.from('governance_responses').upsert({
      id: crypto.randomUUID(), document_id: policyId,
      user_id: profile?.id, response: resp, comment: '', created_at: new Date().toISOString(),
    }, { onConflict: 'document_id,user_id' })
    if (error) return showToast('Response failed: ' + (error.message || ''))
    showToast(resp === 'accepted' ? 'Policy accepted' : 'Policy rejected')
    loadData()
  }

  // CSV export
  function exportCompliance() {
    const rows = []
    for (const p of mandatoryPolicies) {
      for (const u of users) {
        const r = responses.find(r => r.document_id === p.id && r.user_id === u.id)
        rows.push([p.title, u.full_name || u.email, r ? r.response : 'Pending', r ? formatDate(r.created_at) : ''])
      }
    }
    exportCsv('policy-compliance-report', ['Policy', 'Employee', 'Response', 'Date'], rows)
    showToast('CSV exported')
  }

  if (loading) return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', color: THEME.textMed, fontSize: 14 }}>
      Loading policies...
    </div>
  )

  // Detail modal content
  const detailVersions = detailPolicy ? versions.filter(v => v.document_id === detailPolicy.id) : []
  const detailResponses = detailPolicy ? responses.filter(r => r.document_id === detailPolicy.id) : []

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999, padding: '12px 20px',
          background: THEME.primary, color: THEME.onPrimary, borderRadius: 8,
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        }}>{toast}</div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.text }}>Policies & Compliance</h2>
          <div style={{ fontSize: 13, color: THEME.textLow, marginTop: 2 }}>Manage policies, track acknowledgements and compliance</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {can('governance.create') && (
            <button style={btnPrimary} onClick={openCreate}>+ New Policy</button>
          )}
          <button style={btnSecondary} onClick={exportCompliance}>Export CSV</button>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Total Policies', value: activePolicies.length, icon: 'policy' },
          { label: 'Mandatory', value: mandatoryPolicies.length, icon: 'verified' },
          { label: 'Overdue Acks', value: overdueCount, icon: 'warning', warn: overdueCount > 0 },
          { label: 'Compliance Rate', value: complianceRate + '%', icon: 'check_circle' },
        ].map((kpi, i) => (
          <div key={i} style={{
            flex: '1 1 140px', padding: '16px 14px', borderRadius: 10,
            background: THEME.surface, border: `1px solid ${THEME.outline}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 18, color: kpi.warn ? '#dc3545' : THEME.primary }}>{kpi.icon}</span>
              <span style={{ fontSize: 12, color: THEME.textLow }}>{kpi.label}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: kpi.warn ? '#dc3545' : THEME.text }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...inputStyle, width: 200 }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ fontSize: 13, color: THEME.textMed, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show Archived
        </label>
      </div>

      {/* Policy Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: 40, color: THEME.outline, display: 'block', marginBottom: 8 }}>policy</span>
          <div style={{ fontSize: 14 }}>No policies found</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                {['Title', 'Category', 'Version', 'Status', 'Mandatory', 'Ack By', 'My Response', 'Actions'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 8px', color: THEME.textMed, fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const mr = myResponse(p.id)
                const sc = statusColors[p.status] || statusColors.draft
                return (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => setDetailPolicy(p)}>
                    <td style={{ padding: '10px 8px', fontWeight: 600, color: THEME.text }}>{p.title}</td>
                    <td style={{ padding: '10px 8px', color: THEME.textMed }}>{p.category || '—'}</td>
                    <td style={{ padding: '10px 8px', color: THEME.textMed }}>{p.version || '1.0'}</td>
                    <td style={{ padding: '10px 8px' }}>
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.color }}>{p.status}</span>
                    </td>
                    <td style={{ padding: '10px 8px', color: THEME.textMed }}>{p.is_mandatory ? 'Yes' : 'No'}</td>
                    <td style={{ padding: '10px 8px', color: THEME.textMed }}>{formatDate(p.acknowledge_by)}</td>
                    <td style={{ padding: '10px 8px' }}>
                      {p.status === 'published' && p.is_mandatory ? (
                        mr ? (
                          <span style={{
                            padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                            background: mr.response === 'accepted' ? '#d4edda' : '#f8d7da',
                            color: mr.response === 'accepted' ? '#155724' : '#721c24',
                          }}>{mr.response === 'accepted' ? 'Accepted' : 'Rejected'}</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
                            <button style={{ ...btnPrimary, padding: '3px 10px', fontSize: 11 }} onClick={() => respond(p.id, 'accepted')}>Accept</button>
                            <button style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }} onClick={() => respond(p.id, 'rejected')}>Reject</button>
                          </div>
                        )
                      ) : <span style={{ color: THEME.textLow }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 8px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {p.status === 'draft' && can('governance.approve') && (
                          <button style={{ ...btnPrimary, padding: '3px 10px', fontSize: 11 }} onClick={() => publishPolicy(p)}>Publish</button>
                        )}
                        {can('governance.edit') && !p.is_archived && (
                          <button style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11 }} onClick={() => openEdit(p)}>Edit</button>
                        )}
                        {can('governance.delete') && !p.is_archived && (
                          <button style={{ ...btnSecondary, padding: '3px 10px', fontSize: 11, color: '#dc3545' }} onClick={() => archivePolicy(p)}>Archive</button>
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

      {/* Create/Edit Modal */}
      {showModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setShowModal(false)}>
          <div style={{
            background: THEME.surface, borderRadius: 12, padding: 24, width: '100%', maxWidth: 540,
            maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: THEME.text }}>
              {editPolicy ? 'Edit Policy' : 'New Policy'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, marginBottom: 4, display: 'block' }}>Title *</label>
                <input style={inputStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, marginBottom: 4, display: 'block' }}>Body</label>
                <textarea style={{ ...inputStyle, minHeight: 120, resize: 'vertical', fontFamily: 'inherit' }} value={form.body}
                  onChange={e => setForm({ ...form, body: e.target.value })} />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, marginBottom: 4, display: 'block' }}>Category</label>
                  <input style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Safety, HR" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, marginBottom: 4, display: 'block' }}>Version</label>
                  <input style={inputStyle} value={form.version} onChange={e => setForm({ ...form, version: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, marginBottom: 4, display: 'block' }}>Acknowledge By</label>
                  <input type="date" style={inputStyle} value={form.acknowledge_by} onChange={e => setForm({ ...form, acknowledge_by: e.target.value })} />
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
                  <label style={{ fontSize: 13, color: THEME.textMed, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_mandatory} onChange={e => setForm({ ...form, is_mandatory: e.target.checked })} />
                    Mandatory acknowledgement
                  </label>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button style={btnSecondary} onClick={() => setShowModal(false)}>Cancel</button>
              <button style={btnPrimary} onClick={savePolicy} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailPolicy && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
        }} onClick={() => setDetailPolicy(null)}>
          <div style={{
            background: THEME.surface, borderRadius: 12, padding: 24, width: '100%', maxWidth: 700,
            maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: THEME.text }}>{detailPolicy.title}</h3>
                <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 4 }}>
                  Version {detailPolicy.version || '1.0'} &middot; {detailPolicy.category || 'Uncategorized'} &middot;{' '}
                  <span style={{
                    padding: '1px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                    background: (statusColors[detailPolicy.status] || statusColors.draft).bg,
                    color: (statusColors[detailPolicy.status] || statusColors.draft).color,
                  }}>{detailPolicy.status}</span>
                </div>
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: THEME.textLow }} onClick={() => setDetailPolicy(null)}>&times;</button>
            </div>

            {/* Policy body */}
            {detailPolicy.body && (
              <div style={{
                padding: 14, background: THEME.bg, borderRadius: 8, fontSize: 13,
                color: THEME.text, marginBottom: 20, whiteSpace: 'pre-wrap', lineHeight: 1.6,
                border: `1px solid ${THEME.outlineVar}`,
              }}>{detailPolicy.body}</div>
            )}

            {/* Version History */}
            <h4 style={{ fontSize: 14, fontWeight: 700, color: THEME.text, margin: '0 0 10px' }}>Version History</h4>
            {detailVersions.length === 0 ? (
              <div style={{ fontSize: 13, color: THEME.textLow, marginBottom: 20 }}>No version history yet</div>
            ) : (
              <div style={{ marginBottom: 20 }}>
                {detailVersions.map(v => (
                  <div key={v.id} style={{ padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: 13 }}>
                    <span style={{ fontWeight: 600, color: THEME.text }}>v{v.version}</span>
                    <span style={{ color: THEME.textLow, marginLeft: 8 }}>{formatDate(v.created_at)}</span>
                    {v.change_notes && <span style={{ color: THEME.textMed, marginLeft: 8 }}>&mdash; {v.change_notes}</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Acknowledgement Status */}
            {detailPolicy.is_mandatory && detailPolicy.status === 'published' && (
              <>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: THEME.text, margin: '0 0 10px' }}>Acknowledgement Status</h4>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                        <th style={{ textAlign: 'left', padding: '8px', color: THEME.textMed, fontWeight: 600, fontSize: 12 }}>Employee</th>
                        <th style={{ textAlign: 'left', padding: '8px', color: THEME.textMed, fontWeight: 600, fontSize: 12 }}>Status</th>
                        <th style={{ textAlign: 'left', padding: '8px', color: THEME.textMed, fontWeight: 600, fontSize: 12 }}>Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => {
                        const r = detailResponses.find(r => r.user_id === u.id)
                        return (
                          <tr key={u.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                            <td style={{ padding: '8px', color: THEME.text }}>{u.full_name || u.email}</td>
                            <td style={{ padding: '8px' }}>
                              <span style={{
                                padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                                background: !r ? THEME.surfaceVar : r.response === 'accepted' ? '#d4edda' : '#f8d7da',
                                color: !r ? THEME.textMed : r.response === 'accepted' ? '#155724' : '#721c24',
                              }}>{!r ? 'Pending' : r.response === 'accepted' ? 'Accepted' : 'Rejected'}</span>
                            </td>
                            <td style={{ padding: '8px', color: THEME.textLow }}>{r ? formatDate(r.created_at) : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={btnSecondary} onClick={() => setDetailPolicy(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
