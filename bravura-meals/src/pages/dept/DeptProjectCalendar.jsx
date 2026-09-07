import { useState, useEffect, useCallback, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'
const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function endOfMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0) }
function fmt(d) { return d.toISOString().slice(0, 10) }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth() + n, 1) }

export default function DeptProjectCalendar({ setPage, projectId }) {
  const { currentSiteId } = useSite()
  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(startOfMonth(new Date()))

  const load = useCallback(async () => {
    if (!projectId || !currentSiteId) return
    setLoading(true)
    const [projRes, taskRes] = await Promise.all([
      supabase.from('dept_projects').select('*, department:departments(id, name, color, icon)').eq('id', projectId).maybeSingle(),
      supabase.from('dept_tasks').select('*, assignee:employees!dept_tasks_assigned_to_fkey(id, first_name, last_name)').eq('project_id', projectId).eq('is_archived', false),
    ])
    setProject(projRes.data)
    setTasks(taskRes.data || [])
    setLoading(false)
  }, [projectId, currentSiteId])

  useEffect(() => { load() }, [load])

  const { calendarDays, unscheduled } = useMemo(() => {
    const start = startOfMonth(month)
    const end = endOfMonth(month)
    const firstDay = start.getDay()
    const days = []

    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let d = 1; d <= end.getDate(); d++) {
      const dateStr = fmt(new Date(month.getFullYear(), month.getMonth(), d))
      const dayTasks = tasks.filter(t => {
        if (!t.due_date && !t.start_date) return false
        const s = t.start_date || t.due_date
        const e = t.due_date || t.start_date
        return dateStr >= s && dateStr <= e
      })
      days.push({ day: d, date: dateStr, tasks: dayTasks })
    }

    const unsched = tasks.filter(t => !t.due_date && !t.start_date)
    return { calendarDays: days, unscheduled: unsched }
  }, [month, tasks])

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
  if (!project) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Project not found.</div>

  const dc = project.department?.color || color
  const today = fmt(new Date())

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button onClick={() => setPage('dept_projects')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}>
          <Icon name="arrow_back" size={20} />
        </button>
        <Icon name={project.department?.icon || 'folder'} size={22} style={{ color: dc }} />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 500, color: THEME.text }}>{project.name} — Calendar</div>
          <div style={{ fontSize: '12px', color: dc }}>{project.department?.name}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => setPage(`dept_board:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer' }}>Board</button>
          <button onClick={() => setPage(`dept_grid:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer' }}>Grid</button>
        </div>
      </div>

      {/* Month nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <button onClick={() => setMonth(addMonths(month, -1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="chevron_left" size={24} /></button>
        <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text, minWidth: '180px', textAlign: 'center' }}>
          {month.toLocaleString('default', { month: 'long', year: 'numeric' })}
        </div>
        <button onClick={() => setMonth(addMonths(month, 1))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="chevron_right" size={24} /></button>
        <button onClick={() => setMonth(startOfMonth(new Date()))} style={{ padding: '4px 12px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer' }}>Today</button>
      </div>

      <div style={{ display: 'flex', gap: '16px' }}>
        {/* Calendar grid */}
        <div style={{ flex: 1, background: THEME.surface, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px' }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', padding: '8px', fontSize: '11px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase' }}>{d}</div>
            ))}
            {calendarDays.map((cell, i) => (
              <div key={i} style={{
                minHeight: '80px', padding: '4px', borderRadius: '8px',
                background: cell?.date === today ? dc + '10' : 'transparent',
                border: cell?.date === today ? `1px solid ${dc}40` : `1px solid ${THEME.outlineVar}40`,
              }}>
                {cell && (
                  <>
                    <div style={{ fontSize: '12px', fontWeight: cell.date === today ? 700 : 400, color: cell.date === today ? dc : THEME.text, marginBottom: '2px', padding: '2px 4px' }}>
                      {cell.day}
                    </div>
                    {cell.tasks.slice(0, 3).map(t => (
                      <div key={t.id} style={{
                        fontSize: '10px', padding: '1px 4px', marginBottom: '1px', borderRadius: '3px',
                        background: (PRIORITY_CLR[t.priority] || '#78909C') + '20', color: PRIORITY_CLR[t.priority],
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default',
                      }} title={t.title}>
                        {t.title}
                      </div>
                    ))}
                    {cell.tasks.length > 3 && (
                      <div style={{ fontSize: '9px', color: THEME.textLow, padding: '0 4px' }}>+{cell.tasks.length - 3} more</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Unscheduled sidebar */}
        {unscheduled.length > 0 && (
          <div style={{ width: '220px', flexShrink: 0 }}>
            <div style={{ background: THEME.surface, borderRadius: '16px', padding: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textLow, marginBottom: '10px', textTransform: 'uppercase' }}>Unscheduled</div>
              {unscheduled.map(t => (
                <div key={t.id} style={{ padding: '6px 8px', marginBottom: '4px', borderRadius: '6px', background: THEME.surfaceVar + '60', fontSize: '12px', color: THEME.text, borderLeft: `3px solid ${PRIORITY_CLR[t.priority] || '#78909C'}` }}>
                  {t.title}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
