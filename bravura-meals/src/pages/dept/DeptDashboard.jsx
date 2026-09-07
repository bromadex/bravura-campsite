import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard, KpiCard } from '../../components/dash'

const color = MODULE_COLORS.dept || '#1565C0'

const ACCENT = { green: '#2E7D32', blue: '#1E88E5', amber: '#D97706', red: '#E53935' }

export default function DeptDashboard({ setPage }) {
  const { currentSiteId } = useSite()
  const [loading, setLoading] = useState(true)
  const [departments, setDepartments] = useState([])
  const [kpis, setKpis] = useState({ projects: 0, myTasks: 0, overdue: 0, completed: 0 })
  const [recentTasks, setRecentTasks] = useState([])

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [deptRes, projRes, tasksRes] = await Promise.all([
        supabase.from('departments').select('*').eq('site_id', currentSiteId).eq('is_archived', false),
        supabase.from('dept_projects').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('is_archived', false),
        supabase.from('dept_tasks').select('*, project:dept_projects!inner(site_id)').eq('project.site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }).limit(50),
      ])
      if (cancelled) return
      setDepartments(deptRes.data || [])
      const tasks = tasksRes.data || []
      const today = new Date().toISOString().slice(0, 10)
      setKpis({
        projects: projRes.count || 0,
        myTasks: tasks.length,
        overdue: tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'completed').length,
        completed: tasks.filter(t => t.status === 'completed').length,
      })
      setRecentTasks(tasks.slice(0, 8))
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId])

  const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }
  const STATUS_LABEL = { not_started: 'Not Started', in_progress: 'In Progress', late: 'Late', completed: 'Completed' }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, marginBottom: '20px' }}>
        Department Workspaces
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        <KpiCard icon="folder_open" label="Active Projects" value={loading ? '…' : kpis.projects} accent={ACCENT.blue} />
        <KpiCard icon="task_alt" label="Total Tasks" value={loading ? '…' : kpis.myTasks} accent={ACCENT.green} />
        <KpiCard icon="warning" label="Overdue" value={loading ? '…' : kpis.overdue} accent={ACCENT.red} />
        <KpiCard icon="check_circle" label="Completed" value={loading ? '…' : kpis.completed} accent={ACCENT.green} />
      </div>

      {departments.length > 0 && (
        <DashCard style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Departments</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {departments.map(d => (
              <div key={d.id} style={{
                padding: '10px 16px', borderRadius: '12px', background: (d.color || color) + '14',
                display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
              }} onClick={() => setPage('dept_projects')}>
                <Icon name={d.icon || 'domain'} size={18} style={{ color: d.color || color }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: d.color || color }}>{d.name}</span>
              </div>
            ))}
          </div>
        </DashCard>
      )}

      <DashCard>
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Recent Tasks</div>
        {loading ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
        ) : recentTasks.length === 0 ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>No tasks yet. Create a project to get started.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {recentTasks.map(t => (
              <div key={t.id} style={{
                display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px',
                borderRadius: '10px', background: THEME.surfaceVar + '60',
              }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: PRIORITY_CLR[t.priority] || '#78909C', flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: '13px', color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
                <div style={{ fontSize: '11px', color: THEME.textLow, whiteSpace: 'nowrap' }}>{STATUS_LABEL[t.status] || t.status}</div>
                {t.due_date && <div style={{ fontSize: '11px', color: THEME.textLow }}>{t.due_date}</div>}
              </div>
            ))}
          </div>
        )}
      </DashCard>
    </div>
  )
}
