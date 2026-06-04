import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { navItemsForRole, ROLE_LABELS, THEME } from '../utils/permissions'
import { supabase } from '../supabaseClient'

// Google Material Symbols (ligature font) — loaded in index.html
// Each icon is just its ligature name as text inside a <span class="material-symbols-rounded">
const Icon = ({ name, size = 20, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, ...style }}>
    {name}
  </span>
)

const PAGE_TITLES = {
  dashboard:   'Dashboard',
  entry:       'Daily Meal Entry',
  approvals:   'Approvals',
  kitchen:     'Kitchen Confirmation',
  daily:       'Daily Report',
  range:       'Date Range Report',
  monthly:     'Monthly Report',
  billing:     'Billing',
  employees:   'Employees',
  contractors: 'Contractors',
  pricing:     'Meal Pricing',
  flags:       'Flags & Queries',
  settings:    'Settings',
}

export default function Layout({ page, setPage, children }) {
  const { profile, signOut } = useAuth()
  const role = profile?.role || 'meal_officer'
  const navItems = navItemsForRole(role)
  const [flagCount, setFlagCount] = useState(0)
  const [collapsed, setCollapsed] = useState(false)

  // Group nav by section
  const sections = []
  let cur = null
  navItems.forEach(item => {
    if (item.section !== cur) { cur = item.section; sections.push({ section: item.section, items: [] }) }
    sections[sections.length - 1].items.push(item)
  })

  useEffect(() => {
    if (['super_admin','approver'].includes(role)) {
      supabase.from('flags').select('id', { count: 'exact', head: true }).eq('status','open')
        .then(({ count }) => setFlagCount(count || 0))
    }
  }, [role])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Google Sans', 'Segoe UI', Arial, sans-serif", background: THEME.bg }}>

      {/* ── Navigation Rail / Drawer ─────────────────────────────────── */}
      <nav style={{
        width: collapsed ? '72px' : '240px',
        background: THEME.sidebar,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: 'width 0.25s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
      }}>
        {/* App header */}
        <div style={{
          padding: collapsed ? '20px 0 16px' : '20px 16px 16px',
          borderBottom: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          gap: '10px',
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
            background: THEME.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="restaurant" size={22} style={{ color: '#fff' }} />
          </div>
          {!collapsed && (
            <div>
              <div style={{ color: '#fff', fontSize: '14px', fontWeight: 600, letterSpacing: '.01em' }}>
                Bravura Zimbabwe
              </div>
              <div style={{ color: 'rgba(255,255,255,.4)', fontSize: '11px', marginTop: '1px' }}>
                Meal Management
              </div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {sections.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <div style={{
                  padding: '16px 16px 4px', fontSize: '10px', fontWeight: 600,
                  color: 'rgba(255,255,255,.28)', letterSpacing: '.12em', textTransform: 'uppercase',
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
                      gap: collapsed ? 0 : '12px',
                      padding: collapsed ? '10px 0' : '9px 14px',
                      margin: '1px 8px',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      background: isActive ? 'rgba(244,168,150,.16)' : 'transparent',
                      color: isActive ? THEME.activeBar : 'rgba(255,255,255,.65)',
                      transition: 'background .15s',
                      userSelect: 'none',
                      position: 'relative',
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.06)' }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Active indicator pill */}
                    {isActive && (
                      <div style={{
                        position: 'absolute', left: '-8px', top: '50%', transform: 'translateY(-50%)',
                        width: '3px', height: '24px', borderRadius: '0 3px 3px 0',
                        background: THEME.activeBar,
                      }} />
                    )}
                    <Icon name={item.icon} size={20} style={{ color: 'inherit', flexShrink: 0 }} />
                    {!collapsed && (
                      <span style={{ fontSize: '13px', fontWeight: isActive ? 600 : 400, flex: 1 }}>
                        {item.label}
                      </span>
                    )}
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
          padding: collapsed ? '12px 0' : '12px 14px',
          borderTop: '1px solid rgba(255,255,255,.07)',
          display: 'flex', alignItems: 'center', gap: '10px',
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}>
          {!collapsed && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'rgba(255,255,255,.85)', fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.full_name || profile?.username || '—'}
              </div>
              <div style={{ color: 'rgba(255,255,255,.38)', fontSize: '11px', marginTop: '1px' }}>
                {ROLE_LABELS[role]}
              </div>
            </div>
          )}
          <button
            onClick={signOut}
            title="Sign out"
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,.38)', borderRadius: '8px', padding: '6px',
              display: 'flex', alignItems: 'center', transition: 'color .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.38)'}
          >
            <Icon name="logout" size={18} style={{ color: 'inherit' }} />
          </button>
        </div>
      </nav>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Top App Bar — MD3 style */}
        <div style={{
          background: THEME.surface,
          borderBottom: `1px solid ${THEME.outlineVar}`,
          padding: '0 16px',
          height: '64px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Hamburger */}
            <button
              onClick={() => setCollapsed(c => !c)}
              style={{
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
            <div style={{ fontSize: '20px', fontWeight: 400, color: THEME.text, letterSpacing: '-.01em' }}>
              {PAGE_TITLES[page] || page}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Date chip */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 14px', borderRadius: '20px',
              background: THEME.surfaceVar, border: `1px solid ${THEME.outline}`,
              fontSize: '12px', fontWeight: 500, color: THEME.textMed,
            }}>
              <Icon name="calendar_today" size={14} style={{ color: THEME.primary }} />
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
            {/* Flag chip */}
            {flagCount > 0 && (
              <div
                onClick={() => setPage('flags')}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', borderRadius: '20px',
                  background: '#FDECEA', border: `1px solid #F5C6C4`,
                  fontSize: '12px', fontWeight: 600, color: THEME.error, cursor: 'pointer',
                }}
              >
                <Icon name="flag" size={14} style={{ color: THEME.error }} />
                {flagCount} open flag{flagCount > 1 ? 's' : ''}
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
