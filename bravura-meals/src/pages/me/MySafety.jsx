import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, bigBtn, field, label, uploadEssPhoto, ExpiryPill, Section } from './shared'

const CATEGORIES = [
  ['electrical', 'Electrical'], ['mechanical', 'Machinery'], ['vehicle', 'Vehicle / traffic'], ['working_at_height', 'Working at height'],
  ['lifting', 'Lifting'], ['excavation', 'Excavation / ground'], ['fire', 'Fire'], ['chemical', 'Chemical'],
  ['housekeeping', 'Housekeeping / slip-trip'], ['ppe', 'PPE'], ['structural', 'Structural'], ['environmental', 'Environmental'], ['other', 'Other'],
]
const CAT = Object.fromEntries(CATEGORIES)
const PRIORITY = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical — stop work']]

function List({ rows, render, empty }) {
  if (!rows?.length) return <Card style={{ padding: '14px', fontSize: '13px', color: THEME.textLow }}>{empty}</Card>
  return <Card style={{ padding: 0, overflow: 'hidden' }}>{rows.map((r, i) => (
    <div key={i} style={{ padding: '10px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', display: 'flex', gap: '10px', alignItems: 'center' }}>{render(r)}</div>
  ))}</Card>
}

export default function MySafety() {
  const { me, loading } = useMe()
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [reports, setReports] = useState([])
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [s, h] = await Promise.all([supabase.rpc('ess_my_safety'), supabase.rpc('ess_my_hazards')])
    if (s.error) showToast(s.error.message, 'red')
    setData(s.data || {})
    setReports(h.data || [])
  }, [])
  useEffect(() => { if (me?.linked) load() }, [me?.linked, load])

  async function submit() {
    setBusy(true)
    try {
      const photo = form.file ? await uploadEssPhoto(form.file, me.site_id, profile.id) : null
      const { data: num, error } = await supabase.rpc('ess_report_hazard', {
        p_category: form.category, p_location: form.location || '', p_description: form.description || '',
        p_priority: form.priority, p_photo_path: photo, p_anonymous: !!form.anonymous,
      })
      if (error) throw error
      showToast(`Reported as ${num} — thank you. SHEQ has been notified.`, 'green')
      setForm(null); load()
    } catch (err) { showToast(err.message, 'red') }
    setBusy(false)
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Safety" />

      {!form ? (
        <button style={{ ...bigBtn('#C62828'), width: '100%', marginBottom: '16px' }}
          onClick={() => setForm({ category: 'other', priority: 'medium', location: '', description: '', anonymous: false, file: null })}>
          <Icon name="report" size={20} /> Report a hazard or near-miss
        </button>
      ) : (
        <Card style={{ padding: '16px', display: 'grid', gap: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>If anyone is in immediate danger, stop the work and tell your supervisor first.</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="hz-cat" style={label}>What kind of hazard</label>
              <select id="hz-cat" style={field} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hz-pri" style={label}>How serious</label>
              <select id="hz-pri" style={field} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                {PRIORITY.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="hz-loc" style={label}>Where</label>
            <input id="hz-loc" style={field} value={form.location} placeholder="e.g. Pit 3 ramp, workshop bay 2" onChange={e => setForm({ ...form, location: e.target.value })} />
          </div>
          <div>
            <label htmlFor="hz-desc" style={label}>What did you see?</label>
            <textarea id="hz-desc" rows={3} style={{ ...field, minHeight: '84px', resize: 'vertical' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label htmlFor="hz-photo" style={label}>Photo (optional)</label>
            <input id="hz-photo" type="file" accept="image/*" capture="environment" style={{ ...field, padding: '8px' }} onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: THEME.text, minHeight: '32px' }}>
            <input id="hz-anon" type="checkbox" checked={form.anonymous} onChange={e => setForm({ ...form, anonymous: e.target.checked })} style={{ width: 18, height: 18 }} />
            Report anonymously
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...bigBtn(THEME.surfaceVar, THEME.text), flex: 1 }} onClick={() => setForm(null)}>Cancel</button>
            <button style={{ ...bigBtn('#C62828'), flex: 2, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>{busy ? 'Sending…' : 'Send report'}</button>
          </div>
        </Card>
      )}

      {!data ? <Loading /> : (
        <>
          <Section title="My hazard reports">
            <List rows={reports} empty="You haven't reported anything yet. Anonymous reports don't appear here." render={r => (<>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: THEME.text, fontSize: '14px' }}>{r.report_number} · {CAT[r.category] || r.category}</div>
                <div style={{ fontSize: '12px', color: THEME.textMed, overflowWrap: 'anywhere' }}>{r.location} — {r.description}</div>
                {r.resolution_notes && <div style={{ fontSize: '12px', color: THEME.statusSuccessText }}>Fixed: {r.resolution_notes}</div>}
              </div>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'capitalize', color: r.status === 'open' ? THEME.statusWarningText : THEME.statusSuccessText }}>{r.status.replace('_', ' ')}</span>
            </>)} />
          </Section>

          <Section title="PPE issued to me">
            <List rows={data.ppe} empty="No PPE recorded." render={p => (<>
              <Icon name="engineering" size={18} style={{ color: ME_COLOR }} />
              <div style={{ flex: 1, fontSize: '14px', color: THEME.text }}>{p.item}{p.size ? ` · ${p.size}` : ''}<div style={{ fontSize: '12px', color: THEME.textLow }}>Issued {fmtDate(p.issued)}</div></div>
              <ExpiryPill date={p.replace_by} />
            </>)} />
          </Section>

          <Section title="Training & certificates">
            <List rows={data.training} empty="No training recorded." render={t => (<>
              <Icon name="school" size={18} style={{ color: ME_COLOR }} />
              <div style={{ flex: 1, fontSize: '14px', color: THEME.text }}>{t.course}<div style={{ fontSize: '12px', color: THEME.textLow }}>{[t.provider, t.completed && `completed ${fmtDate(t.completed)}`, t.certificate].filter(Boolean).join(' · ')}</div></div>
              <ExpiryPill date={t.expires} />
            </>)} />
          </Section>

          <Section title="Inductions">
            <List rows={data.inductions} empty="No inductions recorded." render={i => (<>
              <Icon name="badge" size={18} style={{ color: ME_COLOR }} />
              <div style={{ flex: 1, fontSize: '14px', color: THEME.text, textTransform: 'capitalize' }}>{(i.type || '').replace(/_/g, ' ')}<div style={{ fontSize: '12px', color: THEME.textLow }}>{fmtDate(i.date)}</div></div>
              <ExpiryPill date={i.expires} />
            </>)} />
          </Section>

          <Section title="Medical fitness">
            <List rows={data.medical} empty="No medicals recorded." render={m => (<>
              <Icon name="medical_services" size={18} style={{ color: ME_COLOR }} />
              <div style={{ flex: 1, fontSize: '14px', color: THEME.text, textTransform: 'capitalize' }}>{(m.exam || 'Medical').replace(/_/g, ' ')} · {(m.status || '').replace(/_/g, ' ')}
                <div style={{ fontSize: '12px', color: THEME.textLow, textTransform: 'none' }}>{fmtDate(m.date)}{m.restrictions ? ` · ${m.restrictions}` : ''}</div></div>
              <ExpiryPill date={m.expires} />
            </>)} />
          </Section>
        </>
      )}
    </div>
  )
}
