import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Button, Icon, PageHeader, showToast, TableWrap, THead, Th, TRow, Td, ModalOverlay } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.admin

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

export default function SiteManagement({ setPage }) {
  const { can } = usePermissions()
  useRealtimeSubscription('sites', null, fetchSites)
  const canEdit = can('users.edit')

  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState(null) // null | { id?, name, code, site_type, is_active }
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchSites() }, [])

  async function fetchSites() {
    setLoading(true)
    const { data, error } = await supabase.from('sites').select('*').order('name')
    if (error) showToast(error.message, 'red')
    setSites(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditModal({ name: '', code: '', site_type: 'operational_site', is_active: true })
  }

  function openEdit(site) {
    setEditModal({ id: site.id, name: site.name, code: site.code || '', site_type: site.site_type, is_active: site.is_active })
  }

  async function handleSave() {
    if (!editModal.name.trim()) { showToast('Site name is required', 'red'); return }
    if (!editModal.code.trim()) { showToast('Site code is required', 'red'); return }

    // Prevent deactivating the last active site
    if (editModal.id && !editModal.is_active) {
      const activeSites = sites.filter(s => s.is_active && s.id !== editModal.id)
      if (activeSites.length === 0) {
        showToast('Cannot deactivate the last active site', 'red')
        return
      }
    }

    setSaving(true)
    try {
      const payload = {
        name: editModal.name.trim(),
        code: editModal.code.trim().toUpperCase(),
        site_type: editModal.site_type,
        is_active: editModal.is_active,
      }

      if (editModal.id) {
        const { error } = await supabase.from('sites').update(payload).eq('id', editModal.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('sites').insert(payload)
        if (error) throw error
      }

      showToast(editModal.id ? 'Site updated' : 'Site created', 'green')
      setEditModal(null)
      fetchSites()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  if (!can('users.view')) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_sites" />
      <PageHeader title="Site Management" />

      {canEdit && (
        <div style={{ marginBottom: '16px' }}>
          <Button onClick={openAdd} style={{ background: color, color: '#fff' }}>
            <Icon name="add" size={16} /> Add Site
          </Button>
        </div>
      )}

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color }} />
        </div>
      ) : (
        <TableWrap>
          <THead color={color}>
            {['Name', 'Code', 'Type', 'Status', 'Actions'].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {sites.map(s => (
              <TRow key={s.id}>
                <Td style={{ fontWeight: 600 }}>{s.name}</Td>
                <Td><code style={{ fontSize: '12px', background: THEME.surfaceVar, padding: '2px 6px', borderRadius: '4px' }}>{s.code}</code></Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>
                  {s.site_type === 'head_office' ? 'Head Office' : 'Operational Site'}
                </Td>
                <Td>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                    background: s.is_active ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                    color: s.is_active ? THEME.statusSuccessText : THEME.statusNeutralText,
                  }}>
                    {s.is_active ? 'Active' : 'Inactive'}
                  </span>
                </Td>
                <Td>
                  {canEdit && (
                    <Button size="sm" onClick={() => openEdit(s)} style={{ fontSize: '12px' }}>
                      <Icon name="edit" size={14} /> Edit
                    </Button>
                  )}
                </Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      {/* Add/Edit Modal */}
      {editModal && (
        <ModalOverlay onClose={() => setEditModal(null)} dirty={true}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', padding: '24px', width: '440px', maxWidth: '90vw',
            boxShadow: THEME.shadow3,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>
              {editModal.id ? 'Edit Site' : 'Add Site'}
            </div>

            <div style={fieldWrap}>
              <label style={lbl}>Site Name *</label>
              <input style={inp} value={editModal.name} onChange={e => setEditModal(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Kamativi" />
            </div>

            <div style={fieldWrap}>
              <label style={lbl}>Code *</label>
              <input style={{ ...inp, textTransform: 'uppercase' }} value={editModal.code} onChange={e => setEditModal(prev => ({ ...prev, code: e.target.value }))} placeholder="e.g. KAM" maxLength={10} />
            </div>

            <div style={fieldWrap}>
              <label style={lbl}>Site Type</label>
              <select style={inp} value={editModal.site_type} onChange={e => setEditModal(prev => ({ ...prev, site_type: e.target.value }))}>
                <option value="operational_site">Operational Site</option>
                <option value="head_office">Head Office</option>
              </select>
            </div>

            <div style={fieldWrap}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: THEME.text }}>
                <input type="checkbox" checked={editModal.is_active} onChange={e => setEditModal(prev => ({ ...prev, is_active: e.target.checked }))} />
                Active
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <Button onClick={() => setEditModal(null)} style={{ background: THEME.surfaceVar, color: THEME.text }}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} style={{ background: color, color: '#fff' }}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
