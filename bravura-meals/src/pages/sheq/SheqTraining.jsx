import { useState, useEffect, useMemo, useCallback } from 'react'
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

const STATUS_LABELS = { valid: 'Valid', expiring: 'Expiring', expired: 'Expired', pending: 'Pending' }
const STATUS_COLORS = { valid: '#2E7D32', expiring: '#E65100', expired: '#D32F2F', pending: '#1565C0' }
const COMPETENCY_LABELS = { basic: 'Basic', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' }
const FILTER_TABS = ['all', 'valid', 'expiring', 'expired', 'pending']

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

function TrainingModal({ rec, profiles, siteId, userId, onClose, onSaved }) {
  const isEdit = !!rec
  const [form, setForm] = useState(() => {
    if (rec) return {
      employee_id: rec.employee_id || '',
      training_type: rec.training_type || '',
      course_name: rec.course_name || '',
      provider: rec.provider || '',
      certificate_number: rec.certificate_number || '',
      date_completed: rec.date_completed || '',
      expiry_date: rec.expiry_date || '',
      status: rec.status || 'pending',
      competency_level: rec.competency_level || 'basic',
      notes: rec.notes || '',
      attachment_url: rec.attachment_url || '',
    }
    return {
      employee_id: '', training_type: '', course_name: '', provider: '',
      certificate_number: '', date_completed: '', expiry_date: '',
      status: 'pending', competency_level: 'basic', notes: '', attachment_url: '',
    }
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.employee_id || !form.course_name) {
      showToast('Employee and course name are required', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        employee_id: form.employee_id,
        training_type: form.training_type || null,
        course_name: form.course_name,
        provider: form.provider || null,
        certificate_number: form.certificate_number || null,
        date_completed: form.date_completed || null,
        expiry_date: form.expiry_date || null,
        status: form.status,
        competency_level: form.competency_level,
        notes: form.notes || null,
        attachment_url: form.attachment_url || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_training_matrix').update(payload).eq('id', rec.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Training record updated')
      } else {
        const { error } = await supabase.from('sheq_training_matrix').insert({ ...payload, site_id: siteId, created_by: userId })
        if (error) throw error
        showToast('Training record created')
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
          width: '520px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? 'Edit Training Record' : 'New Training Record'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Employee" required>
            <select style={selectStyle} value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
              <option value="">Select...</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.name} ({p.employee_number})</option>)}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Course Name" required>
              <input style={inputStyle} value={form.course_name} onChange={e => set('course_name', e.target.value)} placeholder="e.g. First Aid Level 2" />
            </Field>
            <Field label="Training Type">
              <input style={inputStyle} value={form.training_type} onChange={e => set('training_type', e.target.value)} placeholder="e.g. Safety, Compliance" />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Provider">
              <input style={inputStyle} value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="Training provider" />
            </Field>
            <Field label="Certificate Number">
              <input style={inputStyle} value={form.certificate_number} onChange={e => set('certificate_number', e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Date Completed">
              <input style={inputStyle} type="date" value={form.date_completed} onChange={e => set('date_completed', e.target.value)} />
            </Field>
            <Field label="Expiry Date">
              <input style={inputStyle} type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Competency Level">
              <select style={selectStyle} value={form.competency_level} onChange={e => set('competency_level', e.target.value)}>
                {Object.entries(COMPETENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Notes">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Add Training'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqTraining({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_training_matrix', { column: 'site_id', value: currentSiteId })
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

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data, error }, { data: emps }] = await Promise.all([
      supabase
        .from('sheq_training_matrix')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('date_completed', { ascending: false }),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setProfiles(emps || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData, rt])

  const kpis = useMemo(() => {
    const valid = rows.filter(r => r.status === 'valid').length
    const expiring = rows.filter(r => r.status === 'expiring').length
    const expired = rows.filter(r => r.status === 'expired').length
    const pending = rows.filter(r => r.status === 'pending').length
    return { total: rows.length, valid, expiring, expired, pending }
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.course_name?.toLowerCase().includes(q) ||
        r.training_type?.toLowerCase().includes(q) ||
        r.provider?.toLowerCase().includes(q) ||
        profileMap[r.employee_id]?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, statusFilter, search, profileMap])

  const counts = useMemo(() => {
    const c = { all: rows.length, valid: 0, expiring: 0, expired: 0, pending: 0 }
    rows.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [rows])

  function handleExport() {
    const headers = ['Employee', 'Course', 'Type', 'Provider', 'Completed', 'Expiry', 'Status', 'Competency']
    const csvRows = filtered.map(r => [
      profileMap[r.employee_id] || '', r.course_name || '', r.training_type || '',
      r.provider || '', r.date_completed || '', r.expiry_date || '',
      STATUS_LABELS[r.status] || r.status, COMPETENCY_LABELS[r.competency_level] || r.competency_level,
    ])
    exportCsv(`sheq-training-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm('Archive this training record?')) return
    const { error } = await supabase.from('sheq_training_matrix').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Training record archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_training" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view training records.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_training" />

      <PageHeader
        title="Training & Competency Matrix"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Training</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Records', value: kpis.total, icon: 'school', color: ACCENT },
          { label: 'Valid', value: kpis.valid, icon: 'check_circle', color: '#2E7D32' },
          { label: 'Expiring', value: kpis.expiring, icon: 'schedule', color: '#E65100' },
          { label: 'Expired', value: kpis.expired, icon: 'cancel', color: '#D32F2F' },
          { label: 'Pending', value: kpis.pending, icon: 'hourglass_empty', color: '#1565C0' },
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

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {FILTER_TABS.map(tab => {
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
              {tab === 'all' ? 'All' : STATUS_LABELS[tab]} ({counts[tab] || 0})
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
            placeholder="Search training records..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading training records...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="school" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No training records yet.' : 'No records match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Employee', 'Course', 'Type', 'Provider', 'Completed', 'Expiry', 'Status', 'Competency', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit ? setEditRow(r) : null}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{profileMap[r.employee_id] || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.course_name}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.training_type || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.provider || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.date_completed || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.expiry_date || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={STATUS_LABELS[r.status] || r.status} color={STATUS_COLORS[r.status] || ACCENT} />
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{COMPETENCY_LABELS[r.competency_level] || r.competency_level || '--'}</td>
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
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(showCreate || editRow) && (
        <TrainingModal
          rec={editRow}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          onClose={() => { setShowCreate(false); setEditRow(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
