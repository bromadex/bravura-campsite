import { useState, useEffect } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME, MODULE_COLORS, moduleAccess } from '../../utils/permissions'
import { Card, Icon, Button, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { getPrefs, savePrefs, applyDisplayPrefs, PREF_DEFAULTS, playNotificationSound } from '../../utils/userPrefs'

const ACCENT = MODULE_COLORS.admin || '#5C6BC0'

const NOTIFICATION_CATEGORIES = [
  { id: 'approval',     label: 'Approvals',     icon: 'approval' },
  { id: 'reminder',     label: 'Reminders',     icon: 'timer' },
  { id: 'announcement', label: 'Announcements', icon: 'campaign' },
  { id: 'escalation',   label: 'Escalations',   icon: 'priority_high' },
  { id: 'chat',         label: 'Chat',          icon: 'chat' },
  { id: 'general',      label: 'General',       icon: 'inbox' },
]

const LANDING_OPTIONS = [
  { value: '', label: 'Home Launcher (default)' },
  { value: 'meals', label: 'Meals' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'fleet', label: 'Fleet' },
  { value: 'campsite', label: 'Campsite' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'workforce', label: 'HR' },
  { value: 'finance', label: 'Finance' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'sheq', label: 'SHEQ' },
  { value: 'projects', label: 'Projects' },
  { value: 'contractors', label: 'Contractors' },
  { value: 'concrete', label: 'Batch Plant Operations' },
  { value: 'notifications', label: 'Notifications & Approvals' },
  { value: 'admin', label: 'Admin' },
]

const DATE_FORMATS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']
const FONT_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
]

function Toggle({ id, checked, onChange, label, hint }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, cursor: 'pointer', padding: '8px 0' }}>
      <span>
        <span style={{ fontSize: 13, color: THEME.text, display: 'block' }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: THEME.textLow }}>{hint}</span>}
      </span>
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: ACCENT, cursor: 'pointer', flexShrink: 0 }} />
    </label>
  )
}

