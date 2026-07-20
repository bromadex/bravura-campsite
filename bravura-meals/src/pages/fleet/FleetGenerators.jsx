import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { StatusBadge, ModalOverlay } from '../../components/ui'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'

const color = MODULE_COLORS.fleet

const STATUS_MAP = {
  operational:      { label: 'Operational',     dot: '#22c55e', bg: THEME.statusSuccessBg,   text: THEME.statusSuccessText },
  maintenance:      { label: 'Maintenance',     dot: '#f59e0b', bg: THEME.statusWarningBg,   text: THEME.statusWarningText },
  grounded:         { label: 'Grounded',        dot: '#b91c1c', bg: THEME.statusErrorBg,     text: THEME.statusErrorText },
  decommissioned:   { label: 'Decommissioned',  dot: '#9ca3af', bg: THEME.statusNeutralBg,   text: THEME.statusNeutralText },
}


const EMPTY_FORM = {
  asset_type_id: '', asset_number: '', description: '', registration: '',
  serial_number: '', make: '', model: '', year: '',
  status: 'operational', department_id: '', assigned_project: '',
  current_hours: '', expected_consumption_lph: '', tank_capacity_litres: '',
  purchase_date: '', purchase_cost: '', location: '', kva_rating: '',
  engine_type: '', engine_serial: '', alternator_make: '', alternator_model: '',
  alternator_serial: '', voltage: '', phase: '', frequency: '', rated_amps: '',
  power_factor: '', rpm: '', avr_type: '', cooling_method: '', notes: '',
}

