import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { StatusBadge, ModalOverlay } from '../../components/ui'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'
import FleetAssetIcon from '../../components/FleetAssetIcon'

const color = MODULE_COLORS.fleet

const STATUS_MAP = {
  operational:      { label: 'Operational',     bg: THEME.statusSuccessBg,   text: THEME.statusSuccessText },
  maintenance:      { label: 'Maintenance',     bg: THEME.statusWarningBg,   text: THEME.statusWarningText },
  grounded:         { label: 'Grounded',        bg: THEME.statusErrorBg,     text: THEME.statusErrorText },
  awaiting_parts:   { label: 'Awaiting Parts',  bg: THEME.statusTertiaryBg,  text: THEME.statusTertiaryText },
  decommissioned:   { label: 'Decommissioned',  bg: THEME.statusNeutralBg,   text: THEME.statusNeutralText },
}


const TABS = ['Identity', 'Operations', 'Finance']

const EMPTY_FORM = {
  asset_type_id: '', asset_number: '', description: '', registration: '',
  serial_number: '', fleet_number: '', make: '', model: '', year: '',
  status: 'operational', department_id: '', assigned_project: '', cost_center: '',
  current_hours: '', expected_consumption_lph: '', tank_capacity_litres: '',
  purchase_date: '', purchase_cost: '', salvage_value: '', useful_life_months: '',
}

