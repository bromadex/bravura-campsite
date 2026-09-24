import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, Modal, ConfirmModal, Icon, showToast, PageHeader, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const MODULE_COLOR = '#5C6BC0'

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

const STATUS_BADGE = {
  pending: { bg: THEME.surfaceVar, color: THEME.textMed, label: 'Pre-authorized' },
  invited: { bg: '#E3F2FD', color: '#1565C0', label: 'Invite Sent' },
  accepted: { bg: '#E8F5E9', color: '#2E7D32', label: 'Accepted' },
  revoked: { bg: '#FFEBEE', color: '#C62828', label: 'Revoked' },
}

export default function PendingInvitations({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [tick, setTick] = useState(0)
  useRealtimeSubscription('pending_role_assignments', {}, () => setTick(t => t + 1))
  const canView = can('users.view')
  const canEdit = can('users.edit')

  const [invitations, setInvitations] = useState([])
  const [roles, setRoles] = useState([])
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState(null)
  const [resendTarget, setResendTarget] = useState(null)

  const [form, setForm] = useState({ email: '', full_name: '', username: '', role_id: '', site_id: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [tick])

  async function fetchAll() {
    setLoading(true)
    const [invRes, roleRes, siteRes] = await Promise.all([
      supabase.from('pending_role_assignments').select('*, role:roles(id, name), site:sites(id, name)')
        .eq('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase.from('roles').select('id, name').order('name'),
      supabase.from('sites').select('id, name').order('name'),
    ])
    setInvitations(invRes.data || [])
    setRoles(roleRes.data || [])
    setSites(siteRes.data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.email || !form.role_id) {
      showToast('Email and Role are required', 'red')
      return
    }
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: form.email.trim().toLowerCase(),
          full_name: form.full_name.trim() || null,
          username: form.username.trim() || null,
          role_id: form.role_id,
          site_id: form.site_id || null,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      showToast(data?.message || 'Invitation sent', 'green')
      setShowAdd(false)
      setForm({ email: '', full_name: '', username: '', role_id: '', site_id: '' })
      fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return
    const { error } = await supabase.from('pending_role_assignments')
      .update({ is_archived: true, status: 'revoked' })
      .eq('id', revokeTarget.id)
    if (error) { showToast(error.message, 'red'); setRevokeTarget(null); return }
    showToast('Invitation revoked', 'red')
    setRevokeTarget(null)
    fetchAll()
  }

  async function handleResend() {
    if (!resendTarget) return
    setSaving(true)
    try {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          email: resendTarget.email,
          full_name: resendTarget.full_name || null,
          username: resendTarget.username || null,
          role_id: resendTarget.role_id,
          site_id: resendTarget.site_id || null,
        },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      showToast('Invitation resent', 'green')
      setResendTarget(null)
      fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_invitations" />
      <PageHeader
        title={<>Pending Invitations <span style={{ marginLeft: '6px', padding: '1px 9px', borderRadius: '6px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed, verticalAlign: 'middle' }}>{invitations.length}</span></>}
        actions={canEdit && <Button onClick={() => setShowAdd(true)} icon="person_add" style={{ background: MODULE_COLOR, color: '#fff' }}>Invite User</Button>}
      />

      <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px', background: THEME.statusInfoBg }}>
        <Icon name="info" size={18} style={{ color: MODULE_COLOR, flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.5 }}>
          Invite users by email. They'll receive a magic link to set up their account. Their role and site will be assigned automatically when they accept.
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
            {['Email', 'Full Name', 'Role', 'Site', 'Status', 'Invited', 'Actions'].map(h => (
              <Th key={h}>{h}</Th>
            ))}
          </THead>
          <tbody>
            {invitations.map(inv => {
              const badge = STATUS_BADGE[inv.status] || STATUS_BADGE.pending
              return (
                <TRow key={inv.id}>
                  <Td><span style={{ fontWeight: 600, color: THEME.text }}>{inv.email}</span></Td>
                  <Td>{inv.full_name || <span style={{ color: THEME.textLow }}>—</span>}</Td>
                  <Td>
                    <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: THEME.surfaceVar, color: THEME.primary }}>
                      {inv.role?.name || '—'}
                    </span>
                  </Td>
                  <Td style={{ fontSize: '12px' }}>{inv.site?.name || <span style={{ color: THEME.textLow }}>—</span>}</Td>
                  <Td>
                    <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: badge.bg, color: badge.color }}>
                      {badge.label}
                    </span>
                  </Td>
                  <Td style={{ fontSize: '12px', color: THEME.textLow }}>
                    {inv.invited_at ? new Date(inv.invited_at).toLocaleDateString() : new Date(inv.created_at).toLocaleDateString()}
                  </Td>
                  <Td>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {inv.status === 'invited' && canEdit && (
                        <Button onClick={() => setResendTarget(inv)} variant="outlined" size="sm" icon="send"
                          style={{ color: MODULE_COLOR, borderColor: MODULE_COLOR }}>
                          Resend
                        </Button>
                      )}
                      {canEdit && (
                        <Button onClick={() => setRevokeTarget(inv)} variant="outlined" size="sm" icon="close"
                          style={{ color: THEME.error, borderColor: THEME.error }}>
                          Revoke
                        </Button>
                      )}
                    </div>
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {/* Invite User Modal */}
      <Modal dirty={true}
        open={showAdd}
        onClose={() => { setShowAdd(false); setForm({ email: '', full_name: '', username: '', role_id: '', site_id: '' }) }}
        title="Invite User"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button onClick={() => setShowAdd(false)} variant="text">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} style={{ background: MODULE_COLOR, color: '#fff' }}>
              {saving ? 'Sending...' : 'Send Invite'}
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
        <div style={fieldWrap}>
          <label style={lbl}>Site</label>
          <select style={inp} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })}>
            <option value="">All sites (assign later)</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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

      {/* Resend Confirmation */}
      <ConfirmModal
        open={!!resendTarget}
        onClose={() => setResendTarget(null)}
        onConfirm={handleResend}
        title="Resend Invitation"
        message={`Resend the invitation email to ${resendTarget?.email}?`}
        confirmLabel="Resend"
        confirmColor={MODULE_COLOR}
      />
    </div>
  )
}
