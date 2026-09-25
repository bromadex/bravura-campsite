import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { useSite } from '../contexts/SiteContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { THEME, MODULE_COLORS } from '../utils/permissions'
import { Card, Icon, Button, Modal, showToast } from './ui'

const ACCENT = MODULE_COLORS.notifications || '#F57C00'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const sel = { minHeight: '36px', padding: '6px 8px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit', fontSize: '13px' }
const TONE = { bad: THEME.error, warn: THEME.statusWarningText }

// Subscribe to scheduled report emails for the current site (My Preferences).
export default function EmailReports() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const [catalog, setCatalog] = useState([])
  const [subs, setSubs] = useState({})
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    if (!profile?.id || !currentSiteId) return
    const [c, s] = await Promise.all([
      supabase.rpc('report_catalog'),
      supabase.from('report_subscriptions').select('*').eq('user_id', profile.id).eq('site_id', currentSiteId),
    ])
    setCatalog((c.data || []).filter(r => !r.permission || can(r.permission)))
    setSubs(Object.fromEntries((s.data || []).map(x => [x.report_code, x])))
  }, [profile?.id, currentSiteId, can])
  useEffect(() => { load() }, [load])

  async function toggle(r, on) {
    const existing = subs[r.code]
    const { error } = existing
      ? await supabase.from('report_subscriptions').update({ is_active: on }).eq('id', existing.id)
      : await supabase.from('report_subscriptions').insert({ user_id: profile.id, site_id: currentSiteId, report_code: r.code,
          frequency: r.default_frequency, weekday: 1, hour_local: 6, is_active: true })
    if (error) { showToast(error.message, 'red'); return }
    load()
  }
  async function update(r, patch) {
    const { error } = await supabase.from('report_subscriptions').update(patch).eq('id', subs[r.code].id)
    if (error) { showToast(error.message, 'red'); return }
    load()
  }
  async function openPreview(r) {
    setPreview({ loading: true, title: r.title })
    const { data, error } = await supabase.rpc('report_preview', { p_code: r.code, p_site_id: currentSiteId })
    if (error) { showToast(error.message, 'red'); setPreview(null); return }
    setPreview(data)
  }

  return (
    <Card style={{ padding: '18px', marginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <Icon name="forward_to_inbox" size={20} style={{ color: ACCENT }} />
        <div style={{ fontSize: '15px', fontWeight: 700, color: THEME.text }}>Email reports</div>
      </div>
      <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '12px' }}>
        Get a summary for {currentSite?.name || 'this site'} emailed to {profile?.email || 'you'} (times are Zimbabwe time). Only reports you have access to are listed.
      </div>
      <div style={{ display: 'grid', gap: '10px' }}>
        {catalog.map(r => {
          const s = subs[r.code]
          const on = !!s?.is_active
          return (
            <div key={r.code} style={{ border: `1px solid ${on ? ACCENT : THEME.outlineVar}`, borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <label htmlFor={`rep-${r.code}`} style={{ flex: 1, cursor: 'pointer' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{r.title}</div>
                  <div style={{ fontSize: '12px', color: THEME.textMed }}>{r.description}</div>
                </label>
                <button onClick={() => openPreview(r)} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px', whiteSpace: 'nowrap' }}>Preview</button>
                <input id={`rep-${r.code}`} type="checkbox" checked={on} onChange={e => toggle(r, e.target.checked)} style={{ width: '20px', height: '20px', accentColor: ACCENT }} />
              </div>
              {on && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap', alignItems: 'center', fontSize: '13px', color: THEME.textMed }}>
                  <select aria-label="How often" style={sel} value={s.frequency} onChange={e => update(r, { frequency: e.target.value })}>
                    <option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month (1st)</option>
                  </select>
                  {s.frequency === 'weekly' && <>on <select aria-label="Day" style={sel} value={s.weekday} onChange={e => update(r, { weekday: Number(e.target.value) })}>
                    {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></>}
                  at <select aria-label="Time" style={sel} value={s.hour_local} onChange={e => update(r, { hour_local: Number(e.target.value) })}>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</select>
                  {s.last_sent_at && <span style={{ fontSize: '12px', color: THEME.textLow }}>Last sent {new Date(s.last_sent_at).toLocaleString()}</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.title || 'Preview'} maxWidth={560}
        footer={<Button onClick={() => setPreview(null)}>Close</Button>}>
        {preview?.loading ? <div style={{ color: THEME.textLow }}>Building…</div> : preview && (
          <div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>{preview.site} · {preview.period}</div>
            {(preview.sections || []).map(s => (
              <div key={s.heading} style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: ACCENT, marginBottom: '4px' }}>{s.heading}</div>
                {(s.items || []).map(i => (
                  <div key={i.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '3px 0', color: THEME.text }}>
                    <span style={{ color: THEME.textMed }}>{i.label}</span><b style={{ color: TONE[i.tone] || THEME.text }}>{i.value}</b>
                  </div>
                ))}
                {s.columns && (s.rows?.length ? (
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead><tr>{s.columns.map((c, i) => <th key={c} style={{ textAlign: i ? 'right' : 'left', color: THEME.textMed, padding: '3px 2px' }}>{c}</th>)}</tr></thead>
                    <tbody>{s.rows.map((row, ri) => <tr key={ri}>{row.map((v, i) => <td key={i} style={{ textAlign: i ? 'right' : 'left', padding: '3px 2px', borderTop: `1px solid ${THEME.outlineVar}` }}>{v}</td>)}</tr>)}</tbody>
                  </table>
                ) : <div style={{ fontSize: '12px', color: THEME.textLow }}>Nothing to report.</div>)}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Card>
  )
}
