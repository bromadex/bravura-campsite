import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { friendlyError } from '../../utils/friendlyError'
import FinShell from '../../components/FinShell'
import TaskDrawer from '../../components/TaskDrawer'
import { FIN, finBtn2, finInput } from '../../utils/financeTheme'
import { STATUS, usePeople, taskRef } from './pjShared'

// PJ05 Timeline (#76) — a real Gantt: drag a bar to move a task, drag its right edge to change the due date,
// grey bar = baseline, dark line inside = actual start→finish, ◆ = milestone, arrows = "waits for",
// red line = today. Views: Tasks (by project / phase), People and Machines (workload lanes + overload heat).
const DAY = 86400000
const ZOOMS = { day: { px: 30, label: 'Days' }, week: { px: 12, label: 'Weeks' }, month: { px: 4, label: 'Months' } }
const ROW = 34
const LEFT = 300
const toD = s => s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const addD = (d, n) => new Date(d.getTime() + n * DAY)
const today = () => toD(iso(new Date()))

export default function PJTimeline({ setPage, projectId: fixedProject }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const people = usePeople()
  const canEdit = can('projects.edit')
  const [projects, setProjects] = useState([])
  const [project, setProject] = useState(fixedProject || '')
  const [tasks, setTasks] = useState([])
  const [phases, setPhases] = useState([])
  const [deps, setDeps] = useState([])
  const [machines, setMachines] = useState([])   // task ↔ fleet_assets links
  const [view, setView] = useState('tasks')
  const [zoom, setZoom] = useState('week')
  const [showBase, setShowBase] = useState(true)
  const [open, setOpen] = useState(null)
  const [drag, setDrag] = useState(null)   // {id, mode, x0, s0, e0, ds}
  const scroller = useRef(null)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data: ps } = await supabase.from('projects').select('id, name, key, start_date, target_end_date, cover_color')
      .eq('site_id', currentSiteId).eq('is_archived', false).eq('is_template', false).order('name')
    setProjects(ps || [])
    const ids = project ? [project] : (ps || []).map(p => p.id)
    if (!ids.length) { setTasks([]); return }
    const [t, ph, lk] = await Promise.all([
      supabase.from('project_tasks').select('id, project_id, phase_id, parent_task_id, task_no, area_code, title, status, start_date, due_date, baseline_start, baseline_end, actual_start, actual_end, is_milestone, is_critical, percent_complete, assigned_to, priority')
        .in('project_id', ids).eq('is_archived', false).neq('status', 'cancelled').order('task_no'),
      supabase.from('project_phases').select('id, project_id, name, sequence, color').in('project_id', ids).order('sequence'),
      supabase.from('project_task_links').select('task_id, record_id, label').eq('record_table', 'fleet_assets').eq('is_archived', false),
    ])
    const ts = t.data || []
    setTasks(ts); setPhases(ph.data || [])
    const tid = new Set(ts.map(x => x.id))
    setMachines((lk.data || []).filter(l => tid.has(l.task_id)))
    if (ts.length) {
      const { data: d } = await supabase.from('project_task_dependencies').select('task_id, depends_on_id').in('task_id', ts.map(x => x.id))
      setDeps(d || [])
    } else setDeps([])
  }, [currentSiteId, project])
  useEffect(() => { load() }, [load])

  const px = ZOOMS[zoom].px
  const pmap = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p])), [projects])
  const name = id => people.find(p => p.id === id)?.name || 'Unassigned'

  // time range: all dates ± padding
  const [t0, t1] = useMemo(() => {
    const ds = []
    tasks.forEach(t => [t.start_date, t.due_date, t.baseline_start, t.baseline_end].forEach(x => x && ds.push(toD(x))))
    ds.push(today())
    const min = new Date(Math.min(...ds)), max = new Date(Math.max(...ds))
    return [addD(min, -7), addD(max, 21)]
  }, [tasks])
  const days = Math.max(1, Math.round((t1 - t0) / DAY))
  const X = d => Math.round((toD(d) - t0) / DAY) * px
  const width = days * px

  // rows per view
  const rows = useMemo(() => {
    const out = []
    const span = t => {
      const s = t.start_date || t.due_date, e = t.due_date || t.start_date
      return s ? { s, e } : null
    }
    if (view === 'tasks') {
      const byProj = project ? [project] : [...new Set(tasks.map(t => t.project_id))]
      for (const pid of byProj) {
        const pt = tasks.filter(t => t.project_id === pid)
        if (!project) out.push({ kind: 'head', label: pmap[pid]?.name || 'Project', color: pmap[pid]?.cover_color })
        const phs = phases.filter(p => p.project_id === pid)
        const groups = [...phs.map(ph => [ph, pt.filter(t => t.phase_id === ph.id)]), [null, pt.filter(t => !t.phase_id || !phs.some(p => p.id === t.phase_id))]]
        for (const [ph, list] of groups) {
          if (!list.length) continue
          if (ph) out.push({ kind: 'phase', label: ph.name, color: ph.color, tasks: list })
          const ordered = [...list.filter(t => !t.parent_task_id), ...list.filter(t => t.parent_task_id)]
            .sort((a, b) => (toD(a.start_date || a.due_date) || 0) - (toD(b.start_date || b.due_date) || 0))
          for (const t of ordered) out.push({ kind: 'task', t, bars: [t], span: span(t), label: `${taskRef(t)} ${t.title}`, sub: name(t.assigned_to) })
        }
      }
    } else {
      const key = view === 'people' ? (t => t.assigned_to ? [t.assigned_to] : []) :
        (t => machines.filter(m => m.task_id === t.id).map(m => m.record_id))
      const labelOf = view === 'people' ? name : (id => machines.find(m => m.record_id === id)?.label || 'Machine')
      const groups = new Map()
      for (const t of tasks) for (const k of key(t)) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t) }
      for (const [k, list] of [...groups].sort((a, b) => labelOf(a[0]).localeCompare(labelOf(b[0])))) {
        // pack into lanes so overlapping tasks don't cover each other
        const lanes = []
        for (const t of list.filter(span).sort((a, b) => toD(span(a).s) - toD(span(b).s))) {
          const s = toD(span(t).s)
          let lane = lanes.find(l => l.end < s)
          if (!lane) { lane = { end: new Date(0), items: [] }; lanes.push(lane) }
          lane.items.push(t); lane.end = toD(span(t).e)
        }
        // daily load (open tasks) for the heat strip
        const load = {}
        for (const t of list) {
          const sp = span(t); if (!sp || t.status === 'done') continue
          for (let d = toD(sp.s); d <= toD(sp.e); d = addD(d, 1)) { const k2 = iso(d); load[k2] = (load[k2] || 0) + 1 }
        }
        out.push({ kind: 'group', label: labelOf(k), sub: `${list.filter(t => t.status !== 'done').length} open`, load, laneCount: lanes.length })
        lanes.forEach((l, i) => out.push({ kind: 'lane', bars: l.items, label: i === 0 ? '' : '' }))
      }
      const none = view === 'people' ? tasks.filter(t => !t.assigned_to && t.status !== 'done') : []
      if (none.length) out.push({ kind: 'group', label: 'Unassigned', sub: `${none.length} open`, load: {} }, ...none.map(t => ({ kind: 'lane', bars: [t] })))
    }
    return out
  }, [view, tasks, phases, machines, project, pmap, people])  // eslint-disable-line react-hooks/exhaustive-deps

  // row index of each task (for dependency arrows, tasks view only)
  const rowOf = useMemo(() => {
    const m = {}; rows.forEach((r, i) => { if (r.kind === 'task') m[r.t.id] = i }); return m
  }, [rows])

  useEffect(() => {   // start scrolled to a week before today
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, X(iso(addD(today(), -7))) - 20)
  }, [zoom, t0])  // eslint-disable-line react-hooks/exhaustive-deps

  // drag to move / resize
  function startDrag(e, t, mode) {
    if (!canEdit || !(t.start_date || t.due_date)) { setOpen(t.id); return }
    e.stopPropagation(); e.preventDefault()
    setDrag({ id: t.id, mode, x0: e.clientX, s0: t.start_date || t.due_date, e0: t.due_date || t.start_date, ds: 0, moved: false })
  }
  useEffect(() => {
    if (!drag) return
    const mv = e => setDrag(d => ({ ...d, ds: Math.round((e.clientX - d.x0) / px), moved: d.moved || Math.abs(e.clientX - d.x0) > 3 }))
    const up = async () => {
      const d = drag; setDrag(null)
      if (!d.moved || !d.ds) { if (!d.moved) setOpen(d.id); return }
      const s = d.mode === 'move' ? iso(addD(toD(d.s0), d.ds)) : d.s0
      let e = iso(addD(toD(d.e0), d.ds))
      if (toD(e) < toD(s)) e = s
      setTasks(ts => ts.map(t => t.id === d.id ? { ...t, start_date: s, due_date: e } : t))
      const { error } = await supabase.rpc('pj_task_save', { p: { id: d.id, start_date: s, due_date: e } })
      if (error) { showToast(friendlyError(error), 'error'); load() }
    }
    window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [drag, px, load])

  async function setBaseline() {
    if (!project) return showToast('Pick one project first', 'error')
    if (!window.confirm('Save today\'s plan as the baseline? Later changes will show against it.')) return
    const { data, error } = await supabase.rpc('pj_set_baseline', { p_project: project })
    if (error) return showToast(friendlyError(error), 'error')
    showToast(`Baseline saved for ${data} tasks`); load()
  }

  // header ticks
  const ticks = useMemo(() => {
    const out = []
    for (let d = new Date(t0); d <= t1; d = addD(d, 1)) {
      const first = d.getDate() === 1, monday = d.getDay() === 1
      if (zoom === 'day') out.push({ x: X(iso(d)), label: d.getDate(), major: first || monday, month: first ? d.toLocaleDateString('en-GB', { month: 'short' }) : null, weekend: [0, 6].includes(d.getDay()) })
      else if (zoom === 'week' && monday) out.push({ x: X(iso(d)), label: d.getDate() + ' ' + d.toLocaleDateString('en-GB', { month: 'short' }), major: true })
      else if (zoom === 'month' && first) out.push({ x: X(iso(d)), label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), major: true })
    }
    return out
  }, [t0, t1, zoom])  // eslint-disable-line react-hooks/exhaustive-deps

  const todayX = X(iso(today()))
  const height = rows.length * ROW

  function Bar({ t }) {
    const live = drag?.id === t.id ? drag : null
    let s = t.start_date || t.due_date, e = t.due_date || t.start_date
    if (!s) return null
    if (live) { if (live.mode === 'move') s = iso(addD(toD(s), live.ds)); e = iso(addD(toD(e), live.ds)); if (toD(e) < toD(s)) e = s }
    const st = STATUS[t.status] || STATUS.todo
    const late = t.due_date && toD(t.due_date) < today() && !['done', 'cancelled'].includes(t.status)
    const x = X(s), w = Math.max(px, X(e) - x + px)
    if (t.is_milestone) return (
      <div title={`${t.title} — ${e}`} onMouseDown={ev => startDrag(ev, t, 'move')}
        style={{ position: 'absolute', left: X(e) + px / 2 - 8, top: 9, width: 16, height: 16, transform: 'rotate(45deg)', cursor: canEdit ? 'grab' : 'pointer',
          background: t.status === 'done' ? STATUS.done.color : late ? FIN.bad : '#16211D', borderRadius: 2 }} />
    )
    return <>
      {showBase && t.baseline_start && t.baseline_end && (
        <div title={`Baseline ${t.baseline_start} → ${t.baseline_end}`} style={{ position: 'absolute', left: X(t.baseline_start), top: 25,
          width: Math.max(px, X(t.baseline_end) - X(t.baseline_start) + px), height: 4, background: '#B9C2BD', borderRadius: 2 }} />
      )}
      <div onMouseDown={ev => startDrag(ev, t, 'move')} title={`${t.title}\n${s} → ${e}${late ? '\nLATE' : ''}`}
        style={{ position: 'absolute', left: x, top: 6, width: w, height: 18, borderRadius: 5, background: st.tint, cursor: canEdit ? 'grab' : 'pointer',
          border: `1.5px solid ${late ? FIN.bad : st.color}`, overflow: 'hidden', boxSizing: 'border-box', opacity: live ? 0.85 : 1 }}>
        <div style={{ width: `${Math.min(100, Number(t.percent_complete || (t.status === 'done' ? 100 : 0)))}%`, height: '100%', background: st.color, opacity: 0.35 }} />
        {t.actual_start && <div style={{ position: 'absolute', top: 7, height: 2, background: '#16211D', left: X(t.actual_start) - x,
          width: Math.max(2, X(t.actual_end || iso(today())) - X(t.actual_start) + (t.actual_end ? px : 0)) }} />}
        {w > 60 && <span style={{ position: 'absolute', left: 6, top: 1, fontSize: 11, color: FIN.ink, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{t.title}</span>}
        {canEdit && <div onMouseDown={ev => startDrag(ev, t, 'resize')} style={{ position: 'absolute', right: 0, top: 0, width: 7, height: '100%', cursor: 'ew-resize' }} />}
      </div>
    </>
  }

  return (
    <FinShell module="Projects" homePage="pj_dashboard" setPage={setPage} title="Timeline"
      subtitle="Drag bars to reschedule. Grey = baseline, dark line = actual, ◆ = milestone."
      tabs={[{ key: 'tasks', label: 'Tasks' }, { key: 'people', label: 'People' }, { key: 'machines', label: 'Machines' }]} tab={view} onTab={setView}
      actions={<>
        {!fixedProject && <select value={project} onChange={e => setProject(e.target.value)} aria-label="Project" style={{ ...finInput, minHeight: 40 }}>
          <option value="">All projects</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <div role="group" style={{ display: 'inline-flex', background: FIN.ground, borderRadius: 10, padding: 3 }}>
          {Object.entries(ZOOMS).map(([k, z]) => <button key={k} onClick={() => setZoom(k)} style={{ minHeight: 34, padding: '0 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, background: zoom === k ? '#fff' : 'transparent', color: zoom === k ? FIN.ink : FIN.muted }}>{z.label}</button>)}
        </div>
        <button onClick={() => { if (scroller.current) scroller.current.scrollLeft = Math.max(0, todayX - 200) }} style={finBtn2}>Today</button>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={showBase} onChange={e => setShowBase(e.target.checked)} /> Baseline</label>
        {canEdit && project && <button onClick={setBaseline} style={finBtn2}>Save baseline</button>}
      </>}>
      {rows.length === 0 ? <div style={{ padding: 30, textAlign: 'center', color: FIN.faint, background: '#fff', borderRadius: 12 }}>
        {view === 'machines' ? 'No tasks are linked to machines yet — use “Make a task” on a machine.' : 'No dated tasks yet. Give tasks a start or due date to see them here.'}</div> : (
      <div style={{ display: 'flex', background: '#fff', border: `1px solid ${FIN.line}`, borderRadius: 12, overflow: 'hidden', userSelect: drag ? 'none' : 'auto' }}>
        {/* left: names */}
        <div style={{ width: LEFT, flexShrink: 0, borderRight: `1px solid ${FIN.line}` }}>
          <div style={{ height: 40, borderBottom: `1px solid ${FIN.line}`, background: FIN.ground }} />
          {rows.map((r, i) => (
            <div key={i} onClick={() => r.kind === 'task' && setOpen(r.t.id)}
              style={{ height: ROW, boxSizing: 'border-box', padding: '0 10px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${FIN.lineSoft}`,
                cursor: r.kind === 'task' ? 'pointer' : 'default', background: r.kind === 'head' ? FIN.ground : r.kind === 'phase' || r.kind === 'group' ? '#FAFBFA' : '#fff' }}>
              {r.kind === 'head' && <b style={{ fontSize: 13 }}>{r.label}</b>}
              {(r.kind === 'phase' || r.kind === 'group') && <><span style={{ width: 8, height: 8, borderRadius: 2, background: r.color || FIN.blue }} /><b style={{ fontSize: 12, flex: 1 }}>{r.label}</b><span style={{ fontSize: 11, color: FIN.faint }}>{r.sub}</span></>}
              {r.kind === 'task' && <>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS[r.t.status]?.color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: r.t.parent_task_id ? 12 : 0 }}>{r.label}</span>
                <span style={{ fontSize: 11, color: FIN.faint, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub}</span>
              </>}
            </div>
          ))}
        </div>
        {/* right: chart */}
        <div ref={scroller} style={{ overflowX: 'auto', flex: 1 }}>
          <div style={{ width, position: 'relative' }}>
            <div style={{ height: 40, position: 'relative', borderBottom: `1px solid ${FIN.line}`, background: FIN.ground }}>
              {ticks.map((k, i) => <div key={i} style={{ position: 'absolute', left: k.x, top: 0, height: 40, borderLeft: k.major ? `1px solid ${FIN.line}` : 'none', paddingLeft: 3, fontSize: 11, color: FIN.muted }}>
                {k.month && <div style={{ fontWeight: 700, color: FIN.ink }}>{k.month}</div>}<div style={{ marginTop: k.month ? 0 : 14 }}>{k.label}</div></div>)}
            </div>
            <div style={{ position: 'relative', height }}>
              {zoom === 'day' && ticks.filter(k => k.weekend).map((k, i) => <div key={i} style={{ position: 'absolute', left: k.x, top: 0, width: px, height, background: '#F6F7F6' }} />)}
              {ticks.filter(k => k.major).map((k, i) => <div key={'g' + i} style={{ position: 'absolute', left: k.x, top: 0, height, borderLeft: `1px solid ${FIN.lineSoft}` }} />)}
              {rows.map((r, i) => (
                <div key={i} style={{ position: 'absolute', top: i * ROW, left: 0, width, height: ROW, borderBottom: `1px solid ${FIN.lineSoft}` }}>
                  {r.kind === 'group' && Object.entries(r.load || {}).map(([d, n]) => n > 1 && (
                    <div key={d} title={`${n} tasks on ${d}`} style={{ position: 'absolute', left: X(d), top: 4, width: px, height: ROW - 8, borderRadius: 3,
                      background: n >= 3 ? 'rgba(179,38,30,.35)' : 'rgba(200,129,30,.28)' }} />
                  ))}
                  {r.kind === 'phase' && (() => {
                    const ds = r.tasks.flatMap(t => [t.start_date, t.due_date]).filter(Boolean).map(toD)
                    if (!ds.length) return null
                    const a = new Date(Math.min(...ds)), b = new Date(Math.max(...ds))
                    return <div style={{ position: 'absolute', left: X(iso(a)), width: X(iso(b)) - X(iso(a)) + px, top: 14, height: 6, background: r.color || '#16211D', opacity: 0.55, borderRadius: 3 }} />
                  })()}
                  {(r.bars || []).map(t => <Bar key={t.id} t={t} />)}
                </div>
              ))}
              {/* dependencies */}
              {view === 'tasks' && <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                <defs><marker id="pjarr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#5B6661" /></marker></defs>
                {deps.map((d, i) => {
                  const a = tasks.find(t => t.id === d.depends_on_id), b = tasks.find(t => t.id === d.task_id)
                  if (!a || !b || rowOf[a.id] == null || rowOf[b.id] == null) return null
                  const ae = a.due_date || a.start_date, bs = b.start_date || b.due_date
                  if (!ae || !bs) return null
                  const x1 = X(ae) + px, y1 = rowOf[a.id] * ROW + 15, x2 = X(bs), y2 = rowOf[b.id] * ROW + 15
                  const mid = Math.max(x1 + 6, Math.min(x2 - 6, x1 + 10))
                  const bad = toD(bs) <= toD(ae)
                  return <path key={i} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 2}`} fill="none" stroke={bad ? FIN.bad : '#5B6661'} strokeWidth="1.2" markerEnd="url(#pjarr)" />
                })}
              </svg>}
              <div title="Today" style={{ position: 'absolute', left: todayX + px / 2, top: 0, height, borderLeft: `2px solid ${FIN.bad}`, pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
      </div>)}
      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onChanged={load} setPage={setPage} />}
    </FinShell>
  )
}
