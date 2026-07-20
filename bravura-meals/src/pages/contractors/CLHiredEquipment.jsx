import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast, ModalOverlay } from '../../components/ui'
import QuickNav, { CONTRACTOR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.contractors

const STATUSES = ['active', 'returned', 'maintenance']
const STATUS_COLORS = {
  active:      { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'Active' },
  returned:    { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Returned' },
  maintenance: { bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'Maintenance' },
}

const EMPTY_FORM = {
  contractor_id: '', contract_id: '', description: '', equipment_type: '',
  serial_number: '', daily_rate: '', hourly_rate: '',
  fuel_included: false, operator_included: false,
  status: 'active', start_date: '', end_date: '', notes: '',
}

function daysActive(start, end) {
  if (!start) return 0
  const s = new Date(start)
  const e = end ? new Date(end) : new Date()
  return Math.max(0, Math.round((e - s) / 86400000))
}

export default function CLHiredEquipment({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('hired_equipment', { column: 'site_id', value: currentSiteId }, fetchItems)

  const [items, setItems] = useState([])
  const [contractors, setContractors] = useState([])
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchItems() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('hired_equipment')
      .select('*, contractor:contractors(id, name)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (!err) setItems(data || [])
    else showToast(err.message, 'red')
    setLoading(false)
  }

  async function fetchLookups() {
    if (!currentSiteId) return
    const [c1, c2] = await Promise.all([
      supabase.from('contractors').select('id, name').eq('is_archived', false).or(`site_id.eq.${currentSiteId},site_id.is.null`).order('name'),
      supabase.from('contractor_contracts').select('id, contract_number, title').eq('site_id', currentSiteId).order('created_at', { ascending: false }),
    ])
    setContractors(c1.data || [])
    setContracts(c2.data || [])
  }

  useEffect(() => { fetchItems(); fetchLookups() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = items
    if (filterStatus !== 'all') list = list.filter(d => d.status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        (d.description || '').toLowerCase().includes(q) ||
        (d.serial_number || '').toLowerCase().includes(q) ||
        (d.contractor?.name || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, filterStatus, search])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditId(item.id)
    const f = {}
    for (const k of Object.keys(EMPTY_FORM)) f[k] = item[k] ?? EMPTY_FORM[k]
    setForm(f)
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.contractor_id || !form.description || !form.start_date) {
      setError('Contractor, description and start date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        contractor_id: form.contractor_id,
        contract_id: form.contract_id || null,
        description: form.description,
        equipment_type: form.equipment_type || null,
        serial_number: form.serial_number || null,
        daily_rate: form.daily_rate ? parseFloat(form.daily_rate) : null,
        hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
        fuel_included: !!form.fuel_included,
        operator_included: !!form.operator_included,
        status: form.status,
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('hired_equipment').update(payload).eq('id', editId)
        if (err) throw err
        showToast('Hired equipment updated', 'green')
      } else {
        const { error: err } = await supabase.from('hired_equipment').insert(payload)
        if (err) throw err
        showToast('Hired equipment added', 'green')
      }
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this hired equipment record?')) return
    try {
      const { error: err } = await supabase.from('hired_equipment').update({ is_archived: true }).eq('id', editId)
      if (err) throw err
      showToast('Hired equipment archived', 'green')
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      showToast(err.message, 'red')
    }
  }

  async function handleReturn(id) {
    if (!confirm('Mark this equipment as returned?')) return
    try {
      const { error: err } = await supabase.from('hired_equipment').update({
        status: 'returned', end_date: new Date().toISOString().slice(0, 10),
      }).eq('id', id)
      if (err) throw err
      showToast('Equipment marked returned', 'green')
      await fetchItems()
    } catch (err) {
      showToast(err.message, 'red')
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

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Hired Equipment</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} item{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('contractors.create') && (
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

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input placeholder="Search description, serial or contractor..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>construction</span>
          <div style={{ fontSize: '14px' }}>No hired equipment found</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Contractor', 'Description', 'Serial', 'Type', 'Daily Rate', 'Days Active', 'Est. Cost', 'Status', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const sc = STATUS_COLORS[d.status] || STATUS_COLORS.active
                const da = daysActive(d.start_date, d.end_date)
                const est = d.daily_rate ? (Number(d.daily_rate) * da).toFixed(2) : '-'
                return (
                  <tr key={d.id}
                    onClick={() => can('contractors.edit') ? openEdit(d) : null}
                    style={{ cursor: can('contractors.edit') ? 'pointer' : 'default', borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>{d.contractor?.name || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{d.description}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.serial_number || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.equipment_type || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.daily_rate != null ? Number(d.daily_rate).toFixed(2) : '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{da}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{est}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '6px', background: sc.bg, color: sc.text }}>{sc.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {d.status === 'active' && can('contractors.edit') && (
                        <button onClick={e => { e.stopPropagation(); handleReturn(d.id) }} style={{
                          padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                          background: THEME.surfaceVar, color: THEME.textMed,
                          border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                        }}>
                          Return
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '640px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
      <QuickNav pills={CONTRACTOR_PILLS} setPage={setPage} current="cl_equipment" />
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Hired Equipment' : 'Add Hired Equipment'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={fieldWrap}>
                  <label style={lbl}>Contractor *</label>
                  <select style={inp} value={form.contractor_id} onChange={e => set('contractor_id', e.target.value)}>
                    <option value="">-- Select --</option>
                    {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Contract</label>
                  <select style={inp} value={form.contract_id} onChange={e => set('contract_id', e.target.value)}>
                    <option value="">-- None --</option>
                    {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_number || c.title}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Description *</label>
                  <input style={inp} value={form.description} onChange={e => set('description', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Equipment Type</label>
                  <input style={inp} value={form.equipment_type} onChange={e => set('equipment_type', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Serial Number</label>
                  <input style={inp} value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Daily Rate</label>
                  <input style={inp} type="number" step="0.01" value={form.daily_rate} onChange={e => set('daily_rate', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Hourly Rate</label>
                  <input style={inp} type="number" step="0.01" value={form.hourly_rate} onChange={e => set('hourly_rate', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Start Date *</label>
                  <input style={inp} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>End Date</label>
                  <input style={inp} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '8px', marginTop: '22px' }}>
                  <input type="checkbox" checked={form.fuel_included} onChange={e => set('fuel_included', e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: color }} />
                  <label style={{ fontSize: '13px', color: THEME.text, cursor: 'pointer' }} onClick={() => set('fuel_included', !form.fuel_included)}>Fuel Included</label>
                </div>
                <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '8px', marginTop: '22px' }}>
                  <input type="checkbox" checked={form.operator_included} onChange={e => set('operator_included', e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: color }} />
                  <label style={{ fontSize: '13px', color: THEME.text, cursor: 'pointer' }} onClick={() => set('operator_included', !form.operator_included)}>Operator Included</label>
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                {editId && can('contractors.delete') && (
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
        </ModalOverlay>
      )}
    </div>
  )
}