function Choice({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} aria-pressed={value === o.value} style={{
          flex: '1 1 90px', padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 13, fontWeight: 600,
          border: `1px solid ${value === o.value ? ACCENT : THEME.outline}`,
          background: value === o.value ? ACCENT + '12' : THEME.surface,
          color: value === o.value ? ACCENT : THEME.textMed,
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function SectionCard({ icon, title, children, description }) {
  return (
    <Card style={{ padding: '24px', borderRadius: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: description ? '6px' : '18px' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: ACCENT + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={18} style={{ color: ACCENT }} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: THEME.text }}>{title}</div>
      </div>
      {description && <div style={{ fontSize: 12, color: THEME.textMed, marginBottom: 16, paddingLeft: 46 }}>{description}</div>}
      {children}
    </Card>
  )
}

export default function UserPreferences({ setPage }) {
  const { user, profile, role } = useAuth()
  const { can } = usePermissions()
  const [prefs, setPrefs] = useState(() => ({ ...getPrefs() }))
  const [saving, setSaving] = useState(false)
  const saved = getPrefs()
  useEffect(() => () => applyDisplayPrefs(getPrefs()), [])
  const dirty = JSON.stringify(prefs) !== JSON.stringify(saved)

  // Display settings preview live; they revert if you leave without saving.
  function set(patch) {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    applyDisplayPrefs(next)
  }

  function toggleMute(cat, receive) {
    const muted = new Set(prefs.muted_notification_categories || [])
    if (receive) muted.delete(cat); else muted.add(cat)
    set({ muted_notification_categories: [...muted] })
  }

  async function handleSave() {
    setSaving(true)
    try {
      const next = await savePrefs(prefs)
      setPrefs({ ...next })
      showToast('Preferences saved', 'green')
    } catch (err) {
      showToast(err.message || 'Could not save preferences', 'red')
    }
    setSaving(false)
  }

  function handleReset() {
    if (!window.confirm('Reset all preferences to the defaults?')) return
    set({ ...PREF_DEFAULTS })
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text, height: 40 }
  const landingOptions = LANDING_OPTIONS.filter(o => !o.value || moduleAccess[o.value]?.(role, can))

  return (
    <div>
      {can('users.view') && <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_preferences" />}
      <PageHeader title="My Preferences"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outlined" onClick={handleReset}>Reset to defaults</Button>
            <Button onClick={handleSave} disabled={saving || !dirty} style={{ background: ACCENT, borderColor: ACCENT, color: '#fff' }}>
              {saving ? 'Saving…' : dirty ? 'Save preferences' : 'Saved'}
            </Button>
          </div>
        } />

      <div style={{ fontSize: 12, color: THEME.textLow, marginBottom: 14 }}>
        Saved to your account, so they follow you to any device you sign in on.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(360px, 100%), 1fr))', gap: 16 }}>
        <SectionCard icon="person" title="Profile" description="Your account details are managed by your administrator.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: THEME.surfaceVar, borderRadius: 10, marginBottom: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: ACCENT + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: ACCENT }}>{(profile?.full_name || 'U').charAt(0).toUpperCase()}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: THEME.text }}>{profile?.full_name || 'User'}</div>
              <div style={{ fontSize: 12, color: THEME.textMed, overflowWrap: 'anywhere' }}>{user?.email || ''}</div>
            </div>
          </div>
          <label htmlFor="pref-landing"><SectionLabel>Open after sign-in</SectionLabel></label>
          <select id="pref-landing" value={prefs.landing_module} onChange={e => set({ landing_module: e.target.value })} style={inp}>
            {landingOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </SectionCard>

        <SectionCard icon="notifications" title="Notifications" description="Choose what shows in the bell. Everything is still kept in the Notification Center.">
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {NOTIFICATION_CATEGORIES.map(c => (
              <Toggle key={c.id} id={`pref-notif-${c.id}`} label={c.label}
                checked={!(prefs.muted_notification_categories || []).includes(c.id)}
                onChange={v => toggleMute(c.id, v)} />
            ))}
          </div>
          <div style={{ borderTop: `1px solid ${THEME.outlineVar}`, marginTop: 6, paddingTop: 4 }}>
            <Toggle id="pref-sound" label="Play a sound for new notifications" checked={prefs.sound}
              onChange={v => { set({ sound: v }); if (v) playNotificationSound(true) }} />
          </div>
        </SectionCard>

        <SectionCard icon="display_settings" title="Display" description="Changes preview immediately.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Table density</SectionLabel>
              <Choice value={prefs.table_density} onChange={v => set({ table_density: v })}
                options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
            </div>
            <div>
              <label htmlFor="pref-date"><SectionLabel>Date format</SectionLabel></label>
              <select id="pref-date" value={prefs.date_format} onChange={e => set({ date_format: e.target.value })} style={inp}>
                {DATE_FORMATS.map(f => (
                  <option key={f} value={f}>{f} — e.g. {previewDate(f)}</option>
                ))}
              </select>
            </div>
            <div>
              <SectionLabel>Text size</SectionLabel>
              <Choice value={prefs.font_size} onChange={v => set({ font_size: v })} options={FONT_SIZES} />
            </div>
          </div>
        </SectionCard>

        <SectionCard icon="shield" title="Security" description="Sign out automatically when you step away.">
          <label htmlFor="pref-timeout"><SectionLabel>Sign me out after inactivity</SectionLabel></label>
          <select id="pref-timeout" value={String(prefs.session_timeout)} onChange={e => set({ session_timeout: Number(e.target.value) })} style={inp}>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="480">8 hours</option>
          </select>
          <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 10 }}>
            Shared or site-office computers: pick a short time. To change your password, ask an administrator to reset it from Users & Roles.
          </div>
        </SectionCard>

        <SectionCard icon="accessibility_new" title="Accessibility" description="Make Bravura easier to read and use.">
          <Toggle id="pref-animations" label="Animations" hint="Turn off to stop motion and transitions" checked={prefs.animations}
            onChange={v => set({ animations: v })} />
          <Toggle id="pref-contrast" label="High contrast" hint="Stronger text and borders, useful in bright sunlight" checked={prefs.high_contrast}
            onChange={v => set({ high_contrast: v })} />
          <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 10 }}>
            Keyboard shortcuts: ⌘K / Ctrl+K opens the command palette, Esc closes dialogs.
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

function previewDate(fmt) {
  if (fmt === 'MM/DD/YYYY') return '12/31/2026'
  if (fmt === 'YYYY-MM-DD') return '2026-12-31'
  return '31/12/2026'
}