export default function FleetHeavyEquipment({ setPage }) {
  const { can } = usePermissions()
  const { heavyEquipment, assetTypes, departments, loading, addAsset, updateAsset, archiveAsset } = useFleet()

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState(0)

  const heavyTypes = useMemo(() => assetTypes.filter(t => t.category === 'heavy_equipment'), [assetTypes])

  const filtered = useMemo(() => {
    let list = heavyEquipment
    if (filterType !== 'all') list = list.filter(a => a.asset_type_id === filterType)
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus)
    if (filterDept !== 'all') list = list.filter(a => a.department_id === filterDept)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        (a.description || '').toLowerCase().includes(q) ||
        (a.asset_number || '').toLowerCase().includes(q) ||
        (a.make || '').toLowerCase().includes(q) ||
        (a.model || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [heavyEquipment, filterType, filterStatus, filterDept, search])

  const kpis = useMemo(() => {
    const total = heavyEquipment.length
    const operational = heavyEquipment.filter(a => a.status === 'operational').length
    const maintenance = heavyEquipment.filter(a => a.status === 'maintenance' || a.status === 'awaiting_parts').length
    const grounded = heavyEquipment.filter(a => a.status === 'grounded').length
    return { total, operational, maintenance, grounded }
  }, [heavyEquipment])

  function openAdd() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setError('')
    setActiveTab(0)
    setModalOpen(true)
  }

  function openEdit(asset) {
    setEditId(asset.id)
    setForm({
      asset_type_id: asset.asset_type_id || '',
      asset_number: asset.asset_number || '',
      description: asset.description || '',
      registration: asset.registration || '',
      serial_number: asset.serial_number || '',
      fleet_number: asset.fleet_number || '',
      make: asset.make || '',
      model: asset.model || '',
      year: asset.year || '',
      status: asset.status || 'operational',
      department_id: asset.department_id || '',
      assigned_project: asset.assigned_project || '',
      cost_center: asset.cost_center || '',
      current_hours: asset.current_hours || '',
      expected_consumption_lph: asset.expected_consumption_lph || '',
      tank_capacity_litres: asset.tank_capacity_litres || '',
      purchase_date: asset.purchase_date || '',
      purchase_cost: asset.purchase_cost || '',
      salvage_value: asset.salvage_value || '',
      useful_life_months: asset.useful_life_months || '',
    })
    setError('')
    setActiveTab(0)
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_type_id || !form.asset_number || !form.description) {
      setError('Asset type, asset number, and description are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        year: form.year ? Number(form.year) : null,
        current_hours: form.current_hours ? Number(form.current_hours) : null,
        expected_consumption_lph: form.expected_consumption_lph ? Number(form.expected_consumption_lph) : null,
        tank_capacity_litres: form.tank_capacity_litres ? Number(form.tank_capacity_litres) : null,
        purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
        salvage_value: form.salvage_value ? Number(form.salvage_value) : null,
        useful_life_months: form.useful_life_months ? Number(form.useful_life_months) : null,
        department_id: form.department_id || null,
        assigned_project: form.assigned_project || null,
        cost_center: form.cost_center || null,
        purchase_date: form.purchase_date || null,
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

  async function handleArchive(id) {
    if (!confirm('Archive this equipment? It will be marked as decommissioned.')) return
    try { await archiveAsset(id); setModalOpen(false) } catch (err) { alert(err.message) }
  }

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px' }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiTiles = [
    { label: 'Total Equipment', value: kpis.total, icon: 'construction', bg: color + '18', fg: color },
    { label: 'Operational', value: kpis.operational, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'In Maintenance', value: kpis.maintenance, icon: 'build', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Grounded', value: kpis.grounded, icon: 'block', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
  ]

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_equipment" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Heavy Equipment</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</div>
        </div>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {kpiTiles.map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '16px',
            border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: k.fg }}>{k.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search equipment..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, maxWidth: '180px' }}>
          <option value="all">All Types</option>
          {heavyTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
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
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>construction</span>
          <div style={{ fontSize: '14px' }}>No heavy equipment found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add new equipment</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
          {filtered.map(a => {
            const typeName = a.fleet_asset_types?.name || ''
            return (
              <div
                key={a.id}
                onClick={() => can('fleet.edit') ? openEdit(a) : null}
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
                  <FleetAssetIcon typeName={typeName} color={color} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.asset_number}
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                      {[a.make, a.model, a.year].filter(Boolean).join(' ')}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <div style={{ fontSize: '13px', color: THEME.text, marginTop: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.description}
                </div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '12px', color: THEME.textMed, flexWrap: 'wrap' }}>
                  {a.departments?.name && <span>{a.departments.name}</span>}
                  {a.current_hours != null && <span>{Number(a.current_hours).toLocaleString()} hrs</span>}
                  {a.expected_consumption_lph != null && <span>{a.expected_consumption_lph} L/h</span>}
                </div>
                {a.fleet_asset_types?.name && (
                  <div style={{ marginTop: '8px' }}>
                    <span style={{
                      fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px',
                      background: color + '14', color,
                    }}>
                      {a.fleet_asset_types.name}
                    </span>
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
            background: THEME.surface, borderRadius: '16px', padding: '28px',
            width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '20px' }}>
              {editId ? 'Edit Equipment' : 'Add Equipment'}
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: THEME.statusErrorBg, color: THEME.statusErrorText, fontSize: '12px', marginBottom: '14px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0', marginBottom: '20px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
              {TABS.map((tab, i) => (
                <button key={tab} onClick={() => setActiveTab(i)} style={{
                  padding: '8px 16px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: activeTab === i ? color : THEME.textMed,
                  borderBottom: activeTab === i ? `2px solid ${color}` : '2px solid transparent',
                  marginBottom: '-1px',
                }}>
                  {tab}
                </button>
              ))}
            </div>

            {activeTab === 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={lbl}>Equipment Type *</div>
                  <select value={form.asset_type_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })} style={inp}>
                    <option value="">Select type...</option>
                    {heavyTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={lbl}>Asset Number *</div>
                  <input value={form.asset_number} onChange={e => setForm({ ...form, asset_number: e.target.value })} placeholder="HE-001" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Description *</div>
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="CAT 320 Excavator" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Registration</div>
                  <input value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Fleet Number</div>
                  <input value={form.fleet_number} onChange={e => setForm({ ...form, fleet_number: e.target.value })} placeholder="FLT-001" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Serial Number</div>
                  <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Make</div>
                  <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="Caterpillar" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Model</div>
                  <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="320F" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Year</div>
                  <input type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="2023" style={inp} />
                </div>
              </div>
            )}

            {activeTab === 1 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <div style={lbl}>Status</div>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp}>
                    {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div>
                  <div style={lbl}>Department</div>
                  <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })} style={inp}>
                    <option value="">None</option>
                    {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={lbl}>Assigned Project</div>
                  <input value={form.assigned_project} onChange={e => setForm({ ...form, assigned_project: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Cost Center</div>
                  <input value={form.cost_center} onChange={e => setForm({ ...form, cost_center: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Current Hours</div>
                  <input type="number" value={form.current_hours} onChange={e => setForm({ ...form, current_hours: e.target.value })} placeholder="0" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Expected Consumption (L/h)</div>
                  <input type="number" value={form.expected_consumption_lph} onChange={e => setForm({ ...form, expected_consumption_lph: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Tank Capacity (L)</div>
                  <input type="number" value={form.tank_capacity_litres} onChange={e => setForm({ ...form, tank_capacity_litres: e.target.value })} style={inp} />
                </div>
              </div>
            )}

            {activeTab === 2 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <div style={lbl}>Purchase Date</div>
                  <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Purchase Cost</div>
                  <input type="number" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} placeholder="0.00" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Salvage Value</div>
                  <input type="number" value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} placeholder="0.00" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Useful Life (months)</div>
                  <input type="number" value={form.useful_life_months} onChange={e => setForm({ ...form, useful_life_months: e.target.value })} placeholder="120" style={inp} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: editId ? 'space-between' : 'flex-end', marginTop: '20px', gap: '10px' }}>
              {editId && can('fleet.delete') && (
                <button onClick={() => handleArchive(editId)} style={{
                  padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  background: THEME.statusErrorBg, color: THEME.statusErrorText,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Archive
                </button>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => setModalOpen(false)} style={{
                  padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  padding: '8px 22px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff',
                  border: 'none', cursor: saving ? 'wait' : 'pointer', fontFamily: 'inherit',
                  opacity: saving ? 0.7 : 1,
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
