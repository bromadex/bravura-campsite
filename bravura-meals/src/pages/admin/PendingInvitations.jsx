import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Button, Modal, ConfirmModal, Icon, showToast, PageHeader, TableWrap, THead, Th, TRow, Td } from '../../components/ui'

const MODULE_COLOR = '#5C6BC0'

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

export default function PendingInvitations() {
  const { can } = usePermissions()
  const canView = can('users.view')
  const canEdit = can('users.edit')

  const [invitations, setInvitations] = useState([])
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState(null)

  const [form, setForm] = useState({ email: '', full_name: '', username: '', role_id: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [invRes, roleRes] = await Promise.all([
      supabase.from('pending_role_assignments').select('*, role:roles(id, name)').order('created_at', { ascending: false }),
      supabase.from('roles').select('id, name').order('name'),
    ])
    setInvitations(invRes.data || [])
    setRoles(roleRes.data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.email || !form.role_id) {
      showToast('Email and Role are required', 'red')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('pending_role_assignments').insert({
        email: form.email.trim().toLowerCase(),
        full_name: form.full_name.trim() || null,
        username: form.username.trim() || null,
        role_id: form.role_id,
      })
      if (error) throw error
      showToast('Invitation added', 'green')
      setShowAdd(false)
      setForm({ email: '', full_name: '', username: '', role_id: '' })
      fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    const { error } = await supabase.from('pending_role_assignments').delete().eq('id', revokeTarget.id)
    if (error) { showToast(error.message, 'red'); setRevokeTarget(null); return }
    showToast('Invitation revoked', 'red')
    setRevokeTarget(null)
    fetchAll()
  }

  if (!canView) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div>
      <PageHeader
        title={<>Pending Invitations <span style={{ marginLeft: '6px', padding: '1px 9px', borderRadius: '6px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed, verticalAlign: 'middle' }}>{invitations.length}</span></>}
        action={canEdit && <Button onClick={() => setShowAdd(true)} icon="person_add" style={{ background: MODULE_COLOR, color: '#fff' }}>Add Invitation</Button>}
      />

      <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px', background: THEME.statusInfoBg }}>
        <Icon name="info" size={18} style={{ color: MODULE_COLOR, flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.5 }}>
          Pre-authorize role assignments for users who haven't signed up yet. When they create an account with a matching email, their role will be automatically assigned.
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: MODULE_COLOR }} />
        </div>
      ) : invitations.length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="mail" size={32} style={{ color: THEME.outlineVar, marginBottom: '8px' }} />
          <div style={{ fontSize: '13px' }}>No pending invitations</div>
        </Card>
      ) : (
        <TableWrap>
          <THead color={MODULE_COLOR}>
            {['Email', 'Full Name', 'Username', 'Role', 'Created', 'Actions'].map(h => (
              <Th key={h}>{h}</Th>
            ))}
          </THead>
          <tbody>
            {invitations.map(inv => (
              <TRow key={inv.id}>
                <Td><span style={{ fontWeight: 600, color: THEME.text }}>{inv.email}</span></Td>
                <Td>{inv.full_name || <span style={{ color: THEME.textLow }}>—</span>}</Td>
                <Td>{inv.username || <span style={{ color: THEME.textLow }}>—</span>}</Td>
                <Td>
                  <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: THEME.surfaceVar, color: THEME.primary }}>
                    {inv.role?.name || '—'}
                  </span>
                </Td>
                <Td style={{ fontSize: '12px', color: THEME.textLow }}>{new Date(inv.created_at).toLocaleDateString()}</Td>
                <Td>
                  <Button onClick={() => setRevokeTarget(inv)} variant="outlined" size="sm" icon="close" disabled={!canEdit}
                    style={{ color: THEME.error, borderColor: THEME.error }}>
                    Revoke
                  </Button>
                </Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      {/* Add Invitation Modal */}
      <Modal
        open={showAdd}
        onClose={() => { setShowAdd(false); setForm({ email: '', full_name: '', username: '', role_id: '' }) }}
        title="Add Pending Invitation"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button onClick={() => setShowAdd(false)} variant="text">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} style={{ background: MODULE_COLOR, color: '#fff' }}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        }
      >
        <div style={fieldWrap}>
          <label style={lbl}>Email *</label>
          <input style={inp} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
        </div>
        <div style={fieldWrap}>
          <label style={lbl}>Full Name</label>
          <input style={inp} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} placeholder="John Smith" />
        </div>
        <div style={fieldWrap}>
          <label style={lbl}>Username</label>
          <input style={inp} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="jsmith" />
        </div>
        <div style={fieldWrap}>
          <label style={lbl}>Role *</label>
          <select style={inp} value={form.role_id} onChange={e => setForm({ ...form, role_id: e.target.value })}>
            <option value="">Select a role...</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </Modal>

      {/* Revoke Confirmation */}
      <ConfirmModal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title="Revoke Invitation"
        message={`Remove the pending invitation for ${revokeTarget?.email}? This cannot be undone.`}
        confirmLabel="Revoke"
        confirmColor={THEME.error}
      />
    </div>
  )
}
