import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import { DashCard, KpiCard, AreaChart, DonutGauge, ProgressRow, SectionTitle } from '../../components/dash'
import QuickNav, { HR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const CLR = { green: '#2E7D32', blue: '#1E88E5', amber: '#F59E0B', red: '#D32F2F', purple: '#7B1FA2' }
const fmt = v => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

export default function HRAnalytics({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [loading, setLoading] = useState(true)
  const [workforce, setWorkforce] = useState([])
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [turnover, setTurnover] = useState({ hires: 0, terms: 0 })
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [tab, setTab] = useState('overview')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [wfRes, deptRes, empRes] = await Promise.all([
        supabase.rpc('rpc_workforce_cost_summary', { p_site_id: currentSiteId, p_date_from: dateFrom, p_date_to: dateTo }),
        supabase.rpc('rpc_department_analytics', { p_site_id: currentSiteId }),
        supabase.from('employees').select('id, name, status, start_date, department_id, employment_type')
          .eq('site_id', currentSiteId).eq('is_archived', false),
      ])
      if (wfRes.error) throw wfRes.error
      if (deptRes.error) throw deptRes.error
      setWorkforce(wfRes.data || [])
      setDepartments(deptRes.data || [])
      setEmployees(empRes.data || [])

      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10)
      const hires = (empRes.data || []).filter(e => e.start_date >= monthStart && e.start_date <= monthEnd).length
      const { count: terms } = await supabase.from('employee_status_history')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', currentSiteId).eq('new_status', 'terminated')
        .gte('created_at', monthStart + 'T00:00:00').lte('created_at', monthEnd + 'T23:59:59')
      setTurnover({ hires, terms: terms || 0 })
    } catch (err) {
      console.error('HRAnalytics:', err)
      showToast('Failed to load analytics', 'red')
    }
    setLoading(false)
  }, [currentSiteId, dateFrom, dateTo])

  useEffect(() => { if (currentSiteId && can('hr.view')) load() }, [currentSiteId, load])
  useRealtimeSubscription('employees', { column: 'site_id', value: currentSiteId }, load)

  const kpis = useMemo(() => {
    const total = employees.length
    const active = employees.filter(e => e.status === 'active').length
    const onLeave = employees.filter(e => e.status === 'on_leave' || e.status === 'long_leave').length
    const totalMealCost = workforce.reduce((s, w) => s + (w.meal_cost || 0), 0)
    const totalTrips = workforce.reduce((s, w) => s + (w.fleet_trips || 0), 0)
    const totalLeaveDays = workforce.reduce((s, w) => s + (w.leave_days || 0), 0)
    const housed = workforce.filter(w => w.accommodation_days > 0).length
    const withSkills = workforce.filter(w => w.skills_count > 0).length
    const skillsGap = total > 0 ? total - withSkills : 0
    const turnoverRate = total > 0 ? ((turnover.terms / total) * 100).toFixed(1) : '0.0'
    return { total, active, onLeave, totalMealCost, totalTrips, totalLeaveDays, housed, withSkills, skillsGap, turnoverRate }
  }, [employees, workforce, turnover])

  const deptChart = useMemo(() => {
    const sorted = [...departments].sort((a, b) => b.headcount - a.headcount).slice(0, 10)
    const max = Math.max(...sorted.map(d => d.headcount), 1)
    return sorted.map(d => ({ ...d, pct: (d.headcount / max) * 100 }))
  }, [departments])

  const tenureBuckets = useMemo(() => {
    const buckets = { '<6m': 0, '6m-1y': 0, '1-2y': 0, '2-5y': 0, '5y+': 0 }
    const now = new Date()
    employees.forEach(e => {
      if (!e.start_date) return
      const days = (now - new Date(e.start_date)) / 86400000
      if (days < 180) buckets['<6m']++
      else if (days < 365) buckets['6m-1y']++
      else if (days < 730) buckets['1-2y']++
      else if (days < 1825) buckets['2-5y']++
      else buckets['5y+']++
    })
    const max = Math.max(...Object.values(buckets), 1)
    return Object.entries(buckets).map(([k, v]) => ({ label: k, count: v, pct: (v / max) * 100 }))
  }, [employees])

  const empTypeDist = useMemo(() => {
    const map = {}
    employees.forEach(e => { const t = e.employment_type || 'Unknown'; map[t] = (map[t] || 0) + 1 })
    const total = employees.length || 1
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, ' '), count: v, pct: (v / total) * 100 }))
  }, [employees])

  const headcountTrend = useMemo(() => {
    const now = new Date()
    const points = [], labels = []
    for (let i = 11; i >= 0; i--) {
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
      const iso = end.toISOString().slice(0, 10)
      points.push(employees.filter(e => e.start_date && e.start_date <= iso).length)
      labels.push(end.toLocaleDateString(undefined, { month: 'short' }))
    }
    return { points, labels }
  }, [employees])

  function exportWorkforce() {
    exportCsv('workforce_analytics.csv',
      ['Employee', 'Department', 'Status', 'Meal Cost', 'Accommodation', 'Fleet Trips', 'Leave Days', 'Skills'],
      workforce.map(w => [w.employee_name, w.department || '', w.status, w.meal_cost?.toFixed(2), w.accommodation_days, w.fleet_trips, w.leave_days, w.skills_count])
    )
  }

  if (!can('hr.view')) return <Card style={{ textAlign: 'center', padding: 40 }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /></Card>

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', fontFamily: 'inherit', background: THEME.surface, color: THEME.text }
  const tabStyle = (t) => ({
    padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    background: tab === t ? ACCENT : 'transparent',
    color: tab === t ? '#fff' : THEME.textMed,
  })

  return (
    <div style={{ maxWidth: 1100 }}>
      <QuickNav pills={HR_PILLS} setPage={setPage} current="wf_analytics" />
      <PageHeader title="HR Analytics" site={currentSite} actions={
        <Button icon="download" onClick={exportWorkforce}>Export</Button>
      } />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, background: THEME.surfaceContainer, borderRadius: 10, padding: 3 }}>
          <button style={tabStyle('overview')} onClick={() => setTab('overview')}>Overview</button>
          <button style={tabStyle('departments')} onClick={() => setTab('departments')}>Departments</button>
          <button style={tabStyle('workforce')} onClick={() => setTab('workforce')}>Workforce Cost</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
          <span style={{ color: THEME.textLow, fontSize: 12 }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
          <Button icon="refresh" onClick={load} style={{ fontSize: 12 }}>Refresh</Button>
        </div>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 48, color: THEME.textMed }}>Loading analytics...</Card>
      ) : tab === 'overview' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14, marginBottom: 18 }}>
            <KpiCard icon="groups" label="Headcount" value={kpis.total} accent={ACCENT} progress={100} onClick={() => setPage('wf_employees')} />
            <KpiCard icon="check_circle" label="Active" value={kpis.active} sub={kpis.total > 0 ? `${((kpis.active / kpis.total) * 100).toFixed(0)}%` : ''} accent={CLR.green} progress={kpis.total > 0 ? (kpis.active / kpis.total) * 100 : 0} />
            <KpiCard icon="trending_down" label="Turnover Rate" value={`${kpis.turnoverRate}%`} sub={`${turnover.terms} terms / ${turnover.hires} hires`} accent={CLR.red} progress={parseFloat(kpis.turnoverRate)} />
            <KpiCard icon="restaurant" label="Meal Cost" value={fmt(kpis.totalMealCost)} sub="period total" accent={CLR.amber} progress={50} />
            <KpiCard icon="hotel" label="Housed" value={kpis.housed} sub={`of ${kpis.total}`} accent={CLR.purple} progress={kpis.total > 0 ? (kpis.housed / kpis.total) * 100 : 0} />
            <KpiCard icon="warning" label="Skills Gap" value={kpis.skillsGap} sub="no recorded skills" accent={kpis.skillsGap > 0 ? CLR.red : CLR.green} progress={kpis.total > 0 ? (kpis.skillsGap / kpis.total) * 100 : 0} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(220px, 1fr)', gap: 16, marginBottom: 16 }}>
            <DashCard>
              <SectionTitle title="Headcount Trend" subtitle="12-month cumulative by start date" />
              <AreaChart points={headcountTrend.points} labels={headcountTrend.labels} color={ACCENT} />
            </DashCard>
            <DashCard>
              <SectionTitle title="Employment Type" subtitle="Distribution" />
              {empTypeDist.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No data</div>
              ) : empTypeDist.map(t => (
                <ProgressRow key={t.label} label={t.label} value={t.count} pct={t.pct} color={ACCENT} />
              ))}
            </DashCard>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <DashCard>
              <SectionTitle title="Tenure Distribution" />
              {tenureBuckets.map(b => (
                <ProgressRow key={b.label} label={b.label} value={b.count} pct={b.pct} color={CLR.blue} />
              ))}
            </DashCard>
            <DashCard>
              <SectionTitle title="Department Headcount (Top 10)" />
              {deptChart.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No departments</div>
              ) : deptChart.map(d => (
                <ProgressRow key={d.department_id} label={d.department_name} value={d.headcount} pct={d.pct} color={ACCENT} />
              ))}
            </DashCard>
          </div>
        </>
      ) : tab === 'departments' ? (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Department', 'Headcount', 'Active', 'On Leave', 'Avg Tenure (days)'].map(h => (
                  <th key={h} style={{ textAlign: h === 'Department' ? 'left' : 'right', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {departments.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: THEME.textLow }}>No departments</td></tr>
              ) : departments.map(d => (
                <tr key={d.department_id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, color: ACCENT }}>{d.department_name}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700 }}>{d.headcount}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: CLR.green, fontWeight: 600 }}>{d.active_count}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: CLR.amber }}>{d.on_leave_count}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.textMed }}>{d.avg_tenure_days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Employee', 'Department', 'Status', 'Meal Cost', 'Housed', 'Fleet Trips', 'Leave Days', 'Skills'].map(h => (
                  <th key={h} style={{ textAlign: ['Employee', 'Department', 'Status'].includes(h) ? 'left' : 'right', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workforce.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: THEME.textLow }}>No data for this period</td></tr>
              ) : workforce.map(w => (
                <tr key={w.employee_id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600, color: THEME.text }}>{w.employee_name}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{w.department || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                      background: w.status === 'active' ? CLR.green + '18' : w.status === 'terminated' ? CLR.red + '18' : CLR.amber + '18',
                      color: w.status === 'active' ? CLR.green : w.status === 'terminated' ? CLR.red : CLR.amber,
                    }}>{(w.status || '—').replace(/_/g, ' ')}</span>
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{w.meal_cost > 0 ? `$${w.meal_cost.toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{w.accommodation_days > 0 ? 'Yes' : '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{w.fleet_trips || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>{w.leave_days || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: w.skills_count === 0 ? CLR.red : CLR.green, fontWeight: 600 }}>{w.skills_count}</td>
                </tr>
              ))}
              {workforce.length > 0 && (
                <tr style={{ borderTop: `2px solid ${THEME.outline}` }}>
                  <td colSpan={3} style={{ padding: 10, fontWeight: 700, textAlign: 'right' }}>Totals</td>
                  <td style={{ padding: 10, textAlign: 'right', fontWeight: 700, color: ACCENT }}>{fmt(kpis.totalMealCost)}</td>
                  <td style={{ padding: 10, textAlign: 'right', fontWeight: 600 }}>{kpis.housed}</td>
                  <td style={{ padding: 10, textAlign: 'right', fontWeight: 600 }}>{kpis.totalTrips}</td>
                  <td style={{ padding: 10, textAlign: 'right', fontWeight: 600 }}>{kpis.totalLeaveDays}</td>
                  <td style={{ padding: 10, textAlign: 'right', fontWeight: 600 }}>{kpis.withSkills}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
