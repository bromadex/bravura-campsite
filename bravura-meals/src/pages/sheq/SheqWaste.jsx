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
  stored:    { label: 'Stored',    bg: '#FFF8E1', color: '#F59E0B', icon: 'inventory_2' },
  collected: { label: 'Collected', bg: '#E3F2FD', color: '#1565C0', icon: 'local_shipping' },
  disposed:  { label: 'Disposed',  bg: '#FFF3E0', color: '#E65100', icon: 'delete_sweep' },
  verified:  { label: 'Verified',  bg: '#E8F5E9', color: '#2E7D32', icon: 'verified' },
}

const STATUS_TABS = ['all', 'stored', 'collected', 'disposed', 'verified']

const WASTE_TYPES = [
  'general', 'organic', 'chemical', 'electronic', 'construction',
  'medical', 'metallic', 'plastic', 'paper', 'oil_grease', 'other',
]

const WASTE_CLASSES = ['hazardous', 'non_hazardous']

const DISPOSAL_METHODS = [
  'landfill', 'incineration', 'recycling', 'composting', 'chemical_treatment',
  'bioremediation', 'secure_storage', 'licensed_contractor', 'other',
]

const UNITS = ['kg', 'tonnes', 'litres', 'm3', 'drums', 'bags', 'loads']

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

function WasteClassBadge({ cls }) {
  const isHaz = cls === 'hazardous'
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 10px', borderRadius: '6px',
      fontSize: '11px', fontWeight: 600,
      background: isHaz ? '#FFEBEE' : '#E8F5E9',
      color: isHaz ? '#D32F2F' : '#2E7D32',
    }}>
      {isHaz ? 'Hazardous' : 'Non-Hazardous'}
    </span>
  )
}

