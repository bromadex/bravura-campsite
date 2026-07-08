import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'

const color = MODULE_COLORS.fleet

const STATUS_MAP = {
  operational:    { label: 'Operational',    bg: THEME.statusSuccessBg,   text: THEME.statusSuccessText },
  maintenance:    { label: 'Maintenance',    bg: THEME.statusWarningBg,   text: THEME.statusWarningText },
  grounded:       { label: 'Grounded',       bg: THEME.statusErrorBg,     text: THEME.statusErrorText },
  awaiting_parts: { label: 'Awaiting Parts', bg: THEME.statusTertiaryBg,  text: THEME.statusTertiaryText },
  decommissioned: { label: 'Decommissioned', bg: THEME.statusNeutralBg,   text: THEME.statusNeutralText },
}

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
  critical: { border: THEME.statusErrorText,   bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
  warning:  { border: THEME.statusWarningText, bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  ok:       { border: THEME.statusSuccessText, bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  none:     { border: THEME.outlineVar,        bg: THEME.surface,         text: THEME.textLow },
}

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.operational
  return (
    <span style={{
      display: 'inline-block', fontSize: '11px', fontWeight: 600,
      padding: '2px 10px', borderRadius: '999px',
      background: s.bg, color: s.text,
    }}>
      {s.label}
    </span>
  )
}

function ExpiryChip({ label, dateStr }) {
  const st = expiryStatus(dateStr)
  if (st === 'ok' || st === 'none') return null
  const ec = EXPIRY_COLORS[st]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '6px',
      background: ec.bg, color: ec.text,
    }}>
      <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>
        {st === 'expired' ? 'error' : 'warning'}
      </span>
      {label}
    </span>
  )
}

const TABS = ['Identity', 'Technical', 'Compliance', 'Operations', 'Finance']

const EMPTY_FORM = {
  asset_number: '', description: '', registration: '', fleet_number: '',
  vin: '', serial_number: '', make: '', model: '', year: '', image_url: '',
  fuel_type: '', tank_capacity_litres: '', expected_consumption_lpkm: '',
  tare_weight: '', gross_vehicle_mass: '', tracker_id: '',
  licence_expiry: '', insurance_expiry: '', roadworthy_expiry: '',
  status: 'operational', department_id: '', assigned_project: '',
  cost_center: '', current_odometer_km: '',
  purchase_date: '', purchase_cost: '', salvage_value: '', useful_life_months: '',
}