export default function FleetGenerators({ setPage }) {
  const { can } = usePermissions()
  const { generators, assetTypes, departments, loading, addAsset, updateAsset, archiveAsset } = useFleet()

  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState(0)

  const generatorType = useMemo(() => assetTypes.find(t => t.category === 'generator'), [assetTypes])

  const filtered = useMemo(() => {
    let list = generators
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
  }, [generators, filterStatus, filterDept, search])

  const kpis = useMemo(() => {
    const total = generators.length
    const running = generators.filter(g => g.status === 'operational').length
    const stopped = generators.filter(g => g.status === 'decommissioned' || g.status === 'grounded').length
    const maintenance = generators.filter(g => g.status === 'maintenance').length
    return { total, running, stopped, maintenance }
  }, [generators])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM, asset_type_id: generatorType?.id || '' })
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
      make: asset.make || '',
      model: asset.model || '',
      year: asset.year || '',
      status: asset.status || 'operational',
      department_id: asset.department_id || '',
      assigned_project: asset.assigned_project || '',
      current_hours: asset.current_hours || '',
      expected_consumption_lph: asset.expected_consumption_lph || '',
      tank_capacity_litres: asset.tank_capacity_litres || '',
      purchase_date: asset.purchase_date || '',
      purchase_cost: asset.purchase_cost || '',
      location: asset.location || '',
      kva_rating: asset.kva_rating ?? '',
      engine_type: asset.engine_type || '',
      engine_serial: asset.engine_serial || '',
      alternator_make: asset.alternator_make || '',
      alternator_model: asset.alternator_model || '',
      alternator_serial: asset.alternator_serial || '',
      voltage: asset.voltage ?? '',
      phase: asset.phase ?? '',
      frequency: asset.frequency ?? '',
      rated_amps: asset.rated_amps ?? '',
      power_factor: asset.power_factor ?? '',
      rpm: asset.rpm ?? '',
      avr_type: asset.avr_type || '',
      cooling_method: asset.cooling_method || '',
      notes: asset.notes || '',
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
        tank_capacity_litres: form.tank_capacity_litres ? Number(form.tank_capacity_litres) : null,
        current_hours: form.current_hours ? Number(form.current_hours) : null,
        expected_consumption_lph: form.expected_consumption_lph ? Number(form.expected_consumption_lph) : null,
        purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
        department_id: form.department_id || null,
        purchase_date: form.purchase_date || null,
        assigned_project: form.assigned_project || null,
        location: form.location || null,
        kva_rating: form.kva_rating ? Number(form.kva_rating) : null,
        engine_type: form.engine_type || null,
        engine_serial: form.engine_serial || null,
        alternator_make: form.alternator_make || null,
        alternator_model: form.alternator_model || null,
        alternator_serial: form.alternator_serial || null,
        voltage: form.voltage ? Number(form.voltage) : null,
        phase: form.phase ? Number(form.phase) : null,
        frequency: form.frequency ? Number(form.frequency) : null,
        rated_amps: form.rated_amps ? Number(form.rated_amps) : null,
        power_factor: form.power_factor ? Number(form.power_factor) : null,
        rpm: form.rpm ? Number(form.rpm) : null,
        avr_type: form.avr_type || null,
        cooling_method: form.cooling_method || null,
        notes: form.notes || null,
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
    if (!confirm('Archive this generator? It will be marked as decommissioned.')) return
    try { await archiveAsset(id) } catch (err) { alert(err.message) }
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
    { label: 'Total Generators', value: kpis.total, icon: 'bolt', tileColor: color },
    { label: 'Running', value: kpis.running, icon: 'play_circle', tileColor: '#22c55e' },
    { label: 'Stopped', value: kpis.stopped, icon: 'cancel', tileColor: '#b91c1c' },
    { label: 'In Maintenance', value: kpis.maintenance, icon: 'build', tileColor: '#f59e0b' },
  ]

  const tabs = ['Identity', 'Operations', 'Specifications']

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_generators" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Fleet Generators</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} generator{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Add Generator
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {kpiTiles.map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '18px',
            border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '38px', height: '38px', borderRadius: '10px',
                background: k.tileColor + '18',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: k.tileColor }}>{k.icon}</span>
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
          placeholder="Search generators..."
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
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>bolt</span>
          <div style={{ fontSize: '14px' }}>No generators found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new generator</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {filtered.map(a => (
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
                <div style={{
                  width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                  background: color + '18',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>bolt</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.description || a.asset_number}
                  </div>
                  {(() => {
                    const detail = [a.make, a.model, a.year].filter(Boolean).join(' - ')
                    return detail ? (
                      <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {detail}
                      </div>
                    ) : null
                  })()}
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
                    {a.asset_number}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '12px' }}>
                <StatusBadge status={a.status} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px', fontSize: '12px' }}>
                <div>
                  <div style={{ color: THEME.textLow }}>kVA Rating</div>
                  <div style={{ color: THEME.text, fontWeight: 600 }}>{a.kva_rating ? `${a.kva_rating} kVA` : '--'}</div>
                </div>
                <div>
                  <div style={{ color: THEME.textLow }}>Location</div>
                  <div style={{ color: THEME.text, fontWeight: 600 }}>{a.location || '--'}</div>
                </div>
                <div>
                  <div style={{ color: THEME.textLow }}>Current Hours</div>
                  <div style={{ color: THEME.text, fontWeight: 600 }}>{a.current_hours ? `${Number(a.current_hours).toLocaleString()} hrs` : '--'}</div>
                </div>
                <div>
                  <div style={{ color: THEME.textLow }}>Consumption</div>
                  <div style={{ color: THEME.text, fontWeight: 600 }}>{a.expected_consumption_lph ? `${a.expected_consumption_lph} L/h` : '--'}</div>
                </div>
                <div>
                  <div style={{ color: THEME.textLow }}>Department</div>
                  <div style={{ color: THEME.text, fontWeight: 600 }}>{a.departments?.name || '--'}</div>
                </div>
              </div>
            </div>
          ))}
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
              {editId ? 'Edit Generator' : 'Add Generator'}
            </div>

            <div style={{ display: 'flex', gap: '0', marginBottom: '18px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
              {tabs.map((t, i) => (
                <button key={t} onClick={() => setActiveTab(i)} style={{
                  padding: '8px 20px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: activeTab === i ? color : THEME.textMed,
                  borderBottom: activeTab === i ? `2px solid ${color}` : '2px solid transparent',
                  marginBottom: '-1px',
                }}>
                  {t}
                </button>
              ))}
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: THEME.statusErrorBg, color: THEME.statusErrorText, fontSize: '12px', marginBottom: '14px' }}>
                {error}
              </div>
            )}

            {activeTab === 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={lbl}>Asset Type *</div>
                  <select value={form.asset_type_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })} style={inp}>
                    <option value="">Select type...</option>
                    {assetTypes.filter(t => t.category === 'generator').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <div style={lbl}>Asset Number *</div>
                  <input value={form.asset_number} onChange={e => setForm({ ...form, asset_number: e.target.value })} placeholder="GEN-001" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Description *</div>
                  <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="500kVA Cummins" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Registration</div>
                  <input value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Serial Number</div>
                  <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Make</div>
                  <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="Cummins" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Model</div>
                  <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="C500D5" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Year</div>
                  <input type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="2023" style={inp} />
                </div>
                <div>
                  <div style={lbl}>kVA Rating</div>
                  <input type="number" value={form.kva_rating} onChange={e => setForm({ ...form, kva_rating: e.target.value })} placeholder="500" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Location</div>
                  <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Main Plant Room" style={inp} />
                </div>
              </div>
            )}

            {activeTab === 2 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1', fontSize: '12px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Engine</div>
                <div>
                  <div style={lbl}>Engine Type</div>
                  <input value={form.engine_type} onChange={e => setForm({ ...form, engine_type: e.target.value })} placeholder="e.g. 4-cyl air-cooled diesel" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Engine Serial</div>
                  <input value={form.engine_serial} onChange={e => setForm({ ...form, engine_serial: e.target.value })} style={inp} />
                </div>
                <div style={{ gridColumn: '1 / -1', fontSize: '12px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '8px' }}>Alternator</div>
                <div>
                  <div style={lbl}>Make</div>
                  <input value={form.alternator_make} onChange={e => setForm({ ...form, alternator_make: e.target.value })} placeholder="e.g. Wuxi Werna" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Model</div>
                  <input value={form.alternator_model} onChange={e => setForm({ ...form, alternator_model: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Serial Number</div>
                  <input value={form.alternator_serial} onChange={e => setForm({ ...form, alternator_serial: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>AVR Type</div>
                  <input value={form.avr_type} onChange={e => setForm({ ...form, avr_type: e.target.value })} placeholder="e.g. SX460" style={inp} />
                </div>
                <div style={{ gridColumn: '1 / -1', fontSize: '12px', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '8px' }}>Electrical Ratings</div>
                <div>
                  <div style={lbl}>Voltage (V)</div>
                  <input type="number" value={form.voltage} onChange={e => setForm({ ...form, voltage: e.target.value })} placeholder="380" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Phase</div>
                  <select value={form.phase} onChange={e => setForm({ ...form, phase: e.target.value })} style={inp}>
                    <option value="">—</option>
                    <option value="1">Single Phase</option>
                    <option value="3">Three Phase</option>
                  </select>
                </div>
                <div>
                  <div style={lbl}>Frequency (Hz)</div>
                  <input type="number" value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} placeholder="50" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Rated Amps (A)</div>
                  <input type="number" value={form.rated_amps} onChange={e => setForm({ ...form, rated_amps: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Power Factor</div>
                  <input type="number" step="0.01" value={form.power_factor} onChange={e => setForm({ ...form, power_factor: e.target.value })} placeholder="0.8" style={inp} />
                </div>
                <div>
                  <div style={lbl}>RPM</div>
                  <input type="number" value={form.rpm} onChange={e => setForm({ ...form, rpm: e.target.value })} placeholder="1500" style={inp} />
                </div>
                <div>
                  <div style={lbl}>Cooling Method</div>
                  <input value={form.cooling_method} onChange={e => setForm({ ...form, cooling_method: e.target.value })} placeholder="e.g. IC01" style={inp} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={lbl}>Notes</div>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} />
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
                  <div style={lbl}>Current Hours</div>
                  <input type="number" value={form.current_hours} onChange={e => setForm({ ...form, current_hours: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Expected Consumption (L/h)</div>
                  <input type="number" value={form.expected_consumption_lph} onChange={e => setForm({ ...form, expected_consumption_lph: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Tank Capacity (L)</div>
                  <input type="number" value={form.tank_capacity_litres} onChange={e => setForm({ ...form, tank_capacity_litres: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Purchase Date</div>
                  <input type="date" value={form.purchase_date} onChange={e => setForm({ ...form, purchase_date: e.target.value })} style={inp} />
                </div>
                <div>
                  <div style={lbl}>Purchase Cost</div>
                  <input type="number" value={form.purchase_cost} onChange={e => setForm({ ...form, purchase_cost: e.target.value })} style={inp} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: editId ? 'space-between' : 'flex-end', marginTop: '20px', gap: '10px' }}>
              {editId && can('fleet.delete') && (
                <button onClick={() => { handleArchive(editId); setModalOpen(false) }} style={{
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
