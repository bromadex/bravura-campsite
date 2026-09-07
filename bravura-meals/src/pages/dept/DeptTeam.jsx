import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard } from '../../components/dash'

const color = MODULE_COLORS.dept || '#1565C0'
const ROLE_CLR = { manager: '#7C4DFF', lead: '#1E88E5', member: '#2E7D32' }

export default function DeptTeam({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [departments, setDepartments] = useState([])
  const [members, setMembers] = useState([])
  const [employees, setEmployees] = useState([])
  const [taskCounts, setTaskCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ employee_id: '', department_id: '', role: 'member' })
  const [saving, setSaving] = useState(false)
  const [filterDept, setFilterDept] = useState('all')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [deptRes, memRes, empRes, taskRes] = await Promise.all([
      supabase.from('departments').select('*').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('department_members').select('*, employee:employees(id, name, employee_number, position_title, status), department:departments(id, name, color, icon, site_id)').order('created_at'),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('dept_tasks').select('assigned_to, status, project:dept_projects!inner(site_id)').eq('project.site_id', currentSiteId).eq('is_archived', false),
    ])

    const depts = deptRes.data || []
    const mems = (memRes.data || []).filter(m => m.department && depts.some(d => d.id === m.department_id))
    setDepartments(depts)
    setMembers(mems)
    setEmployees(empRes.data || [])

    const counts = {}
    ;(taskRes.data || []).forEach(t => {
      if (t.assigned_to) {
        if (!counts[t.assigned_to]) counts[t.assigned_to] = { total: 0, completed: 0, overdue: 0 }
        counts[t.assigned_to].total++
        if (t.status === 'completed') counts[t.assigned_to].completed++
        if (t.status === 'late') counts[t.assigned_to].overdue++
      }
    })
    setTaskCounts(counts)
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  async function handleAdd() {
    if (!addForm.employee_id || !addForm.department_id) return
    setSaving(true)
    await supabase.from('department_members').insert(addForm)
    setSaving(false)
    setShowAdd(false)
    setAddForm({ employee_id: '', department_id: '', role: 'member' })
    load()
  }

  async function handleRemove(id) {
    await supabase.from('department_members').delete().eq('id', id)
    load()
  }

  async function handleRoleChange(id, role) {
    await supabase.from('department_members').update({ role }).eq('id', id)
    load()
  }

  const filtered = filterDept === 'all' ? members : members.filter(m => m.department_id === filterDept)
  const existingEmpIds = new Set(members.map(m => m.employee_id))
  const availableEmployees = employees.filter(e => !existingEmpIds.has(e.id))

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', background: THEME.surface, color: THEME.text, width: '100%' }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Department Team</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {can('dept.edit') && (
            <button onClick={() => { setShowAdd(true); setAddForm({ employee_id: '', department_id: departments[0]?.id || '', role: 'member' }) }}
              style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
              <Icon name="person_add" size={16} style={{ color: '#fff' }} /> Add Member
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <div style={{ background: THEME.surface, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Add Member</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            <select value={addForm.employee_id} onChange={e => setAddForm({ ...addForm, employee_id: e.target.value })} style={inp}>
              <option value="">Select employee…</option>
              {availableEmployees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.employee_number || '—'})</option>)}
            </select>
            <select value={addForm.department_id} onChange={e => setAddForm({ ...addForm, department_id: e.target.value })} style={inp}>
              <option value="">Department…</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value })} style={inp}>
              <option value="member">Member</option>
              <option value="lead">Lead</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowAdd(false)} style={{ padding: '7px 16px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleAdd} disabled={saving || !addForm.employee_id} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Adding…' : 'Add'}</button>
          </div>
        </div>
      )}

      {/* Workload overview */}
      {!loading && filtered.length > 0 && (
        <DashCard style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Workload Overview</div>
          <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
            {filtered.map(m => {
              const tc = taskCounts[m.employee_id] || { total: 0, completed: 0, overdue: 0 }
              const pct = tc.total ? Math.round((tc.completed / tc.total) * 100) : 0
              return (
                <div key={m.id} style={{ minWidth: '120px', padding: '10px', borderRadius: '10px', background: THEME.surfaceVar + '40', textAlign: 'center' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: (ROLE_CLR[m.role] || color) + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 6px' }}>
                    <Icon name="person" size={18} style={{ color: ROLE_CLR[m.role] || color }} />
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.employee?.name}
                  </div>
                  <div style={{ fontSize: '10px', color: THEME.textLow }}>{tc.total} tasks · {pct}% done</div>
                  {tc.overdue > 0 && <div style={{ fontSize: '10px', color: '#E53935', fontWeight: 600 }}>{tc.overdue} overdue</div>}
                </div>
              )
            })}
          </div>
        </DashCard>
      )}

      {/* Member roster */}
      {loading ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>No members yet.</div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                {['Employee', 'Emp #', 'Department', 'Role', 'Tasks', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const tc = taskCounts[m.employee_id] || { total: 0, completed: 0, overdue: 0 }
                return (
                  <tr key={m.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>
                      {m.employee ? m.employee.name : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.textLow }}>{m.employee?.employee_number || '—'}</td>
                    <td style={{ padding: '10px 14px', color: m.department?.color || color }}>{m.department?.name || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {can('dept.edit') ? (
                        <select value={m.role} onChange={e => handleRoleChange(m.id, e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: '6px', border: `1px solid ${THEME.outlineVar}`, fontSize: '12px', background: 'transparent', color: ROLE_CLR[m.role] || THEME.text, fontWeight: 600, cursor: 'pointer' }}>
                          <option value="member">Member</option>
                          <option value="lead">Lead</option>
                          <option value="manager">Manager</option>
                        </select>
                      ) : (
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '6px', background: (ROLE_CLR[m.role] || '#78909C') + '18', color: ROLE_CLR[m.role], fontWeight: 600 }}>{m.role}</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: '12px' }}>
                      <span style={{ color: THEME.text }}>{tc.total}</span>
                      {tc.overdue > 0 && <span style={{ color: '#E53935', marginLeft: '6px' }}>({tc.overdue} overdue)</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {can('dept.edit') && (
                        <button onClick={() => handleRemove(m.id)} style={{ padding: '4px 8px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textLow, fontSize: '11px', cursor: 'pointer' }}>Remove</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
