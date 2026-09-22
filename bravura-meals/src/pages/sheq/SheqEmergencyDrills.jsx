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
  scheduled: { label: 'Scheduled', bg: '#E3F2FD', color: '#1565C0', icon: 'schedule' },
  completed: { label: 'Completed', bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  cancelled: { label: 'Cancelled', bg: '#FFEBEE', color: '#D32F2F', icon: 'cancel' },
}

const RATING_META = {
  excellent:          { label: 'Excellent',          bg: '#E8F5E9', color: '#1B5E20' },
  good:              { label: 'Good',              bg: '#E8F5E9', color: '#2E7D32' },
  satisfactory:      { label: 'Satisfactory',      bg: '#FFF8E1', color: '#F59E0B' },
  needs_improvement: { label: 'Needs Improvement', bg: '#FFF3E0', color: '#E65100' },
  poor:              { label: 'Poor',              bg: '#FFEBEE', color: '#D32F2F' },
}

const FILTER_TABS = ['all', 'scheduled', 'completed', 'cancelled']
const DRILL_TYPES = ['fire', 'evacuation', 'chemical_spill', 'medical', 'security', 'full_scale', 'tabletop']
const STATUS_OPTIONS = ['scheduled', 'completed', 'cancelled']
const RATING_OPTIONS = ['excellent', 'good', 'satisfactory', 'needs_improvement', 'poor']

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

function RatingBadge({ rating }) {
  const m = RATING_META[rating] || { label: rating, bg: THEME.surfaceVar, color: THEME.textMed }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: m.bg, color: m.color,
    }}>
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

