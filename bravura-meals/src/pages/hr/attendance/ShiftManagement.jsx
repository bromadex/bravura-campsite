import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../../components/ui'

const ACCENT = MODULE_COLORS.workforce

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

const EMPTY_SHIFT = { name: '', code: '', start_time: '08:00', end_time: '17:00', is_night_shift: false }
const EMPTY_ASSIGNMENT = { employee_id: '', shift_id: '', start_date: '', end_date: '' }

function calcDuration(start, end) {
  if (!start || !end) return 0
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  let mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins < 0) mins += 24 * 60 // overnight
  return Math.round((mins / 60) * 100) / 100
}

export default function ShiftManagement() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [shifts, setShifts] = useState([])
  const [assignments, setAssignments] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const [showArchived, setShowArchived] = useState(false)
  const [shiftModal, setShiftModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_SHIFT)
  const [saving, setSaving] = useState(false)

  const [assignModal, setAssignModal] = useState(false)
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGNMENT)
  const [assignSearch, setAssignSearch] = useState('')

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [shiftRes, assignRes, empRes] = await Promise.all([
        supabase.from('shifts').select('*').eq('site_id', currentSiteId).order('name'),
        supabase.from('shift_assignments').select('*, employees(name), shifts(name, code)')
          .eq('site_id', currentSiteId).order('start_date', { ascending: false }),
        supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      ])
      if (shiftRes.error) throw shiftRes.error
      if (assignRes.error) throw assignRes.error
      if (empRes.error) throw empRes.error
      setShifts(shiftRes.data || [])
      setAssignments(assignRes.data || [])
      setEmployees(empRes.data || [])
    } catch (err) {
      console.error(err)
      showToast('Failed to load shift data', 'red')
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Gate (after all hooks) ────────────────────────────────────────────────
  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const canEdit = can('hr.edit')
  const duration = calcDuration(form.start_time, form.end_time)

  const visibleShifts = shifts.filter(s => showArchived || s.is_active !== false)

  function openAddShift() {
    setEditing(null)
    setForm(EMPTY_SHIFT)
    setShiftModal(true)
  }

  function openEditShift(s) {
    if (!canEdit) return
    setEditing(s)
    setForm({
      name: s.name || '',
      code: s.code || '',
      start_time: s.start_time || '08:00',
      end_time: s.end_time || '17:00',
      is_night_shift: !!s.is_night_shift,
    })
    setShiftModal(true)
  }

  async function saveShift() {
    if (!form.name.trim()) { showToast('Shift name is required', 'red'); return }
    if (!form.code.trim()) { showToast('Shift code is required', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        start_time: form.start_time,
        end_time: form.end_time,
        duration_hours: calcDuration(form.start_time, form.end_time),
        is_night_shift: form.is_night_shift,
      }
      if (editing) {
        const { error } = await supabase.from('shifts').update(payload).eq('id', editing.id)
        if (error) throw error
        showToast('Shift updated', 'green')
      } else {
        const { error } = await supabase.from('shifts').insert({ ...payload, site_id: currentSiteId, is_active: true })
        if (error) throw error
        showToast('Shift added', 'green')
      }
      setShiftModal(false)
      fetchAll()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function archiveShift() {
    if (!editing) return
    if (!window.confirm(`Archive "${editing.name}"? It will be hidden but history is kept.`)) return
    setSaving(true)
    try {
      const { error } = await supabase.from('shifts').update({ is_active: false }).eq('id', editing.id)
      if (error) throw error
      showToast('Shift archived', 'green')
      setShiftModal(false)
      fetchAll()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  function openAssign() {
    setAssignForm(EMPTY_ASSIGNMENT)
    setAssignModal(true)
  }

  async function saveAssignment() {
    if (!assignForm.employee_id) { showToast('Select an employee', 'red'); return }
    if (!assignForm.shift_id) { showToast('Select a shift', 'red'); return }
    if (!assignForm.start_date) { showToast('Start date is required', 'red'); return }
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('shift_assignments').insert({
        employee_id: assignForm.employee_id,
        shift_id: assignForm.shift_id,
        site_id: currentSiteId,
        start_date: assignForm.start_date,
        end_date: assignForm.end_date || null,
        created_by: user?.id || null,
      })
      if (error) throw error
      showToast('Assignment created', 'green')
      setAssignModal(false)
      fetchAll()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  const activeShifts = shifts.filter(s => s.is_active !== false)

  const q = assignSearch.trim().toLowerCase()
  const filteredAssignments = assignments.filter(a => {
    if (!q) return true
    const empName = a.employees?.name?.toLowerCase() || ''
    const shiftName = a.shifts?.name?.toLowerCase() || ''
    return empName.includes(q) || shiftName.includes(q)
  })

  return (
    <div>
      <PageHeader
        title="Shift Management"
        site={currentSite?.name}
        actions={canEdit && <Button onClick={openAddShift} variant="filled" icon="add">Add Shift</Button>}
      >
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Define shifts and assign employees. Single-shift model.</div>
      </PageHeader>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMed, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>Loading...</div>
      ) : (
        <>
          {/* Shifts Table */}
          <Card>
            <TableWrap>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <THead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Code</Th>
                    <Th>Start Time</Th>
                    <Th>End Time</Th>
                    <Th align="right">Duration (hrs)</Th>
                    <Th>Night Shift</Th>
                    <Th>Status</Th>
                  </tr>
                </THead>
                <tbody>
                  {visibleShifts.length === 0 ? (
                    <tr><Td colSpan={7} style={{ textAlign: 'center', color: THEME.textLow, padding: '32px' }}>No shifts defined yet.</Td></tr>
                  ) : visibleShifts.map((s, i) => (
                    <TRow key={s.id} last={i === visibleShifts.length - 1}
                      onClick={() => canEdit && openEditShift(s)}
                      style={{ cursor: canEdit ? 'pointer' : 'default' }}
                    >
                      <Td style={{ fontWeight: 500 }}>{s.name}</Td>
                      <Td><span style={{ background: ACCENT + '18', color: ACCENT, padding: '2px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>{s.code}</span></Td>
                      <Td>{s.start_time}</Td>
                      <Td>{s.end_time}</Td>
                      <Td align="right">{s.duration_hours ?? '-'}</Td>
                      <Td>{s.is_night_shift ? <Icon name="dark_mode" size={18} style={{ color: '#6366F1' }} /> : '-'}</Td>
                      <Td>
                        <span style={{
                          padding: '2px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                          background: s.is_active !== false ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                          color: s.is_active !== false ? THEME.statusSuccessText : THEME.statusNeutralText,
                        }}>{s.is_active !== false ? 'Active' : 'Archived'}</span>
                      </Td>
                    </TRow>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          {/* Shift Assignments Section */}
          <div style={{ marginTop: '32px' }}>
            <SectionLabel>Shift Assignments</SectionLabel>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
              <input
                type="text" value={assignSearch} placeholder="Search employee or shift..."
                onChange={e => setAssignSearch(e.target.value)}
                style={{ ...inputStyle, width: '260px' }}
              />
              {canEdit && <Button onClick={openAssign} variant="filled" icon="person_add">Assign Employee</Button>}
            </div>

            <Card>
              <TableWrap>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <THead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Shift</Th>
                      <Th>Start Date</Th>
                      <Th>End Date</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {filteredAssignments.length === 0 ? (
                      <tr><Td colSpan={4} style={{ textAlign: 'center', color: THEME.textLow, padding: '32px' }}>No assignments found.</Td></tr>
                    ) : filteredAssignments.map((a, i) => (
                      <TRow key={a.id} last={i === filteredAssignments.length - 1}>
                        <Td style={{ fontWeight: 500 }}>{a.employees?.name || 'Unknown'}</Td>
                        <Td>{a.shifts?.name || '-'}</Td>
                        <Td>{a.start_date}</Td>
                        <Td>{a.end_date || <span style={{ color: THEME.textLow }}>Ongoing</span>}</Td>
                      </TRow>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          </div>
        </>
      )}

      {/* Shift Modal */}
      <Modal open={shiftModal} onClose={() => setShiftModal(false)} title={editing ? 'Edit Shift' : 'Add Shift'} footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {editing && canEdit && (
            <Button variant="outline" onClick={archiveShift} disabled={saving}
              style={{ color: THEME.error, borderColor: THEME.error }}>Archive</Button>
          )}
          <Button variant="outline" onClick={() => setShiftModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={saveShift} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Shift Name *</label>
            <input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Day Shift" />
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Code *</label>
            <input style={inputStyle} value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="e.g. DS" />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Start Time</label>
              <input type="time" style={inputStyle} value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>End Time</label>
              <input type="time" style={inputStyle} value={form.end_time} onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
            </div>
          </div>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>Duration: <strong>{duration} hours</strong></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_night_shift} onChange={e => setForm(f => ({ ...f, is_night_shift: e.target.checked }))} />
            Night Shift
          </label>
        </div>
      </Modal>

      {/* Assignment Modal */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title="Assign Employee to Shift" footer={
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={() => setAssignModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={saveAssignment} disabled={saving}>{saving ? 'Saving...' : 'Assign'}</Button>
        </div>
      }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Employee *</label>
            <select style={inputStyle} value={assignForm.employee_id} onChange={e => setAssignForm(f => ({ ...f, employee_id: e.target.value }))}>
              <option value="">Select employee...</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Shift *</label>
            <select style={inputStyle} value={assignForm.shift_id} onChange={e => setAssignForm(f => ({ ...f, shift_id: e.target.value }))}>
              <option value="">Select shift...</option>
              {activeShifts.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Start Date *</label>
              <input type="date" style={inputStyle} value={assignForm.start_date} onChange={e => setAssignForm(f => ({ ...f, start_date: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>End Date</label>
              <input type="date" style={inputStyle} value={assignForm.end_date} onChange={e => setAssignForm(f => ({ ...f, end_date: e.target.value }))} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
