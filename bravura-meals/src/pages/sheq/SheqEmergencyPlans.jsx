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
  draft:        { label: 'Draft',        bg: '#E3F2FD', color: '#1565C0', icon: 'edit_note' },
  approved:     { label: 'Approved',     bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  active:       { label: 'Active',       bg: '#E8F5E9', color: '#1B5E20', icon: 'verified' },
  under_review: { label: 'Under Review', bg: '#FFF8E1', color: '#F59E0B', icon: 'rate_review' },
  obsolete:     { label: 'Obsolete',     bg: '#FFEBEE', color: '#D32F2F', icon: 'block' },
}

const FILTER_TABS = ['all', 'draft', 'approved', 'active', 'under_review']
const PLAN_TYPES = ['fire', 'chemical_spill', 'medical', 'natural_disaster', 'evacuation', 'security', 'explosion', 'general']
const STATUS_OPTIONS = ['draft', 'approved', 'active', 'under_review', 'obsolete']

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

function PlanModal({ item, profiles, departments, siteId, userId, onClose, onSaved }) {
  const isEdit = !!item

  const [form, setForm] = useState(() => {
    if (item) return {
      title: item.title || '',
      plan_type: item.plan_type || '',
      version: item.version || '',
      status: item.status || 'draft',
      effective_date: item.effective_date || '',
      review_date: item.review_date || '',
      approved_by: item.approved_by || '',
      coordinator_id: item.coordinator_id || '',
      assembly_points: item.assembly_points || '',
      emergency_contacts: item.emergency_contacts || '',
      procedures: item.procedures || '',
      resources_required: item.resources_required || '',
      department_id: item.department_id || '',
    }
    return {
      title: '', plan_type: '', version: '1.0', status: 'draft',
      effective_date: '', review_date: '', approved_by: '',
      coordinator_id: '', assembly_points: '', emergency_contacts: '',
      procedures: '', resources_required: '', department_id: '',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.title || !form.plan_type) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        plan_type: form.plan_type,
        version: form.version || null,
        status: form.status,
        effective_date: form.effective_date || null,
        review_date: form.review_date || null,
        approved_by: form.approved_by || null,
        coordinator_id: form.coordinator_id || null,
        assembly_points: form.assembly_points || null,
        emergency_contacts: form.emergency_contacts || null,
        procedures: form.procedures || null,
        resources_required: form.resources_required || null,
        department_id: form.department_id || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_emergency_plans')
          .update(payload)
          .eq('id', item.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Emergency plan updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'EMP', p_table: 'sheq_emergency_plans',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.plan_number = numData
        payload.created_by = userId
        const { error } = await supabase.from('sheq_emergency_plans').insert(payload)
        if (error) throw error
        showToast(`Plan ${numData} created`)
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
          width: '660px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${item.plan_number}` : 'New Emergency Plan'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Emergency plan title" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Plan Type" required>
              <select style={selectStyle} value={form.plan_type} onChange={e => set('plan_type', e.target.value)}>
                <option value="">Select...</option>
                {PLAN_TYPES.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
              </select>
            </Field>
            <Field label="Version">
              <input style={inputStyle} value={form.version} onChange={e => set('version', e.target.value)} placeholder="e.g. 1.0" />
            </Field>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Effective Date">
              <input style={inputStyle} type="date" value={form.effective_date} onChange={e => set('effective_date', e.target.value)} />
            </Field>
            <Field label="Review Date">
              <input style={inputStyle} type="date" value={form.review_date} onChange={e => set('review_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Approved By">
              <select style={selectStyle} value={form.approved_by} onChange={e => set('approved_by', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Coordinator">
              <select style={selectStyle} value={form.coordinator_id} onChange={e => set('coordinator_id', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Department">
            <select style={selectStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
              <option value="">Select...</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Assembly Points">
            <textarea style={textareaStyle} value={form.assembly_points} onChange={e => set('assembly_points', e.target.value)} placeholder="List assembly points..." />
          </Field>
          <Field label="Emergency Contacts">
            <textarea style={textareaStyle} value={form.emergency_contacts} onChange={e => set('emergency_contacts', e.target.value)} placeholder="Emergency contact numbers..." />
          </Field>
          <Field label="Procedures">
            <textarea style={textareaStyle} value={form.procedures} onChange={e => set('procedures', e.target.value)} placeholder="Emergency procedures..." />
          </Field>
          <Field label="Resources Required">
            <textarea style={textareaStyle} value={form.resources_required} onChange={e => set('resources_required', e.target.value)} placeholder="Required resources..." />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Plan'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqEmergencyPlans({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_emergency_plans', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [items, setItems] = useState([])
  const [profiles, setProfiles] = useState([])
  const [departments, setDepartments] = useState([])
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
      const [{ data, error: err }, { data: emp }, { data: dept }] = await Promise.all([
        supabase.from('sheq_emergency_plans').select('*').eq('site_id', currentSiteId).is('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
        supabase.from('departments').select('id, name').eq('site_id', currentSiteId).order('name'),
      ])
      if (err) throw err
      setItems(data || [])
      setProfiles(emp || [])
      setDepartments(dept || [])
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
        r.plan_number?.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, tab, search])

  const counts = useMemo(() => {
    const c = { all: items.length, draft: 0, approved: 0, active: 0, under_review: 0 }
    items.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [items])

  function handleExport() {
    const headers = ['Plan #', 'Title', 'Type', 'Version', 'Status', 'Effective', 'Review Date', 'Coordinator']
    const rows = filtered.map(r => [
      r.plan_number, r.title || '', fmtType(r.plan_type), r.version || '',
      fmtType(r.status), r.effective_date || '', r.review_date || '',
      profileMap[r.coordinator_id] || '',
    ])
    exportCsv(`sheq-emergency-plans-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(item) {
    if (!confirm(`Archive plan ${item.plan_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_emergency_plans')
      .update({ is_archived: true })
      .eq('id', item.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Plan archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_emergency_plans" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view emergency plans.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_emergency_plans" />

      <PageHeader
        title="Emergency Plans"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Plan</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Plans', value: counts.all, icon: 'emergency', color: '#1565C0' },
          { label: 'Active', value: counts.active, icon: 'verified', color: '#1B5E20' },
          { label: 'Draft', value: counts.draft, icon: 'edit_note', color: '#1565C0' },
          { label: 'Under Review', value: counts.under_review, icon: 'rate_review', color: '#F59E0B' },
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
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search plans..." value={search} onChange={e => setSearch(e.target.value)} />
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading emergency plans...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="emergency" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {items.length === 0 ? 'No emergency plans yet.' : 'No plans match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Plan #', 'Title', 'Type', 'Version', 'Status', 'Effective', 'Review Date', 'Coordinator', ''].map(h => (
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
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.plan_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{fmtType(r.plan_type)}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.version || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><Badge status={r.status} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.effective_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.review_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.coordinator_id] || '--'}</td>
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
        <PlanModal item={editItem} profiles={profiles} departments={departments} siteId={currentSiteId} userId={user?.id} onClose={() => { setShowCreate(false); setEditItem(null) }} onSaved={onSaved} />
      )}
    </div>
  )
}
