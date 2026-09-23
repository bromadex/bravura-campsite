import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MODULE_COLORS, THEME, moduleAccess } from '../utils/permissions'
import { resolveNotifStyle } from '../utils/notify'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { supabase } from '../supabaseClient'
import SiteSwitcher from '../components/SiteSwitcher'

// ── Umbrella groups for the home grid ────────────────────────────────────────
// Each group has an id, label, icon, color, and children (actual modules).
// Children with `coming: true` render as greyed-out "Coming Soon" tiles.
// Top-level modules that go straight to their dashboard (no umbrella expand)
const TOP_LEVEL_MODULES = [
  { id: 'fuel', label: 'Fuel Management', icon: 'local_gas_station', color: MODULE_COLORS.fuel, access: moduleAccess.fuel },
]

// Umbrella groups that expand to show sub-module tiles
const MODULE_GROUPS = [
  {
    id: 'camp',
    label: 'Camp Management',
    icon: 'holiday_village',
    color: MODULE_COLORS.campsite,
    children: [
      { id: 'campsite',  label: 'Campsite',     icon: 'holiday_village', color: MODULE_COLORS.campsite, access: moduleAccess.campsite },
      { id: 'meals',     label: 'Meals',         icon: 'restaurant',      color: MODULE_COLORS.meals,    access: moduleAccess.meals },
      { id: 'concrete',  label: 'Batch Plant',   icon: 'factory',         color: MODULE_COLORS.concrete, access: moduleAccess.concrete },
    ],
  },
  {
    id: 'projects',
    label: 'Projects & Planning',
    icon: 'account_tree',
    color: MODULE_COLORS.projects,
    children: [
      { id: 'projects',   label: 'Project Register',   icon: 'engineering',      color: MODULE_COLORS.projects, access: moduleAccess.projects },
      { id: 'dept',        label: 'Departments',        icon: 'domain',           color: MODULE_COLORS.dept,     access: moduleAccess.dept },
      { id: '_schedule',   label: 'Bravura Schedule',   icon: 'calendar_month',   color: '#546E7A', coming: true },
      { id: '_dashboard',  label: 'Project Dashboard',  icon: 'dashboard',        color: '#546E7A', coming: true },
      { id: '_gantt',      label: 'Gantt View',         icon: 'view_timeline',    color: '#546E7A', coming: true },
    ],
  },
  {
    id: 'people',
    label: 'People & Workforce',
    icon: 'groups',
    color: MODULE_COLORS.workforce,
    children: [
      { id: 'workforce',   label: 'Employees',          icon: 'badge',        color: MODULE_COLORS.workforce,   access: moduleAccess.workforce },
      { id: 'contractors', label: 'Contractors',         icon: 'handshake',    color: MODULE_COLORS.contractors, access: moduleAccess.contractors },
      // Deep-link tiles into HR sub-pages
      { id: 'workforce',   label: 'Leave Management',   icon: 'event_busy',   color: '#E07B39', access: moduleAccess.workforce, deepPage: 'wf_leave_requests' },
      { id: 'workforce',   label: 'Attendance & Shifts', icon: 'schedule',    color: '#E07B39', access: moduleAccess.workforce, deepPage: 'wf_attendance' },
      { id: 'workforce',   label: 'Training & Skills',  icon: 'school',       color: '#E07B39', access: moduleAccess.workforce, deepPage: 'wf_training' },
      { id: 'workforce',   label: 'Payroll',            icon: 'payments',     color: '#E07B39', access: moduleAccess.workforce, deepPage: 'wf_payroll' },
      { id: 'workforce',   label: 'Org Chart',          icon: 'account_tree', color: '#E07B39', access: moduleAccess.workforce, deepPage: 'wf_org_chart' },
    ],
  },
  {
    id: 'assets',
    label: 'Assets & Logistics',
    icon: 'local_shipping',
    color: MODULE_COLORS.fleet,
    children: [
      { id: 'fleet',       label: 'Fleet',         icon: 'directions_car',  color: MODULE_COLORS.fleet,       access: moduleAccess.fleet },
      { id: 'procurement', label: 'Procurement',   icon: 'storefront',      color: MODULE_COLORS.procurement, access: moduleAccess.procurement },
      { id: 'inventory',   label: 'Stores',         icon: 'inventory_2',     color: MODULE_COLORS.inventory,   access: moduleAccess.inventory },
      { id: 'finance',     label: 'Finance',        icon: 'account_balance', color: MODULE_COLORS.finance,     access: moduleAccess.finance },
    ],
  },
  {
    id: 'safety',
    label: 'Safety & Compliance',
    icon: 'health_and_safety',
    color: MODULE_COLORS.sheq,
    children: [
      { id: 'sheq', label: 'SHEQ', icon: 'health_and_safety', color: MODULE_COLORS.sheq, access: moduleAccess.sheq },
    ],
  },
  {
    id: 'info',
    label: 'Information',
    icon: 'hub',
    color: MODULE_COLORS.docshare,
    children: [
      { id: 'docshare',   label: 'DocVault',       icon: 'folder_shared',  color: MODULE_COLORS.docshare,   access: moduleAccess.docshare },
      { id: 'governance',  label: 'Governance',     icon: 'gavel',          color: MODULE_COLORS.governance,  access: moduleAccess.governance },
      { id: 'connect',     label: 'Connect',        icon: 'chat',           color: MODULE_COLORS.connect,     access: moduleAccess.connect },
    ],
  },
  {
    id: 'system',
    label: 'Admin',
    icon: 'admin_panel_settings',
    color: MODULE_COLORS.admin,
    children: [
      { id: 'admin',    label: 'Administration', icon: 'admin_panel_settings', color: MODULE_COLORS.admin,    access: moduleAccess.admin },
      { id: 'feedback', label: 'Feedback',        icon: 'forum',                color: MODULE_COLORS.feedback, access: moduleAccess.feedback },
    ],
  },
]

