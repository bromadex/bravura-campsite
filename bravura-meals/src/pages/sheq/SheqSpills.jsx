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

const STATUS_META = {
  active:      { label: 'Active',      bg: '#FFEBEE', color: '#D32F2F', icon: 'error' },
  contained:   { label: 'Contained',   bg: '#FFF3E0', color: '#E65100', icon: 'shield' },
  cleanup:     { label: 'Cleanup',     bg: '#FFF8E1', color: '#F59E0B', icon: 'cleaning_services' },
  remediation: { label: 'Remediation', bg: '#E3F2FD', color: '#1565C0', icon: 'build' },
  closed:      { label: 'Closed',      bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
}

const STATUS_TABS = ['all', 'active', 'contained', 'cleanup', 'remediation', 'closed']

const SUBSTANCE_TYPES = ['fuel', 'oil', 'chemical', 'sewage', 'process_water', 'hazardous_material', 'other']
const VOLUME_UNITS = ['litres', 'm3', 'kg', 'gallons']
const STATUS_OPTIONS = ['active', 'contained', 'cleanup', 'remediation', 'closed']

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

function SpillModal({ spill, siteId, userId, onClose, onSaved }) {
  const isEdit = !!spill

  const [form, setForm] = useState(() => {
    if (spill) return {
      spill_date: spill.spill_date || '',
      spill_time: spill.spill_time || '',
      location: spill.location || '',
      substance: spill.substance || '',
      substance_type: spill.substance_type || '',
      estimated_volume: spill.estimated_volume ?? '',
      volume_unit: spill.volume_unit || 'litres',
      cause: spill.cause || '',
      containment_actions: spill.containment_actions || '',
      cleanup_actions: spill.cleanup_actions || '',
      environmental_impact: spill.environmental_impact || '',
      reportable: spill.reportable ?? false,
      authority_notified: spill.authority_notified ?? false,
      authority_ref: spill.authority_ref || '',
      status: spill.status || 'active',
    }
    return {
      spill_date: new Date().toISOString().slice(0, 10),
      spill_time: '', location: '', substance: '', substance_type: '',
      estimated_volume: '', volume_unit: 'litres', cause: '',
      containment_actions: '', cleanup_actions: '', environmental_impact: '',
      reportable: false, authority_notified: false, authority_ref: '',
      status: 'active',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.spill_date || !form.substance_type || !form.location) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        spill_date: form.spill_date,
        spill_time: form.spill_time || null,
        location: form.location,
        substance: form.substance || null,
        substance_type: form.substance_type,
        estimated_volume: form.estimated_volume !== '' ? Number(form.estimated_volume) : null,
        volume_unit: form.volume_unit || null,
        cause: form.cause || null,
        containment_actions: form.containment_actions || null,
        cleanup_actions: form.cleanup_actions || null,
        environmental_impact: form.environmental_impact || null,
        reportable: form.reportable,
        authority_notified: form.authority_notified,
        authority_ref: form.authority_ref || null,
        status: form.status,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_spill_incidents')
          .update(payload)
          .eq('id', spill.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Spill incident updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'SPL', p_table: 'sheq_spill_incidents',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.spill_number = numData
        payload.created_by = userId
        const { error } = await supabase.from('sheq_spill_incidents').insert(payload)
        if (error) throw error
        showToast(`Spill ${numData} created`)
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
            {isEdit ? `Edit ${spill.spill_number}` : 'New Spill Incident'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          <SectionLabel>Incident Details</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Spill Date" required>
              <input style={inputStyle} type="date" value={form.spill_date} onChange={e => set('spill_date', e.target.value)} />
            </Field>
            <Field label="Spill Time">
              <input style={inputStyle} type="time" value={form.spill_time} onChange={e => set('spill_time', e.target.value)} />
            </Field>
          </div>
          <Field label="Location" required>
            <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="Where did the spill occur?" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Substance">
              <input style={inputStyle} value={form.substance} onChange={e => set('substance', e.target.value)} placeholder="e.g. Diesel, Hydraulic oil" />
            </Field>
            <Field label="Substance Type" required>
              <select style={selectStyle} value={form.substance_type} onChange={e => set('substance_type', e.target.value)}>
                <option value="">Select...</option>
                {SUBSTANCE_TYPES.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
              </select>
            </Field>
          </div>

          <SectionLabel>Volume</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Estimated Volume">
              <input style={inputStyle} type="number" min="0" step="any" value={form.estimated_volume} onChange={e => set('estimated_volume', e.target.value)} placeholder="0" />
            </Field>
            <Field label="Unit">
              <select style={selectStyle} value={form.volume_unit} onChange={e => set('volume_unit', e.target.value)}>
                {VOLUME_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
          </div>

          <SectionLabel>Cause & Response</SectionLabel>
          <Field label="Cause">
            <textarea style={textareaStyle} value={form.cause} onChange={e => set('cause', e.target.value)} placeholder="What caused the spill?" />
          </Field>
          <Field label="Containment Actions">
            <textarea style={textareaStyle} value={form.containment_actions} onChange={e => set('containment_actions', e.target.value)} placeholder="Actions taken to contain the spill..." />
          </Field>
          <Field label="Cleanup Actions">
            <textarea style={textareaStyle} value={form.cleanup_actions} onChange={e => set('cleanup_actions', e.target.value)} placeholder="Cleanup measures taken..." />
          </Field>
          <Field label="Environmental Impact">
            <textarea style={textareaStyle} value={form.environmental_impact} onChange={e => set('environmental_impact', e.target.value)} placeholder="Impact on the environment..." />
          </Field>

          <SectionLabel>Reporting & Status</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Reportable">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '9px 0' }}>
                <input type="checkbox" checked={form.reportable} onChange={e => set('reportable', e.target.checked)} />
                <span style={{ fontSize: '13px', color: THEME.text }}>Reportable to authorities</span>
              </label>
            </Field>
            <Field label="Authority Notified">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', padding: '9px 0' }}>
                <input type="checkbox" checked={form.authority_notified} onChange={e => set('authority_notified', e.target.checked)} />
                <span style={{ fontSize: '13px', color: THEME.text }}>Authority has been notified</span>
              </label>
            </Field>
          </div>
          {form.authority_notified && (
            <Field label="Authority Reference">
              <input style={inputStyle} value={form.authority_ref} onChange={e => set('authority_ref', e.target.value)} placeholder="Reference number from authority" />
            </Field>
          )}
          <Field label="Status">
            <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
            </select>
          </Field>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Spill'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function SheqSpills({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [spills, setSpills] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [substanceFilter, setSubstanceFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editSpill, setEditSpill] = useState(null)

  const canView   = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit   = can('sheq.edit')

  async function fetchSpills() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_spill_incidents')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false })
      if (err) throw err
      setSpills(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchSpills() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = spills
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (substanceFilter !== 'all') list = list.filter(r => r.substance_type === substanceFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.spill_number?.toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q) ||
        r.substance?.toLowerCase().includes(q)
      )
    }
    return list
  }, [spills, statusFilter, substanceFilter, search])

  const counts = useMemo(() => {
    const c = { all: spills.length, active: 0, contained: 0, cleanup: 0, remediation: 0, closed: 0 }
    spills.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [spills])

  const kpis = useMemo(() => {
    const active = spills.filter(r => r.status !== 'closed').length
    const reportable = spills.filter(r => r.reportable).length
    const thisMonth = spills.filter(r => {
      const d = r.spill_date
      if (!d) return false
      const now = new Date()
      return d.startsWith(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    }).length
    return { active, reportable, thisMonth, total: spills.length }
  }, [spills])

  function handleExport() {
    const headers = ['Spill #', 'Date', 'Location', 'Substance', 'Type', 'Volume', 'Unit', 'Reportable', 'Status']
    const rows = filtered.map(r => [
      r.spill_number, r.spill_date || '', r.location || '', r.substance || '',
      fmtType(r.substance_type), r.estimated_volume ?? '', r.volume_unit || '',
      r.reportable ? 'Yes' : 'No', r.status,
    ])
    exportCsv(`sheq-spills-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(spill) {
    if (!confirm(`Archive spill ${spill.spill_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_spill_incidents')
      .update({ is_archived: true })
      .eq('id', spill.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Spill archived')
    fetchSpills()
  }

  function onSaved() {
    setShowCreate(false)
    setEditSpill(null)
    fetchSpills()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_spills" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view spill management.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_spills" />

      <PageHeader
        title="Spill Management"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">New Spill</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Spills', value: kpis.total, icon: 'water_drop', color: '#1565C0' },
          { label: 'Active / Open', value: kpis.active, icon: 'error', color: '#D32F2F' },
          { label: 'Reportable', value: kpis.reportable, icon: 'flag', color: '#E65100' },
          { label: 'This Month', value: kpis.thisMonth, icon: 'calendar_today', color: '#7B1FA2' },
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

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
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

      {/* Substance filter + Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          style={{ ...selectStyle, maxWidth: '200px' }}
          value={substanceFilter}
          onChange={e => setSubstanceFilter(e.target.value)}
        >
          <option value="all">All substance types</option>
          {SUBSTANCE_TYPES.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
        </select>
        <div style={{ position: 'relative', maxWidth: '320px', flex: 1 }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            style={{ ...inputStyle, paddingLeft: '32px' }}
            placeholder="Search spills..."
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading spills...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="water_drop" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {spills.length === 0 ? 'No spill incidents recorded yet.' : 'No spills match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Spill #', 'Date', 'Location', 'Substance', 'Type', 'Volume', 'Reportable', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditSpill(r)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.spill_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.spill_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.location || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.substance || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{fmtType(r.substance_type)}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>
                      {r.estimated_volume != null ? `${r.estimated_volume} ${r.volume_unit || ''}` : '--'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {r.reportable && (
                        <Icon name="flag" size={16} style={{ color: '#D32F2F' }} />
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={r.status} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditSpill(r) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(r) }}
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
      {(showCreate || editSpill) && (
        <SpillModal
          spill={editSpill}
          siteId={currentSiteId}
          userId={user?.id}
          onClose={() => { setShowCreate(false); setEditSpill(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
