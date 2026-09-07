import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'
const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }

export default function DeptNotifications({ setPage }) {
  const { currentSiteId } = useSite()
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data } = await supabase
      .from('dept_tasks')
      .select('*, project:dept_projects!inner(id, name, site_id, department_id, department:departments(id, name, color)), assignee:employees!dept_tasks_assigned_to_fkey(first_name, last_name)')
      .eq('project.site_id', currentSiteId)
      .eq('is_archived', false)
      .neq('status', 'completed')
      .not('due_date', 'is', null)
      .lt('due_date', new Date().toISOString().slice(0, 10))
      .order('due_date', { ascending: true })
    setTasks(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  function daysOverdue(d) {
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
    return diff
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Icon name="notifications_active" size={24} style={{ color: '#E53935' }} />
        Overdue Tasks
        {!loading && tasks.length > 0 && (
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#fff', background: '#E53935', borderRadius: '12px', padding: '2px 10px' }}>{tasks.length}</span>
        )}
      </div>

      {loading ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : tasks.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="check_circle" size={40} style={{ color: '#2E7D32', marginBottom: '8px' }} />
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>No overdue tasks — great work!</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tasks.map(t => {
            const days = daysOverdue(t.due_date)
            const dc = t.project?.department?.color || color
            return (
              <div key={t.id} onClick={() => setPage(`dept_board:${t.project_id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', background: THEME.surface, borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', borderLeft: `4px solid ${days > 7 ? '#E53935' : days > 3 ? '#D97706' : '#1E88E5'}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{t.title}</div>
                  <div style={{ fontSize: '12px', color: THEME.textLow, display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
                    <span style={{ color: dc }}>{t.project?.department?.name}</span>
                    <span>{t.project?.name}</span>
                    {t.assignee && <span>→ {t.assignee.first_name} {t.assignee.last_name}</span>}
                    <span style={{ color: PRIORITY_CLR[t.priority], fontWeight: 600 }}>{t.priority}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: days > 7 ? '#E53935' : days > 3 ? '#D97706' : '#1E88E5' }}>{days}d</div>
                  <div style={{ fontSize: '10px', color: THEME.textLow }}>overdue</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
