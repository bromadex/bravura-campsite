import { useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.admin || '#5C6BC0'

const MODULES = [
  { key: 'meals', label: 'Meals', icon: 'restaurant' },
  { key: 'fuel', label: 'Fuel', icon: 'local_gas_station' },
  { key: 'inventory', label: 'Inventory', icon: 'inventory_2' },
  { key: 'fleet', label: 'Fleet', icon: 'directions_car' },
  { key: 'hr', label: 'HR', icon: 'badge' },
  { key: 'contractors', label: 'Contractors', icon: 'engineering' },
  { key: 'finance', label: 'Finance', icon: 'account_balance' },
  { key: 'procurement', label: 'Procurement', icon: 'shopping_cart' },
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
  { value: 'admin', label: 'Admin' },
  { value: 'contractors', label: 'Contractors' },
  { value: 'concrete', label: 'Concrete Operations' },
]

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2026)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2026)' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-12-31)' },
]

const TIME_FORMATS = [
  { value: '24h', label: '24-hour (14:30)' },
  { value: '12h', label: '12-hour (2:30 PM)' },
]

const FONT_SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
]

function loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback }
  catch { return fallback }
}

function Toggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '8px 0' }}>
      <span style={{ fontSize: 13, color: THEME.text }}>{label}</span>
      <div
        onClick={(e) => { e.preventDefault(); onChange(!checked) }}
        style={{
          width: 40, height: 22, borderRadius: 11, position: 'relative', cursor: 'pointer',
          background: checked ? ACCENT : THEME.outline,
          transition: 'background .2s',
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: 9, position: 'absolute', top: 2,
          left: checked ? 20 : 2, background: '#fff',
          transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </div>
    </label>
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
      {description && (
        <div style={{ fontSize: 12, color: THEME.textMed, marginBottom: 16, paddingLeft: 46 }}>{description}</div>
      )}
      {children}
    </Card>
  )
}

