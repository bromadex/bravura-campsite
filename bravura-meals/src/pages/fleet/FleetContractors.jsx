import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.fleet

const ASSET_TYPES = ['excavator', 'truck', 'crane', 'loader', 'other']
const STATUSES = ['on_hire', 'off_hire', 'standby', 'returned']

const STATUS_COLORS = {
  on_hire:  { bg: '#e8f5e9', text: '#2e7d32', label: 'On Hire' },
  standby:  { bg: '#fff8e1', text: '#f57f17', label: 'Standby' },
  off_hire: { bg: '#f5f5f5', text: '#757575', label: 'Off Hire' },
  returned: { bg: '#e3f2fd', text: '#1565c0', label: 'Returned' },
}

function expiryStatus(dateStr) {
  if (!dateStr) return 'none'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = (d - now) / 86400000
  if (diff < 0) return 'expired'
  if (diff <= 30) return 'warning'
  return 'ok'
}

const EXPIRY_COLORS = {
  expired: { border: THEME.statusErrorText, bg: THEME.statusErrorBg, text: THEME.statusErrorText },
  warning: { border: THEME.statusWarningText, bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  ok:      { border: THEME.statusSuccessText, bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  none:    { border: THEME.outlineVar, bg: THEME.surface, text: THEME.textLow },
}

const EMPTY_FORM = {
  contractor_name: '', asset_description: '', asset_type: '', registration: '',
  serial_number: '', make: '', model: '', year: '', daily_rate: '', monthly_rate: '',
  hire_start_date: '', hire_end_date: '', status: 'on_hire', project: '',
  department_name: '', insurance_expiry: '', fitness_cert_expiry: '',
  operator_name: '', operator_contact: '', notes: '',
}

export default function FleetContractors({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('fleet_contractor_equipment', { column: 'site_id', value: currentSiteId }, fetchItems)

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchItems() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('fleet_contractor_equipment')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (!err) setItems(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchItems() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = items
    if (filterStatus !== 'all') list = list.filter(d => d.status === filterStatus)
    if (filterType !== 'all') list = list.filter(d => d.asset_type === filterType)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        (d.contractor_name || '').toLowerCase().includes(q) ||
        (d.asset_description || '').toLowerCase().includes(q) ||
        (d.registration || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, filterStatus, filterType, search])

  const kpis = useMemo(() => ({
    total: items.length,
    onHire: items.filter(d => d.status === 'on_hire').length,
    standby: items.filter(d => d.status === 'standby').length,
    monthlyCost: items.filter(d => d.status === 'on_hire').reduce((s, d) => s + (parseFloat(d.monthly_rate) || 0), 0),
  }), [items])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditId(item.id)
    const f = {}
    for (const k of Object.keys(EMPTY_FORM)) f[k] = item[k] ?? ''
    setForm(f)
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.contractor_name || !form.asset_description || !form.hire_start_date) {
      setError('Contractor name, asset description, and hire start date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        contractor_name: form.contractor_name,
        asset_description: form.asset_description,
        asset_type: form.asset_type || null,
        registration: form.registration || null,
        serial_number: form.serial_number || null,
        make: form.make || null,
        model: form.model || null,
        year: form.year ? parseInt(form.year) : null,
        daily_rate: form.daily_rate ? parseFloat(form.daily_rate) : null,
        monthly_rate: form.monthly_rate ? parseFloat(form.monthly_rate) : null,
        hire_start_date: form.hire_start_date,
        hire_end_date: form.hire_end_date || null,
        status: form.status,
        project: form.project || null,
        department_name: form.department_name || null,
        insurance_expiry: form.insurance_expiry || null,
        fitness_cert_expiry: form.fitness_cert_expiry || null,
        operator_name: form.operator_name || null,
        operator_contact: form.operator_contact || null,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_contractor_equipment').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_contractor_equipment').insert(payload)
        if (err) throw err
      }
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this equipment record?')) return
    try {
      const { error: err } = await supabase.from('fleet_contractor_equipment').update({ is_archived: true }).eq('id', editId)
      if (err) throw err
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleReturn(id) {
    if (!confirm('Mark this equipment as returned?')) return
    try {
      const { error: err } = await supabase.from('fleet_contractor_equipment').update({
        status: 'returned',
        hire_end_date: new Date().toISOString().split('T')[0],
      }).eq('id', id)
      if (err) throw err
      await fetchItems()
    } catch (err) {
      alert(err.message)
    }
  }

  function exportCSV() {
    const headers = ['Contractor', 'Asset Description', 'Asset Type', 'Registration', 'Status', 'Hire Start', 'Hire End', 'Daily Rate', 'Monthly Rate', 'Project', 'Operator', 'Insurance Expiry', 'Fitness Cert Expiry', 'Notes']
    const rows = filtered.map(d => [
      d.contractor_name, d.asset_description, d.asset_type || '', d.registration || '',
      d.status, d.hire_start_date || '', d.hire_end_date || '',
      d.daily_rate ?? '', d.monthly_rate ?? '', d.project || '',
      d.operator_name || '', d.insurance_expiry || '', d.fitness_cert_expiry || '', d.notes || '',
    ])
    const csv = '﻿' + [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'contractor_equipment.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  function expiryInputStyle(dateStr) {
    const st = expiryStatus(dateStr)
    const ec = EXPIRY_COLORS[st]
    return { ...inp, borderColor: ec.border }
  }

  function ExpiryCell({ dateStr }) {
    const st = expiryStatus(dateStr)
    const ec = EXPIRY_COLORS[st]
    return (
      <span style={{ fontSize: '12px', fontWeight: 600, color: ec.text }}>
        {dateStr || '-'}
        {st === 'expired' && <span style={{ marginLeft: '4px', fontSize: '10px' }}>EXPIRED</span>}
      </span>
    )
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Hired', value: kpis.total, icon: 'construction', bg: color + '14', fg: color },
    { label: 'On Hire', value: kpis.onHire, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Standby', value: kpis.standby, icon: 'pause_circle', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Monthly Cost', value: 'R ' + kpis.monthlyCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), icon: 'payments', bg: '#e3f2fd', fg: '#1565c0' },
  ]

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_contractors" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '18px',
            border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: k.fg }}>{k.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Contractor Equipment</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={exportCSV} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: THEME.surfaceVar, color: THEME.textMed,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>download</span>
            Export CSV
          </button>
          {can('fleet.create') && (
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              Add Equipment
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search contractor or asset..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Types</option>
          {ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>construction</span>
          <div style={{ fontSize: '14px' }}>No contractor equipment found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add new equipment</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Contractor', 'Asset', 'Type', 'Rego', 'Status', 'Hire Start', 'Hire End', 'Daily Rate', 'Project', 'Insurance', 'Fitness Cert', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const sc = STATUS_COLORS[d.status] || STATUS_COLORS.off_hire
                return (
                  <tr
                    key={d.id}
                    onClick={() => can('fleet.edit') ? openEdit(d) : null}
                    style={{ cursor: can('fleet.edit') ? 'pointer' : 'default', borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>{d.contractor_name}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{d.asset_description}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {d.asset_type && (
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: color + '14', color }}>{d.asset_type}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.registration || '-'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '6px', background: sc.bg, color: sc.text }}>{sc.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{d.hire_start_date || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{d.hire_end_date || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.daily_rate != null ? `R ${parseFloat(d.daily_rate).toFixed(2)}` : '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.project || '-'}</td>
                    <td style={{ padding: '10px 12px' }}><ExpiryCell dateStr={d.insurance_expiry} /></td>
                    <td style={{ padding: '10px 12px' }}><ExpiryCell dateStr={d.fitness_cert_expiry} /></td>
                    <td style={{ padding: '10px 12px' }}>
                      {d.status !== 'returned' && can('fleet.edit') && (
                        <button
                          onClick={e => { e.stopPropagation(); handleReturn(d.id) }}
                          style={{
                            padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                            background: '#e3f2fd', color: '#1565c0', border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                          }}
                        >
                          Return
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '640px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Equipment' : 'Add Equipment'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Contractor Name *</label>
                  <input style={inp} value={form.contractor_name} onChange={e => set('contractor_name', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Asset Description *</label>
                  <input style={inp} value={form.asset_description} onChange={e => set('asset_description', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Asset Type</label>
                  <select style={inp} value={form.asset_type} onChange={e => set('asset_type', e.target.value)}>
                    <option value="">-- Select --</option>
                    {ASSET_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Registration</label>
                  <input style={inp} value={form.registration} onChange={e => set('registration', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Serial Number</label>
                  <input style={inp} value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Make</label>
                  <input style={inp} value={form.make} onChange={e => set('make', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Model</label>
                  <input style={inp} value={form.model} onChange={e => set('model', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Year</label>
                  <input style={inp} type="number" value={form.year} onChange={e => set('year', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Project</label>
                  <input style={inp} value={form.project} onChange={e => set('project', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Daily Rate</label>
                  <input style={inp} type="number" step="0.01" value={form.daily_rate} onChange={e => set('daily_rate', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Monthly Rate</label>
                  <input style={inp} type="number" step="0.01" value={form.monthly_rate} onChange={e => set('monthly_rate', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Hire Start Date *</label>
                  <input style={inp} type="date" value={form.hire_start_date} onChange={e => set('hire_start_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Hire End Date</label>
                  <input style={inp} type="date" value={form.hire_end_date} onChange={e => set('hire_end_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Department</label>
                  <input style={inp} value={form.department_name} onChange={e => set('department_name', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Operator Name</label>
                  <input style={inp} value={form.operator_name} onChange={e => set('operator_name', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Operator Contact</label>
                  <input style={inp} value={form.operator_contact} onChange={e => set('operator_contact', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Insurance Expiry</label>
                  <input style={expiryInputStyle(form.insurance_expiry)} type="date" value={form.insurance_expiry} onChange={e => set('insurance_expiry', e.target.value)} />
                  {(() => {
                    const st = expiryStatus(form.insurance_expiry)
                    const ec = EXPIRY_COLORS[st]
                    if (st === 'expired' || st === 'warning') return (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: ec.text, fontWeight: 600 }}>
                        {st === 'expired' ? 'EXPIRED' : 'Expires within 30 days'}
                      </div>
                    )
                    return null
                  })()}
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Fitness Cert Expiry</label>
                  <input style={expiryInputStyle(form.fitness_cert_expiry)} type="date" value={form.fitness_cert_expiry} onChange={e => set('fitness_cert_expiry', e.target.value)} />
                  {(() => {
                    const st = expiryStatus(form.fitness_cert_expiry)
                    const ec = EXPIRY_COLORS[st]
                    if (st === 'expired' || st === 'warning') return (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: ec.text, fontWeight: 600 }}>
                        {st === 'expired' ? 'EXPIRED' : 'Expires within 30 days'}
                      </div>
                    )
                    return null
                  })()}
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{
              padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                {editId && can('fleet.delete') && (
                  <button onClick={handleArchive} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Archive
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setModalOpen(false)} style={{
                  padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff',
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
                }}>
                  {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
