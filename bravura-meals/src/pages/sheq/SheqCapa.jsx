import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const SOURCE_TYPES = ['incident','inspection','audit','near_miss','hazard','environmental','management_review','contractor_assessment','observation','other']
const ACTION_TYPES = ['corrective', 'preventive']
const PRIORITIES = ['low', 'medium', 'high', 'critical']
const STATUSES = ['open', 'in_progress', 'verification', 'closed', 'overdue']
const STATUS_TABS = ['all', 'open', 'in_progress', 'verification', 'closed', 'overdue']

const PRIORITY_COLORS = { low: '#2E7D32', medium: '#F59E0B', high: '#E65100', critical: '#D32F2F' }
const STATUS_COLORS = { open: '#9E9E9E', in_progress: '#1565C0', verification: '#F59E0B', closed: '#2E7D32', overdue: '#D32F2F' }

const STATUS_LABELS = { all: 'All', open: 'Open', in_progress: 'In Progress', verification: 'Verification', closed: 'Closed', overdue: 'Overdue' }
const SOURCE_LABELS = {
  incident: 'Incident', inspection: 'Inspection', audit: 'Audit', near_miss: 'Near Miss',
  hazard: 'Hazard', environmental: 'Environmental', management_review: 'Management Review',
  contractor_assessment: 'Contractor Assessment', observation: 'Observation', other: 'Other',
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const lbl = { fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }

function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: '6px',
      fontSize: '11px', fontWeight: 600, background: color + '18', color,
    }}>
      {label}
    </span>
  )
}

function Field({ label, children, required }) {
  return (
    <div>
      <div style={lbl}>{label}{required && <span style={{ color: THEME.error }}> *</span>}</div>
      {children}
    </div>
  )
}

function isOverdue(row) {
  if (row.status === 'closed') return false
  if (!row.due_date) return false
  return new Date(row.due_date) < new Date(new Date().toISOString().slice(0, 10))
}

function displayStatus(row) {
  if (isOverdue(row)) return 'overdue'
  return row.status
}

// ── Create/Edit Modal ───────────────────────────────────────────────────────

