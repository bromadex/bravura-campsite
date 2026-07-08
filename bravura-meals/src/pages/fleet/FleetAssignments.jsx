import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'

const color = MODULE_COLORS.fleet

const TYPE_MAP = {
  permanent: { label: 'Permanent', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  temporary: { label: 'Temporary', bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  pool:      { label: 'Pool',      bg: '#e8f0fe',             text: '#1a73e8' },
  standby:   { label: 'Standby',   bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const SHIFT_MAP = {
  day:     { label: 'Day',     bg: '#fef9e7', text: '#b7950b' },
  night:   { label: 'Night',   bg: '#e8eaf6', text: '#3949ab' },
  standby: { label: 'Standby', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const EMPTY_FORM = {
  asset_id: '', operator_id: '', department_id: '', cost_centre: '', project: '',
  shift: 'day', supervisor_id: '', assignment_type: 'permanent',
  start_date: '', end_date: '', reason: '', notes: '', is_active: true,
}

export default function FleetAssignments({ setPage }) {
  const { can } = usePermissions()
  const { assets, departments, assignments, loading, fetchAll } = useFleet()
  const { site } = useSite()

  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [filterShift, setFilterShift] = useState('all')
  const [filterDept, setFilterDept] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filtered = useMemo(() => {
    let list = assignments || []
    if (filterType !== 'all') list = list.filter(a => a.assignment_type === filterType)
    if (filterShift !== 'all') list = list.filter(a => a.shift === filterShift)
    if (filterDept !== 'all') list = list.filter(a => a.department_id === filterDept)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a => {
        const asset = a.fleet_assets
        return (asset?.asset_number || '').toLowerCase().includes(q) ||
               (asset?.description || '').toLowerCase().includes(q)
      })
    }
    return list
  }, [assignments, filterType, filterShift, filterDept, search])

  const kpis = useMemo(() => {
    const allAssignments = assignments || []
    const active = allAssignments.filter(a => a.is_active)
    const assignedAssetIds = new Set(active.map(a => a.asset_id))
    const allAssets = assets || []
    return {
      totalActive: active.length,
      permanent: active.filter(a => a.assignment_type === 'permanent').length,
      temporary: active.filter(a => a.assignment_type === 'temporary').length,
      unassigned: allAssets.filter(a => !assignedAssetIds.has(a.id)).length,
    }
  }, [assignments, assets])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(assignment) {
    setEditId(assignment.id)
    setForm({
      asset_id: assignment.asset_id || '',
      operator_id: assignment.operator_id || '',
      department_id: assignment.department_id || '',
      cost_centre: assignment.cost_centre || '',
      project: assignment.project || '',
      shift: assignment.shift || 'day',
      supervisor_id: assignment.supervisor_id || '',
      assignment_type: assignment.assignment_type || 'permanent',
      start_date: assignment.start_date || '',
      end_date: assignment.end_date || '',
      reason: assignment.reason || '',
      notes: assignment.notes || '',
      is_active: assignment.is_active !== false,
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_id) {
      setError('Asset is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        asset_id: form.asset_id,
        operator_id: form.operator_id || null,
        department_id: form.department_id || null,
        cost_centre: form.cost_centre || null,
        project: form.project || null,
        shift: form.shift,
        supervisor_id: form.supervisor_id || null,
        assignment_type: form.assignment_type,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        reason: form.reason || null,
        notes: form.notes || null,
        is_active: form.is_active,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_assignments').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_assignments').insert({ ...payload, site_id: site.id })
        if (err) throw err
      }
      await fetchAll()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleEndAssignment() {
    if (!confirm('End this assignment? It will be marked inactive.')) return
    try {
      const today = new Date().toISOString().split('T')[0]
      const { error: err } = await supabase.from('fleet_assignments')
        .update({ is_active: false, end_date: today })
        .eq('id', editId)
      if (err) throw err
      await fetchAll()
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

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Active', value: kpis.totalActive, icon: 'assignment', bg: color + '14', fg: color },
    { label: 'Permanent', value: kpis.permanent, icon: 'lock', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Temporary', value: kpis.temporary, icon: 'schedule', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Unassigned Assets', value: kpis.unassigned, icon: 'link_off', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
  ]

  const deptMap = useMemo(() => {
    const m = {}
    ;(departments || []).forEach(d => { m[d.id] = d.name })
    return m
  }, [departments])

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_assignments" />

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
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Assignments</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} assignment{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Add Assignment
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search assets..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Types</option>
          {Object.entries(TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterShift} onChange={e => setFilterShift(e.target.value)} style={{ ...inp, maxWidth: '140px' }}>
          <option value="all">All Shifts</option>
          {Object.entries(SHIFT_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ ...inp, maxWidth: '180px' }}>
          <option value="all">All Departments</option>
          {(departments || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>assignment</span>
          <div style={{ fontSize: '14px' }}>No assignments found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new assignment</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
          {filtered.map(a => {
            const asset = a.fleet_assets
            const typeStyle = TYPE_MAP[a.assignment_type] || TYPE_MAP.permanent
            const shiftStyle = SHIFT_MAP[a.shift] || SHIFT_MAP.day
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
                    <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>assignment</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {asset?.asset_number || 'Unknown Asset'}
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                      {asset?.description || ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <span style={{
                      width: '8px', height: '8px', borderRadius: '50%',
                      background: a.is_active ? THEME.statusSuccessText : THEME.statusNeutralText,
                      display: 'inline-block',
                    }} />
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                  <span style={{
                    display: 'inline-block', fontSize: '11px', fontWeight: 600,
                    padding: '2px 10px', borderRadius: '999px',
                    background: typeStyle.bg, color: typeStyle.text,
                  }}>
                    {typeStyle.label}
                  </span>
                  <span style={{
                    display: 'inline-block', fontSize: '11px', fontWeight: 600,
                    padding: '2px 10px', borderRadius: '999px',
                    background: shiftStyle.bg, color: shiftStyle.text,
                  }}>
                    {shiftStyle.label} Shift
                  </span>
                </div>

                <div style={{ display: 'flex', gap: '16px', marginTop: '10px', fontSize: '12px', color: THEME.textMed, flexWrap: 'wrap' }}>
                  {a.department_id && deptMap[a.department_id] && <span>{deptMap[a.department_id]}</span>}
                  {a.project && <span>{a.project}</span>}
                  {a.cost_centre && <span>{a.cost_centre}</span>}
                </div>

                <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '11px', color: THEME.textLow }}>
                  {a.start_date && <span>From: {a.start_date}</span>}
                  {a.end_date && <span>To: {a.end_date}</span>}
                </div>
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
                {editId ? 'Edit Assignment' : 'Add Assignment'}
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
                  <label style={lbl}>Asset *</label>
                  <select style={inp} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                    <option value="">-- Select Asset --</option>
                    {(assets || []).map(a => (
                      <option key={a.id} value={a.id}>
                        {a.asset_number}{a.description ? ` - ${a.description}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Assignment Type</label>
                  <select style={inp} value={form.assignment_type} onChange={e => set('assignment_type', e.target.value)}>
                    {Object.entries(TYPE_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Shift</label>
                  <select style={inp} value={form.shift} onChange={e => set('shift', e.target.value)}>
                    {Object.entries(SHIFT_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Department</label>
                  <select style={inp} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
                    <option value="">-- Select --</option>
                    {(departments || []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Cost Centre</label>
                  <input style={inp} value={form.cost_centre} onChange={e => set('cost_centre', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Project</label>
                  <input style={inp} value={form.project} onChange={e => set('project', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Operator ID</label>
                  <input style={inp} value={form.operator_id} onChange={e => set('operator_id', e.target.value)} placeholder="UUID" />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Supervisor ID</label>
                  <input style={inp} value={form.supervisor_id} onChange={e => set('supervisor_id', e.target.value)} placeholder="UUID" />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Start Date</label>
                  <input style={inp} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>End Date</label>
                  <input style={inp} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Reason</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.reason} onChange={e => set('reason', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
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
                      transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
                    }} />
                  </div>
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
                {editId && can('fleet.edit') && (
                  <button onClick={handleEndAssignment} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    End Assignment
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
