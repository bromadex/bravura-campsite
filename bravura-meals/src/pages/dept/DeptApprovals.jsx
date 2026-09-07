import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'
const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }

export default function DeptApprovals({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const { user } = useAuth()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const query = supabase
      .from('dept_tasks')
      .select('*, project:dept_projects!inner(id, name, site_id, department_id, department:departments(id, name, color)), assignee:employees!dept_tasks_assigned_to_fkey(first_name, last_name)')
      .eq('project.site_id', currentSiteId)
      .eq('is_archived', false)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })

    if (filter === 'pending') {
      query.eq('approved', false)
    } else {
      query.eq('approved', true)
    }

    const { data } = await query
    setTasks(data || [])
    setLoading(false)
  }, [currentSiteId, filter])

  useEffect(() => { load() }, [load])

  async function handleApprove(taskId) {
    await supabase.from('dept_tasks').update({
      approved: true,
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
    }).eq('id', taskId)
    load()
  }

  async function handleReject(taskId) {
    await supabase.from('dept_tasks').update({
      status: 'in_progress',
      approved: false,
      approved_by: null,
      approved_at: null,
    }).eq('id', taskId)
    load()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Task Approvals</div>
        <div style={{ display: 'flex', gap: '4px', background: THEME.surfaceVar, borderRadius: '10px', padding: '3px' }}>
          {[{ k: 'pending', l: 'Pending' }, { k: 'approved', l: 'Approved' }].map(f => (
            <button key={f.k} onClick={() => setFilter(f.k)}
              style={{ padding: '6px 16px', borderRadius: '8px', border: 'none', background: filter === f.k ? THEME.surface : 'transparent', color: filter === f.k ? color : THEME.textMed, fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxShadow: filter === f.k ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>
          {filter === 'pending' ? 'No tasks awaiting approval.' : 'No approved tasks.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tasks.map(t => {
            const dc = t.project?.department?.color || color
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', background: THEME.surface, borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderLeft: `4px solid ${dc}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{t.title}</div>
                  <div style={{ fontSize: '12px', color: THEME.textLow, display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
                    <span style={{ color: dc }}>{t.project?.department?.name}</span>
                    <span>{t.project?.name}</span>
                    {t.assignee && <span>→ {t.assignee.first_name} {t.assignee.last_name}</span>}
                    <span style={{ color: PRIORITY_CLR[t.priority], fontWeight: 600 }}>{t.priority}</span>
                  </div>
                  {t.approved && t.approved_at && (
                    <div style={{ fontSize: '11px', color: '#2E7D32', marginTop: '4px' }}>
                      Approved {new Date(t.approved_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
                {filter === 'pending' && can('dept.approve') && (
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <button onClick={() => handleApprove(t.id)}
                      style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: '#2E7D32', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="check" size={14} style={{ color: '#fff' }} /> Approve
                    </button>
                    <button onClick={() => handleReject(t.id)}
                      style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textMed, fontSize: '12px', cursor: 'pointer' }}>
                      Return
                    </button>
                  </div>
                )}
                {filter === 'approved' && (
                  <Icon name="verified" size={22} style={{ color: '#2E7D32', flexShrink: 0 }} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
