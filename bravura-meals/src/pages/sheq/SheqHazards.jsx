import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const HAZARD_CATEGORIES = [
  'electrical', 'mechanical', 'working_at_height', 'lifting', 'excavation',
  'fire', 'chemical', 'vehicle', 'housekeeping', 'ppe', 'environmental',
  'structural', 'other',
]

const PRIORITY_COLORS = {
  low:      { bg: '#E8F5E9', color: '#2E7D32' },
  medium:   { bg: '#FFF8E1', color: '#F59E0B' },
  high:     { bg: '#FFF3E0', color: '#E65100' },
  critical: { bg: '#FFEBEE', color: '#D32F2F' },
}

const STATUS_META = {
  open:        { label: 'Open',        bg: '#FFEBEE', color: '#D32F2F', icon: 'error_outline' },
  in_progress: { label: 'In Progress', bg: '#E3F2FD', color: '#1565C0', icon: 'autorenew' },
  resolved:    { label: 'Resolved',    bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  closed:      { label: 'Closed',      bg: '#F5F5F5', color: '#9E9E9E', icon: 'lock' },
}

const STATUS_TABS = ['all', 'open', 'in_progress', 'resolved', 'closed']

const STATUS_FLOW = {
  open: 'in_progress',
  in_progress: 'resolved',
  resolved: 'closed',
}

function fmtLabel(t) {
  if (!t) return '--'
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const textareaStyle = { ...inputStyle, minHeight: '70px', resize: 'vertical' }

function PriorityBadge({ priority }) {
  const s = PRIORITY_COLORS[priority] || { bg: THEME.surfaceVar, color: THEME.textMed }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {priority ? fmtLabel(priority) : '--'}
    </span>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, bg: THEME.surfaceVar, color: THEME.textMed, icon: 'help' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: m.bg, color: m.color,
    }}>
      <Icon name={m.icon} size={11} style={{ color: 'inherit' }} />
      {m.label}
    </span>
  )
}

function Field({ label, children, required }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}{required && <span style={{ color: THEME.error }}> *</span>}
      </div>
      {children}
    </div>
  )
}

// ── Create/Edit Modal ──────────────────────────────────────────────────────

