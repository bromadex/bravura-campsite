import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { useAuth } from '../../auth/AuthContext'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, Section, bigBtn, field, label, uploadEssPhoto } from './shared'

const FAULTS = [['plumbing', 'Plumbing / water'], ['electrical', 'Lights / power'], ['aircon_heating', 'Aircon / heating'],
  ['door_lock', 'Door / lock'], ['furniture', 'Bed / furniture'], ['cleaning', 'Cleaning'], ['pests', 'Pests'], ['other', 'Other']]
const FAULT = Object.fromEntries(FAULTS)

export default function MyCamp() {
  const { me, loading } = useMe()
  const { profile } = useAuth()
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [meal, setMeal] = useState({ day: 0, b: false, l: false, s: false })

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('ess_my_camp')
    if (error) showToast(error.message, 'red')
    setData(d || {})
  }, [])
  useEffect(() => { if (me?.linked) load() }, [me?.linked, load])

  async function report() {
    setBusy(true)
    try {
      const photo = form.file ? await uploadEssPhoto(form.file, me.site_id, profile.id) : null
      const { error } = await supabase.rpc('ess_report_room_fault', { p_category: form.category, p_description: form.description || '', p_photo_path: photo })
      if (error) throw error
      showToast('Reported — camp management has been notified', 'green')
      setForm(null); load()
    } catch (err) { showToast(err.message, 'red') }
    setBusy(false)
  }

  async function logMeals() {
    const d = new Date(); d.setDate(d.getDate() - meal.day)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setBusy(true)
    const { error } = await supabase.rpc('ess_log_meals', { p_date: date, p_breakfast: meal.b, p_lunch: meal.l, p_supper: meal.s })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Meals recorded', 'green')
    setMeal({ day: meal.day, b: false, l: false, s: false }); load()
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />
  if (!data) return <Loading />

  const room = data.room
  const meals = data.meals || []
  const count = k => meals.filter(m => m[k]).length

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Camp" />
      <Card style={{ padding: '16px', marginBottom: '14px' }}>
        {room ? (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <Icon name="bed" size={28} style={{ color: ME_COLOR }} />
            <div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>Room {room.room_number}{room.bed ? ` · bed ${room.bed}` : ''}</div>
              <div style={{ fontSize: '13px', color: THEME.textMed }}>{[room.block, room.room_type].filter(Boolean).join(' · ')} · since {fmtDate(room.check_in)}{room.check_out ? ` until ${fmtDate(room.check_out)}` : ''}</div>
              {room.roommates?.length > 0 && <div style={{ fontSize: '13px', color: THEME.textMed }}>Sharing with {room.roommates.join(', ')}</div>}
            </div>
          </div>
        ) : <div style={{ fontSize: '13px', color: THEME.textLow }}>You aren't assigned to a camp room.</div>}
      </Card>

      {room && (!form ? (
        <button style={{ ...bigBtn(ME_COLOR), width: '100%', marginBottom: '16px' }} onClick={() => setForm({ category: 'plumbing', description: '', file: null })}>
          <Icon name="build" size={20} /> Report a room problem
        </button>
      ) : (
        <Card style={{ padding: '16px', display: 'grid', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label htmlFor="rf-cat" style={label}>What's wrong</label>
            <select id="rf-cat" style={field} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {FAULTS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rf-desc" style={label}>Details</label>
            <textarea id="rf-desc" rows={3} style={{ ...field, minHeight: '80px', resize: 'vertical' }} value={form.description} placeholder="e.g. Shower tap leaking since Monday" onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <label htmlFor="rf-photo" style={label}>Photo (optional)</label>
            <input id="rf-photo" type="file" accept="image/*" capture="environment" style={{ ...field, padding: '8px' }} onChange={e => setForm({ ...form, file: e.target.files?.[0] || null })} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...bigBtn(THEME.surfaceVar, THEME.text), flex: 1 }} onClick={() => setForm(null)}>Cancel</button>
            <button style={{ ...bigBtn(ME_COLOR), flex: 2, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={report}>Send</button>
          </div>
        </Card>
      ))}

      {data.faults?.length > 0 && (
        <Section title="My reported problems">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {data.faults.map((f, i) => (
              <div key={i} style={{ padding: '10px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', display: 'flex', gap: '10px' }}>
                <div style={{ flex: 1, fontSize: '14px', color: THEME.text }}>{FAULT[f.category] || f.category}
                  <div style={{ fontSize: '12px', color: THEME.textMed }}>{f.description}</div>
                  {f.resolution_notes && <div style={{ fontSize: '12px', color: THEME.statusSuccessText }}>{f.resolution_notes}</div>}
                </div>
                <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'capitalize', color: ['resolved', 'closed'].includes(f.status) ? THEME.statusSuccessText : THEME.statusWarningText }}>{f.status.replace('_', ' ')}</span>
              </div>
            ))}
          </Card>
        </Section>
      )}

      <Section title="Record meals I ate">
        <Card style={{ padding: '14px', display: 'grid', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[[0, 'Today'], [1, 'Yesterday']].map(([v, t]) => (
              <button key={v} aria-pressed={meal.day === v} onClick={() => setMeal({ ...meal, day: v })} style={{
                flex: 1, minHeight: '40px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600,
                border: `1px solid ${meal.day === v ? ME_COLOR : THEME.outline}`, background: meal.day === v ? ME_COLOR + '14' : THEME.surface,
                color: meal.day === v ? ME_COLOR : THEME.textMed }}>{t}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {[['b', 'Breakfast'], ['l', 'Lunch'], ['s', 'Supper']].map(([k, t]) => (
              <label key={k} htmlFor={`ml-${k}`} style={{ flex: '1 1 90px', display: 'flex', alignItems: 'center', gap: '8px', minHeight: '44px', padding: '0 12px',
                borderRadius: '10px', border: `1px solid ${meal[k] ? ME_COLOR : THEME.outlineVar}`, cursor: 'pointer', fontSize: '14px', color: THEME.text }}>
                <input id={`ml-${k}`} type="checkbox" checked={meal[k]} onChange={e => setMeal({ ...meal, [k]: e.target.checked })} /> {t}
              </label>
            ))}
          </div>
          <button style={{ ...bigBtn(ME_COLOR), opacity: busy || !(meal.b || meal.l || meal.s) ? 0.6 : 1 }}
            disabled={busy || !(meal.b || meal.l || meal.s)} onClick={logMeals}>Save meals</button>
          <div style={{ fontSize: '12px', color: THEME.textLow }}>Only today or yesterday. Meals are marked as self-recorded for the canteen to check.</div>
        </Card>
      </Section>

      <Section title="My meals — last 30 days">
        {meals.length === 0 ? (
          <Card style={{ padding: '14px', fontSize: '13px', color: THEME.textLow }}>No meals recorded.</Card>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
              {[['b', 'Breakfasts'], ['l', 'Lunches'], ['s', 'Suppers']].map(([k, t]) => (
                <Card key={k} style={{ padding: '8px 12px', flex: '1 1 90px' }}>
                  <div style={{ fontSize: '11px', color: THEME.textMed }}>{t}</div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{count(k)}</div>
                </Card>
              ))}
            </div>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {meals.slice(0, 14).map((m, i) => (
                <div key={m.date} style={{ padding: '6px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', display: 'flex', gap: '10px', fontSize: '13px' }}>
                  <span style={{ width: '96px', color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(m.date)}</span>
                  {[['b', 'B'], ['l', 'L'], ['s', 'S']].map(([k, t]) => (
                    <span key={k} style={{ width: '22px', textAlign: 'center', color: m[k] ? ME_COLOR : THEME.outlineVar, fontWeight: 700 }} title={m[k] ? 'Eaten' : 'Not eaten'}>{t}</span>
                  ))}
                </div>
              ))}
            </Card>
          </>
        )}
      </Section>
    </div>
  )
}
