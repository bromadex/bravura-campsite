import { useState, useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { navItemsForRole, ROLE_LABELS } from '../utils/permissions'
import { supabase } from '../supabaseClient'

// ── SVG Icons ────────────────────────────────────────────────────────────────
const icons = {
  grid: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  edit: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  'check-circle': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/></svg>,
  utensils: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2v0a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>,
  calendar: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  'bar-chart': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  'trending-up': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  'dollar-sign': <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  users: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  tag: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  flag: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>,
  settings: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  logout: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
}

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  entry: 'Daily Meal Entry',
  approvals: 'Approvals',
  kitchen: 'Kitchen Confirmation',
  daily: 'Daily Report',
  range: 'Date Range Report',
  monthly: 'Monthly Report',
  billing: 'Billing',
  employees: 'Employees',
  pricing: 'Meal Pricing',
  flags: 'Flags & Queries',
  settings: 'Settings',
}

export default function Layout({ page, setPage, children }) {
  const { profile, signOut } = useAuth()
  const role = profile?.role || 'meal_officer'
  const navItems = navItemsForRole(role)
  const [openFlagsCount, setOpenFlagsCount] = useState(0)
  const [collapsed, setCollapsed] = useState(false)

  // Group nav items by section
  const sections = []
  let currentSection = null
  navItems.forEach(item => {
    if (item.section !== currentSection) {
      currentSection = item.section
      sections.push({ section: item.section, items: [] })
    }
    sections[sections.length - 1].items.push(item)
  })

  // Fetch open flags count for badge
  useEffect(() => {
    if (['super_admin','approver'].includes(role)) {
      supabase
        .from('flags')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .then(({ count }) => setOpenFlagsCount(count || 0))
    }
  }, [role])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', fontFamily: "'Segoe UI', Arial, sans-serif" }}>

      {/* ── Sidebar ── */}
      <nav style={{
        width: collapsed ? '52px' : '220px',
        background: '#1F3864',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        transition: 'width 0.2s',
        overflow: 'hidden',
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 12px', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
          {!collapsed && (
            <>
              <div style={{ color: '#fff', fontSize: '15px', fontWeight: 700, lineHeight: 1.2 }}>
                Bravura Zimbabwe
              </div>
              <div style={{ color: 'rgba(255,255,255,.5)', fontSize: '11px', marginTop: '2px' }}>
                Meal Management
              </div>
            </>
          )}
          {collapsed && <span style={{ fontSize: '20px' }}>🍽️</span>}
        </div>

        {/* Nav */}
        <div style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
          {sections.map(({ section, items }) => (
            <div key={section}>
              {!collapsed && (
                <div style={{
                  padding: '12px 16px 4px', fontSize: '10px', fontWeight: 700,
                  color: 'rgba(255,255,255,.35)', letterSpacing: '.08em', textTransform: 'uppercase',
                }}>
                  {section}
                </div>
              )}
              {items.map(item => (
                <div
                  key={item.id}
                  onClick={() => setPage(item.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: collapsed ? '10px 18px' : '9px 16px',
                    cursor: 'pointer',
                    color: page === item.id ? '#fff' : 'rgba(255,255,255,.75)',
                    fontSize: '13px',
                    borderLeft: `3px solid ${page === item.id ? '#ED7D31' : 'transparent'}`,
                    background: page === item.id ? 'rgba(255,255,255,.12)' : 'transparent',
                    transition: 'all .15s',
                    position: 'relative',
                    userSelect: 'none',
                  }}
                  onMouseEnter={e => { if (page !== item.id) e.currentTarget.style.background = 'rgba(255,255,255,.07)' }}
                  onMouseLeave={e => { if (page !== item.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ opacity: page === item.id ? 1 : 0.8, flexShrink: 0 }}>
                    {icons[item.icon]}
                  </span>
                  {!collapsed && <span>{item.label}</span>}
                  {/* Flag badge */}
                  {item.id === 'flags' && openFlagsCount > 0 && (
                    <span style={{
                      marginLeft: 'auto', background: '#C00000', color: '#fff',
                      borderRadius: '10px', fontSize: '10px', fontWeight: 700,
                      padding: '1px 6px', minWidth: '18px', textAlign: 'center',
                    }}>
                      {openFlagsCount}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer / User info */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,.1)',
          fontSize: '11px', color: 'rgba(255,255,255,.5)',
        }}>
          {!collapsed && (
            <>
              <div style={{ fontWeight: 600, color: 'rgba(255,255,255,.8)', fontSize: '12px' }}>
                {profile?.full_name || profile?.username || '—'}
              </div>
              <div style={{ marginTop: '2px' }}>
                {ROLE_LABELS[role] || role}
              </div>
            </>
          )}
          <button
            onClick={signOut}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              marginTop: collapsed ? 0 : '8px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,.5)', fontSize: '11px', padding: '4px 0',
              fontFamily: 'inherit',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#fff'}
            onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.5)'}
          >
            {icons.logout}
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </nav>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{
          background: '#fff', borderBottom: '1px solid #dde2ea',
          padding: '14px 24px', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => setCollapsed(c => !c)}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: '4px', color: '#4a5568',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#1a1a2e' }}>
              {PAGE_TITLES[page] || page}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
              background: '#E2EFDA', color: '#375623',
            }}>
              {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            {openFlagsCount > 0 && (
              <span
                onClick={() => setPage('flags')}
                style={{
                  padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                  background: '#FFE0E0', color: '#C00000', cursor: 'pointer',
                }}
              >
                🚩 {openFlagsCount} open flag{openFlagsCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#f4f6f9' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
