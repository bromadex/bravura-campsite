import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { DashCard } from '../../components/dash'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'

const color = MODULE_COLORS.projects
const PRIORITY_COLORS = { low: '#4CAF50', medium: '#FF9800', high: '#F44336', critical: '#9C27B0' }

function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate() + n); return d }
function diffDays(a, b) { return Math.round((new Date(b) - new Date(a)) / 86400000) }

const ZOOM_OPTIONS = [
  { id: '1m', label: '1 Month', days: 30 },
  { id: '3m', label: '3 Months', days: 90 },
  { id: '6m', label: '6 Months', days: 180 },
  { id: '1y', label: '1 Year', days: 365 },
  { id: 'auto', label: 'Auto', days: 0 },
]

export default function PJTimeline({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [projects, setProjects] = useState([])
  const [phases, setPhases] = useState([])
  const [tasks, setTasks] = useState([])
  const [deps, setDeps] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterProject, setFilterProject] = useState('')
  const [zoom, setZoom] = useState('auto')

  useEffect(() => {
    if (!currentSiteId || !can('projects.view')) return
    fetchData()
  }, [currentSiteId])

  async function fetchData() {
    setLoading(true)
    const { data: projs } = await supabase.from('projects').select('id, name, project_code, start_date, target_end_date')
      .eq('site_id', currentSiteId).eq('is_archived', false)
    const projList = projs || []
    setProjects(projList)
    if (!projList.length) { setLoading(false); return }

    const projIds = projList.map(p => p.id)
    const [phRes, tRes, dRes] = await Promise.all([
      supabase.from('project_phases').select('*').in('project_id', projIds).order('sequence'),
      supabase.from('project_tasks').select('id, project_id, phase_id, title, start_date, due_date, priority, completed_date, is_archived, planned_duration')
        .in('project_id', projIds).eq('is_archived', false),
      supabase.from('project_task_dependencies').select('task_id, depends_on_id'),
    ])
    setPhases(phRes.data || [])
    setTasks(tRes.data || [])
    setDeps(dRes.data || [])
    setLoading(false)
  }

  const visibleProjects = useMemo(() => {
    if (filterProject) return projects.filter(p => p.id === filterProject)
    return projects
  }, [projects, filterProject])

  // Build rows: phase (bold) then tasks under each
  const rows = useMemo(() => {
    const result = []
    visibleProjects.forEach(proj => {
      const projPhases = phases.filter(p => p.project_id === proj.id)
      const projTasks = tasks.filter(t => t.project_id === proj.id)

      if (projPhases.length === 0) {
        projTasks.forEach(t => {
          if (t.start_date || t.due_date) {
            result.push({ type: 'task', label: t.title, start: t.start_date, end: t.due_date, color: PRIORITY_COLORS[t.priority] || '#999', projectId: proj.id, taskId: t.id, done: !!t.completed_date, isMilestone: isMilestone(t) })
          }
        })
      } else {
        projPhases.forEach(ph => {
          const phaseTasks = projTasks.filter(t => t.phase_id === ph.id)
          const completedTasks = phaseTasks.filter(t => t.completed_date)
          const pct = phaseTasks.length > 0 ? Math.round((completedTasks.length / phaseTasks.length) * 100) : (ph.status === 'completed' ? 100 : 0)
          if (ph.start_date || ph.end_date) {
            result.push({
              type: 'phase', label: ph.name, start: ph.start_date, end: ph.end_date,
              color: ph.color || color, projectId: proj.id, pct,
              projectName: proj.name,
            })
          }
          phaseTasks.filter(t => t.start_date || t.due_date).forEach(t => {
            result.push({ type: 'task', label: t.title, start: t.start_date, end: t.due_date, color: PRIORITY_COLORS[t.priority] || '#999', projectId: proj.id, taskId: t.id, done: !!t.completed_date, isMilestone: isMilestone(t) })
          })
        })
        // Unphased tasks
        projTasks.filter(t => !t.phase_id && (t.start_date || t.due_date)).forEach(t => {
          result.push({ type: 'task', label: t.title, start: t.start_date, end: t.due_date, color: PRIORITY_COLORS[t.priority] || '#999', projectId: proj.id, taskId: t.id, done: !!t.completed_date, isMilestone: isMilestone(t) })
        })
      }
    })
    return result
  }, [visibleProjects, phases, tasks])

  function isMilestone(t) {
    // Zero duration: same start/end or no duration
    if (t.start_date && t.due_date && t.start_date === t.due_date) return true
    if (t.planned_duration === 0) return true
    if (!t.due_date && t.start_date && !t.planned_duration) return true
    return false
  }

  // Task id -> row index map for dependency arrows
  const taskRowMap = useMemo(() => {
    const m = {}
    rows.forEach((r, i) => { if (r.taskId) m[r.taskId] = i })
    return m
  }, [rows])

  // Calculate timeline range
  const { rangeStart, rangeEnd, totalDays } = useMemo(() => {
    const today = new Date()
    const zoomOpt = ZOOM_OPTIONS.find(z => z.id === zoom)

    if (zoom !== 'auto' && zoomOpt) {
      const rs = addDays(today, -Math.round(zoomOpt.days * 0.2))
      const re = addDays(today, Math.round(zoomOpt.days * 0.8))
      return { rangeStart: rs, rangeEnd: re, totalDays: zoomOpt.days }
    }

    let earliest = new Date(today), latest = new Date(today)
    rows.forEach(r => {
      if (r.start) { const d = new Date(r.start); if (d < earliest) earliest = d }
      if (r.end) { const d = new Date(r.end); if (d > latest) latest = d }
    })
    const rs = addDays(earliest, -7)
    const re = addDays(latest, 14)
    return { rangeStart: rs, rangeEnd: re, totalDays: Math.max(diffDays(rs, re), 30) }
  }, [rows, zoom])

  const ROW_H = 32
  const LABEL_W = 220
  const CHART_W = 800
  const today = new Date()
  const todayX = LABEL_W + (diffDays(rangeStart, today) / totalDays) * CHART_W

  // Month markers
  const months = useMemo(() => {
    const result = []
    const d = new Date(rangeStart)
    d.setDate(1)
    if (d < rangeStart) d.setMonth(d.getMonth() + 1)
    while (d <= rangeEnd) {
      const x = LABEL_W + (diffDays(rangeStart, d) / totalDays) * CHART_W
      result.push({ x, label: d.toLocaleDateString('en', { month: 'short', year: '2-digit' }) })
      d.setMonth(d.getMonth() + 1)
    }
    return result
  }, [rangeStart, rangeEnd, totalDays])

  // Dependency arrows
  const depArrows = useMemo(() => {
    const arrows = []
    deps.forEach(dep => {
      const fromIdx = taskRowMap[dep.depends_on_id]
      const toIdx = taskRowMap[dep.task_id]
      if (fromIdx === undefined || toIdx === undefined) return
      const fromRow = rows[fromIdx]
      const toRow = rows[toIdx]
      if (!fromRow || !toRow) return
      const fromEnd = fromRow.end || fromRow.start
      const toStart = toRow.start || toRow.end
      if (!fromEnd || !toStart) return

      const fromX = LABEL_W + (diffDays(rangeStart, new Date(fromEnd)) / totalDays) * CHART_W
      const fromY = 35 + fromIdx * ROW_H + (fromRow.type === 'phase' ? 12 : 12)
      const toX = LABEL_W + (diffDays(rangeStart, new Date(toStart)) / totalDays) * CHART_W
      const toY = 35 + toIdx * ROW_H + (toRow.type === 'phase' ? 12 : 12)

      arrows.push({ fromX, fromY, toX, toY })
    })
    return arrows
  }, [deps, taskRowMap, rows, rangeStart, totalDays])

  const inp = {
    padding: '7px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
    background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
  }

  if (!can('projects.view')) {
    return <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>Access denied</div>
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_timeline" />
      <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text, marginBottom: '16px' }}>Project Timeline</div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={inp}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {/* Zoom controls */}
        <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${THEME.outlineVar}` }}>
          {ZOOM_OPTIONS.map(z => (
            <button key={z.id} onClick={() => setZoom(z.id)} style={{
              padding: '5px 10px', fontSize: '11px', fontWeight: 600,
              background: zoom === z.id ? color : 'transparent', color: zoom === z.id ? '#fff' : THEME.textMed,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>{z.label}</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow, fontSize: '13px',
          background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          No phases or tasks with dates to display.
        </div>
      ) : (
        <DashCard style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <svg width={LABEL_W + CHART_W + 20} height={rows.length * ROW_H + 50} style={{ display: 'block' }}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill={THEME.textLow} />
                </marker>
              </defs>

              {/* Month header labels */}
              {months.map((m, i) => (
                <g key={i}>
                  <line x1={m.x} y1={0} x2={m.x} y2={rows.length * ROW_H + 40} stroke={THEME.outlineVar} strokeWidth={1} strokeDasharray="4,4" />
                  <text x={m.x + 4} y={14} fill={THEME.textLow} fontSize={10} fontWeight={600}>{m.label}</text>
                </g>
              ))}

              {/* Today line — prominent */}
              {todayX >= LABEL_W && todayX <= LABEL_W + CHART_W && (
                <g>
                  <rect x={todayX - 1} y={20} width={3} height={rows.length * ROW_H + 20} fill="#F44336" opacity={0.25} rx={1} />
                  <line x1={todayX} y1={20} x2={todayX} y2={rows.length * ROW_H + 40} stroke="#F44336" strokeWidth={2} />
                  <rect x={todayX - 18} y={18} width={36} height={14} rx={3} fill="#F44336" />
                  <text x={todayX} y={28} fill="#fff" fontSize={9} fontWeight={700} textAnchor="middle">Today</text>
                </g>
              )}

              {/* Dependency arrows */}
              {depArrows.map((a, i) => {
                const midX = a.fromX + (a.toX - a.fromX) * 0.5
                return (
                  <path key={'dep' + i}
                    d={`M ${a.fromX} ${a.fromY} C ${midX} ${a.fromY}, ${midX} ${a.toY}, ${a.toX} ${a.toY}`}
                    fill="none" stroke={THEME.textLow} strokeWidth={1.5} strokeDasharray="4,3" opacity={0.6}
                    markerEnd="url(#arrowhead)" />
                )
              })}

              {/* Rows */}
              {rows.map((row, i) => {
                const y = 35 + i * ROW_H
                const start = row.start ? new Date(row.start) : null
                const end = row.end ? new Date(row.end) : start
                if (!start) return null

                const barX = LABEL_W + (diffDays(rangeStart, start) / totalDays) * CHART_W
                const barW = Math.max(((diffDays(start, end || start) || 1) / totalDays) * CHART_W, 6)
                const isPhase = row.type === 'phase'

                return (
                  <g key={i} style={{ cursor: 'pointer' }} onClick={() => setPage('pj_detail_' + row.projectId + (row.taskId ? ':board:' + row.taskId : ''))}>
                    {/* Alternating row bg */}
                    {i % 2 === 0 && <rect x={0} y={y - 4} width={LABEL_W + CHART_W + 20} height={ROW_H} fill={THEME.surfaceVar} rx={0} opacity={0.4} />}

                    {/* Label */}
                    <text x={isPhase ? 8 : 22} y={y + 14} fill={THEME.text} fontSize={isPhase ? 12 : 11}
                      fontWeight={isPhase ? 700 : 400} dominantBaseline="middle">
                      {row.isMilestone ? '◆ ' : ''}{row.label.length > 28 ? row.label.slice(0, 26) + '..' : row.label}
                    </text>

                    {/* Phase completion % */}
                    {isPhase && row.pct !== undefined && (
                      <text x={LABEL_W - 8} y={y + 14} fill={THEME.textLow} fontSize={10} fontWeight={600} textAnchor="end" dominantBaseline="middle">
                        {row.pct}%
                      </text>
                    )}

                    {/* Milestone diamond or bar */}
                    {row.isMilestone ? (
                      <g transform={`translate(${barX}, ${y + 12})`}>
                        <polygon points="0,-8 8,0 0,8 -8,0" fill={row.done ? '#BDBDBD' : row.color} opacity={row.done ? 0.5 : 0.9} />
                      </g>
                    ) : (
                      <>
                        <rect x={barX} y={y + (isPhase ? 3 : 6)} width={barW} height={isPhase ? 18 : 12} rx={isPhase ? 4 : 3}
                          fill={row.done ? '#BDBDBD' : row.color} opacity={row.done ? 0.5 : 0.85} />
                        {/* Phase progress overlay */}
                        {isPhase && row.pct > 0 && (
                          <rect x={barX} y={y + 3} width={barW * (row.pct / 100)} height={18} rx={4}
                            fill={row.color} opacity={1} />
                        )}
                      </>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
        </DashCard>
      )}
    </div>
  )
}
