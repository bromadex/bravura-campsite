import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'
const DEFAULT_BUCKETS = ['Initiating', 'Planning', 'Executing', 'Monitoring & Controlling', 'Closing']
const BUCKET_CLR = { Initiating: '#7C4DFF', Planning: '#1E88E5', Executing: '#2E7D32', 'Monitoring & Controlling': '#D97706', Closing: '#0277BD' }
const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }

export default function DeptProjectBoard({ setPage, projectId }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [addingBucket, setAddingBucket] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [editTask, setEditTask] = useState(null)
  const [dragId, setDragId] = useState(null)

  const load = useCallback(async () => {
    if (!projectId || !currentSiteId) return
    setLoading(true)
    const [projRes, taskRes, empRes] = await Promise.all([
      supabase.from('dept_projects').select('*, department:departments(id, name, color, icon, custom_buckets)').eq('id', projectId).maybeSingle(),
      supabase.from('dept_tasks').select('*, assignee:employees!dept_tasks_assigned_to_fkey(id, first_name, last_name)').eq('project_id', projectId).eq('is_archived', false).order('sort_order'),
      supabase.from('employees').select('id, first_name, last_name').eq('site_id', currentSiteId).eq('status', 'active').order('first_name'),
    ])
    setProject(projRes.data)
    setTasks(taskRes.data || [])
    setEmployees(empRes.data || [])
    setLoading(false)
  }, [projectId, currentSiteId])

  useEffect(() => { load() }, [load])

  async function addTask(bucket) {
    if (!newTitle.trim()) return
    await supabase.from('dept_tasks').insert({ project_id: projectId, title: newTitle.trim(), bucket, sort_order: tasks.filter(t => t.bucket === bucket).length })
    setNewTitle('')
    setAddingBucket(null)
    load()
  }

  async function moveToBucket(taskId, bucket) {
    await supabase.from('dept_tasks').update({ bucket }).eq('id', taskId)
    load()
  }

  async function updateTask(id, updates) {
    await supabase.from('dept_tasks').update(updates).eq('id', id)
    load()
  }

  async function archiveTask(id) {
    await supabase.from('dept_tasks').update({ is_archived: true }).eq('id', id)
    setEditTask(null)
    load()
  }

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', background: THEME.surface, color: THEME.text, width: '100%' }

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
  if (!project) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Project not found.</div>
  const buckets = (project.department?.custom_buckets?.length ? project.department.custom_buckets : DEFAULT_BUCKETS)

  const dc = project.department?.color || color

  return (
    <div style={{ padding: '24px', maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button onClick={() => setPage('dept_projects')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, display: 'flex', alignItems: 'center' }}>
          <Icon name="arrow_back" size={20} />
        </button>
        <Icon name={project.department?.icon || 'folder'} size={22} style={{ color: dc }} />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 500, color: THEME.text }}>{project.name}</div>
          <div style={{ fontSize: '12px', color: dc }}>{project.department?.name || 'Department'}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => setPage(`dept_grid:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Icon name="table_rows" size={16} /> Grid
          </button>
          <button onClick={() => setPage(`dept_calendar:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Icon name="calendar_month" size={16} /> Calendar
          </button>
          <button onClick={() => setPage(`dept_charts:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Icon name="bar_chart" size={16} /> Charts
          </button>
        </div>
      </div>

      {/* Kanban columns */}
      <div style={{ display: 'flex', gap: '14px', overflowX: 'auto', paddingBottom: '16px', minHeight: '400px' }}>
        {buckets.map(bucket => {
          const bucketTasks = tasks.filter(t => t.bucket === bucket)
          return (
            <div key={bucket}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); if (dragId) moveToBucket(dragId, bucket) }}
              style={{ minWidth: '250px', width: '250px', flexShrink: 0, background: THEME.surfaceVar + '40', borderRadius: '14px', padding: '12px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', padding: '0 4px' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: BUCKET_CLR[bucket] || color }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{bucket}</span>
                <span style={{ fontSize: '11px', color: THEME.textLow, marginLeft: 'auto' }}>{bucketTasks.length}</span>
              </div>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '60px' }}>
                {bucketTasks.map(t => (
                  <div key={t.id} draggable onDragStart={() => setDragId(t.id)} onDragEnd={() => setDragId(null)}
                    onClick={() => setEditTask(t)}
                    style={{
                      background: THEME.surface, borderRadius: '12px', padding: '12px', cursor: 'grab',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: `3px solid ${PRIORITY_CLR[t.priority] || '#78909C'}`,
                    }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text, marginBottom: '6px' }}>{t.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', background: (PRIORITY_CLR[t.priority] || '#78909C') + '18', color: PRIORITY_CLR[t.priority], fontWeight: 600 }}>{t.priority}</span>
                      {t.due_date && <span style={{ fontSize: '10px', color: THEME.textLow }}>{t.due_date}</span>}
                      {t.assignee && <span style={{ fontSize: '10px', color: THEME.textMed }}>{t.assignee.first_name} {t.assignee.last_name?.[0]}.</span>}
                      {t.checklist?.length > 0 && (
                        <span style={{ fontSize: '10px', color: THEME.textLow }}>
                          ✓ {t.checklist.filter(c => c.done).length}/{t.checklist.length}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {can('dept.create') && (
                addingBucket === bucket ? (
                  <div style={{ marginTop: '8px' }}>
                    <input autoFocus placeholder="Task title" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') addTask(bucket); if (e.key === 'Escape') setAddingBucket(null) }}
                      style={{ ...inp, marginBottom: '6px' }} />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => addTask(bucket)} style={{ flex: 1, padding: '6px', borderRadius: '6px', border: 'none', background: color, color: '#fff', fontSize: '12px', cursor: 'pointer' }}>Add</button>
                      <button onClick={() => setAddingBucket(null)} style={{ padding: '6px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textMed, fontSize: '12px', cursor: 'pointer' }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAddingBucket(bucket); setNewTitle('') }}
                    style={{ marginTop: '8px', padding: '6px', borderRadius: '8px', border: `1px dashed ${THEME.outline}`, background: 'transparent', color: THEME.textLow, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                    <Icon name="add" size={14} /> Add task
                  </button>
                )
              )}
            </div>
          )
        })}
      </div>

      {/* Task detail modal */}
      {editTask && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setEditTask(null)}>
          <div style={{ background: THEME.surface, borderRadius: '16px', padding: '24px', width: '500px', maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Edit Task</div>
              <button onClick={() => setEditTask(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow }}><Icon name="close" size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <input value={editTask.title} onChange={e => setEditTask({ ...editTask, title: e.target.value })} style={inp} />
              <select value={editTask.bucket} onChange={e => setEditTask({ ...editTask, bucket: e.target.value })} style={inp}>
                {buckets.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <select value={editTask.status} onChange={e => setEditTask({ ...editTask, status: e.target.value })} style={inp}>
                {['not_started', 'in_progress', 'late', 'completed'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              <select value={editTask.priority} onChange={e => setEditTask({ ...editTask, priority: e.target.value })} style={inp}>
                {['urgent', 'important', 'medium', 'low'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select value={editTask.assigned_to || ''} onChange={e => setEditTask({ ...editTask, assigned_to: e.target.value || null })} style={inp}>
                <option value="">Unassigned</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
              </select>
              <input type="date" value={editTask.start_date || ''} onChange={e => setEditTask({ ...editTask, start_date: e.target.value || null })} style={inp} placeholder="Start date" />
              <input type="date" value={editTask.due_date || ''} onChange={e => setEditTask({ ...editTask, due_date: e.target.value || null })} style={inp} placeholder="Due date" />
              <textarea value={editTask.notes || ''} onChange={e => setEditTask({ ...editTask, notes: e.target.value })} rows={3} placeholder="Notes" style={{ ...inp, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              {can('dept.delete') && (
                <button onClick={() => archiveTask(editTask.id)} style={{ padding: '7px 14px', borderRadius: '8px', border: `1px solid ${THEME.error}`, background: 'transparent', color: THEME.error, fontSize: '12px', cursor: 'pointer', marginRight: 'auto' }}>Archive</button>
              )}
              <button onClick={() => setEditTask(null)} style={{ padding: '7px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '12px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={async () => {
                const { id, assignee, project, ...rest } = editTask
                await updateTask(id, { title: rest.title, bucket: rest.bucket, status: rest.status, priority: rest.priority, assigned_to: rest.assigned_to, start_date: rest.start_date, due_date: rest.due_date, notes: rest.notes })
                setEditTask(null)
              }} style={{ padding: '7px 14px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
