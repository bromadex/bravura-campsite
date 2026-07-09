import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'
import { fuelUsageByAsset } from './fuelDisplay'

const FUEL_CLR = MODULE_COLORS.fuel

const EQUIP_ICON = t =>
  /generator/i.test(t || '') ? 'bolt'
  : /crane|tlb|excavator|bulldozer|adt|compactor|grader|bobcat/i.test(t || '') ? 'front_loader'
  : /drill/i.test(t || '') ? 'construction'
  : 'precision_manufacturing'

const EQUIPMENT_TYPES = ['Generator', 'Compressor', 'Drill', 'Pump', 'Other']

const STATUS_OPTIONS = [
  { value: 'active',         label: 'Active' },
  { value: 'maintenance',    label: 'Maintenance' },
  { value: 'decommissioned', label: 'Decommissioned' },
]

const BLANK_FORM = {
  equipment_number:         '',
  name:                     '',
  equipment_type:           'Generator',
  department_id:            '',
  fuel_type_id:             '',
  expected_consumption_lph: '',
  status:                   'active',
}

export default function Equipment() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const {
    fuelTypes, equipment, departments, transactions,
    addEquipment, updateEquipment, archiveEquipment, loading,
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
  const [filterType, setFilterType] = useState('all')
  const [query,      setQuery]      = useState('')

  if (!canView) return null

  function openAdd() {
    setEditItem(null)
    setForm({ ...BLANK_FORM, fuel_type_id: fuelTypes[0]?.id || '' })
    setModal(true)
  }
  function openEdit(e) {
    setEditItem(e)
    setForm({
      equipment_number:         e.equipment_number || '',
      name:                     e.name || '',
      equipment_type:           e.equipment_type || 'Other',
      department_id:            e.department_id || '',
      fuel_type_id:             e.fuel_type_id || '',
      expected_consumption_lph: e.expected_consumption_lph != null ? String(e.expected_consumption_lph) : '',
      status:                   e.status,
    })
    setModal(true)
  }
  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.equipment_number.trim()) { showToast('Equipment number is required', 'red'); return }
    if (!form.name.trim())              { showToast('Name is required', 'red'); return }
    if (!form.fuel_type_id)             { showToast('Select a fuel type', 'red'); return }
    setSaving(true)
    try {
      const data = {
        equipment_number:         form.equipment_number.trim(),
        name:                     form.name.trim(),
        equipment_type:           form.equipment_type,
        department_id:            form.department_id || null,
        fuel_type_id:             form.fuel_type_id,
        expected_consumption_lph: form.expected_consumption_lph ? Number(form.expected_consumption_lph) : null,
        status:                   form.status,
      }
      if (editItem) { await updateEquipment(editItem.id, data); showToast('Equipment updated', 'green') }
      else           { await addEquipment(data); showToast('Equipment added', 'green') }
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmArchive() {
    try {
      await archiveEquipment(archiving.id)
      showToast('Equipment archived', 'green')
    } catch (err) {
      showToast(err.message || 'Failed', 'red')
    } finally {
      setArchiving(null)
    }
  }

  const deptName = id => departments.find(d => d.id === id)?.name || '—'

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return equipment.filter(e => {
      if (filterFuel !== 'all' && e.fuel_type_id !== filterFuel) return false
      if (filterDept !== 'all' && e.department_id !== filterDept) return false
      if (filterStat !== 'all' && e.status !== filterStat) return false
      if (filterType !== 'all' && e.equipment_type !== filterType) return false
      if (q && !`${e.equipment_number} ${e.name} ${e.description || ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [equipment, filterFuel, filterDept, filterStat, filterType, query])

  // Live fuel usage per equipment item, from the shared transactions list.
  const fuelUsage = useMemo(() => fuelUsageByAsset(transactions, 'fleet_asset_id'), [transactions])

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <PageHeader
        title="Equipment"
        site={currentSite}
        actions={canEdit && <Button onClick={openAdd} icon="add">Add Equipment</Button>}
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
            placeholder="Equipment # or name"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', padding: '8px 4px', fontSize: '13px', color: THEME.text, fontFamily: 'inherit' }}
          />
        </div>
        <FilterSelect label="Type" value={filterType} onChange={setFilterType}>
          <option value="all">All</option>
          {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </FilterSelect>
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
        {(filterFuel !== 'all' || filterDept !== 'all' || filterStat !== 'active' || filterType !== 'all' || query) && (
          <button
            onClick={() => { setFilterFuel('all'); setFilterDept('all'); setFilterStat('active'); setFilterType('all'); setQuery('') }}
            style={{ background: 'none', border: 'none', color: FUEL_CLR, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
          >Reset</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
          {displayed.length} of {equipment.length}
        </span>
      </div>

      <Card style={{ padding: 0 }}>
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="construction" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: '0 0 16px' }}>
              {equipment.length === 0 ? 'No equipment in the registry yet.' : 'No equipment matches the current filters.'}
            </p>
            {canEdit && equipment.length === 0 && <Button onClick={openAdd} icon="add">Add First Equipment</Button>}
          </div>
        ) : (
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Equipment</Th>
              <Th>Type</Th>
              <Th>Department</Th>
              <Th align="right">Fuel — 30 days</Th>
              <Th>Last Fueled</Th>
              <Th>Status</Th>
              {canEdit && <Th />}
            </THead>
            <tbody>
              {displayed.map((e, idx) => {
                const usage = fuelUsage.get(e.id)
                return (
                  <TRow key={e.id} last={idx === displayed.length - 1} onClick={() => setDetail(e)}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: '8px', flexShrink: 0,
                          background: FUEL_CLR + '14',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon name={EQUIP_ICON(`${e.equipment_type} ${e.name}`)} size={17} style={{ color: FUEL_CLR }} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: THEME.text, fontSize: '13px' }}>{e.name}</div>
                          <div style={{ fontSize: '11px', color: THEME.textLow, fontFamily: 'monospace' }}>
                            {e.equipment_number}
                          </div>
                        </div>
                      </div>
                    </Td>
                    <Td style={{ color: THEME.textMed }}>{e.equipment_type || '—'}</Td>
                    <Td style={{ color: THEME.textMed }}>{deptName(e.department_id)}</Td>
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
                    <Td><StatusPill status={e.status} /></Td>
                    {canEdit && (
                      <Td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={ev => { ev.stopPropagation(); openEdit(e) }}
                            style={iconBtn} title="Edit">
                            <Icon name="edit" size={15} style={{ color: THEME.textMed }} />
                          </button>
                          {e.status !== 'decommissioned' && (
                            <button onClick={ev => { ev.stopPropagation(); setArchiving(e) }}
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

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Equipment' : 'Add Equipment'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update' : 'Add Equipment'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Equipment # *</SectionLabel>
            <input value={form.equipment_number} onChange={e => set('equipment_number', e.target.value)} placeholder="e.g. EQ-001" style={inputStyle} autoFocus />
          </div>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Generator 25 kVA" style={inputStyle} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Type *</SectionLabel>
            <select value={form.equipment_type} onChange={e => set('equipment_type', e.target.value)} style={inputStyle}>
              {EQUIPMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Department</SectionLabel>
            <select value={form.department_id} onChange={e => set('department_id', e.target.value)} style={inputStyle}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Fuel Type *</SectionLabel>
            <select value={form.fuel_type_id} onChange={e => set('fuel_type_id', e.target.value)} style={inputStyle}>
              <option value="">— Select —</option>
              {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Expected Consumption (L/hr)</SectionLabel>
            <input type="number" min="0" step="0.001" value={form.expected_consumption_lph} onChange={e => set('expected_consumption_lph', e.target.value)} placeholder="e.g. 3.2" style={inputStyle} />
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
        title="Archive Equipment"
        message={archiving
          ? `Archive "${archiving.equipment_number} — ${archiving.name}"? It will be hidden from issuance dropdowns. Transaction history is preserved.`
          : ''}
      />

      <EquipmentDetailModal equipment={detail} transactions={transactions} onClose={() => setDetail(null)} />
    </div>
  )
}

// ── Detail modal: recent transactions (last 30 days) ───────────────────────────

function EquipmentDetailModal({ equipment, transactions, onClose }) {
  const recent = useMemo(() => {
    if (!equipment) return []
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return transactions.filter(t => t.fleet_asset_id === equipment.id && t.transaction_date >= cutoffStr)
  }, [equipment, transactions])

  const total = recent.reduce((s, t) => s + Number(t.litres), 0)

  if (!equipment) return null
  return (
    <Modal
      open={!!equipment}
      onClose={onClose}
      title={`${equipment.equipment_number} · ${equipment.name}`}
      footer={<Button onClick={onClose} variant="text">Close</Button>}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '10px', marginBottom: '16px',
      }}>
        <Stat label="Type"          value={equipment.equipment_type || '—'} />
        <Stat label="Fuel Type"     value={equipment.fuel_types?.name || '—'} />
        <Stat label="Last 30 days"  value={`${recent.length} txns`} />
        <Stat label="Litres Used"   value={`${total.toFixed(1)} L`} />
      </div>

      {recent.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px', background: THEME.surfaceVar, borderRadius: '12px' }}>
          No fuel transactions for this equipment in the last 30 days.
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
      <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{value}</div>
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed }}>
      <span>{label}:</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{
          padding: '6px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
          fontSize: '12px', color: THEME.text, background: THEME.surface,
          fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
        }}>
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
    <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: s.bg, color: s.text }}>
      {s.label}
    </span>
  )
}

const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px' }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}
