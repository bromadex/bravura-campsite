import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { Card, Button, showToast } from '../components/ui'
import { THEME } from '../utils/permissions'

export default function Settings() {
  const [cfg,     setCfg]     = useState({ company_name: '', site_name: '', supervisor_name: '', provider_name: '' })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    supabase.from('config').select('*').then(({ data }) => {
      const obj = {}
      data?.forEach(row => { obj[row.key] = row.value })
      setCfg(c => ({ ...c, ...obj }))
      setLoading(false)
    })
  }, [])

  async function saveSettings() {
    setSaving(true)
    try {
      const updates = Object.entries(cfg).map(([key, value]) => ({ key, value }))
      for (const u of updates) {
        const { error } = await supabase.from('config').upsert(u, { onConflict: 'key' })
        if (error) throw error
      }
      showToast('Settings saved', 'green')
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { key: 'company_name',    label: 'Company / Organisation Name', placeholder: 'e.g. Bravura Zimbabwe Ltd' },
    { key: 'site_name',       label: 'Site / Location',             placeholder: 'e.g. Kamativi Mine Site' },
    { key: 'supervisor_name', label: 'Supervisor Name',             placeholder: 'e.g. Eng. C. Katsande' },
    { key: 'provider_name',   label: 'Food Provider',               placeholder: 'e.g. Catering Company' },
  ]

  return (
    <div style={{ maxWidth: '540px' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '17px', fontWeight: 700 }}>Settings</h2>

      <Card style={{ marginBottom: '16px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textMed, marginBottom: '16px' }}>
          Organisation
        </div>
        {loading ? (
          <div style={{ color: THEME.textMed }}>Loading…</div>
        ) : (
          fields.map(f => (
            <div key={f.key} style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {f.label}
              </label>
              <input
                type="text"
                value={cfg[f.key]}
                onChange={e => setCfg(c => ({ ...c, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          ))
        )}
        <div style={{ marginTop: '4px' }}>
          <Button onClick={saveSettings} variant="primary" disabled={saving}>
            {saving ? 'Saving…' : '💾 Save settings'}
          </Button>
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textMed, marginBottom: '12px' }}>
          System Info
        </div>
        <div style={{ fontSize: '13px', color: THEME.textMed, lineHeight: 1.7 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' }}>
            <span>Version</span><strong>2.0.0</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' }}>
            <span>Database</span><strong>Supabase (PostgreSQL)</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eee' }}>
            <span>Hosting</span><strong>Vercel</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>Frontend</span><strong>React 19 + Vite</strong>
          </div>
        </div>
        <div style={{ marginTop: '14px', padding: '12px', background: THEME.surfaceVar, borderRadius: '8px', fontSize: '12px', color: THEME.textMed, lineHeight: 1.6 }}>
          <strong>Data storage:</strong> All data is stored in Supabase cloud database with row-level security. Data is accessible from any device with internet access and an authorised account.
        </div>
      </Card>
    </div>
  )
}
