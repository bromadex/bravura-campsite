import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../../components/ui'

const ACCENT = MODULE_COLORS.workforce

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

const STATUS_COLORS = {
  Present: { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  Absent:  { bg: THEME.statusErrorBg, text: THEME.statusErrorText },
  Late:    { bg: THEME.statusWarningBg, text: THEME.statusWarningText },
}

function getStatus(log) {
  if (!log) return 'Absent'
  if (log.is_absent) return 'Absent'
  if (log.is_late) return 'Late'
  return 'Present'
}

function calcHours(clockIn, clockOut) {
  if (!clockIn || !clockOut) return null
  const [h1, m1] = clockIn.split(':').map(Number)
  const [h2, m2] = clockOut.split(':').map(Number)
  let mins = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (mins < 0) mins += 24 * 60
  return Math.round((mins / 60) * 100) / 100
}

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function monthStartEnd(monthStr) {
  const [y, m] = monthStr.split('-').map(Number)
  const start = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

export default function AttendanceLog() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [date, setDate] = useState(todayStr())
  const [view, setView] = useState('daily') // daily | monthly
  const [month, setMonth] = useState(todayStr().slice(0, 7))

  const [employees, setEmployees] = useState([])
  const [shifts, setShifts] = useState([])
  const [assignments, setAssignments] = useState([])
  const [logs, setLogs] = useState([])
  const [monthlyLogs, setMonthlyLogs] = useState([])
  const [loading, setLoading] = useState(true)

  const [editRow, setEditRow] = useState(null) // employee_id being edited
  const [editForm, setEditForm] = useState({})
  const [saving, setSaving] = useState(false)

  const fetchDaily = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [empRes, shiftRes, assignRes, logRes] = await Promise.all([
        supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
        supabase.from('shifts').select('id, name, code').eq('site_id', currentSiteId).eq('is_active', true),
        supabase.from('shift_assignments').select('employee_id, shift_id, shifts(name)')
          .eq('site_id', currentSiteId)
          .lte('start_date', date)
          .or(`end_date.is.null,end_date.gte.${date}`),
        supabase.from('attendance_logs').select('*').eq('site_id', currentSiteId).eq('date', date),
      ])
      if (empRes.error) throw empRes.error
      if (shiftRes.error) throw shiftRes.error
      if (assignRes.error) throw assignRes.error
      if (logRes.error) throw logRes.error
      setEmployees(empRes.data || [])
      setShifts(shiftRes.data || [])
      setAssignments(assignRes.data || [])
      setLogs(logRes.data || [])
    } catch (err) {
      console.error(err)
      showToast('Failed to load attendance data', 'red')
    } finally {
      setLoading(false)
    }
  }, [currentSiteId, date])

  const fetchMonthly = useCallback(async () => {
    if (!currentSiteId || view !== 'monthly') return
    setLoading(true)
    try {
      const { start, end } = monthStartEnd(month)
      const [empRes, logRes] = await Promise.all([
        supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
        supabase.from('attendance_logs').select('*').eq('site_id', currentSiteId).gte('date', start).lte('date', end),
      ])
      if (empRes.error) throw empRes.error
      if (logRes.error) throw logRes.error
      setEmployees(empRes.data || [])
      setMonthlyLogs(logRes.data || [])
    } catch (err) {
      console.error(err)
      showToast('Failed to load monthly data', 'red')
    } finally {
      setLoading(false)
    }
  }, [currentSiteId, month, view])

  useEffect(() => { if (view === 'daily') fetchDaily() }, [fetchDaily, view])
  useEffect(() => { if (view === 'monthly') fetchMonthly() }, [fetchMonthly, view])

  // ── Gate (after all hooks) ────────────────────────────────────────────────
  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const canEdit = can('hr.edit')

  // Build lookup maps
  const logByEmp = {}
  logs.forEach(l => { logByEmp[l.employee_id] = l })

  const assignByEmp = {}
  assignments.forEach(a => { assignByEmp[a.employee_id] = a })

  // ── Daily row data ──
  const rows = employees.map(emp => {
    const log = logByEmp[emp.id]
    const assign = assignByEmp[emp.id]
    return {
      employee: emp,
      shift: assign?.shifts?.name || '-',
      log,
      status: getStatus(log),
    }
  })

  // ── Monthly summary ──
  const monthlySummary = useMemo(() => {
    const byEmp = {}
    monthlyLogs.forEach(l => {
      if (!byEmp[l.employee_id]) byEmp[l.employee_id] = { present: 0, absent: 0, late: 0, hours: 0, overtime: 0 }
      const s = byEmp[l.employee_id]
      if (l.is_absent) { s.absent++ }
      else { s.present++; if (l.is_late) s.late++ }
      s.hours += (l.hours_worked || 0)
      s.overtime += (l.overtime_hours || 0)
    })
    return employees.map(emp => ({
      employee: emp,
      ...(byEmp[emp.id] || { present: 0, absent: 0, late: 0, hours: 0, overtime: 0 }),
    }))
  }, [employees, monthlyLogs])

  // ── Edit handlers ──
  function startEdit(emp) {
    if (!canEdit) return
    const log = logByEmp[emp.id]
    setEditRow(emp.id)
    setEditForm({
      clock_in: log?.clock_in || '',
      clock_out: log?.clock_out || '',
      is_absent: log?.is_absent || false,
      is_late: log?.is_late || false,
      notes: log?.notes || '',
    })
  }

  async function saveEdit(empId) {
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const hours = calcHours(editForm.clock_in, editForm.clock_out)
      const payload = {
        employee_id: empId,
        site_id: currentSiteId,
        date,
        clock_in: editForm.clock_in || null,
        clock_out: editForm.clock_out || null,
        hours_worked: hours,
        is_absent: editForm.is_absent,
        is_late: editForm.is_late,
        overtime_hours: hours && hours > 8 ? Math.round((hours - 8) * 100) / 100 : 0,
        notes: editForm.notes || null,
        created_by: user?.id || null,
      }
      const existing = logByEmp[empId]
      if (existing) {
        const { error } = await supabase.from('attendance_logs').update(payload).eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('attendance_logs').insert(payload)
        if (error) throw error
      }
      showToast('Attendance saved', 'green')
      setEditRow(null)
      fetchDaily()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  // ── Bulk mark ──
  async function bulkMark(markAbsent) {
    const label = markAbsent ? 'absent' : 'present'
    if (!window.confirm(`Mark all employees as ${label} for ${date}?`)) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const upserts = employees.map(emp => {
        const existing = logByEmp[emp.id]
        return {
          ...(existing ? { id: existing.id } : {}),
          employee_id: emp.id,
          site_id: currentSiteId,
          date,
          is_absent: markAbsent,
          is_late: false,
          clock_in: markAbsent ? null : (existing?.clock_in || null),
          clock_out: markAbsent ? null : (existing?.clock_out || null),
          hours_worked: markAbsent ? 0 : (existing?.hours_worked || null),
          overtime_hours: markAbsent ? 0 : (existing?.overtime_hours || 0),
          notes: existing?.notes || null,
          created_by: user?.id || null,
        }
      })
      const { error } = await supabase.from('attendance_logs').upsert(upserts, { onConflict: 'employee_id,site_id,date' })
      if (error) throw error
      showToast(`All marked ${label}`, 'green')
      fetchDaily()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  // ── Export CSV ──
  function exportMonthlyCsv() {
    const headers = ['Employee', 'Days Present', 'Days Absent', 'Late Count', 'Total Hours', 'Overtime Hours']
    const csvRows = monthlySummary.map(r => [
      r.employee.name, r.present, r.absent, r.late,
      Math.round(r.hours * 100) / 100, Math.round(r.overtime * 100) / 100,
    ])
    exportCsv(`attendance_${month}.csv`, headers, csvRows)
  }

  const tabStyle = (active) => ({
    padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
    fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
    background: active ? ACCENT : 'transparent',
    color: active ? '#fff' : THEME.textMed,
  })

  return (
    <div>
      <PageHeader
        title="Attendance Log"
        site={currentSite?.name}
      >
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Track daily attendance and view monthly summaries.</div>
      </PageHeader>

      {/* View Toggle */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: THEME.surfaceVar, borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
        <button style={tabStyle(view === 'daily')} onClick={() => setView('daily')}>Daily</button>
        <button style={tabStyle(view === 'monthly')} onClick={() => setView('monthly')}>Monthly Summary</button>
      </div>

      {view === 'daily' ? (
        <>
          {/* Date picker + bulk actions */}
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inputStyle, width: '180px' }} />
            {canEdit && (
              <>
                <Button variant="filled" icon="check_circle" onClick={() => bulkMark(false)} disabled={saving}>Mark All Present</Button>
                <Button variant="outline" icon="cancel" onClick={() => bulkMark(true)} disabled={saving} style={{ color: THEME.error, borderColor: THEME.error }}>Mark All Absent</Button>
              </>
            )}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>Loading...</div>
          ) : (
            <Card>
              <TableWrap>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <THead>
                    <tr>
                      <Th>Employee</Th>
                      <Th>Shift</Th>
                      <Th>Clock In</Th>
                      <Th>Clock Out</Th>
                      <Th align="right">Hours</Th>
                      <Th>Status</Th>
                      <Th>Notes</Th>
                      {canEdit && <Th align="center">Actions</Th>}
                    </tr>
                  </THead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><Td colSpan={canEdit ? 8 : 7} style={{ textAlign: 'center', color: THEME.textLow, padding: '32px' }}>No active employees.</Td></tr>
                    ) : rows.map((r, i) => {
                      const isEditing = editRow === r.employee.id
                      const sc = STATUS_COLORS[r.status]
                      return (
                        <TRow key={r.employee.id} last={i === rows.length - 1}>
                          <Td style={{ fontWeight: 500 }}>{r.employee.name}</Td>
                          <Td>{r.shift}</Td>
                          {isEditing ? (
                            <>
                              <Td><input type="time" value={editForm.clock_in} onChange={e => setEditForm(f => ({ ...f, clock_in: e.target.value }))} style={{ ...inputStyle, width: '120px', padding: '6px 10px' }} /></Td>
                              <Td><input type="time" value={editForm.clock_out} onChange={e => setEditForm(f => ({ ...f, clock_out: e.target.value }))} style={{ ...inputStyle, width: '120px', padding: '6px 10px' }} /></Td>
                              <Td align="right">{calcHours(editForm.clock_in, editForm.clock_out) ?? '-'}</Td>
                              <Td>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <label style={{ fontSize: '12px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={editForm.is_absent} onChange={e => setEditForm(f => ({ ...f, is_absent: e.target.checked, is_late: false }))} /> Absent
                                  </label>
                                  <label style={{ fontSize: '12px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={editForm.is_late} disabled={editForm.is_absent} onChange={e => setEditForm(f => ({ ...f, is_late: e.target.checked }))} /> Late
                                  </label>
                                </div>
                              </Td>
                              <Td><input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inputStyle, width: '140px', padding: '6px 10px' }} placeholder="Notes..." /></Td>
                              <Td align="center">
                                <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                                  <button onClick={() => saveEdit(r.employee.id)} disabled={saving}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                    <Icon name="check" size={20} style={{ color: THEME.success }} />
                                  </button>
                                  <button onClick={() => setEditRow(null)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                    <Icon name="close" size={20} style={{ color: THEME.error }} />
                                  </button>
                                </div>
                              </Td>
                            </>
                          ) : (
                            <>
                              <Td>{r.log?.clock_in || '-'}</Td>
                              <Td>{r.log?.clock_out || '-'}</Td>
                              <Td align="right">{r.log?.hours_worked != null ? r.log.hours_worked : '-'}</Td>
                              <Td>
                                <span style={{
                                  padding: '2px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                                  background: sc.bg, color: sc.text,
                                }}>{r.status}</span>
                              </Td>
                              <Td style={{ color: THEME.textLow, fontSize: '13px' }}>{r.log?.notes || '-'}</Td>
                              {canEdit && (
                                <Td align="center">
                                  <button onClick={() => startEdit(r.employee)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                                    <Icon name="edit" size={18} style={{ color: ACCENT }} />
                                  </button>
                                </Td>
                              )}
                            </>
                          )}
                        </TRow>
                      )
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}
        </>
      ) : (
        /* Monthly Summary View */
        <>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ ...inputStyle, width: '200px' }} />
            <Button variant="outline" icon="download" onClick={exportMonthlyCsv}>Export CSV</Button>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>Loading...</div>
          ) : (
            <Card>
              <TableWrap>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <THead>
                    <tr>
                      <Th>Employee</Th>
                      <Th align="right">Days Present</Th>
                      <Th align="right">Days Absent</Th>
                      <Th align="right">Late Count</Th>
                      <Th align="right">Total Hours</Th>
                      <Th align="right">Overtime Hours</Th>
                    </tr>
                  </THead>
                  <tbody>
                    {monthlySummary.length === 0 ? (
                      <tr><Td colSpan={6} style={{ textAlign: 'center', color: THEME.textLow, padding: '32px' }}>No data.</Td></tr>
                    ) : monthlySummary.map((r, i) => (
                      <TRow key={r.employee.id} last={i === monthlySummary.length - 1}>
                        <Td style={{ fontWeight: 500 }}>{r.employee.name}</Td>
                        <Td align="right"><span style={{ color: THEME.statusSuccessText, fontWeight: 600 }}>{r.present}</span></Td>
                        <Td align="right"><span style={{ color: r.absent > 0 ? THEME.statusErrorText : THEME.textLow, fontWeight: 600 }}>{r.absent}</span></Td>
                        <Td align="right"><span style={{ color: r.late > 0 ? THEME.statusWarningText : THEME.textLow, fontWeight: 600 }}>{r.late}</span></Td>
                        <Td align="right">{Math.round(r.hours * 100) / 100}</Td>
                        <Td align="right"><span style={{ color: r.overtime > 0 ? ACCENT : THEME.textLow }}>{Math.round(r.overtime * 100) / 100}</span></Td>
                      </TRow>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
