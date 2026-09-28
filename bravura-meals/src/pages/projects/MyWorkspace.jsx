import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { friendlyError } from '../../utils/friendlyError'
import FinShell from '../../components/FinShell'
import TaskDrawer from '../../components/TaskDrawer'
import { FIN, finInput } from '../../utils/financeTheme'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import { STATUS, STATUS_ORDER, PRIORITY, dueInfo, bucketOf, daysSince, ago } from './pjShared'

// PJ11 My workspace (#76): everything that is mine, from every project and every module, on one page.
// Personal board (drag between stages) or a list grouped Overdue / Today / This week / Later,
// private to-dos, tasks I watch, my inbox, sticky notes, and the running timer.
const BUCKETS = [['overdue', 'Overdue', '#B3261E'], ['today', 'Today', '#C8811E'], ['week', 'This week', '#1F4E8C'], ['later', 'Later / no date', '#5B6661'], ['done', 'Done lately', '#2F7D4F']]
const NOTE_COLORS = ['#FFF6D6', '#E8F4EC', '#EAF0FB', '#FBEDEC', '#F3EEFA']

export default function MyWorkspace({ setPage, openId }) {
  const { profile } = useAuth()
  const [ws, setWs] = useState(null)
  const [view, setView] = useState(() => { try { return localStorage.getItem('pj_ws_view') || 'board' } catch { return 'board' } })
  const [open, setOpen] = useState(openId || null)
  const [quick, setQuick] = useState('')
  const [quickProject, setQuickProject] = useState('')
  const [quickDue, setQuickDue] = useState('')
  const [projects, setProjects] = useState([])
  const [filter, setFilter] = useState('all')
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('pj_my_workspace')
    if (error) return showToast(friendlyError(error), 'error')
    setWs(data)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('projects').select('id, name, key, cover_color').eq('is_archived', false).eq('is_template', false).order('name')
      .then(({ data }) => setProjects(data || []))
  }, [])
  useRealtimeSubscription('notifications', { column: 'user_id', value: profile?.id }, load)
  // live timer clock
  useEffect(() => { if (!ws?.timer) return; const i = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(i) }, [ws?.timer])
  useEffect(() => { try { localStorage.setItem('pj_ws_view', view) } catch { /* private window */ } }, [view])

  const tasks = useMemo(() => (ws?.tasks || []).filter(t =>
    filter === 'all' || (filter === 'todos' ? t.private : filter === 'projects' ? !t.private : t.project_id === filter)), [ws, filter])
  const counts = useMemo(() => {
    const c = { overdue: 0, today: 0, week: 0 }
    for (const t of ws?.tasks || []) { const b = bucketOf(t); if (c[b] !== undefined) c[b]++ }
    return c
  }, [ws])
  const myProjects = useMemo(() => {
    const m = new Map(); for (const t of ws?.tasks || []) if (t.project_id) m.set(t.project_id, t.project); return [...m]
  }, [ws])

  async function addQuick() {
    const title = quick.trim(); if (!title) return
    const { error } = await supabase.rpc('pj_task_save', { p: { title, project_id: quickProject || null, due_date: quickDue || null, assigned_to: profile?.id } })
    if (error) return showToast(friendlyError(error), 'error')
    setQuick(''); setQuickDue(''); load()
  }
  async function move(id, status) {
    const t = ws.tasks.find(x => x.id === id); if (!t || t.status === status) return
    let extra = {}
    if (status === 'blocked') { const why = window.prompt('What is blocking it?'); if (!why) return; extra = { blocked_reason: why } }
    setWs(w => ({ ...w, tasks: w.tasks.map(x => x.id === id ? { ...x, status } : x) }))  // optimistic
    const { error } = await supabase.rpc('pj_task_save', { p: { id, status, ...extra } })
    if (error) showToast(friendlyError(error), 'error')
    load()
  }
  async function stopTimer() {
    const { error } = await supabase.rpc('pj_timer', { p_task: null, p_start: false })
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Timer stopped — time sent for approval'); load()
  }
  async function saveNote(id, patch) {
    const { error } = await supabase.rpc('pj_note_save', { p_id: id, p_body: patch.body ?? null, p_pinned: patch.pinned ?? null, p_color: patch.color ?? null, p_archive: patch.archive ?? false })
    if (error) return showToast(friendlyError(error), 'error')
    load()
  }
  async function openInbox(n) {
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', n.id)
    const m = /pj_detail_[^:]+:board:([0-9a-f-]{36})/.exec(n.link || '')
    if (m) setOpen(m[1]); else if (n.link) window.location.assign(n.link)
    load()
  }

  const hour = new Date().getHours()
  const hello = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${profile?.full_name ? ', ' + profile.full_name.split(' ')[0] : ''}`
  const timerMins = ws?.timer ? Math.floor((Date.now() - new Date(ws.timer.since)) / 60000) : 0

  return (
    <FinShell module="Projects" homePage="pj_dashboard" setPage={setPage} title="My workspace"
      subtitle={hello + ' — everything on your plate, from every project.'}>
      {!ws ? <div style={{ color: FIN.faint }}>Loading…</div> : <>
        {/* at a glance */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Glance n={counts.overdue} label="overdue" color="#B3261E" />
          <Glance n={counts.today} label="due today" color="#C8811E" />
          <Glance n={counts.week} label="this week" color="#1F4E8C" />
          <Glance n={Number(ws.hours_week || 0).toFixed(1)} label="hours logged this week" color={FIN.ink} onClick={() => setPage('pj_time')} />
          {ws.approvals > 0 && <Glance n={ws.approvals} label="approvals waiting" color={FIN.maroon} onClick={() => window.dispatchEvent(new CustomEvent('open-approvals'))} />}
          {ws.time_to_approve > 0 && <Glance n={ws.time_to_approve} label="time sheets to approve" color={FIN.maroon} onClick={() => setPage('pj_time:approve')} />}
          {ws.timer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 12, background: '#1F4E8C', color: '#fff' }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: '#7CF0A4', boxShadow: '0 0 0 4px rgba(124,240,164,.25)' }} />
              <span style={{ fontSize: 13 }}><b style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.floor(timerMins / 60)}:{String(timerMins % 60).padStart(2, '0')}</b> on {ws.timer.task}</span>
              <button onClick={stopTimer} style={{ minHeight: 30, padding: '0 10px', borderRadius: 8, border: 'none', background: '#fff', color: '#1F4E8C', fontWeight: 600, cursor: 'pointer' }}>Stop</button>
            </div>
          )}
        </div>

        {/* quick add */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: '#fff', border: `1px solid ${FIN.line}`, borderRadius: 12, padding: 8 }}>
          <input value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && addQuick()}
            placeholder="Add a task or to-do… press Enter" aria-label="New task"
            style={{ ...finInput, flex: '1 1 260px', border: 'none', fontSize: 15 }} />
          <select value={quickProject} onChange={e => setQuickProject(e.target.value)} aria-label="Project" style={{ ...finInput, flex: '0 1 220px' }}>
            <option value="">Private to-do</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.key ? p.key + ' · ' : ''}{p.name}</option>)}
          </select>
          <input type="date" value={quickDue} onChange={e => setQuickDue(e.target.value)} aria-label="Due" style={{ ...finInput, flex: '0 0 150px' }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 }} className="pj-ws-grid">
          <style>{`@media (min-width: 1180px) { .pj-ws-grid { grid-template-columns: minmax(0,1fr) 320px !important; } }`}</style>
          {/* main */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Seg value={view} onChange={setView} options={[['board', 'Board'], ['list', 'List']]} />
              <span style={{ flex: 1 }} />
              <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Show" style={{ ...finInput, minHeight: 36 }}>
                <option value="all">Everything</option>
                <option value="projects">Project tasks</option>
                <option value="todos">My to-dos</option>
                {myProjects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </div>

            {view === 'board' ? (
              <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(230px, 1fr)', gap: 10, overflowX: 'auto', paddingBottom: 6 }}>
                {STATUS_ORDER.map(s => {
                  const col = tasks.filter(t => t.status === s)
                  return (
                    <div key={s} onDragOver={e => { e.preventDefault(); setOverCol(s) }} onDragLeave={() => setOverCol(null)}
                      onDrop={e => { e.preventDefault(); setOverCol(null); if (dragId) move(dragId, s) }}
                      style={{ background: overCol === s ? STATUS[s].tint : FIN.ground, borderRadius: 12, padding: 8, minHeight: 200,
                        outline: overCol === s ? `2px dashed ${STATUS[s].color}` : 'none', transition: 'background .15s' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 6px 8px' }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: STATUS[s].color }} />
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{STATUS[s].label}</span>
                        <span style={{ fontSize: 12, color: FIN.faint }}>{col.length}</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {col.map(t => <TaskCard key={t.id} t={t} onOpen={() => setOpen(t.id)} onDrag={setDragId} />)}
                        {col.length === 0 && <div style={{ fontSize: 12, color: FIN.faint, padding: '12px 6px', textAlign: 'center' }}>Drop here</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {BUCKETS.map(([b, label, color]) => {
                  const rows = tasks.filter(t => bucketOf(t) === b)
                  if (!rows.length) return null
                  return (
                    <div key={b}>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color, marginBottom: 6 }}>{label} · {rows.length}</div>
                      <div style={{ background: '#fff', border: `1px solid ${FIN.line}`, borderRadius: 12, overflow: 'hidden' }}>
                        {rows.map(t => <TaskRow key={t.id} t={t} onOpen={() => setOpen(t.id)} onDone={() => move(t.id, t.status === 'done' ? 'todo' : 'done')} />)}
                      </div>
                    </div>
                  )
                })}
                {tasks.length === 0 && <Empty />}
              </div>
            )}
            {view === 'board' && tasks.length === 0 && <Empty />}
          </div>

          {/* side */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
            <Panel title="Inbox" right={(ws.inbox || []).filter(n => !n.read).length || null}>
              {(ws.inbox || []).length === 0 && <Muted>Nothing new. Assignments, comments and changes on tasks you watch land here.</Muted>}
              {(ws.inbox || []).slice(0, 8).map(n => (
                <button key={n.id} onClick={() => openInbox(n)} style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: n.read ? 'transparent' : '#EEF3FA',
                  borderRadius: 8, padding: '8px 10px', cursor: 'pointer', fontFamily: FIN.sans }}>
                  <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: FIN.ink }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: FIN.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
                  <div style={{ fontSize: 11, color: FIN.faint }}>{ago(n.at)}</div>
                </button>
              ))}
            </Panel>

            <Panel title="Watching" right={(ws.watching || []).length || null}>
              {(ws.watching || []).length === 0 && <Muted>Press ☆ Watch on any task to follow it here.</Muted>}
              {(ws.watching || []).slice(0, 8).map(t => (
                <button key={t.id} onClick={() => setOpen(t.id)} style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center', border: 'none', background: 'none', padding: '6px 2px', cursor: 'pointer', textAlign: 'left', fontFamily: FIN.sans }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS[t.status]?.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: FIN.ink }}>{t.title}</span>
                  <span style={{ fontSize: 11, color: FIN.faint }}>{t.assignee}</span>
                </button>
              ))}
            </Panel>

            <Panel title="Notes">
              <textarea value={noteDraft} onChange={e => setNoteDraft(e.target.value)} rows={2} placeholder="Jot something down… (Ctrl+Enter)"
                onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && noteDraft.trim()) { saveNote(null, { body: noteDraft }); setNoteDraft('') } }}
                style={{ ...finInput, width: '100%', resize: 'vertical', fontFamily: FIN.sans }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                {(ws.notes || []).map(n => (
                  <div key={n.id} style={{ background: n.color || NOTE_COLORS[0], borderRadius: 10, padding: '8px 10px', fontSize: 13, position: 'relative', minHeight: 64 }}>
                    <div style={{ whiteSpace: 'pre-wrap', paddingRight: 16 }}>{n.body}</div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      <button title={n.pinned ? 'Unpin' : 'Pin'} onClick={() => saveNote(n.id, { pinned: !n.pinned })} style={noteBtn}>{n.pinned ? '📌' : '📍'}</button>
                      <button title="Colour" onClick={() => saveNote(n.id, { color: NOTE_COLORS[(NOTE_COLORS.indexOf(n.color) + 1) % NOTE_COLORS.length] })} style={noteBtn}>◐</button>
                      <button title="Archive" onClick={() => saveNote(n.id, { archive: true })} style={noteBtn}>✓</button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
            {!ws.has_employee && <Muted>Your login isn't linked to an employee record, so you can't log time yet. Ask an admin to link it (Admin → Employee links).</Muted>}
          </div>
        </div>
      </>}
      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onChanged={load} setPage={setPage} />}
    </FinShell>
  )
}

const noteBtn = { border: 'none', background: 'rgba(255,255,255,.6)', borderRadius: 6, cursor: 'pointer', fontSize: 12, width: 26, height: 24 }

function TaskCard({ t, onOpen, onDrag }) {
  const due = dueInfo(t.due_date, t.status)
  const stuck = ['in_progress', 'review', 'blocked'].includes(t.status) ? daysSince(t.stage_since) : 0
  return (
    <div draggable onDragStart={() => onDrag(t.id)} onDragEnd={() => onDrag(null)} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onOpen()}
      style={{ background: '#fff', borderRadius: 10, padding: '10px 12px', cursor: 'grab', border: `1px solid ${FIN.line}`,
        borderLeft: `4px solid ${t.private ? '#C8B98A' : (t.color || FIN.blue)}`, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: FIN.muted, marginBottom: 4 }}>
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}>{t.ref}</span>
        {t.project && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {t.project}</span>}
        {t.priority && ['urgent', 'high'].includes(t.priority) && <span style={{ marginLeft: 'auto', color: PRIORITY[t.priority].color, fontWeight: 700 }}>▲ {PRIORITY[t.priority].label}</span>}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: FIN.ink, textDecoration: t.status === 'done' ? 'line-through' : 'none', lineHeight: 1.35 }}>
        {t.is_milestone && '◆ '}{t.title}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 12, alignItems: 'center' }}>
        {due && <span style={{ color: due.color, fontWeight: due.late ? 700 : 500 }}>⏱ {due.text}</span>}
        {t.checklist?.all > 0 && <span style={{ color: t.checklist.done === t.checklist.all ? FIN.good : FIN.muted }}>☑ {t.checklist.done}/{t.checklist.all}</span>}
        {t.links?.length > 0 && <span style={{ color: FIN.blue }} title={t.links.map(l => l.label).join(', ')}>↗ {t.links[0].label}{t.links.length > 1 ? ` +${t.links.length - 1}` : ''}</span>}
        {t.recurrence && <span style={{ color: FIN.muted }}>↻</span>}
        {stuck >= 7 && <span style={{ color: FIN.ochreText }} title="Days in this stage">{stuck} d here</span>}
      </div>
      {t.status === 'blocked' && t.blocked_reason && <div style={{ fontSize: 12, color: STATUS.blocked.color, marginTop: 6 }}>⛔ {t.blocked_reason}</div>}
    </div>
  )
}

function TaskRow({ t, onOpen, onDone }) {
  const due = dueInfo(t.due_date, t.status)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: `1px solid ${FIN.lineSoft}` }}>
      <button onClick={onDone} aria-label={t.status === 'done' ? 'Reopen' : 'Mark done'}
        style={{ width: 22, height: 22, borderRadius: 11, border: `2px solid ${t.status === 'done' ? FIN.good : FIN.field}`, background: t.status === 'done' ? FIN.good : '#fff',
          color: '#fff', cursor: 'pointer', fontSize: 12, flexShrink: 0, padding: 0 }}>{t.status === 'done' ? '✓' : ''}</button>
      <button onClick={onOpen} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer', padding: 0, fontFamily: FIN.sans }}>
        <div style={{ fontSize: 14, color: FIN.ink, textDecoration: t.status === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
        <div style={{ fontSize: 12, color: FIN.faint }}>{t.ref}{t.project ? ' · ' + t.project : ''}</div>
      </button>
      <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: STATUS[t.status]?.tint, color: STATUS[t.status]?.color, fontWeight: 600, whiteSpace: 'nowrap' }}>{STATUS[t.status]?.label}</span>
      {due && <span style={{ fontSize: 12, color: due.color, width: 74, textAlign: 'right', fontWeight: due.late ? 700 : 500 }}>{due.text}</span>}
    </div>
  )
}

function Glance({ n, label, color, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return <Tag onClick={onClick} style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '8px 14px', borderRadius: 12, background: '#fff',
    border: `1px solid ${FIN.line}`, cursor: onClick ? 'pointer' : 'default', fontFamily: FIN.sans }}>
    <span style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{n}</span>
    <span style={{ fontSize: 13, color: FIN.muted }}>{label}</span>
  </Tag>
}
function Seg({ value, onChange, options }) {
  return <div role="tablist" style={{ display: 'inline-flex', background: FIN.ground, borderRadius: 10, padding: 3 }}>
    {options.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
      style={{ minHeight: 32, padding: '0 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        background: value === k ? '#fff' : 'transparent', color: value === k ? FIN.ink : FIN.muted, boxShadow: value === k ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{l}</button>)}
  </div>
}
function Panel({ title, right, children }) {
  return <div style={{ background: '#fff', border: `1px solid ${FIN.line}`, borderRadius: 14, padding: '12px 14px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: FIN.muted }}>{title}</span>
      {right != null && <span style={{ fontSize: 11, fontWeight: 700, background: FIN.maroon, color: '#fff', borderRadius: 999, padding: '1px 7px' }}>{right}</span>}
    </div>
    {children}
  </div>
}
const Muted = ({ children }) => <div style={{ fontSize: 13, color: FIN.faint, lineHeight: 1.5 }}>{children}</div>
const Empty = () => <div style={{ padding: 32, textAlign: 'center', color: FIN.faint, background: '#fff', borderRadius: 12, border: `1px dashed ${FIN.field}` }}>
  Nothing on your plate. Add a to-do above, or use “Make a task” on any record in the ERP.</div>
