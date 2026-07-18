import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useAuth } from '../../auth/AuthContext'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast, initials, PageHeader, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const MODULE_COLOR = '#5C6BC0' // matches MODULE_COLORS.admin in permissions.js

export default function UserManagement({ setPage }) {
  const { can } = usePermissions()
  const { profile: myProfile } = useAuth()
  useRealtimeSubscription('profiles', null, fetchAll)
  const canEdit = can('users.edit') || can('users.create')

  const [profiles,   setProfiles]   = useState([])
  const [roles,      setRoles]      = useState([])
  const [sites,      setSites]      = useState([])
  const [userRoles,  setUserRoles]  = useState([])
  const [loading,    setLoading]    = useState(true)

  const [search,     setSearch]     = useState('')
  const [roleFilter, setRoleFilter] = useState('all')

  const [manageTarget, setManageTarget] = useState(null) // the profile being managed
  const [newRoleId,    setNewRoleId]    = useState('')
  const [newSiteId,    setNewSiteId]    = useState('ALL') // 'ALL' = every site (site_id null)
  const [adding,       setAdding]       = useState(false)
  const [revokeTarget, setRevokeTarget] = useState(null) // the user_roles row being revoked
  const [deactivateTarget, setDeactivateTarget] = useState(null) // profile pending full deactivation
  const [suspendBusy, setSuspendBusy] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [pRes, rRes, sRes, urRes] = await Promise.all([
      // '*' includes is_suspended + suspended_at
      supabase.from('profiles').select('*').order('username'),
      supabase.from('roles').select('*').order('name'),
      supabase.from('sites').select('*').eq('is_active', true).order('name'),
      supabase.from('user_roles').select('*, role:roles(id,name), site:sites(id,name,code)'),
    ])
    setProfiles(pRes.data || [])
    // Keep the open Manage modal in sync (e.g. after suspend/reactivate)
    setManageTarget(prev => prev ? ((pRes.data || []).find(p => p.id === prev.id) || prev) : prev)
    setRoles(rRes.data || [])
    setSites(sRes.data || [])
    setUserRoles(urRes.data || [])
    setLoading(false)
  }

  const rolesByUser = useMemo(() => {
    const map = {}
    userRoles.forEach(ur => {
      if (!map[ur.user_id]) map[ur.user_id] = []
      map[ur.user_id].push(ur)
    })
    return map
  }, [userRoles])

  const filteredProfiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    return profiles.filter(p => {
      if (q && !(`${p.full_name || ''} ${p.username || ''}`.toLowerCase().includes(q))) return false
      if (roleFilter !== 'all') {
        const assignments = rolesByUser[p.id] || []
        if (!assignments.some(ur => ur.role_id === roleFilter)) return false
      }
      return true
    })
  }, [profiles, rolesByUser, search, roleFilter])

  // How many OTHER user_roles rows grant "System Administrator", globally —
  // used to block removing the very last one and locking everyone out.
  function systemAdminGrantCount(excludingRowId = null) {
    return userRoles.filter(ur =>
      ur.role?.name === 'System Administrator' && ur.id !== excludingRowId
    ).length
  }

  async function addRoleAssignment() {
    if (!newRoleId) { showToast('Select a role', 'red'); return }
    setAdding(true)
    try {
      const siteId = newSiteId === 'ALL' ? null : newSiteId
      // Avoid an exact duplicate (same user + role + site combo)
      const dup = userRoles.some(ur =>
        ur.user_id === manageTarget.id &&
        ur.role_id === newRoleId &&
        (ur.site_id || null) === siteId
      )
      if (dup) { showToast('That exact role + site is already assigned', 'red'); setAdding(false); return }

      const { error } = await supabase.from('user_roles').insert({
        user_id: manageTarget.id,
        role_id: newRoleId,
        site_id: siteId,
      })
      if (error) throw error
      showToast('Role assigned', 'green')
      setNewRoleId(''); setNewSiteId('ALL')
      await fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setAdding(false)
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    // Safety net: never allow removing the last System Administrator grant
    // in the whole system — that would lock everyone out with no way back
    // in except direct database access.
    if (revokeTarget.role?.name === 'System Administrator' && systemAdminGrantCount(revokeTarget.id) === 0) {
      showToast('Cannot remove the last System Administrator — this would lock everyone out.', 'red')
      setRevokeTarget(null)
      return
    }
    const { error } = await supabase.from('user_roles').delete().eq('id', revokeTarget.id)
    if (error) { showToast(error.message, 'red'); setRevokeTarget(null); return }
    showToast('Role revoked', 'red')
    setRevokeTarget(null)
    fetchAll()
  }

  async function setSuspended(userId, suspend) {
    setSuspendBusy(true)
    try {
      const { error } = await supabase.rpc('rpc_set_user_suspended', { p_user_id: userId, p_suspend: suspend })
      if (error) throw error
      showToast(suspend ? 'User suspended — they can no longer sign in' : 'User reactivated', suspend ? 'red' : 'green')
      await fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSuspendBusy(false)
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return
    const target = deactivateTarget
    setDeactivateTarget(null)
    setSuspendBusy(true)
    try {
      const theirGrants = userRoles.filter(ur => ur.user_id === target.id)
      // Same safety net as single-role revoke: never remove the last
      // System Administrator grant in the whole system.
      const removesSysAdmin = theirGrants.some(ur => ur.role?.name === 'System Administrator')
      const remainingSysAdmins = userRoles.filter(ur =>
        ur.role?.name === 'System Administrator' && ur.user_id !== target.id
      ).length
      if (removesSysAdmin && remainingSysAdmins === 0) {
        showToast('Cannot deactivate the last System Administrator — this would lock everyone out.', 'red')
        return
      }
      if (theirGrants.length > 0) {
        const { error: revokeErr } = await supabase.from('user_roles').delete().eq('user_id', target.id)
        if (revokeErr) throw revokeErr
      }
      const { error } = await supabase.rpc('rpc_set_user_suspended', { p_user_id: target.id, p_suspend: true })
      if (error) throw error
      showToast('User deactivated — all roles revoked and sign-in blocked', 'red')
      await fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSuspendBusy(false)
    }
  }

  return (
    <div>
      <PageHeader title={<>Users & Roles <span style={{ marginLeft: '6px', padding: '1px 9px', borderRadius: '6px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed, verticalAlign: 'middle' }}>{profiles.length}</span></>} />

      {/* Note on creating brand-new accounts */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px', background: THEME.statusTertiaryBg }}>
        <Icon name="info" size={18} style={{ color: MODULE_COLOR, flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.5 }}>
          To create a brand-new login, use <strong>Supabase Dashboard → Authentication → Add User</strong> —
          that one step still needs to happen there. The moment the account exists, it shows up below automatically,
          and everything after that — assigning roles and site access — happens right here. No SQL required.
        </div>
      </Card>

      {/* Search + role filter */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or username…"
            style={{ flex: '1 1 220px', minWidth: '180px', padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: THEME.surface, color: THEME.text }}
          />
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}
            style={{ padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: THEME.surface, color: THEME.text }}>
            <option value="all">All Roles</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <span style={{ fontSize: '12px', color: THEME.textLow }}>
            {filteredProfiles.length} user{filteredProfiles.length === 1 ? '' : 's'}
          </span>
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: MODULE_COLOR }} />
        </div>
      ) : (
        <TableWrap>
          <THead color={MODULE_COLOR}>
            {['User','Roles & Site Access','Actions'].map(h => (
              <Th key={h}>{h}</Th>
            ))}
          </THead>
          <tbody>
            {filteredProfiles.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No matching users</td></tr>
            ) : filteredProfiles.map(p => {
              const assignments = rolesByUser[p.id] || []
              return (
                <TRow key={p.id}>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: p.is_suspended ? 0.55 : 1 }}>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_users" />
                      <div style={{
                        width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px', fontWeight: 700, color: '#fff', background: MODULE_COLOR,
                      }}>
                        {initials(p.full_name || p.username)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: THEME.text, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {p.full_name || p.username}
                          {p.is_suspended && (
                            <span style={{
                              padding: '1px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 700,
                              background: THEME.statusErrorBg, color: THEME.statusErrorText, letterSpacing: '0.3px',
                            }}>
                              Suspended
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '11px', color: THEME.textLow }}>@{p.username}</div>
                      </div>
                    </div>
                  </Td>
                  <Td>
                    {assignments.length === 0 ? (
                      <span style={{ color: THEME.textLow, fontSize: '12px' }}>No roles assigned</span>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {assignments.map(ur => (
                          <span key={ur.id} style={{
                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                            padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
                            background: THEME.surfaceVar, color: THEME.primary,
                          }}>
                            {ur.role?.name || '—'}
                            <span style={{ color: THEME.textLow, fontWeight: 400 }}>
                              · {ur.site?.name || 'All Sites'}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </Td>
                  <Td>
                    <Button onClick={() => setManageTarget(p)} variant="outlined" size="sm" icon="manage_accounts" disabled={!canEdit}>
                      Manage
                    </Button>
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {/* Manage Access Modal */}
      <Modal
        open={!!manageTarget}
        onClose={() => { setManageTarget(null); setNewRoleId(''); setNewSiteId('ALL') }}
        title={`Manage Access — ${manageTarget?.full_name || manageTarget?.username}`}
        footer={<Button onClick={() => setManageTarget(null)} variant="text">Close</Button>}
      >
        {manageTarget && (rolesByUser[manageTarget.id] || []).length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '8px',
            padding: '10px 12px', borderRadius: '10px', marginBottom: '14px',
            background: THEME.statusWarningBg, color: THEME.statusWarningText, fontSize: '12px', lineHeight: 1.5,
          }}>
            <Icon name="warning" size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>This user has no roles — they cannot access any module.</span>
          </div>
        )}
        <SectionLabel>Current Assignments</SectionLabel>
        <div style={{ marginBottom: '18px' }}>
          {(rolesByUser[manageTarget?.id] || []).length === 0 ? (
            <div style={{ fontSize: '13px', color: THEME.textLow, padding: '10px 0' }}>No roles assigned yet.</div>
          ) : (rolesByUser[manageTarget?.id] || []).map(ur => (
            <div key={ur.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '6px',
            }}>
              <div style={{ fontSize: '13px' }}>
                <strong style={{ color: THEME.text }}>{ur.role?.name}</strong>
                <span style={{ color: THEME.textLow }}> · {ur.site?.name || 'All Sites'}</span>
              </div>
              <button
                onClick={() => setRevokeTarget(ur)}
                title="Revoke"
                style={{ width: '26px', height: '26px', border: '1px solid #f5b8b8', borderRadius: '8px', background: THEME.surface, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="close" size={14} style={{ color: THEME.error }} />
              </button>
            </div>
          ))}
        </div>

        <SectionLabel>Add Role Assignment</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <select value={newRoleId} onChange={e => setNewRoleId(e.target.value)}
            style={{ padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="">— Select role —</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select value={newSiteId} onChange={e => setNewSiteId(e.target.value)}
            style={{ padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="ALL">All Sites</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <Button onClick={addRoleAssignment} variant="filled" icon="add" disabled={adding} style={{ width: '100%', justifyContent: 'center' }}>
          {adding ? 'Adding…' : 'Add Assignment'}
        </Button>
        <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textLow }}>
          "All Sites" means this role's permissions apply everywhere, including any site created in the future.
        </div>

        {can('users.edit') && manageTarget && manageTarget.id !== myProfile?.id && (
          <div style={{ marginTop: '22px', paddingTop: '14px', borderTop: `1px solid ${THEME.outline}` }}>
            <SectionLabel>Danger Zone</SectionLabel>
            {manageTarget.is_suspended ? (
              <>
                <Button
                  onClick={() => setSuspended(manageTarget.id, false)}
                  disabled={suspendBusy}
                  icon="how_to_reg"
                  style={{ width: '100%', justifyContent: 'center', background: THEME.statusSuccessBg, color: THEME.statusSuccessText, border: 'none' }}
                >
                  {suspendBusy ? 'Working…' : 'Reactivate user'}
                </Button>
                <div style={{ marginTop: '8px', fontSize: '11px', color: THEME.textLow }}>
                  Reactivating restores sign-in. If their roles were removed on deactivation,
                  re-assign them manually above.
                </div>
              </>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <Button
                    onClick={() => setSuspended(manageTarget.id, true)}
                    disabled={suspendBusy}
                    icon="pause_circle"
                    style={{ justifyContent: 'center', background: THEME.statusWarningBg, color: THEME.statusWarningText, border: 'none' }}
                  >
                    {suspendBusy ? 'Working…' : 'Suspend user'}
                  </Button>
                  <Button
                    onClick={() => setDeactivateTarget(manageTarget)}
                    disabled={suspendBusy}
                    icon="person_off"
                    style={{ justifyContent: 'center', background: THEME.statusErrorBg, color: THEME.statusErrorText, border: 'none' }}
                  >
                    Deactivate user
                  </Button>
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: THEME.textLow }}>
                  Suspend blocks sign-in but keeps roles. Deactivate also removes every role assignment.
                  Suspension blocks sign-in only — nothing the user recorded is deleted.
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Revoke confirm */}
      <ConfirmModal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={confirmRevoke}
        title="Revoke this role?"
        message={`Remove "${revokeTarget?.role?.name}" (${revokeTarget?.site?.name || 'All Sites'}) from ${manageTarget?.full_name || manageTarget?.username}?`}
        confirmLabel="Revoke"
        danger
      />

      {/* Deactivate confirm */}
      <ConfirmModal
        open={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        title="Deactivate this user?"
        message="Deactivate this user? They will be signed out and lose all role access. Everything they ever recorded stays intact."
        confirmLabel="Deactivate"
        danger
      />
    </div>
  )
}