function HazardModal({ hazard, profiles, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!hazard

  const [form, setForm] = useState(() => {
    if (hazard) return {
      report_date: hazard.report_date || '',
      location: hazard.location || '',
      category: hazard.category || '',
      description: hazard.description || '',
      priority: hazard.priority || 'medium',
      photo_url: hazard.photo_url || '',
      is_anonymous: hazard.is_anonymous || false,
      resolution_notes: hazard.resolution_notes || '',
      status: hazard.status || 'open',
    }
    return {
      report_date: new Date().toISOString().slice(0, 10),
      location: '', category: '', description: '', priority: 'medium',
      photo_url: '', is_anonymous: false, resolution_notes: '', status: 'open',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.report_date || !form.description || !form.category) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        report_date: form.report_date,
        location: form.location || null,
        category: form.category,
        description: form.description,
        priority: form.priority,
        photo_url: form.photo_url || null,
        is_anonymous: form.is_anonymous,
        resolution_notes: form.resolution_notes || null,
        status: form.status,
      }

      if (isEdit) {
        if (form.status === 'resolved' && hazard.status !== 'resolved') {
          payload.resolved_by = userId
          payload.resolved_at = new Date().toISOString()
        }
        const { error } = await supabase
          .from('sheq_hazard_reports')
          .update(payload)
          .eq('id', hazard.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Hazard report updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'HAZ', p_table: 'sheq_hazard_reports',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.report_number = numData
        payload.reported_by = form.is_anonymous ? null : userId
        payload.status = 'open'
        const { error } = await supabase.from('sheq_hazard_reports').insert(payload)
        if (error) throw error
        showToast(`Hazard ${numData} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusAdvance() {
    const next = STATUS_FLOW[hazard.status]
    if (!next) return
    if (next === 'closed' && !canApprove) {
      showToast('You need approval permission to close hazard reports', 'error'); return
    }
    const updates = { status: next }
    if (next === 'resolved') { updates.resolved_by = userId; updates.resolved_at = new Date().toISOString() }
    const { error } = await supabase
      .from('sheq_hazard_reports')
      .update(updates)
      .eq('id', hazard.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Status advanced to ${STATUS_META[next]?.label || next}`)
    onSaved()
  }

  const showResolution = isEdit && (form.status === 'resolved' || form.status === 'closed' || hazard.status === 'in_progress' || hazard.status === 'resolved')

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
            {isEdit ? `Edit ${hazard.report_number}` : 'Report Hazard'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Report Date" required>
              <input style={inputStyle} type="date" value={form.report_date} onChange={e => set('report_date', e.target.value)} />
            </Field>
            <Field label="Priority" required>
              <select style={selectStyle} value={form.priority} onChange={e => set('priority', e.target.value)}>
                {['low', 'medium', 'high', 'critical'].map(p => (
                  <option key={p} value={p}>{fmtLabel(p)}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Location">
            <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Workshop, Main Road" />
          </Field>

          <Field label="Category" required>
            <select style={selectStyle} value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="">Select category...</option>
              {HAZARD_CATEGORIES.map(c => (
                <option key={c} value={c}>{fmtLabel(c)}</option>
              ))}
            </select>
          </Field>

          <Field label="Description" required>
            <textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the hazard..." />
          </Field>

          <Field label="Photo URL">
            <input style={inputStyle} value={form.photo_url} onChange={e => set('photo_url', e.target.value)} placeholder="https://..." />
          </Field>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: THEME.text, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.is_anonymous}
              onChange={e => set('is_anonymous', e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: ACCENT }}
            />
            Report anonymously
          </label>

          {/* Resolution fields */}
          {showResolution && (
            <>
              <SectionLabel>Resolution</SectionLabel>
              <Field label="Resolution Notes">
                <textarea style={textareaStyle} value={form.resolution_notes} onChange={e => set('resolution_notes', e.target.value)} placeholder="Describe what was done to resolve the hazard..." />
              </Field>
            </>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            {isEdit && STATUS_FLOW[hazard.status] && (
              <Button onClick={handleStatusAdvance} icon="arrow_forward">
                Advance to {STATUS_META[STATUS_FLOW[hazard.status]]?.label}
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Report Hazard'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SheqHazards({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [hazards, setHazards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editHazard, setEditHazard] = useState(null)

  const [profiles, setProfiles] = useState([])

  const canView    = can('sheq.view')
  const canCreate  = can('sheq.create')
  const canEdit    = can('sheq.edit')
  const canApprove = can('sheq.approve')

  async function fetchHazards() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_hazard_reports')
        .select('*, reporter:profiles!sheq_hazard_reports_reported_by_fkey(full_name)')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('report_date', { ascending: false })
      if (err) throw err
      setHazards(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function fetchRefData() {
    if (!currentSiteId) return
    const { data } = await supabase.from('profiles').select('id, full_name')
    setProfiles(data || [])
  }

  useEffect(() => { fetchHazards(); fetchRefData() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = hazards
    if (statusFilter !== 'all') list = list.filter(h => h.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(h =>
        h.report_number?.toLowerCase().includes(q) ||
        h.description?.toLowerCase().includes(q) ||
        h.location?.toLowerCase().includes(q)
      )
    }
    return list
  }, [hazards, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: hazards.length }
    STATUS_TABS.slice(1).forEach(s => { c[s] = 0 })
    hazards.forEach(h => { if (c[h.status] !== undefined) c[h.status]++ })
    return c
  }, [hazards])

  function handleExport() {
    const headers = ['Report #', 'Date', 'Category', 'Priority', 'Location', 'Status', 'Reported By', 'Description']
    const rows = filtered.map(h => [
      h.report_number, h.report_date, fmtLabel(h.category),
      h.priority, h.location || '', STATUS_META[h.status]?.label || h.status,
      h.reporter?.full_name || (h.is_anonymous ? 'Anonymous' : ''), h.description || '',
    ])
    exportCsv(`sheq-hazards-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(haz) {
    if (!confirm(`Archive hazard report ${haz.report_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_hazard_reports')
      .update({ is_archived: true })
      .eq('id', haz.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Hazard report archived')
    fetchHazards()
  }

  function onSaved() {
    setShowCreate(false)
    setEditHazard(null)
    fetchHazards()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_hazards" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view hazard reports.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_hazards" />

      <PageHeader
        title="Hazard Reports"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">Report Hazard</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {STATUS_TABS.map(tab => {
          const active = statusFilter === tab
          const meta = STATUS_META[tab]
          return (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
                background: active ? (meta?.color || ACCENT) : THEME.surfaceVar,
                color: active ? '#fff' : THEME.textMed,
                transition: 'all .15s',
              }}
            >
              {tab === 'all' ? 'All' : meta?.label || tab} ({counts[tab] || 0})
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
            placeholder="Search hazard reports..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      {error && (
        <Card style={{ padding: '20px', borderColor: THEME.error }}>
          <div style={{ color: THEME.error, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="error" size={18} style={{ color: THEME.error }} />
            {error}
          </div>
        </Card>
      )}

      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading hazard reports...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="report_problem" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {hazards.length === 0 ? 'No hazard reports yet.' : 'No hazard reports match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Report #', 'Date', 'Category', 'Priority', 'Location', 'Status', 'Reported By', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(haz => (
                  <tr
                    key={haz.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditHazard(haz)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{haz.report_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{haz.report_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{fmtLabel(haz.category)}</td>
                    <td style={{ padding: '10px 12px' }}><PriorityBadge priority={haz.priority} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{haz.location || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={haz.status} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{haz.is_anonymous ? 'Anonymous' : (haz.reporter?.full_name || '--')}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditHazard(haz) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(haz) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Archive"
                          >
                            <Icon name="archive" size={16} style={{ color: THEME.textLow }} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modal */}
      {(showCreate || editHazard) && (
        <HazardModal
          hazard={editHazard}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditHazard(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
