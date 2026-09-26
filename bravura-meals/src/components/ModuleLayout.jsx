import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { THEME, ROLE_LABELS, MODULE_COLORS } from '../utils/permissions'
import { resolveNotifStyle } from '../utils/notify'
import { supabase } from '../supabaseClient'
import { isMuted, playNotificationSound, subscribePrefs } from '../utils/userPrefs'
import SiteSwitcher from './SiteSwitcher'
import { AskProvider } from './AskBravura'
import { TXN_CODES } from '../utils/txnCodes'

const TXN_PAGE_LABELS = Object.fromEntries(
  TXN_CODES.map(t => [t.path.split('/').pop(), t.label])
)

const Icon = ({ name, size = 20, filled = false, style = {} }) => (
  <span
    className={`material-symbols-rounded${filled ? ' filled' : ''}`}
    style={{ fontSize: size, lineHeight: 1, color: 'inherit', userSelect: 'none', ...style }}
  >
    {name}
  </span>
)

const PAGE_TITLES = {
  // Workforce
  wf_employees:    'Employees',
  wf_contractors:  'Contractors',
  wf_leave:        'Leave Management',
  wf_reports:      'Employee Reports',
  // Campsite
  camp_headcount:   'Headcount Dashboard',
  camp_floorplan:   'Visual Layout',
  camp_assignments: 'Room Assignments',
  camp_rooms:       'Rooms',
  camp_blocks:      'Blocks',
  camp_supplies:    'Camp Supplies',
  camp_transfers:   'Stock Transfers',
  camp_occ_report:  'Occupancy Reports',
  // Meals
  meals_dashboard:  'Dashboard',
  meals_forecasts:  'Meal Forecast',
  meals_entry:      'Daily Meal Entry',
meals_finance_export: 'Meal Finance Export',
  meals_approvals:  'Approvals',
  meals_kitchen:    'Kitchen Verification',
  meals_flags:      'Flags & Queries',
  meals_daily:      'Daily Report',
  meals_range:      'Date Range Report',
  meals_monthly:    'Monthly Report',
  meals_billing:    'Billing',
  meals_pricing:    'Pricing Management',
  meals_settings:   'Settings',
  // Fleet
  fleet_dashboard:  'Dashboard',
  fleet_vehicles:   'Vehicles',
  fleet_equipment:  'Equipment',
  fleet_operators:  'Operators',
  // Fuel
  fuel_dashboard:   'Dashboard',
  fuel_ledger:      'Fuel Ledger',
  fuel_receipts:    'Fuel Deliveries',
  fuel_issuance:      'Issue Fuel',
  fuel_issues:        'Issuance History',
  fuel_transactions:  'All Transactions',
  fuel_transfer:    'Tank Transfer',
  fuel_dips:        'Dip Stick Readings',
  fuel_reports:     'Fuel Reports',
  fuel_tanks:       'Tanks',
  fuel_vehicles:    'Vehicles',
  fuel_equipment:   'Equipment',
  fuel_operators:   'Operators',
  fuel_types:       'Fuel Types',
  fuel_settings:        'Fuel Settings',
  fuel_request_form:    'Request Fuel',
  fuel_requests_list:   'Fuel Requests',
  fuel_bowsers:              'Bowser Dispatches',
  fuel_reconciliation:       'Tank Reconciliation',
  fuel_pump:                 'Issue fuel',
  fuel_allowances:           'Allowances & recharges',
  fuel_shift_report:         'Shift Report',
  fuel_report_daily:         'Daily Transaction Report',
  fuel_report_monthly:       'Monthly Consumption Report',
  fuel_report_deliveries:    'Delivery Report',
  fuel_report_variance:      'Variance Report',
  fuel_vehicle_consumption:  'Vehicle Consumption Analysis',
  fuel_forecasting:          'Fuel Forecasting',
  fuel_cost_allocation:      'Department Cost Allocation',
  fuel_finance_export:       'Finance Export',
  // Procurement
  proc_suppliers:            'Suppliers',
  // Feedback
  feedback_board:   'Feedback Board',
}