function WasteTypeBadge({ type }) {
  return (
    <span style={{
      display: 'inline-flex', padding: '3px 10px', borderRadius: '6px',
      fontSize: '11px', fontWeight: 600, background: '#EDE7F6', color: '#5E35B1',
    }}>
      {fmtType(type)}
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

// ── Status flow ───────────────────────────────────────────────────────────

const STATUS_FLOW = {
  stored: 'collected',
  collected: 'disposed',
  disposed: 'verified',
}

// ── Create/Edit Modal ─────────────────────────────────────────────────────

function WasteModal({ record, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!record

  const [form, setForm] = useState(() => {
    if (record) return {
      waste_date: record.waste_date || '',
      waste_type: record.waste_type || '',
      waste_class: record.waste_class || '',
      description: record.description || '',
      source_location: record.source_location || '',
      quantity: record.quantity ?? '',
      unit: record.unit || 'kg',
      storage_location: record.storage_location || '',
      disposal_method: record.disposal_method || '',
      disposal_contractor: record.disposal_contractor || '',
      manifest_number: record.manifest_number || '',
      disposal_date: record.disposal_date || '',
      disposal_notes: record.disposal_notes || '',
      cost: record.cost ?? '',
      status: record.status || 'stored',
    }
    return {
      waste_date: new Date().toISOString().slice(0, 10),
      waste_type: '', waste_class: '', description: '',
      source_location: '', quantity: '', unit: 'kg', storage_location: '',
      disposal_method: '', disposal_contractor: '', manifest_number: '',
      disposal_date: '', disposal_notes: '', cost: '', status: 'stored',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.waste_date || !form.waste_type || !form.waste_class || !form.description) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        waste_date: form.waste_date,
        waste_type: form.waste_type,
        waste_class: form.waste_class,
        description: form.description,
        source_location: form.source_location || null,
        quantity: form.quantity ? Number(form.quantity) : null,
        unit: form.unit || null,
        storage_location: form.storage_location || null,
        disposal_method: form.disposal_method || null,
        disposal_contractor: form.disposal_contractor || null,
        manifest_number: form.manifest_number || null,
        disposal_date: form.disposal_date || null,
        disposal_notes: form.disposal_notes || null,
        cost: form.cost ? Number(form.cost) : null,
        status: form.status,
      }

      if (isEdit) {
        if (form.status === 'verified' && record.status !== 'verified') {
          payload.verified_by = userId
          payload.verified_at = new Date().toISOString()
        }
        const { error } = await supabase
          .from('sheq_waste_records')
          .update(payload)
          .eq('id', record.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Waste record updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'WST', p_table: 'sheq_waste_records',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.record_number = numData
        payload.created_by = userId
        payload.status = 'stored'
        const { error } = await supabase.from('sheq_waste_records').insert(payload)
        if (error) throw error
        showToast(`Waste record ${numData} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusAdvance() {
    const next = STATUS_FLOW[record.status]
    if (!next) return
    if (next === 'verified' && !canApprove) {
      showToast('You need approval permission to verify waste records', 'error'); return
    }
    const updates = { status: next }
    if (next === 'verified') { updates.verified_by = userId; updates.verified_at = new Date().toISOString() }
    const { error } = await supabase
      .from('sheq_waste_records')
      .update(updates)
      .eq('id', record.id)
      .eq('site_id', siteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Status advanced to ${STATUS_META[next]?.label || next}`)
    onSaved()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '620px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${record.record_number}` : 'New Waste Record'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

          {/* Basic */}
          <SectionLabel>Basic Information</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Waste Date" required>
              <input style={inputStyle} type="date" value={form.waste_date} onChange={e => set('waste_date', e.target.value)} />
            </Field>
            <Field label="Waste Type" required>
              <select style={selectStyle} value={form.waste_type} onChange={e => set('waste_type', e.target.value)}>
                <option value="">Select type...</option>
                {WASTE_TYPES.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
              </select>
            </Field>
            <Field label="Waste Class" required>
              <select style={selectStyle} value={form.waste_class} onChange={e => set('waste_class', e.target.value)}>
                <option value="">Select class...</option>
                {WASTE_CLASSES.map(c => <option key={c} value={c}>{fmtType(c)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description" required>
            <textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the waste..." />
          </Field>

          {/* Details */}
          <SectionLabel>Details</SectionLabel>
          <Field label="Source Location">
            <input style={inputStyle} value={form.source_location} onChange={e => set('source_location', e.target.value)} placeholder="e.g. Workshop, Processing Plant" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Quantity">
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
            </Field>
            <Field label="Unit">
              <select style={selectStyle} value={form.unit} onChange={e => set('unit', e.target.value)}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Storage Location">
              <input style={inputStyle} value={form.storage_location} onChange={e => set('storage_location', e.target.value)} />
            </Field>
          </div>

          {/* Disposal */}
          <SectionLabel>Disposal</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Disposal Method">
              <select style={selectStyle} value={form.disposal_method} onChange={e => set('disposal_method', e.target.value)}>
                <option value="">Select method...</option>
                {DISPOSAL_METHODS.map(m => <option key={m} value={m}>{fmtType(m)}</option>)}
              </select>
            </Field>
            <Field label="Disposal Contractor">
              <input style={inputStyle} value={form.disposal_contractor} onChange={e => set('disposal_contractor', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Manifest Number">
              <input style={inputStyle} value={form.manifest_number} onChange={e => set('manifest_number', e.target.value)} />
            </Field>
            <Field label="Disposal Date">
              <input style={inputStyle} type="date" value={form.disposal_date} onChange={e => set('disposal_date', e.target.value)} />
            </Field>
          </div>
          <Field label="Disposal Notes">
            <textarea style={textareaStyle} value={form.disposal_notes} onChange={e => set('disposal_notes', e.target.value)} />
          </Field>
          <Field label="Cost (USD)">
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)} />
          </Field>

          {/* Status */}
          <SectionLabel>Status</SectionLabel>
          <Field label="Status">
            <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)} disabled={!isEdit}>
              {['stored', 'collected', 'disposed', 'verified'].map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
            </select>
          </Field>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <div>
            {isEdit && STATUS_FLOW[record.status] && (
              <Button onClick={handleStatusAdvance} icon="arrow_forward">
                Advance to {STATUS_META[STATUS_FLOW[record.status]]?.label}
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Record'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────

export default function SheqWaste({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editRecord, setEditRecord] = useState(null)

  const canView    = can('sheq.view')
  const canCreate  = can('sheq.create')
  const canEdit    = can('sheq.edit')
  const canApprove = can('sheq.approve')

  async function fetchRecords() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase
        .from('sheq_waste_records')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('waste_date', { ascending: false })
      if (err) throw err
      setRecords(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRecords() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = records
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.record_number?.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.manifest_number?.toLowerCase().includes(q)
      )
    }
    return list
  }, [records, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: records.length, stored: 0, collected: 0, disposed: 0, verified: 0 }
    records.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [records])

  // KPI calculations
  const kpis = useMemo(() => {
    const hazardous = records.filter(r => r.waste_class === 'hazardous')
    const totalQty = records.reduce((sum, r) => {
      if (r.unit === 'tonnes') return sum + (r.quantity || 0)
      if (r.unit === 'kg') return sum + ((r.quantity || 0) / 1000)
      return sum
    }, 0)
    const pendingDisposal = records.filter(r => r.status === 'stored' || r.status === 'collected')
    return {
      total: records.length,
      hazardous: hazardous.length,
      totalTonnes: totalQty.toFixed(1),
      pendingDisposal: pendingDisposal.length,
    }
  }, [records])

  function handleExport() {
    const headers = ['Record #', 'Date', 'Type', 'Class', 'Description', 'Quantity', 'Unit', 'Disposal Method', 'Manifest #', 'Status']
    const rows = filtered.map(r => [
      r.record_number, r.waste_date, fmtType(r.waste_type), fmtType(r.waste_class),
      r.description || '', r.quantity ?? '', r.unit || '',
      fmtType(r.disposal_method), r.manifest_number || '',
      STATUS_META[r.status]?.label || r.status,
    ])
    exportCsv(`sheq-waste-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(item) {
    if (!confirm(`Archive waste record ${item.record_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_waste_records')
      .update({ is_archived: true })
      .eq('id', item.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Waste record archived')
    fetchRecords()
  }

  function onSaved() {
    setShowCreate(false)
    setEditRecord(null)
    fetchRecords()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_waste" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view waste management.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_waste" />

      <PageHeader
        title="Waste Management"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">New Record</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Records', value: kpis.total, icon: 'inventory_2', color: '#1565C0' },
          { label: 'Hazardous', value: kpis.hazardous, icon: 'warning', color: '#D32F2F' },
          { label: 'Total (tonnes)', value: kpis.totalTonnes, icon: 'scale', color: '#5E35B1' },
          { label: 'Pending Disposal', value: kpis.pendingDisposal, icon: 'pending_actions', color: '#F59E0B' },
        ].map(k => (
          <Card key={k.label} style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: k.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={k.icon} size={20} style={{ color: k.color }} />
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{k.value}</div>
              <div style={{ fontSize: '11px', color: THEME.textMed, fontWeight: 500 }}>{k.label}</div>
            </div>
          </Card>
        ))}
      </div>

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
            placeholder="Search waste records..."
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
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading waste records...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="delete_sweep" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {records.length === 0 ? 'No waste records yet.' : 'No records match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Record #', 'Date', 'Type', 'Class', 'Description', 'Qty', 'Disposal', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(item => (
                  <tr
                    key={item.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditRecord(item)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{item.record_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{item.waste_date || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><WasteTypeBadge type={item.waste_type} /></td>
                    <td style={{ padding: '10px 12px' }}><WasteClassBadge cls={item.waste_class} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>
                      {item.quantity != null ? `${item.quantity} ${item.unit || ''}` : '--'}
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{fmtType(item.disposal_method) || '--'}</td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={item.status} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); setEditRecord(item) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title="Edit"
                          >
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={e => { e.stopPropagation(); handleArchive(item) }}
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
      {(showCreate || editRecord) && (
        <WasteModal
          record={editRecord}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditRecord(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
