import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Icon, PageHeader, showToast } from '../../components/ui'
import { DashCard, KpiCard, ActivityRow, SectionTitle, AreaChart, DonutGauge } from '../../components/dash'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.admin

// Literal hexes so the accent+'18' tint pattern works
const ACCENT = {
  indigo: '#3949AB',
  orange: '#FB8C00',
  green:  '#2E7D32',
  pink:   '#EC4899',
  blue:   '#1E88E5',
  amber:  '#D97706',
  grey:   '#607D8B',
  red:    '#D32F2F',
}

// Audit action → icon/colour for activity rows
function actionMeta(action) {
  const a = (action || '').toLowerCase()
  if (a.includes('insert') || a.includes('create')) return { icon: 'add_circle', clr: ACCENT.green }
  if (a.includes('update') || a.includes('edit'))   return { icon: 'edit',       clr: ACCENT.blue }
  if (a.includes('delete') || a.includes('remove')) return { icon: 'delete',     clr: ACCENT.red }
  return { icon: 'history', clr: ACCENT.grey }
}

function QuickLinkTile({ icon, label, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: THEME.surface, borderRadius: '16px', padding: '16px 18px',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0,
        boxShadow: hover ? '0 4px 12px rgba(0,0,0,0.10)' : '0 1px 3px rgba(0,0,0,0.06)',
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow .15s, transform .15s',
      }}
    >
      <div style={{
        width: '36px', height: '36px', borderRadius: '50%', background: color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon name={icon} size={18} style={{ color }} />
      </div>
      <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

export default function AdminDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('audit_log', { column: 'site_id', value: currentSiteId }, fetchData)
  const [stats, setStats] = useState({ users: 0, roles: 0, sites: 0, recentAudit: 0, pendingInvites: 0, usersWithoutRoles: 0, activeUsers: 0, inactiveUsers: 0 })
  const [recentActivity, setRecentActivity] = useState([])
  const [auditVolume, setAuditVolume] = useState({ points: [], labels: [] })
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [usersRes, rolesRes, sitesRes, auditCountRes, activityRes, invitesRes, profileIdsRes, userRolesRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('roles').select('id', { count: 'exact', head: true }),
        supabase.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('audit_log').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
        supabase.from('audit_log').select('*, actor:profiles!audit_log_user_id_fkey(full_name, username)').order('created_at', { ascending: false }).limit(10),
        supabase.from('pending_role_assignments').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id'),
        supabase.from('user_roles').select('user_id'),
      ])
      const roledIds = new Set((userRolesRes.data || []).map(r => r.user_id))
      const usersWithoutRoles = (profileIdsRes.data || []).filter(p => !roledIds.has(p.id)).length
      setStats({
        users: usersRes.count || 0,
        roles: rolesRes.count || 0,
        sites: sitesRes.count || 0,
        recentAudit: auditCountRes.count || 0,
        pendingInvites: invitesRes.count || 0,
        usersWithoutRoles,
        activeUsers: (usersRes.count || 0) - usersWithoutRoles,
        inactiveUsers: usersWithoutRoles,
      })
      setRecentActivity(activityRes.data || [])

      // Audit volume over last 12 months
      const now = new Date()
      const volumePoints = []
      const volumeLabels = []
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999)
        const { count } = await supabase
          .from('audit_log')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', start.toISOString())
          .lte('created_at', end.toISOString())
        volumePoints.push(count || 0)
        volumeLabels.push(start.toLocaleDateString(undefined, { month: 'short' }))
      }
      setAuditVolume({ points: volumePoints, labels: volumeLabels })
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setLoading(false)
    }
  }

  const roledPct = stats.users > 0 ? ((stats.users - stats.usersWithoutRoles) / stats.users) * 100 : 0

  const kpis = [
    { label: 'Total Users', value: stats.users, icon: 'group', accent: ACCENT.indigo, sub: 'registered profiles', progress: stats.users > 0 ? 100 : 0, page: 'admin_users' },
    { label: 'Total Roles', value: stats.roles, icon: 'admin_panel_settings', accent: ACCENT.orange, page: 'admin_roles' },
    { label: 'Active Sites', value: stats.sites, icon: 'location_on', accent: ACCENT.green, page: 'admin_sites' },
    { label: 'Audit (24h)', value: stats.recentAudit, icon: 'history', accent: ACCENT.pink, sub: 'events in last 24 hours', page: 'admin_audit' },
    { label: 'Pending Invitations', value: stats.pendingInvites, icon: 'mail', accent: ACCENT.blue, page: 'admin_invitations' },
    {
      label: 'Users Without Roles', value: stats.usersWithoutRoles, icon: 'person_off',
      accent: stats.usersWithoutRoles > 0 ? ACCENT.amber : ACCENT.grey,
      sub: `${roledPct.toFixed(0)}% of users have a role`,
      progress: roledPct,
      page: 'admin_users',
    },
  ]

  const quickLinks = [
    { label: 'Users & Roles', icon: 'group', page: 'admin_users' },
    { label: 'Role Management', icon: 'admin_panel_settings', page: 'admin_roles' },
    { label: 'Site Management', icon: 'location_on', page: 'admin_sites' },
    { label: 'Pending Invitations', icon: 'mail', page: 'admin_invitations' },
    { label: 'System Settings', icon: 'settings', page: 'admin_settings' },
    { label: 'Permissions', icon: 'lock', page: 'admin_permissions' },
    { label: 'Audit Log', icon: 'history', page: 'admin_audit' },
  ]

  if (!can('users.view')) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader title="Admin Dashboard" />

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color }} />
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
            {kpis.map(k => (
              <KpiCard
                key={k.label}
                label={k.label}
                value={k.value}
                sub={k.sub}
                icon={k.icon}
                accent={k.accent}
                progress={k.progress}
                onClick={k.page ? () => setPage(k.page) : undefined}
              />
            ))}
          </div>

          {/* Audit volume + user status */}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(220px, 1fr)', gap: '16px', marginBottom: '16px' }}>
            <DashCard>
              <SectionTitle title="Audit Log Volume" subtitle="Events per month — last 12 months" />
              {auditVolume.points.length > 0 ? (
                <AreaChart points={auditVolume.points} labels={auditVolume.labels} color={ACCENT.pink} />
              ) : (
                <div style={{ color: THEME.textLow, fontSize: '13px', padding: '20px 0' }}>No data</div>
              )}
            </DashCard>
            <DashCard>
              <SectionTitle title="User Status" subtitle="Active vs inactive users" />
              <DonutGauge
                pct={stats.users > 0 ? (stats.activeUsers / stats.users) * 100 : 0}
                color={ACCENT.green}
                label="with roles"
                legend={[[ACCENT.green, `Active ${stats.activeUsers}`], [ACCENT.grey, `No role ${stats.inactiveUsers}`]]}
              />
            </DashCard>
          </div>

          {/* Recent activity */}
          <div style={{ marginBottom: '16px' }}>
            <DashCard>
              <SectionTitle
                title="Recent Activity"
                subtitle="Latest audit log events"
                action={
                  <button onClick={() => setPage('admin_audit')}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: 500, color, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' }}>
                    View all <Icon name="chevron_right" size={14} style={{ color }} />
                  </button>
                }
              />
              {recentActivity.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.textLow, fontSize: '13px' }}>
                  No recent activity
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {recentActivity.map((a, i) => {
                    const meta = actionMeta(a.action)
                    return (
                      <ActivityRow
                        key={a.id}
                        icon={meta.icon}
                        iconColor={meta.clr}
                        title={`${a.action || '—'} · ${a.table_name || '—'}`}
                        sub={`${a.actor?.full_name || a.actor?.username || 'Unknown'}${a.record_id ? ` · ${a.record_id}` : ''}`}
                        right={new Date(a.created_at).toLocaleString()}
                        rightColor={THEME.textMed}
                        isLast={i === recentActivity.length - 1}
                      />
                    )
                  })}
                </div>
              )}
            </DashCard>
          </div>

          {/* Quick links */}
          <div style={{ marginBottom: '24px' }}>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_dashboard" />
            <SectionTitle title="Quick Links" subtitle="Jump to an admin area" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
              {quickLinks.map(ql => (
                <QuickLinkTile key={ql.page} icon={ql.icon} label={ql.label} onClick={() => setPage(ql.page)} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
