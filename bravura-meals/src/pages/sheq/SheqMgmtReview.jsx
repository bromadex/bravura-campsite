import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const STATUS_META = {
  scheduled:   { label: 'Scheduled',   bg: '#E3F2FD', color: '#1565C0', icon: 'schedule' },
  in_progress: { label: 'In Progress', bg: '#FFF8E1', color: '#F59E0B', icon: 'pending' },
  completed:   { label: 'Completed',   bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  cancelled:   { label: 'Cancelled',   bg: '#FFEBEE', color: '#D32F2F', icon: 'cancel' },
}

const FILTER_TABS = ['all', 'scheduled', 'in_progress', 'completed']
const REVIEW_TYPES = ['quarterly', 'semi_annual', 'annual', 'special']
const STATUS_OPTIONS = ['scheduled', 'in_progress', 'completed', 'cancelled']

function fmtType(t) {
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

function Badge({ status }) {
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

function ReviewModal({ item, profiles, siteId, userId, onClose, onSaved }) {
  const isEdit = !!item

  const [form, setForm] = useState(() => {
    if (item) return {
      title: item.title || '',
      review_date: item.review_date || '',
      review_type: item.review_type || '',
      chairperson_id: item.chairperson_id || '',
      attendees: item.attendees || '',
      status: item.status || 'scheduled',
      agenda: item.agenda || '',
      minutes: item.minutes || '',
      sheq_performance_summary: item.sheq_performance_summary || '',
      incident_statistics: item.incident_statistics || '',
      audit_findings_summary: item.audit_findings_summary || '',
      risk_assessment_review: item.risk_assessment_review || '',
      training_summary: item.training_summary || '',
      compliance_status_review: item.compliance_status_review || '',
      actions_from_previous: item.actions_from_previous || '',
      new_actions: item.new_actions || '',
      decisions: item.decisions || '',
      next_review_date: item.next_review_date || '',
    }
    return {
      title: '', review_date: new Date().toISOString().slice(0, 10),
      review_type: '', chairperson_id: '', attendees: '',
      status: 'scheduled', agenda: '', minutes: '',
      sheq_performance_summary: '', incident_statistics: '',
      audit_findings_summary: '', risk_assessment_review: '',
      training_summary: '', compliance_status_review: '',
      actions_from_previous: '', new_actions: '', decisions: '',
      next_review_date: '',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.title || !form.review_type || !form.review_date) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        review_date: form.review_date,
        review_type: form.review_type,
        chairperson_id: form.chairperson_id || null,
        attendees: form.attendees || null,
        status: form.status,
        agenda: form.agenda || null,
        minutes: form.minutes || null,
        sheq_performance_summary: form.sheq_performance_summary || null,
        incident_statistics: form.incident_statistics || null,
        audit_findings_summary: form.audit_findings_summary || null,
        risk_assessment_review: form.risk_assessment_review || null,
        training_summary: form.training_summary || null,
        compliance_status_review: form.compliance_status_review || null,
        actions_from_previous: form.actions_from_previous || null,
        new_actions: form.new_actions || null,
        decisions: form.decisions || null,
        next_review_date: form.next_review_date || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_management_reviews')
          .update(payload)
          .eq('id', item.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Management review updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'MGR', p_table: 'sheq_management_reviews',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.review_number = numData
        payload.created_by = userId
        const { error } = await supabase.from('sheq_management_reviews').insert(payload)
        if (error) throw error
        showToast(`Review ${numData} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
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
          width: '720px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${item.review_number}` : 'New Management Review'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Review title" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Review Date" required>
              <input style={inputStyle} type="date" value={form.review_date} onChange={e => set('review_date', e.target.value)} />
            </Field>
            <Field label="Review Type" required>
              <select style={selectStyle} value={form.review_type} onChange={e => set('review_type', e.target.value)}>
                <option value="">Select...</option>
                {REVIEW_TYPES.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Chairperson">
              <select style={selectStyle} value={form.chairperson_id} onChange={e => set('chairperson_id', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Next Review Date">
              <input style={inputStyle} type="date" value={form.next_review_date} onChange={e => set('next_review_date', e.target.value)} />
            </Field>
          </div>
          <Field label="Attendees">
            <textarea style={textareaStyle} value={form.attendees} onChange={e => set('attendees', e.target.value)} placeholder="List of attendees..." />
          </Field>
          <Field label="Agenda">
            <textarea style={textareaStyle} value={form.agenda} onChange={e => set('agenda', e.target.value)} placeholder="Meeting agenda..." />
          </Field>
          <Field label="Minutes">
            <textarea style={textareaStyle} value={form.minutes} onChange={e => set('minutes', e.target.value)} placeholder="Meeting minutes..." />
          </Field>
          <Field label="SHEQ Performance Summary">
            <textarea style={textareaStyle} value={form.sheq_performance_summary} onChange={e => set('sheq_performance_summary', e.target.value)} placeholder="Summary of SHEQ performance..." />
          </Field>
          <Field label="Incident Statistics">
            <textarea style={textareaStyle} value={form.incident_statistics} onChange={e => set('incident_statistics', e.target.value)} placeholder="Incident statistics overview..." />
          </Field>
          <Field label="Audit Findings Summary">
            <textarea style={textareaStyle} value={form.audit_findings_summary} onChange={e => set('audit_findings_summary', e.target.value)} placeholder="Summary of audit findings..." />
          </Field>
          <Field label="Risk Assessment Review">
            <textarea style={textareaStyle} value={form.risk_assessment_review} onChange={e => set('risk_assessment_review', e.target.value)} placeholder="Review of risk assessments..." />
          </Field>
          <Field label="Training Summary">
            <textarea style={textareaStyle} value={form.training_summary} onChange={e => set('training_summary', e.target.value)} placeholder="Training activities summary..." />
          </Field>
          <Field label="Compliance Status Review">
            <textarea style={textareaStyle} value={form.compliance_status_review} onChange={e => set('compliance_status_review', e.target.value)} placeholder="Compliance status overview..." />
          </Field>
          <Field label="Actions from Previous Review">
            <textarea style={textareaStyle} value={form.actions_from_previous} onChange={e => set('actions_from_previous', e.target.value)} placeholder="Status of previous actions..." />
          </Field>
          <Field label="New Actions">
            <textarea style={textareaStyle} value={form.new_actions} onChange={e => set('new_actions', e.target.value)} placeholder="New action items..." />
          </Field>
          <Field label="Decisions">
            <textarea style={textareaStyle} value={form.decisions} onChange={e => set('decisions', e.target.value)} placeholder="Key decisions made..." />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Review'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqMgmtReview({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_management_reviews', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [items, setItems] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editItem, setEditItem] = useState(null)

  const canView = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit = can('sheq.edit')

  const profileMap = useMemo(() => {
    const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m
  }, [profiles])

  async function fetchData() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const [{ data, error: err }, { data: emp }] = await Promise.all([
        supabase.from('sheq_management_reviews').select('*').eq('site_id', currentSiteId).is('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      ])
      if (err) throw err
      setItems(data || [])
      setProfiles(emp || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [currentSiteId, rt])

  const filtered = useMemo(() => {
    let list = items
    if (tab !== 'all') list = list.filter(r => r.status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.review_number?.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, tab, search])

  const counts = useMemo(() => {
    const c = { all: items.length, scheduled: 0, in_progress: 0, completed: 0 }
    items.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [items])

  function handleExport() {
    const headers = ['Review #', 'Title', 'Date', 'Type', 'Chair', 'Status', 'Next Review']
    const rows = filtered.map(r => [
      r.review_number, r.title || '', r.review_date || '', fmtType(r.review_type),
      profileMap[r.chairperson_id] || '', fmtType(r.status), r.next_review_date || '',
    ])
    exportCsv(`sheq-mgmt-reviews-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(item) {
    if (!confirm(`Archive review ${item.review_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_management_reviews')
      .update({ is_archived: true })
      .eq('id', item.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Review archived')
    fetchData()
  }

  function onSaved() {
    setShowCreate(false)
    setEditItem(null)
    fetchData()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_mgmt_review" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view management reviews.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_mgmt_review" />

      <PageHeader
        title="Management Reviews"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Review</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Reviews', value: counts.all, icon: 'groups', color: '#1565C0' },
          { label: 'Scheduled', value: counts.scheduled, icon: 'schedule', color: '#1565C0' },
          { label: 'In Progress', value: counts.in_progress, icon: 'pending', color: '#F59E0B' },
          { label: 'Completed', value: counts.completed, icon: 'check_circle', color: '#2E7D32' },
        ].map(kpi => (
          <Card key={kpi.label} style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: kpi.color + '14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={kpi.icon} size={20} style={{ color: kpi.color }} />
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{kpi.value}</div>
              <div style={{ fontSize: '11px', color: THEME.textMed }}>{kpi.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {FILTER_TABS.map(t => {
          const active = tab === t
          const meta = STATUS_META[t]
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: '8px', border: 'none',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: active ? (meta?.color || ACCENT) : THEME.surfaceVar,
              color: active ? '#fff' : THEME.textMed, transition: 'all .15s',
            }}>
              {t === 'all' ? 'All' : meta?.label || t} ({counts[t] || 0})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', maxWidth: '320px', flex: 1 }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search reviews..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {error && (
        <Card style={{ padding: '20px', borderColor: THEME.error }}>
          <div style={{ color: THEME.error, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="error" size={18} style={{ color: THEME.error }} />{error}
          </div>
        </Card>
      )}

      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading management reviews...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="groups" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {items.length === 0 ? 'No management reviews yet.' : 'No reviews match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Review #', 'Title', 'Date', 'Type', 'Chair', 'Status', 'Next Review', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditItem(r)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.review_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.review_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{fmtType(r.review_type)}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.chairperson_id] || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><Badge status={r.status} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.next_review_date || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && <button onClick={e => { e.stopPropagation(); setEditItem(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Edit"><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                        {canEdit && <button onClick={e => { e.stopPropagation(); handleArchive(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Archive"><Icon name="archive" size={16} style={{ color: THEME.textLow }} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(showCreate || editItem) && (
        <ReviewModal item={editItem} profiles={profiles} siteId={currentSiteId} userId={user?.id} onClose={() => { setShowCreate(false); setEditItem(null) }} onSaved={onSaved} />
      )}
    </div>
  )
}
