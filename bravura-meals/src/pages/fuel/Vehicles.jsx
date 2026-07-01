import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const BLANK_FORM = {
  fleet_number:               '',
  registration:               '',
  make:                       '',
  model:                      '',
  year:                       '',
  department_id:              '',
  fuel_type_id:               '',
  tank_capacity_litres:       '',
  expected_consumption_lpkm:  '',
  status:                     'active',
}

const STATUS_OPTIONS = [
  { value: 'active',         label: 'Active' },
  { value: 'maintenance',    label: 'Maintenance' },
  { value: 'decommissioned', label: 'Decommissioned' },
]

export default function Vehicles() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const {
    fuelTypes, vehicles, departments, transactions,
    addVehicle, updateVehicle, archiveVehicle, loading,
  } = useFuel()

  const canView = can('fuel.view')
  const canEdit = can('fuel.edit')

  const [modal,      setModal]      = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [form,       setForm]       = useState(BLANK_FORM)
  const [saving,     setSaving]     = useState(false)
  const [archiving,  setArchiving]  = useState(null)
  const [detail,     setDetail]     = useState(null)
  const [filterFuel, setFilterFuel] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [filterStat, setFilterStat] = useState('active')
  const [query,      setQuery]      = useState('')

  if (!canView) return null

  function openAdd() {
    setEditItem(null)
    setForm({ ...BLANK_FORM, fuel_type_id: fuelTypes[0]?.id || '' })
    setModal(true)
  }
  function openEdit(v) {
    setEditItem(v)
    setForm({
      fleet_number:              v.fleet_number || '',
      registration:              v.registration || '',
      make:                      v.make || '',
      model:                     v.model || '',
      year:                      v.year != null ? String(v.year) : '',
      department_id:             v.department_id || '',
      fuel_type_id:              v.fuel_type_id || '',
      tank_capacity_litres:      v.tank_capacity_litres != null ? String(v.tank_capacity_litres) : '',
      expected_consumption_lpkm: v.expected_consumption_lpkm != null ? String(v.expected_consumption_lpkm) : '',
      status:                    v.status,
    })
    setModal(true)
  }
  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.fleet_number.trim()) { showToast('Fleet number is required', 'red'); return }
    if (!form.fuel_type_id)        { showToast('Select a fuel type', 'red'); return }
    setSaving(true)
    try {
      const data = {
        fleet_number:              form.fleet_number.trim(),
        registration:              form.registration.trim() || null,
        make:                      form.make.trim() || null,
        model:                     form.model.trim() || null,
        year:                      form.year ? Number(form.year) : null,
        department_id:             form.department_id || null,
        fuel_type_id:              form.fuel_type_id,
        tank_capacity_litres:      form.tank_capacity_litres ? Number(form.tank_capacity_litres) : null,
        expected_consumption_lpkm: form.expected_consumption_lpkm ? Number(form.expected_consumption_lpkm) : null,
        status:                    form.status,
      }
      if (editItem) { await updateVehicle(editItem.id, data); showToast('Vehicle updated', 'green') }
      else           { await addVehicle(data); showToast('Vehicle added', 'green') }
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmArchive() {
    try {
      await archiveVehicle(archiving.id)
      showToast('Vehicle archived', 'green')
    } catch (err) {
      showToast(err.message || 'Failed', 'red')
    } finally {
      setArchiving(null)
    }
  }

  const deptName = id => departments.find(d => d.id === id)?.name || '—'

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vehicles.filter(v => {
      if (filterFuel !== 'all' && v.fuel_type_id !== filterFuel) return false
      if (filterDept !== 'all' && v.department_id !== filterDept) return false
      if (filterStat !== 'all' && v.status !== filterStat) return false
      if (q && !`${v.fleet_number} ${v.registration || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [vehicles, filterFuel, filterDept, filterStat, query])

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <PageHeader
        title="Vehicles"
        site={currentSite}
        actions={canEdit && <Button onClick={openAdd} icon="add">Add Vehicle</Button>}
      />

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
          border: `1px solid ${THEME.outline}`, borderRadius: '10px',
          padding: '0 10px', background: THEME.surface, flex: '0 0 240px' }}>
          <Icon name="search" size={16} style={{ color: THEME.textLow }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Fleet # or registration"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', padding: '8px 4px', fontSize: '13px', color: THEME.text, fontFamily: 'inherit' }}
          />
        </div>
        <FilterSelect label="Fuel" value={filterFuel} onChange={setFilterFuel}>
          <option value="all">All</option>
          {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
        </FilterSelect>
        <FilterSelect label="Department" value={filterDept} onChange={setFilterDept}>
          <option value="all">All</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </FilterSelect>
        <FilterSelect label="Status" value={filterStat} onChange={setFilterStat}>
          <option value="all">All</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </FilterSelect>
        {(filterFuel !== 'all' || filterDept !== 'all' || filterStat !== 'active' || query) && (
          <button
            onClick={() => { setFilterFuel('all'); setFilterDept('all'); setFilterStat('active'); setQuery('') }}
            style={{ background: 'none', border: 'none', color: FUEL_CLR, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Reset
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
          {displayed.length} of {vehicles.length}
        </span>
      </div>

      <Card style={{ padding: 0 }}>
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="directions_car" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: '0 0 16px' }}>
              {vehicles.length === 0 ? 'No vehicles in the registry yet.' : 'No vehicles match the current filters.'}
            </p>
            {canEdit && vehicles.length === 0 && <Button onClick={openAdd} icon="add">Add First Vehicle</Button>}
          </div>
        ) : (
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Fleet #</Th>
              <Th>Registration</Th>
              <Th>Make / Model</Th>
              <Th>Department</Th>
              <Th>Fuel</Th>
              <Th>Status</Th>
              {canEdit && <Th />}
            </THead>
            <tbody>
              {displayed.map((v, idx) => {
                const ftName  = v.fuel_types?.name   || '—'
                const ftColor = v.fuel_types?.colour || FUEL_CLR
                return (
                  <TRow key={v.id} last={idx === displayed.length - 1} onClick={() => setDetail(v)}>
                    <Td>
                      <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: THEME.textMed }}>
                        {v.fleet_number}
                      </span>
                    </Td>
                    <Td><span style={{ fontWeight: 500 }}>{v.registration || '—'}</span></Td>
                    <Td style={{ color: THEME.textMed }}>
                      {[v.make, v.model].filter(Boolean).join(' ') || '—'}
                      {v.year && <span style={{ color: THEME.textLow, marginLeft: '6px' }}>({v.year})</span>}
                    </Td>
                    <Td style={{ color: THEME.textMed }}>{deptName(v.department_id)}</Td>
                    <Td>
                      <span style={{
                        padding: '2px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
                        background: ftColor + '22', color: ftColor, border: `1px solid ${ftColor}44`,
                      }}>
                        {ftName}
                      </span>
                    </Td>
                    <Td><StatusPill status={v.status} /></Td>
                    {canEdit && (
                      <Td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={e => { e.stopPropagation(); openEdit(v) }}
                            style={iconBtn} title="Edit">
                            <Icon name="edit" size={15} style={{ color: THEME.textMed }} />
                          </button>
                          {v.status !== 'decommissioned' && (
                            <button onClick={e => { e.stopPropagation(); setArchiving(v) }}
                              style={iconBtn} title="Archive">
                              <Icon name="archive" size={15} style={{ color: THEME.error }} />
                            </button>
                          )}
                        </div>
                      </Td>
                    )}
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────── */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Vehicle' : 'Add Vehicle'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update Vehicle' : 'Add Vehicle'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Fleet Number *</SectionLabel>
            <input value={form.fleet_number} onChange={e => set('fleet_number', e.target.value)} placeholder="e.g. FL-001" style={inputStyle} autoFocus />
          </div>
          <div>
            <SectionLabel>Registration</SectionLabel>
            <input value={form.registration} onChange={e => set('registration', e.target.value)} placeholder="number plate" style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: '0 14px' }}>
          <div>
            <SectionLabel>Make</SectionLabel>
            <input value={form.make} onChange={e => set('make', e.target.value)} placeholder="e.g. Toyota" style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Model</SectionLabel>
            <input value={form.model} onChange={e => set('model', e.target.value)} placeholder="e.g. Hilux" style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Year</SectionLabel>
            <input type="number" min="1950" max="2099" value={form.year} onChange={e => set('year', e.target.value)} placeholder="2024" style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Department</SectionLabel>
            <select value={form.department_id} onChange={e => set('department_id', e.target.value)} style={inputStyle}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Fuel Type *</SectionLabel>
            <select value={form.fuel_type_id} onChange={e => set('fuel_type_id', e.target.value)} style={inputStyle}>
              <option value="">— Select —</option>
              {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Tank Capacity (Litres)</SectionLabel>
            <input type="number" min="0" step="0.1" value={form.tank_capacity_litres} onChange={e => set('tank_capacity_litres', e.target.value)} placeholder="e.g. 80" style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Expected Consumption (L/km)</SectionLabel>
            <input type="number" min="0" step="0.001" value={form.expected_consumption_lpkm} onChange={e => set('expected_consumption_lpkm', e.target.value)} placeholder="e.g. 0.12" style={inputStyle} />
          </div>
        </div>
        {editItem && (
          <div>
            <SectionLabel>Status</SectionLabel>
            <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={confirmArchive}
        title="Archive Vehicle"
        message={archiving
          ? `Archive "${archiving.fleet_number}"? It will be hidden from issuance dropdowns. Transaction history is preserved.`
          : ''}
      />

      <VehicleDetailModal
        vehicle={detail}
        transactions={transactions}
        onClose={() => setDetail(null)}
      />
    </div>
  )
}

// ── Detail modal: recent transactions (last 30 days) ───────────────────────────

function VehicleDetailModal({ vehicle, transactions, onClose }) {
  const recent = useMemo(() => {
    if (!vehicle) return []
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return transactions.filter(t => t.vehicle_id === vehicle.id && t.transaction_date >= cutoffStr)
  }, [vehicle, transactions])

  const total = recent.reduce((s, t) => s + Number(t.litres), 0)

  if (!vehicle) return null
  return (
    <Modal
      open={!!vehicle}
      onClose={onClose}
      title={`${vehicle.fleet_number}${vehicle.registration ? ` · ${vehicle.registration}` : ''}`}
      footer={<Button onClick={onClose} variant="text">Close</Button>}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '10px', marginBottom: '16px',
      }}>
        <Stat label="Make / Model" value={[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'} />
        <Stat label="Fuel Type"    value={vehicle.fuel_types?.name || '—'} />
        <Stat label="Last 30 days" value={`${recent.length} txns`} />
        <Stat label="Litres Used"  value={`${total.toFixed(1)} L`} />
      </div>

      {recent.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px', background: THEME.surfaceVar, borderRadius: '12px' }}>
          No fuel transactions for this vehicle in the last 30 days.
        </div>
      ) : (
        <div style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', overflow: 'hidden' }}>
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Date</Th>
              <Th align="right">Litres</Th>
              <Th>Type</Th>
              <Th>Docket</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {recent.map((t, idx) => (
                <TRow key={t.id} last={idx === recent.length - 1}>
                  <Td>{fmtDate(t.transaction_date)}</Td>
                  <Td align="right" style={{ fontWeight: 600, color: t.transaction_type === 'issuance' ? THEME.error : THEME.success }}>
                    {t.transaction_type === 'issuance' ? '−' : '+'}{Number(t.litres).toFixed(1)}
                  </Td>
                  <Td style={{ textTransform: 'capitalize', color: THEME.textMed }}>{t.transaction_type}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: '12px', color: THEME.textMed }}>{t.docket_number || '—'}</Td>
                  <Td style={{ color: THEME.textMed }}>{t.notes || '—'}</Td>
                </TRow>
              ))}
            </tbody>
          </TableWrap>
        </div>
      )}
    </Modal>
  )
}

function Stat({ label, value }) {
  return (
    <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '10px 12px' }}>
      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>
        {value}
      </div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed }}>
      <span>{label}:</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '6px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
          fontSize: '12px', color: THEME.text, background: THEME.surface,
          fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
        }}
      >
        {children}
      </select>
    </label>
  )
}

function StatusPill({ status }) {
  const map = {
    active:         { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'Active' },
    maintenance:    { bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'Maintenance' },
    decommissioned: { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Decommissioned' },
  }
  const s = map[status] || map.decommissioned
  return (
    <span style={{
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500,
      background: s.bg, color: s.text,
    }}>
      {s.label}
    </span>
  )
}

const iconBtn = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
  borderRadius: '6px',
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}
