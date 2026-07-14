import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { Card, Icon, PageHeader, Button, showToast } from '../../../components/ui'
import { DashCard, KpiCard, DonutGauge, SectionTitle } from '../../../components/dash'

const ACCENT = MODULE_COLORS.workforce
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function AttendanceReport({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const now = new Date()
  const [fromDate, setFromDate] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [toDate, setToDate] = useState(iso(now))
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState([])
  const [employees, setEmployees] = useState([])

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [logRes, empRes] = await Promise.all([
        supabase
          .from('attendance_logs')
          .select('id, employee_id, date, status, check_in, check_out, overtime_hours, notes')
          .eq('site_id', currentSiteId)
          .gte('date', fromDate)
          .lte('date', toDate),
        supabase
          .from('employees')
          .select('id, name, employee_number, department:departments!employees_department_id_fkey(id, name), is_archived')
          .eq('site_id', currentSiteId),
      ])
      if (logRes.error) throw logRes.error
      if (empRes.error) throw empRes.error
      setLogs(logRes.data || [])
      setEmployees((empRes.data || []).filter(e => !e.is_archived))
    } catch (err) {
      console.error('AttendanceReport fetch:', err)
      showToast('Failed to load attendance data', 'red')
    }
    setLoading(false)
  }, [currentSiteId, fromDate, toDate])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetch()
  }, [currentSiteId, fromDate, toDate, fetch])

  const stats = useMemo(() => {
    const empMap = Object.fromEntries(employees.map(e => [e.id, e]))
    const totalLogs = logs.length
    const present = logs.filter(l => l.status === 'present').length
    const absent = logs.filter(l => l.status === 'absent').length
    const late = logs.filter(l => l.status === 'late').length
    const overtimeTotal = logs.reduce((s, l) => s + (l.overtime_hours || 0), 0)

    const attendanceRate = totalLogs > 0 ? (((present + late) / totalLogs) * 100).toFixed(1) : '0.0'
    const absenteeismRate = totalLogs > 0 ? ((absent / totalLogs) * 100).toFixed(1) : '0.0'

    // By department
    const byDept = {}
    logs.forEach(l => {
      const emp = empMap[l.employee_id]
      const dept = emp?.department?.name || 'Unassigned'
      if (!byDept[dept]) byDept[dept] = { total: 0, present: 0, absent: 0, late: 0 }
      byDept[dept].total++
      if (l.status === 'present') byDept[dept].present++
      else if (l.status === 'absent') byDept[dept].absent++
      else if (l.status === 'late') byDept[dept].late++
    })
    const deptRows = Object.entries(byDept).map(([dept, v]) => ({
      dept,
      ...v,
      rate: v.total > 0 ? (((v.present + v.late) / v.total) * 100).toFixed(1) : '0.0',
    })).sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate))

    // Top 10 most absences
    const absencesByEmp = {}
    logs.filter(l => l.status === 'absent').forEach(l => {
      absencesByEmp[l.employee_id] = (absencesByEmp[l.employee_id] || 0) + 1
    })
    const topAbsent = Object.entries(absencesByEmp)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([empId, count]) => {
        const emp = empMap[empId]
        return { empNo: emp?.employee_number || '-', name: emp?.name || 'Unknown', dept: emp?.department?.name || '-', absences: count }
      })

    return { totalLogs, present, absent, late, overtimeTotal, attendanceRate, absenteeismRate, deptRows, topAbsent }
  }, [logs, employees])

  const handleExport = useCallback(() => {
    const headers = ['Department', 'Total Records', 'Present', 'Absent', 'Late', 'Attendance Rate %']
    const rows = stats.deptRows.map(d => [d.dept, d.total, d.present, d.absent, d.late, d.rate])
    exportCsv(`attendance_${fromDate}_${toDate}.csv`, headers, rows)
  }, [stats, fromDate, toDate])

  if (!can('hr.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view HR reports.
        </div>
      </Card>
    )
  }

  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <PageHeader title="Attendance Report" site={currentSite} />

      {/* Date range */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <label style={{ color: THEME.textMed, fontSize: '13px' }}>From</label>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px' }} />
        <label style={{ color: THEME.textMed, fontSize: '13px' }}>To</label>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px' }} />
        {can('hr.edit') && (
          <Button icon="download" onClick={handleExport} style={{ marginLeft: 'auto' }}>Export CSV</Button>
        )}
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <KpiCard label="Attendance Rate" value={stats.attendanceRate + '%'} icon="check_circle" accent={THEME.success} progress={parseFloat(stats.attendanceRate)} />
            <KpiCard label="Absenteeism Rate" value={stats.absenteeismRate + '%'} icon="cancel" accent={THEME.error} progress={parseFloat(stats.absenteeismRate)} />
            <KpiCard label="Late Arrivals" value={stats.late} icon="schedule" accent={THEME.warning}
              progress={stats.totalLogs > 0 ? (stats.late / stats.totalLogs) * 100 : undefined} />
            <KpiCard label="Overtime Hours" value={stats.overtimeTotal.toFixed(1)} icon="more_time" accent={ACCENT} />
            <KpiCard label="Total Records" value={stats.totalLogs} icon="fact_check" accent={THEME.info} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px', marginBottom: '18px' }}>
            {/* Attendance gauge */}
            <DashCard>
              <SectionTitle title="Overall Attendance" subtitle={`${fromDate} to ${toDate}`} />
              <DonutGauge
                pct={stats.totalLogs > 0 ? parseFloat(stats.attendanceRate) : null}
                color={THEME.success}
                label="attendance"
                legend={[[THEME.success, `Present ${stats.present}`], [THEME.warning, `Late ${stats.late}`], [THEME.error, `Absent ${stats.absent}`]]}
              />
            </DashCard>

            {/* By department */}
            <DashCard>
              <SectionTitle title="Attendance by Department" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      {['Department', 'Records', 'Present', 'Absent', 'Late', 'Rate'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.deptRows.map(d => (
                      <tr key={d.dept} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{d.dept}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{d.total}</td>
                        <td style={{ padding: '8px 10px', color: THEME.success }}>{d.present}</td>
                        <td style={{ padding: '8px 10px', color: THEME.error }}>{d.absent}</td>
                        <td style={{ padding: '8px 10px', color: THEME.warning }}>{d.late}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600 }}>{d.rate}%</td>
                      </tr>
                    ))}
                    {stats.deptRows.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: THEME.textLow }}>No attendance records in this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </DashCard>
          </div>

          {/* Top absences */}
          {stats.topAbsent.length > 0 && (
            <DashCard>
              <SectionTitle title="Top 10 Employees by Absences" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      {['#', 'Employee #', 'Name', 'Department', 'Absences'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.topAbsent.map((e, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', color: THEME.textMed }}>{i + 1}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.empNo}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.name}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.dept}</td>
                        <td style={{ padding: '8px 10px', color: THEME.error, fontWeight: 600 }}>{e.absences}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashCard>
          )}
        </>
      )}
    </div>
  )
}
