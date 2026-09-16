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

const RISK_LABELS = { low: 'Low', medium: 'Medium', high: 'High' }
const RISK_COLORS = { low: '#2E7D32', medium: '#E65100', high: '#D32F2F' }
const FILTER_TABS = ['all', 'low', 'medium', 'high']

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

function ProfileModal({ rec, profiles, siteId, userId, onClose, onSaved }) {
  const isEdit = !!rec
  const [form, setForm] = useState(() => {
    if (rec) return {
      employee_id: rec.employee_id || '',
      blood_type: rec.blood_type || '',
      allergies: rec.allergies || '',
      chronic_conditions: rec.chronic_conditions || '',
      emergency_contact_name: rec.emergency_contact_name || '',
      emergency_contact_phone: rec.emergency_contact_phone || '',
      next_of_kin: rec.next_of_kin || '',
      shoe_size: rec.shoe_size || '',
      overall_size: rec.overall_size || '',
      helmet_size: rec.helmet_size || '',
      glove_size: rec.glove_size || '',
      safety_induction_date: rec.safety_induction_date || '',
      last_medical_date: rec.last_medical_date || '',
      last_training_date: rec.last_training_date || '',
      risk_rating: rec.risk_rating || 'low',
      notes: rec.notes || '',
    }
    return {
      employee_id: '', blood_type: '', allergies: '', chronic_conditions: '',
      emergency_contact_name: '', emergency_contact_phone: '', next_of_kin: '',
      shoe_size: '', overall_size: '', helmet_size: '', glove_size: '',
      safety_induction_date: '', last_medical_date: '', last_training_date: '',
      risk_rating: 'low', notes: '',
    }
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.employee_id) {
      showToast('Employee is required', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        employee_id: form.employee_id,
        blood_type: form.blood_type || null,
        allergies: form.allergies || null,
        chronic_conditions: form.chronic_conditions || null,
        emergency_contact_name: form.emergency_contact_name || null,
        emergency_contact_phone: form.emergency_contact_phone || null,
        next_of_kin: form.next_of_kin || null,
        shoe_size: form.shoe_size || null,
        overall_size: form.overall_size || null,
        helmet_size: form.helmet_size || null,
        glove_size: form.glove_size || null,
        safety_induction_date: form.safety_induction_date || null,
        last_medical_date: form.last_medical_date || null,
        last_training_date: form.last_training_date || null,
        risk_rating: form.risk_rating,
        notes: form.notes || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_employee_profiles').update(payload).eq('id', rec.id).eq('site_id', siteId)
        if (error) throw error
        showToast('SHEQ profile updated')
      } else {
        const { error } = await supabase.from('sheq_employee_profiles').insert({ ...payload, site_id: siteId, created_by: userId })
        if (error) throw error
        showToast('SHEQ profile created')
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
          width: '580px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? 'Edit SHEQ Profile' : 'New SHEQ Profile'}
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
            <Field label="Blood Type">
              <select style={selectStyle} value={form.blood_type} onChange={e => set('blood_type', e.target.value)}>
                <option value="">Select...</option>
                {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(bt => (
                  <option key={bt} value={bt}>{bt}</option>
                ))}
              </select>
            </Field>
            <Field label="Risk Rating">
              <select style={selectStyle} value={form.risk_rating} onChange={e => set('risk_rating', e.target.value)}>
                {Object.entries(RISK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Allergies">
            <input style={inputStyle} value={form.allergies} onChange={e => set('allergies', e.target.value)} placeholder="Known allergies" />
          </Field>

          <Field label="Chronic Conditions">
            <input style={inputStyle} value={form.chronic_conditions} onChange={e => set('chronic_conditions', e.target.value)} placeholder="Any chronic conditions" />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Emergency Contact Name">
              <input style={inputStyle} value={form.emergency_contact_name} onChange={e => set('emergency_contact_name', e.target.value)} />
            </Field>
            <Field label="Emergency Contact Phone">
              <input style={inputStyle} value={form.emergency_contact_phone} onChange={e => set('emergency_contact_phone', e.target.value)} />
            </Field>
          </div>

          <Field label="Next of Kin">
            <input style={inputStyle} value={form.next_of_kin} onChange={e => set('next_of_kin', e.target.value)} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
            <Field label="Shoe Size">
              <input style={inputStyle} value={form.shoe_size} onChange={e => set('shoe_size', e.target.value)} />
            </Field>
            <Field label="Overall Size">
              <input style={inputStyle} value={form.overall_size} onChange={e => set('overall_size', e.target.value)} />
            </Field>
            <Field label="Helmet Size">
              <input style={inputStyle} value={form.helmet_size} onChange={e => set('helmet_size', e.target.value)} />
            </Field>
            <Field label="Glove Size">
              <input style={inputStyle} value={form.glove_size} onChange={e => set('glove_size', e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <Field label="Safety Induction Date">
              <input style={inputStyle} type="date" value={form.safety_induction_date} onChange={e => set('safety_induction_date', e.target.value)} />
            </Field>
            <Field label="Last Medical Date">
              <input style={inputStyle} type="date" value={form.last_medical_date} onChange={e => set('last_medical_date', e.target.value)} />
            </Field>
            <Field label="Last Training Date">
              <input style={inputStyle} type="date" value={form.last_training_date} onChange={e => set('last_training_date', e.target.value)} />
            </Field>
          </div>

          <Field label="Notes">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Profile'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqEmployeeProfile({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [riskFilter, setRiskFilter] = useState('all')
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
        .from('sheq_employee_profiles')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setProfiles(emps || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData])

  const kpis = useMemo(() => {
    const low = rows.filter(r => r.risk_rating === 'low').length
    const medium = rows.filter(r => r.risk_rating === 'medium').length
    const high = rows.filter(r => r.risk_rating === 'high').length
    return { total: rows.length, low, medium, high }
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (riskFilter !== 'all') list = list.filter(r => r.risk_rating === riskFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        profileMap[r.employee_id]?.toLowerCase().includes(q) ||
        r.blood_type?.toLowerCase().includes(q) ||
        r.emergency_contact_name?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, riskFilter, search, profileMap])

  const counts = useMemo(() => {
    const c = { all: rows.length, low: 0, medium: 0, high: 0 }
    rows.forEach(r => { if (c[r.risk_rating] !== undefined) c[r.risk_rating]++ })
    return c
  }, [rows])

  function handleExport() {
    const headers = ['Employee', 'Blood Type', 'Risk Rating', 'Emergency Contact', 'Last Medical', 'Last Training', 'Induction Date']
    const csvRows = filtered.map(r => [
      profileMap[r.employee_id] || '', r.blood_type || '',
      RISK_LABELS[r.risk_rating] || r.risk_rating, r.emergency_contact_name || '',
      r.last_medical_date || '', r.last_training_date || '', r.safety_induction_date || '',
    ])
    exportCsv(`sheq-employee-profiles-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm('Archive this SHEQ profile?')) return
    const { error } = await supabase.from('sheq_employee_profiles').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('SHEQ profile archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_emp_profile" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view SHEQ profiles.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_emp_profile" />

      <PageHeader
        title="Employee SHEQ Profiles"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Profile</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Profiles', value: kpis.total, icon: 'badge', color: ACCENT },
          { label: 'Low Risk', value: kpis.low, icon: 'check_circle', color: '#2E7D32' },
          { label: 'Medium Risk', value: kpis.medium, icon: 'warning', color: '#E65100' },
          { label: 'High Risk', value: kpis.high, icon: 'error', color: '#D32F2F' },
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
          const active = riskFilter === tab
          const clr = RISK_COLORS[tab] || ACCENT
          return (
            <button
              key={tab}
              onClick={() => setRiskFilter(tab)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: active ? clr : THEME.surfaceVar,
                color: active ? '#fff' : THEME.textMed,
                transition: 'all .15s',
              }}
            >
              {tab === 'all' ? 'All' : RISK_LABELS[tab]} ({counts[tab] || 0})
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
            placeholder="Search SHEQ profiles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading SHEQ profiles...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="badge" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No SHEQ profiles yet.' : 'No profiles match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Employee', 'Blood Type', 'Risk Rating', 'Emergency Contact', 'Last Medical', 'Last Training', 'Induction Date', ''].map(h => (
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
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.blood_type || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={RISK_LABELS[r.risk_rating] || r.risk_rating} color={RISK_COLORS[r.risk_rating] || ACCENT} />
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.emergency_contact_name || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.last_medical_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.last_training_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.safety_induction_date || '--'}</td>
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
        <ProfileModal
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
