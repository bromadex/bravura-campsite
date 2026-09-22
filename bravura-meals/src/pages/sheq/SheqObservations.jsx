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

const OBS_TYPES = ['positive', 'unsafe_act', 'unsafe_condition']
const TYPE_LABELS = { positive: 'Positive', unsafe_act: 'Unsafe Act', unsafe_condition: 'Unsafe Condition' }
const TYPE_COLORS = { positive: '#2E7D32', unsafe_act: '#E65100', unsafe_condition: '#D32F2F' }
const FILTER_TABS = ['all', 'positive', 'unsafe_act', 'unsafe_condition']

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

// ── Create/Edit Modal ───────────────────────────────────────────────────────

function ObservationModal({ obs, departments, siteId, userId, onClose, onSaved }) {
  const isEdit = !!obs
  const [form, setForm] = useState(() => {
    if (obs) return {
      observation_date: obs.observation_date || new Date().toISOString().slice(0, 10),
      observation_type: obs.observation_type || 'positive',
      location: obs.location || '',
      department_id: obs.department_id || '',
      description: obs.description || '',
      action_taken: obs.action_taken || '',
      worker_name: obs.worker_name || '',
    }
    return {
      observation_date: new Date().toISOString().slice(0, 10),
      observation_type: 'positive', location: '', department_id: '',
      description: '', action_taken: '', worker_name: '',
    }
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.description || !form.observation_date) {
      showToast('Description and date are required', 'error'); return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const { error } = await supabase.from('sheq_observations').update({
          observation_date: form.observation_date,
          observation_type: form.observation_type,
          location: form.location || null,
          department_id: form.department_id || null,
          description: form.description,
          action_taken: form.action_taken || null,
          worker_name: form.worker_name || null,
        }).eq('id', obs.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Observation updated')
      } else {
        const { error } = await supabase.from('sheq_observations').insert({
          site_id: siteId,
          observation_date: form.observation_date,
          observer_id: userId,
          observation_type: form.observation_type,
          location: form.location || null,
          department_id: form.department_id || null,
          description: form.description,
          action_taken: form.action_taken || null,
          worker_name: form.worker_name || null,
        })
        if (error) throw error
        showToast('Observation recorded')
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
            {isEdit ? 'Edit Observation' : 'New Observation'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Observation Date" required>
            <input style={inputStyle} type="date" value={form.observation_date} onChange={e => set('observation_date', e.target.value)} />
          </Field>

          <Field label="Observation Type" required>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {OBS_TYPES.map(t => (
                <label key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.text, cursor: 'pointer' }}>
                  <input type="radio" name="obs_type" checked={form.observation_type === t} onChange={() => set('observation_type', t)} />
                  <span style={{ color: TYPE_COLORS[t], fontWeight: 600 }}>{TYPE_LABELS[t]}</span>
                </label>
              ))}
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Location">
              <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Plant Area B" />
            </Field>
            <Field label="Department">
              <select style={selectStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
                <option value="">Select...</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Description" required>
            <textarea style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>

          <Field label="Action Taken">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.action_taken} onChange={e => set('action_taken', e.target.value)} />
          </Field>

          <Field label="Worker Name">
            <input style={inputStyle} value={form.worker_name} onChange={e => set('worker_name', e.target.value)} placeholder="Name of observed worker" />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Record Observation'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function SheqObservations({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_observations', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [departments, setDepartments] = useState([])

  const canView = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit = can('sheq.edit')

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data, error }, { data: depts }] = await Promise.all([
      supabase
        .from('sheq_observations')
        .select('*, observer:profiles!sheq_observations_observer_id_fkey(full_name)')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('observation_date', { ascending: false }),
      supabase.from('departments').select('id, name'),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setDepartments(depts || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData, rt])

  // KPIs — this month
  const kpis = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const thisMonth = rows.filter(r => r.observation_date >= monthStart)
    const pos = thisMonth.filter(r => r.observation_type === 'positive').length
    const acts = thisMonth.filter(r => r.observation_type === 'unsafe_act').length
    const conds = thisMonth.filter(r => r.observation_type === 'unsafe_condition').length
    const total = thisMonth.length
    const ratio = total > 0 ? ((pos / total) * 100).toFixed(1) : '0.0'
    return { total, pos, acts, conds, ratio }
  }, [rows])

  const filtered = useMemo(() => {
    let list = rows
    if (typeFilter !== 'all') list = list.filter(r => r.observation_type === typeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.description?.toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q) ||
        r.worker_name?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, typeFilter, search])

  const counts = useMemo(() => {
    const c = { all: rows.length, positive: 0, unsafe_act: 0, unsafe_condition: 0 }
    rows.forEach(r => { if (c[r.observation_type] !== undefined) c[r.observation_type]++ })
    return c
  }, [rows])

  function handleExport() {
    const headers = ['Date', 'Type', 'Location', 'Description', 'Action Taken', 'Observer', 'Worker']
    const csvRows = filtered.map(r => [
      r.observation_date, TYPE_LABELS[r.observation_type] || r.observation_type,
      r.location || '', r.description, r.action_taken || '',
      r.observer?.full_name || '', r.worker_name || '',
    ])
    exportCsv(`sheq-observations-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm('Archive this observation?')) return
    const { error } = await supabase.from('sheq_observations').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Observation archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_observations" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view observations.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_observations" />

      <PageHeader
        title="Safety Observations"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Observation</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'This Month', value: kpis.total, icon: 'calendar_month', color: ACCENT },
          { label: 'Positive', value: kpis.pos, icon: 'thumb_up', color: '#2E7D32' },
          { label: 'Unsafe Acts', value: kpis.acts, icon: 'warning', color: '#E65100' },
          { label: 'Unsafe Conditions', value: kpis.conds, icon: 'report_problem', color: '#D32F2F' },
          { label: 'Positive Ratio', value: kpis.ratio + '%', icon: 'percent', color: '#2E7D32' },
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
          const active = typeFilter === tab
          const clr = TYPE_COLORS[tab] || ACCENT
          return (
            <button
              key={tab}
              onClick={() => setTypeFilter(tab)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: active ? clr : THEME.surfaceVar,
                color: active ? '#fff' : THEME.textMed,
                transition: 'all .15s',
              }}
            >
              {tab === 'all' ? 'All' : TYPE_LABELS[tab]} ({counts[tab] || 0})
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
            placeholder="Search observations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading observations...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="visibility" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No observations yet.' : 'No observations match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Date', 'Type', 'Location', 'Description', 'Observer', 'Worker', ''].map(h => (
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
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.observation_date}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={TYPE_LABELS[r.observation_type]} color={TYPE_COLORS[r.observation_type]} />
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.location || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.observer?.full_name || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.worker_name || '--'}</td>
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
        <ObservationModal
          obs={editRow}
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
