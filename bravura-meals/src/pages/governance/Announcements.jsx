import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME } from '../../utils/permissions'
import { pushNotificationToPermission } from '../../utils/notificationEngine'
import Denied from '../../components/Denied'

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

const priorityColors = {
  normal: { bg: THEME.surfaceVar, color: THEME.textMed },
  important: { bg: THEME.warning, color: '#fff' },
  urgent: { bg: THEME.error, color: '#fff' },
}

const statusColors = {
  draft: { bg: THEME.surfaceVar, color: THEME.textMed },
  published: { bg: THEME.success, color: '#fff' },
  archived: { bg: THEME.surfaceVar, color: THEME.textLow },
}

function Badge({ label, colors }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 10,
      fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.color,
      textTransform: 'capitalize',
    }}>{label}</span>
  )
}

export default function Announcements({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()

  if (!can('governance.view')) return <Denied />

  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [detailItem, setDetailItem] = useState(null)
  const [readUsers, setReadUsers] = useState(null) // { docId, users[] }
  const [readCounts, setReadCounts] = useState({})
  const [saving, setSaving] = useState(false)

  // Form state
  const [form, setForm] = useState({ title: '', body: '', priority: 'normal', category: '', expiry_date: '', is_pinned: false })

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  const fetchAnnouncements = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('governance_documents')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('doc_type', 'announcement')
      .eq('is_archived', showArchived)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) { showToast('Failed to load announcements'); console.error(error) }
    else setAnnouncements(data || [])
    setLoading(false)
  }, [currentSiteId, showArchived])

  const fetchReadCounts = useCallback(async () => {
    if (!announcements.length) { setReadCounts({}); return }
    const ids = announcements.map(a => a.id)
    const { data } = await supabase
      .from('announcement_reads')
      .select('document_id')
      .in('document_id', ids)
    if (data) {
      const counts = {}
      data.forEach(r => { counts[r.document_id] = (counts[r.document_id] || 0) + 1 })
      setReadCounts(counts)
    }
  }, [announcements])

  useEffect(() => { fetchAnnouncements() }, [fetchAnnouncements])
  useEffect(() => { fetchReadCounts() }, [fetchReadCounts])

  // Mark as read
  async function markAsRead(docId) {
    if (!profile?.id) return
    await supabase.from('announcement_reads').upsert(
      { id: crypto.randomUUID(), document_id: docId, user_id: profile.id, read_at: new Date().toISOString() },
      { onConflict: 'document_id,user_id' }
    )
  }

  function openDetail(item) {
    setDetailItem(item)
    if (item.status === 'published' && profile?.id) {
      markAsRead(item.id).then(fetchReadCounts)
    }
  }

  function openCreate() {
    setEditing(null)
    setForm({ title: '', body: '', priority: 'normal', category: '', expiry_date: '', is_pinned: false })
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditing(item)
    setForm({
      title: item.title || '',
      body: item.body || '',
      priority: item.priority || 'normal',
      category: item.category || '',
      expiry_date: item.expiry_date || '',
      is_pinned: !!item.is_pinned,
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.title.trim()) { showToast('Title is required'); return }
    setSaving(true)
    const payload = {
      site_id: currentSiteId,
      doc_type: 'announcement',
      title: form.title.trim(),
      body: form.body.trim(),
      priority: form.priority,
      category: form.category.trim() || null,
      expiry_date: form.expiry_date || null,
      is_pinned: form.is_pinned,
      updated_at: new Date().toISOString(),
    }
    let error
    if (editing) {
      ({ error } = await supabase.from('governance_documents').update(payload).eq('id', editing.id).eq('site_id', currentSiteId))
    } else {
      payload.id = crypto.randomUUID()
      payload.status = 'draft'
      payload.is_archived = false
      payload.created_by = profile?.id
      payload.created_at = new Date().toISOString()
      ;({ error } = await supabase.from('governance_documents').insert([payload]))
    }
    setSaving(false)
    if (error) { showToast('Save failed: ' + (error.message || error)); return }
    showToast(editing ? 'Announcement updated' : 'Announcement created')
    setModalOpen(false)
    fetchAnnouncements()
  }

  async function handlePublish(item) {
    const { error } = await supabase.from('governance_documents').update({
      status: 'published',
      published_by: profile?.id,
      published_by_name: profile?.full_name || profile?.email || 'Unknown',
      updated_at: new Date().toISOString(),
    }).eq('id', item.id).eq('site_id', currentSiteId)
    if (error) { showToast('Publish failed'); return }
    showToast('Announcement published')
    pushNotificationToPermission('governance.view', currentSiteId, {
      type: 'announcement_published',
      title: 'New Announcement',
      message: item.title,
      link: '/governance/announcements',
      category: 'announcements',
    })
    fetchAnnouncements()
  }

  async function handleArchive(item) {
    const { error } = await supabase.from('governance_documents').update({
      is_archived: true, status: 'archived', updated_at: new Date().toISOString(),
    }).eq('id', item.id).eq('site_id', currentSiteId)
    if (error) { showToast('Archive failed'); return }
    showToast('Announcement archived')
    fetchAnnouncements()
  }

  async function handleRestore(item) {
    const { error } = await supabase.from('governance_documents').update({
      is_archived: false, status: 'draft', updated_at: new Date().toISOString(),
    }).eq('id', item.id).eq('site_id', currentSiteId)
    if (error) { showToast('Restore failed'); return }
    showToast('Announcement restored')
    fetchAnnouncements()
  }

  async function openReadReceipts(item) {
    const { data } = await supabase
      .from('announcement_reads')
      .select('user_id, read_at, profiles:user_id(full_name, email)')
      .eq('document_id', item.id)
      .order('read_at', { ascending: false })
    setReadUsers({ docId: item.id, title: item.title, users: data || [] })
  }

  // Filtering
  const categories = [...new Set(announcements.map(a => a.category).filter(Boolean))]
  const filtered = announcements.filter(a => {
    if (search && !a.title?.toLowerCase().includes(search.toLowerCase())) return false
    if (filterPriority && a.priority !== filterPriority) return false
    if (filterCategory && a.category !== filterCategory) return false
    return true
  })

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.text }}>
            <span className="material-symbols-rounded" style={{ fontSize: 22, verticalAlign: 'middle', marginRight: 6 }}>campaign</span>
            Announcements
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            style={{ ...btnSecondary, background: showArchived ? THEME.primaryLight : THEME.surface }}
            onClick={() => setShowArchived(!showArchived)}
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>inventory_2</span>
            {showArchived ? 'Active' : 'Archived'}
          </button>
          {can('governance.create') && (
            <button style={btnPrimary} onClick={openCreate}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</span>
              New Announcement
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          style={{ ...inputStyle, width: 220 }}
          placeholder="Search by title..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select style={{ ...inputStyle, width: 140 }} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
          <option value="">All priorities</option>
          <option value="normal">Normal</option>
          <option value="important">Important</option>
          <option value="urgent">Urgent</option>
        </select>
        {categories.length > 0 && (
          <select style={{ ...inputStyle, width: 160 }} value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: 40, display: 'block', marginBottom: 8 }}>inbox</span>
          No announcements found.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                <th style={thStyle}></th>
                <th style={{ ...thStyle, textAlign: 'left' }}>Title</th>
                <th style={thStyle}>Priority</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Category</th>
                <th style={thStyle}>Reads</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr
                  key={item.id}
                  style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={() => openDetail(item)}
                >
                  <td style={{ ...tdStyle, width: 30, textAlign: 'center' }}>
                    {item.is_pinned && <span className="material-symbols-rounded" style={{ fontSize: 16, color: THEME.warning }}>push_pin</span>}
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600, color: THEME.text }}>{item.title}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <Badge label={item.priority} colors={priorityColors[item.priority] || priorityColors.normal} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <Badge label={item.status} colors={statusColors[item.status] || statusColors.draft} />
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: THEME.textMed }}>{item.category || '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <span
                      style={{ cursor: 'pointer', color: THEME.primary, fontWeight: 600 }}
                      onClick={e => { e.stopPropagation(); openReadReceipts(item) }}
                    >
                      {readCounts[item.id] || 0}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center', color: THEME.textLow, fontSize: 12 }}>
                    {item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                      {can('governance.edit') && item.status === 'draft' && (
                        <button style={iconBtn} title="Edit" onClick={() => openEdit(item)}>
                          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>edit</span>
                        </button>
                      )}
                      {can('governance.approve') && item.status === 'draft' && (
                        <button style={{ ...iconBtn, color: THEME.success }} title="Publish" onClick={() => handlePublish(item)}>
                          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>publish</span>
                        </button>
                      )}
                      {can('governance.delete') && !item.is_archived && (
                        <button style={{ ...iconBtn, color: THEME.error }} title="Archive" onClick={() => handleArchive(item)}>
                          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>archive</span>
                        </button>
                      )}
                      {can('governance.delete') && item.is_archived && (
                        <button style={{ ...iconBtn, color: THEME.success }} title="Restore" onClick={() => handleRestore(item)}>
                          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>unarchive</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && <Overlay onClose={() => setModalOpen(false)}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: THEME.text }}>
          {editing ? 'Edit Announcement' : 'New Announcement'}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={labelStyle}>
            Title *
            <input style={inputStyle} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          </label>
          <label style={labelStyle}>
            Body
            <textarea style={{ ...inputStyle, minHeight: 120, resize: 'vertical', fontFamily: 'inherit' }} value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} />
          </label>
          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...labelStyle, flex: 1 }}>
              Priority
              <select style={inputStyle} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="normal">Normal</option>
                <option value="important">Important</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label style={{ ...labelStyle, flex: 1 }}>
              Category
              <input style={inputStyle} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="e.g. Safety, HR" />
            </label>
          </div>
          <label style={labelStyle}>
            Expiry date
            <input style={inputStyle} type="date" value={form.expiry_date} onChange={e => setForm({ ...form, expiry_date: e.target.value })} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: THEME.text }}>
            <input type="checkbox" checked={form.is_pinned} onChange={e => setForm({ ...form, is_pinned: e.target.checked })} />
            Pin to top
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button style={btnSecondary} onClick={() => setModalOpen(false)}>Cancel</button>
          <button style={btnPrimary} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </Overlay>}

      {/* Detail Modal */}
      {detailItem && <Overlay onClose={() => setDetailItem(null)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          {detailItem.is_pinned && <span className="material-symbols-rounded" style={{ fontSize: 18, color: THEME.warning }}>push_pin</span>}
          <Badge label={detailItem.priority} colors={priorityColors[detailItem.priority] || priorityColors.normal} />
          <Badge label={detailItem.status} colors={statusColors[detailItem.status] || statusColors.draft} />
        </div>
        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: THEME.text }}>{detailItem.title}</h3>
        <div style={{ fontSize: 12, color: THEME.textLow, marginBottom: 16 }}>
          {detailItem.published_by_name ? `Published by ${detailItem.published_by_name}` : 'Draft'}
          {detailItem.created_at && ` · ${new Date(detailItem.created_at).toLocaleDateString()}`}
          {detailItem.category && ` · ${detailItem.category}`}
          {detailItem.expiry_date && ` · Expires ${detailItem.expiry_date}`}
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: THEME.text, whiteSpace: 'pre-wrap', maxHeight: 400, overflowY: 'auto' }}>
          {detailItem.body || '(No content)'}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button style={btnSecondary} onClick={() => setDetailItem(null)}>Close</button>
        </div>
      </Overlay>}

      {/* Read Receipts Modal */}
      {readUsers && <Overlay onClose={() => setReadUsers(null)}>
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: THEME.text }}>
          Read receipts — {readUsers.title}
        </h3>
        {readUsers.users.length === 0 ? (
          <div style={{ color: THEME.textLow, fontSize: 13, textAlign: 'center', padding: 20 }}>No one has read this yet.</div>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {readUsers.users.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: 13 }}>
                <span style={{ color: THEME.text, fontWeight: 500 }}>
                  {r.profiles?.full_name || r.profiles?.email || r.user_id}
                </span>
                <span style={{ color: THEME.textLow, fontSize: 12 }}>
                  {r.read_at ? new Date(r.read_at).toLocaleString() : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button style={btnSecondary} onClick={() => setReadUsers(null)}>Close</button>
        </div>
      </Overlay>}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: THEME.text, color: THEME.surface, padding: '10px 24px',
          borderRadius: 8, fontSize: 13, fontWeight: 600, zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>{toast}</div>
      )}
    </div>
  )
}

/* Shared overlay */
function Overlay({ onClose, children }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: THEME.surface, borderRadius: 12, padding: 24,
          width: '90%', maxWidth: 540, maxHeight: '85vh', overflowY: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

const thStyle = { padding: '10px 8px', fontSize: 12, fontWeight: 600, color: THEME.textMed, textAlign: 'center', whiteSpace: 'nowrap' }
const tdStyle = { padding: '10px 8px', whiteSpace: 'nowrap' }
const labelStyle = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600, color: THEME.textMed }
const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: THEME.textMed, borderRadius: 4 }
