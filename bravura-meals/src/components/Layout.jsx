import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { navItemsForRole, ROLE_LABELS, THEME } from '../utils/permissions'
import { supabase } from '../supabaseClient'

const Icon = ({ name, size = 20, filled = false, style = {} }) => (
  <span
    className={`material-symbols-rounded${filled ? ' filled' : ''}`}
    style={{ fontSize: size, lineHeight: 1, color: 'inherit', userSelect: 'none', ...style }}
  >
    {name}
  </span>
)

// ── Module definitions ────────────────────────────────────────────────────────
const MODULES = {
  meals: {
    id:    'meals',
    label: 'Meals',
    icon:  'restaurant',
    color: THEME.primary,
  },
  campsite: {
    id:    'campsite',
    label: 'Campsite',
    icon:  'holiday_village',
    color: '#1558A6',
  },
}

const CAMPSITE_NAV = [
  { id: 'camp_headcount',   label: 'Headcount',   icon: 'people_alt',          section: 'Overview' },
  { id: 'camp_assignments', label: 'Assignments',  icon: 'assignment_ind',      section: 'Management' },
  { id: 'camp_rooms',       label: 'Rooms',        icon: 'meeting_room',        section: 'Management' },
  { id: 'camp_blocks',      label: 'Blocks',       icon: 'domain',              section: 'Management' },
  { id: 'camp_supplies',    label: 'Camp Supplies', icon: 'inventory_2',        section: 'Management' },
]

const PAGE_TITLES = {
  // Meals
  dashboard:        'Dashboard',
  entry:            'Daily Meal Entry',
  approvals:        'Approvals',
  kitchen:          'Kitchen Confirmation',
  daily:            'Daily Report',
  range:            'Date Range Report',
  monthly:          'Monthly Report',
  billing:          'Billing',
  employees:        'Employees',
  contractors:      'Contractors',
  pricing:          'Meal Pricing',
  flags:            'Flags & Queries',
  settings:         'Settings',
  // Campsite
  camp_headcount:   'Headcount Dashboard',
  camp_assignments: 'Room Assignments',
  camp_rooms:       'Rooms',
  camp_blocks:      'Blocks',
  camp_supplies:    'Camp Supplies',
}

