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

const INDUCTION_TYPES = ['site', 'department', 'job_specific', 'visitor', 'contractor', 'refresher']
const TYPE_LABELS = { site: 'Site', department: 'Department', job_specific: 'Job Specific', visitor: 'Visitor', contractor: 'Contractor', refresher: 'Refresher' }
const STATUS_LABELS = { completed: 'Completed', pending: 'Pending', expired: 'Expired', failed: 'Failed' }
const STATUS_COLORS = { completed: '#2E7D32', pending: '#1565C0', expired: '#E65100', failed: '#D32F2F' }
const FILTER_TABS = ['all', 'completed', 'pending', 'expired', 'failed']

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

function InductionModal({ rec, profiles, departments, siteId, userId, onClose, onSaved }) {
  const isEdit = !!rec
  const [form, setForm] = useState(() => {
    if (rec) return {
      employee_id: rec.employee_id || '',
      induction_type: rec.induction_type || 'site',
      induction_date: rec.induction_date || new Date().toISOString().slice(0, 10),
      expiry_date: rec.expiry_date || '',
      conducted_by: rec.conducted_by || '',
      status: rec.status || 'pending',
      score: rec.score != null ? String(rec.score) : '',
      pass_mark: rec.pass_mark != null ? String(rec.pass_mark) : '',
      topics_covered: rec.topics_covered || '',
      notes: rec.notes || '',
      department_id: rec.department_id || '',
    }
    return {
      employee_id: '', induction_type: 'site',
      induction_date: new Date().toISOString().slice(0, 10), expiry_date: '',
      conducted_by: '', status: 'pending', score: '', pass_mark: '',
      topics_covered: '', notes: '', department_id: '',
    }
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.employee_id || !form.induction_date) {
      showToast('Employee and induction date are required', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        employee_id: form.employee_id,
        induction_type: form.induction_type,
        induction_date: form.induction_date,
        expiry_date: form.expiry_date || null,
        conducted_by: form.conducted_by || null,
        status: form.status,
        score: form.score ? parseFloat(form.score) : null,
        pass_mark: form.pass_mark ? parseFloat(form.pass_mark) : null,
        topics_covered: form.topics_covered || null,
        notes: form.notes || null,
        department_id: form.department_id || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_inductions').update(payload).eq('id', rec.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Induction updated')
      } else {
        const { error } = await supabase.from('sheq_inductions').insert({ ...payload, site_id: siteId, created_by: userId })
        if (error) throw error
        showToast('Induction created')
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
            {isEdit ? 'Edit Induction' : 'New Induction'}
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
            <Field label="Induction Type" required>
              <select style={selectStyle} value={form.induction_type} onChange={e => set('induction_type', e.target.value)}>
                {INDUCTION_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Induction Date" required>
              <input style={inputStyle} type="date" value={form.induction_date} onChange={e => set('induction_date', e.target.value)} />
            </Field>
            <Field label="Expiry Date">
              <input style={inputStyle} type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Conducted By">
              <select style={selectStyle} value={form.conducted_by} onChange={e => set('conducted_by', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Department">
              <select style={selectStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
                <option value="">Select...</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Score">
              <input style={inputStyle} type="number" value={form.score} onChange={e => set('score', e.target.value)} placeholder="e.g. 85" />
            </Field>
            <Field label="Pass Mark">
              <input style={inputStyle} type="number" value={form.pass_mark} onChange={e => set('pass_mark', e.target.value)} placeholder="e.g. 70" />
            </Field>
          </div>

          <Field label="Topics Covered">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.topics_covered} onChange={e => set('topics_covered', e.target.value)} placeholder="List of topics covered" />
          </Field>

          <Field label="Notes">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Induction'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqInductions({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_inductions', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [departments, setDepartments] = useState([])

  const canView = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit = can('sheq.edit')

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data, error }, { data: emps }, { data: depts }] = await Promise.all([
      supabase
        .from('sheq_inductions')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('induction_date', { ascending: false }),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId).order('name'),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setProfiles(emps || [])
    setDepartments(depts || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData, rt])

  const kpis = useMemo(() => {
    const completed = rows.filter(r => r.status === 'completed').length
    const pending = rows.filter(r => r.status === 'pending').length
    const expired = rows.filter(r => r.status === 'expired').length
    const failed = rows.filter(r => r.status === 'failed').length
    return { total: rows.length, completed, pending, expired, failed }
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        profileMap[r.employee_id]?.toLowerCase().includes(q) ||
        r.induction_type?.toLowerCase().includes(q) ||
        r.topics_covered?.toLowerCase().includes(q) ||
        profileMap[r.conducted_by]?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, statusFilter, search, profileMap])

  const counts = useMemo(() => {
    const c = { all: rows.length, completed: 0, pending: 0, expired: 0, failed: 0 }
    rows.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [rows])

  function handleExport() {
    const headers = ['Employee', 'Type', 'Date', 'Expiry', 'Conducted By', 'Status', 'Score']
    const csvRows = filtered.map(r => [
      profileMap[r.employee_id] || '', TYPE_LABELS[r.induction_type] || r.induction_type,
      r.induction_date || '', r.expiry_date || '', profileMap[r.conducted_by] || '',
      STATUS_LABELS[r.status] || r.status, r.score != null ? r.score : '',
    ])
    exportCsv(`sheq-inductions-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm('Archive this induction record?')) return
    const { error } = await supabase.from('sheq_inductions').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Induction archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_inductions" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view inductions.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_inductions" />

      <PageHeader
        title="Induction Register"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Induction</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total', value: kpis.total, icon: 'assignment', color: ACCENT },
          { label: 'Completed', value: kpis.completed, icon: 'check_circle', color: '#2E7D32' },
          { label: 'Pending', value: kpis.pending, icon: 'hourglass_empty', color: '#1565C0' },
          { label: 'Expired', value: kpis.expired, icon: 'schedule', color: '#E65100' },
          { label: 'Failed', value: kpis.failed, icon: 'cancel', color: '#D32F2F' },
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
            placeholder="Search inductions..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading inductions...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="assignment" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No inductions yet.' : 'No inductions match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Employee', 'Type', 'Date', 'Expiry', 'Conducted By', 'Status', 'Score', ''].map(h => (
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
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{TYPE_LABELS[r.induction_type] || r.induction_type}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.induction_date}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.expiry_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.conducted_by] || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={STATUS_LABELS[r.status] || r.status} color={STATUS_COLORS[r.status] || ACCENT} />
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>
                      {r.score != null ? (
                        <span style={{ color: r.pass_mark && r.score >= r.pass_mark ? '#2E7D32' : r.pass_mark ? '#D32F2F' : THEME.text }}>
                          {r.score}{r.pass_mark ? `/${r.pass_mark}` : ''}
                        </span>
                      ) : '--'}
                    </td>
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
        <InductionModal
          rec={editRow}
          profiles={profiles}
          departments={departments}
          siteId={currentSiteId}
          userId={user?.id}
          onClose={() => { setShowCreate(false); setEditRow(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
