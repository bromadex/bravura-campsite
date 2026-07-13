import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { Card, Icon, PageHeader, Button, StatCard, showToast } from '../../../components/ui'

const ACCENT = MODULE_COLORS.workforce
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function LeaveReport({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const now = new Date()
  const [fromDate, setFromDate] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [toDate, setToDate] = useState(iso(now))
  const [loading, setLoading] = useState(true)
  const [leaveRequests, setLeaveRequests] = useState([])
  const [allocations, setAllocations] = useState([])
  const [employees, setEmployees] = useState([])

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [reqRes, allocRes, empRes] = await Promise.all([
        supabase
          .from('leave_requests')
          .select('id, employee_id, leave_type_id, start_date, end_date, days, status, leave_type:leave_types(id, name)')
          .eq('site_id', currentSiteId)
          .in('status', ['approved', 'taken'])
          .gte('start_date', fromDate)
          .lte('start_date', toDate),
        supabase
          .from('leave_allocations')
          .select('id, employee_id, leave_type_id, days_allocated, days_used, year, leave_type:leave_types(id, name)')
          .eq('site_id', currentSiteId),
        supabase
          .from('employees')
          .select('id, name, employee_number, status, is_archived')
          .eq('site_id', currentSiteId),
      ])
      if (reqRes.error) throw reqRes.error
      if (allocRes.error) throw allocRes.error
      if (empRes.error) throw empRes.error
      setLeaveRequests(reqRes.data || [])
      setAllocations(allocRes.data || [])
      setEmployees((empRes.data || []).filter(e => !e.is_archived))
    } catch (err) {
      console.error('LeaveReport fetch:', err)
      showToast('Failed to load leave data', 'red')
    }
    setLoading(false)
  }, [currentSiteId, fromDate, toDate])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetch()
  }, [currentSiteId, fromDate, toDate, fetch])

  const stats = useMemo(() => {
    const empMap = Object.fromEntries(employees.map(e => [e.id, e]))

    // Days by type
    const byType = {}
    leaveRequests.forEach(r => {
      const name = r.leave_type?.name || 'Unknown'
      byType[name] = (byType[name] || 0) + (r.days || 0)
    })
    const totalDays = Object.values(byType).reduce((s, v) => s + v, 0)

    // Currently on leave
    const onLeave = employees.filter(e => e.status === 'on_leave' || e.status === 'long_leave')

    // Leave balances per employee (current year allocations)
    const currentYear = new Date().getFullYear()
    const yearAllocs = allocations.filter(a => a.year === currentYear)
    const totalAllocated = yearAllocs.reduce((s, a) => s + (a.days_allocated || 0), 0)
    const totalUsed = yearAllocs.reduce((s, a) => s + (a.days_used || 0), 0)
    const utilRate = totalAllocated > 0 ? ((totalUsed / totalAllocated) * 100).toFixed(1) : '0.0'

    // Per-employee balance summary
    const balanceByEmp = {}
    yearAllocs.forEach(a => {
      if (!balanceByEmp[a.employee_id]) {
        const emp = empMap[a.employee_id]
        balanceByEmp[a.employee_id] = { name: emp?.name || 'Unknown', empNo: emp?.employee_number || '-', allocated: 0, used: 0 }
      }
      balanceByEmp[a.employee_id].allocated += a.days_allocated || 0
      balanceByEmp[a.employee_id].used += a.days_used || 0
    })
    const balances = Object.values(balanceByEmp).map(b => ({ ...b, remaining: b.allocated - b.used }))
      .sort((a, b) => a.remaining - b.remaining)

    return { byType, totalDays, onLeave, totalAllocated, totalUsed, utilRate, balances }
  }, [leaveRequests, allocations, employees])

  const handleExport = useCallback(() => {
    const headers = ['Employee #', 'Name', 'Allocated', 'Used', 'Remaining']
    const rows = stats.balances.map(b => [b.empNo, b.name, b.allocated, b.used, b.remaining])
    exportCsv(`leave_report_${fromDate}_${toDate}.csv`, headers, rows)
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

  return (
    <div>
      <PageHeader title="Leave Report" site={currentSite} />

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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <StatCard label="Total Leave Days" value={stats.totalDays} icon="event" color={ACCENT} />
            <StatCard label="Currently On Leave" value={stats.onLeave.length} icon="beach_access" color={THEME.warning} />
            <StatCard label="Utilisation Rate" value={stats.utilRate + '%'} icon="donut_large" color={THEME.info} />
            <StatCard label="Total Allocated" value={stats.totalAllocated} sub={`${new Date().getFullYear()}`} icon="assignment" color={THEME.success} />
            <StatCard label="Total Used" value={stats.totalUsed} icon="assignment_turned_in" color={THEME.error} />
          </div>

          {/* Days by type */}
          <Card style={{ marginBottom: '18px' }}>
            <div style={{ fontWeight: 500, fontSize: '15px', color: THEME.text, marginBottom: '12px' }}>Leave Days by Type ({fromDate} to {toDate})</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', color: THEME.textMed, fontWeight: 500 }}>Leave Type</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', color: THEME.textMed, fontWeight: 500 }}>Days</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.byType).sort((a, b) => b[1] - a[1]).map(([type, days]) => (
                    <tr key={type} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 10px', color: THEME.text }}>{type}</td>
                      <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600 }}>{days}</td>
                    </tr>
                  ))}
                  {Object.keys(stats.byType).length === 0 && (
                    <tr><td colSpan={2} style={{ padding: '16px', textAlign: 'center', color: THEME.textLow }}>No leave taken in this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Currently on leave */}
          {stats.onLeave.length > 0 && (
            <Card style={{ marginBottom: '18px' }}>
              <div style={{ fontWeight: 500, fontSize: '15px', color: THEME.text, marginBottom: '12px' }}>Currently On Leave ({stats.onLeave.length})</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                      {['Employee #', 'Name', 'Status'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: THEME.textMed, fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.onLeave.map(e => (
                      <tr key={e.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.employee_number || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.name}</td>
                        <td style={{ padding: '8px 10px', color: THEME.warning }}>{e.status === 'long_leave' ? 'Long Leave' : 'On Leave'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Leave balances */}
          <Card>
            <div style={{ fontWeight: 500, fontSize: '15px', color: THEME.text, marginBottom: '12px' }}>Leave Balance Summary ({new Date().getFullYear()})</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                    {['Employee #', 'Name', 'Allocated', 'Used', 'Remaining'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: THEME.textMed, fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.balances.map((b, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 10px', color: THEME.text }}>{b.empNo}</td>
                      <td style={{ padding: '8px 10px', color: THEME.text }}>{b.name}</td>
                      <td style={{ padding: '8px 10px', color: THEME.text }}>{b.allocated}</td>
                      <td style={{ padding: '8px 10px', color: THEME.text }}>{b.used}</td>
                      <td style={{ padding: '8px 10px', color: b.remaining < 0 ? THEME.error : THEME.success, fontWeight: 600 }}>{b.remaining}</td>
                    </tr>
                  ))}
                  {stats.balances.length === 0 && (
                    <tr><td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: THEME.textLow }}>No allocations found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
