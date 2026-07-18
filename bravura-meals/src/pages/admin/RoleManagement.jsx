import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Button, Icon, PageHeader, showToast, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
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

export default function RoleManagement({ setPage }) {
  const { can } = usePermissions()
  useRealtimeSubscription('roles', null, fetchAll)
  const canEdit = can('users.edit')

  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [rolePermissions, setRolePermissions] = useState([])
  const [roleAssignments, setRoleAssignments] = useState([]) // user_roles: { role_id }
  const [loading, setLoading] = useState(true)
  const [editModal, setEditModal] = useState(null) // null | { id?, name, description, permIds: Set }
  const [members, setMembers] = useState(null) // null | array of member display names for the role being edited
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [rRes, pRes, rpRes, urRes] = await Promise.all([
      supabase.from('roles').select('*').order('name'),
      supabase.from('permissions').select('*').order('code'),
      supabase.from('role_permissions').select('role_id, permission_id'),
      supabase.from('user_roles').select('role_id'),
    ])
    setRoles(rRes.data || [])
    setPermissions(pRes.data || [])
    setRolePermissions(rpRes.data || [])
    setRoleAssignments(urRes.data || [])
    setLoading(false)
  }

  const permCountByRole = useMemo(() => {
    const map = {}
    rolePermissions.forEach(rp => {
      map[rp.role_id] = (map[rp.role_id] || 0) + 1
    })
    return map
  }, [rolePermissions])

  const memberCountByRole = useMemo(() => {
    const map = {}
    roleAssignments.forEach(ur => {
      map[ur.role_id] = (map[ur.role_id] || 0) + 1
    })
    return map
  }, [roleAssignments])

  const permsByModule = useMemo(() => {
    const map = {}
    permissions.forEach(p => {
      const mod = p.code.split('.')[0] || 'other'
      if (!map[mod]) map[mod] = []
      map[mod].push(p)
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]))
  }, [permissions])

  function openAdd() {
    setEditModal({ name: '', description: '', permIds: new Set() })
  }

  function openEdit(role) {
    const permIds = new Set(
      rolePermissions.filter(rp => rp.role_id === role.id).map(rp => rp.permission_id)
    )
    setEditModal({ id: role.id, name: role.name, description: role.description || '', permIds })
    fetchMembers(role.id)
  }

  async function fetchMembers(roleId) {
    setMembers(null)
    // Try the FK embed first; fall back to a client-side join if PostgREST
    // rejects the embed (no FK relationship registered).
    const { data, error } = await supabase
      .from('user_roles')
      .select('user_id, profiles(full_name, username)')
      .eq('role_id', roleId)
    if (!error && data) {
      const names = [...new Set(data.map(ur =>
        ur.profiles?.full_name || ur.profiles?.username || ur.user_id
      ))]
      setMembers(names)
      return
    }
    // Fallback: fetch profiles separately and join client-side
    const { data: urs } = await supabase.from('user_roles').select('user_id').eq('role_id', roleId)
    const userIds = [...new Set((urs || []).map(ur => ur.user_id).filter(Boolean))]
    if (userIds.length === 0) { setMembers([]); return }
    const { data: profs } = await supabase.from('profiles').select('id, full_name, username').in('id', userIds)
    const byId = {}
    profs?.forEach(p => { byId[p.id] = p })
    setMembers(userIds.map(id => byId[id]?.full_name || byId[id]?.username || id))
  }

  function toggleModule(perms, allSelected) {
    setEditModal(prev => {
      const next = new Set(prev.permIds)
      perms.forEach(p => { if (allSelected) next.delete(p.id); else next.add(p.id) })
      return { ...prev, permIds: next }
    })
  }

  function togglePerm(permId) {
    setEditModal(prev => {
      const next = new Set(prev.permIds)
      if (next.has(permId)) next.delete(permId)
      else next.add(permId)
      return { ...prev, permIds: next }
    })
  }

  async function handleSave() {
    if (!editModal.name.trim()) { showToast('Role name is required', 'red'); return }
    setSaving(true)
    try {
      let roleId = editModal.id
      if (roleId) {
        const { error } = await supabase.from('roles').update({
          name: editModal.name.trim(),
          description: editModal.description.trim() || null,
        }).eq('id', roleId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('roles').insert({
          name: editModal.name.trim(),
          description: editModal.description.trim() || null,
        }).select().single()
        if (error) throw error
        roleId = data.id
      }

      // Sync permissions: delete existing, insert new set
      await supabase.from('role_permissions').delete().eq('role_id', roleId)
      if (editModal.permIds.size > 0) {
        const rows = [...editModal.permIds].map(pid => ({ role_id: roleId, permission_id: pid }))
        const { error } = await supabase.from('role_permissions').insert(rows)
        if (error) throw error
      }

      showToast(editModal.id ? 'Role updated' : 'Role created', 'green')
      setEditModal(null)
      fetchAll()
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
      <PageHeader title="Role Management" />

      {canEdit && (
        <div style={{ marginBottom: '16px' }}>
          <Button onClick={openAdd} style={{ background: color, color: '#fff' }}>
            <Icon name="add" size={16} /> Add Role
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
            {['Role Name', 'Description', 'Permissions', 'Members', 'Actions'].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {roles.map(r => (
              <TRow key={r.id}>
                <Td style={{ fontWeight: 600 }}>{r.name}</Td>
                <Td style={{ color: THEME.textMed, fontSize: '12px' }}>{r.description || '-'}</Td>
                <Td>
                  <span style={{
                    padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                    background: THEME.surfaceVar, color,
                  }}>
                    {permCountByRole[r.id] || 0}
                  </span>
                </Td>
                <Td>
                  <span style={{
                    padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600,
                    background: THEME.surfaceVar, color: THEME.textMed,
                  }}>
                    {memberCountByRole[r.id] || 0}
                  </span>
                </Td>
                <Td>
                  {canEdit && (
                    <Button size="sm" onClick={() => openEdit(r)} style={{ fontSize: '12px' }}>
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
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.45)',
        }} onClick={() => setEditModal(null)}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', padding: '24px', width: '520px', maxWidth: '90vw',
            maxHeight: '80vh', overflowY: 'auto', boxShadow: THEME.shadow3,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>
              {editModal.id ? 'Edit Role' : 'Add Role'}
            </div>

            <div style={fieldWrap}>
              <label style={lbl}>Role Name *</label>
              <input style={inp} value={editModal.name} onChange={e => setEditModal(prev => ({ ...prev, name: e.target.value }))} placeholder="e.g. Site Manager" />
            </div>

            <div style={fieldWrap}>
              <label style={lbl}>Description</label>
              <input style={inp} value={editModal.description} onChange={e => setEditModal(prev => ({ ...prev, description: e.target.value }))} placeholder="Optional description" />
            </div>

            <div style={fieldWrap}>
              <label style={lbl}>Permissions</label>
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px', padding: '12px' }}>
                {permsByModule.map(([mod, perms]) => {
                  const allSelected = perms.every(p => editModal.permIds.has(p.id))
                  return (
                  <div key={mod} style={{ marginBottom: '12px' }}>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_roles" />
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color, letterSpacing: '0.5px' }}>{mod}</div>
                      <button type="button" onClick={() => toggleModule(perms, allSelected)} style={{
                        border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: '11px', fontWeight: 600, color, padding: '0 2px',
                      }}>
                        {allSelected ? 'Clear' : 'Select all'}
                      </button>
                    </div>
                    {perms.map(p => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '3px 0', fontSize: '13px', color: THEME.text }}>
                        <input type="checkbox" checked={editModal.permIds.has(p.id)} onChange={() => togglePerm(p.id)} />
                        <span>{p.code}</span>
                        {p.action && <span style={{ fontSize: '11px', color: THEME.textLow }}>({p.action})</span>}
                      </label>
                    ))}
                  </div>
                )})}
              </div>
            </div>

            {editModal.id && (
              <div style={fieldWrap}>
                <label style={lbl}>Members</label>
                <div style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px', padding: '10px 12px', maxHeight: '140px', overflowY: 'auto' }}>
                  {members === null ? (
                    <div style={{ fontSize: '12px', color: THEME.textLow }}>Loading members…</div>
                  ) : members.length === 0 ? (
                    <div style={{ fontSize: '12px', color: THEME.textLow }}>No users have this role.</div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {members.map((name, i) => (
                        <span key={i} style={{
                          padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
                          background: THEME.surfaceVar, color: THEME.textMed,
                        }}>
                          {name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <Button onClick={() => setEditModal(null)} style={{ background: THEME.surfaceVar, color: THEME.text }}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} style={{ background: color, color: '#fff' }}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
