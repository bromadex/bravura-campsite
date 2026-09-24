import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, MONTHS, field, bigBtn } from './shared'

const pad = n => String(n).padStart(2, '0')
const hhmm = t => (t ? String(t).slice(11, 16) || String(t).slice(0, 5) : '—')

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This phone cannot share its location')); return }
    navigator.geolocation.getCurrentPosition(resolve,
      err => reject(new Error(err.code === 1 ? 'Allow location access to clock in' : 'Could not get your location — try again outside')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  })
}

function TodayCard() {
  const [today, setToday] = useState(null)
  const [roster, setRoster] = useState([])
  const [busy, setBusy] = useState(false)
  const load = () => {
    supabase.rpc('ess_today').then(({ data }) => setToday(data || {}))
    const from = new Date().toISOString().slice(0, 10)
    const to = new Date(Date.now() + 13 * 86400000).toISOString().slice(0, 10)
    supabase.rpc('ess_my_roster', { p_from: from, p_to: to }).then(({ data }) => setRoster(data || []))
  }
  useEffect(load, [])

  async function clock(action) {
    setBusy(true)
    try {
      const pos = await getPosition()
      const { data, error } = await supabase.rpc('ess_clock', {
        p_action: action, p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: pos.coords.accuracy,
      })
      if (error) throw error
      showToast(action === 'in' ? `Clocked in${data.late ? ' (late)' : ''}` : `Clocked out — ${Number(data.hours).toFixed(1)} h`, 'green')
      load()
    } catch (err) { showToast(err.message, 'red') }
    setBusy(false)
  }

  if (!today) return null
  const inAt = today.clocked_in_at && new Date(today.clocked_in_at)
  return (
    <>
      <Card style={{ padding: '16px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, color: THEME.text }}>Today</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>
            {today.shift ? `${today.shift.name} · ${String(today.shift.start).slice(0, 5)}–${String(today.shift.end).slice(0, 5)}` : 'No shift rostered'}
          </div>
        </div>
        {!today.site_located ? (
          <div style={{ fontSize: '13px', color: THEME.textMed }}>Phone clock-in isn't set up for {today.site_name} yet. Your supervisor records your attendance.</div>
        ) : inAt ? (
          <>
            <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '10px' }}>Clocked in at <b style={{ color: THEME.text }}>{inAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></div>
            <button style={{ ...bigBtn('#37474F'), width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => clock('out')}>
              <Icon name="logout" size={20} /> {busy ? 'Getting your location…' : 'Clock out'}
            </button>
          </>
        ) : today.done_today ? (
          <div style={{ fontSize: '13px', color: THEME.statusSuccessText }}>You've clocked in and out today.</div>
        ) : (
          <button style={{ ...bigBtn(ME_COLOR), width: '100%', opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => clock('in')}>
            <Icon name="login" size={20} /> {busy ? 'Getting your location…' : 'Clock in'}
          </button>
        )}
        {today.site_located && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '8px' }}>Works only within {Number(today.geofence_m).toLocaleString()} m of {today.site_name}. Your location is saved only when you clock in or out.</div>}
      </Card>
      {roster.length > 0 && (
        <Card style={{ padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>My roster (next 2 weeks)</div>
          {roster.map((r, i) => (
            <div key={i} style={{ fontSize: '13px', color: THEME.textMed, padding: '3px 0' }}>
              <b style={{ color: THEME.text }}>{r.shift_name}</b> {String(r.start_time).slice(0, 5)}–{String(r.end_time).slice(0, 5)}{r.is_night_shift ? ' (night)' : ''}
              {' · '}{fmtDate(r.start_date)}{r.end_date ? ` to ${fmtDate(r.end_date)}` : ' onwards'}
            </div>
          ))}
        </Card>
      )}
    </>
  )
}

export default function MyAttendance() {
  const { me, loading } = useMe()
  const now = new Date()
  const [ym, setYm] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    if (!me?.linked) return
    const [y, m] = ym.split('-').map(Number)
    const from = `${y}-${pad(m)}-01`
    const to = `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`
    setRows(null)
    supabase.rpc('ess_my_attendance', { p_from: from, p_to: to }).then(({ data, error }) => {
      if (error) showToast(error.message, 'red')
      setRows(data || [])
    })
  }, [me?.linked, ym])

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />

  const present = (rows || []).filter(r => !r.is_absent).length
  const absent = (rows || []).filter(r => r.is_absent).length
  const late = (rows || []).filter(r => r.is_late).length
  const hours = (rows || []).reduce((s, r) => s + Number(r.hours_worked || 0), 0)
  const ot = (rows || []).reduce((s, r) => s + Number(r.overtime_hours || 0), 0)
  const [y, m] = ym.split('-').map(Number)

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Time" />
      <TodayCard />
      <label htmlFor="ma-month" style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Month</label>
      <input id="ma-month" type="month" style={{ ...field, maxWidth: '220px', marginBottom: '14px' }} value={ym} onChange={e => e.target.value && setYm(e.target.value)} />

      {!rows ? <Loading /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px', marginBottom: '14px' }}>
            {[['Days present', present], ['Absent', absent], ['Late', late], ['Hours', hours.toFixed(1)], ['Overtime', ot.toFixed(1)]].map(([l, v]) => (
              <Card key={l} style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{l}</div>
                <div style={{ fontSize: '18px', fontWeight: 700, color: l === 'Absent' && Number(v) > 0 ? THEME.error : THEME.text, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              </Card>
            ))}
          </div>
          {rows.length === 0 ? (
            <Card style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
              No attendance recorded for {MONTHS[m - 1]} {y}. Your supervisor records attendance on site.
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {rows.map((r, i) => (
                <div key={r.date} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
                  borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', fontSize: '14px' }}>
                  <span style={{ width: '96px', color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(r.date)}</span>
                  {r.is_absent ? (
                    <span style={{ color: THEME.error, fontWeight: 600, flex: 1 }}>Absent</span>
                  ) : (
                    <span style={{ flex: 1, color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>
                      {hhmm(r.clock_in)} – {hhmm(r.clock_out)}
                      {r.is_late && <span style={{ color: THEME.statusWarningText, marginLeft: '6px' }}>late</span>}
                    </span>
                  )}
                  <span style={{ color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{r.is_absent ? '' : `${Number(r.hours_worked || 0).toFixed(1)} h`}</span>
                  {Number(r.overtime_hours) > 0 && <span style={{ fontSize: '12px', color: ME_COLOR }}>+{Number(r.overtime_hours).toFixed(1)} OT</span>}
                </div>
              ))}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