export default function UserPreferences({ setPage }) {
  const { profile } = useAuth()

  const [notifPrefs, setNotifPrefs] = useState(() => loadPref('notification_prefs', { meals: true, fuel: true, inventory: true, fleet: true, hr: true, contractors: true, finance: true, procurement: true }))
  const [landingPage, setLandingPage] = useState(() => localStorage.getItem('default_landing') || '')
  const [tableDensity, setTableDensity] = useState(() => localStorage.getItem('table_density') || 'comfortable')
  const [dateFormat, setDateFormat] = useState(() => localStorage.getItem('date_format') || 'DD/MM/YYYY')
  const [timeFormat, setTimeFormat] = useState(() => localStorage.getItem('time_format') || '24h')
  const [fontSize, setFontSize] = useState(() => localStorage.getItem('font_size') || 'default')
  const [animationsEnabled, setAnimationsEnabled] = useState(() => loadPref('animations_enabled', true))
  const [highContrast, setHighContrast] = useState(() => loadPref('high_contrast', false))
  const [soundEnabled, setSoundEnabled] = useState(() => loadPref('sound_enabled', false))
  const [sessionTimeout, setSessionTimeout] = useState(() => localStorage.getItem('session_timeout') || '60')

  function handleSave() {
    localStorage.setItem('notification_prefs', JSON.stringify(notifPrefs))
    localStorage.setItem('default_landing', landingPage)
    localStorage.setItem('table_density', tableDensity)
    localStorage.setItem('date_format', dateFormat)
    localStorage.setItem('time_format', timeFormat)
    localStorage.setItem('font_size', fontSize)
    localStorage.setItem('animations_enabled', JSON.stringify(animationsEnabled))
    localStorage.setItem('high_contrast', JSON.stringify(highContrast))
    localStorage.setItem('sound_enabled', JSON.stringify(soundEnabled))
    localStorage.setItem('session_timeout', sessionTimeout)
    showToast('Preferences saved', 'green')
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text, height: 40 }

  return (
    <div>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_preferences" />
      <PageHeader title="My Preferences" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {/* Profile */}
        <SectionCard icon="person" title="Profile" description="Your account details are managed by your administrator.">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: THEME.surfaceVar, borderRadius: 10, marginBottom: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: ACCENT + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: ACCENT }}>
                {(profile?.full_name || 'U').charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: THEME.text }}>{profile?.full_name || 'User'}</div>
              <div style={{ fontSize: 12, color: THEME.textMed }}>{profile?.email || ''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <SectionLabel>Default Landing Page</SectionLabel>
              <select value={landingPage} onChange={e => setLandingPage(e.target.value)} style={inp}>
                {LANDING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        </SectionCard>

        {/* Notifications */}
        <SectionCard icon="notifications" title="Notifications" description="Choose which module notifications you receive.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {MODULES.map(m => (
              <div key={m.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon name={m.icon} size={16} style={{ color: THEME.textMed }} />
                  <span style={{ fontSize: 13, color: THEME.text }}>{m.label}</span>
                </div>
                <div
                  onClick={() => setNotifPrefs(p => ({ ...p, [m.key]: !p[m.key] }))}
                  style={{
                    width: 36, height: 20, borderRadius: 10, position: 'relative', cursor: 'pointer',
                    background: notifPrefs[m.key] !== false ? ACCENT : THEME.outline, transition: 'background .2s',
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: 8, position: 'absolute', top: 2,
                    left: notifPrefs[m.key] !== false ? 18 : 2, background: '#fff',
                    transition: 'left .2s', boxShadow: '0 1px 2px rgba(0,0,0,.15)',
                  }} />
                </div>
              </div>
            ))}
          </div>
          <Toggle checked={soundEnabled} onChange={setSoundEnabled} label="Notification sounds" />
          <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 6 }}>
            Stored in browser. Server-side notification preferences coming in a future release.
          </div>
        </SectionCard>

        {/* Display */}
        <SectionCard icon="display_settings" title="Display" description="Customise how data is presented.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Table Density</SectionLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                {['comfortable', 'compact'].map(d => (
                  <button key={d} onClick={() => setTableDensity(d)} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13, fontWeight: 600, textTransform: 'capitalize',
                    border: `1px solid ${tableDensity === d ? ACCENT : THEME.outline}`,
                    background: tableDensity === d ? ACCENT + '12' : THEME.surface,
                    color: tableDensity === d ? ACCENT : THEME.textMed,
                  }}>{d}</button>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Date Format</SectionLabel>
              <select value={dateFormat} onChange={e => setDateFormat(e.target.value)} style={inp}>
                {DATE_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Time Format</SectionLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                {TIME_FORMATS.map(f => (
                  <button key={f.value} onClick={() => setTimeFormat(f.value)} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13, fontWeight: 600,
                    border: `1px solid ${timeFormat === f.value ? ACCENT : THEME.outline}`,
                    background: timeFormat === f.value ? ACCENT + '12' : THEME.surface,
                    color: timeFormat === f.value ? ACCENT : THEME.textMed,
                  }}>{f.label}</button>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Font Size</SectionLabel>
              <div style={{ display: 'flex', gap: 8 }}>
                {FONT_SIZES.map(f => (
                  <button key={f.value} onClick={() => setFontSize(f.value)} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 13, fontWeight: 600,
                    border: `1px solid ${fontSize === f.value ? ACCENT : THEME.outline}`,
                    background: fontSize === f.value ? ACCENT + '12' : THEME.surface,
                    color: fontSize === f.value ? ACCENT : THEME.textMed,
                  }}>{f.label}</button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Security */}
        <SectionCard icon="shield" title="Security" description="Session and security settings.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Session Timeout (minutes)</SectionLabel>
              <select value={sessionTimeout} onChange={e => setSessionTimeout(e.target.value)} style={inp}>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
                <option value="480">8 hours</option>
              </select>
            </div>
            <div style={{ padding: '12px 14px', background: THEME.surfaceVar, borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <Icon name="info" size={16} style={{ color: THEME.textMed }} />
              <span style={{ fontSize: 12, color: THEME.textMed }}>
                Password changes and two-factor authentication are managed through your Supabase account settings.
              </span>
            </div>
          </div>
        </SectionCard>

        {/* Accessibility */}
        <SectionCard icon="accessibility_new" title="Accessibility" description="Make Bravura work for you.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Toggle checked={animationsEnabled} onChange={setAnimationsEnabled} label="Enable animations" />
            <Toggle checked={highContrast} onChange={setHighContrast} label="High contrast mode" />
          </div>
          <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 10 }}>
            Keyboard shortcuts: ⌘K to open command palette, Esc to close dialogs.
          </div>
        </SectionCard>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
        <Button variant="filled" onClick={handleSave} style={{ background: ACCENT, borderColor: ACCENT }}>
          Save Preferences
        </Button>
        <Button variant="outlined" onClick={() => {
          if (confirm('Reset all preferences to defaults?')) {
            ['notification_prefs', 'default_landing', 'table_density', 'date_format', 'time_format', 'font_size', 'animations_enabled', 'high_contrast', 'sound_enabled', 'session_timeout'].forEach(k => localStorage.removeItem(k))
            window.location.reload()
          }
        }}>
          Reset to Defaults
        </Button>
      </div>
    </div>
  )
}