function DrillModal({ item, profiles, plans, siteId, userId, onClose, onSaved }) {
  const isEdit = !!item

  const [form, setForm] = useState(() => {
    if (item) return {
      plan_id: item.plan_id || '',
      drill_type: item.drill_type || '',
      drill_date: item.drill_date || '',
      start_time: item.start_time || '',
      end_time: item.end_time || '',
      conducted_by: item.conducted_by || '',
      participants_count: item.participants_count ?? '',
      evacuation_time_minutes: item.evacuation_time_minutes ?? '',
      scenario_description: item.scenario_description || '',
      observations: item.observations || '',
      improvements_identified: item.improvements_identified || '',
      overall_rating: item.overall_rating || '',
      status: item.status || 'scheduled',
      next_drill_date: item.next_drill_date || '',
    }
    return {
      plan_id: '', drill_type: '', drill_date: new Date().toISOString().slice(0, 10),
      start_time: '', end_time: '', conducted_by: '', participants_count: '',
      evacuation_time_minutes: '', scenario_description: '', observations: '',
      improvements_identified: '', overall_rating: '', status: 'scheduled',
      next_drill_date: '',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.drill_type || !form.drill_date) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        plan_id: form.plan_id || null,
        drill_type: form.drill_type,
        drill_date: form.drill_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        conducted_by: form.conducted_by || null,
        participants_count: form.participants_count !== '' ? Number(form.participants_count) : null,
        evacuation_time_minutes: form.evacuation_time_minutes !== '' ? Number(form.evacuation_time_minutes) : null,
        scenario_description: form.scenario_description || null,
        observations: form.observations || null,
        improvements_identified: form.improvements_identified || null,
        overall_rating: form.overall_rating || null,
        status: form.status,
        next_drill_date: form.next_drill_date || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_emergency_drills')
          .update(payload)
          .eq('id', item.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Drill updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'DRL', p_table: 'sheq_emergency_drills',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.drill_number = numData
        payload.created_by = userId
        const { error } = await supabase.from('sheq_emergency_drills').insert(payload)
        if (error) throw error
        showToast(`Drill ${numData} created`)
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
            {isEdit ? `Edit ${item.drill_number}` : 'New Emergency Drill'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Drill Type" required>
              <select style={selectStyle} value={form.drill_type} onChange={e => set('drill_type', e.target.value)}>
                <option value="">Select...</option>
                {DRILL_TYPES.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
              </select>
            </Field>
            <Field label="Linked Plan">
              <select style={selectStyle} value={form.plan_id} onChange={e => set('plan_id', e.target.value)}>
                <option value="">None</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.plan_number} - {p.title}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Drill Date" required>
              <input style={inputStyle} type="date" value={form.drill_date} onChange={e => set('drill_date', e.target.value)} />
            </Field>
            <Field label="Start Time">
              <input style={inputStyle} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
            </Field>
            <Field label="End Time">
              <input style={inputStyle} type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Conducted By">
              <select style={selectStyle} value={form.conducted_by} onChange={e => set('conducted_by', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Participants Count">
              <input style={inputStyle} type="number" min="0" value={form.participants_count} onChange={e => set('participants_count', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Evacuation Time (min)">
              <input style={inputStyle} type="number" min="0" step="any" value={form.evacuation_time_minutes} onChange={e => set('evacuation_time_minutes', e.target.value)} placeholder="0" />
            </Field>
          </div>
          <Field label="Scenario Description">
            <textarea style={textareaStyle} value={form.scenario_description} onChange={e => set('scenario_description', e.target.value)} placeholder="Describe the drill scenario..." />
          </Field>
          <Field label="Observations">
            <textarea style={textareaStyle} value={form.observations} onChange={e => set('observations', e.target.value)} placeholder="Observations during the drill..." />
          </Field>
          <Field label="Improvements Identified">
            <textarea style={textareaStyle} value={form.improvements_identified} onChange={e => set('improvements_identified', e.target.value)} placeholder="Areas for improvement..." />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Overall Rating">
              <select style={selectStyle} value={form.overall_rating} onChange={e => set('overall_rating', e.target.value)}>
                <option value="">Select...</option>
                {RATING_OPTIONS.map(r => <option key={r} value={r}>{fmtType(r)}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
              </select>
            </Field>
            <Field label="Next Drill Date">
              <input style={inputStyle} type="date" value={form.next_drill_date} onChange={e => set('next_drill_date', e.target.value)} />
            </Field>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Drill'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqEmergencyDrills({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_emergency_drills', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [items, setItems] = useState([])
  const [profiles, setProfiles] = useState([])
  const [plans, setPlans] = useState([])
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

  const planMap = useMemo(() => {
    const m = {}; plans.forEach(p => { m[p.id] = p.plan_number }); return m
  }, [plans])

  async function fetchData() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const [{ data, error: err }, { data: emp }, { data: pl }] = await Promise.all([
        supabase.from('sheq_emergency_drills').select('*').eq('site_id', currentSiteId).is('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
        supabase.from('sheq_emergency_plans').select('id, title, plan_number').eq('site_id', currentSiteId).is('is_archived', false).order('title'),
      ])
      if (err) throw err
      setItems(data || [])
      setProfiles(emp || [])
      setPlans(pl || [])
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
        r.drill_number?.toLowerCase().includes(q) ||
        r.scenario_description?.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, tab, search])

  const counts = useMemo(() => {
    const c = { all: items.length, scheduled: 0, completed: 0, cancelled: 0 }
    items.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [items])

  function handleExport() {
    const headers = ['Drill #', 'Type', 'Date', 'Plan', 'Conducted By', 'Participants', 'Rating', 'Status']
    const rows = filtered.map(r => [
      r.drill_number, fmtType(r.drill_type), r.drill_date || '',
      planMap[r.plan_id] || '', profileMap[r.conducted_by] || '',
      r.participants_count ?? '', fmtType(r.overall_rating), fmtType(r.status),
    ])
    exportCsv(`sheq-emergency-drills-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(item) {
    if (!confirm(`Archive drill ${item.drill_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_emergency_drills')
      .update({ is_archived: true })
      .eq('id', item.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Drill archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_emergency_drills" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view emergency drills.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_emergency_drills" />

      <PageHeader
        title="Emergency Drills"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Drill</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Drills', value: counts.all, icon: 'local_fire_department', color: '#1565C0' },
          { label: 'Scheduled', value: counts.scheduled, icon: 'schedule', color: '#1565C0' },
          { label: 'Completed', value: counts.completed, icon: 'check_circle', color: '#2E7D32' },
          { label: 'Cancelled', value: counts.cancelled, icon: 'cancel', color: '#D32F2F' },
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
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search drills..." value={search} onChange={e => setSearch(e.target.value)} />
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading drills...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="local_fire_department" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {items.length === 0 ? 'No emergency drills yet.' : 'No drills match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Drill #', 'Type', 'Date', 'Plan', 'Conducted By', 'Participants', 'Rating', 'Status', ''].map(h => (
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
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.drill_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{fmtType(r.drill_type)}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.drill_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{planMap[r.plan_id] || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.conducted_by] || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.participants_count ?? '--'}</td>
                    <td style={{ padding: '10px 12px' }}>{r.overall_rating ? <RatingBadge rating={r.overall_rating} /> : '--'}</td>
                    <td style={{ padding: '10px 12px' }}><Badge status={r.status} /></td>
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
        <DrillModal item={editItem} profiles={profiles} plans={plans} siteId={currentSiteId} userId={user?.id} onClose={() => { setShowCreate(false); setEditItem(null) }} onSaved={onSaved} />
      )}
    </div>
  )
}
