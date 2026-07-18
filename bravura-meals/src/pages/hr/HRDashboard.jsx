import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Icon, PageHeader, Button, showToast, fmtDate } from '../../components/ui'
import { DashCard, KpiCard, AreaChart, DonutGauge, ActivityRow, SectionTitle } from '../../components/dash'
import QuickNav, { HR_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.workforce

// Literal hexes so the accent+'18' tint pattern works
const CLR = {
  green: '#2E7D32',
  blue:  '#1E88E5',
  amber: '#F59E0B',
  red:   '#D32F2F',
}

// Icon/colour meta for status-change activity rows
function statusMeta(newStatus) {
  switch (newStatus) {
    case 'active':     return { icon: 'check_circle', clr: CLR.green }
    case 'terminated': return { icon: 'person_off',   clr: CLR.red }
    case 'on_leave':
    case 'long_leave': return { icon: 'beach_access', clr: CLR.amber }
    case 'suspended':  return { icon: 'pause_circle', clr: CLR.amber }
    default:           return { icon: 'swap_horiz',   clr: CLR.blue }
  }
}

const statusLabel = s => (s || '—').replaceAll('_', ' ')

export default function HRDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, active: 0, onLeave: 0, newThisMonth: 0, terminatedThisMonth: 0 })
  const [employees, setEmployees] = useState([])
  const [activity, setActivity] = useState([])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetchAll()
  }, [currentSiteId])

  async function fetchAll() {
    setLoading(true)
    try {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

      const { data: emps, error: empErr } = await supabase
        .from('employees')
        .select('id, status, start_date, is_archived')
        .eq('site_id', currentSiteId)
      if (empErr) throw empErr

      const rows = (emps || []).filter(e => !e.is_archived)
      const total = rows.length
      const active = rows.filter(e => e.status === 'active').length
      const onLeave = rows.filter(e => e.status === 'on_leave' || e.status === 'long_leave').length
      const newThisMonth = rows.filter(e => e.start_date && e.start_date >= iso(monthStart) && e.start_date <= iso(monthEnd)).length

      const { count: termCount, error: termErr } = await supabase
        .from('employee_status_history')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', currentSiteId)
        .eq('new_status', 'terminated')
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString())
      if (termErr) throw termErr

      setStats({ total, active, onLeave, newThisMonth, terminatedThisMonth: termCount || 0 })
      setEmployees(rows)

      const { data: hist, error: histErr } = await supabase
        .from('employee_status_history')
        .select('id, old_status, new_status, reason, effective_date, changed_by, created_at, employee:employees(id, name)')
        .eq('site_id', currentSiteId)
        .order('created_at', { ascending: false })
        .limit(10)
      if (histErr) throw histErr

      let rowsOut = hist || []
      const ids = [...new Set(rowsOut.map(h => h.changed_by).filter(Boolean))]
      if (ids.length) {
        const { data: profs, error: profErr } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', ids)
        if (profErr) throw profErr
        const byId = Object.fromEntries((profs || []).map(p => [p.id, p.full_name]))
        rowsOut = rowsOut.map(h => ({ ...h, changed_by_name: byId[h.changed_by] || null }))
      }
      setActivity(rowsOut)
    } catch (err) {
      console.error('HRDashboard fetch failed:', err)
      showToast('Failed to load HR dashboard', 'red')
    }
    setLoading(false)
  }

  // Cumulative headcount over the last 12 months, from start dates
  const headcountSeries = useMemo(() => {
    const now = new Date()
    const points = [], labels = []
    for (let i = 11; i >= 0; i--) {
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0)
      const endIso = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`
      points.push(employees.filter(e => e.start_date && e.start_date <= endIso).length)
      labels.push(end.toLocaleDateString(undefined, { month: 'short' }))
    }
    return { points, labels }
  }, [employees])

  const activePct = stats.total > 0 ? (stats.active / stats.total) * 100 : null

  if (!can('hr.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view the HR dashboard.
        </div>
      </Card>
    )
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="HR Dashboard"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Button variant="outlined" icon="groups" onClick={() => setPage('wf_employees')}>View All Employees</Button>
            <Button variant="outlined" icon="account_tree" onClick={() => setPage('wf_departments')}>Departments</Button>
            {can('hr.create') && (
              <Button icon="person_add" onClick={() => setPage('wf_employee_form')} style={{ background: ACCENT, border: `1px solid ${ACCENT}` }}>
                Add Employee
              </Button>
            )}
          </div>
        }
      />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard
          label="Total Employees"
          value={loading ? '…' : stats.total}
          sub="excluding archived"
          icon="groups"
          accent={ACCENT}
          progress={stats.total > 0 ? 100 : 0}
          onClick={() => setPage('wf_employees')}
        />
        <KpiCard
          label="Active"
          value={loading ? '…' : stats.active}
          sub={activePct !== null ? `${activePct.toFixed(0)}% of headcount` : 'no employees yet'}
          icon="check_circle"
          accent={CLR.green}
          progress={activePct ?? 0}
          onClick={() => setPage('wf_employees')}
        />
        <KpiCard
          label="On Leave"
          value={loading ? '…' : stats.onLeave}
          sub="incl. long leave"
          icon="beach_access"
          accent={CLR.amber}
          progress={stats.total > 0 ? (stats.onLeave / stats.total) * 100 : 0}
        />
        <KpiCard
          label="New This Month"
          value={loading ? '…' : stats.newThisMonth}
          sub="started this month"
          icon="person_add"
          accent={CLR.blue}
          progress={stats.total > 0 ? (stats.newThisMonth / stats.total) * 100 : 0}
        />
        <KpiCard
          label="Terminated This Month"
          value={loading ? '…' : stats.terminatedThisMonth}
          sub="status changes"
          icon="person_off"
          accent={CLR.red}
          progress={stats.total > 0 ? (stats.terminatedThisMonth / stats.total) * 100 : 0}
        />
      </div>

      {/* Headcount trend + active gauge */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(220px, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Headcount Trend" subtitle="Cumulative headcount by start date — last 12 months" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px', padding: '20px 0' }}>Loading…</div>
          ) : (
            <AreaChart points={headcountSeries.points} labels={headcountSeries.labels} color={ACCENT} />
          )}
        </DashCard>
        <DashCard>
          <SectionTitle title="Workforce Status" subtitle="Share of employees active" />
          <DonutGauge
            pct={activePct}
            color={CLR.green}
            label="active"
            legend={[[CLR.green, `Active ${stats.active}`], [CLR.amber, `On leave ${stats.onLeave}`]]}
          />
        </DashCard>
      </div>

      {/* Recent activity */}
      <div style={{ marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Recent Activity" subtitle="Latest employee status changes" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
          ) : activity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.textLow, fontSize: '13px' }}>
              No status changes recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {activity.map((h, i) => {
                const meta = statusMeta(h.new_status)
                return (
                  <ActivityRow
                    key={h.id}
                    icon={meta.icon}
                    iconColor={meta.clr}
                    title={h.employee?.name || 'Unknown'}
                    sub={`${statusLabel(h.old_status)} → ${statusLabel(h.new_status)}${h.changed_by_name ? ` · by ${h.changed_by_name}` : ''}`}
                    right={fmtDate((h.effective_date || h.created_at || '').slice(0, 10))}
                    rightColor={THEME.textMed}
                    isLast={i === activity.length - 1}
                  />
                )
              })}
            </div>
          )}
        </DashCard>
      </div>
    </div>
  )
}