export default function Layout({ page, setPage, children }) {
  const { profile, signOut } = useAuth()
  const role = profile?.role || 'meal_officer'

  // Determine active module from page id
  const isCampPage = page.startsWith('camp_')
  const [activeModule, setActiveModule] = useState(isCampPage ? 'campsite' : 'meals')

  const [flagCount,  setFlagCount]  = useState(0)
  const [collapsed,  setCollapsed]  = useState(false)

  // Sync module when page changes externally
  useEffect(() => {
    if (page.startsWith('camp_')) setActiveModule('campsite')
    else setActiveModule('meals')
  }, [page])

  // Meals nav items
  const mealsNavItems = navItemsForRole(role)

  // Group nav by section
  function groupBySec(items) {
    const sections = []
    let cur = null
    items.forEach(item => {
      if (item.section !== cur) { cur = item.section; sections.push({ section: item.section, items: [] }) }
      sections[sections.length - 1].items.push(item)
    })
    return sections
  }

  const navSections = activeModule === 'meals'
    ? groupBySec(mealsNavItems)
    : groupBySec(CAMPSITE_NAV)

  const moduleColor = MODULES[activeModule].color

  useEffect(() => {
    if (['super_admin','approver'].includes(role)) {
      supabase.from('flags').select('id', { count: 'exact', head: true }).eq('status','open')
        .then(({ count }) => setFlagCount(count || 0))
    }
  }, [role])

  function switchModule(modId) {
    setActiveModule(modId)
    if (modId === 'meals')    setPage('dashboard')
    if (modId === 'campsite') setPage('camp_headcount')
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", background: THEME.bg }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <nav style={{
        width: collapsed ? '68px' : '236px',
        background: THEME.sidebar,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: 'width 0.25s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
      }}>

        {/* App identity */}
        <div style={{
          padding: collapsed ? '18px 0 14px' : '18px 14px 14px',
          borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start', gap: '10px',
        }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
            background: moduleColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background .25s',
          }}>
            <Icon name={MODULES[activeModule].icon} size={20} style={{ color: '#fff' }} />
          </div>
          {!collapsed && (
            <div>
              <div style={{ color: '#fff', fontSize: '13px', fontWeight: 600, lineHeight: 1.2 }}>
                Bravura Zimbabwe
              </div>
              <div style={{ color: 'rgba(255,255,255,.38)', fontSize: '10px', marginTop: '1px' }}>
                {MODULES[activeModule].label} Management
              </div>
            </div>
          )}
        </div>

        {/* Module switcher */}
        <div style={{
          padding: collapsed ? '10px 8px' : '10px 10px',
          borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', gap: '6px',
          flexDirection: collapsed ? 'column' : 'row',
        }}>
          {Object.values(MODULES).map(mod => {
            const isActive = activeModule === mod.id
            return (
              <button
                key={mod.id}
                onClick={() => switchModule(mod.id)}
                title={mod.label}
                style={{
                  flex: collapsed ? 'none' : 1,
                  padding: collapsed ? '8px 0' : '6px 8px',
                  borderRadius: '10px', cursor: 'pointer', border: 'none',
                  background: isActive ? mod.color : 'rgba(255,255,255,.07)',
                  color: isActive ? '#fff' : 'rgba(255,255,255,.5)',
                  display: 'flex', alignItems: 'center',
                  justifyContent: collapsed ? 'center' : 'center',
                  gap: '5px', fontSize: '11px', fontWeight: 600,
                  fontFamily: 'inherit', transition: 'all .15s',
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.12)' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.07)' }}
              >
                <Icon name={mod.icon} size={16} style={{ color: 'inherit' }} />
                {!collapsed && <span>{mod.label}</span>}
              </button>
            )
          })}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '6px 0', overflowY: 'auto' }}>
          {navSections.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <div style={{
                  padding: '14px 16px 3px', fontSize: '9px', fontWeight: 600,
                  color: 'rgba(255,255,255,.26)', letterSpacing: '.12em', textTransform: 'uppercase',
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
                      margin: '1px 8px',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      background: isActive ? `${moduleColor}28` : 'transparent',
                      color: isActive ? '#fff' : 'rgba(255,255,255,.62)',
                      transition: 'background .15s',
                      userSelect: 'none',
                      position: 'relative',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.06)' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Active pill */}
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
                    {item.id === 'flags' && flagCount > 0 && (
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
            width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
            background: moduleColor + '44',
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
              <div style={{ color: 'rgba(255,255,255,.36)', fontSize: '10px', marginTop: '1px' }}>
                {ROLE_LABELS[role]}
              </div>
            </div>
          )}
          <button onClick={signOut} title="Sign out" style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'rgba(255,255,255,.36)', borderRadius: '8px', padding: '5px',
            display: 'flex', alignItems: 'center', transition: 'color .15s',
          }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.36)'}
          >
            <Icon name="logout" size={17} style={{ color: 'inherit' }} />
          </button>
        </div>
      </nav>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top App Bar */}
        <div style={{
          background: THEME.surface,
          borderBottom: `1px solid ${THEME.outlineVar}`,
          padding: '0 16px', height: '64px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,.05)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Hamburger */}
            <button onClick={() => setCollapsed(c => !c)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: THEME.textMed, borderRadius: '50%', width: '40px', height: '40px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background .15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <Icon name="menu" size={22} />
            </button>

            {/* Module breadcrumb */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: '12px', fontWeight: 500, color: moduleColor,
                padding: '3px 10px', borderRadius: '20px',
                background: moduleColor + '14',
              }}>
                <Icon name={MODULES[activeModule].icon} size={14} style={{ color: moduleColor }} />
                {MODULES[activeModule].label}
              </span>
              <Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} />
              <span style={{ fontSize: '18px', fontWeight: 400, color: THEME.text }}>
                {PAGE_TITLES[page] || page}
              </span>
            </div>
          </div>

          {/* Right side chips */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '6px 12px', borderRadius: '20px',
              background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
              fontSize: '12px', fontWeight: 500, color: THEME.textMed,
            }}>
              <Icon name="calendar_today" size={13} style={{ color: THEME.primary }} />
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
            {flagCount > 0 && (
              <div onClick={() => setPage('flags')} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '6px 12px', borderRadius: '20px',
                background: '#FDECEA', border: '1px solid #F5C6C4',
                fontSize: '12px', fontWeight: 600, color: THEME.error, cursor: 'pointer',
              }}>
                <Icon name="flag" size={13} style={{ color: THEME.error }} />
                {flagCount} flag{flagCount > 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: THEME.bg }}>
          {children}
        </div>
      </div>
    </div>
  )
}