export default function FleetVehicles({ setPage }) {
  const { can } = usePermissions()
  const { vehicles, assetTypes, departments, loading, addAsset, updateAsset, archiveAsset } = useFleet()

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [tab, setTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const vehicleTypeId = useMemo(() => {
    const vt = assetTypes.find(t => t.category === 'vehicle')
    return vt ? vt.id : null
  }, [assetTypes])

  const filtered = useMemo(() => {
    let list = vehicles || []
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus)
    if (filterDept !== 'all') list = list.filter(a => a.department_id === filterDept)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        (a.asset_number || '').toLowerCase().includes(q) ||
        (a.registration || '').toLowerCase().includes(q) ||
        (a.make || '').toLowerCase().includes(q) ||
        (a.model || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [vehicles, filterStatus, filterDept, search])

  const kpis = useMemo(() => {
    const all = vehicles || []
    return {
      total: all.length,
      operational: all.filter(v => v.status === 'operational').length,
      maintenance: all.filter(v => v.status === 'maintenance').length,
      grounded: all.filter(v => v.status === 'grounded').length,
    }
  }, [vehicles])

  const expiryWarnings = useMemo(() => {
    const warns = []
    ;(vehicles || []).forEach(v => {
      const fields = [
        { key: 'licence_expiry', label: 'Licence' },
        { key: 'insurance_expiry', label: 'Insurance' },
        { key: 'roadworthy_expiry', label: 'Roadworthy' },
      ]
      fields.forEach(f => {
        const st = expiryStatus(v[f.key])
        if (st === 'expired' || st === 'critical') {
          warns.push({ vehicle: v.asset_number || v.registration, field: f.label, status: st, date: v[f.key] })
        }
      })
    })
    return warns
  }, [vehicles])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setTab(0)
    setError('')
    setModalOpen(true)
  }

  function openEdit(asset) {
    setEditId(asset.id)
    setForm({
      asset_number: asset.asset_number || '',
      description: asset.description || '',
      registration: asset.registration || '',
      fleet_number: asset.fleet_number || '',
      vin: asset.vin || '',
      serial_number: asset.serial_number || '',
      make: asset.make || '',
      model: asset.model || '',
      year: asset.year || '',
      image_url: asset.image_url || '',
      fuel_type: asset.fuel_type || '',
      tank_capacity_litres: asset.tank_capacity_litres || '',
      expected_consumption_lpkm: asset.expected_consumption_lpkm || '',
      tare_weight: asset.tare_weight || '',
      gross_vehicle_mass: asset.gross_vehicle_mass || '',
      tracker_id: asset.tracker_id || '',
      licence_expiry: asset.licence_expiry || '',
      insurance_expiry: asset.insurance_expiry || '',
      roadworthy_expiry: asset.roadworthy_expiry || '',
      status: asset.status || 'operational',
      department_id: asset.department_id || '',
      assigned_project: asset.assigned_project || '',
      cost_center: asset.cost_center || '',
      current_odometer_km: asset.current_odometer_km || '',
      purchase_date: asset.purchase_date || '',
      purchase_cost: asset.purchase_cost || '',
      salvage_value: asset.salvage_value || '',
      useful_life_months: asset.useful_life_months || '',
    })
    setTab(0)
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_number || !form.description) {
      setError('Asset number and description are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        asset_type_id: vehicleTypeId,
        year: form.year ? Number(form.year) : null,
        tank_capacity_litres: form.tank_capacity_litres ? Number(form.tank_capacity_litres) : null,
        expected_consumption_lpkm: form.expected_consumption_lpkm ? Number(form.expected_consumption_lpkm) : null,
        tare_weight: form.tare_weight ? Number(form.tare_weight) : null,
        gross_vehicle_mass: form.gross_vehicle_mass ? Number(form.gross_vehicle_mass) : null,
        current_odometer_km: form.current_odometer_km ? Number(form.current_odometer_km) : null,
        purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
        salvage_value: form.salvage_value ? Number(form.salvage_value) : null,
        useful_life_months: form.useful_life_months ? Number(form.useful_life_months) : null,
        department_id: form.department_id || null,
      }
      if (editId) {
        await updateAsset(editId, payload)
      } else {
        await addAsset(payload)
      }
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this vehicle? It will be marked as decommissioned.')) return
    try {
      await archiveAsset(editId)
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

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Vehicles', value: kpis.total, icon: 'directions_car', bg: color + '14', fg: color },
    { label: 'Operational', value: kpis.operational, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'In Maintenance', value: kpis.maintenance, icon: 'build', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Grounded', value: kpis.grounded, icon: 'block', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
  ]

  function formatOdo(val) {
    if (!val) return null
    return Number(val).toLocaleString() + ' km'
  }

  function renderTabContent() {
    if (tab === 0) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div style={fieldWrap}>
            <label style={lbl}>Asset Number *</label>
            <input style={inp} value={form.asset_number} onChange={e => set('asset_number', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Registration</label>
            <input style={inp} value={form.registration} onChange={e => set('registration', e.target.value)} />
          </div>
          <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
            <label style={lbl}>Description *</label>
            <input style={inp} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Fleet Number</label>
            <input style={inp} value={form.fleet_number} onChange={e => set('fleet_number', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>VIN</label>
            <input style={inp} value={form.vin} onChange={e => set('vin', e.target.value)} />
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
          <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
            <label style={lbl}>Image URL</label>
            <input style={inp} value={form.image_url} onChange={e => set('image_url', e.target.value)} />
          </div>
        </div>
      )
    }
    if (tab === 1) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div style={fieldWrap}>
            <label style={lbl}>Fuel Type</label>
            <input style={inp} value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)} placeholder="Diesel, Petrol, etc." />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Tank Capacity (L)</label>
            <input style={inp} type="number" value={form.tank_capacity_litres} onChange={e => set('tank_capacity_litres', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Expected Consumption (L/km)</label>
            <input style={inp} type="number" step="0.01" value={form.expected_consumption_lpkm} onChange={e => set('expected_consumption_lpkm', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Tare Weight (kg)</label>
            <input style={inp} type="number" value={form.tare_weight} onChange={e => set('tare_weight', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Gross Vehicle Mass (kg)</label>
            <input style={inp} type="number" value={form.gross_vehicle_mass} onChange={e => set('gross_vehicle_mass', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Tracker ID</label>
            <input style={inp} value={form.tracker_id} onChange={e => set('tracker_id', e.target.value)} />
          </div>
        </div>
      )
    }
    if (tab === 2) {
      const fields = [
        { key: 'licence_expiry', label: 'Licence Expiry' },
        { key: 'insurance_expiry', label: 'Insurance Expiry' },
        { key: 'roadworthy_expiry', label: 'Roadworthy Expiry' },
      ]
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          {fields.map(f => {
            const st = expiryStatus(form[f.key])
            const ec = EXPIRY_COLORS[st]
            return (
              <div key={f.key} style={fieldWrap}>
                <label style={lbl}>{f.label}</label>
                <input
                  style={expiryInputStyle(form[f.key])}
                  type="date"
                  value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                />
                {st !== 'none' && st !== 'ok' && (
                  <div style={{ fontSize: '11px', marginTop: '4px', color: ec.text, fontWeight: 600 }}>
                    {st === 'expired' ? 'EXPIRED' : st === 'critical' ? 'Expires within 7 days' : 'Expires within 30 days'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )
    }
    if (tab === 3) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div style={fieldWrap}>
            <label style={lbl}>Status</label>
            <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
              {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Department</label>
            <select style={inp} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
              <option value="">-- Select --</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Assigned Project</label>
            <input style={inp} value={form.assigned_project} onChange={e => set('assigned_project', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Cost Center</label>
            <input style={inp} value={form.cost_center} onChange={e => set('cost_center', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Current Odometer (km)</label>
            <input style={inp} type="number" value={form.current_odometer_km} onChange={e => set('current_odometer_km', e.target.value)} />
          </div>
        </div>
      )
    }
    if (tab === 4) {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          <div style={fieldWrap}>
            <label style={lbl}>Purchase Date</label>
            <input style={inp} type="date" value={form.purchase_date} onChange={e => set('purchase_date', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Purchase Cost</label>
            <input style={inp} type="number" step="0.01" value={form.purchase_cost} onChange={e => set('purchase_cost', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Salvage Value</label>
            <input style={inp} type="number" step="0.01" value={form.salvage_value} onChange={e => set('salvage_value', e.target.value)} />
          </div>
          <div style={fieldWrap}>
            <label style={lbl}>Useful Life (months)</label>
            <input style={inp} type="number" value={form.useful_life_months} onChange={e => set('useful_life_months', e.target.value)} />
          </div>
        </div>
      )
    }
    return null
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_vehicles" />

      {expiryWarnings.length > 0 && (
        <div style={{
          background: THEME.statusErrorBg, border: `1px solid ${THEME.statusErrorText}`,
          borderRadius: '10px', padding: '12px 16px', marginBottom: '16px',
          display: 'flex', alignItems: 'flex-start', gap: '10px',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.statusErrorText, flexShrink: 0, marginTop: '1px' }}>warning</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.statusErrorText, marginBottom: '4px' }}>
              Compliance Alerts
            </div>
            <div style={{ fontSize: '12px', color: THEME.statusErrorText }}>
              {expiryWarnings.length} expired or critical compliance item{expiryWarnings.length !== 1 ? 's' : ''} across your fleet.
              {expiryWarnings.slice(0, 3).map((w, i) => (
                <span key={i} style={{ display: 'block', marginTop: '2px' }}>
                  {w.vehicle}: {w.field} {w.status === 'expired' ? 'expired' : 'expiring'} ({w.date})
                </span>
              ))}
              {expiryWarnings.length > 3 && (
                <span style={{ display: 'block', marginTop: '2px', fontStyle: 'italic' }}>
                  and {expiryWarnings.length - 3} more...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

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
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Vehicles</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} vehicle{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Add Vehicle
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search vehicles..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ ...inp, maxWidth: '180px' }}>
          <option value="all">All Departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>directions_car</span>
          <div style={{ fontSize: '14px' }}>No vehicles found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new vehicle</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
          {filtered.map(v => {
            const expiries = [
              { key: 'licence_expiry', label: 'Licence' },
              { key: 'insurance_expiry', label: 'Insurance' },
              { key: 'roadworthy_expiry', label: 'Roadworthy' },
            ]
            return (
              <div
                key={v.id}
                onClick={() => can('fleet.edit') ? openEdit(v) : null}
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
                    width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                    background: color + '18',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>directions_car</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {v.asset_number}
                      {v.registration ? <span style={{ fontWeight: 400, color: THEME.textMed }}> {v.registration}</span> : null}
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                      {[v.make, v.model, v.year].filter(Boolean).join(' ')}
                    </div>
                  </div>
                  <StatusBadge status={v.status} />
                </div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '12px', color: THEME.textMed, flexWrap: 'wrap' }}>
                  {v.departments?.name && <span>{v.departments.name}</span>}
                  {v.current_odometer_km != null && <span>{formatOdo(v.current_odometer_km)}</span>}
                </div>
                {expiries.some(f => {
                  const st = expiryStatus(v[f.key])
                  return st === 'expired' || st === 'critical' || st === 'warning'
                }) && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                    {expiries.map(f => (
                      <ExpiryChip key={f.key} label={f.label} dateStr={v[f.key]} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '620px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Vehicle' : 'Add Vehicle'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ display: 'flex', gap: '4px', padding: '16px 24px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
              {TABS.map((t, i) => (
                <button
                  key={t}
                  onClick={() => setTab(i)}
                  style={{
                    padding: '8px 14px', fontSize: '12px', fontWeight: 600,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: tab === i ? color : THEME.textMed,
                    borderBottom: tab === i ? `2px solid ${color}` : '2px solid transparent',
                    marginBottom: '-1px', fontFamily: 'inherit',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {renderTabContent()}
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
