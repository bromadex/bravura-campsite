import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'
const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }
const STATUS_CLR = { not_started: '#78909C', in_progress: '#1E88E5', late: '#E53935', completed: '#2E7D32' }

export default function DeptProjectGrid({ setPage, projectId }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState('title')
  const [sortAsc, setSortAsc] = useState(true)

  const load = useCallback(async () => {
    if (!projectId || !currentSiteId) return
    setLoading(true)
    const [projRes, taskRes, empRes] = await Promise.all([
      supabase.from('dept_projects').select('*, department:departments(id, name, color, icon)').eq('id', projectId).maybeSingle(),
      supabase.from('dept_tasks').select('*, assignee:employees!dept_tasks_assigned_to_fkey(id, name)').eq('project_id', projectId).eq('is_archived', false).order('sort_order'),
      supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('status', 'active'),
    ])
    setProject(projRes.data)
    setTasks(taskRes.data || [])
    setEmployees(empRes.data || [])
    setLoading(false)
  }, [projectId, currentSiteId])

  useEffect(() => { load() }, [load])

  async function inlineUpdate(id, field, value) {
    await supabase.from('dept_tasks').update({ [field]: value || null }).eq('id', id)
    load()
  }

  function toggleSort(col) {
    if (sortCol === col) setSortAsc(!sortAsc)
    else { setSortCol(col); setSortAsc(true) }
  }

  const sorted = [...tasks].sort((a, b) => {
    const va = a[sortCol] || ''
    const vb = b[sortCol] || ''
    return sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
  })

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
  if (!project) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Project not found.</div>

  const dc = project.department?.color || color
  const sel = { padding: '4px 8px', borderRadius: '6px', border: `1px solid ${THEME.outlineVar}`, fontSize: '12px', background: 'transparent', color: THEME.text, cursor: 'pointer' }

  const cols = [
    { key: 'title', label: 'Task', w: '30%' },
    { key: 'assigned_to', label: 'Assigned To', w: '18%' },
    { key: 'start_date', label: 'Start', w: '10%' },
    { key: 'due_date', label: 'Due', w: '10%' },
    { key: 'bucket', label: 'Bucket', w: '14%' },
    { key: 'status', label: 'Status', w: '9%' },
    { key: 'priority', label: 'Priority', w: '9%' },
  ]

  return (
    <div style={{ padding: '24px', maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button onClick={() => setPage('dept_projects')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}>
          <Icon name="arrow_back" size={20} />
        </button>
        <Icon name={project.department?.icon || 'folder'} size={22} style={{ color: dc }} />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 500, color: THEME.text }}>{project.name} — Grid</div>
          <div style={{ fontSize: '12px', color: dc }}>{project.department?.name}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => setPage(`dept_board:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Icon name="view_kanban" size={16} /> Board
          </button>
        </div>
      </div>

      <div style={{ background: THEME.surface, borderRadius: '16px', overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '800px' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
              {cols.map(c => (
                <th key={c.key} style={{ textAlign: 'left', padding: '10px 12px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', width: c.w, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => toggleSort(c.key)}>
                  {c.label} {sortCol === c.key ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>{t.title}</td>
                <td style={{ padding: '8px 12px' }}>
                  {can('dept.edit') ? (
                    <select value={t.assigned_to || ''} onChange={e => inlineUpdate(t.id, 'assigned_to', e.target.value)} style={sel}>
                      <option value="">—</option>
                      {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                  ) : (
                    <span style={{ color: THEME.textMed }}>{t.assignee ? t.assignee.name : '—'}</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px', color: THEME.textLow }}>{t.start_date || '—'}</td>
                <td style={{ padding: '8px 12px', color: THEME.textLow }}>{t.due_date || '—'}</td>
                <td style={{ padding: '8px 12px', color: THEME.textMed }}>{t.bucket}</td>
                <td style={{ padding: '8px 12px' }}>
                  {can('dept.edit') ? (
                    <select value={t.status} onChange={e => inlineUpdate(t.id, 'status', e.target.value)} style={{ ...sel, color: STATUS_CLR[t.status] || THEME.text, fontWeight: 600 }}>
                      {['not_started', 'in_progress', 'late', 'completed'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: (STATUS_CLR[t.status] || '#78909C') + '18', color: STATUS_CLR[t.status], fontWeight: 600 }}>{t.status.replace('_', ' ')}</span>
                  )}
                </td>
                <td style={{ padding: '8px 12px' }}>
                  {can('dept.edit') ? (
                    <select value={t.priority} onChange={e => inlineUpdate(t.id, 'priority', e.target.value)} style={{ ...sel, color: PRIORITY_CLR[t.priority] || THEME.text, fontWeight: 600 }}>
                      {['urgent', 'important', 'medium', 'low'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : (
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: (PRIORITY_CLR[t.priority] || '#78909C') + '18', color: PRIORITY_CLR[t.priority], fontWeight: 600 }}>{t.priority}</span>
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={7} style={{ padding: '30px', textAlign: 'center', color: THEME.textLow }}>No tasks in this project yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
