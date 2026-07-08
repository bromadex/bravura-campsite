import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'

const color = MODULE_COLORS.fleet

const STATUS_MAP = {
  operational:      { label: 'Operational',     bg: THEME.statusSuccessBg,   text: THEME.statusSuccessText },
  maintenance:      { label: 'Maintenance',     bg: THEME.statusWarningBg,   text: THEME.statusWarningText },
  grounded:         { label: 'Grounded',        bg: THEME.statusErrorBg,     text: THEME.statusErrorText },
  awaiting_parts:   { label: 'Awaiting Parts',  bg: THEME.statusTertiaryBg,  text: THEME.statusTertiaryText },
  decommissioned:   { label: 'Decommissioned',  bg: THEME.statusNeutralBg,   text: THEME.statusNeutralText },
}

const CATEGORY_ICONS = {
  vehicle: 'directions_car',
  heavy_equipment: 'construction',
  generator: 'bolt',
  pump: 'water_pump',
  trailer: 'local_shipping',
  other: 'widgets',
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

const EMPTY_FORM = {
  asset_type_id: '', asset_number: '', description: '', registration: '',
  vin: '', serial_number: '', fleet_number: '',
  year: '', make: '', model: '',
  tank_capacity_litres: '', department_id: '', status: 'operational',
}

export default function FleetAssets({ setPage }) {
  const { can } = usePermissions()
  const { assets, assetTypes, departments, loading, addAsset, updateAsset, archiveAsset } = useFleet()

  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [viewMode, setViewMode] = useState('card')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const categories = useMemo(() => {
    const cats = new Set(assetTypes.map(t => t.category))
    return [...cats].sort()
  }, [assetTypes])

  const filtered = useMemo(() => {
    let list = assets
    if (filterCategory !== 'all') list = list.filter(a => a.fleet_asset_types?.category === filterCategory)
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus)
    if (filterDept !== 'all') list = list.filter(a => a.department_id === filterDept)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        (a.asset_number || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q) ||
        (a.registration || '').toLowerCase().includes(q) ||
        (a.make || '').toLowerCase().includes(q) ||
        (a.model || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [assets, filterCategory, filterStatus, filterDept, search])

  function openAdd() {
    setEditId(null)
    setForm(EMPTY_FORM)
    setError('')
    setModalOpen(true)
  }

  function openEdit(asset) {
    setEditId(asset.id)
    setForm({
      asset_type_id: asset.asset_type_id || '',
      asset_number: asset.asset_number || '',
      description: asset.description || '',
      registration: asset.registration || '',
      vin: asset.vin || '',
      serial_number: asset.serial_number || '',
      fleet_number: asset.fleet_number || '',
      year: asset.year || '',
      make: asset.make || '',
      model: asset.model || '',
      tank_capacity_litres: asset.tank_capacity_litres || '',
      department_id: asset.department_id || '',
      status: asset.status || 'operational',
    })
    setError('')
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

  async function handleArchive(id) {
    if (!confirm('Archive this asset? It will be marked as decommissioned.')) return
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

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_assets" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Fleet Assets</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} asset{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* View toggle */}
          {['card', 'table'].map(v => (
            <button key={v} onClick={() => setViewMode(v)} style={{
              padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outlineVar}`,
              background: viewMode === v ? color + '18' : THEME.surface,
              color: viewMode === v ? color : THEME.textMed, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>
                {v === 'card' ? 'grid_view' : 'table_rows'}
              </span>
            </button>
          ))}
          {can('fleet.create') && (
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              Add Asset
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search assets…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
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

      {/* Asset list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>inventory_2</span>
          <div style={{ fontSize: '14px' }}>No assets found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new asset</div>
        </div>
      ) : viewMode === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
          {filtered.map(a => {
            const catIcon = CATEGORY_ICONS[a.fleet_asset_types?.category] || 'widgets'
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
                  <div style={{
                    width: '42px', height: '42px', borderRadius: '12px', flexShrink: 0,
                    background: color + '18',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>{catIcon}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.description}
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                      {a.asset_number}{a.registration ? ` · ${a.registration}` : ''}
                    </div>
                  </div>
                  <StatusBadge status={a.status} />
                </div>
                <div style={{ display: 'flex', gap: '16px', marginTop: '12px', fontSize: '12px', color: THEME.textMed }}>
                  {a.make && <span>{a.make} {a.model || ''}</span>}
                  {a.year && <span>{a.year}</span>}
                  {a.departments?.name && <span>{a.departments.name}</span>}
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
      ) : (
        /* Table view */
        <div style={{ overflowX: 'auto', borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Number', 'Description', 'Type', 'Registration', 'Make/Model', 'Status', 'Department'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr
                  key={a.id}
                  onClick={() => can('fleet.edit') ? openEdit(a) : null}
                  style={{ cursor: can('fleet.edit') ? 'pointer' : 'default', borderBottom: `1px solid ${THEME.outlineVar}` }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceHover}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <td style={{ padding: '10px 14px', fontWeight: 600, color }}>{a.asset_number}</td>
                  <td style={{ padding: '10px 14px', color: THEME.text }}>{a.description}</td>
                  <td style={{ padding: '10px 14px', color: THEME.textMed }}>{a.fleet_asset_types?.name || '—'}</td>
                  <td style={{ padding: '10px 14px', color: THEME.textMed }}>{a.registration || '—'}</td>
                  <td style={{ padding: '10px 14px', color: THEME.textMed }}>{[a.make, a.model].filter(Boolean).join(' ') || '—'}</td>
                  <td style={{ padding: '10px 14px' }}><StatusBadge status={a.status} /></td>
                  <td style={{ padding: '10px 14px', color: THEME.textMed }}>{a.departments?.name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={() => setModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: THEME.surface, borderRadius: '16px', padding: '28px',
            width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '20px' }}>
              {editId ? 'Edit Asset' : 'Add Asset'}
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: THEME.statusErrorBg, color: THEME.statusErrorText, fontSize: '12px', marginBottom: '14px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={lbl}>Asset Type *</div>
                <select value={form.asset_type_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })} style={inp}>
                  <option value="">Select type…</option>
                  {assetTypes.map(t => <option key={t.id} value={t.id}>{t.name} ({t.category.replace(/_/g, ' ')})</option>)}
                </select>
              </div>
              <div>
                <div style={lbl}>Asset Number *</div>
                <input value={form.asset_number} onChange={e => setForm({ ...form, asset_number: e.target.value })} placeholder="FA-001" style={inp} />
              </div>
              <div>
                <div style={lbl}>Description *</div>
                <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Toyota Hilux D4D" style={inp} />
              </div>
              <div>
                <div style={lbl}>Registration</div>
                <input value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value })} placeholder="ABC 123 GP" style={inp} />
              </div>
              <div>
                <div style={lbl}>Fleet Number</div>
                <input value={form.fleet_number} onChange={e => setForm({ ...form, fleet_number: e.target.value })} placeholder="FLT-001" style={inp} />
              </div>
              <div>
                <div style={lbl}>VIN</div>
                <input value={form.vin} onChange={e => setForm({ ...form, vin: e.target.value })} style={inp} />
              </div>
              <div>
                <div style={lbl}>Serial Number</div>
                <input value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} style={inp} />
              </div>
              <div>
                <div style={lbl}>Make</div>
                <input value={form.make} onChange={e => setForm({ ...form, make: e.target.value })} placeholder="Toyota" style={inp} />
              </div>
              <div>
                <div style={lbl}>Model</div>
                <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} placeholder="Hilux" style={inp} />
              </div>
              <div>
                <div style={lbl}>Year</div>
                <input type="number" value={form.year} onChange={e => setForm({ ...form, year: e.target.value })} placeholder="2023" style={inp} />
              </div>
              <div>
                <div style={lbl}>Tank Capacity (L)</div>
                <input type="number" value={form.tank_capacity_litres} onChange={e => setForm({ ...form, tank_capacity_litres: e.target.value })} style={inp} />
              </div>
              <div>
                <div style={lbl}>Department</div>
                <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })} style={inp}>
                  <option value="">None</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <div style={lbl}>Status</div>
                <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp}>
                  {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </div>

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
                  {saving ? 'Saving…' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
