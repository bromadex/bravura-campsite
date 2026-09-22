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

const EXAM_TYPES = ['pre_employment', 'periodic', 'return_to_work', 'exit', 'special']
const EXAM_LABELS = { pre_employment: 'Pre-Employment', periodic: 'Periodic', return_to_work: 'Return to Work', exit: 'Exit', special: 'Special' }
const FITNESS_LABELS = { fit: 'Fit', fit_with_restrictions: 'Fit (Restrictions)', temporarily_unfit: 'Temporarily Unfit', permanently_unfit: 'Permanently Unfit', pending: 'Pending' }
const FITNESS_COLORS = { fit: '#2E7D32', fit_with_restrictions: '#E65100', temporarily_unfit: '#D32F2F', permanently_unfit: '#7B1FA2', pending: '#1565C0' }
const FILTER_TABS = ['all', 'fit', 'fit_with_restrictions', 'temporarily_unfit', 'pending']

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

function MedicalModal({ rec, profiles, siteId, userId, onClose, onSaved }) {
  const isEdit = !!rec
  const [form, setForm] = useState(() => {
    if (rec) return {
      employee_id: rec.employee_id || '',
      exam_type: rec.exam_type || 'periodic',
      exam_date: rec.exam_date || new Date().toISOString().slice(0, 10),
      expiry_date: rec.expiry_date || '',
      provider: rec.provider || '',
      doctor_name: rec.doctor_name || '',
      fitness_status: rec.fitness_status || 'pending',
      restrictions: rec.restrictions || '',
      follow_up_date: rec.follow_up_date || '',
      notes: rec.notes || '',
    }
    return {
      employee_id: '', exam_type: 'periodic', exam_date: new Date().toISOString().slice(0, 10),
      expiry_date: '', provider: '', doctor_name: '', fitness_status: 'pending',
      restrictions: '', follow_up_date: '', notes: '',
    }
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.employee_id || !form.exam_date) {
      showToast('Employee and exam date are required', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        employee_id: form.employee_id,
        exam_type: form.exam_type,
        exam_date: form.exam_date,
        expiry_date: form.expiry_date || null,
        provider: form.provider || null,
        doctor_name: form.doctor_name || null,
        fitness_status: form.fitness_status,
        restrictions: form.restrictions || null,
        follow_up_date: form.follow_up_date || null,
        notes: form.notes || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_medical_fitness').update(payload).eq('id', rec.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Medical record updated')
      } else {
        const { error } = await supabase.from('sheq_medical_fitness').insert({ ...payload, site_id: siteId, created_by: userId })
        if (error) throw error
        showToast('Medical record created')
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
            {isEdit ? 'Edit Medical Record' : 'New Medical Record'}
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
            <Field label="Exam Type" required>
              <select style={selectStyle} value={form.exam_type} onChange={e => set('exam_type', e.target.value)}>
                {EXAM_TYPES.map(t => <option key={t} value={t}>{EXAM_LABELS[t]}</option>)}
              </select>
            </Field>
            <Field label="Fitness Status">
              <select style={selectStyle} value={form.fitness_status} onChange={e => set('fitness_status', e.target.value)}>
                {Object.entries(FITNESS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Exam Date" required>
              <input style={inputStyle} type="date" value={form.exam_date} onChange={e => set('exam_date', e.target.value)} />
            </Field>
            <Field label="Expiry Date">
              <input style={inputStyle} type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Provider">
              <input style={inputStyle} value={form.provider} onChange={e => set('provider', e.target.value)} placeholder="Medical facility" />
            </Field>
            <Field label="Doctor Name">
              <input style={inputStyle} value={form.doctor_name} onChange={e => set('doctor_name', e.target.value)} />
            </Field>
          </div>

          <Field label="Restrictions">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.restrictions} onChange={e => set('restrictions', e.target.value)} placeholder="Any work restrictions..." />
          </Field>

          <Field label="Follow-up Date">
            <input style={inputStyle} type="date" value={form.follow_up_date} onChange={e => set('follow_up_date', e.target.value)} />
          </Field>

          <Field label="Notes">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Add Medical Record'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqMedical({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_medical_fitness', { column: 'site_id', value: currentSiteId })
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
        .from('sheq_medical_fitness')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('exam_date', { ascending: false }),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setProfiles(emps || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData, rt])

  const kpis = useMemo(() => {
    const fit = rows.filter(r => r.fitness_status === 'fit').length
    const restricted = rows.filter(r => r.fitness_status === 'fit_with_restrictions').length
    const unfit = rows.filter(r => r.fitness_status === 'temporarily_unfit' || r.fitness_status === 'permanently_unfit').length
    const pending = rows.filter(r => r.fitness_status === 'pending').length
    return { total: rows.length, fit, restricted, unfit, pending }
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter !== 'all') list = list.filter(r => r.fitness_status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        profileMap[r.employee_id]?.toLowerCase().includes(q) ||
        r.provider?.toLowerCase().includes(q) ||
        r.doctor_name?.toLowerCase().includes(q) ||
        r.restrictions?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, statusFilter, search, profileMap])

  const counts = useMemo(() => {
    const c = { all: rows.length, fit: 0, fit_with_restrictions: 0, temporarily_unfit: 0, pending: 0 }
    rows.forEach(r => { if (c[r.fitness_status] !== undefined) c[r.fitness_status]++ })
    return c
  }, [rows])

  function handleExport() {
    const headers = ['Employee', 'Exam Type', 'Date', 'Expiry', 'Provider', 'Doctor', 'Status', 'Restrictions']
    const csvRows = filtered.map(r => [
      profileMap[r.employee_id] || '', EXAM_LABELS[r.exam_type] || r.exam_type,
      r.exam_date || '', r.expiry_date || '', r.provider || '', r.doctor_name || '',
      FITNESS_LABELS[r.fitness_status] || r.fitness_status, r.restrictions || '',
    ])
    exportCsv(`sheq-medical-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm('Archive this medical record?')) return
    const { error } = await supabase.from('sheq_medical_fitness').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Medical record archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_medical" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view medical records.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_medical" />

      <PageHeader
        title="Medical Fitness Register"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Medical Record</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Records', value: kpis.total, icon: 'medical_services', color: ACCENT },
          { label: 'Fit', value: kpis.fit, icon: 'check_circle', color: '#2E7D32' },
          { label: 'Restricted', value: kpis.restricted, icon: 'warning', color: '#E65100' },
          { label: 'Unfit', value: kpis.unfit, icon: 'cancel', color: '#D32F2F' },
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
          const clr = FITNESS_COLORS[tab] || ACCENT
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
              {tab === 'all' ? 'All' : FITNESS_LABELS[tab]} ({counts[tab] || 0})
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
            placeholder="Search medical records..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading medical records...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="medical_services" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No medical records yet.' : 'No records match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Employee', 'Exam Type', 'Date', 'Expiry', 'Provider', 'Doctor', 'Status', 'Restrictions', ''].map(h => (
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
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{EXAM_LABELS[r.exam_type] || r.exam_type}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.exam_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.expiry_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.provider || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.doctor_name || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={FITNESS_LABELS[r.fitness_status] || r.fitness_status} color={FITNESS_COLORS[r.fitness_status] || ACCENT} />
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.restrictions || '--'}</td>
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
        <MedicalModal
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
