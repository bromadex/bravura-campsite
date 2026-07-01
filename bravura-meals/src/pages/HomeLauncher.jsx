import { useState, useEffect } from 'react'
import { MODULE_COLORS, THEME, ROLE_LABELS, moduleAccess } from '../utils/permissions'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { useTheme } from '../contexts/ThemeContext'
import { useSite } from '../contexts/SiteContext'
import { supabase } from '../supabaseClient'
import SiteSwitcher from '../components/SiteSwitcher'

// ── Module definitions ────────────────────────────────────────────────────────
const ALL_MODULES = [
  { id: 'workforce', label: 'HR Management',       icon: 'badge',                color: MODULE_COLORS.workforce, access: moduleAccess.workforce },
  { id: 'campsite',  label: 'Campsite',             icon: 'holiday_village',      color: MODULE_COLORS.campsite,  access: moduleAccess.campsite  },
  { id: 'meals',     label: 'Meal Management',      icon: 'restaurant',           color: MODULE_COLORS.meals,     access: moduleAccess.meals     },
  { id: 'admin',     label: 'Administration',       icon: 'admin_panel_settings', color: MODULE_COLORS.admin,     access: moduleAccess.admin     },
  { id: 'fuel',      label: 'Fuel Management',      icon: 'local_gas_station',    color: MODULE_COLORS.fuel,      access: moduleAccess.fuel      },
  { id: 'fleet',     label: 'Fleet Management',     icon: 'directions_car',       color: MODULE_COLORS.fleet,     access: moduleAccess.fleet     },
]

export default function HomeLauncher({ onEnterModule }) {
  const { profile, signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const role = profile?.role

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
    background: 'rgba(255,255,255,.12)', border: 'none', cursor: 'pointer',
    borderRadius: '8px', width: '34px', height: '34px',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#fff', transition: 'background .15s', flexShrink: 0,
  }

  return (
    <div style={{ minHeight: '100vh', background: THEME.bg, fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", display: 'flex', flexDirection: 'column' }}>

      {/* ── Top Bar ── */}
      <div style={{ background: THEME.sidebar, padding: '0 20px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 12px rgba(0,0,0,.25)', flexShrink: 0 }}>
        {/* Logo + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '10px', background: 'rgba(255,255,255,.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px', overflow: 'hidden' }}>
            <img src="/logo/bravura-icon-512.png" alt="Bravura" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: '15px', fontWeight: 700, letterSpacing: '.04em' }}>BRAVURA</div>
            <div style={{ color: 'rgba(255,255,255,.45)', fontSize: '9px', letterSpacing: '.12em', textTransform: 'uppercase' }}>Enterprise Resource Planning</div>
          </div>
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <SiteSwitcher />

          {/* Bell */}
          <button
            onClick={() => setNotifOpen(o => !o)}
            title="Notifications"
            style={{ ...iconBtn, position: 'relative' }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.12)'}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>notifications</span>
            {unreadCount > 0 && (
              <span style={{ position: 'absolute', top: '3px', right: '3px', minWidth: '14px', height: '14px', borderRadius: '20px', background: '#EF4444', color: '#fff', fontSize: '9px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px', lineHeight: 1 }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Theme */}
          <button onClick={toggleTheme} title={theme === 'light' ? 'Dark mode' : 'Light mode'} style={iconBtn}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.12)'}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>{theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
          </button>

          {/* Avatar */}
          <div style={{ width: '34px', height: '34px', borderRadius: '50%', background: 'rgba(255,255,255,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
            {(profile?.full_name || profile?.username || '?').charAt(0).toUpperCase()}
          </div>

          {/* Sign out */}
          <button onClick={signOut} title="Sign out" style={iconBtn}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.12)'}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>logout</span>
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px' }}>

        {/* Welcome */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: '6px' }}>
            {currentSite?.name || 'Bravura'}
          </div>
          <h1 style={{ fontSize: '30px', fontWeight: 300, color: THEME.text, margin: '0 0 4px', letterSpacing: '-.01em' }}>
            Welcome back, <span style={{ fontWeight: 700 }}>{profile?.full_name?.split(' ')[0] || profile?.username}</span>
          </h1>
          <p style={{ fontSize: '13px', color: THEME.textMed, margin: 0 }}>
            {ROLE_LABELS[role] || role}
          </p>
        </div>

        {/* Module tiles */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(visible.length, 3)}, 1fr)`,
          gap: '16px',
          width: '100%',
          maxWidth: `${Math.min(visible.length, 3) * 190}px`,
        }}>
          {visible.map(mod => <ModuleTile key={mod.id} mod={mod} onClick={() => onEnterModule(mod.id)} />)}
        </div>
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
                {unreadCount > 0 && <span style={{ background: '#EF4444', color: '#fff', borderRadius: '20px', fontSize: '11px', fontWeight: 700, padding: '1px 7px' }}>{unreadCount}</span>}
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

// ── Module tile — modern ERP card ─────────────────────────────────────────────
function ModuleTile({ mod, onClick }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        background: THEME.surface,
        border: `1.5px solid ${hovered ? mod.color + '55' : THEME.outlineVar}`,
        borderRadius: '16px',
        padding: 0,
        cursor: 'pointer',
        boxShadow: hovered ? `0 8px 32px ${mod.color}22, 0 2px 8px rgba(0,0,0,.08)` : THEME.shadow1,
        transform: hovered ? 'translateY(-3px) scale(1.02)' : 'translateY(0) scale(1)',
        transition: 'all .2s cubic-bezier(.4,0,.2,1)',
        overflow: 'hidden',
        fontFamily: 'inherit',
        textAlign: 'center',
        width: '100%',
        aspectRatio: '1 / 1',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
      }}
    >
      {/* Colored accent bar at top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
        background: mod.color,
        opacity: hovered ? 1 : 0.6,
        transition: 'opacity .2s',
      }} />

      {/* Icon container */}
      <div style={{
        width: '64px', height: '64px',
        borderRadius: '18px',
        background: hovered ? mod.color : mod.color + '15',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '14px',
        transition: 'all .2s cubic-bezier(.4,0,.2,1)',
        boxShadow: hovered ? `0 4px 16px ${mod.color}44` : 'none',
      }}>
        <span
          className="material-symbols-rounded filled"
          style={{
            fontSize: '30px',
            color: hovered ? '#fff' : mod.color,
            transition: 'color .2s',
          }}
        >
          {mod.icon}
        </span>
      </div>

      {/* Label */}
      <div style={{
        fontSize: '13px',
        fontWeight: 600,
        color: THEME.text,
        lineHeight: 1.3,
        padding: '0 12px',
        letterSpacing: '.01em',
      }}>
        {mod.label}
      </div>
    </button>
  )
}
