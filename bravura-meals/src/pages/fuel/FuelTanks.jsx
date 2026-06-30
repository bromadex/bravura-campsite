import { useState } from 'react'
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

const BLANK_FORM = {
  name:                  '',
  code:                  '',
  tank_type:             'above_ground',
  fuel_type_id:          '',
  capacity_litres:       '',
  min_threshold_percent: '20',
  location_description:  '',
  status:                'active',
}

export default function FuelTanks() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { fuelTypes, tanks, addTank, updateTank, archiveTank, tankBalance, loading } = useFuel()

  const canEdit    = can('fuel.edit')
  const canView    = can('fuel.view')

  const [modal,      setModal]      = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [form,       setForm]       = useState(BLANK_FORM)
  const [saving,     setSaving]     = useState(false)
  const [archiving,  setArchiving]  = useState(null)
  const [showAll,    setShowAll]    = useState(false)

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
      status:                tank.status,
    })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.name.trim())   { showToast('Enter a tank name', 'red'); return }
    if (!form.code.trim())   { showToast('Enter a tank code (e.g. T-001)', 'red'); return }
    if (!form.fuel_type_id)  { showToast('Select a fuel type', 'red'); return }
    if (!form.capacity_litres || Number(form.capacity_litres) <= 0) {
      showToast('Enter the tank capacity in litres', 'red'); return
    }
    setSaving(true)
    try {
      const data = {
        name:                  form.name.trim(),
        code:                  form.code.trim().toUpperCase(),
        tank_type:             form.tank_type,
        fuel_type_id:          form.fuel_type_id,
        capacity_litres:       Number(form.capacity_litres),
        min_threshold_percent: Number(form.min_threshold_percent) || 20,
        min_threshold_litres:  (Number(form.capacity_litres) * (Number(form.min_threshold_percent) || 20)) / 100,
        location_description:  form.location_description.trim() || null,
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

  const displayed = showAll ? tanks : tanks.filter(t => t.status !== 'decommissioned')

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1100px' }}>
      <PageHeader
        title="Fuel Tanks"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {tanks.some(t => t.status === 'decommissioned') && (
              <button
                onClick={() => setShowAll(v => !v)}
                style={{ background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '10px', padding: '7px 14px', fontSize: '12px', color: THEME.textMed, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {showAll ? 'Hide Decommissioned' : 'Show All'}
              </button>
            )}
            {canEdit && <Button onClick={openAdd} icon="add">Add Tank</Button>}
          </div>
        }
      />

      <Card style={{ padding: 0 }}>
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="propane_tank" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: '0 0 16px' }}>
              {tanks.length === 0 ? 'No tanks configured yet.' : 'No active tanks.'}
            </p>
            {canEdit && tanks.length === 0 && (
              <Button onClick={openAdd} icon="add">Add First Tank</Button>
            )}
          </div>
        ) : (
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Fuel Type</Th>
              <Th align="right">Capacity (L)</Th>
              <Th align="right">Current Level</Th>
              <Th align="right">Level %</Th>
              <Th>Status</Th>
              {canEdit && <Th />}
            </THead>
            <tbody>
              {displayed.map((tank, idx) => {
                const balance = tankBalance(tank.id)
                const pct = tank.capacity_litres
                  ? Math.min(100, Math.max(0, (balance / Number(tank.capacity_litres)) * 100))
                  : null
                const isLow  = pct !== null && pct <= 20
                const isWarn = pct !== null && pct > 20 && pct < 40
                const levelColor = isLow ? THEME.error : isWarn ? THEME.warning : THEME.success
                const fuelTypeName = tank.fuel_types?.name || '—'
                const fuelTypeColor = tank.fuel_types?.colour || FUEL_CLR

                return (
                  <TRow
                    key={tank.id}
                    last={idx === displayed.length - 1}
                    onClick={canEdit ? () => openEdit(tank) : undefined}
                  >
                    <Td>
                      <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: THEME.textMed }}>
                        {tank.code}
                      </span>
                    </Td>
                    <Td><span style={{ fontWeight: 500 }}>{tank.name}</span></Td>
                    <Td style={{ color: THEME.textMed, textTransform: 'capitalize' }}>
                      {TANK_TYPES.find(t => t.value === tank.tank_type)?.label || tank.tank_type}
                    </Td>
                    <Td>
                      <span style={{
                        padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                        background: fuelTypeColor + '22', color: fuelTypeColor,
                        border: `1px solid ${fuelTypeColor}44`,
                      }}>
                        {fuelTypeName}
                      </span>
                    </Td>
                    <Td align="right" style={{ fontWeight: 500 }}>
                      {tank.capacity_litres != null ? Number(tank.capacity_litres).toLocaleString() : '—'}
                    </Td>
                    <Td align="right">
                      <span style={{ fontWeight: 600, color: isLow ? THEME.error : THEME.text }}>
                        {balance.toFixed(0)} L
                      </span>
                    </Td>
                    <Td align="right">
                      {pct !== null ? (
                        <span style={{ fontWeight: 600, fontSize: '13px', color: levelColor }}>
                          {pct.toFixed(0)}%
                        </span>
                      ) : '—'}
                    </Td>
                    <Td>
                      <span style={{
                        padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                        background: tank.status === 'active'          ? THEME.statusSuccessBg
                                  : tank.status === 'maintenance'     ? THEME.statusWarningBg
                                  : THEME.statusNeutralBg,
                        color:      tank.status === 'active'          ? THEME.statusSuccessText
                                  : tank.status === 'maintenance'     ? THEME.statusWarningText
                                  : THEME.statusNeutralText,
                      }}>
                        {tank.status.charAt(0).toUpperCase() + tank.status.slice(1)}
                      </span>
                    </Td>
                    {canEdit && (
                      <Td>
                        {tank.status !== 'decommissioned' && (
                          <button
                            onClick={e => { e.stopPropagation(); setArchiving(tank) }}
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
        )}
      </Card>

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

      {/* Decommission Confirm */}
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

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}
