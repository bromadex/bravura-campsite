import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'

const color = MODULE_COLORS.projects

const PRIORITY_COLORS = { low: '#4CAF50', medium: '#FF9800', high: '#F44336', critical: '#9C27B0' }

export default function PJTasks({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()

  const [tasks, setTasks] = useState([])
  const [projects, setProjects] = useState([])
  const [columns, setColumns] = useState([])
  const [checklists, setChecklists] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterPriority, setFilterPriority] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [sortBy, setSortBy] = useState('due_date')

  useEffect(() => {
    if (!currentSiteId) return
    fetchAll()
  }, [currentSiteId])

  async function fetchAll() {
    setLoading(true)
    const [pRes, tRes, cRes, clRes] = await Promise.all([
      supabase.from('projects').select('id, name, project_code, status').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('project_tasks').select('*').eq('is_archived', false),
      supabase.from('project_board_columns').select('id, project_id, name, is_done_column'),
      supabase.from('project_task_checklist').select('id, task_id, checked'),
    ])
    if (pRes.error) showToast(pRes.error.message, 'red')
    const projIds = new Set((pRes.data || []).map(p => p.id))
    setProjects(pRes.data || [])
    setTasks((tRes.data || []).filter(t => projIds.has(t.project_id)))
    setColumns(cRes.data || [])
    setChecklists(clRes.data || [])
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

  const checkMap = useMemo(() => {
    const m = {}
    checklists.forEach(c => {
      if (!m[c.task_id]) m[c.task_id] = { total: 0, done: 0 }
      m[c.task_id].total++
      if (c.checked) m[c.task_id].done++
    })
    return m
  }, [checklists])

  const filtered = useMemo(() => {
    let list = [...tasks]
    if (filterPriority) list = list.filter(t => t.priority === filterPriority)
    if (filterProject) list = list.filter(t => t.project_id === filterProject)
    // Sort
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
      return new Date(b.created_at) - new Date(a.created_at)
    })
    return list
  }, [tasks, filterPriority, filterProject, sortBy])

  const grouped = useMemo(() => {
    const g = {}
    filtered.forEach(t => {
      const proj = projMap[t.project_id]
      const key = proj ? proj.name : 'Unknown'
      if (!g[key]) g[key] = { projectId: t.project_id, tasks: [] }
      g[key].tasks.push(t)
    })
    return g
  }, [filtered, projMap])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_tasks" />
      <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text, marginBottom: '16px' }}>My Tasks</div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{
          padding: '7px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
          background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
        }}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{
          padding: '7px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
          background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
        }}>
          <option value="">All Priorities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
          padding: '7px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
          background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
        }}>
          <option value="due_date">Sort: Due Date</option>
          <option value="priority">Sort: Priority</option>
          <option value="created">Sort: Recently Created</option>
        </select>
        <div style={{ color: THEME.textLow, fontSize: '12px', marginLeft: 'auto' }}>{filtered.length} task{filtered.length !== 1 ? 's' : ''}</div>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px', color: THEME.textLow, fontSize: '14px',
          background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
        }}>
          No tasks found.
        </div>
      ) : Object.entries(grouped).map(([projName, { projectId, tasks: projTasks }]) => (
        <div key={projName} style={{ marginBottom: '20px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
            cursor: 'pointer',
          }} onClick={() => setPage('pj_detail_' + projectId)}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px', color }}>folder_open</span>
            <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.text }}>{projName}</div>
            <div style={{ fontSize: '12px', color: THEME.textLow }}>{projTasks.length} task{projTasks.length !== 1 ? 's' : ''}</div>
          </div>

          <div style={{
            background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
            overflow: 'hidden',
          }}>
            {projTasks.map((t, i) => {
              const col = colMap[t.column_id]
              const cl = checkMap[t.id]
              const overdue = t.due_date && t.due_date < today && !t.completed_date
              const doneCol = col?.is_done_column
              return (
                <div key={t.id} onClick={() => setPage('pj_detail_' + t.project_id)} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                  borderBottom: i < projTasks.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                  cursor: 'pointer', borderLeft: `3px solid ${PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.medium}`,
                  opacity: doneCol ? 0.6 : 1,
                }}>
                  <span className="material-symbols-rounded" style={{
                    fontSize: '18px', color: doneCol ? '#4CAF50' : THEME.textLow,
                  }}>{doneCol ? 'check_circle' : 'radio_button_unchecked'}</span>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '13px', fontWeight: 600, color: THEME.text,
                      textDecoration: doneCol ? 'line-through' : 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{t.title}</div>
                    <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
                      {col?.name || '—'}
                      {t.due_date && (
                        <span style={{ marginLeft: '8px', color: overdue ? '#F44336' : THEME.textLow }}>
                          {overdue ? '⚠ ' : ''}{t.due_date}
                        </span>
                      )}
                    </div>
                  </div>

                  {cl && (
                    <div style={{ fontSize: '11px', color: THEME.textLow, display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>checklist</span>
                      {cl.done}/{cl.total}
                    </div>
                  )}

                  <div style={{
                    padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
                    background: (PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.medium) + '18',
                    color: PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.medium,
                    textTransform: 'capitalize', flexShrink: 0,
                  }}>{t.priority}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
