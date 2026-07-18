import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { THEME, ROLE_LABELS, MODULE_COLORS } from '../utils/permissions'
import { resolveNotifStyle } from '../utils/notify'
import { supabase } from '../supabaseClient'
import SiteSwitcher from './SiteSwitcher'

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
  const color = MODULE_COLORS[moduleId] || THEME.primary

  // Section grouping
  const sections = []
  let cur = null
  navItems.forEach(item => {
    if (item.section !== cur) { cur = item.section; sections.push({ section: item.section, items: [] }) }
    sections[sections.length - 1].items.push(item)
  })

  // Load notifications for current user + site
  useEffect(() => {
    if (!profile?.id) return
    function load() {
      supabase
        .from('notifications')
        .select('*')
        .eq('recipient_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => {
          setNotifications(data || [])
          setUnreadCount((data || []).filter(n => !n.is_read).length)
        })
    }
    load()
    // Poll every 60 seconds
    const t = setInterval(load, 20_000)
    return () => clearInterval(t)
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
                {ROLE_LABELS[role]}
              </div>
            </div>
          )}
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
        {/* Top App Bar */}
        <div style={{
          background: THEME.surface,
          borderBottom: `1px solid ${THEME.outlineVar}`,
          padding: isMobile ? '0 8px' : '0 16px', height: '60px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, boxShadow: THEME.shadow1, gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
            <button
              onClick={() => isMobile ? setMobileNavOpen(true) : setCollapsed(c => !c)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: THEME.textMed, borderRadius: '50%', width: '38px', height: '38px',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <Icon name="menu" size={22} />
            </button>
            {/* Breadcrumb — collapses to just the page title on mobile */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden' }}>
              {!isMobile && (
                <>
                  <span
                    onClick={onHome}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      fontSize: '12px', fontWeight: 500, color, cursor: 'pointer',
                      padding: '3px 10px', borderRadius: '6px', background: color + '14',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name={moduleIcon} size={13} style={{ color }} />
                    {moduleLabel}
                  </span>
                  <Icon name="chevron_right" size={16} style={{ color: THEME.textLow, flexShrink: 0 }} />
                </>
              )}
              <span style={{
                fontSize: isMobile ? '15px' : '17px', fontWeight: isMobile ? 600 : 400, color: THEME.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {PAGE_TITLES[page] || page}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '2px' : '8px', flexShrink: 0 }}>
            {/* Notification bell */}
            <button
              onClick={() => setNotifOpen(o => !o)}
              title="Notifications"
              style={{ position: 'relative', background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed, borderRadius: '50%', width: '38px', height: '38px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="notifications" size={22} />
              {unreadCount > 0 && (
                <span style={{ position: 'absolute', top: '4px', right: '4px', minWidth: '16px', height: '16px', borderRadius: '6px', background: THEME.error, color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 }}>
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
            <SiteSwitcher />
            {!isMobile && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', borderRadius: '6px',
                background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
                fontSize: '12px', fontWeight: 500, color: THEME.textMed,
              }}>
                <Icon name="calendar_today" size={13} style={{ color }} />
                {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            )}
            {flagCount > 0 && (
              <div onClick={() => setPage('meals_flags')} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', borderRadius: '6px',
                background: THEME.statusErrorBg, border: `1px solid ${THEME.error}55`,
                fontSize: '12px', fontWeight: 600, color: THEME.error, cursor: 'pointer',
              }}>
                <Icon name="flag" size={13} style={{ color: THEME.error }} />
                {flagCount} flag{flagCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '14px' : '24px', background: THEME.bg }}>
          {children}
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
                        if (n.action_url && n.action_url.startsWith('/')) {
                          navigate(n.action_url)
                        }
                        setNotifOpen(false)
                      }}
                      style={{
                        padding: '14px 20px', borderBottom: `1px solid ${THEME.outlineVar}`,
                        cursor: n.action_url ? 'pointer' : 'default',
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
                        {n.body && <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '3px', lineHeight: 1.5 }}>{n.body}</div>}
                        {!n.is_read && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: typeColor, marginTop: '6px' }} />}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