function useViewport() {
  const get = () => {
    if (typeof window === 'undefined') return 'desktop'
    const w = window.innerWidth
    if (w < 640)  return 'mobile'
    if (w < 1024) return 'tablet'
    return 'desktop'
  }
  const [vp, setVp] = useState(get)
  useEffect(() => {
    const onResize = () => setVp(get())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return vp
}

// ── Cross-module KPI summary row ─────────────────────────────────────────────
function KpiSummaryRow({ currentSiteId, can }) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false

    async function load() {
      try {
        const results = {}

        if (can('hr.view') || can('procurement.view')) {
          let approvalCount = 0
          if (can('hr.view')) {
            const { count } = await supabase
              .from('leave_requests')
              .select('*', { count: 'exact', head: true })
              .eq('site_id', currentSiteId)
              .eq('status', 'pending')
            approvalCount += (count || 0)
          }
          if (can('procurement.view')) {
            const { count } = await supabase
              .from('purchase_requisitions')
              .select('*', { count: 'exact', head: true })
              .eq('site_id', currentSiteId)
              .eq('status', 'pending')
            approvalCount += (count || 0)
          }
          results.pendingApprovals = approvalCount
        }

        if (can('inventory.view')) {
          const { data } = await supabase
            .from('stock_balances')
            .select('on_hand_qty, items(reorder_level), warehouses!inner(site_id)')
            .eq('warehouses.site_id', currentSiteId)
          const lowStock = (data || []).filter(r => r.items && r.on_hand_qty <= (r.items.reorder_level || 0))
          results.lowStock = lowStock.length
        }

        if (can('hr.view')) {
          const thirtyDays = new Date()
          thirtyDays.setDate(thirtyDays.getDate() + 30)
          const { count } = await supabase
            .from('employee_documents')
            .select('*', { count: 'exact', head: true })
            .eq('site_id', currentSiteId)
            .lte('expiry_date', thirtyDays.toISOString().split('T')[0])
            .gte('expiry_date', new Date().toISOString().split('T')[0])
          results.expiringDocs = count || 0
        }

        if (can('hr.view')) {
          const { count } = await supabase
            .from('employees')
            .select('*', { count: 'exact', head: true })
            .eq('site_id', currentSiteId)
            .eq('status', 'active')
          results.activeEmployees = count || 0
        }

        if (!cancelled) setStats(results)
      } catch (e) {
        // graceful degradation
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId, can])

  if (!stats || Object.keys(stats).length === 0) return null

  const cards = []
  if (stats.pendingApprovals !== undefined) cards.push({ label: 'Pending Approvals', value: stats.pendingApprovals, icon: 'pending_actions', color: '#F59E0B' })
  if (stats.lowStock !== undefined) cards.push({ label: 'Low Stock Items', value: stats.lowStock, icon: 'inventory', color: '#EF4444' })
  if (stats.expiringDocs !== undefined) cards.push({ label: 'Expiring Documents', value: stats.expiringDocs, icon: 'description', color: '#8B5CF6' })
  if (stats.activeEmployees !== undefined) cards.push({ label: 'Active Employees', value: stats.activeEmployees, icon: 'group', color: '#10B981' })

  if (cards.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '28px', width: '100%', maxWidth: '720px' }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: THEME.surface,
          border: `1px solid ${THEME.outlineVar}`,
          borderRadius: '10px',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          minWidth: '150px',
          flex: '1 1 150px',
          maxWidth: '200px',
        }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: c.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px', color: c.color }}>{c.icon}</span>
          </div>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, lineHeight: 1.2 }}>{c.value}</div>
            <div style={{ fontSize: '11px', color: THEME.textMed, lineHeight: 1.3 }}>{c.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HomeLauncher({ onEnterModule }) {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const role = profile?.role
  const vp = useViewport()
  const isMobile = vp === 'mobile'
  const isTablet = vp === 'tablet'

  const [expandedGroup, setExpandedGroup] = useState(null)
  const [notifOpen,     setNotifOpen]     = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount,   setUnreadCount]   = useState(0)
  const [chatUnread,    setChatUnread]    = useState(0)
  const [chatPopup,     setChatPopup]     = useState(null)

  useEffect(() => {
    if (!profile?.id) return
    function load() {
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          setNotifications(data || [])
          setUnreadCount((data || []).filter(n => !n.is_read).length)
        })
    }
    load()
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    async function loadChatUnread() {
      const { data: parts } = await supabase
        .from('chat_participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', profile.id)
      if (!parts?.length) { setChatUnread(0); return }
      let total = 0
      for (const p of parts) {
        const q = supabase
          .from('chat_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id)
          .eq('is_deleted', false)
          .neq('sender_id', profile.id)
        if (p.last_read_at) q.gt('created_at', p.last_read_at)
        const { count } = await q
        total += (count || 0)
      }
      setChatUnread(total)
    }
    loadChatUnread()
    const t = setInterval(loadChatUnread, 30_000)

    const chan = supabase.channel('home-chat-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (payload) => {
        const msg = payload.new
        if (msg.sender_id === profile.id) return
        const { data: part } = await supabase
          .from('chat_participants')
          .select('conversation_id')
          .eq('user_id', profile.id)
          .eq('conversation_id', msg.conversation_id)
          .maybeSingle()
        if (!part) return
        setChatUnread(prev => prev + 1)
        const { data: sender } = await supabase
          .from('profiles')
          .select('full_name, username, employee:employees(name)')
          .eq('id', msg.sender_id)
          .maybeSingle()
        const senderName = sender?.employee?.name || sender?.full_name || sender?.username || 'Someone'
        setChatPopup({ name: senderName, text: msg.content?.slice(0, 80) || 'sent a message' })
        setTimeout(() => setChatPopup(null), 5000)
      })
      .subscribe()

    return () => { clearInterval(t); supabase.removeChannel(chan) }
  }, [profile?.id])

  function markRead(id) {
    supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  function markAllRead() {
    const unread = notifications.filter(n => !n.is_read).map(n => n.id)
    if (!unread.length) return
    supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).in('id', unread)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  const { isHQ } = useSite()

  // Filter top-level modules by access
  const visibleTopLevel = TOP_LEVEL_MODULES.filter(m => !m.access || m.access(role, can))

  // Filter groups: only show groups that have at least one accessible child
  function childAccessible(child) {
    if (child.coming) return true
    if (!child.access) return true
    return child.access(role, can)
  }
  const visibleGroups = MODULE_GROUPS
    .map(g => ({ ...g, children: g.children.filter(childAccessible) }))
    .filter(g => g.children.length > 0)

  function handleGroupClick(group) {
    // If only one non-coming child, go straight to it
    const real = group.children.filter(c => !c.coming)
    if (real.length === 1 && !real[0].deepPage) {
      onEnterModule(real[0].id)
      return
    }
    setExpandedGroup(prev => prev === group.id ? null : group.id)
  }

  function handleChildClick(child) {
    if (child.coming) return
    if (child.deepPage) {
      navigate(`/${child.id}/${child.deepPage}`)
      return
    }
    onEnterModule(child.id)
  }

  const iconBtn = {
    background: 'transparent', border: 'none', cursor: 'pointer',
    borderRadius: '10px', width: '38px', height: '38px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'rgba(255,255,255,.82)', transition: 'background .15s, color .15s', flexShrink: 0,
  }

  return (
    <div style={{ minHeight: '100vh', background: THEME.bg, fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", display: 'flex', flexDirection: 'column' }}>

      {/* ── Top Bar ── */}
      <div style={{
        background: 'linear-gradient(90deg, #7A1B20 0%, #982329 55%, #7A1B20 100%)',
        padding: isMobile ? '0 12px' : '0 24px',
        height: '64px',
        display: 'grid',
        gridTemplateColumns: isMobile
          ? 'auto 1fr'
          : isTablet
            ? 'auto 1fr auto'
            : '1fr minmax(320px, 520px) 1fr',
        alignItems: 'center',
        gap: isMobile ? '8px' : '24px',
        borderBottom: '1px solid rgba(0,0,0,.18)',
        boxShadow: '0 2px 8px rgba(120,20,25,.25)',
        flexShrink: 0,
      }}>
        {/* Left: Logo + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '5px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}>
            <img src="/logo/bravura-icon-512.png" alt="Bravura" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#fff', fontSize: '15px', fontWeight: 700, letterSpacing: '.06em', lineHeight: 1.1 }}>BRAVURA</div>
            {!isMobile && (
              <div style={{ color: 'rgba(255,255,255,.42)', fontSize: '9px', letterSpacing: '.14em', textTransform: 'uppercase', marginTop: '2px' }}>Enterprise Resource Planning</div>
            )}
          </div>
        </div>

        {/* Center: Global command bar — desktop only */}
        {!isMobile && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          background: 'rgba(255,255,255,.07)',
          border: '1px solid rgba(255,255,255,.08)',
          borderRadius: '10px',
          padding: '0 14px',
          height: '40px',
          cursor: 'pointer',
          transition: 'background .15s, border-color .15s',
        }}
        onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.14)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)' }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: '18px', color: 'rgba(255,255,255,.55)' }}>search</span>
          <input
            type="text"
            placeholder="Type a T-code (FU07, ME02…) or search screens"
            className="topbar-search"
            readOnly
            onFocus={e => { e.target.blur(); window.dispatchEvent(new Event('open-command-palette')) }}
            onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontSize: '13px', fontFamily: 'inherit',
              padding: 0, cursor: 'pointer',
            }}
          />
          <style>{`.topbar-search::placeholder { color: rgba(255,255,255,.75); }`}</style>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '3px',
            background: 'rgba(255,255,255,.08)',
            borderRadius: '5px',
            padding: '2px 6px',
            fontSize: '10px', fontWeight: 600,
            color: 'rgba(255,255,255,.55)',
            letterSpacing: '.03em',
          }}>
            <span>⌘</span><span>K</span>
          </div>
        </div>
        )}

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', justifyContent: 'flex-end' }}>
          {!isMobile && <SiteSwitcher />}

          {!isMobile && <div style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,.10)', margin: '0 8px' }} />}

          {/* Bell */}
          <button
            onClick={() => setNotifOpen(o => !o)}
            title="Notifications"
            style={{ ...iconBtn, position: 'relative' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.10)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,.82)' }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>notifications</span>
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: '5px', right: '5px', minWidth: '16px', height: '16px', borderRadius: '6px', background: '#EF4444', color: '#fff', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', lineHeight: 1, border: `2px solid ${THEME.sidebar}` }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {!isMobile && <div style={{ width: '1px', height: '22px', background: 'rgba(255,255,255,.10)', margin: '0 8px' }} />}

          {/* Avatar + name pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: isMobile ? '4px' : '4px 10px 4px 4px', borderRadius: '999px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)' }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: `linear-gradient(135deg, ${MODULE_COLORS.workforce || '#6366F1'}, ${MODULE_COLORS.fuel || '#D97706'})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {(profile?.full_name || profile?.username || '?').charAt(0).toUpperCase()}
            </div>
            {!isMobile && (
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fff', lineHeight: 1.1 }}>
                {profile?.full_name?.split(' ')[0] || profile?.username}
              </div>
            )}
          </div>

          {/* Sign out */}
          <button onClick={signOut} title="Sign out" style={{ ...iconBtn, marginLeft: '4px' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,.22)'; e.currentTarget.style.color = '#fff' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,.82)' }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>logout</span>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 20px' }}>

        {/* Welcome */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <h1 style={{ fontSize: '30px', fontWeight: 300, color: THEME.text, margin: 0, letterSpacing: '-.01em' }}>
            Welcome back, <span style={{ fontWeight: 700 }}>{profile?.full_name?.split(' ')[0] || profile?.username}</span>
          </h1>
        </div>

        {/* Umbrella groups OR expanded sub-module grid */}
        {expandedGroup ? (
          <ExpandedGroupView
            group={visibleGroups.find(g => g.id === expandedGroup)}
            onBack={() => setExpandedGroup(null)}
            onChildClick={handleChildClick}
            chatUnread={chatUnread}
            isMobile={isMobile}
            isTablet={isTablet}
          />
        ) : (
          <UmbrellaGrid
            groups={visibleGroups}
            topLevel={visibleTopLevel}
            onGroupClick={handleGroupClick}
            onTopLevelClick={m => onEnterModule(m.id)}
            chatUnread={chatUnread}
            isMobile={isMobile}
            isTablet={isTablet}
          />
        )}

        {/* KPI summary row */}
        {!expandedGroup && <KpiSummaryRow currentSiteId={currentSite?.id} can={can} />}
      </div>

      {/* ── Footer ── */}
      <div style={{ textAlign: 'center', padding: '12px 20px 20px', fontSize: '11px', color: THEME.textLow, flexShrink: 0 }}>
        {currentSite?.name || 'Bravura Zimbabwe Ltd'} · {new Date().getFullYear()}
      </div>

      {/* ── Notification drawer ── */}
      {notifOpen && (
        <>
          <div onClick={() => setNotifOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: '380px', zIndex: 201, background: THEME.surface, borderLeft: `1px solid ${THEME.outlineVar}`, display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,.15)', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif" }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.text }}>notifications</span>
                <span style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Notifications</span>
                {unreadCount > 0 && <span style={{ background: '#EF4444', color: '#fff', borderRadius: '6px', fontSize: '11px', fontWeight: 700, padding: '1px 7px' }}>{unreadCount}</span>}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {unreadCount > 0 && <button onClick={markAllRead} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color: THEME.primary, fontWeight: 600, fontFamily: 'inherit' }}>Mark all read</button>}
                <button onClick={() => setNotifOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, display: 'flex', alignItems: 'center' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>close</span>
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '40px', color: THEME.outline, display: 'block', margin: '0 auto 12px' }}>notifications_none</span>
                  <div style={{ fontSize: '13px' }}>No notifications yet</div>
                </div>
              ) : notifications.map(n => {
                const { icon: ti, color: tc } = resolveNotifStyle(n.type, THEME)
                const age = Date.now() - new Date(n.created_at).getTime()
                const ageStr = age < 3600000 ? `${Math.floor(age / 60000)}m ago` : age < 86400000 ? `${Math.floor(age / 3600000)}h ago` : new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                return (
                  <div key={n.id} onClick={() => {
                    markRead(n.id)
                    if (n.action_url && n.action_url.startsWith('/')) {
                      navigate(n.action_url)
                    }
                    setNotifOpen(false)
                  }}
                    style={{ padding: '14px 20px', borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', background: n.is_read ? 'transparent' : tc + '08', display: 'flex', gap: '12px', alignItems: 'flex-start' }}
                    onMouseEnter={e => { e.currentTarget.style.background = THEME.surfaceVar }}
                    onMouseLeave={e => { e.currentTarget.style.background = n.is_read ? 'transparent' : tc + '08' }}
                  >
                    <div style={{ width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0, background: tc + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '16px', color: tc }}>{ti}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: n.is_read ? 500 : 700, color: THEME.text }}>{n.title}</span>
                        <span style={{ fontSize: '11px', color: THEME.textLow, flexShrink: 0 }}>{ageStr}</span>
                      </div>
                      {n.body && <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '3px', lineHeight: 1.5 }}>{n.body}</div>}
                      {!n.is_read && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: tc, marginTop: '6px' }} />}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Chat message popup */}
      {chatPopup && (
        <div onClick={() => { setChatPopup(null); onEnterModule('connect') }} style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
          borderRadius: '14px', padding: '14px 18px', minWidth: '280px', maxWidth: '380px',
          boxShadow: '0 8px 32px rgba(0,0,0,.18)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '12px',
          animation: 'slideInUp .3s ease-out',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
            background: MODULE_COLORS.connect, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>chat</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{chatPopup.name}</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chatPopup.text}</div>
          </div>
          <span className="material-symbols-rounded" style={{ fontSize: '16px', color: THEME.textLow }}>close</span>
        </div>
      )}
      <style>{`@keyframes slideInUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
    </div>
  )
}

// ── Umbrella grid — shows top-level standalone tiles + group tiles ───────────
function UmbrellaGrid({ groups, topLevel = [], onGroupClick, onTopLevelClick, chatUnread, isMobile, isTablet }) {
  const totalItems = topLevel.length + groups.length
  const perRow = isMobile ? 2 : isTablet ? 3 : 4
  const cols = Math.min(totalItems, perRow)

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
      gap: isMobile ? '12px' : '16px',
      width: '100%',
      maxWidth: `${cols * (isMobile ? 160 : 180)}px`,
    }}>
      {/* Top-level standalone modules (e.g. Fuel) — rendered as direct-click tiles */}
      {topLevel.map(mod => (
        <GroupTile
          key={mod.id}
          group={{ ...mod, children: [] }}
          badge={0}
          onClick={() => onTopLevelClick(mod)}
          direct
        />
      ))}
      {/* Umbrella groups */}
      {groups.map(group => {
        const chatBadge = group.children.some(c => c.id === 'connect') ? chatUnread : 0
        return (
          <GroupTile
            key={group.id}
            group={group}
            badge={chatBadge}
            onClick={() => onGroupClick(group)}
          />
        )
      })}
    </div>
  )
}

// ── Group tile — an umbrella card on the home grid ──────────────────────────
function GroupTile({ group, badge = 0, onClick, direct = false }) {
  const [hovered, setHovered] = useState(false)
  const childCount = direct ? 0 : group.children.filter(c => !c.coming).length
  const hasMultiple = childCount > 1

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: THEME.surface,
        border: `1px solid ${hovered ? group.color + '40' : THEME.outlineVar}`,
        borderRadius: '14px',
        padding: '24px 16px 20px',
        cursor: 'pointer',
        boxShadow: hovered
          ? `0 12px 28px ${group.color}20, 0 4px 10px rgba(0,0,0,.06)`
          : '0 1px 2px rgba(0,0,0,.04)',
        transform: hovered ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'transform .18s cubic-bezier(.4,0,.2,1), box-shadow .18s, border-color .18s',
        fontFamily: 'inherit',
        textAlign: 'center',
        width: '100%',
        aspectRatio: '1 / 1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        position: 'relative',
      }}
    >
      {badge > 0 && (
        <div style={{
          position: 'absolute', top: '8px', right: '8px',
          background: THEME.error, color: '#fff', borderRadius: '50px',
          minWidth: '20px', height: '20px', padding: '0 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 700, lineHeight: 1,
          boxShadow: '0 2px 6px rgba(220,38,38,.4)',
        }}>{badge > 99 ? '99+' : badge}</div>
      )}

      {/* Expand indicator */}
      {hasMultiple && (
        <div style={{
          position: 'absolute', top: '10px', left: '10px',
          fontSize: '10px', color: THEME.textLow, fontWeight: 600,
          background: THEME.surfaceVar, borderRadius: '4px',
          padding: '1px 5px',
        }}>
          {childCount}
        </div>
      )}

      <div style={{
        width: '58px', height: '58px',
        borderRadius: '14px',
        background: group.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: hovered
          ? `0 8px 20px ${group.color}55, inset 0 -3px 0 rgba(0,0,0,.10)`
          : `0 4px 10px ${group.color}30, inset 0 -3px 0 rgba(0,0,0,.08)`,
        transition: 'box-shadow .18s',
      }}>
        <span
          className="material-symbols-rounded filled"
          style={{ fontSize: '30px', color: '#fff', lineHeight: 1 }}
        >
          {group.icon}
        </span>
      </div>

      <div style={{
        fontSize: '13.5px',
        fontWeight: 600,
        color: THEME.text,
        lineHeight: 1.25,
        letterSpacing: '-.005em',
        wordBreak: 'break-word',
        hyphens: 'auto',
        padding: '0 4px',
        width: '100%',
      }}>
        {group.label}
      </div>
    </button>
  )
}

// ── Expanded group view — shows the sub-module tiles within a group ──────────
function ExpandedGroupView({ group, onBack, onChildClick, chatUnread, isMobile, isTablet }) {
  if (!group) return null
  const perRow = isMobile ? 2 : isTablet ? 3 : 4
  const cols = Math.min(group.children.length, perRow)

  return (
    <div style={{ width: '100%', maxWidth: `${cols * (isMobile ? 160 : 180)}px` }}>
      {/* Back button + group name */}
      <button
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: '14px', fontWeight: 600,
          color: THEME.textMed, marginBottom: '20px', padding: '4px 0',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = THEME.text }}
        onMouseLeave={e => { e.currentTarget.style.color = THEME.textMed }}
      >
        <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>arrow_back</span>
        Back
      </button>

      {/* Group header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div style={{
          width: '42px', height: '42px', borderRadius: '12px',
          background: group.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded filled" style={{ fontSize: '22px', color: '#fff' }}>{group.icon}</span>
        </div>
        <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{group.label}</div>
      </div>

      {/* Sub-module tiles */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: isMobile ? '12px' : '16px',
      }}>
        {group.children.map(child => {
          const badge = child.id === 'connect' ? chatUnread : 0
          return (
            <ChildTile
              key={child.id}
              child={child}
              badge={badge}
              onClick={() => onChildClick(child)}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Child tile — a module within an expanded group ──────────────────────────
function ChildTile({ child, badge = 0, onClick }) {
  const [hovered, setHovered] = useState(false)
  const isComing = child.coming

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={isComing}
      style={{
        background: THEME.surface,
        border: `1px solid ${isComing ? THEME.outlineVar : hovered ? child.color + '40' : THEME.outlineVar}`,
        borderRadius: '14px',
        padding: '24px 16px 20px',
        cursor: isComing ? 'default' : 'pointer',
        opacity: isComing ? 0.5 : 1,
        boxShadow: hovered && !isComing
          ? `0 12px 28px ${child.color}20, 0 4px 10px rgba(0,0,0,.06)`
          : '0 1px 2px rgba(0,0,0,.04)',
        transform: hovered && !isComing ? 'translateY(-4px)' : 'translateY(0)',
        transition: 'transform .18s cubic-bezier(.4,0,.2,1), box-shadow .18s, border-color .18s',
        fontFamily: 'inherit',
        textAlign: 'center',
        width: '100%',
        aspectRatio: '1 / 1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        position: 'relative',
      }}
    >
      {badge > 0 && (
        <div style={{
          position: 'absolute', top: '8px', right: '8px',
          background: THEME.error, color: '#fff', borderRadius: '50px',
          minWidth: '20px', height: '20px', padding: '0 6px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 700, lineHeight: 1,
          boxShadow: '0 2px 6px rgba(220,38,38,.4)',
        }}>{badge > 99 ? '99+' : badge}</div>
      )}

      {isComing && (
        <div style={{
          position: 'absolute', top: '8px', right: '8px',
          fontSize: '9px', fontWeight: 600, color: THEME.textLow,
          background: THEME.surfaceVar, borderRadius: '4px',
          padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '.04em',
        }}>
          Soon
        </div>
      )}

      <div style={{
        width: '58px', height: '58px',
        borderRadius: '14px',
        background: child.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: hovered && !isComing
          ? `0 8px 20px ${child.color}55, inset 0 -3px 0 rgba(0,0,0,.10)`
          : `0 4px 10px ${child.color}30, inset 0 -3px 0 rgba(0,0,0,.08)`,
        transition: 'box-shadow .18s',
      }}>
        <span
          className="material-symbols-rounded filled"
          style={{ fontSize: '30px', color: '#fff', lineHeight: 1 }}
        >
          {child.icon}
        </span>
      </div>

      <div style={{
        fontSize: '13.5px',
        fontWeight: 600,
        color: isComing ? THEME.textLow : THEME.text,
        lineHeight: 1.25,
        letterSpacing: '-.005em',
        wordBreak: 'break-word',
        hyphens: 'auto',
        padding: '0 4px',
        width: '100%',
      }}>
        {child.label}
      </div>
    </button>
  )
}
