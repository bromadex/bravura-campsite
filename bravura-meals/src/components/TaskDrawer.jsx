import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { showToast } from './ui'
import { usePermissions } from '../contexts/PermissionsContext'
import { friendlyError } from '../utils/friendlyError'
import { FIN, finBtn, finBtn2, finInput } from '../utils/financeTheme'
import LinkedDocuments from './LinkedDocuments'
import { STATUS, STATUS_ORDER, PRIORITY, usePeople, ago, dueInfo, daysSince, initials, avatarColor } from '../pages/projects/pjShared'

// One task panel for the whole ERP (#76): workspace, project board, Make-a-task, links from notifications.
// Everything writes through pj_* RPCs; files go to the task's own DocShare folder.
export default function TaskDrawer({ taskId, onClose, onChanged, setPage, onAdvanced }) {
  const { can } = usePermissions()
  const people = usePeople()
  const [t, setT] = useState(null)
  const [err, setErr] = useState(null)
  const [comment, setComment] = useState('')
  const [newItem, setNewItem] = useState('')
  const [tab, setTab] = useState('comments')
  const [busy, setBusy] = useState(false)
  const [timer, setTimer] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('pj_task_detail', { p_task: taskId })
    if (error) { setErr(friendlyError(error)); return }
    setT(data)
    const ws = await supabase.rpc('pj_my_workspace')
    setTimer(ws.data?.timer || null)
  }, [taskId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k)
  }, [onClose])

  async function save(patch) {
    setBusy(true)
    const { error } = await supabase.rpc('pj_task_save', { p: { id: taskId, ...patch } })
    setBusy(false)
    if (error) { showToast(friendlyError(error), 'error'); return false }
    await load(); onChanged?.(); return true
  }
  async function setStatus(s) {
    if (s === 'blocked' && !t.blocked_reason) {
      const why = window.prompt('What is blocking it?')
      if (!why) return
      return save({ status: s, blocked_reason: why })
    }
    save({ status: s })
  }
  async function addComment() {
    if (!comment.trim()) return
    const { error } = await supabase.rpc('pj_task_comment', { p_task: taskId, p_body: comment })
    if (error) return showToast(friendlyError(error), 'error')
    setComment(''); load()
  }
  async function addChecklist() {
    if (!newItem.trim()) return
    const { error } = await supabase.from('project_task_checklist').insert({ task_id: taskId, title: newItem.trim(), position: (t.checklist || []).length })
    if (error) return showToast(friendlyError(error), 'error')
    setNewItem(''); load(); onChanged?.()
  }
  async function toggleItem(it) {
    await supabase.from('project_task_checklist').update({ checked: !it.checked }).eq('id', it.id)
    load(); onChanged?.()
  }
  async function watch() {
    await supabase.rpc('pj_watch', { p_task: taskId, p_on: !t.watching }); load()
  }
  async function toggleTimer() {
    const running = timer?.task_id === taskId
    const { error } = await supabase.rpc('pj_timer', { p_task: taskId, p_start: !running })
    if (error) return showToast(friendlyError(error), 'error')
    showToast(running ? 'Timer stopped — time sent for approval' : 'Timer started')
    load(); onChanged?.()
  }
  function openLink(link) {
    if (!link) return
    const [, mod, page] = link.split('/')
    if (setPage && mod === 'projects') { setPage(page); onClose() }
    else window.location.assign(link)
  }

  const edit = t?.can_edit
  const due = t && dueInfo(t.due_date, t.status)
  const stuck = t && ['in_progress', 'review', 'blocked'].includes(t.status) ? daysSince(t.stage_since) : 0
  const ck = t?.checklist || []
  const running = timer?.task_id === taskId

  return (
    <div role="dialog" aria-modal="true" aria-label="Task" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,.28)', zIndex: 10050, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 'min(640px, 100vw)', height: '100%', background: '#fff', boxShadow: '-12px 0 32px rgba(0,0,0,.12)',
        display: 'flex', flexDirection: 'column', fontFamily: FIN.sans, color: FIN.ink }}>
        {err && <div style={{ padding: 24 }}>{err} <button onClick={onClose} style={finBtn2}>Close</button></div>}
        {!t && !err && <div style={{ padding: 24, color: FIN.faint }}>Loading…</div>}
        {t && <>
          {/* header */}
          <div style={{ padding: '16px 20px 12px', borderBottom: `1px solid ${FIN.line}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: FIN.muted }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: FIN.ink }}>{t.ref}</span>
              {t.project ? <button onClick={() => { setPage?.('pj_detail_' + t.project_id + ':board'); onClose() }}
                style={{ border: 'none', background: 'none', color: FIN.blue, cursor: 'pointer', padding: 0, fontSize: 12 }}>{t.project}</button>
                : <span>Private to-do</span>}
              {t.recurrence && <span title="Repeats">↻ {t.recurrence}</span>}
              <span style={{ flex: 1 }} />
              {onAdvanced && edit && <button onClick={onAdvanced} title="Labels, dependencies, schedule fields" style={{ ...finBtn2, minHeight: 30, padding: '0 10px', fontSize: 12 }}>Labels &amp; links…</button>}
              <button onClick={watch} style={{ ...finBtn2, minHeight: 30, padding: '0 10px', fontSize: 12 }}>{t.watching ? '★ Watching' : '☆ Watch'}</button>
              <button onClick={onClose} aria-label="Close" style={{ ...finBtn2, minHeight: 30, width: 30, padding: 0 }}>✕</button>
            </div>
            <input defaultValue={t.title} disabled={!edit} key={t.id + t.title}
              onBlur={e => e.target.value.trim() && e.target.value !== t.title && save({ title: e.target.value })}
              style={{ width: '100%', border: 'none', fontSize: 20, fontWeight: 600, fontFamily: FIN.sans, padding: '8px 0 4px', outline: 'none', color: FIN.ink, background: 'transparent' }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {STATUS_ORDER.map(s => (
                <button key={s} disabled={!edit || busy} onClick={() => s !== t.status && setStatus(s)}
                  style={{ minHeight: 30, padding: '0 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: edit ? 'pointer' : 'default',
                    border: `1px solid ${t.status === s ? STATUS[s].color : FIN.line}`,
                    background: t.status === s ? STATUS[s].color : '#fff', color: t.status === s ? '#fff' : STATUS[s].color }}>
                  {STATUS[s].label}
                </button>
              ))}
            </div>
            {t.status === 'blocked' && t.blocked_reason && <div style={{ marginTop: 8, fontSize: 13, color: STATUS.blocked.color }}>Blocked: {t.blocked_reason}</div>}
            {stuck >= 7 && <div style={{ marginTop: 8, fontSize: 12, color: FIN.ochreText }}>In “{STATUS[t.status].label}” for {stuck} days</div>}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* fields */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <Field label="Assigned to">
                <select disabled={!edit} value={t.assigned_to || ''} onChange={e => save({ assigned_to: e.target.value })} style={{ ...finInput, width: '100%' }}>
                  <option value="">Nobody</option>
                  {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label={<>Due {due && <span style={{ color: due.color, fontWeight: 600 }}>· {due.text}</span>}</>}>
                <input type="date" disabled={!edit} value={t.due_date || ''} onChange={e => save({ due_date: e.target.value })} style={{ ...finInput, width: '100%' }} />
              </Field>
              <Field label="Area code">
                <input disabled={!edit} defaultValue={t.area_code || ''} key={'ac' + t.area_code} placeholder="e.g. 49"
                  onBlur={e => e.target.value.trim() !== (t.area_code || '') && save({ area_code: e.target.value.trim() })} style={{ ...finInput, width: '100%' }} />
              </Field>
              <Field label="Start">
                <input type="date" disabled={!edit} value={t.start_date || ''} onChange={e => save({ start_date: e.target.value })} style={{ ...finInput, width: '100%' }} />
              </Field>
              <Field label="Priority">
                <select disabled={!edit} value={t.priority || 'medium'} onChange={e => save({ priority: e.target.value })} style={{ ...finInput, width: '100%', color: PRIORITY[t.priority]?.color }}>
                  {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Estimate (h)">
                <input type="number" min="0" step="0.5" disabled={!edit} defaultValue={t.estimated_hours ?? ''} key={'e' + t.estimated_hours}
                  onBlur={e => String(e.target.value) !== String(t.estimated_hours ?? '') && save({ estimated_hours: e.target.value })} style={{ ...finInput, width: '100%' }} />
              </Field>
              <Field label="Repeats">
                <select disabled={!edit} value={t.recurrence || ''} onChange={e => save({ recurrence: e.target.value })} style={{ ...finInput, width: '100%' }}>
                  <option value="">No</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                </select>
              </Field>
            </div>

            {/* time */}
            {t.project_id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: running ? '#EEF3FA' : FIN.ground }}>
                <button onClick={toggleTimer} style={{ ...(running ? finBtn : finBtn2), minHeight: 36 }}>{running ? '■ Stop timer' : '▶ Start timer'}</button>
                <span style={{ fontSize: 13, color: FIN.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {Number(t.time?.hours || 0).toFixed(1)} h logged{t.estimated_hours ? ` of ${t.estimated_hours} h` : ''} · {Number(t.time?.approved || 0).toFixed(1)} h approved
                </span>
                {running && <span style={{ fontSize: 12, color: FIN.blue }}>running since {new Date(timer.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
              </div>
            )}

            {/* description */}
            <Field label="Notes">
              <textarea disabled={!edit} defaultValue={t.description || ''} key={'d' + (t.description || '').length} rows={3} placeholder="What needs doing, how, where…"
                onBlur={e => e.target.value !== (t.description || '') && save({ description: e.target.value })}
                style={{ ...finInput, width: '100%', resize: 'vertical', fontFamily: FIN.sans }} />
            </Field>

            {/* checklist */}
            <div>
              <SectionHead title="Checklist" right={ck.length ? `${ck.filter(c => c.checked).length}/${ck.length}` : null} />
              {ck.length > 0 && <div style={{ height: 4, background: FIN.lineSoft, borderRadius: 2, margin: '4px 0 8px' }}>
                <div style={{ width: `${100 * ck.filter(c => c.checked).length / ck.length}%`, height: '100%', background: FIN.good, borderRadius: 2 }} /></div>}
              {ck.map(it => (
                <label key={it.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={it.checked} onChange={() => toggleItem(it)} style={{ width: 18, height: 18 }} />
                  <span style={{ textDecoration: it.checked ? 'line-through' : 'none', color: it.checked ? FIN.faint : FIN.ink }}>{it.title}</span>
                </label>
              ))}
              {edit && <input value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.nativeEvent.isComposing && addChecklist()}
                placeholder="+ Add an item (Enter)" style={{ ...finInput, width: '100%', marginTop: 4 }} />}
            </div>

            {(t.subtasks?.length > 0 || t.depends_on?.length > 0) && (
              <div>
                {t.subtasks?.length > 0 && <><SectionHead title="Sub-tasks" />
                  {t.subtasks.map(s => <MiniTask key={s.id} s={s} />)}</>}
                {t.depends_on?.length > 0 && <><SectionHead title="Waits for" />
                  {t.depends_on.map(s => <MiniTask key={s.id} s={s} />)}</>}
              </div>
            )}

            {t.links?.length > 0 && (
              <div>
                <SectionHead title="Linked records" />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {t.links.map(l => (
                    <button key={l.id} onClick={() => openLink(l.link)}
                      style={{ ...finBtn2, minHeight: 32, fontSize: 13, color: FIN.blue }}>↗ {l.label || l.record_table}</button>
                  ))}
                </div>
              </div>
            )}

            {/* files: this task's DocShare folder */}
            {t.project_id && can('ds.view') && (
              <LinkedDocuments linkedTable="project_tasks" linkedId={t.id} siteId={t.site_id} category="Projects" title="Files (task folder in DocShare)" />
            )}

            {/* conversation */}
            <div>
              <div style={{ display: 'flex', gap: 14, borderBottom: `1px solid ${FIN.line}`, marginBottom: 10 }}>
                {[['comments', `Comments (${t.comments?.length || 0})`], ['activity', 'History']].map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', padding: '8px 0', cursor: 'pointer', fontSize: 13,
                    fontWeight: 600, color: tab === k ? FIN.ink : FIN.faint, borderBottom: `2px solid ${tab === k ? FIN.maroon : 'transparent'}` }}>{l}</button>
                ))}
              </div>
              {tab === 'comments' && <>
                {(t.comments || []).map(c => (
                  <div key={c.id} style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
                    <Avatar name={c.who} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: FIN.muted }}><b style={{ color: FIN.ink }}>{c.who}</b> · {ago(c.at)}</div>
                      <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', marginTop: 2 }}>{c.body}</div>
                    </div>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Write a comment — watchers are told"
                    onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addComment() }}
                    style={{ ...finInput, flex: 1, resize: 'vertical', fontFamily: FIN.sans }} />
                  <button onClick={addComment} disabled={!comment.trim()} style={{ ...finBtn, alignSelf: 'flex-end' }}>Send</button>
                </div>
                {t.watchers?.length > 0 && <div style={{ fontSize: 12, color: FIN.faint, marginTop: 8 }}>Watching: {t.watchers.join(', ')}</div>}
              </>}
              {tab === 'activity' && (t.activity || []).map((a, i) => (
                <div key={i} style={{ fontSize: 13, padding: '6px 0', borderBottom: `1px solid ${FIN.lineSoft}` }}>
                  <span style={{ color: FIN.faint }}>{ago(a.at)}</span> · <b>{a.who || 'System'}</b> — {a.message}
                </div>
              ))}
            </div>
          </div>
        </>}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: FIN.muted }}>{label}{children}</label>
}
function SectionHead({ title, right }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: FIN.muted, marginBottom: 4 }}>
    <span>{title}</span>{right && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{right}</span>}</div>
}
function MiniTask({ s }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '4px 0' }}>
    <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS[s.status]?.color }} />
    <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: FIN.muted }}>{s.ref}</span>
    <span style={{ textDecoration: s.status === 'done' ? 'line-through' : 'none' }}>{s.title}</span>
  </div>
}
export function Avatar({ name, size = 28 }) {
  return <span title={name} style={{ width: size, height: size, borderRadius: size / 2, background: avatarColor(name), color: '#fff', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 600 }}>{initials(name)}</span>
}
