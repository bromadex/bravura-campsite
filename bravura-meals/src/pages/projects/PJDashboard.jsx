import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { KpiCard, DashCard, DonutGauge, AreaChart, ProgressRow, ActivityRow, SectionTitle } from '../../components/dash'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.projects

const STATUS_COLORS = {
  planning:  '#1565C0',
  active:    '#2E7D32',
  on_hold:   '#E65100',
  completed: '#6A1B9A',
  cancelled: '#B71C1C',
}

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function PJDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('projects', { column: 'site_id', value: currentSiteId }, fetchAll)

  const [projects, setProjects] = useState([])
  const [phases, setPhases] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  async function fetchAll() {
    if (!currentSiteId) return
    setLoading(true)
    const [pRes, phRes, mRes] = await Promise.all([
      supabase.from('projects').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('project_phases').select('id, project_id, status, weight').order('sequence'),
      supabase.from('project_members').select('id, project_id, role, is_active'),
    ])
    if (pRes.error) showToast(pRes.error.message, 'red')
    setProjects(pRes.data || [])
    setPhases(phRes.data || [])
    setMembers(mRes.data || [])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [currentSiteId])

  const kpis = useMemo(() => {
    const active = projects.filter(p => p.status === 'active')
    const overdue = projects.filter(p => p.status === 'active' && p.target_end_date && new Date(p.target_end_date) < new Date())
    const totalBudget = projects.reduce((s, p) => s + Number(p.budget || 0), 0)
    return {
      total: projects.length,
      active: active.length,
      overdue: overdue.length,
      planning: projects.filter(p => p.status === 'planning').length,
      completed: projects.filter(p => p.status === 'completed').length,
      totalBudget,
    }
  }, [projects])

  const statusBreakdown = useMemo(() => {
    const counts = {}
    projects.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1 })
    return Object.entries(counts).map(([status, count]) => ({
      status, count, pct: projects.length > 0 ? (count / projects.length) * 100 : 0,
    }))
  }, [projects])

  const topByBudget = useMemo(() =>
    [...projects].filter(p => p.budget > 0).sort((a, b) => Number(b.budget) - Number(a.budget)).slice(0, 5),
  [projects])

  const recentProjects = useMemo(() => projects.slice(0, 8), [projects])

  const phaseProgress = useMemo(() => {
    const byProject = {}
    phases.forEach(ph => {
      if (!byProject[ph.project_id]) byProject[ph.project_id] = { total: 0, completed: 0 }
      byProject[ph.project_id].total += ph.weight || 1
      if (ph.status === 'completed') byProject[ph.project_id].completed += ph.weight || 1
    })
    return byProject
  }, [phases])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const activePct = kpis.total > 0 ? (kpis.active / kpis.total) * 100 : null

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_dashboard" />

      <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text, marginBottom: '16px' }}>Project Dashboard</div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard label="Total Projects" value={kpis.total} icon="folder_open" accent={color} />
        <KpiCard label="Active" value={kpis.active} icon="play_circle" accent="#2E7D32" progress={activePct} />
        <KpiCard label="Planning" value={kpis.planning} icon="edit_note" accent="#1565C0" />
        <KpiCard label="Completed" value={kpis.completed} icon="task_alt" accent="#6A1B9A" />
        <KpiCard label="Overdue" value={kpis.overdue} icon="warning" accent="#C62828" />
        <KpiCard label="Total Budget" value={fmtMoney(kpis.totalBudget)} icon="account_balance" accent="#E65100" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        {/* Status Breakdown */}
        <DashCard>
          <SectionTitle title="Status Breakdown" subtitle="Project distribution by status" />
          {kpis.total > 0 ? (
            <DonutGauge
              pct={activePct}
              color={color}
              label="active"
              legend={statusBreakdown.map(s => [STATUS_COLORS[s.status] || color, `${s.status.charAt(0).toUpperCase() + s.status.slice(1).replace('_', ' ')} ${s.count}`])}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>No projects yet</div>
          )}
        </DashCard>

        {/* Top Projects by Budget */}
        <DashCard>
          <SectionTitle title="Top Projects by Budget" subtitle="Highest budget allocations" />
          {topByBudget.length > 0 ? topByBudget.map((p, i) => {
            const maxBudget = topByBudget[0].budget
            return (
              <ProgressRow
                key={p.id}
                label={p.name}
                value={fmtMoney(p.budget)}
                pct={(Number(p.budget) / Number(maxBudget)) * 100}
                color={color}
              />
            )
          }) : (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>No budgets set</div>
          )}
        </DashCard>
      </div>

      {/* Recent Projects */}
      <DashCard>
        <SectionTitle
          title="Recent Projects"
          subtitle={`${projects.length} total projects`}
          action={can('projects.create') ? (
            <button onClick={() => setPage('pj_projects')} style={{
              padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              View All
            </button>
          ) : null}
        />
        {recentProjects.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>
            No projects yet. Create your first project to get started.
          </div>
        ) : recentProjects.map((p, i) => {
          const prog = phaseProgress[p.id]
          const pct = prog && prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0
          const memberCount = members.filter(m => m.project_id === p.id && m.is_active).length
          return (
            <ActivityRow
              key={p.id}
              icon="folder_open"
              iconColor={STATUS_COLORS[p.status] || color}
              title={p.name}
              sub={`${p.project_code} · ${p.status.replace('_', ' ')} · ${memberCount} member${memberCount !== 1 ? 's' : ''} · ${pct}% complete`}
              right={p.budget ? fmtMoney(p.budget) : '-'}
              rightColor={THEME.text}
              isLast={i === recentProjects.length - 1}
            />
          )
        })}
      </DashCard>
    </div>
  )
}
