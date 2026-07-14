import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { Card, Icon, PageHeader, Button, showToast } from '../../../components/ui'
import { DashCard, KpiCard, ProgressRow, SectionTitle } from '../../../components/dash'

const ACCENT = MODULE_COLORS.workforce
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function HeadcountReport({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const now = new Date()
  const [fromDate, setFromDate] = useState(iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [toDate, setToDate] = useState(iso(now))
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState([])

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('id, name, employee_number, status, start_date, termination_date, is_archived, department:departments!employees_department_id_fkey(id, name), employment_type:employment_types(id, name)')
        .eq('site_id', currentSiteId)
      if (error) throw error
      setEmployees((data || []).filter(e => !e.is_archived))
    } catch (err) {
      console.error('HeadcountReport fetch:', err)
      showToast('Failed to load headcount data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetch()
  }, [currentSiteId, fetch])

  const stats = useMemo(() => {
    const byStatus = {}
    employees.forEach(e => {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1
    })

    const byDept = {}
    employees.forEach(e => {
      const name = e.department?.name || 'Unassigned'
      if (!byDept[name]) byDept[name] = { total: 0, active: 0, on_leave: 0, terminated: 0, other: 0 }
      byDept[name].total++
      if (e.status === 'active') byDept[name].active++
      else if (e.status === 'on_leave' || e.status === 'long_leave') byDept[name].on_leave++
      else if (e.status === 'terminated') byDept[name].terminated++
      else byDept[name].other++
    })

    const byType = {}
    employees.forEach(e => {
      const name = e.employment_type?.name || 'Unspecified'
      byType[name] = (byType[name] || 0) + 1
    })

    const newHires = employees.filter(e => e.start_date && e.start_date >= fromDate && e.start_date <= toDate)
    const terminations = employees.filter(e => e.termination_date && e.termination_date >= fromDate && e.termination_date <= toDate)
    const netChange = newHires.length - terminations.length

    return { byStatus, byDept, byType, newHires, terminations, netChange, total: employees.length }
  }, [employees, fromDate, toDate])

  const handleExport = useCallback(() => {
    const headers = ['Department', 'Total', 'Active', 'On Leave', 'Terminated', 'Other']
    const rows = Object.entries(stats.byDept).map(([dept, v]) => [dept, v.total, v.active, v.on_leave, v.terminated, v.other])
    exportCsv(`headcount_${fromDate}_${toDate}.csv`, headers, rows)
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
  const activePct = stats.total > 0 ? ((stats.byStatus.active || 0) / stats.total) * 100 : null
  const deptEntries = Object.entries(stats.byDept).sort((a, b) => b[1].total - a[1].total)
  const maxDept = Math.max(...deptEntries.map(([, v]) => v.total), 1)

  return (
    <div>
      <PageHeader title="Headcount Report" site={currentSite} />

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
            <KpiCard label="Total Employees" value={stats.total} icon="groups" accent={ACCENT} />
            <KpiCard label="Active" value={stats.byStatus.active || 0} icon="check_circle" accent={THEME.success}
              progress={activePct} sub={activePct !== null ? `${activePct.toFixed(0)}% of headcount` : undefined} />
            <KpiCard label="On Leave" value={(stats.byStatus.on_leave || 0) + (stats.byStatus.long_leave || 0)} icon="beach_access" accent={THEME.warning}
              progress={stats.total > 0 ? (((stats.byStatus.on_leave || 0) + (stats.byStatus.long_leave || 0)) / stats.total) * 100 : undefined} />
            <KpiCard label="New Hires" value={stats.newHires.length} sub={`${fromDate} - ${toDate}`} icon="person_add" accent={THEME.info} />
            <KpiCard label="Terminations" value={stats.terminations.length} sub={`${fromDate} - ${toDate}`} icon="person_off" accent={THEME.error} />
            <KpiCard label="Net Change" value={(stats.netChange >= 0 ? '+' : '') + stats.netChange} icon="trending_up" accent={stats.netChange >= 0 ? THEME.success : THEME.error} />
          </div>

          {/* Department distribution */}
          {deptEntries.length > 0 && (
            <DashCard style={{ marginBottom: '18px' }}>
              <SectionTitle title="Department Distribution" subtitle="Headcount share per department" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {deptEntries.slice(0, 8).map(([dept, v]) => (
                  <ProgressRow key={dept} label={dept} value={v.total} pct={(v.total / maxDept) * 100} color={ACCENT} />
                ))}
              </div>
            </DashCard>
          )}

          {/* Department breakdown */}
          <DashCard style={{ marginBottom: '18px' }}>
            <SectionTitle title="By Department" />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    {['Department', 'Total', 'Active', 'On Leave', 'Terminated', 'Other'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deptEntries.map(([dept, v]) => (
                    <tr key={dept} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 10px', color: THEME.text }}>{dept}</td>
                      <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600 }}>{v.total}</td>
                      <td style={{ padding: '8px 10px', color: THEME.success }}>{v.active}</td>
                      <td style={{ padding: '8px 10px', color: THEME.warning }}>{v.on_leave}</td>
                      <td style={{ padding: '8px 10px', color: THEME.error }}>{v.terminated}</td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed }}>{v.other}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DashCard>

          {/* Employment type breakdown */}
          <DashCard style={{ marginBottom: '18px' }}>
            <SectionTitle title="By Employment Type" />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={th}>Type</th>
                    <th style={th}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(stats.byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                    <tr key={type} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 10px', color: THEME.text }}>{type}</td>
                      <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600 }}>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DashCard>

          {/* New hires detail */}
          {stats.newHires.length > 0 && (
            <DashCard>
              <SectionTitle title="New Hires" subtitle={`${fromDate} to ${toDate}`} />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      {['Employee #', 'Name', 'Department', 'Type', 'Start Date'].map(h => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.newHires.map(e => (
                      <tr key={e.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.employee_number || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.name}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.department?.name || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.employment_type?.name || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{e.start_date}</td>
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
