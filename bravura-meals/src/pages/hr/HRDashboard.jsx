import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Icon, PageHeader, Button, StatCard, StatusBadge, showToast, fmtDate } from '../../components/ui'

const ACCENT = MODULE_COLORS.workforce

export default function HRDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, active: 0, onLeave: 0, newThisMonth: 0, terminatedThisMonth: 0 })
  const [activity, setActivity] = useState([])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetchAll()
  }, [currentSiteId])

  async function fetchAll() {
    setLoading(true)
    try {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

      const { data: emps, error: empErr } = await supabase
        .from('employees')
        .select('id, status, start_date, is_archived')
        .eq('site_id', currentSiteId)
      if (empErr) throw empErr

      const rows = (emps || []).filter(e => !e.is_archived)
      const total = rows.length
      const active = rows.filter(e => e.status === 'active').length
      const onLeave = rows.filter(e => e.status === 'on_leave' || e.status === 'long_leave').length
      const newThisMonth = rows.filter(e => e.start_date && e.start_date >= iso(monthStart) && e.start_date <= iso(monthEnd)).length

      const { count: termCount, error: termErr } = await supabase
        .from('employee_status_history')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', currentSiteId)
        .eq('new_status', 'terminated')
        .gte('created_at', monthStart.toISOString())
        .lte('created_at', new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString())
      if (termErr) throw termErr

      setStats({ total, active, onLeave, newThisMonth, terminatedThisMonth: termCount || 0 })

      const { data: hist, error: histErr } = await supabase
        .from('employee_status_history')
        .select('id, old_status, new_status, reason, effective_date, changed_by, created_at, employee:employees(id, name)')
        .eq('site_id', currentSiteId)
        .order('created_at', { ascending: false })
        .limit(10)
      if (histErr) throw histErr

      let rowsOut = hist || []
      const ids = [...new Set(rowsOut.map(h => h.changed_by).filter(Boolean))]
      if (ids.length) {
        const { data: profs, error: profErr } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', ids)
        if (profErr) throw profErr
        const byId = Object.fromEntries((profs || []).map(p => [p.id, p.full_name]))
        rowsOut = rowsOut.map(h => ({ ...h, changed_by_name: byId[h.changed_by] || null }))
      }
      setActivity(rowsOut)
    } catch (err) {
      console.error('HRDashboard fetch failed:', err)
      showToast('Failed to load HR dashboard', 'red')
    }
    setLoading(false)
  }

  if (!can('hr.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view the HR dashboard.
        </div>
      </Card>
    )
  }

  return (
    <div>
      <PageHeader title="HR Dashboard" site={currentSite} />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <StatCard label="Total Employees" value={loading ? '…' : stats.total} icon="groups" color={ACCENT} />
        <StatCard label="Active" value={loading ? '…' : stats.active} icon="check_circle" color={THEME.success} />
        <StatCard label="On Leave" value={loading ? '…' : stats.onLeave} sub="Incl. long leave" icon="beach_access" color={THEME.statusWarningText} />
        <StatCard label="New This Month" value={loading ? '…' : stats.newThisMonth} icon="person_add" color={THEME.info} />
        <StatCard label="Terminated This Month" value={loading ? '…' : stats.terminatedThisMonth} icon="person_off" color={THEME.error} />
      </div>

      {/* Quick actions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '18px' }}>
        {can('hr.create') && (
          <Button icon="person_add" onClick={() => setPage('wf_employee_form')} style={{ background: ACCENT, border: `1px solid ${ACCENT}` }}>
            Add Employee
          </Button>
        )}
        <Button variant="outlined" icon="groups" onClick={() => setPage('wf_employees')}>View All Employees</Button>
        {can('hr.view') && (
          <Button variant="outlined" icon="account_tree" onClick={() => setPage('wf_departments')}>Departments</Button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) minmax(320px, 2fr)', gap: '14px', alignItems: 'start' }}>
        {/* Pending items */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <Icon name="pending_actions" size={18} style={{ color: ACCENT }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>Pending Items</div>
          </div>
          <div style={{ fontSize: '28px', fontWeight: 600, color: THEME.text, lineHeight: 1.1 }}>0</div>
          <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '6px' }}>
            Leave approvals arrive in HR Phase 2
          </div>
        </Card>

        {/* Recent activity */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <Icon name="history" size={18} style={{ color: ACCENT }} />
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>Recent Activity</div>
          </div>
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
          ) : activity.length === 0 ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>No status changes recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {activity.map((h, i) => (
                <div key={h.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                  padding: '9px 0',
                  borderBottom: i === activity.length - 1 ? 'none' : `1px solid ${THEME.outlineVar}`,
                }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: THEME.text, minWidth: '120px' }}>
                    {h.employee?.name || 'Unknown'}
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    {h.old_status ? <StatusBadge status={h.old_status} /> : <span style={{ fontSize: '11px', color: THEME.textLow }}>—</span>}
                    <Icon name="arrow_forward" size={14} style={{ color: THEME.textLow }} />
                    <StatusBadge status={h.new_status} />
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textMed, textAlign: 'right' }}>
                    {fmtDate((h.effective_date || h.created_at || '').slice(0, 10))}
                    {h.changed_by_name && <span style={{ color: THEME.textLow }}> · by {h.changed_by_name}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
