import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { useAuth } from '../../auth/AuthContext'
import TaskDrawer from '../../components/TaskDrawer'
import { STATUS, dueInfo, bucketOf } from '../projects/pjShared'

// Tasks inside the My Workspace pop-up (#76): my tasks from every project + private to-dos, quick add, timer, inbox.
// `compact` = the strip on the pop-up home (next few + add); full = the Tasks page inside the pop-up.
let cache = null
const listeners = new Set()
export async function refreshMyTasks() {
  const { data, error } = await supabase.rpc('pj_my_workspace')
  if (error) return null
  cache = data; listeners.forEach(f => f(data)); return data
}
export function useMyTasks() {
  const [ws, setWs] = useState(cache)
  useEffect(() => { listeners.add(setWs); if (!cache) refreshMyTasks(); return () => listeners.delete(setWs) }, [])
  return ws
}

const GROUPS = [['overdue', 'Overdue', '#B3261E'], ['today', 'Today', '#C8811E'], ['week', 'This week', '#1F4E8C'], ['later', 'Later', '#5B6661'], ['done', 'Done lately', '#2F7D4F']]

export default function MyTasks({ compact = false, setPage }) {
  const ws = useMyTasks()
  const { profile } = useAuth()
  const [quick, setQuick] = useState('')
  const [open, setOpen] = useState(null)
  const [, tick] = useState(0)
  const load = useCallback(() => refreshMyTasks(), [])
  useEffect(() => { if (!ws?.timer) return; const i = setInterval(() => tick(x => x + 1), 30000); return () => clearInterval(i) }, [ws?.timer])

  async function add() {
    const title = quick.trim(); if (!title) return
    const { error } = await supabase.rpc('pj_task_save', { p: { title, assigned_to: profile?.id } })
    if (error) return showToast(friendlyError(error), 'error')
    setQuick(''); load()
  }
  async function toggle(t) {
    const { error } = await supabase.rpc('pj_task_save', { p: { id: t.id, status: t.status === 'done' ? 'todo' : 'done' } })
    if (error) return showToast(friendlyError(error), 'error')
    load()
  }
  async function stopTimer() {
    const { error } = await supabase.rpc('pj_timer', { p_task: null, p_start: false })
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Timer stopped — time sent for approval'); load()
  }

  if (!ws) return <div style={{ padding: 12, fontSize: 13, color: THEME.textLow }}>Loading tasks…</div>
  const tasks = ws.tasks || []
  const openTasks = tasks.filter(t => !['done', 'cancelled'].includes(t.status))
  const late = openTasks.filter(t => bucketOf(t) === 'overdue').length
  const mins = ws.timer ? Math.floor((Date.now() - new Date(ws.timer.since)) / 60000) : 0

  const addBox = (
    <input value={quick} onChange={e => setQuick(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && add()}
      placeholder="+ Add a to-do… press Enter" aria-label="New to-do"
      style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 12, border: `1px solid ${THEME.outlineVar}`,
        fontFamily: 'inherit', fontSize: 14, background: THEME.surface, color: THEME.text }} />
  )
  const timerBar = ws.timer && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 12, background: '#1F4E8C', color: '#fff', fontSize: 13 }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: '#7CF0A4', flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        <b style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.floor(mins / 60)}:{String(mins % 60).padStart(2, '0')}</b> {ws.timer.task}</span>
      <button onClick={stopTimer} style={{ border: 'none', borderRadius: 8, padding: '4px 10px', background: '#fff', color: '#1F4E8C', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Stop</button>
    </div>
  )
  const drawer = open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onChanged={load} />

  if (compact) {
    const next = openTasks.slice(0, 3)
    return (
      <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: 16, padding: 12, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b style={{ fontSize: 14, color: THEME.text }}>My tasks</b>
          <span style={{ fontSize: 12, color: THEME.textMed }}>{openTasks.length} open{late ? <> · <b style={{ color: '#B3261E' }}>{late} late</b></> : null}</span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setPage('me_tasks')} style={{ border: 'none', background: 'none', color: '#1F4E8C', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>See all →</button>
        </div>
        {timerBar}
        {next.map(t => <Row key={t.id} t={t} onOpen={() => setOpen(t.id)} onToggle={() => toggle(t)} />)}
        {next.length === 0 && <div style={{ fontSize: 13, color: THEME.textLow }}>Nothing on your plate.</div>}
        {addBox}
        {drawer}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text }}>My tasks</div>
      <div style={{ fontSize: 13, color: THEME.textMed, marginTop: -8 }}>From every project, plus your private to-dos. {Number(ws.hours_week || 0).toFixed(1)} h logged this week.</div>
      {timerBar}
      {addBox}
      {GROUPS.map(([g, label, color]) => {
        const rows = tasks.filter(t => bucketOf(t) === g)
        if (!rows.length) return null
        return (
          <div key={g}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color, margin: '4px 0 6px' }}>{label} · {rows.length}</div>
            <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: 14, padding: '2px 10px' }}>
              {rows.map(t => <Row key={t.id} t={t} onOpen={() => setOpen(t.id)} onToggle={() => toggle(t)} />)}
            </div>
          </div>
        )
      })}
      {tasks.length === 0 && <div style={{ fontSize: 13, color: THEME.textLow, textAlign: 'center', padding: 20 }}>Nothing on your plate. Add a to-do above, or use “Make a task” on any record.</div>}
      {(ws.inbox || []).length > 0 && <>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: THEME.textMed, marginTop: 4 }}>Task news</div>
        {(ws.inbox || []).slice(0, 6).map(n => {
          const m = /:board:([0-9a-f-]{36})/.exec(n.link || '')
          return <button key={n.id} onClick={() => { supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', n.id); if (m) setOpen(m[1]) }}
            style={{ textAlign: 'left', border: 'none', borderRadius: 10, padding: '8px 10px', background: n.read ? 'transparent' : '#EEF3FA', cursor: 'pointer', fontFamily: 'inherit' }}>
            <div style={{ fontSize: 13, fontWeight: n.read ? 500 : 700, color: THEME.text }}>{n.title}</div>
            <div style={{ fontSize: 12, color: THEME.textMed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.message}</div>
          </button>
        })}
      </>}
      {drawer}
    </div>
  )
}

function Row({ t, onOpen, onToggle }) {
  const due = dueInfo(t.due_date, t.status)
  const done = t.status === 'done'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
      <button onClick={onToggle} aria-label={done ? 'Reopen' : 'Mark done'} style={{ width: 22, height: 22, borderRadius: 11, flexShrink: 0, padding: 0, cursor: 'pointer',
        border: `2px solid ${done ? '#2F7D4F' : THEME.outline}`, background: done ? '#2F7D4F' : 'transparent', color: '#fff', fontSize: 12 }}>{done ? '✓' : ''}</button>
      <button onClick={onOpen} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit' }}>
        <div style={{ fontSize: 14, color: THEME.text, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
        <div style={{ fontSize: 11, color: THEME.textLow, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.private ? 'To-do' : `${t.ref} · ${t.project}`}
          {!['todo', 'done'].includes(t.status) && <span style={{ color: STATUS[t.status]?.color }}> · {STATUS[t.status]?.label}</span>}
        </div>
      </button>
      {due && <span style={{ fontSize: 12, color: due.color, fontWeight: due.late ? 700 : 500, whiteSpace: 'nowrap' }}>{due.text}</span>}
    </div>
  )
}
