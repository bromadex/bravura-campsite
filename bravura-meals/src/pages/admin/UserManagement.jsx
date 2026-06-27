import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast, initials } from '../../components/ui'

const MODULE_COLOR = '#5C6BC0' // matches MODULE_COLORS.admin in permissions.js

export default function UserManagement() {
  const { can } = usePermissions()
  const canEdit = can('users.edit') || can('users.create')

  const [profiles,   setProfiles]   = useState([])
  const [roles,      setRoles]      = useState([])
  const [sites,      setSites]      = useState([])
  const [userRoles,  setUserRoles]  = useState([])
  const [loading,    setLoading]    = useState(true)

  const [manageTarget, setManageTarget] = useState(null) // the profile being managed
  const [newRoleId,    setNewRoleId]    = useState('')
  const [newSiteId,    setNewSiteId]    = useState('ALL') // 'ALL' = every site (site_id null)
  const [adding,       setAdding]       = useState(false)
  const [revokeTarget, setRevokeTarget] = useState(null) // the user_roles row being revoked

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [pRes, rRes, sRes, urRes] = await Promise.all([
      supabase.from('profiles').select('*').order('username'),
      supabase.from('roles').select('*').order('name'),
      supabase.from('sites').select('*').eq('is_active', true).order('name'),
      supabase.from('user_roles').select('*, role:roles(id,name), site:sites(id,name,code)'),
    ])
    setProfiles(pRes.data || [])
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

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>
          Users & Roles
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '20px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed }}>
            {profiles.length}
          </span>
        </h2>
      </div>

      {/* Note on creating brand-new accounts */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px', background: THEME.statusTertiaryBg }}>
        <Icon name="info" size={18} style={{ color: MODULE_COLOR, flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.5 }}>
          To create a brand-new login, use <strong>Supabase Dashboard → Authentication → Add User</strong> —
          that one step still needs to happen there. The moment the account exists, it shows up below automatically,
          and everything after that — assigning roles and site access — happens right here. No SQL required.
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: MODULE_COLOR }} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '16px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: THEME.surface }}>
            <thead>
              <tr style={{ background: MODULE_COLOR, color: '#fff' }}>
                {['User','Roles & Site Access','Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => {
                const assignments = rolesByUser[p.id] || []
                return (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = THEME.surface}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '12px', fontWeight: 700, color: '#fff', background: MODULE_COLOR,
                        }}>
                          {initials(p.full_name || p.username)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: THEME.text }}>{p.full_name || p.username}</div>
                          <div style={{ fontSize: '11px', color: THEME.textLow }}>@{p.username}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      {assignments.length === 0 ? (
                        <span style={{ color: THEME.textLow, fontSize: '12px' }}>No roles assigned</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {assignments.map(ur => (
                            <span key={ur.id} style={{
                              display: 'inline-flex', alignItems: 'center', gap: '5px',
                              padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
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
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <Button onClick={() => setManageTarget(p)} variant="outlined" size="sm" icon="manage_accounts" disabled={!canEdit}>
                        Manage
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Manage Access Modal */}
      <Modal
        open={!!manageTarget}
        onClose={() => { setManageTarget(null); setNewRoleId(''); setNewSiteId('ALL') }}
        title={`Manage Access — ${manageTarget?.full_name || manageTarget?.username}`}
        footer={<Button onClick={() => setManageTarget(null)} variant="text">Close</Button>}
      >
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
    </div>
  )
}