function useIsMobile() {
  const get = () => typeof window !== 'undefined' && window.innerWidth < 768
  const [m, setM] = useState(get)
  useEffect(() => {
    const on = () => setM(get())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return m
}

export default function ModuleLayout({ moduleId, moduleLabel, moduleIcon, navItems, page, setPage, onHome, children }) {
  const { profile, signOut } = useAuth()
  const contentRef = useRef(null)
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const role = profile?.role
  const isMobile = useIsMobile()
  const navigate = useNavigate()
  const [collapsed,      setCollapsed]      = useState(false)
  // Collapsible sidebar sections, persisted per module (like the old ERP)
  const sectionStorageKey = `sidebar_exp_${moduleId}`
  const [expandedSections, setExpandedSections] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`sidebar_exp_${moduleId}`) || '{}') }
    catch { return {} }
  })
  useEffect(() => {
    localStorage.setItem(sectionStorageKey, JSON.stringify(expandedSections))
  }, [expandedSections, sectionStorageKey])
  const toggleSection = label => setExpandedSections(prev => ({ ...prev, [label]: prev[label] === false ? true : false }))
  const [mobileNavOpen,  setMobileNavOpen]  = useState(false)
  const [flagCount,      setFlagCount]      = useState(0)
  const [notifOpen,      setNotifOpen]      = useState(false)
  const [notifications,  setNotifications]  = useState([])
  const [unreadCount,    setUnreadCount]    = useState(0)
  const [prefsTick,      setPrefsTick]      = useState(0)
  useEffect(() => subscribePrefs(() => setPrefsTick(t => t + 1)), [])
  const color = MODULE_COLORS[moduleId] || THEME.primary

  // Section grouping
  const sections = []
  let cur = null
  navItems.forEach(item => {
    if (item.section !== cur) { cur = item.section; sections.push({ section: item.section, items: [] }) }
    sections[sections.length - 1].items.push(item)
  })

  // Load notifications for current user + realtime subscription
  useEffect(() => {
    if (!profile?.id) return
    function load() {
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          const visible = (data || []).filter(n => !isMuted(n.category))
          setNotifications(visible)
          setUnreadCount(visible.filter(n => !n.is_read).length)
        })
    }
    load()
    const channel = supabase.channel('notif-bell-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + profile.id }, payload => {
        if (isMuted(payload.new.category)) return
        setNotifications(prev => [payload.new, ...prev].slice(0, 20))
        setUnreadCount(prev => prev + 1)
        playNotificationSound()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id, prefsTick])

  function markRead(id) {
    supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  function markAllRead() {
    const unread = notifications.filter(n => !n.is_read).map(n => n.id)
    if (!unread.length) return
    supabase.from('notifications').update({ is_read: true }).in('id', unread)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnreadCount(0)
  }

  useEffect(() => {
    if (moduleId !== 'meals' || !can('meals.approve') || !currentSiteId) return
    // flags has no site_id — scope through daily_submissions
    supabase
      .from('daily_submissions')
      .select('id')
      .eq('site_id', currentSiteId)
      .then(({ data: subs }) => {
        if (!subs?.length) { setFlagCount(0); return }
        const subIds = subs.map(s => s.id)
        supabase
          .from('flags')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'open')
          .in('submission_id', subIds)
          .then(({ count }) => setFlagCount(count || 0))
      })
  }, [moduleId, currentSiteId, can])

  // On mobile, tapping a nav item should also close the drawer.
  const goToPage = (p) => { setPage(p); if (isMobile) setMobileNavOpen(false) }
  const navHome  = () => { onHome();   if (isMobile) setMobileNavOpen(false) }

  const sidebarWidth = isMobile ? '260px' : (collapsed ? '68px' : '236px')
  // On mobile the drawer is always expanded (shows full labels).
  const showLabels = isMobile ? true : !collapsed

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif" }}>

      {/* Mobile backdrop */}
      {isMobile && mobileNavOpen && (
        <div
          onClick={() => setMobileNavOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 150 }}
        />
      )}

      {/* ── Sidebar ── */}
      <nav style={{
        width: sidebarWidth,
        background: THEME.sidebar,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: isMobile ? 'transform 0.25s cubic-bezier(.4,0,.2,1)' : 'width 0.25s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
        ...(isMobile ? {
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 160,
          transform: mobileNavOpen ? 'translateX(0)' : 'translateX(-100%)',
          boxShadow: mobileNavOpen ? '4px 0 24px rgba(0,0,0,.35)' : 'none',
        } : {}),
      }}>
        {/* Module identity */}
        <div style={{
          padding: showLabels ? '16px 14px 14px' : '16px 0 14px',
          borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center',
          justifyContent: showLabels ? 'flex-start' : 'center', gap: '10px',
        }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
            background: color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={moduleIcon} size={20} style={{ color: '#fff' }} />
          </div>
          {showLabels && (
            <div>
              <div style={{ color: '#fff', fontSize: '12px', fontWeight: 600, lineHeight: 1.2 }}>
                {moduleLabel}
              </div>
              <div style={{ color: 'rgba(255,255,255,.35)', fontSize: '10px', marginTop: '1px' }}>
                Bravura Zimbabwe
              </div>
            </div>
          )}
        </div>

        {/* Home button */}
        <div
          onClick={navHome}
          title="Back to Home"
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: showLabels ? '9px 14px' : '10px 0',
            margin: '6px 8px 2px',
            borderRadius: '10px', cursor: 'pointer',
            color: 'rgba(255,255,255,.5)',
            transition: 'all .15s',
            justifyContent: showLabels ? 'flex-start' : 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.08)'; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,.5)' }}
        >
          <Icon name="home" size={18} style={{ color: 'inherit', flexShrink: 0 }} />
          {showLabels && <span style={{ fontSize: '12px', fontWeight: 500 }}>Home</span>}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '4px 0', overflowY: 'auto' }}>
          {sections.map(({ section, items }) => {
            // A section is expanded unless explicitly collapsed. When the
            // sidebar is icon-only, sections can't fold — all icons show.
            const isOpen = !showLabels || expandedSections[section] !== false
            const hasActive = items.some(i => i.id === page)
            return (
            <div key={section}>
              {showLabels && (
                <div
                  onClick={() => toggleSection(section)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '12px 16px 3px', fontSize: '9px', fontWeight: 600,
                    color: hasActive && !isOpen ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.25)',
                    letterSpacing: '.12em', textTransform: 'uppercase',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,.6)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = hasActive && !isOpen ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.25)' }}
                >
                  <span style={{ flex: 1 }}>{section}</span>
                  <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={13} style={{ color: 'inherit' }} />
                </div>
              )}
              {isOpen && items.map(item => {
                const isActive = page === item.id
                return (
                  <div
                    key={item.id}
                    onClick={() => goToPage(item.id)}
                    title={!showLabels ? item.label : ''}
                    style={{
                      display: 'flex', alignItems: 'center',
                      gap: showLabels ? '11px' : 0,
                      padding: showLabels ? '9px 12px' : '10px 0',
                      margin: '1px 8px', borderRadius: '12px',
                      cursor: 'pointer',
                      justifyContent: showLabels ? 'flex-start' : 'center',
                      background: isActive ? `${color}28` : 'transparent',
                      color: isActive ? '#fff' : 'rgba(255,255,255,.62)',
                      transition: 'background .15s', userSelect: 'none',
                      position: 'relative',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.06)' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: '-8px', top: '50%', transform: 'translateY(-50%)',
                        width: '3px', height: '22px', borderRadius: '0 3px 3px 0',
                        background: THEME.activeBar,
                      }} />
                    )}
                    <Icon name={item.icon} size={19} style={{ color: 'inherit', flexShrink: 0 }} />
                    {showLabels && (
                      <span style={{ fontSize: '13px', fontWeight: isActive ? 600 : 400, flex: 1 }}>
                        {item.label}
                      </span>
                    )}
                    {/* Flag badge */}
                    {item.id === 'meals_flags' && flagCount > 0 && (
                      <div style={{
                        background: THEME.error, color: '#fff', borderRadius: '10px',
                        fontSize: '10px', fontWeight: 700, padding: '2px 6px',
                        minWidth: '18px', textAlign: 'center', lineHeight: '14px',
                      }}>
                        {flagCount}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            )
          })}
        </div>

        {/* User footer */}
        <div style={{
          padding: showLabels ? '10px 12px' : '10px 0',
          borderTop: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center', gap: '8px',
          justifyContent: showLabels ? 'flex-start' : 'center',
        }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
            background: color + '55',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: 700, color: '#fff',
          }}>
            {(profile?.full_name || profile?.username || '?').charAt(0).toUpperCase()}
          </div>
          {showLabels && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'rgba(255,255,255,.85)', fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.full_name || profile?.username}
              </div>
              <div style={{ color: 'rgba(255,255,255,.35)', fontSize: '10px', marginTop: '1px' }}>
                {profile?.job_title || ROLE_LABELS[role]}
              </div>
            </div>
          )}
          <button onClick={() => navigate('/notifications/my_preferences')} title="My preferences" aria-label="My preferences" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,.35)', borderRadius: '8px', padding: '5px',
            display: 'flex', alignItems: 'center', transition: 'color .15s',
          }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.35)'}
          >
            <Icon name="tune" size={17} style={{ color: 'inherit' }} />
          </button>
          <button onClick={signOut} title="Sign out" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,.35)', borderRadius: '8px', padding: '5px',
            display: 'flex', alignItems: 'center', transition: 'color .15s',
          }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.35)'}
          >
            <Icon name="logout" size={17} style={{ color: 'inherit' }} />
          </button>
        </div>
      </nav>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Top App Bar — two-line title with module eyebrow, jump-to search, grouped status capsule */}
        <TopBar
          isMobile={isMobile} color={color} moduleIcon={moduleIcon} moduleLabel={moduleLabel} onHome={onHome}
          title={PAGE_TITLES[page] || TXN_PAGE_LABELS[page] || page}
          onMenu={() => isMobile ? setMobileNavOpen(true) : setCollapsed(c => !c)}
          unreadCount={unreadCount} onBell={() => setNotifOpen(o => !o)}
          flagCount={flagCount} onFlags={() => setPage('meals_flags')}
        />

        {/* Content */}
        <div ref={contentRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px' : '24px', paddingBottom: isMobile ? '80px' : '88px', background: THEME.bg }}>
          <AskProvider moduleId={moduleId} page={page} title={PAGE_TITLES[page] || TXN_PAGE_LABELS[page] || page} contentRef={contentRef}>
            {children}
          </AskProvider>
        </div>
      </div>

      {/* Notification drawer overlay */}
      {notifOpen && (
        <>
          <div onClick={() => setNotifOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 200 }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: '380px', zIndex: 201,
            background: THEME.surface, borderLeft: `1px solid ${THEME.outlineVar}`,
            display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,.15)',
          }}>
            {/* Drawer header */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="notifications" size={20} style={{ color }} />
                <span style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Notifications</span>
                {unreadCount > 0 && (
                  <span style={{ background: THEME.error, color: '#fff', borderRadius: '6px', fontSize: '11px', fontWeight: 700, padding: '1px 7px' }}>{unreadCount}</span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', color, fontWeight: 600, fontFamily: 'inherit' }}>
                    Mark all read
                  </button>
                )}
                <button onClick={() => setNotifOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, display: 'flex', alignItems: 'center' }}>
                  <Icon name="close" size={20} />
                </button>
              </div>
            </div>

            {/* Notification list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
                  <Icon name="notifications_none" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
                  <div style={{ fontSize: '13px' }}>No notifications yet</div>
                </div>
              ) : (
                notifications.map(n => {
                  const { icon: typeIcon, color: typeColor } = resolveNotifStyle(n.type, THEME)
                  const ts = new Date(n.created_at)
                  const age = Date.now() - ts.getTime()
                  const ageStr = age < 3600000 ? `${Math.floor(age / 60000)}m ago`
                    : age < 86400000 ? `${Math.floor(age / 3600000)}h ago`
                    : ts.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                  return (
                    <div
                      key={n.id}
                      onClick={() => {
                        markRead(n.id)
                        if (n.link && n.link.startsWith('/')) {
                          navigate(n.link)
                        }
                        setNotifOpen(false)
                      }}
                      style={{
                        padding: '14px 20px', borderBottom: `1px solid ${THEME.outlineVar}`,
                        cursor: n.link ? 'pointer' : 'default',
                        background: n.is_read ? 'transparent' : typeColor + '08',
                        display: 'flex', gap: '12px', alignItems: 'flex-start',
                        transition: 'background .15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = THEME.surfaceVar }}
                      onMouseLeave={e => { e.currentTarget.style.background = n.is_read ? 'transparent' : typeColor + '08' }}
                    >
                      <div style={{ width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0, background: typeColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name={typeIcon} size={16} style={{ color: typeColor }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ fontSize: '13px', fontWeight: n.is_read ? 500 : 700, color: THEME.text }}>{n.title}</span>
                          <span style={{ fontSize: '11px', color: THEME.textLow, flexShrink: 0 }}>{ageStr}</span>
                        </div>
                        {n.message && <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '3px', lineHeight: 1.5 }}>{n.message}</div>}
                        {!n.is_read && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: typeColor, marginTop: '6px' }} />}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: `1px solid ${THEME.outlineVar}`, flexShrink: 0, textAlign: 'center' }}>
              <button
                onClick={() => { navigate('/notifications/notification_center'); setNotifOpen(false) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color, fontFamily: 'inherit' }}
              >
                View all notifications
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Top bar ────────────────────────────────────────────────────────────────
// Title "Fixed Assets (register, depreciation, counts)" splits into a bold name and a quiet subtitle.
function splitTitle(t) {
  const m = /^(.*?)\s*\((.+)\)\s*$/.exec(t || '')
  return m ? [m[1], m[2]] : [t, '']
}
function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return now
}
function BarIconButton({ icon, label, onClick, badge, color }) {
  const [h, setH] = useState(false)
  return (
    <button onClick={onClick} title={label} aria-label={label} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ position: 'relative', background: h ? color + '14' : 'transparent', border: 'none', cursor: 'pointer',
        color: h ? color : THEME.textMed, borderRadius: '12px', width: '38px', height: '38px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', transition: 'background .15s, color .15s', flexShrink: 0 }}>
      <Icon name={icon} size={21} />
      {badge > 0 && (
        <span style={{ position: 'absolute', top: '3px', right: '2px', minWidth: '17px', height: '17px', borderRadius: '9px',
          background: `linear-gradient(135deg, ${THEME.error}, ${color})`, color: '#fff', fontSize: '10px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', lineHeight: 1,
          boxShadow: `0 0 0 2px ${THEME.surface}` }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
function TopBar({ isMobile, color, moduleIcon, moduleLabel, onHome, title, onMenu, unreadCount, onBell, flagCount, onFlags }) {
  const now = useClock()
  const [name, sub] = splitTitle(title)
  const [searchHover, setSearchHover] = useState(false)
  const hour = now.getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return (
    <header style={{
      position: 'relative', flexShrink: 0, height: isMobile ? '60px' : '72px',
      padding: isMobile ? '0 8px' : '0 22px', display: 'flex', alignItems: 'center', gap: isMobile ? '6px' : '16px',
      background: `linear-gradient(100deg, ${color}12 0%, ${THEME.surface} 38%, ${THEME.surface} 100%)`,
    }}>
      {/* hairline that fades out from the module colour */}
      <div aria-hidden="true" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '2px',
        background: `linear-gradient(90deg, ${color} 0%, ${color}55 30%, ${THEME.outlineVar} 60%, ${THEME.outlineVar} 100%)` }} />

      <BarIconButton icon="menu" label="Menu" onClick={onMenu} color={color} />

      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px' }}>
        {!isMobile && (
          <button onClick={onHome} style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none',
            border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', color, fontSize: '10.5px', fontWeight: 700,
            letterSpacing: '.12em', textTransform: 'uppercase' }}>
            <span style={{ width: '18px', height: '18px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${color}, ${color}B3)`, boxShadow: `0 2px 6px ${color}40` }}>
              <Icon name={moduleIcon} size={12} style={{ color: '#fff' }} />
            </span>
            {moduleLabel}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? '16px' : '20px', fontWeight: 650, letterSpacing: '-.01em', color: THEME.text,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>{name}</h1>
          {sub && !isMobile && (
            <span style={{ fontSize: '12.5px', color: THEME.textLow, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</span>
          )}
        </div>
      </div>

      {!isMobile && (
        <button onClick={() => window.dispatchEvent(new Event('open-command-palette'))}
          onMouseEnter={() => setSearchHover(true)} onMouseLeave={() => setSearchHover(false)}
          aria-label="Search or jump to a screen"
          style={{ display: 'flex', alignItems: 'center', gap: '10px', width: 'clamp(180px, 22vw, 300px)', height: '40px', padding: '0 8px 0 14px',
            borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', color: THEME.textLow, textAlign: 'left',
            background: searchHover ? THEME.surface : THEME.surfaceVar, border: `1px solid ${searchHover ? color + '66' : 'transparent'}`,
            boxShadow: searchHover ? `0 4px 14px ${color}1A` : 'none', transition: 'all .15s', flexShrink: 1 }}>
          <Icon name="search" size={18} style={{ color: searchHover ? color : THEME.textLow }} />
          <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Search or jump to…</span>
          <kbd style={{ fontFamily: 'inherit', fontSize: '11px', fontWeight: 600, color: THEME.textMed, background: THEME.surface,
            border: `1px solid ${THEME.outlineVar}`, borderRadius: '6px', padding: '2px 6px' }}>Ctrl K</kbd>
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '2px' : '10px', flexShrink: 0 }}>
        {isMobile && <BarIconButton icon="search" label="Search" onClick={() => window.dispatchEvent(new Event('open-command-palette'))} color={color} />}
        {flagCount > 0 && (
          <button onClick={onFlags} style={{ display: 'flex', alignItems: 'center', gap: '5px', height: '34px', padding: '0 12px', borderRadius: '999px',
            background: THEME.statusErrorBg, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', fontWeight: 700, color: THEME.error }}>
            <Icon name="flag" size={14} style={{ color: THEME.error }} />
            {flagCount}{isMobile ? '' : ` flag${flagCount > 1 ? 's' : ''}`}
          </button>
        )}
        <SiteSwitcher />
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', padding: isMobile ? 0 : '3px 3px 3px 14px', borderRadius: '14px',
          background: isMobile ? 'transparent' : THEME.surfaceVar }}>
          {!isMobile && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15, marginRight: '8px' }}>
              <span style={{ fontSize: '10.5px', color: THEME.textLow, fontWeight: 500 }}>{greet}</span>
              <span style={{ fontSize: '12.5px', fontWeight: 650, color: THEME.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                <span style={{ color: THEME.textLow, fontWeight: 500 }}> · {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              </span>
            </div>
          )}
          <BarIconButton icon="notifications" label="Notifications" onClick={onBell} badge={unreadCount} color={color} />
        </div>
      </div>
    </header>
  )
}
