import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'
import { fuelUsageByAsset, parseTxnNotes } from './fuelDisplay'

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
      if (q && !`${v.fleet_number} ${v.registration || ''} ${v.description || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [vehicles, filterFuel, filterDept, filterStat, query])

  // Live fuel usage per vehicle — the fleet registry talks to the fuel
  // module through the shared transactions list, no extra queries.
  const fuelUsage = useMemo(() => fuelUsageByAsset(transactions, 'fleet_asset_id'), [transactions])

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
              <Th>Vehicle</Th>
              <Th>Description</Th>
              <Th>Department</Th>
              <Th align="right">Fuel — 30 days</Th>
              <Th>Last Fueled</Th>
              <Th>Status</Th>
              {canEdit && <Th />}
            </THead>
            <tbody>
              {displayed.map((v, idx) => {
                const usage = fuelUsage.get(v.id)
                const desc  = [v.make, v.model].filter(Boolean).join(' ') || v.description || null
                return (
                  <TRow key={v.id} last={idx === displayed.length - 1} onClick={() => setDetail(v)}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '8px', flexShrink: 0,
                          background: FUEL_CLR + '14',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon name="directions_car" size={17} style={{ color: FUEL_CLR }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: THEME.text, fontSize: '13px' }}>
                            {v.registration || v.fleet_number}
                          </div>
                          <div style={{ fontSize: '11px', color: THEME.textLow, fontFamily: 'monospace' }}>
                            {v.fleet_number}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td style={{ color: desc ? THEME.textMed : THEME.textLow }}>
                      {desc || '—'}
                      {v.year && <span style={{ color: THEME.textLow, marginLeft: '6px' }}>({v.year})</span>}
                    </Td>
                    <Td style={{ color: THEME.textMed }}>{deptName(v.department_id)}</Td>
                    <Td align="right">
                      {usage?.count30 ? (
                        <div>
                          <div style={{ fontWeight: 700, color: FUEL_CLR, whiteSpace: 'nowrap' }}>
                            {usage.litres30.toLocaleString(undefined, { maximumFractionDigits: 0 })} L
                          </div>
                          <div style={{ fontSize: '10px', color: THEME.textLow }}>
                            {usage.count30} fill{usage.count30 === 1 ? '' : 's'}
                          </div>
                        </div>
                      ) : <span style={{ color: THEME.textLow, fontSize: '12px' }}>—</span>}
                    </Td>
                    <Td style={{ color: usage?.lastDate ? THEME.textMed : THEME.textLow, whiteSpace: 'nowrap' }}>
                      {usage?.lastDate ? fmtDate(usage.lastDate) : 'Never'}
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
      <Modal dirty={true}
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
  const history = useMemo(() => {
    if (!vehicle) return { rows: [], total: 0, total30: 0, count30: 0 }
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const rows = transactions
      .filter(t => t.fleet_asset_id === vehicle.id)
      .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date))
    let total = 0, total30 = 0, count30 = 0
    for (const t of rows) {
      const l = Number(t.litres) || 0
      total += l
      if (t.transaction_date >= cutoffStr) { total30 += l; count30++ }
    }
    return { rows: rows.slice(0, 25), total, total30, count30 }
  }, [vehicle, transactions])

  if (!vehicle) return null
  const desc = [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.description || '—'
  return (
    <Modal dirty={true}
      open={!!vehicle}
      onClose={onClose}
      title={`${vehicle.registration || vehicle.fleet_number} · ${desc}`}
      footer={<Button onClick={onClose} variant="text">Close</Button>}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '10px', marginBottom: '16px',
      }}>
        <Stat label="Fleet #"      value={vehicle.fleet_number} />
        <Stat label="Fuel Type"    value={vehicle.fuel_types?.name || 'Diesel'} />
        <Stat label="Last 30 days" value={`${history.total30.toLocaleString(undefined, { maximumFractionDigits: 0 })} L · ${history.count30} fills`} />
        <Stat label="All time"     value={`${history.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} />
      </div>

      {history.rows.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px', background: THEME.surfaceVar, borderRadius: '12px' }}>
          No fuel transactions recorded for this vehicle yet.
        </div>
      ) : (
        <div style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', overflow: 'hidden' }}>
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Date</Th>
              <Th align="right">Litres</Th>
              <Th>Driver</Th>
              <Th>Purpose</Th>
            </THead>
            <tbody>
              {history.rows.map((t, idx) => {
                const parsed = parseTxnNotes(t.notes)
                return (
                  <TRow key={t.id} last={idx === history.rows.length - 1}>
                    <Td style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.transaction_date)}</Td>
                    <Td align="right" style={{ fontWeight: 600, color: t.transaction_type === 'issuance' ? FUEL_CLR : THEME.success, whiteSpace: 'nowrap' }}>
                      {t.transaction_type === 'issuance' ? '−' : '+'}{Number(t.litres).toFixed(0)} L
                    </Td>
                    <Td style={{ color: parsed.driver ? THEME.textMed : THEME.textLow, textTransform: 'capitalize' }}>
                      {parsed.driver || '—'}
                    </Td>
                    <Td style={{ color: THEME.textMed, maxWidth: '160px' }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {parsed.purpose || parsed.clean || '—'}
                      </span>
                    </Td>
                  </TRow>
                )
              })}
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
