import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { THEME, ROLE_LABELS, MODULE_COLORS } from '../utils/permissions'
import { supabase } from '../supabaseClient'
import SiteSwitcher from './SiteSwitcher'
import { ThemeToggle } from './ui'

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
  camp_assignments: 'Room Assignments',
  camp_rooms:       'Rooms',
  camp_blocks:      'Blocks',
  camp_supplies:    'Camp Supplies',
  camp_occ_report:  'Occupancy Reports',
  // Meals
  meals_dashboard:  'Dashboard',
  meals_entry:      'Daily Meal Entry',
  meals_approvals:  'Approvals',
  meals_kitchen:    'Kitchen Verification',
  meals_flags:      'Flags & Queries',
  meals_daily:      'Daily Report',
  meals_range:      'Date Range Report',
  meals_monthly:    'Monthly Report',
  meals_billing:    'Billing',
  meals_pricing:    'Pricing Management',
  meals_settings:   'Settings',
  // Fuel
  fuel_dashboard:   'Dashboard',
  fuel_ledger:      'Fuel Ledger',
  fuel_receipts:    'Fuel Deliveries',
  fuel_issues:      'Fuel Issuance',
  fuel_dips:        'Dip Stick Readings',
  fuel_reports:     'Fuel Reports',
  fuel_tanks:       'Tanks',
}

export default function ModuleLayout({ moduleId, moduleLabel, moduleIcon, navItems, page, setPage, onHome, children }) {
  const { profile, signOut } = useAuth()
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const role = profile?.role
  const [collapsed,  setCollapsed]  = useState(false)
  const [flagCount,  setFlagCount]  = useState(0)
  const color = MODULE_COLORS[moduleId] || THEME.primary

  // Section grouping
  const sections = []
  let cur = null
  navItems.forEach(item => {
    if (item.section !== cur) { cur = item.section; sections.push({ section: item.section, items: [] }) }
    sections[sections.length - 1].items.push(item)
  })

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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif" }}>

      {/* ── Sidebar ── */}
      <nav style={{
        width: collapsed ? '68px' : '236px',
        background: THEME.sidebar,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: 'width 0.25s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
      }}>
        {/* Module identity */}
        <div style={{
          padding: collapsed ? '16px 0 14px' : '16px 14px 14px',
          borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start', gap: '10px',
        }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
            background: color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={moduleIcon} size={20} style={{ color: '#fff' }} />
          </div>
          {!collapsed && (
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
          onClick={onHome}
          title="Back to Home"
          style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: collapsed ? '10px 0' : '9px 14px',
            margin: '6px 8px 2px',
            borderRadius: '10px', cursor: 'pointer',
            color: 'rgba(255,255,255,.5)',
            transition: 'all .15s',
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.08)'; e.currentTarget.style.color = '#fff' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,.5)' }}
        >
          <Icon name="home" size={18} style={{ color: 'inherit', flexShrink: 0 }} />
          {!collapsed && <span style={{ fontSize: '12px', fontWeight: 500 }}>Home</span>}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '4px 0', overflowY: 'auto' }}>
          {sections.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <div style={{
                  padding: '12px 16px 3px', fontSize: '9px', fontWeight: 600,
                  color: 'rgba(255,255,255,.25)', letterSpacing: '.12em', textTransform: 'uppercase',
                }}>
                  {section}
                </div>
              )}
              {items.map(item => {
                const isActive = page === item.id
                return (
                  <div
                    key={item.id}
                    onClick={() => setPage(item.id)}
                    title={collapsed ? item.label : ''}
                    style={{
                      display: 'flex', alignItems: 'center',
                      gap: collapsed ? 0 : '11px',
                      padding: collapsed ? '10px 0' : '9px 12px',
                      margin: '1px 8px', borderRadius: '12px',
                      cursor: 'pointer',
                      justifyContent: collapsed ? 'center' : 'flex-start',
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
                    {!collapsed && (
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
          ))}
        </div>

        {/* User footer */}
        <div style={{
          padding: collapsed ? '10px 0' : '10px 12px',
          borderTop: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center', gap: '8px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}>
          <div style={{
            width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
            background: color + '55',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '12px', fontWeight: 700, color: '#fff',
          }}>
            {(profile?.full_name || profile?.username || '?').charAt(0).toUpperCase()}
          </div>
          {!collapsed && (
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
          padding: '0 16px', height: '60px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, boxShadow: THEME.shadow1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setCollapsed(c => !c)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: THEME.textMed, borderRadius: '50%', width: '38px', height: '38px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="menu" size={22} />
            </button>
            {/* Breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                onClick={onHome}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  fontSize: '12px', fontWeight: 500, color, cursor: 'pointer',
                  padding: '3px 10px', borderRadius: '20px', background: color + '14',
                }}
              >
                <Icon name={moduleIcon} size={13} style={{ color }} />
                {moduleLabel}
              </span>
              <Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} />
              <span style={{ fontSize: '17px', fontWeight: 400, color: THEME.text }}>
                {PAGE_TITLES[page] || page}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <SiteSwitcher />
            <ThemeToggle size="sm" />
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 12px', borderRadius: '20px',
              background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
              fontSize: '12px', fontWeight: 500, color: THEME.textMed,
            }}>
              <Icon name="calendar_today" size={13} style={{ color }} />
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
            {flagCount > 0 && (
              <div onClick={() => setPage('meals_flags')} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', borderRadius: '20px',
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: THEME.bg }}>
          {children}
        </div>
      </div>
    </div>
  )
}
