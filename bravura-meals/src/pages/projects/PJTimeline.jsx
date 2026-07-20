import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'

const color = MODULE_COLORS.projects
const DAY_MS = 86400000

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function diffDays(a, b) { return Math.round((b - a) / DAY_MS) }
function fmtDate(d) { return d.toISOString().slice(0, 10) }

const PHASE_COLORS = ['#1565C0', '#2E7D32', '#E65100', '#6A1B9A', '#C62828', '#00838F', '#5D4037', '#D97706']

export default function PJTimeline({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [projects, setProjects] = useState([])
  const [phases, setPhases] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterProject, setFilterProject] = useState('')

  useEffect(() => {
    if (!currentSiteId) return
    fetchAll()
  }, [currentSiteId])

  async function fetchAll() {
    setLoading(true)
    const [pRes, phRes, tRes] = await Promise.all([
      supabase.from('projects').select('id, name, project_code, status, start_date, target_end_date').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('project_phases').select('id, project_id, name, start_date, end_date, status, color, sequence, weight').order('sequence'),
      supabase.from('project_tasks').select('id, project_id, phase_id, title, start_date, due_date, priority, completed_date').eq('is_archived', false),
    ])
    if (pRes.error) showToast(pRes.error.message, 'red')
    setProjects(pRes.data || [])
    setPhases(phRes.data || [])
    setTasks(tRes.data || [])
    setLoading(false)
  }

  const visibleProjects = useMemo(() => {
    if (filterProject) return projects.filter(p => p.id === filterProject)
    return projects
  }, [projects, filterProject])

  const { rows, rangeStart, rangeEnd, totalDays } = useMemo(() => {
    let earliest = null, latest = null
    const allDates = []

    visibleProjects.forEach(p => {
      if (p.start_date) allDates.push(new Date(p.start_date))
      if (p.target_end_date) allDates.push(new Date(p.target_end_date))
    })
    phases.forEach(ph => {
      if (!visibleProjects.find(p => p.id === ph.project_id)) return
      if (ph.start_date) allDates.push(new Date(ph.start_date))
      if (ph.end_date) allDates.push(new Date(ph.end_date))
    })
    tasks.forEach(t => {
      if (!visibleProjects.find(p => p.id === t.project_id)) return
      if (t.start_date) allDates.push(new Date(t.start_date))
      if (t.due_date) allDates.push(new Date(t.due_date))
    })

    if (allDates.length === 0) {
      const now = new Date()
      earliest = addDays(now, -15)
      latest = addDays(now, 45)
    } else {
      earliest = new Date(Math.min(...allDates))
      latest = new Date(Math.max(...allDates))
    }

    earliest = addDays(earliest, -7)
    latest = addDays(latest, 14)
    const totalDays = Math.max(diffDays(earliest, latest), 30)

    const rows = []
    visibleProjects.forEach((proj, pi) => {
      const projPhases = phases.filter(ph => ph.project_id === proj.id)
      const projTasks = tasks.filter(t => t.project_id === proj.id)

      // Project bar
      rows.push({
        type: 'project', id: proj.id, label: proj.name, projectId: proj.id,
        start: proj.start_date ? new Date(proj.start_date) : null,
        end: proj.target_end_date ? new Date(proj.target_end_date) : null,
        color: color, indent: 0, status: proj.status,
        completedPhases: projPhases.filter(p => p.status === 'completed').length,
        totalPhases: projPhases.length,
      })

      projPhases.forEach((ph, phi) => {
        const phColor = ph.color || PHASE_COLORS[phi % PHASE_COLORS.length]
        rows.push({
          type: 'phase', id: ph.id, label: ph.name, projectId: proj.id,
          start: ph.start_date ? new Date(ph.start_date) : null,
          end: ph.end_date ? new Date(ph.end_date) : null,
          color: phColor, indent: 1, status: ph.status,
        })

        const phaseTasks = projTasks.filter(t => t.phase_id === ph.id)
        phaseTasks.forEach(t => {
          rows.push({
            type: 'task', id: t.id, label: t.title, projectId: proj.id,
            start: t.start_date ? new Date(t.start_date) : null,
            end: t.due_date ? new Date(t.due_date) : null,
            color: phColor + '80', indent: 2, completed: !!t.completed_date,
            priority: t.priority,
          })
        })
      })

      // Unphased tasks
      const unphased = projTasks.filter(t => !t.phase_id)
      if (unphased.length > 0) {
        rows.push({ type: 'label', id: `unphased-${proj.id}`, label: 'Unassigned Tasks', indent: 1 })
        unphased.forEach(t => {
          rows.push({
            type: 'task', id: t.id, label: t.title, projectId: proj.id,
            start: t.start_date ? new Date(t.start_date) : null,
            end: t.due_date ? new Date(t.due_date) : null,
            color: '#9E9E9E', indent: 2, completed: !!t.completed_date,
            priority: t.priority,
          })
        })
      }
    })

    return { rows, rangeStart: earliest, rangeEnd: latest, totalDays }
  }, [visibleProjects, phases, tasks])

  const BAR_AREA_W = 800
  const ROW_H = 32
  const LABEL_W = 280

  function pxFor(date) {
    if (!date) return null
    const d = diffDays(rangeStart, date)
    return (d / totalDays) * BAR_AREA_W
  }

  const today = new Date()
  const todayPx = pxFor(today)

  // Month markers
  const months = useMemo(() => {
    const result = []
    const d = new Date(rangeStart)
    d.setDate(1)
    if (d < rangeStart) d.setMonth(d.getMonth() + 1)
    while (d <= rangeEnd) {
      result.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), px: pxFor(d) })
      d.setMonth(d.getMonth() + 1)
    }
    return result
  }, [rangeStart, rangeEnd, totalDays])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_timeline" />
      <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text, marginBottom: '16px' }}>Timeline</div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{
          padding: '7px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
          background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
        }}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {rows.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px', color: THEME.textLow, fontSize: '14px',
          background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
        }}>
          No projects with dates to display. Set start and end dates on your projects and phases.
        </div>
      ) : (
        <div style={{
          background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
          overflow: 'auto',
        }}>
          <div style={{ display: 'flex', minWidth: LABEL_W + BAR_AREA_W + 20 }}>
            {/* Labels column */}
            <div style={{ width: LABEL_W, flexShrink: 0, borderRight: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ height: '28px', borderBottom: `1px solid ${THEME.outlineVar}`, padding: '4px 12px', fontSize: '11px', fontWeight: 700, color: THEME.textLow }}>
                Name
              </div>
              {rows.map(r => (
                <div key={r.id} style={{
                  height: ROW_H, display: 'flex', alignItems: 'center', gap: '6px',
                  paddingLeft: 12 + r.indent * 16, paddingRight: 8,
                  borderBottom: `1px solid ${THEME.outlineVar}20`,
                  cursor: r.type === 'project' ? 'pointer' : 'default',
                }} onClick={() => r.type === 'project' && setPage('pj_detail_' + r.projectId)}>
                  {r.type === 'project' && <span className="material-symbols-rounded" style={{ fontSize: '14px', color }}>folder_open</span>}
                  {r.type === 'phase' && <span className="material-symbols-rounded" style={{ fontSize: '14px', color: r.color }}>radio_button_checked</span>}
                  {r.type === 'task' && <span className="material-symbols-rounded" style={{ fontSize: '12px', color: r.completed ? '#4CAF50' : THEME.textLow }}>{r.completed ? 'check_circle' : 'circle'}</span>}
                  <span style={{
                    fontSize: r.type === 'project' ? '13px' : '12px',
                    fontWeight: r.type === 'project' ? 700 : r.type === 'phase' ? 600 : 400,
                    color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: r.completed ? 'line-through' : 'none',
                    opacity: r.completed ? 0.6 : 1,
                  }}>{r.label}</span>
                  {r.type === 'project' && r.totalPhases > 0 && (
                    <span style={{ fontSize: '10px', color: THEME.textLow, marginLeft: 'auto', flexShrink: 0 }}>
                      {r.completedPhases}/{r.totalPhases}
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Bar area */}
            <div style={{ flex: 1, position: 'relative', minWidth: BAR_AREA_W }}>
              {/* Month headers */}
              <div style={{ height: '28px', borderBottom: `1px solid ${THEME.outlineVar}`, position: 'relative' }}>
                {months.map((m, i) => (
                  <div key={i} style={{
                    position: 'absolute', left: m.px, top: 0, height: '100%',
                    borderLeft: `1px solid ${THEME.outlineVar}40`, paddingLeft: '4px',
                    fontSize: '10px', color: THEME.textLow, display: 'flex', alignItems: 'center',
                  }}>{m.label}</div>
                ))}
              </div>

              {/* Rows */}
              {rows.map(r => {
                const startPx = pxFor(r.start)
                const endPx = pxFor(r.end)
                const hasBar = startPx != null && endPx != null && endPx > startPx
                return (
                  <div key={r.id} style={{
                    height: ROW_H, position: 'relative',
                    borderBottom: `1px solid ${THEME.outlineVar}10`,
                  }}>
                    {hasBar && (
                      <div style={{
                        position: 'absolute', left: startPx, top: ROW_H * 0.3,
                        width: Math.max(endPx - startPx, 4), height: ROW_H * 0.4,
                        background: r.color || '#9E9E9E', borderRadius: '4px',
                        opacity: r.completed ? 0.4 : 0.85,
                      }} />
                    )}
                    {startPx != null && !hasBar && (
                      <div style={{
                        position: 'absolute', left: startPx - 4, top: ROW_H * 0.3,
                        width: 8, height: ROW_H * 0.4, background: r.color || '#9E9E9E',
                        borderRadius: '4px', opacity: 0.6,
                      }} />
                    )}
                  </div>
                )
              })}

              {/* Today line */}
              {todayPx != null && todayPx >= 0 && todayPx <= BAR_AREA_W && (
                <div style={{
                  position: 'absolute', left: todayPx, top: 0, bottom: 0,
                  width: '2px', background: '#F44336', opacity: 0.7, zIndex: 2,
                  borderLeft: '1px dashed #F44336',
                }}>
                  <div style={{
                    position: 'absolute', top: 0, left: -14, fontSize: '9px',
                    color: '#F44336', fontWeight: 700, background: THEME.surface,
                    padding: '0 3px', borderRadius: '3px',
                  }}>Today</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
