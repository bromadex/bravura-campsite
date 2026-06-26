import { MODULE_COLORS, THEME, ROLE_LABELS, moduleAccess } from '../utils/permissions'
import { useAuth } from '../auth/AuthContext'

// ── Module card definitions ───────────────────────────────────────────────────
const ALL_MODULES = [
  {
    id:       'workforce',
    label:    'Workforce Management',
    sub:      'Employees, contractors & leave',
    icon:     'badge',
    color:    MODULE_COLORS.workforce,
    access:   moduleAccess.workforce,
  },
  {
    id:       'campsite',
    label:    'Campsite Management',
    sub:      'Rooms, occupancy & supplies',
    icon:     'holiday_village',
    color:    MODULE_COLORS.campsite,
    access:   moduleAccess.campsite,
  },
  {
    id:       'meals',
    label:    'Meal Management',
    sub:      'Attendance, approvals & billing',
    icon:     'restaurant',
    color:    MODULE_COLORS.meals,
    access:   moduleAccess.meals,
    requiresPin: true,
  },
]

export default function HomeLauncher({ onEnterModule }) {
  const { profile, signOut } = useAuth()
  const role = profile?.role

  const visible = ALL_MODULES.filter(m => m.access(role))

  return (
    <div style={{
      minHeight: '100vh',
      background: '#F0F2F5',
      fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
    }}>
      {/* Top Bar */}
      <div style={{
        background: THEME.primary,
        padding: '0 20px',
        height: '56px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        boxShadow: '0 2px 8px rgba(0,0,0,.2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '10px',
            background: 'rgba(255,255,255,.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '4px', overflow: 'hidden',
          }}>
            <img src="/logo/bravura-icon-512.png" alt="Bravura" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <div style={{ color: '#fff', fontSize: '15px', fontWeight: 700, letterSpacing: '.02em' }}>
              BRAVURA
            </div>
            <div style={{ color: 'rgba(255,255,255,.55)', fontSize: '10px', letterSpacing: '.1em' }}>
              MEAL & CAMPSITE MANAGEMENT
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* User avatar */}
          <div style={{
            width: '34px', height: '34px', borderRadius: '50%',
            background: 'rgba(255,255,255,.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: 700, color: '#fff',
          }}>
            {(profile?.full_name || profile?.username || '?').charAt(0).toUpperCase()}
          </div>
          {/* Sign out */}
          <button
            onClick={signOut}
            title="Sign out"
            style={{
              background: 'rgba(255,255,255,.12)', border: 'none', cursor: 'pointer',
              borderRadius: '8px', width: '34px', height: '34px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', transition: 'background .15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,.12)'}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>logout</span>
          </button>
        </div>
      </div>

      {/* Welcome */}
      <div style={{ textAlign: 'center', padding: '40px 20px 28px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#1A1A2E', margin: '0 0 6px' }}>
          Welcome, {profile?.full_name?.split(' ')[0] || profile?.username}
        </h1>
        <p style={{ fontSize: '15px', color: '#6B7280', margin: 0 }}>
          Select a module to get started
        </p>
      </div>

      {/* Module cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: '14px',
        padding: '0 16px 32px',
        maxWidth: '600px',
        margin: '0 auto',
      }}>
        {visible.map(mod => (
          <ModuleCard key={mod.id} mod={mod} onClick={() => onEnterModule(mod.id)} />
        ))}
      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '0 20px 24px', fontSize: '11px', color: '#9CA3AF' }}>
        {ROLE_LABELS[role]} · Bravura Zimbabwe Ltd · Kamativi Mine Site
      </div>
    </div>
  )
}

function ModuleCard({ mod, onClick }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '24px 16px 20px',
        textAlign: 'center',
        cursor: 'pointer',
        boxShadow: hovered
          ? '0 8px 24px rgba(0,0,0,.12)'
          : '0 1px 4px rgba(0,0,0,.08)',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'all .2s cubic-bezier(.4,0,.2,1)',
        border: `1px solid ${hovered ? mod.color + '44' : '#E5E7EB'}`,
      }}
    >
      {/* Icon circle */}
      <div style={{
        width: '64px', height: '64px', borderRadius: '20px',
        background: mod.color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 14px',
        transition: 'background .2s',
        ...(hovered ? { background: mod.color + '28' } : {}),
      }}>
        <span
          className="material-symbols-rounded filled"
          style={{ fontSize: '32px', color: mod.color }}
        >
          {mod.icon}
        </span>
      </div>

      <div style={{ fontSize: '14px', fontWeight: 700, color: '#1A1A2E', marginBottom: '4px', lineHeight: 1.3 }}>
        {mod.label}
      </div>
      <div style={{ fontSize: '11px', color: '#9CA3AF', lineHeight: 1.4 }}>
        {mod.sub}
      </div>

      {/* Lock badge for Meals */}
      {mod.requiresPin && (
        <div style={{
          marginTop: '10px',
          display: 'inline-flex', alignItems: 'center', gap: '3px',
          padding: '2px 8px', borderRadius: '20px',
          background: mod.color + '14', color: mod.color,
          fontSize: '10px', fontWeight: 600,
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '11px' }}>lock</span>
          PIN required
        </div>
      )}
    </div>
  )
}

// need useState
import { useState } from 'react'
