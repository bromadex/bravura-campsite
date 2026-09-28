import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { friendlyError } from '../../utils/friendlyError'
import FinShell from '../../components/FinShell'
import { FIN, finBtn, finBtn2, finInput, finCard } from '../../utils/financeTheme'
import { fmtDate } from './pjShared'

// PJ12 Time (#76): hours on project tasks. My time (own entries + timer results), Crew sheet (a supervisor logs a whole
// crew for one day in one go — MyCompany idea), Approve (projects.approve). Approved overtime is paid by payroll
// (hr_run_payroll adds it unless attendance already carries overtime that day); approved hours cost the project.
const ACTIVITIES = [['work', 'Work'], ['travel', 'Travel'], ['standby', 'Standby'], ['supervision', 'Supervision'], ['training', 'Training']]
const iso = d => d.toISOString().slice(0, 10)
const weekStart = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d) }
const STATUS_C = { submitted: ['Waiting', '#C8811E'], approved: ['Approved', '#2F7D4F'], rejected: ['Sent back', '#B3261E'], running: ['Running', '#1F4E8C'] }

export default function PJTime({ setPage, initialTab }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const canApprove = can('projects.approve')
  const canCrew = can('projects.edit')
  const [tab, setTab] = useState(initialTab === 'approve' && canApprove ? 'approve' : initialTab === 'crew' && canCrew ? 'crew' : 'mine')
  const [from, setFrom] = useState(weekStart())
  const [to, setTo] = useState(iso(new Date()))
  const [rows, setRows] = useState([])
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [sel, setSel] = useState(new Set())

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.rpc('pj_time_list', { p_site: currentSiteId, p_scope: tab === 'crew' ? 'all' : tab, p_from: tab === 'approve' ? '2000-01-01' : from, p_to: tab === 'approve' ? '2100-01-01' : to })
    if (error) return showToast(friendlyError(error), 'error')
    setRows(data || []); setSel(new Set())
  }, [currentSiteId, tab, from, to])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('projects').select('id, name, key').eq('site_id', currentSiteId).eq('is_archived', false).eq('is_template', false).order('name').then(({ data }) => setProjects(data || []))
    supabase.from('project_tasks').select('id, project_id, task_no, title, status').eq('is_archived', false).not('project_id', 'is', null)
      .not('status', 'in', '(done,cancelled)').order('task_no').then(({ data }) => setTasks(data || []))
  }, [currentSiteId])

  const total = useMemo(() => rows.reduce((a, r) => ({ h: a.h + Number(r.hours || 0), ot: a.ot + Number(r.overtime_hours || 0) }), { h: 0, ot: 0 }), [rows])

  async function decide(approve) {
    const ids = [...sel]; if (!ids.length) return
    let reason = null
    if (!approve) { reason = window.prompt('Why is it going back? (the person sees this)'); if (!reason) return }
    const { data, error } = await supabase.rpc('pj_time_decide', { p_ids: ids, p_approve: approve, p_reason: reason })
    if (error) return showToast(friendlyError(error), 'error')
    showToast(`${data} ${approve ? 'approved' : 'sent back'}`); load()
  }

  const tabs = [{ key: 'mine', label: 'My time' }, canCrew && { key: 'crew', label: 'Crew sheet' }, canApprove && { key: 'approve', label: 'Approve' }].filter(Boolean)
  return (
    <FinShell module="Projects" homePage="pj_dashboard" setPage={setPage} title="Time"
      subtitle="Hours on project tasks. Approved overtime goes to payroll; approved hours cost the project."
      tabs={tabs} tab={tab} onTab={setTab}>
      {tab === 'mine' && <MyEntry projects={projects} tasks={tasks} onSaved={load} />}
      {tab === 'crew' && <CrewSheet projects={projects} tasks={tasks} siteId={currentSiteId} onSaved={load} />}

      <div style={{ ...finCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', borderBottom: `1px solid ${FIN.line}` }}>
          <b style={{ fontSize: 14 }}>{tab === 'approve' ? 'Waiting for approval' : tab === 'crew' ? 'All time at this site' : 'My entries'}</b>
          {tab !== 'approve' && <>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="From" style={{ ...finInput, minHeight: 34 }} />
            <span style={{ color: FIN.faint }}>to</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="To" style={{ ...finInput, minHeight: 34 }} />
          </>}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: FIN.muted, fontVariantNumeric: 'tabular-nums' }}>{total.h.toFixed(1)} h + {total.ot.toFixed(1)} h overtime</span>
          {tab === 'approve' && <>
            <button disabled={!sel.size} onClick={() => decide(false)} style={finBtn2}>Send back</button>
            <button disabled={!sel.size} onClick={() => decide(true)} style={finBtn}>Approve {sel.size || ''}</button>
          </>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr style={{ background: FIN.ground, color: FIN.muted, textAlign: 'left' }}>
              {tab === 'approve' && <th style={th}><input type="checkbox" aria-label="Select all" checked={rows.length > 0 && sel.size === rows.length}
                onChange={e => setSel(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())} /></th>}
              <th style={th}>Date</th>{tab !== 'mine' && <th style={th}>Person</th>}<th style={th}>Project / task</th><th style={th}>Activity</th>
              <th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={{ ...th, textAlign: 'right' }}>Overtime</th><th style={th}>Status</th><th style={th}>Note</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={9} style={{ padding: 20, color: FIN.faint, textAlign: 'center' }}>No time here.</td></tr>}
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${FIN.lineSoft}` }}>
                  {tab === 'approve' && <td style={td}><input type="checkbox" checked={sel.has(r.id)} aria-label="Select"
                    onChange={() => setSel(s => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })} /></td>}
                  <td style={td}>{fmtDate(r.work_date)}</td>
                  {tab !== 'mine' && <td style={td}>{r.employee}{r.crew_sheet && <span style={{ color: FIN.faint }}> · crew</span>}</td>}
                  <td style={td}><div>{r.project}</div>{r.task && <div style={{ fontSize: 12, color: FIN.faint }}>{r.task}</div>}</td>
                  <td style={td}>{r.activity}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(r.hours).toFixed(2)}</td>
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(r.overtime_hours) ? Number(r.overtime_hours).toFixed(2) : '—'}</td>
                  <td style={td}><span style={{ color: STATUS_C[r.status]?.[1], fontWeight: 600 }}>{STATUS_C[r.status]?.[0]}</span>
                    {r.reject_reason && <div style={{ fontSize: 12, color: FIN.bad }}>{r.reject_reason}</div>}</td>
                  <td style={{ ...td, color: FIN.muted }}>{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </FinShell>
  )
}
const th = { padding: '8px 12px', fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap' }
const td = { padding: '8px 12px', verticalAlign: 'top' }

function ProjectTaskPick({ projects, tasks, project, task, onProject, onTask }) {
  return <>
    <select value={project} onChange={e => { onProject(e.target.value); onTask('') }} aria-label="Project" style={{ ...finInput, flex: '1 1 200px' }}>
      <option value="">Project…</option>{projects.map(p => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
    </select>
    <select value={task} onChange={e => onTask(e.target.value)} aria-label="Task" style={{ ...finInput, flex: '1 1 220px' }} disabled={!project}>
      <option value="">General (no task)</option>
      {tasks.filter(t => t.project_id === project).map(t => <option key={t.id} value={t.id}>#{t.task_no} {t.title}</option>)}
    </select>
  </>
}

function MyEntry({ projects, tasks, onSaved }) {
  const [p, setP] = useState(''); const [t, setT] = useState(''); const [date, setDate] = useState(iso(new Date()))
  const [h, setH] = useState(''); const [ot, setOt] = useState(''); const [act, setAct] = useState('work'); const [note, setNote] = useState('')
  async function save() {
    const { error } = await supabase.rpc('pj_time_save', { p_rows: [{ project_id: p, task_id: t || null, work_date: date, hours: h || 0, overtime_hours: ot || 0, activity: act, note }], p_crew: false })
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Time sent for approval'); setH(''); setOt(''); setNote(''); onSaved()
  }
  return (
    <div style={{ ...finCard, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" style={{ ...finInput, flex: '0 0 150px' }} />
      <ProjectTaskPick projects={projects} tasks={tasks} project={p} task={t} onProject={setP} onTask={setT} />
      <select value={act} onChange={e => setAct(e.target.value)} aria-label="Activity" style={{ ...finInput, flex: '0 0 130px' }}>{ACTIVITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <input type="number" min="0" max="24" step="0.25" value={h} onChange={e => setH(e.target.value)} placeholder="Hours" aria-label="Hours" style={{ ...finInput, flex: '0 0 90px' }} />
      <input type="number" min="0" max="24" step="0.25" value={ot} onChange={e => setOt(e.target.value)} placeholder="Overtime" aria-label="Overtime hours" style={{ ...finInput, flex: '0 0 100px' }} />
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note" aria-label="Note" style={{ ...finInput, flex: '1 1 160px' }} />
      <button onClick={save} disabled={!p || !(Number(h) + Number(ot))} style={finBtn}>Log time</button>
    </div>
  )
}

function CrewSheet({ projects, tasks, siteId, onSaved }) {
  const [p, setP] = useState(''); const [t, setT] = useState(''); const [date, setDate] = useState(iso(new Date())); const [act, setAct] = useState('work')
  const [emps, setEmps] = useState([]); const [q, setQ] = useState('')
  const [crew, setCrew] = useState([])   // [{employee_id, name, hours, overtime_hours}]
  useEffect(() => {
    if (!siteId) return
    supabase.from('employees').select('id, name, employee_number, position_title').eq('site_id', siteId).eq('status', 'active').eq('is_archived', false).order('name')
      .then(({ data }) => setEmps(data || []))
  }, [siteId])
  const matches = q.trim() ? emps.filter(e => !crew.some(c => c.employee_id === e.id) && (e.name + ' ' + (e.employee_number || '')).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : []
  const add = e => { setCrew(c => [...c, { employee_id: e.id, name: e.name, hours: 8, overtime_hours: 0 }]); setQ('') }
  const upd = (i, k, v) => setCrew(c => c.map((x, j) => j === i ? { ...x, [k]: v } : x))
  async function submit() {
    const { data, error } = await supabase.rpc('pj_time_save', { p_rows: crew.map(c => ({ project_id: p, task_id: t || null, employee_id: c.employee_id, work_date: date, hours: c.hours, overtime_hours: c.overtime_hours, activity: act })), p_crew: true })
    if (error) return showToast(friendlyError(error), 'error')
    showToast(`${data} people logged — waiting for approval`); setCrew([]); onSaved()
  }
  return (
    <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: FIN.muted }}>One day, one job, the whole crew. Add people, adjust hours, submit once.</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} aria-label="Date" style={{ ...finInput, flex: '0 0 150px' }} />
        <ProjectTaskPick projects={projects} tasks={tasks} project={p} task={t} onProject={setP} onTask={setT} />
        <select value={act} onChange={e => setAct(e.target.value)} aria-label="Activity" style={{ ...finInput, flex: '0 0 130px' }}>{ACTIVITIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      <div style={{ position: 'relative' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Add a person — type a name or employee number" aria-label="Add person" style={{ ...finInput, width: '100%' }} />
        {matches.length > 0 && <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: `1px solid ${FIN.line}`, borderRadius: 10, zIndex: 5, boxShadow: '0 8px 20px rgba(0,0,0,.08)' }}>
          {matches.map(e => <button key={e.id} onClick={() => add(e)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FIN.sans, fontSize: 14 }}>
            {e.name} <span style={{ color: FIN.faint, fontSize: 12 }}>{e.employee_number} · {e.position_title}</span></button>)}
        </div>}
      </div>
      {crew.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {crew.map((c, i) => (
          <div key={c.employee_id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ flex: 1, fontSize: 14 }}>{c.name}</span>
            <label style={{ fontSize: 12, color: FIN.muted }}>Hours <input type="number" min="0" max="24" step="0.25" value={c.hours} onChange={e => upd(i, 'hours', e.target.value)} style={{ ...finInput, width: 80 }} /></label>
            <label style={{ fontSize: 12, color: FIN.muted }}>Overtime <input type="number" min="0" max="24" step="0.25" value={c.overtime_hours} onChange={e => upd(i, 'overtime_hours', e.target.value)} style={{ ...finInput, width: 80 }} /></label>
            <button onClick={() => setCrew(x => x.filter((_, j) => j !== i))} aria-label="Remove" style={{ ...finBtn2, minHeight: 36, width: 36, padding: 0 }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
          <span style={{ fontSize: 13, color: FIN.muted }}>{crew.length} people · {crew.reduce((a, c) => a + Number(c.hours || 0), 0)} h + {crew.reduce((a, c) => a + Number(c.overtime_hours || 0), 0)} h overtime</span>
          <button onClick={submit} disabled={!p} style={finBtn}>Submit crew sheet</button>
        </div>
      </div>}
    </div>
  )
}
