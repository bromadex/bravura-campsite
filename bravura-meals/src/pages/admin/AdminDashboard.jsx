import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Icon, PageHeader, showToast, TableWrap, THead, Th, TRow, Td } from '../../components/ui'

const color = MODULE_COLORS.admin

export default function AdminDashboard({ setPage }) {
  const { can } = usePermissions()
  const [stats, setStats] = useState({ users: 0, roles: 0, sites: 0, recentAudit: 0 })
  const [recentActivity, setRecentActivity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [usersRes, rolesRes, sitesRes, auditCountRes, activityRes] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('roles').select('id', { count: 'exact', head: true }),
        supabase.from('sites').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('audit_log').select('id', { count: 'exact', head: true }).gte('created_at', yesterday),
        supabase.from('audit_log').select('*, actor:profiles!audit_log_user_id_fkey(full_name, username)').order('created_at', { ascending: false }).limit(10),
      ])
      setStats({
        users: usersRes.count || 0,
        roles: rolesRes.count || 0,
        sites: sitesRes.count || 0,
        recentAudit: auditCountRes.count || 0,
      })
      setRecentActivity(activityRes.data || [])
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setLoading(false)
    }
  }

  const kpis = [
    { label: 'Total Users', value: stats.users, icon: 'group', bg: '#E8EAF6' },
    { label: 'Total Roles', value: stats.roles, icon: 'admin_panel_settings', bg: '#FFF3E0' },
    { label: 'Active Sites', value: stats.sites, icon: 'location_on', bg: '#E8F5E9' },
    { label: 'Audit (24h)', value: stats.recentAudit, icon: 'history', bg: '#FCE4EC' },
  ]

  const quickLinks = [
    { label: 'Users & Roles', icon: 'group', page: 'admin-users' },
    { label: 'Role Management', icon: 'admin_panel_settings', page: 'admin-roles' },
    { label: 'Site Management', icon: 'location_on', page: 'admin-sites' },
    { label: 'Pending Invitations', icon: 'mail', page: 'admin-invitations' },
    { label: 'System Settings', icon: 'settings', page: 'admin-settings' },
    { label: 'Permissions', icon: 'lock', page: 'admin-permissions' },
    { label: 'Audit Log', icon: 'history', page: 'admin-audit' },
  ]

  if (!can('users.view')) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div>
      <PageHeader title="Admin Dashboard" />

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color }} />
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {kpis.map(k => (
              <div key={k.label} style={{
                background: THEME.surface, borderRadius: '14px', padding: '18px',
                border: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', gap: '14px',
              }}>
                <div style={{
                  width: '42px', height: '42px', borderRadius: '50%', background: k.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon name={k.icon} size={22} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
                  <div style={{ fontSize: '12px', color: THEME.textMed }}>{k.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Recent Activity */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text, marginBottom: '12px' }}>Recent Activity</div>
            <TableWrap>
              <THead color={color}>
                {['Timestamp', 'Actor', 'Table', 'Action', 'Record ID'].map(h => <Th key={h}>{h}</Th>)}
              </THead>
              <tbody>
                {recentActivity.length === 0 ? (
                  <TRow><Td colSpan={5} style={{ textAlign: 'center', color: THEME.textLow }}>No recent activity</Td></TRow>
                ) : recentActivity.map(a => (
                  <TRow key={a.id}>
                    <Td style={{ fontSize: '12px', whiteSpace: 'nowrap' }}>{new Date(a.created_at).toLocaleString()}</Td>
                    <Td>{a.actor?.full_name || a.actor?.username || '-'}</Td>
                    <Td><code style={{ fontSize: '11px', background: THEME.surfaceVar, padding: '2px 6px', borderRadius: '4px' }}>{a.table_name}</code></Td>
                    <Td>{a.action}</Td>
                    <Td style={{ fontSize: '11px', color: THEME.textLow }}>{a.record_id || '-'}</Td>
                  </TRow>
                ))}
              </tbody>
            </TableWrap>
          </div>

          {/* Quick Links */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text, marginBottom: '12px' }}>Quick Links</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
              {quickLinks.map(ql => (
                <div key={ql.page} onClick={() => setPage(ql.page)} style={{
                  background: THEME.surface, borderRadius: '14px', padding: '18px',
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '12px',
                  transition: 'box-shadow 0.15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
                  onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                >
                  <Icon name={ql.icon} size={20} style={{ color }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{ql.label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
