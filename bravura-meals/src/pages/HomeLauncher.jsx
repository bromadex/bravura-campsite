import { useState, useEffect } from 'react'
import { MODULE_COLORS, THEME, ROLE_LABELS, moduleAccess } from '../utils/permissions'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { supabase } from '../supabaseClient'
import SiteSwitcher from '../components/SiteSwitcher'

// ── Module definitions ────────────────────────────────────────────────────────
// Order intentional: business operations first (meals → camp → fuel), then
// people & assets (HR → fleet), then system-level (admin), then feedback so it
// sits as the shared "help us build this" surface at the end.
const ALL_MODULES = [
  { id: 'meals',     label: 'Meal Management',      icon: 'restaurant',           color: MODULE_COLORS.meals,     access: moduleAccess.meals     },
  { id: 'campsite',  label: 'Campsite',             icon: 'holiday_village',      color: MODULE_COLORS.campsite,  access: moduleAccess.campsite  },
  { id: 'fuel',      label: 'Fuel Management',      icon: 'local_gas_station',    color: MODULE_COLORS.fuel,      access: moduleAccess.fuel      },
  { id: 'workforce', label: 'HR Management',        icon: 'badge',                color: MODULE_COLORS.workforce, access: moduleAccess.workforce },
  { id: 'fleet',     label: 'Fleet Management',     icon: 'directions_car',       color: MODULE_COLORS.fleet,     access: moduleAccess.fleet     },
  { id: 'admin',     label: 'Administration',       icon: 'admin_panel_settings', color: MODULE_COLORS.admin,     access: moduleAccess.admin     },
  { id: 'feedback',  label: 'Feedback',             icon: 'forum',                color: MODULE_COLORS.feedback,  access: moduleAccess.feedback  },
]

// Simple viewport tracker so inline styles can respond to breakpoints.
// mobile < 640, tablet 640–1023, desktop ≥ 1024.
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

export default function HomeLauncher({ onEnterModule }) {
  const { profile, signOut } = useAuth()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const role = profile?.role
  const vp = useViewport()
  const isMobile = vp === 'mobile'
  const isTablet = vp === 'tablet'

  const [notifOpen,     setNotifOpen]     = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount,   setUnreadCount]   = useState(0)

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
    const t = setInterval(load, 60_000)
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

  const visible = ALL_MODULES.filter(m => m.access(role, can))

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
          transition: 'background .15s, border-color .15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.14)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.07)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.08)' }}
        >
          <span className="material-symbols-rounded" style={{ fontSize: '18px', color: 'rgba(255,255,255,.55)' }}>search</span>
          <input
            type="text"
            placeholder="Search modules, records, or type a command…"
            className="topbar-search"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#fff', fontSize: '13px', fontFamily: 'inherit',
              padding: 0,
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

          {/* Avatar + name pill (name hidden on mobile) */}
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>

        {/* Welcome */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <h1 style={{ fontSize: '30px', fontWeight: 300, color: THEME.text, margin: '0 0 4px', letterSpacing: '-.01em' }}>
            Welcome back, <span style={{ fontWeight: 700 }}>{profile?.full_name?.split(' ')[0] || profile?.username}</span>
          </h1>
          <p style={{ fontSize: '13px', color: THEME.textMed, margin: 0 }}>
            {ROLE_LABELS[role] || role}
          </p>
        </div>

        {/* Module tiles — responsive: 2 cols mobile, 3 tablet, 5 desktop */}
        {(() => {
          const perRow = isMobile ? 2 : isTablet ? 3 : 5
          const cols   = Math.min(visible.length, perRow)
          return (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gap: isMobile ? '12px' : '14px',
              width: '100%',
              maxWidth: `${cols * (isMobile ? 160 : 170)}px`,
            }}>
              {visible.map(mod => <ModuleTile key={mod.id} mod={mod} onClick={() => onEnterModule(mod.id)} />)}
            </div>
          )
        })()}
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
                const tc = n.type === 'fuel_alert' ? '#EF4444' : n.type === 'fuel_warning' ? '#F59E0B' : THEME.textMed
                const ti = n.type === 'fuel_alert' ? 'warning' : n.type === 'fuel_warning' ? 'info' : 'notifications'
                const age = Date.now() - new Date(n.created_at).getTime()
                const ageStr = age < 3600000 ? `${Math.floor(age / 60000)}m ago` : age < 86400000 ? `${Math.floor(age / 3600000)}h ago` : new Date(n.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                return (
                  <div key={n.id} onClick={() => markRead(n.id)}
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
    </div>
  )
}

// ── Module tile — Odoo/SAP-inspired flat card ────────────────────────────────
function ModuleTile({ mod, onClick }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: THEME.surface,
        border: `1px solid ${hovered ? mod.color + '40' : THEME.outlineVar}`,
        borderRadius: '14px',
        padding: '24px 16px 20px',
        cursor: 'pointer',
        boxShadow: hovered
          ? `0 12px 28px ${mod.color}20, 0 4px 10px rgba(0,0,0,.06)`
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
      }}
    >
      {/* Solid colored icon block — always filled, white icon */}
      <div style={{
        width: '58px', height: '58px',
        borderRadius: '14px',
        background: mod.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: hovered
          ? `0 8px 20px ${mod.color}55, inset 0 -3px 0 rgba(0,0,0,.10)`
          : `0 4px 10px ${mod.color}30, inset 0 -3px 0 rgba(0,0,0,.08)`,
        transition: 'box-shadow .18s',
      }}>
        <span
          className="material-symbols-rounded filled"
          style={{ fontSize: '30px', color: '#fff', lineHeight: 1 }}
        >
          {mod.icon}
        </span>
      </div>

      {/* Label */}
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
        {mod.label}
      </div>
    </button>
  )
}
