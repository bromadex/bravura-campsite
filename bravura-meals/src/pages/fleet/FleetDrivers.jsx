import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { ModalOverlay } from '../../components/ui'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.fleet

const LICENCE_CLASSES = ['B', 'A', 'A1', 'C1', 'C', 'EC']

function expiryStatus(dateStr) {
  if (!dateStr) return 'none'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = (d - now) / 86400000
  if (diff < 0) return 'expired'
  if (diff <= 7) return 'critical'
  if (diff <= 30) return 'warning'
  return 'ok'
}

const EXPIRY_COLORS = {
  expired:  { border: THEME.statusErrorText,   bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
  critical: { border: '#e65100',               bg: '#fff3e0',             text: '#e65100' },
  warning:  { border: THEME.statusWarningText, bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  ok:       { border: THEME.statusSuccessText, bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  none:     { border: THEME.outlineVar,        bg: THEME.surface,         text: THEME.textLow },
}

function ExpiryDate({ label, dateStr }) {
  const st = expiryStatus(dateStr)
  const ec = EXPIRY_COLORS[st]
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', padding: '3px 0' }}>
      <span style={{ color: THEME.textMed }}>{label}</span>
      <span style={{ fontWeight: 600, color: ec.text }}>
        {dateStr || 'Not set'}
        {st === 'expired' && <span style={{ marginLeft: '4px', fontSize: '10px' }}>EXPIRED</span>}
      </span>
    </div>
  )
}

const EMPTY_FORM = {
  employee_id: '', licence_number: '', licence_class: 'C',
  licence_expiry: '', pdp_number: '', pdp_expiry: '',
  medical_cert_expiry: '', endorsements: '', restrictions: '',
  is_active: true, notes: '',
}

export default function FleetDrivers({ setPage }) {
  const { can } = usePermissions()
  const { employees, loading: fleetLoading } = useFleet()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('fleet_drivers', { column: 'site_id', value: currentSiteId }, fetchDrivers)

  const [drivers, setDrivers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterClass, setFilterClass] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchDrivers() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('fleet_drivers')
      .select('*, employees(id, name)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (!err) setDrivers(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchDrivers() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = drivers
    if (filterClass !== 'all') list = list.filter(d => d.licence_class === filterClass)
    if (filterStatus === 'active') list = list.filter(d => d.is_active)
    else if (filterStatus === 'inactive') list = list.filter(d => !d.is_active)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        (d.employees?.name || '').toLowerCase().includes(q) ||
        (d.licence_number || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [drivers, filterClass, filterStatus, search])

  const kpis = useMemo(() => {
    const now = new Date()
    const soon = new Date()
    soon.setDate(soon.getDate() + 30)
    return {
      total: drivers.length,
      active: drivers.filter(d => d.is_active).length,
      expired: drivers.filter(d => d.licence_expiry && new Date(d.licence_expiry) < now).length,
      expiring: drivers.filter(d => {
        if (!d.licence_expiry) return false
        const exp = new Date(d.licence_expiry)
        return exp >= now && exp <= soon
      }).length,
    }
  }, [drivers])

  const existingEmployeeIds = useMemo(() => new Set(drivers.map(d => d.employee_id)), [drivers])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(driver) {
    setEditId(driver.id)
    setForm({
      employee_id: driver.employee_id || '',
      licence_number: driver.licence_number || '',
      licence_class: driver.licence_class || 'C',
      licence_expiry: driver.licence_expiry || '',
      pdp_number: driver.pdp_number || '',
      pdp_expiry: driver.pdp_expiry || '',
      medical_cert_expiry: driver.medical_cert_expiry || '',
      endorsements: driver.endorsements || '',
      restrictions: driver.restrictions || '',
      is_active: driver.is_active !== false,
      notes: driver.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.employee_id || !form.licence_number) {
      setError('Employee and licence number are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        employee_id: form.employee_id,
        licence_number: form.licence_number,
        licence_class: form.licence_class,
        licence_expiry: form.licence_expiry || null,
        pdp_number: form.pdp_number || null,
        pdp_expiry: form.pdp_expiry || null,
        medical_cert_expiry: form.medical_cert_expiry || null,
        endorsements: form.endorsements || null,
        restrictions: form.restrictions || null,
        is_active: form.is_active,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_drivers').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_drivers').insert(payload)
        if (err) throw err
      }
      await fetchDrivers()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Remove this driver record?')) return
    try {
      const { error: err } = await supabase.from('fleet_drivers')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('id', editId)
      if (err) throw err
      await fetchDrivers()
      setModalOpen(false)
    } catch (err) {
      alert(err.message)
    }
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

  if (loading || fleetLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Drivers', value: kpis.total, icon: 'badge', bg: color + '14', fg: color },
    { label: 'Active', value: kpis.active, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Expired Licences', value: kpis.expired, icon: 'error', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
    { label: 'Expiring Soon', value: kpis.expiring, icon: 'schedule', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
  ]

  const availableEmployees = editId
    ? employees.filter(e => e.id === form.employee_id || !existingEmployeeIds.has(e.id))
    : employees.filter(e => !existingEmployeeIds.has(e.id))

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_drivers" />

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
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Drivers</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} driver{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Add Driver
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search name or licence..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Classes</option>
          {LICENCE_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>badge</span>
          <div style={{ fontSize: '14px' }}>No drivers found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new driver</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
          {filtered.map(d => {
            const endorsementTags = d.endorsements ? d.endorsements.split(',').map(e => e.trim()).filter(Boolean) : []
            return (
              <div
                key={d.id}
                onClick={() => can('fleet.edit') ? openEdit(d) : null}
                style={{
                  background: THEME.surface, borderRadius: '14px', padding: '18px',
                  border: `1px solid ${THEME.outlineVar}`,
                  cursor: can('fleet.edit') ? 'pointer' : 'default',
                  transition: 'box-shadow .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{
                    width: '42px', height: '42px', borderRadius: '50%', flexShrink: 0,
                    background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '16px', fontWeight: 700, color,
                  }}>
                    {d.licence_class || '?'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {d.employees?.name || 'Unknown'}
                      </div>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                        background: d.is_active ? THEME.statusSuccessText : THEME.textLow,
                      }} title={d.is_active ? 'Active' : 'Inactive'} />
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                      {d.licence_number || 'No licence number'}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '12px', borderTop: `1px solid ${THEME.outlineVar}`, paddingTop: '10px' }}>
                  <ExpiryDate label="Licence" dateStr={d.licence_expiry} />
                  <ExpiryDate label="PDP" dateStr={d.pdp_expiry} />
                  <ExpiryDate label="Medical" dateStr={d.medical_cert_expiry} />
                </div>

                {endorsementTags.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', marginTop: '10px', flexWrap: 'wrap' }}>
                    {endorsementTags.map((tag, i) => (
                      <span key={i} style={{
                        fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px',
                        background: color + '14', color,
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '560px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Driver' : 'Add Driver'}
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
                  <label style={lbl}>Employee *</label>
                  <select style={inp} value={form.employee_id} onChange={e => set('employee_id', e.target.value)} disabled={!!editId}>
                    <option value="">-- Select Employee --</option>
                    {availableEmployees.map(emp => (
                      <option key={emp.id} value={emp.id}>{emp.name}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Licence Number *</label>
                  <input style={inp} value={form.licence_number} onChange={e => set('licence_number', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Licence Class</label>
                  <select style={inp} value={form.licence_class} onChange={e => set('licence_class', e.target.value)}>
                    {LICENCE_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Licence Expiry</label>
                  <input style={expiryInputStyle(form.licence_expiry)} type="date" value={form.licence_expiry} onChange={e => set('licence_expiry', e.target.value)} />
                  {(() => {
                    const st = expiryStatus(form.licence_expiry)
                    const ec = EXPIRY_COLORS[st]
                    if (st !== 'none' && st !== 'ok') return (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: ec.text, fontWeight: 600 }}>
                        {st === 'expired' ? 'EXPIRED' : st === 'critical' ? 'Expires within 7 days' : 'Expires within 30 days'}
                      </div>
                    )
                    return null
                  })()}
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>PDP Number</label>
                  <input style={inp} value={form.pdp_number} onChange={e => set('pdp_number', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>PDP Expiry</label>
                  <input style={expiryInputStyle(form.pdp_expiry)} type="date" value={form.pdp_expiry} onChange={e => set('pdp_expiry', e.target.value)} />
                  {(() => {
                    const st = expiryStatus(form.pdp_expiry)
                    const ec = EXPIRY_COLORS[st]
                    if (st !== 'none' && st !== 'ok') return (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: ec.text, fontWeight: 600 }}>
                        {st === 'expired' ? 'EXPIRED' : st === 'critical' ? 'Expires within 7 days' : 'Expires within 30 days'}
                      </div>
                    )
                    return null
                  })()}
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Medical Cert Expiry</label>
                  <input style={expiryInputStyle(form.medical_cert_expiry)} type="date" value={form.medical_cert_expiry} onChange={e => set('medical_cert_expiry', e.target.value)} />
                  {(() => {
                    const st = expiryStatus(form.medical_cert_expiry)
                    const ec = EXPIRY_COLORS[st]
                    if (st !== 'none' && st !== 'ok') return (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: ec.text, fontWeight: 600 }}>
                        {st === 'expired' ? 'EXPIRED' : st === 'critical' ? 'Expires within 7 days' : 'Expires within 30 days'}
                      </div>
                    )
                    return null
                  })()}
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Endorsements</label>
                  <input style={inp} value={form.endorsements} onChange={e => set('endorsements', e.target.value)} placeholder="Comma separated" />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Restrictions</label>
                  <input style={inp} value={form.restrictions} onChange={e => set('restrictions', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Active</label>
                  <div
                    onClick={() => set('is_active', !form.is_active)}
                    style={{
                      width: '44px', height: '24px', borderRadius: '12px', cursor: 'pointer',
                      background: form.is_active ? color : THEME.outlineVar,
                      position: 'relative', transition: 'background .2s',
                    }}
                  >
                    <div style={{
                      width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
                      position: 'absolute', top: '3px',
                      left: form.is_active ? '23px' : '3px',
                      transition: 'left .2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                    }} />
                  </div>
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
                  <button onClick={handleDelete} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Delete
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
        </ModalOverlay>
      )}
    </div>
  )
}
