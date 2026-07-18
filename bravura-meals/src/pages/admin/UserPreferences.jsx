import { useState, useEffect } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { THEME } from '../../utils/permissions'
import { Card, Icon, Button, SectionLabel, PageHeader, showToast } from '../../components/ui'

const MODULES = [
  { key: 'meals', label: 'Meals' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'fleet', label: 'Fleet' },
  { key: 'hr', label: 'HR' },
  { key: 'contractors', label: 'Contractors' },
]

const LANDING_OPTIONS = [
  { value: '', label: 'Home Launcher (default)' },
  { value: 'meals', label: 'Meals' },
  { value: 'fuel', label: 'Fuel' },
  { value: 'fleet', label: 'Fleet' },
  { value: 'campsite', label: 'Campsite' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'workforce', label: 'HR' },
  { value: 'admin', label: 'Admin' },
  { value: 'contractors', label: 'Contractors' },
]

const DATE_FORMATS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
  { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
]

const ACCENT = '#5C6BC0'

function loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback }
  catch { return fallback }
}

export default function UserPreferences() {
  const { profile } = useAuth()

  const [notifPrefs, setNotifPrefs] = useState(() => loadPref('notification_prefs', { meals: true, fuel: true, inventory: true, fleet: true, hr: true, contractors: true }))
  const [landingPage, setLandingPage] = useState(() => localStorage.getItem('default_landing') || '')
  const [tableDensity, setTableDensity] = useState(() => localStorage.getItem('table_density') || 'comfortable')
  const [dateFormat, setDateFormat] = useState(() => localStorage.getItem('date_format') || 'DD/MM/YYYY')

  function handleSave() {
    localStorage.setItem('notification_prefs', JSON.stringify(notifPrefs))
    localStorage.setItem('default_landing', landingPage)
    localStorage.setItem('table_density', tableDensity)
    localStorage.setItem('date_format', dateFormat)
    showToast('Preferences saved', 'green')
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  return (
    <div>
      <PageHeader title="My Preferences" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
        {/* Profile Info */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="person" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Profile</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <SectionLabel>Full Name</SectionLabel>
              <input value={profile?.full_name || ''} readOnly style={{ ...inp, background: THEME.surfaceVar, cursor: 'default' }} />
            </div>
            <div>
              <SectionLabel>Email</SectionLabel>
              <input value={profile?.email || ''} readOnly style={{ ...inp, background: THEME.surfaceVar, cursor: 'default' }} />
            </div>
            <div style={{ fontSize: '11px', color: THEME.textLow }}>Profile details are managed by your administrator.</div>
          </div>
        </Card>

        {/* Notification Preferences */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="notifications" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Notification Preferences</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {MODULES.map(m => (
              <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', color: THEME.text }}>
                <input
                  type="checkbox"
                  checked={notifPrefs[m.key] !== false}
                  onChange={e => setNotifPrefs({ ...notifPrefs, [m.key]: e.target.checked })}
                  style={{ width: '16px', height: '16px', accentColor: ACCENT }}
                />
                {m.label}
              </label>
            ))}
          </div>
          <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '12px' }}>
            Server-side notification preferences table coming in a future release. Currently stored in browser only.
          </div>
        </Card>

        {/* Default Landing Page */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="home" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Default Landing Page</div>
          </div>
          <SectionLabel>Module to open on login</SectionLabel>
          <select value={landingPage} onChange={e => setLandingPage(e.target.value)} style={inp}>
            {LANDING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Card>

        {/* Display Settings */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="display_settings" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Display Settings</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <SectionLabel>Table Density</SectionLabel>
              <select value={tableDensity} onChange={e => setTableDensity(e.target.value)} style={inp}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
            <div>
              <SectionLabel>Date Format</SectionLabel>
              <select value={dateFormat} onChange={e => setDateFormat(e.target.value)} style={inp}>
                {DATE_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: '20px' }}>
        <Button variant="filled" onClick={handleSave}>Save Preferences</Button>
      </div>
    </div>
  )
}