function CapaModal({ capa, profiles, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!capa
  const [form, setForm] = useState(() => {
    if (capa) return {
      source_type: capa.source_type || 'incident',
      source_ref: capa.source_ref || '',
      action_type: capa.action_type || 'corrective',
      description: capa.description || '',
      priority: capa.priority || 'medium',
      assigned_to: capa.assigned_to || '',
      due_date: capa.due_date || '',
      evidence_notes: capa.evidence_notes || '',
      completed_date: capa.completed_date || '',
      verification_notes: capa.verification_notes || '',
      verification_date: capa.verification_date || '',
    }
    return {
      source_type: 'incident', source_ref: '', action_type: 'corrective',
      description: '', priority: 'medium', assigned_to: '', due_date: '',
      evidence_notes: '', completed_date: '', verification_notes: '', verification_date: '',
    }
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  const currentStatus = capa?.status || 'open'
  const ds = isOverdue(capa || {}) ? 'overdue' : currentStatus

  async function handleSave() {
    if (!form.description || !form.due_date) {
      showToast('Description and due date are required', 'error'); return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const update = {
          source_type: form.source_type,
          source_ref: form.source_ref || null,
          action_type: form.action_type,
          description: form.description,
          priority: form.priority,
          assigned_to: form.assigned_to || null,
          due_date: form.due_date,
          evidence_notes: form.evidence_notes || null,
          completed_date: form.completed_date || null,
          verification_notes: form.verification_notes || null,
          verification_date: form.verification_date || null,
          updated_at: new Date().toISOString(),
        }
        const { error } = await supabase.from('sheq_capa').update(update).eq('id', capa.id).eq('site_id', siteId)
        if (error) throw error
        showToast('CAPA updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'CAPA', p_table: 'sheq_capa',
        })
        if (numErr) throw numErr
        const { error } = await supabase.from('sheq_capa').insert({
          site_id: siteId,
          capa_number: numData,
          source_type: form.source_type,
          source_ref: form.source_ref || null,
          action_type: form.action_type,
          description: form.description,
          priority: form.priority,
          status: 'open',
          owner_id: userId,
          assigned_to: form.assigned_to || null,
          due_date: form.due_date,
        })
        if (error) throw error
        showToast('CAPA created')
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTransition(newStatus) {
    setSaving(true)
    try {
      const update = { status: newStatus, updated_at: new Date().toISOString() }
      if (newStatus === 'verification' && form.evidence_notes) {
        update.evidence_notes = form.evidence_notes
        update.completed_date = form.completed_date || new Date().toISOString().slice(0, 10)
      }
      if (newStatus === 'closed') {
        update.verification_notes = form.verification_notes
        update.verification_date = form.verification_date || new Date().toISOString().slice(0, 10)
        update.verification_by = userId
      }
      const { error } = await supabase.from('sheq_capa').update(update).eq('id', capa.id).eq('site_id', siteId)
      if (error) throw error
      showToast(`Status changed to ${STATUS_LABELS[newStatus]}`)
      onSaved()
    } catch (err) {
      showToast(err.message || 'Transition failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${capa.capa_number}` : 'New CAPA'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Source Type" required>
              <select style={selectStyle} value={form.source_type} onChange={e => set('source_type', e.target.value)}>
                {SOURCE_TYPES.map(s => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
              </select>
            </Field>
            <Field label="Source Reference">
              <input style={inputStyle} value={form.source_ref} onChange={e => set('source_ref', e.target.value)} placeholder="e.g. INC-001" />
            </Field>
          </div>

          <Field label="Action Type" required>
            <div style={{ display: 'flex', gap: '16px' }}>
              {ACTION_TYPES.map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.text, cursor: 'pointer' }}>
                  <input type="radio" name="action_type" checked={form.action_type === t} onChange={() => set('action_type', t)} />
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </label>
              ))}
            </div>
          </Field>

          <Field label="Description" required>
            <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Priority" required>
              <select style={selectStyle} value={form.priority} onChange={e => set('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </Field>
            <Field label="Assigned To">
              <select style={selectStyle} value={form.assigned_to} onChange={e => set('assigned_to', e.target.value)}>
                <option value="">Unassigned</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.employee_number} — {p.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Due Date" required>
            <input style={inputStyle} type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </Field>

          {/* Evidence section — for completing (moving to verification) */}
          {isEdit && (currentStatus === 'in_progress' || currentStatus === 'open') && (
            <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '14px', border: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', marginBottom: '8px' }}>
                Evidence (for completion)
              </div>
              <Field label="Evidence Notes">
                <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.evidence_notes} onChange={e => set('evidence_notes', e.target.value)} />
              </Field>
              <div style={{ marginTop: '8px' }}>
                <Field label="Completed Date">
                  <input style={inputStyle} type="date" value={form.completed_date} onChange={e => set('completed_date', e.target.value)} />
                </Field>
              </div>
            </div>
          )}

          {/* Verification section — for verifying (moving to closed) */}
          {isEdit && currentStatus === 'verification' && canApprove && (
            <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '14px', border: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', marginBottom: '8px' }}>
                Verification
              </div>
              <Field label="Verification Notes">
                <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.verification_notes} onChange={e => set('verification_notes', e.target.value)} />
              </Field>
              <div style={{ marginTop: '8px' }}>
                <Field label="Verification Date">
                  <input style={inputStyle} type="date" value={form.verification_date} onChange={e => set('verification_date', e.target.value)} />
                </Field>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {/* Status transitions */}
          {isEdit && currentStatus === 'open' && (
            <Button variant="ghost" onClick={() => handleTransition('in_progress')} disabled={saving} icon="play_arrow">
              Start Progress
            </Button>
          )}
          {isEdit && currentStatus === 'in_progress' && (
            <Button variant="ghost" onClick={() => handleTransition('verification')} disabled={saving} icon="check">
              Submit for Verification
            </Button>
          )}
          {isEdit && currentStatus === 'verification' && canApprove && (
            <Button variant="ghost" onClick={() => handleTransition('closed')} disabled={saving} icon="verified">
              Verify & Close
            </Button>
          )}

          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create CAPA'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function SheqCapa({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [profiles, setProfiles] = useState([])

  const canView = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit = can('sheq.edit')
  const canApprove = can('sheq.approve')

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data, error }, { data: profs }] = await Promise.all([
      supabase
        .from('sheq_capa')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setProfiles(profs || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData])

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  // KPI calculations
  const kpis = useMemo(() => {
    const openCount = rows.filter(r => r.status === 'open' || r.status === 'in_progress' || r.status === 'verification').length
    const overdueCount = rows.filter(r => isOverdue(r)).length
    const closed = rows.filter(r => r.status === 'closed')
    const closureRate = rows.length > 0 ? ((closed.length / rows.length) * 100).toFixed(1) : '0.0'
    const avgDays = closed.length > 0
      ? (closed.reduce((sum, r) => {
          const created = new Date(r.created_at)
          const completed = r.completed_date ? new Date(r.completed_date) : new Date(r.updated_at)
          return sum + Math.max(0, (completed - created) / 86400000)
        }, 0) / closed.length).toFixed(1)
      : '--'
    return { openCount, overdueCount, avgDays, closureRate }
  }, [rows])

  // Filtering
  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter !== 'all') {
      if (statusFilter === 'overdue') {
        list = list.filter(r => isOverdue(r))
      } else {
        list = list.filter(r => r.status === statusFilter && !isOverdue(r))
      }
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.capa_number?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: rows.length, open: 0, in_progress: 0, verification: 0, closed: 0, overdue: 0 }
    rows.forEach(r => {
      if (isOverdue(r)) c.overdue++
      else if (c[r.status] !== undefined) c[r.status]++
    })
    return c
  }, [rows])

  function handleExport() {
    const headers = ['CAPA #', 'Source', 'Type', 'Description', 'Priority', 'Status', 'Assigned To', 'Due Date', 'Created']
    const csvRows = filtered.map(r => [
      r.capa_number, SOURCE_LABELS[r.source_type] || r.source_type, r.action_type,
      r.description, r.priority, displayStatus(r),
      profileMap[r.assigned_to] || '', r.due_date || '',
      r.created_at ? new Date(r.created_at).toLocaleDateString() : '',
    ])
    exportCsv(`sheq-capa-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm(`Archive CAPA ${row.capa_number}?`)) return
    const { error } = await supabase.from('sheq_capa').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('CAPA archived')
    fetchData()
  }

  function onSaved() {
    setShowCreate(false)
    setEditRow(null)
    fetchData()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_capa" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view CAPA records.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_capa" />

      <PageHeader
        title="CAPA Register"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New CAPA</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Open', value: kpis.openCount, icon: 'pending_actions', color: '#1565C0' },
          { label: 'Overdue', value: kpis.overdueCount, icon: 'schedule', color: '#D32F2F' },
          { label: 'Avg Closure Days', value: kpis.avgDays, icon: 'timer', color: '#E65100' },
          { label: 'Closure Rate', value: kpis.closureRate + '%', icon: 'percent', color: '#2E7D32' },
        ].map(k => (
          <Card key={k.label} style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Icon name={k.icon} size={18} style={{ color: k.color }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase' }}>{k.label}</span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: THEME.text }}>{k.value}</div>
          </Card>
        ))}
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {STATUS_TABS.map(tab => {
          const active = statusFilter === tab
          const clr = STATUS_COLORS[tab] || ACCENT
          return (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: active ? clr : THEME.surfaceVar,
                color: active ? '#fff' : THEME.textMed,
                transition: 'all .15s',
              }}
            >
              {STATUS_LABELS[tab]} ({counts[tab] || 0})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px', maxWidth: '320px' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            style={{ ...inputStyle, paddingLeft: '32px' }}
            placeholder="Search CAPA..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading CAPA records...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="task_alt" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No CAPA records yet.' : 'No records match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['CAPA #', 'Source', 'Type', 'Description', 'Priority', 'Status', 'Assigned To', 'Due Date', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const ds = displayStatus(r)
                  const dueDateStr = r.due_date || ''
                  const isDue = isOverdue(r)
                  return (
                    <tr
                      key={r.id}
                      style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                      onClick={() => canEdit ? setEditRow(r) : null}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.capa_number}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{SOURCE_LABELS[r.source_type] || r.source_type}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Badge label={r.action_type === 'corrective' ? 'Corrective' : 'Preventive'} color={r.action_type === 'corrective' ? '#1565C0' : '#6A1B9A'} />
                      </td>
                      <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <Badge label={r.priority.charAt(0).toUpperCase() + r.priority.slice(1)} color={PRIORITY_COLORS[r.priority]} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <Badge label={STATUS_LABELS[ds]} color={STATUS_COLORS[ds]} />
                      </td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.assigned_to] || '--'}</td>
                      <td style={{ padding: '10px 12px', color: isDue ? '#D32F2F' : THEME.textMed, fontWeight: isDue ? 600 : 400, whiteSpace: 'nowrap' }}>{dueDateStr}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {canEdit && (
                            <button onClick={e => { e.stopPropagation(); setEditRow(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Edit">
                              <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                            </button>
                          )}
                          {canEdit && (
                            <button onClick={e => { e.stopPropagation(); handleArchive(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Archive">
                              <Icon name="archive" size={16} style={{ color: THEME.textLow }} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(showCreate || editRow) && (
        <CapaModal
          capa={editRow}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditRow(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
