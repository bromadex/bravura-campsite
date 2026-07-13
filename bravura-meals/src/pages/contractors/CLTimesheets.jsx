import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'

const color = MODULE_COLORS.contractors

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function calcHours(clockIn, clockOut, breakMinutes) {
  if (!clockIn || !clockOut) return 0
  const [ih, im] = clockIn.split(':').map(Number)
  const [oh, om] = clockOut.split(':').map(Number)
  let mins = (oh * 60 + om) - (ih * 60 + im)
  if (mins < 0) mins += 24 * 60
  mins -= Number(breakMinutes || 0)
  return Math.max(0, mins / 60)
}

const EMPTY_ROW_FORM = {
  casual_worker_id: '', contractor_id: '', contract_id: '', date: todayStr(),
  shift: '', clock_in: '', clock_out: '', break_minutes: '0',
  hours_worked: '0', overtime_hours: '0', supervisor_id: '', notes: '',
}

export default function CLTimesheets() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [items, setItems] = useState([])
  const [casualWorkers, setCasualWorkers] = useState([])
  const [contractors, setContractors] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(todayStr())
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_ROW_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // bulk entry
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkDate, setBulkDate] = useState(todayStr())
  const [bulkRows, setBulkRows] = useState([])
  const [bulkSaving, setBulkSaving] = useState(false)

  async function fetchItems() {
    if (!currentSiteId) return
    setLoading(true)
    let q = supabase
      .from('casual_timesheets')
      .select('*, casual_worker:casual_workers(id, name, rate, rate_type, overtime_rate), contractor:contractors(id, name)')
      .eq('site_id', currentSiteId)
      .order('date', { ascending: false })
    if (dateFilter) q = q.eq('date', dateFilter)
    const { data, error: err } = await q
    if (!err) setItems(data || [])
    else showToast(err.message, 'red')
    setLoading(false)
  }

  async function fetchLookups() {
    if (!currentSiteId) return
    const [cw, cs, emp] = await Promise.all([
      supabase.from('casual_workers').select('id, name, rate, rate_type, overtime_rate, contractor_id').eq('site_id', currentSiteId).eq('status', 'working').order('name'),
      supabase.from('contractors').select('id, name').eq('is_archived', false).order('name'),
      supabase.from('employees').select('id, name').eq('site_id', currentSiteId).order('name'),
    ])
    setCasualWorkers(cw.data || [])
    setContractors(cs.data || [])
    setEmployees(emp.data || [])
  }

  useEffect(() => { fetchItems() }, [currentSiteId, dateFilter])
  useEffect(() => { fetchLookups() }, [currentSiteId])

  function workerRate(workerId) {
    return casualWorkers.find(w => w.id === workerId)
  }

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_ROW_FORM, date: dateFilter || todayStr() })
    setError('')
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditId(item.id)
    setForm({
      casual_worker_id: item.casual_worker_id || '',
      contractor_id: item.contractor_id || '',
      contract_id: item.contract_id || '',
      date: item.date || todayStr(),
      shift: item.shift || '',
      clock_in: item.clock_in || '',
      clock_out: item.clock_out || '',
      break_minutes: String(item.break_minutes ?? 0),
      hours_worked: String(item.hours_worked ?? 0),
      overtime_hours: String(item.overtime_hours ?? 0),
      supervisor_id: item.supervisor_id || '',
      notes: item.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  const set = (k, v) => setForm(f => {
    const next = { ...f, [k]: v }
    if (['clock_in', 'clock_out', 'break_minutes'].includes(k)) {
      next.hours_worked = calcHours(next.clock_in, next.clock_out, next.break_minutes).toFixed(2)
    }
    if (k === 'casual_worker_id') {
      const w = workerRate(v)
      if (w) next.contractor_id = w.contractor_id || next.contractor_id
    }
    return next
  })

  function computeCosts(f) {
    const w = workerRate(f.casual_worker_id)
    const rate = Number(w?.rate || 0)
    const otRate = Number(w?.overtime_rate || rate * 1.5)
    const hours = Number(f.hours_worked || 0)
    const otHours = Number(f.overtime_hours || 0)
    const normal_cost = +(hours * rate).toFixed(2)
    const overtime_cost = +(otHours * otRate).toFixed(2)
    const total_cost = +(normal_cost + overtime_cost).toFixed(2)
    return { normal_cost, overtime_cost, total_cost }
  }

  async function handleSave() {
    if (!form.casual_worker_id || !form.date) {
      setError('Worker and date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const costs = computeCosts(form)
      const payload = {
        site_id: currentSiteId,
        casual_worker_id: form.casual_worker_id,
        contractor_id: form.contractor_id || null,
        contract_id: form.contract_id || null,
        date: form.date,
        shift: form.shift || null,
        clock_in: form.clock_in || null,
        clock_out: form.clock_out || null,
        break_minutes: Number(form.break_minutes || 0),
        hours_worked: Number(form.hours_worked || 0),
        overtime_hours: Number(form.overtime_hours || 0),
        ...costs,
        supervisor_id: form.supervisor_id || null,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('casual_timesheets').update(payload).eq('id', editId)
        if (err) throw err
        showToast('Timesheet updated', 'green')
      } else {
        const { error: err } = await supabase.from('casual_timesheets').insert(payload)
        if (err) throw err
        showToast('Timesheet added', 'green')
      }
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleApproval(item) {
    try {
      const payload = item.approved
        ? { approved: false, approved_by: null, approved_at: null }
        : { approved: true, approved_by: null, approved_at: new Date().toISOString() }
      const { error: err } = await supabase.from('casual_timesheets').update(payload).eq('id', item.id)
      if (err) throw err
      await fetchItems()
      showToast(item.approved ? 'Approval removed' : 'Timesheet approved', 'green')
    } catch (err) {
      showToast(err.message, 'red')
    }
  }

  // Bulk entry
  function openBulk() {
    setBulkDate(dateFilter || todayStr())
    setBulkRows([{ casual_worker_id: '', clock_in: '', clock_out: '', break_minutes: '0' }])
    setBulkOpen(true)
  }

  function addBulkRow() {
    setBulkRows(r => [...r, { casual_worker_id: '', clock_in: '', clock_out: '', break_minutes: '0' }])
  }

  function updateBulkRow(i, k, v) {
    setBulkRows(rows => rows.map((r, idx) => idx === i ? { ...r, [k]: v } : r))
  }

  function removeBulkRow(i) {
    setBulkRows(rows => rows.filter((_, idx) => idx !== i))
  }

  async function saveBulk() {
    const validRows = bulkRows.filter(r => r.casual_worker_id)
    if (validRows.length === 0) {
      showToast('Add at least one worker', 'red')
      return
    }
    setBulkSaving(true)
    try {
      const payloads = validRows.map(r => {
        const hours = calcHours(r.clock_in, r.clock_out, r.break_minutes)
        const w = workerRate(r.casual_worker_id)
        const rate = Number(w?.rate || 0)
        const normal_cost = +(hours * rate).toFixed(2)
        return {
          site_id: currentSiteId,
          casual_worker_id: r.casual_worker_id,
          contractor_id: w?.contractor_id || null,
          date: bulkDate,
          clock_in: r.clock_in || null,
          clock_out: r.clock_out || null,
          break_minutes: Number(r.break_minutes || 0),
          hours_worked: +hours.toFixed(2),
          overtime_hours: 0,
          normal_cost,
          overtime_cost: 0,
          total_cost: normal_cost,
        }
      })
      const { error: err } = await supabase.from('casual_timesheets').insert(payloads)
      if (err) throw err
      showToast(`${payloads.length} timesheets added`, 'green')
      setBulkOpen(false)
      await fetchItems()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setBulkSaving(false)
    }
  }

  const totals = useMemo(() => ({
    hours: items.reduce((s, i) => s + Number(i.hours_worked || 0), 0),
    cost: items.reduce((s, i) => s + Number(i.total_cost || 0), 0),
    pending: items.filter(i => !i.approved).length,
  }), [items])

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <div style={{ background: THEME.surface, borderRadius: '14px', padding: '14px 18px', border: `1px solid ${THEME.outlineVar}`, flex: '1 1 160px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{totals.hours.toFixed(1)}</div>
          <div style={{ fontSize: '11px', color: THEME.textLow }}>Total Hours</div>
        </div>
        <div style={{ background: THEME.surface, borderRadius: '14px', padding: '14px 18px', border: `1px solid ${THEME.outlineVar}`, flex: '1 1 160px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{totals.cost.toFixed(2)}</div>
          <div style={{ fontSize: '11px', color: THEME.textLow }}>Total Cost</div>
        </div>
        <div style={{ background: THEME.surface, borderRadius: '14px', padding: '14px 18px', border: `1px solid ${THEME.outlineVar}`, flex: '1 1 160px' }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: totals.pending > 0 ? '#D97706' : THEME.text }}>{totals.pending}</div>
          <div style={{ fontSize: '11px', color: THEME.textLow }}>Pending Approval</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Casual Timesheets</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{items.length} record{items.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={{ ...inp, maxWidth: '160px' }} />
          {can('contractors.create') && (
            <>
              <button onClick={openBulk} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: THEME.surfaceVar, color: THEME.textMed,
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>playlist_add</span>
                Bulk Entry
              </button>
              <button onClick={openAdd} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
                Add Entry
              </button>
            </>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>schedule</span>
          <div style={{ fontSize: '14px' }}>No timesheets for this date</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Worker', 'Contractor', 'Clock In', 'Clock Out', 'Hours', 'OT Hours', 'Total Cost', 'Approved', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(d => (
                <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td onClick={() => can('contractors.edit') ? openEdit(d) : null} style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text, cursor: can('contractors.edit') ? 'pointer' : 'default' }}>{d.casual_worker?.name || '-'}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.contractor?.name || '-'}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.clock_in || '-'}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.clock_out || '-'}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{Number(d.hours_worked || 0).toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{Number(d.overtime_hours || 0).toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{Number(d.total_cost || 0).toFixed(2)}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '6px',
                      background: d.approved ? THEME.statusSuccessBg : THEME.statusWarningBg,
                      color: d.approved ? THEME.statusSuccessText : THEME.statusWarningText,
                    }}>{d.approved ? 'Approved' : 'Pending'}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {can('contractors.edit') && (
                      <button onClick={() => toggleApproval(d)} style={{
                        padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                        background: THEME.surfaceVar, color: THEME.textMed,
                        border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                      }}>
                        {d.approved ? 'Unapprove' : 'Approve'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '600px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Timesheet' : 'Add Timesheet'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Casual Worker *</label>
                  <select style={inp} value={form.casual_worker_id} onChange={e => set('casual_worker_id', e.target.value)}>
                    <option value="">-- Select --</option>
                    {casualWorkers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Date *</label>
                  <input style={inp} type="date" value={form.date} onChange={e => set('date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Shift</label>
                  <input style={inp} value={form.shift} onChange={e => set('shift', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Clock In</label>
                  <input style={inp} type="time" value={form.clock_in} onChange={e => set('clock_in', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Clock Out</label>
                  <input style={inp} type="time" value={form.clock_out} onChange={e => set('clock_out', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Break Minutes</label>
                  <input style={inp} type="number" min="0" value={form.break_minutes} onChange={e => set('break_minutes', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Hours Worked</label>
                  <input style={inp} type="number" step="0.01" value={form.hours_worked} onChange={e => set('hours_worked', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Overtime Hours</label>
                  <input style={inp} type="number" step="0.01" value={form.overtime_hours} onChange={e => set('overtime_hours', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Supervisor</label>
                  <select style={inp} value={form.supervisor_id} onChange={e => set('supervisor_id', e.target.value)}>
                    <option value="">-- None --</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1', fontSize: '12px', color: THEME.textMed }}>
                  Estimated cost: {computeCosts(form).total_cost.toFixed(2)}
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
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
      )}

      {bulkOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setBulkOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '700px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>Bulk Timesheet Entry</div>
              <button onClick={() => setBulkOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>
            <div style={{ padding: '16px 24px 0' }}>
              <label style={lbl}>Date</label>
              <input style={{ ...inp, maxWidth: '200px' }} type="date" value={bulkDate} onChange={e => setBulkDate(e.target.value)} />
            </div>
            <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
              {bulkRows.map((r, i) => {
                const hours = calcHours(r.clock_in, r.clock_out, r.break_minutes)
                return (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                    <select style={{ ...inp, flex: '2' }} value={r.casual_worker_id} onChange={e => updateBulkRow(i, 'casual_worker_id', e.target.value)}>
                      <option value="">-- Worker --</option>
                      {casualWorkers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <input style={{ ...inp, flex: '1' }} type="time" value={r.clock_in} onChange={e => updateBulkRow(i, 'clock_in', e.target.value)} />
                    <input style={{ ...inp, flex: '1' }} type="time" value={r.clock_out} onChange={e => updateBulkRow(i, 'clock_out', e.target.value)} />
                    <input style={{ ...inp, flex: '1' }} type="number" min="0" placeholder="Break" value={r.break_minutes} onChange={e => updateBulkRow(i, 'break_minutes', e.target.value)} />
                    <div style={{ fontSize: '12px', color: THEME.textMed, width: '48px', textAlign: 'right' }}>{hours.toFixed(1)}h</div>
                    <button onClick={() => removeBulkRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.error }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>delete</span>
                    </button>
                  </div>
                )
              })}
              <button onClick={addBulkRow} style={{
                marginTop: '4px', padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                + Add Row
              </button>
            </div>
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setBulkOpen(false)} style={{
                padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: THEME.surfaceVar, color: THEME.textMed,
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Cancel
              </button>
              <button onClick={saveBulk} disabled={bulkSaving} style={{
                padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: color, color: '#fff',
                border: 'none', cursor: bulkSaving ? 'not-allowed' : 'pointer',
                opacity: bulkSaving ? 0.6 : 1, fontFamily: 'inherit',
              }}>
                {bulkSaving ? 'Saving...' : 'Save All'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
