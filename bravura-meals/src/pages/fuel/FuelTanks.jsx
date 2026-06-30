import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const TANK_TYPES = [
  { value: 'above_ground', label: 'Above Ground' },
  { value: 'underground',  label: 'Underground' },
  { value: 'bowser',       label: 'Bowser' },
  { value: 'mobile',       label: 'Mobile' },
]

const STATUS_OPTIONS = [
  { value: 'active',         label: 'Active' },
  { value: 'maintenance',    label: 'Maintenance' },
  { value: 'decommissioned', label: 'Decommissioned' },
]

const BLANK_FORM = {
  name:                  '',
  code:                  '',
  tank_type:             'above_ground',
  fuel_type_id:          '',
  capacity_litres:       '',
  min_threshold_percent: '20',
  location_description:  '',
  gps_lat:               '',
  gps_lng:               '',
  atg_device_id:         '',
  status:                'active',
}

export default function FuelTanks() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { fuelTypes, tanks, addTank, updateTank, archiveTank, tankBalance, loading } = useFuel()

  const canEdit = can('fuel.edit')
  const canView = can('fuel.view')

  const [modal,      setModal]      = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [form,       setForm]       = useState(BLANK_FORM)
  const [saving,     setSaving]     = useState(false)
  const [archiving,  setArchiving]  = useState(null)
  const [view,       setView]       = useState('cards')   // 'cards' | 'table'
  const [filterFuel, setFilterFuel] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterStat, setFilterStat] = useState('active')

  if (!canView) return null

  const defaultFuelTypeId = fuelTypes[0]?.id || ''

  function openAdd() {
    setEditItem(null)
    setForm({ ...BLANK_FORM, fuel_type_id: defaultFuelTypeId })
    setModal(true)
  }

  function openEdit(tank) {
    setEditItem(tank)
    setForm({
      name:                  tank.name,
      code:                  tank.code,
      tank_type:             tank.tank_type,
      fuel_type_id:          tank.fuel_type_id,
      capacity_litres:       tank.capacity_litres != null ? String(tank.capacity_litres) : '',
      min_threshold_percent: tank.min_threshold_percent != null ? String(tank.min_threshold_percent) : '20',
      location_description:  tank.location_description || '',
      gps_lat:               tank.gps_lat != null ? String(tank.gps_lat) : '',
      gps_lng:               tank.gps_lng != null ? String(tank.gps_lng) : '',
      atg_device_id:         tank.atg_device_id || '',
      status:                tank.status,
    })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.name.trim())  { showToast('Enter a tank name', 'red'); return }
    if (!form.code.trim())  { showToast('Enter a tank code (e.g. T-001)', 'red'); return }
    if (!form.fuel_type_id) { showToast('Select a fuel type', 'red'); return }
    const capacity = Number(form.capacity_litres)
    if (!capacity || capacity <= 0) {
      showToast('Enter the tank capacity in litres', 'red'); return
    }
    // Hard guard: never let an edit reduce capacity below what is currently in the tank.
    if (editItem) {
      const currentLevel = Number(editItem.current_level_litres) || 0
      if (capacity < currentLevel) {
        showToast(`Capacity cannot be below current level (${currentLevel.toFixed(1)} L)`, 'red')
        return
      }
    }

    setSaving(true)
    try {
      const data = {
        name:                  form.name.trim(),
        code:                  form.code.trim().toUpperCase(),
        tank_type:             form.tank_type,
        fuel_type_id:          form.fuel_type_id,
        capacity_litres:       capacity,
        min_threshold_percent: Number(form.min_threshold_percent) || 20,
        min_threshold_litres:  (capacity * (Number(form.min_threshold_percent) || 20)) / 100,
        location_description:  form.location_description.trim() || null,
        gps_lat:               form.gps_lat ? Number(form.gps_lat) : null,
        gps_lng:               form.gps_lng ? Number(form.gps_lng) : null,
        atg_device_id:         form.atg_device_id.trim() || null,
        status:                form.status,
      }
      if (editItem) {
        await updateTank(editItem.id, data)
        showToast('Tank updated', 'green')
      } else {
        await addTank(data)
        showToast('Tank added', 'green')
      }
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function setStatus(tank, newStatus) {
    try {
      await updateTank(tank.id, { status: newStatus })
      showToast(`Tank marked ${newStatus}`, 'green')
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'red')
    }
  }

  async function confirmArchive() {
    try {
      await archiveTank(archiving.id)
      showToast('Tank decommissioned', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to decommission', 'red')
    } finally {
      setArchiving(null)
    }
  }

  // ── Filtering ────────────────────────────────────────────────────────────────
  const displayed = useMemo(() => tanks.filter(t => {
    if (filterFuel !== 'all' && t.fuel_type_id !== filterFuel) return false
    if (filterType !== 'all' && t.tank_type !== filterType)    return false
    if (filterStat !== 'all' && t.status !== filterStat)       return false
    return true
  }), [tanks, filterFuel, filterType, filterStat])

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <PageHeader
        title="Fuel Tanks"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <div style={{ display: 'flex', background: THEME.surfaceVar, borderRadius: '10px', padding: '3px' }}>
              {[
                { id: 'cards', icon: 'grid_view',     label: 'Cards' },
                { id: 'table', icon: 'table_rows',    label: 'Table' },
              ].map(v => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: view === v.id ? THEME.surface : 'transparent',
                    color:      view === v.id ? THEME.text    : THEME.textMed,
                    boxShadow:  view === v.id ? THEME.shadow1 : 'none',
                  }}
                >
                  <Icon name={v.icon} size={14} />
                  {v.label}
                </button>
              ))}
            </div>
            {canEdit && <Button onClick={openAdd} icon="add">Add Tank</Button>}
          </div>
        }
      />

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <FilterSelect label="Fuel Type" value={filterFuel} onChange={setFilterFuel}>
          <option value="all">All Fuels</option>
          {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
        </FilterSelect>
        <FilterSelect label="Tank Type" value={filterType} onChange={setFilterType}>
          <option value="all">All Types</option>
          {TANK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </FilterSelect>
        <FilterSelect label="Status" value={filterStat} onChange={setFilterStat}>
          <option value="all">All Statuses</option>
          {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </FilterSelect>
        {(filterFuel !== 'all' || filterType !== 'all' || filterStat !== 'active') && (
          <button
            onClick={() => { setFilterFuel('all'); setFilterType('all'); setFilterStat('active') }}
            style={{ background: 'none', border: 'none', color: FUEL_CLR, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Reset filters
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
          {displayed.length} of {tanks.length}
        </span>
      </div>

      {displayed.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px 20px', color: THEME.textLow }}>
            <Icon name="propane_tank" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: '0 0 16px' }}>
              {tanks.length === 0 ? 'No tanks configured yet.' : 'No tanks match the current filters.'}
            </p>
            {canEdit && tanks.length === 0 && <Button onClick={openAdd} icon="add">Add First Tank</Button>}
          </div>
        </Card>
      ) : view === 'cards' ? (
        <TankCardGrid
          tanks={displayed}
          tankBalance={tankBalance}
          canEdit={canEdit}
          onEdit={openEdit}
          onStatus={setStatus}
          onDecommission={t => setArchiving(t)}
        />
      ) : (
        <TankTable
          tanks={displayed}
          tankBalance={tankBalance}
          canEdit={canEdit}
          onEdit={openEdit}
          onDecommission={t => setArchiving(t)}
        />
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Tank' : 'Add Tank'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update Tank' : 'Add Tank'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Tank Name *</SectionLabel>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Diesel Tank" style={inputStyle} autoFocus />
          </div>
          <div>
            <SectionLabel>Tank Code *</SectionLabel>
            <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. T-001" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Tank Type *</SectionLabel>
            <select value={form.tank_type} onChange={e => set('tank_type', e.target.value)} style={inputStyle}>
              {TANK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
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
            <SectionLabel>Capacity (Litres) *</SectionLabel>
            <input
              type="number" min="1" step="1"
              value={form.capacity_litres}
              onChange={e => set('capacity_litres', e.target.value)}
              placeholder="e.g. 10000"
              style={inputStyle}
            />
            {editItem && (
              <div style={{ marginTop: '-8px', marginBottom: '14px', fontSize: '11px', color: THEME.textLow }}>
                Current level: {Number(editItem.current_level_litres || 0).toFixed(1)} L — capacity cannot drop below this.
              </div>
            )}
          </div>
          <div>
            <SectionLabel>Low-Fuel Alert Threshold (%)</SectionLabel>
            <input
              type="number" min="0" max="100" step="1"
              value={form.min_threshold_percent}
              onChange={e => set('min_threshold_percent', e.target.value)}
              placeholder="20"
              style={inputStyle}
            />
          </div>
        </div>

        <div>
          <SectionLabel>Location Description</SectionLabel>
          <input value={form.location_description} onChange={e => set('location_description', e.target.value)} placeholder="e.g. Near main gate, pump house" style={inputStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>GPS Latitude</SectionLabel>
            <input
              type="number" step="0.0000001"
              value={form.gps_lat}
              onChange={e => set('gps_lat', e.target.value)}
              placeholder="-17.8252"
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>GPS Longitude</SectionLabel>
            <input
              type="number" step="0.0000001"
              value={form.gps_lng}
              onChange={e => set('gps_lng', e.target.value)}
              placeholder="31.0335"
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>ATG Device ID</SectionLabel>
            <input
              value={form.atg_device_id}
              onChange={e => set('atg_device_id', e.target.value)}
              placeholder="optional"
              style={inputStyle}
            />
          </div>
        </div>

        {editItem && (
          <div>
            <SectionLabel>Status</SectionLabel>
            <select value={form.status} onChange={e => set('status', e.target.value)} style={inputStyle}>
              <option value="active">Active</option>
              <option value="maintenance">Under Maintenance</option>
            </select>
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={confirmArchive}
        title="Decommission Tank"
        message={archiving
          ? `Decommission "${archiving.name}"? The tank will be hidden from all dropdowns. Transaction history is preserved. This cannot be undone.`
          : ''}
      />
    </div>
  )
}

// ── Card Grid ──────────────────────────────────────────────────────────────────

function TankCardGrid({ tanks, tankBalance, canEdit, onEdit, onStatus, onDecommission }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '14px' }}>
      {tanks.map(tank => (
        <TankCard
          key={tank.id}
          tank={tank}
          balance={tankBalance(tank.id)}
          canEdit={canEdit}
          onEdit={() => onEdit(tank)}
          onStatus={s => onStatus(tank, s)}
          onDecommission={() => onDecommission(tank)}
        />
      ))}
    </div>
  )
}

function TankCard({ tank, balance, canEdit, onEdit, onStatus, onDecommission }) {
  const capacity = Number(tank.capacity_litres) || 0
  const pct      = capacity ? Math.min(100, Math.max(0, (balance / capacity) * 100)) : 0
  const minPct   = Number(tank.min_threshold_percent) || 20
  const isLow    = pct <= minPct
  const isWarn   = pct > minPct && pct < minPct * 1.5
  const levelClr = isLow ? THEME.error : isWarn ? THEME.warning : THEME.success
  const ftName   = tank.fuel_types?.name   || 'Unknown'
  const ftColor  = tank.fuel_types?.colour || FUEL_CLR
  const isDecom  = tank.status === 'decommissioned'

  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${isLow ? THEME.error + '55' : THEME.outlineVar}`,
      borderRadius: '16px', padding: '16px', boxShadow: THEME.shadow1,
      display: 'flex', flexDirection: 'column', gap: '12px',
      opacity: isDecom ? 0.6 : 1,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '2px' }}>
            {tank.name}
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: '11px', color: THEME.textLow }}>
            {tank.code}
          </div>
        </div>
        <span style={{
          padding: '2px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
          background: ftColor + '22', color: ftColor, border: `1px solid ${ftColor}44`,
          whiteSpace: 'nowrap',
        }}>
          {ftName}
        </span>
      </div>

      {/* Level bar */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
          <span style={{ fontSize: '22px', fontWeight: 600, color: levelClr, letterSpacing: '-0.01em' }}>
            {pct.toFixed(0)}%
          </span>
          <span style={{ fontSize: '12px', color: THEME.textMed }}>
            {balance.toFixed(0)} / {capacity.toLocaleString()} L
          </span>
        </div>
        <div style={{ height: '10px', borderRadius: '999px', background: THEME.surfaceVar, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            height: '100%', width: `${pct}%`,
            background: levelClr, transition: 'width .25s',
          }} />
          {/* Threshold marker */}
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${minPct}%`, width: '2px', background: THEME.outline,
          }} />
        </div>
      </div>

      {/* Status + alert badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        <StatusBadge status={tank.status} />
        {isLow && !isDecom && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
            background: THEME.statusErrorBg, color: THEME.statusErrorText,
          }}>
            <Icon name="warning" size={12} /> Low Fuel
          </span>
        )}
        <span style={{
          padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
          background: THEME.surfaceVar, color: THEME.textMed, textTransform: 'capitalize',
        }}>
          {tank.tank_type?.replace('_', ' ')}
        </span>
      </div>

      {tank.location_description && (
        <div style={{ fontSize: '11px', color: THEME.textLow, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Icon name="location_on" size={12} /> {tank.location_description}
        </div>
      )}

      {/* Actions */}
      {canEdit && !isDecom && (
        <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
          <button onClick={onEdit} style={cardBtn(false)}>
            <Icon name="edit" size={13} /> Edit
          </button>
          {tank.status === 'active' ? (
            <button onClick={() => onStatus('maintenance')} style={cardBtn(false)}>
              <Icon name="build" size={13} /> Maintenance
            </button>
          ) : (
            <button onClick={() => onStatus('active')} style={cardBtn(false)}>
              <Icon name="play_arrow" size={13} /> Reactivate
            </button>
          )}
          <button onClick={onDecommission} style={cardBtn(true)} title="Decommission">
            <Icon name="archive" size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Table view ─────────────────────────────────────────────────────────────────

function TankTable({ tanks, tankBalance, canEdit, onEdit, onDecommission }) {
  return (
    <Card style={{ padding: 0 }}>
      <TableWrap>
        <THead color={FUEL_CLR}>
          <Th>Code</Th>
          <Th>Name</Th>
          <Th>Type</Th>
          <Th>Fuel</Th>
          <Th align="right">Capacity (L)</Th>
          <Th align="right">Level</Th>
          <Th align="right">%</Th>
          <Th>Status</Th>
          {canEdit && <Th />}
        </THead>
        <tbody>
          {tanks.map((tank, idx) => {
            const balance = tankBalance(tank.id)
            const pct = tank.capacity_litres
              ? Math.min(100, Math.max(0, (balance / Number(tank.capacity_litres)) * 100))
              : null
            const minPct = Number(tank.min_threshold_percent) || 20
            const isLow  = pct !== null && pct <= minPct
            const levelClr = isLow ? THEME.error : pct < minPct * 1.5 ? THEME.warning : THEME.success
            const ftName  = tank.fuel_types?.name   || '—'
            const ftColor = tank.fuel_types?.colour || FUEL_CLR

            return (
              <TRow
                key={tank.id}
                last={idx === tanks.length - 1}
                onClick={canEdit ? () => onEdit(tank) : undefined}
              >
                <Td><span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: THEME.textMed }}>{tank.code}</span></Td>
                <Td><span style={{ fontWeight: 500 }}>{tank.name}</span></Td>
                <Td style={{ color: THEME.textMed, textTransform: 'capitalize' }}>
                  {TANK_TYPES.find(t => t.value === tank.tank_type)?.label || tank.tank_type}
                </Td>
                <Td>
                  <span style={{
                    padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                    background: ftColor + '22', color: ftColor, border: `1px solid ${ftColor}44`,
                  }}>
                    {ftName}
                  </span>
                </Td>
                <Td align="right" style={{ fontWeight: 500 }}>
                  {tank.capacity_litres != null ? Number(tank.capacity_litres).toLocaleString() : '—'}
                </Td>
                <Td align="right">
                  <span style={{ fontWeight: 600, color: isLow ? THEME.error : THEME.text }}>
                    {balance.toFixed(0)}
                  </span>
                </Td>
                <Td align="right">
                  {pct !== null ? (
                    <span style={{ fontWeight: 600, fontSize: '13px', color: levelClr }}>
                      {pct.toFixed(0)}%
                    </span>
                  ) : '—'}
                </Td>
                <Td><StatusBadge status={tank.status} /></Td>
                {canEdit && (
                  <Td>
                    {tank.status !== 'decommissioned' && (
                      <button
                        onClick={e => { e.stopPropagation(); onDecommission(tank) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', opacity: .6 }}
                        title="Decommission tank"
                      >
                        <Icon name="archive" size={16} style={{ color: THEME.error }} />
                      </button>
                    )}
                  </Td>
                )}
              </TRow>
            )
          })}
        </tbody>
      </TableWrap>
    </Card>
  )
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

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

function StatusBadge({ status }) {
  const map = {
    active:         { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'Active' },
    maintenance:    { bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'Maintenance' },
    decommissioned: { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Decommissioned' },
  }
  const s = map[status] || map.decommissioned
  return (
    <span style={{
      padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
      background: s.bg, color: s.text,
    }}>
      {s.label}
    </span>
  )
}

function cardBtn(danger) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '6px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 500,
    border: `1px solid ${danger ? THEME.error + '55' : THEME.outline}`,
    background: 'transparent',
    color: danger ? THEME.error : THEME.textMed,
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
  }
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}
