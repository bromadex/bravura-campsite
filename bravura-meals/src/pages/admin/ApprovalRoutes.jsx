import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, Modal, ConfirmModal, Icon, showToast, PageHeader } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import Denied from '../../components/Denied'
import { ENTITY_LABELS, formatAmount } from '../notifications/ApprovalsInbox'

const MODULE_COLOR = '#5C6BC0'

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }

const APPROVER_TYPES = [
  { id: 'permission',   label: 'Anyone with a permission' },
  { id: 'user',         label: 'A specific person' },
  { id: 'line_manager', label: "The requester's line manager" },
]

const EMPTY_ROUTE = { name: '', entity_type: 'purchase_orders', department_id: '', min_amount: '0', max_amount: '', priority: '0', is_active: true }
const EMPTY_STEP = { label: '', approver_type: 'permission', approver_permission: '', approver_user_id: '' }

export default function ApprovalRoutes({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const canEdit = can('approvals.edit')

  const [routes, setRoutes] = useState([])
  const [steps, setSteps] = useState({})
  const [departments, setDepartments] = useState([])
  const [perms, setPerms] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)       // route draft
  const [draftSteps, setDraftSteps] = useState([])
  const [saving, setSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState(null)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [rt, dp, pm, ur] = await Promise.all([
      supabase.from('approval_routes').select('*').eq('site_id', currentSiteId).eq('is_archived', false)
        .order('entity_type').order('min_amount'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
      supabase.from('permissions').select('code, description').order('code'),
      supabase.from('user_roles').select('user_id, profile:profiles!user_roles_user_id_fkey(id, full_name, username)')
        .or(`site_id.eq.${currentSiteId},site_id.is.null`),
    ])
    if (rt.error) showToast('Failed to load routes', 'red')
    const list = rt.data || []
    setRoutes(list)
    setDepartments(dp.data || [])
    setPerms(pm.data || [])
    const seen = new Map()
    ;(ur.data || []).forEach(u => { if (u.profile && !seen.has(u.profile.id)) seen.set(u.profile.id, u.profile) })
    setUsers([...seen.values()].sort((a, b) => (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '')))
    if (list.length) {
      const { data: st } = await supabase.from('approval_route_steps').select('*')
        .in('route_id', list.map(r => r.id)).eq('is_archived', false).order('step_order')
      const byRoute = {}
      ;(st || []).forEach(s => { (byRoute[s.route_id] ||= []).push(s) })
      setSteps(byRoute)
    } else setSteps({})
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  const userName = useMemo(() => Object.fromEntries(users.map(u => [u.id, u.full_name || u.username])), [users])
  const deptName = useMemo(() => Object.fromEntries(departments.map(d => [d.id, d.name])), [departments])

  function openNew() {
    setEditing({ ...EMPTY_ROUTE })
    setDraftSteps([{ ...EMPTY_STEP }])
  }

  function openEdit(r) {
    setEditing({
      id: r.id, name: r.name, entity_type: r.entity_type, department_id: r.department_id || '',
      min_amount: String(r.min_amount ?? 0), max_amount: r.max_amount == null ? '' : String(r.max_amount),
      priority: String(r.priority ?? 0), is_active: r.is_active,
    })
    setDraftSteps((steps[r.id] || []).map(s => ({
      label: s.label, approver_type: s.approver_type,
      approver_permission: s.approver_permission || '', approver_user_id: s.approver_user_id || '',
    })))
  }

  function setStep(i, patch) { setDraftSteps(d => d.map((s, j) => j === i ? { ...s, ...patch } : s)) }
  function moveStep(i, dir) {
    setDraftSteps(d => {
      const n = [...d]; const j = i + dir
      if (j < 0 || j >= n.length) return d
      ;[n[i], n[j]] = [n[j], n[i]]; return n
    })
  }

  async function save() {
    const e = editing
    if (!e.name.trim()) { showToast('Give the route a name', 'red'); return }
    if (!draftSteps.length) { showToast('Add at least one approval step', 'red'); return }
    for (const [i, s] of draftSteps.entries()) {
      if (!s.label.trim()) { showToast(`Step ${i + 1} needs a label`, 'red'); return }
      if (s.approver_type === 'permission' && !s.approver_permission) { showToast(`Step ${i + 1}: pick a permission`, 'red'); return }
      if (s.approver_type === 'user' && !s.approver_user_id) { showToast(`Step ${i + 1}: pick a person`, 'red'); return }
    }
    const min = Number(e.min_amount || 0), max = e.max_amount === '' ? null : Number(e.max_amount)
    if (max != null && max < min) { showToast('The upper limit must be above the lower limit', 'red'); return }

    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const row = {
      site_id: currentSiteId, name: e.name.trim(), entity_type: e.entity_type,
      department_id: e.department_id || null, min_amount: min, max_amount: max,
      priority: Number(e.priority || 0), is_active: e.is_active, updated_at: new Date().toISOString(),
    }
    let routeId = e.id
    if (routeId) {
      const { error } = await supabase.from('approval_routes').update(row).eq('id', routeId).eq('site_id', currentSiteId)
      if (error) { setSaving(false); showToast(error.message, 'red'); return }
      // Replace the step set: old steps are archived, never deleted.
      const { error: archErr } = await supabase.from('approval_route_steps').update({ is_archived: true })
        .eq('route_id', routeId).eq('is_archived', false)
      if (archErr) { setSaving(false); showToast(archErr.message, 'red'); return }
    } else {
      const { data, error } = await supabase.from('approval_routes').insert({ ...row, created_by: user?.id }).select('id').single()
      if (error) { setSaving(false); showToast(error.message, 'red'); return }
      routeId = data.id
    }
    const { error: stepErr } = await supabase.from('approval_route_steps').insert(draftSteps.map((s, i) => ({
      route_id: routeId, step_order: i + 1, label: s.label.trim(), approver_type: s.approver_type,
      approver_permission: s.approver_type === 'permission' ? s.approver_permission : null,
      approver_user_id: s.approver_type === 'user' ? s.approver_user_id : null,
    })))
    setSaving(false)
    if (stepErr) { showToast(stepErr.message, 'red'); return }
    showToast('Approval route saved', 'green')
    setEditing(null)
    load()
  }

  async function archive() {
    const { error } = await supabase.from('approval_routes').update({ is_archived: true, is_active: false, updated_at: new Date().toISOString() })
      .eq('id', archiveTarget.id).eq('site_id', currentSiteId)
    setArchiveTarget(null)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Route archived — requests already in progress finish on their current steps', 'green')
    load()
  }

  if (!can('approvals.view') && !canEdit) return <Denied />

  const grouped = Object.keys(ENTITY_LABELS).map(k => ({ key: k, routes: routes.filter(r => r.entity_type === k) }))
  const unit = ENTITY_LABELS[editing?.entity_type]?.unit

  return (
    <div>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_approval_routes" />
      <PageHeader title="Approval Routes"
        actions={canEdit && <Button onClick={openNew} icon="add" style={{ background: MODULE_COLOR, color: '#fff' }}>New route</Button>} />

      <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px', background: THEME.statusInfoBg }}>
        <Icon name="info" size={18} style={{ color: MODULE_COLOR, flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.6 }}>
          When a document matches a route, it must pass every step in order before it is approved — the module's own Approve
          button is locked and approvers act from the Approvals inbox. Nobody can approve their own request.
          Documents that match no route keep today's single-approver flow. A department-specific route wins over a general one;
          otherwise the higher priority wins.
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: MODULE_COLOR }} /></div>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {grouped.map(g => (
            <div key={g.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Icon name={ENTITY_LABELS[g.key].icon} size={18} style={{ color: MODULE_COLOR }} />
                <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{ENTITY_LABELS[g.key].label}s</div>
                <div style={{ fontSize: '12px', color: THEME.textLow }}>{g.routes.length ? `${g.routes.length} route${g.routes.length > 1 ? 's' : ''}` : 'no routes — single approver as today'}</div>
              </div>
              {g.routes.map(r => (
                <Card key={r.id} style={{ padding: '12px 16px', marginBottom: '8px', opacity: r.is_active ? 1 : 0.6 }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 240px' }}>
                      <div style={{ fontWeight: 600, color: THEME.text }}>{r.name}{!r.is_active && <span style={{ fontWeight: 400, color: THEME.textLow }}> · paused</span>}</div>
                      <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px' }}>
                        {formatAmount(r.entity_type, r.min_amount)} {r.max_amount == null ? 'and above' : `to ${formatAmount(r.entity_type, r.max_amount)}`}
                        {' · '}{r.department_id ? deptName[r.department_id] || 'one department' : 'all departments'}
                        {r.priority ? ` · priority ${r.priority}` : ''}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', alignItems: 'center' }}>
                        {(steps[r.id] || []).map((s, i) => (
                          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {i > 0 && <Icon name="arrow_forward" size={14} style={{ color: THEME.textLow }} />}
                            <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '12px', background: THEME.surfaceVar, color: THEME.text }}>
                              {s.step_order}. {s.label}
                              <span style={{ color: THEME.textLow }}>
                                {' — '}{s.approver_type === 'user' ? userName[s.approver_user_id] || 'person'
                                  : s.approver_type === 'line_manager' ? 'line manager' : s.approver_permission}
                              </span>
                            </span>
                          </span>
                        ))}
                      </div>
                    </div>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <Button size="sm" variant="outlined" icon="edit" onClick={() => openEdit(r)}>Edit</Button>
                        <Button size="sm" variant="text" icon="archive" onClick={() => setArchiveTarget(r)} style={{ color: THEME.error }}>Archive</Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          ))}
        </div>
      )}

      <Modal dirty={true} open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit approval route' : 'New approval route'}
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button variant="text" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving} style={{ background: MODULE_COLOR, color: '#fff' }}>{saving ? 'Saving…' : 'Save route'}</Button>
          </div>
        }>
        {editing && (
          <div style={{ display: 'grid', gap: '12px' }}>
            <div>
              <label htmlFor="ar-name" style={lbl}>Name *</label>
              <input id="ar-name" style={inp} value={editing.name} placeholder="e.g. Purchase orders over $5,000"
                onChange={e => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="ar-entity" style={lbl}>Document</label>
                <select id="ar-entity" style={inp} value={editing.entity_type} disabled={!!editing.id}
                  onChange={e => setEditing({ ...editing, entity_type: e.target.value })}>
                  {Object.entries(ENTITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 180px' }}>
                <label htmlFor="ar-dept" style={lbl}>Department</label>
                <select id="ar-dept" style={inp} value={editing.department_id} onChange={e => setEditing({ ...editing, department_id: e.target.value })}>
                  <option value="">All departments</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 120px' }}>
                <label htmlFor="ar-min" style={lbl}>From ({unit})</label>
                <input id="ar-min" type="number" step="0.01" style={inp} value={editing.min_amount} onChange={e => setEditing({ ...editing, min_amount: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 120px' }}>
                <label htmlFor="ar-max" style={lbl}>Up to ({unit})</label>
                <input id="ar-max" type="number" step="0.01" style={inp} value={editing.max_amount} placeholder="No limit" onChange={e => setEditing({ ...editing, max_amount: e.target.value })} />
              </div>
              <div style={{ flex: '1 1 90px' }}>
                <label htmlFor="ar-priority" style={lbl}>Priority</label>
                <input id="ar-priority" type="number" style={inp} value={editing.priority} onChange={e => setEditing({ ...editing, priority: e.target.value })} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: THEME.textMed }}>
              <input id="ar-active" type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
              Route is active
            </label>

            <div>
              <div style={{ ...lbl, marginBottom: '8px' }}>Steps (in order)</div>
              <div style={{ display: 'grid', gap: '8px' }}>
                {draftSteps.map((s, i) => (
                  <div key={i} style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px', padding: '10px', display: 'grid', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, color: MODULE_COLOR, minWidth: '20px' }}>{i + 1}.</span>
                      <input id={`step-${i}-label`} aria-label={`Step ${i + 1} label`} style={inp} value={s.label} placeholder="e.g. Finance manager"
                        onChange={e => setStep(i, { label: e.target.value })} />
                      <Button size="sm" variant="text" icon="arrow_upward" onClick={() => moveStep(i, -1)} disabled={i === 0} />
                      <Button size="sm" variant="text" icon="arrow_downward" onClick={() => moveStep(i, 1)} disabled={i === draftSteps.length - 1} />
                      <Button size="sm" variant="text" icon="close" onClick={() => setDraftSteps(d => d.filter((_, j) => j !== i))} style={{ color: THEME.error }} />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <select id={`step-${i}-type`} aria-label={`Step ${i + 1} approver type`} style={{ ...inp, flex: '1 1 180px', width: 'auto' }}
                        value={s.approver_type} onChange={e => setStep(i, { approver_type: e.target.value })}>
                        {APPROVER_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                      {s.approver_type === 'permission' && (
                        <select id={`step-${i}-perm`} aria-label={`Step ${i + 1} permission`} style={{ ...inp, flex: '1 1 180px', width: 'auto' }}
                          value={s.approver_permission} onChange={e => setStep(i, { approver_permission: e.target.value })}>
                          <option value="">Choose permission…</option>
                          {perms.map(p => <option key={p.code} value={p.code}>{p.code}{p.description ? ` — ${p.description}` : ''}</option>)}
                        </select>
                      )}
                      {s.approver_type === 'user' && (
                        <select id={`step-${i}-user`} aria-label={`Step ${i + 1} person`} style={{ ...inp, flex: '1 1 180px', width: 'auto' }}
                          value={s.approver_user_id} onChange={e => setStep(i, { approver_user_id: e.target.value })}>
                          <option value="">Choose person…</option>
                          {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                        </select>
                      )}
                      {s.approver_type === 'line_manager' && (
                        <div style={{ fontSize: '12px', color: THEME.textLow, alignSelf: 'center' }}>Skipped when the requester has no manager on their employee record.</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="tonal" icon="add" style={{ marginTop: '8px' }} onClick={() => setDraftSteps(d => [...d, { ...EMPTY_STEP }])}>Add step</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!archiveTarget} onClose={() => setArchiveTarget(null)} onConfirm={archive}
        title="Archive route" confirmLabel="Archive" confirmColor={THEME.error}
        message={`Archive "${archiveTarget?.name}"? New documents will no longer use it; requests already in progress finish on their current steps.`} />
    </div>
  )
}
