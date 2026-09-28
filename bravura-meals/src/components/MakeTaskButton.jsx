import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { showToast } from './ui'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { friendlyError } from '../utils/friendlyError'
import { FIN, finBtn, finBtn2, finInput, finCard } from '../utils/financeTheme'
import TaskDrawer from './TaskDrawer'
import { STATUS, usePeople, dueInfo } from '../pages/projects/pjShared'

// "Make a task" on any record (#76): a task (or private to-do) linked to this PO / incident / machine / bill …,
// lands in the assignee's My workspace, and the task opens the record again (link = '/module/page:<id>').
// Also lists the tasks already made from this record.
export default function MakeTaskButton({ recordTable, recordId, label, link, defaultTitle = '', compact = false }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const people = usePeople()
  const [tasks, setTasks] = useState([])
  const [form, setForm] = useState(null)
  const [projects, setProjects] = useState([])
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    if (!recordId) return
    const { data } = await supabase.rpc('pj_tasks_for_record', { p_table: recordTable, p_id: String(recordId) })
    setTasks(data || [])
  }, [recordTable, recordId])
  useEffect(() => { load() }, [load])

  async function start() {
    if (!projects.length && currentSiteId) {
      const { data } = await supabase.from('projects').select('id, name, key').eq('site_id', currentSiteId).eq('is_archived', false).eq('is_template', false).order('name')
      setProjects(data || [])
    }
    setForm({ title: defaultTitle, project_id: '', assigned_to: '', due_date: '' })
  }
  async function save() {
    const { data, error } = await supabase.rpc('pj_task_save', { p: { ...form, project_id: form.project_id || null, assigned_to: form.assigned_to || null,
      link: { record_table: recordTable, record_id: String(recordId), label, link } } })
    if (error) return showToast(friendlyError(error), 'error')
    showToast(`Task ${data.ref || ''} made`.replace(' null', '')); setForm(null); load()
  }

  if (!recordId) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontFamily: FIN.sans }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={start} style={{ ...finBtn2, minHeight: compact ? 32 : 38, fontSize: 13 }}>✓ Make a task</button>
        {tasks.map(t => {
          const due = dueInfo(t.due_date, t.status)
          return <button key={t.id} onClick={() => setOpen(t.id)} title={t.title}
            style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 30, padding: '0 10px', borderRadius: 999, border: `1px solid ${FIN.line}`, background: '#fff', cursor: 'pointer', fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: STATUS[t.status]?.color }} />
            <span style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{t.ref}</span>
            <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            {t.assignee && <span style={{ color: FIN.faint }}>· {t.assignee}</span>}
            {due && <span style={{ color: due.color }}>· {due.text}</span>}
          </button>
        })}
      </div>
      {form && (
        <div role="dialog" aria-modal="true" onMouseDown={e => e.target === e.currentTarget && setForm(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,.35)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ ...finCard, width: 'min(480px, 100%)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 17, fontWeight: 600 }}>Make a task</div>
            <div style={{ fontSize: 13, color: FIN.muted }}>Linked to <b>{label}</b> — the task opens this record.</div>
            <input autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="What needs doing?" aria-label="Title" style={finInput} />
            <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })} aria-label="Assign to" style={finInput}>
              <option value="">Me</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })} aria-label="Project" style={{ ...finInput, flex: 1 }}>
                <option value="">No project (to-do)</option>
                {projects.filter(() => can('projects.view')).map(p => <option key={p.id} value={p.id}>{p.key} · {p.name}</option>)}
              </select>
              <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} aria-label="Due" style={{ ...finInput, width: 150 }} />
            </div>
            {!form.project_id && form.assigned_to && <div style={{ fontSize: 12, color: FIN.ochreText }}>To give it to someone else, pick a project — to-dos without a project are private to you.</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setForm(null)} style={finBtn2}>Cancel</button>
              <button onClick={save} disabled={!form.title.trim() || (!form.project_id && form.assigned_to)} style={finBtn}>Make task</button>
            </div>
          </div>
        </div>
      )}
      {open && <TaskDrawer taskId={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}
