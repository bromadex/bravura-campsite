import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { DashCard, KpiCard } from '../../components/dash'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'

const color = MODULE_COLORS.projects
const PRIORITY_COLORS = { low: '#4CAF50', medium: '#FF9800', high: '#F44336', critical: '#9C27B0' }

const inp = {
  padding: '7px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
  background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
}

export default function PJTasks({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()

  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [columns, setColumns] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterPriority, setFilterPriority] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAssignee, setFilterAssignee] = useState('')
  const [viewMode, setViewMode] = useState('all')
  const [sortBy, setSortBy] = useState('due_date')

  useEffect(() => {
    if (!currentSiteId) return
    fetchAll()
  }, [currentSiteId])

  async function fetchAll() {
    setLoading(true)
    const [pRes, tRes, cRes, eRes] = await Promise.all([
      supabase.from('projects').select('id, name, project_code, status').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('project_tasks').select('*').eq('is_archived', false),
      supabase.from('project_board_columns').select('id, project_id, name, is_done_column'),
      supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
    ])
    if (pRes.error) showToast(pRes.error.message, 'red')
    const projIds = new Set((pRes.data || []).map(p => p.id))
    setProjects(pRes.data || [])
    setTasks((tRes.data || []).filter(t => projIds.has(t.project_id)))
    setColumns(cRes.data || [])
    setEmployees(eRes.data || [])
    setLoading(false)
  }

  const colMap = useMemo(() => {
    const m = {}
    columns.forEach(c => { m[c.id] = c })
    return m
  }, [columns])

  const projMap = useMemo(() => {
    const m = {}
    projects.forEach(p => { m[p.id] = p })
    return m
  }, [projects])

  const empMap = useMemo(() => {
    const m = {}
    employees.forEach(e => { m[e.id] = e.name })
    return m
  }, [employees])

  const filtered = useMemo(() => {
    let list = [...tasks]
    if (viewMode === 'mine') list = list.filter(t => t.assigned_to === profile?.id)
    if (filterPriority) list = list.filter(t => t.priority === filterPriority)
    if (filterProject) list = list.filter(t => t.project_id === filterProject)
    if (filterAssignee) list = list.filter(t => t.assigned_to === filterAssignee)
    if (filterStatus === 'done') list = list.filter(t => colMap[t.column_id]?.is_done_column || t.percent_complete === 100)
    else if (filterStatus === 'in_progress') list = list.filter(t => (t.percent_complete || 0) > 0 && (t.percent_complete || 0) < 100 && !colMap[t.column_id]?.is_done_column)
    else if (filterStatus === 'not_started') list = list.filter(t => (t.percent_complete || 0) === 0 && !colMap[t.column_id]?.is_done_column)
    else if (filterStatus === 'overdue') list = list.filter(t => t.due_date && new Date(t.due_date) < new Date() && !t.completed_date)

    list.sort((a, b) => {
      if (sortBy === 'due_date') {
        if (!a.due_date && !b.due_date) return 0
        if (!a.due_date) return 1
        if (!b.due_date) return -1
        return new Date(a.due_date) - new Date(b.due_date)
      }
      if (sortBy === 'priority') {
        const order = { critical: 0, high: 1, medium: 2, low: 3 }
        return (order[a.priority] ?? 2) - (order[b.priority] ?? 2)
      }
      if (sortBy === 'percent') return (b.percent_complete || 0) - (a.percent_complete || 0)
      return (a.position || 0) - (b.position || 0)
    })
    return list
  }, [tasks, filterPriority, filterProject, filterAssignee, filterStatus, viewMode, sortBy, colMap, profile])

  const doneTasks = tasks.filter(t => colMap[t.column_id]?.is_done_column || t.percent_complete === 100).length
  const inProgressTasks = tasks.filter(t => (t.percent_complete || 0) > 0 && (t.percent_complete || 0) < 100 && !colMap[t.column_id]?.is_done_column).length
  const overdueTasks = tasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && !t.completed_date).length
  const avgPct = tasks.length > 0 ? Math.round(tasks.reduce((s, t) => s + (t.percent_complete || 0), 0) / tasks.length) : 0

  function exportCSV() {
    const headers = ['#', 'Project', 'Task', 'Status', 'Duration', 'Start', 'Finish', '% Complete', 'Assigned To', 'Priority']
    const rows = filtered.map((t, i) => [
      i + 1, `"${(projMap[t.project_id]?.name || '').replace(/"/g, '""')}"`,
      `"${(t.title || '').replace(/"/g, '""')}"`, colMap[t.column_id]?.name || '',
      t.planned_duration || '', t.start_date || '', t.due_date || '',
      t.percent_complete || 0, `"${empMap[t.assigned_to] || ''}"`, t.priority || ''
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'all_project_tasks.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const assigneesInTasks = useMemo(() => {
    const ids = new Set(tasks.map(t => t.assigned_to).filter(Boolean))
    return employees.filter(e => ids.has(e.id))
  }, [tasks, employees])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_tasks" />

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard label="Total Tasks" value={tasks.length} icon="task" accent={color} />
        <KpiCard label="Completed" value={doneTasks} icon="task_alt" accent="#2E7D32" />
        <KpiCard label="In Progress" value={inProgressTasks} icon="pending" accent="#1565C0" />
        <KpiCard label="Overdue" value={overdueTasks} icon="warning" accent={overdueTasks > 0 ? '#C62828' : '#999'} />
        <KpiCard label="Avg Progress" value={`${avgPct}%`} icon="speed" accent="#E65100" />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${THEME.outlineVar}` }}>
            {[{ id: 'all', label: 'All Tasks' }, { id: 'mine', label: 'My Tasks' }].map(v => (
              <button key={v.id} onClick={() => setViewMode(v.id)} style={{
                padding: '5px 12px', fontSize: '12px', fontWeight: 600,
                background: viewMode === v.id ? color : 'transparent', color: viewMode === v.id ? '#fff' : THEME.textMed,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>{v.label}</button>
            ))}
          </div>
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={inp}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={inp}>
            <option value="">All Statuses</option>
            <option value="done">Completed</option>
            <option value="in_progress">In Progress</option>
            <option value="not_started">Not Started</option>
            <option value="overdue">Overdue</option>
          </select>
          <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={inp}>
            <option value="">All Assignees</option>
            {assigneesInTasks.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={inp}>
            <option value="">All Priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={inp}>
            <option value="due_date">Sort: Due Date</option>
            <option value="priority">Sort: Priority</option>
            <option value="percent">Sort: % Complete</option>
            <option value="position">Sort: Position</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: THEME.textLow }}>{filtered.length} task{filtered.length !== 1 ? 's' : ''}</span>
          <button onClick={exportCSV} style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px',
            fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>download</span>CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <DashCard>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                {['#', 'Project', 'Task Description', 'Status', 'Duration', 'Start', 'Finish', '% Complete', 'Assigned To', 'Priority'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: THEME.textMed, whiteSpace: 'nowrap', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No tasks found.</td></tr>
              ) : filtered.map((t, i) => {
                const col = colMap[t.column_id]
                const colName = col?.name || '—'
                const isOverdue = t.due_date && new Date(t.due_date) < new Date() && !t.completed_date
                const pct = t.percent_complete || 0
                const isDone = col?.is_done_column || pct === 100
                const statusColor = isDone ? '#2E7D32' : pct > 0 ? '#1565C0' : isOverdue ? '#C62828' : THEME.textLow
                const proj = projMap[t.project_id]
                return (
                  <tr key={t.id} onClick={() => setPage('pj_detail_' + t.project_id + ':board:' + t.id)}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', background: isDone ? '#F1F8E9' : isOverdue ? '#FFF8E1' : 'transparent' }}>
                    <td style={{ padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px' }}>{i + 1}</td>
                    <td style={{ padding: '8px 10px', color: color, fontWeight: 600, fontSize: '11px', whiteSpace: 'nowrap' }}>{proj?.project_code || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600, maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: statusColor + '18', color: statusColor, whiteSpace: 'nowrap' }}>{colName}</span>
                    </td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, textAlign: 'center' }}>{t.planned_duration ? `${t.planned_duration}d` : '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.start_date || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.due_date || '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: '70px' }}>
                        <div style={{ flex: 1, height: '5px', borderRadius: '3px', background: THEME.outlineVar, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#2E7D32' : pct >= 50 ? '#1565C0' : '#FF9800', borderRadius: '3px' }} />
                        </div>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: pct >= 100 ? '#2E7D32' : THEME.text, minWidth: '28px' }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      {t.assigned_to ? (
                        <span onClick={e => { e.stopPropagation(); setPage('wf_employee_detail:' + t.assigned_to) }}
                          style={{ fontSize: '12px', fontWeight: 600, color: color, cursor: 'pointer', textDecoration: 'underline' }}>
                          {empMap[t.assigned_to] || 'Unknown'}
                        </span>
                      ) : <span style={{ color: THEME.textLow }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: (PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.medium) + '18', color: PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.medium, textTransform: 'capitalize' }}>{t.priority || 'medium'}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  )
}
