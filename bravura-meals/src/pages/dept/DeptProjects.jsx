import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'

const STATUS_OPTS = ['active', 'completed', 'on_hold', 'cancelled']
const PRIORITY_OPTS = ['urgent', 'important', 'medium', 'low']
const STATUS_CLR = { active: '#2E7D32', completed: '#0277BD', on_hold: '#D97706', cancelled: '#E53935' }
const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }

export default function DeptProjects({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [projects, setProjects] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', department_id: '', status: 'active', priority: 'medium', start_date: '', due_date: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState('card')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [projRes, deptRes] = await Promise.all([
      supabase.from('dept_projects').select('*, department:departments(id, name, color, icon)').eq('site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('departments').select('*').eq('site_id', currentSiteId).eq('is_archived', false),
    ])
    setProjects(projRes.data || [])
    setDepartments(deptRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (!form.name.trim() || !form.department_id) return
    setSaving(true)
    const payload = { ...form, site_id: currentSiteId, start_date: form.start_date || null, due_date: form.due_date || null }
    if (editId) {
      await supabase.from('dept_projects').update(payload).eq('id', editId)
    } else {
      await supabase.from('dept_projects').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    setEditId(null)
    setForm({ name: '', department_id: '', status: 'active', priority: 'medium', start_date: '', due_date: '', description: '' })
    load()
  }

  async function handleArchive(id) {
    await supabase.from('dept_projects').update({ is_archived: true }).eq('id', id)
    load()
  }

  function openEdit(p) {
    setForm({ name: p.name, department_id: p.department_id, status: p.status, priority: p.priority, start_date: p.start_date || '', due_date: p.due_date || '', description: p.description || '' })
    setEditId(p.id)
    setShowForm(true)
  }

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', background: THEME.surface, color: THEME.text, width: '100%' }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Projects</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setView(view === 'card' ? 'list' : 'card')} style={{ padding: '7px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '12px', cursor: 'pointer' }}>
            <Icon name={view === 'card' ? 'list' : 'grid_view'} size={16} />
          </button>
          {can('dept.create') && (
            <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', department_id: departments[0]?.id || '', status: 'active', priority: 'medium', start_date: '', due_date: '', description: '' }) }}
              style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="add" size={16} style={{ color: '#fff' }} /> New Project
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div style={{ background: THEME.surface, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>{editId ? 'Edit Project' : 'New Project'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ gridColumn: '1/3' }}>
              <input placeholder="Project name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} />
            </div>
            <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })} style={inp}>
              <option value="">Department…</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp}>
              {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={inp}>
              {PRIORITY_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} style={inp} />
            <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} style={inp} />
            <div style={{ gridColumn: '1/3' }}>
              <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowForm(false); setEditId(null) }} style={{ padding: '7px 16px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : projects.length === 0 ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>No projects yet.</div>
      ) : view === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {projects.map(p => {
            const dc = p.department?.color || color
            return (
              <div key={p.id} style={{ background: THEME.surface, borderRadius: '16px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', borderLeft: `4px solid ${dc}` }}
                onClick={() => setPage(`dept_board:${p.id}`)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Icon name={p.department?.icon || 'folder'} size={18} style={{ color: dc }} />
                  <span style={{ fontSize: '11px', color: dc, fontWeight: 600 }}>{p.department?.name || 'Dept'}</span>
                </div>
                <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>{p.name}</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: (STATUS_CLR[p.status] || '#78909C') + '18', color: STATUS_CLR[p.status] || '#78909C', fontWeight: 600 }}>{p.status}</span>
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: (PRIORITY_CLR[p.priority] || '#78909C') + '18', color: PRIORITY_CLR[p.priority] || '#78909C', fontWeight: 600 }}>{p.priority}</span>
                  {p.due_date && <span style={{ fontSize: '11px', color: THEME.textLow }}>{p.due_date}</span>}
                </div>
                {can('dept.edit') && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
                    <button onClick={e => { e.stopPropagation(); openEdit(p) }} style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textMed, fontSize: '11px', cursor: 'pointer' }}>Edit</button>
                    <button onClick={e => { e.stopPropagation(); handleArchive(p.id) }} style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textLow, fontSize: '11px', cursor: 'pointer' }}>Archive</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                {['Project', 'Department', 'Status', 'Priority', 'Due'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => setPage(`dept_board:${p.id}`)}>
                  <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{p.name}</td>
                  <td style={{ padding: '10px 14px', color: p.department?.color || color }}>{p.department?.name || '—'}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: (STATUS_CLR[p.status] || '#78909C') + '18', color: STATUS_CLR[p.status], fontWeight: 600 }}>{p.status}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: (PRIORITY_CLR[p.priority] || '#78909C') + '18', color: PRIORITY_CLR[p.priority], fontWeight: 600 }}>{p.priority}</span>
                  </td>
                  <td style={{ padding: '10px 14px', color: THEME.textLow }}>{p.due_date || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
