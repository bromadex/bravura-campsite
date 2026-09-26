import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import Denied from '../../components/Denied'

// FU10 — Fuel reconciliation (issue #70, F2). Three tabs:
//  Dips & gaps  — every dip vs the book (previous dip + moves); a gap over the tank's tolerance needs a reason
//                 (fuel.edit) and a sign-off (fuel.approve); a mistyped dip is corrected with a logged reason.
//  Pump shifts  — pump totaliser at open and close vs litres recorded on that pump.
//  Month-end    — net dip gaps per tank posted as a fuel loss / gain (Stores count + ledger) by fuel.approve.

const COLOR = MODULE_COLORS.fuel
const n1 = v => v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })
const money = v => v == null ? '—' : (Number(v) < 0 ? '−$' : '$') + Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const today = () => new Date().toISOString().slice(0, 10)
const daysAgo = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10)
const btn = (bg = COLOR, fg = '#fff') => ({ border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12, padding: '6px 12px', background: bg, color: fg })
const input = { padding: '7px 9px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: 13, fontFamily: 'inherit' }
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', fontSize: 13, color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}`, verticalAlign: 'top' }
const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

const STATUS = {
  ok:           ['Within tolerance', THEME.success || '#15803D'],
  needs_reason: ['Needs a reason', THEME.error || '#B91C1C'],
  explained:    ['Waiting sign-off', THEME.warning || '#B45309'],
  signed_off:   ['Signed off', THEME.primary || COLOR],
}
const Pill = ({ s }) => {
  const [label, c] = STATUS[s] || [s, THEME.textMed]
  return <span style={{ fontSize: 11, fontWeight: 600, color: c, border: `1px solid ${c}`, borderRadius: 10, padding: '1px 8px', whiteSpace: 'nowrap' }}>{label}</span>
}

async function run(p, ok) {
  const { data, error } = await p
  if (error) { alert(error.message); return null }
  ok && ok(data)
  return data ?? true
}

function DipsTab({ siteId, can }) {
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(today())
  const [only, setOnly] = useState('attention')
  const [rows, setRows] = useState(null)
  const load = useCallback(() => {
    supabase.rpc('fuel_recon_days', { p_site: siteId, p_from: from, p_to: to }).then(({ data, error }) => setRows(error ? [] : data || []))
  }, [siteId, from, to])
  useEffect(() => { load() }, [load])
  useRealtimeSubscription('fuel_dip_readings', { column: 'site_id', value: siteId }, load)

  const explain = async r => {
    const reason = window.prompt(`What caused the ${n1(r.gap_litres)} L gap on ${r.tank}, ${r.reading_date}?`, r.gap_reason || '')
    if (reason == null) return
    await run(supabase.rpc('fuel_dip_explain', { p_id: r.dip_id, p_reason: reason }), load)
  }
  const signOff = async r => { if (window.confirm(`Sign off the ${n1(r.gap_litres)} L gap on ${r.tank}?\nReason: ${r.gap_reason}`)) await run(supabase.rpc('fuel_dip_sign_off', { p_id: r.dip_id }), load) }
  const correct = async r => {
    const litres = window.prompt(`Correct litres for the ${r.tank} dip on ${r.reading_date} (now ${n1(r.dip_litres)} L)`, r.dip_litres)
    if (litres == null || litres === '') return
    const reason = window.prompt('Why is it being corrected? (kept in the log)')
    if (!reason) return
    await run(supabase.rpc('fuel_dip_correct', { p_id: r.dip_id, p_litres: Number(litres), p_mm: null, p_reason: reason }), load)
  }

  const list = (rows || []).filter(r => only === 'all' || ['needs_reason', 'explained'].includes(r.gap_status))
  const waiting = (rows || []).filter(r => r.gap_status === 'needs_reason').length
  const toSign = (rows || []).filter(r => r.gap_status === 'explained').length
  const net = (rows || []).reduce((s, r) => s + Number(r.gap_litres || 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input type="date" id="rec-from" value={from} onChange={e => setFrom(e.target.value)} style={input} />
        <span style={{ color: THEME.textMed }}>to</span>
        <input type="date" id="rec-to" value={to} onChange={e => setTo(e.target.value)} style={input} />
        <select id="rec-only" value={only} onChange={e => setOnly(e.target.value)} style={input}>
          <option value="attention">Needs attention</option><option value="all">All dips</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: THEME.textMed }}>
          <b style={{ color: waiting ? THEME.error : THEME.text }}>{waiting}</b> need a reason · <b>{toSign}</b> waiting sign-off ·
          net gap <b style={{ color: net < 0 ? THEME.error : THEME.text }}>{net > 0 ? '+' : ''}{n1(net)} L</b>
        </span>
      </div>
      {rows == null ? <div style={{ color: THEME.textMed }}>Loading…</div> : !list.length ? (
        <div style={{ padding: 24, textAlign: 'center', color: THEME.textMed, background: THEME.surface, borderRadius: 10 }}>
          {only === 'attention' ? 'Nothing needs attention in these dates.' : 'No dips in these dates.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto', background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Tank</th><th style={{ ...th, textAlign: 'right' }}>Dip (L)</th><th style={{ ...th, textAlign: 'right' }}>Book (L)</th>
              <th style={{ ...th, textAlign: 'right' }}>Gap (L)</th><th style={th}>State</th><th style={th}>Reason</th><th style={th}></th>
            </tr></thead>
            <tbody>{list.map(r => {
              const big = r.gap_litres != null && Math.abs(Number(r.gap_litres)) > Number(r.tolerance)
              return (
                <tr key={r.dip_id}>
                  <td style={td}>{r.reading_date}{r.reading_time ? ` ${String(r.reading_time).slice(0, 5)}` : ''}</td>
                  <td style={td}>{r.tank}</td>
                  <td style={num}>{n1(r.dip_litres)}{r.corrections > 0 && <div style={{ fontSize: 11, color: THEME.textLow }}>corrected ×{r.corrections}</div>}</td>
                  <td style={num}>{n1(r.book_litres)}</td>
                  <td style={{ ...num, color: big ? THEME.error : THEME.text, fontWeight: big ? 700 : 400 }}>
                    {r.gap_litres == null ? '—' : `${Number(r.gap_litres) > 0 ? '+' : ''}${n1(r.gap_litres)}`}
                    <div style={{ fontSize: 11, color: THEME.textLow, fontWeight: 400 }}>±{n1(r.tolerance)}</div>
                  </td>
                  <td style={td}><Pill s={r.gap_status} />{r.closed && <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 3 }}>Month closed</div>}</td>
                  <td style={{ ...td, maxWidth: 260 }}>{r.gap_reason || <span style={{ color: THEME.textLow }}>—</span>}
                    {(r.explained_by || r.signed_by) && <div style={{ fontSize: 11, color: THEME.textLow }}>{r.explained_by ? `by ${r.explained_by}` : ''}{r.signed_by ? ` · signed ${r.signed_by}` : ''}</div>}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {!r.closed && (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {can('fuel.edit') && r.gap_status !== 'ok' && r.gap_status !== 'signed_off' && <button style={btn()} onClick={() => explain(r)}>{r.gap_reason ? 'Change reason' : 'Add reason'}</button>}
                        {can('fuel.approve') && r.gap_status === 'explained' && <button style={btn(THEME.primary || COLOR)} onClick={() => signOff(r)}>Sign off</button>}
                        {can('fuel.edit') && <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => correct(r)}>Correct dip</button>}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ShiftsTab({ siteId, can }) {
  const [pumps, setPumps] = useState([])
  const [rows, setRows] = useState(null)
  const [pump, setPump] = useState('')
  const [reading, setReading] = useState('')
  const [shift, setShift] = useState('Day')
  const load = useCallback(() => {
    supabase.from('fuel_pumps').select('id, name, current_meter_reading').eq('site_id', siteId).eq('is_archived', false).order('name')
      .then(({ data }) => setPumps(data || []))
    supabase.rpc('fuel_shift_list', { p_site: siteId, p_from: daysAgo(30), p_to: today() }).then(({ data, error }) => setRows(error ? [] : data || []))
  }, [siteId])
  useEffect(() => { load() }, [load])

  const open = async () => {
    if (!pump || reading === '') return alert('Choose the pump and enter the meter reading')
    if (await run(supabase.rpc('fuel_shift_open', { p_pump: pump, p_reading: Number(reading), p_shift: shift }))) { setReading(''); load() }
  }
  const close = async s => {
    const r = window.prompt(`Closing meter reading for ${s.pump} (opened at ${n1(s.open_reading)})`)
    if (r == null || r === '') return
    let res = await run(supabase.rpc('fuel_shift_close', { p_id: s.id, p_reading: Number(r) }))
    if (res && res.needs_reason) {
      const why = window.prompt(`The pump gave ${n1(res.pump_litres)} L but ${n1(res.recorded_litres)} L are recorded (${n1(res.gap_litres)} L). Why?`)
      if (!why) return
      res = await run(supabase.rpc('fuel_shift_close', { p_id: s.id, p_reading: Number(r), p_reason: why }))
    }
    load()
  }

  return (
    <div>
      {can('fuel.create') && (
        pumps.length ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, background: THEME.surface, padding: 12, borderRadius: 10 }}>
            <b style={{ fontSize: 13 }}>Open a shift</b>
            <select id="shift-pump" value={pump} onChange={e => { setPump(e.target.value); const p = pumps.find(x => x.id === e.target.value); setReading(p?.current_meter_reading ?? '') }} style={input}>
              <option value="">Pump…</option>{pumps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select id="shift-name" value={shift} onChange={e => setShift(e.target.value)} style={input}><option>Day</option><option>Night</option></select>
            <input id="shift-reading" type="number" placeholder="Meter reading" value={reading} onChange={e => setReading(e.target.value)} style={{ ...input, width: 150 }} />
            <button style={btn()} onClick={open}>Open shift</button>
          </div>
        ) : (
          <div style={{ padding: 12, marginBottom: 12, background: THEME.surface, borderRadius: 10, fontSize: 13, color: THEME.textMed }}>
            No pumps are set up for this site yet. Add the pump on the tank's page (Fuel Tanks) to read its meter at shift open and close.
          </div>
        )
      )}
      {rows == null ? <div style={{ color: THEME.textMed }}>Loading…</div> : !rows.length ? (
        <div style={{ padding: 24, textAlign: 'center', color: THEME.textMed, background: THEME.surface, borderRadius: 10 }}>No pump shifts in the last 30 days.</div>
      ) : (
        <div style={{ overflowX: 'auto', background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Pump</th><th style={th}>Shift</th><th style={{ ...th, textAlign: 'right' }}>Open</th><th style={{ ...th, textAlign: 'right' }}>Close</th>
              <th style={{ ...th, textAlign: 'right' }}>Pump (L)</th><th style={{ ...th, textAlign: 'right' }}>Recorded (L)</th><th style={{ ...th, textAlign: 'right' }}>Gap (L)</th><th style={th}>Reason</th><th style={th}></th>
            </tr></thead>
            <tbody>{rows.map(s => (
              <tr key={s.id}>
                <td style={td}>{s.shift_date}</td><td style={td}>{s.pump}</td><td style={td}>{s.shift || '—'}</td>
                <td style={num}>{n1(s.open_reading)}</td><td style={num}>{n1(s.close_reading)}</td>
                <td style={num}>{n1(s.pump_litres)}</td><td style={num}>{n1(s.recorded_litres)}</td>
                <td style={{ ...num, color: s.reason ? THEME.error : THEME.text }}>{n1(s.gap_litres)}</td>
                <td style={td}>{s.reason || '—'}</td>
                <td style={td}>{s.status === 'open' ? (can('fuel.create') ? <button style={btn()} onClick={() => close(s)}>Close shift</button> : 'Open') : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MonthTab({ siteId, can }) {
  const last = new Date(); last.setDate(1); last.setMonth(last.getMonth() - 1)
  const [month, setMonth] = useState(last.toISOString().slice(0, 7))
  const [rows, setRows] = useState(null)
  const [closes, setCloses] = useState([])
  const load = useCallback(() => {
    supabase.rpc('fuel_month_preview', { p_site: siteId, p_month: `${month}-01` }).then(({ data, error }) => setRows(error ? [] : data || []))
    supabase.from('fuel_month_closes').select('id, month, litres, value, dips, closed_at, tank:fuel_tanks(name)').eq('site_id', siteId)
      .order('month', { ascending: false }).limit(24).then(({ data }) => setCloses(data || []))
  }, [siteId, month])
  useEffect(() => { load() }, [load])

  const open = (rows || []).reduce((s, r) => s + r.open_items, 0)
  const total = (rows || []).filter(r => !r.closed).reduce((s, r) => s + Number(r.value || 0), 0)
  const close = async () => {
    if (!window.confirm(`Post the ${month} fuel ${total < 0 ? 'loss' : 'gain'} of ${money(total)}? This locks the month's dips.`)) return
    const res = await run(supabase.rpc('fuel_month_close', { p_site: siteId, p_month: `${month}-01` }))
    if (res) { alert(`Posted for ${res.tanks} tank(s): ${money(res.value)}`); load() }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input type="month" id="rec-month" value={month} onChange={e => setMonth(e.target.value)} style={input} />
        <span style={{ fontSize: 13, color: THEME.textMed }}>Net dip gaps since the Stores cut-over, valued at the tank's average cost.</span>
        {can('fuel.approve') && <button style={{ ...btn(), marginLeft: 'auto', opacity: open ? 0.5 : 1 }} disabled={!!open} onClick={close}
          title={open ? 'Every big gap needs a reason and a sign-off first' : ''}>Close month &amp; post</button>}
      </div>
      {open > 0 && <div style={{ padding: 10, marginBottom: 12, borderRadius: 8, border: `1px solid ${THEME.error}`, color: THEME.error, fontSize: 13 }}>
        {open} big gap{open > 1 ? 's' : ''} in this month still need a reason or sign-off (Dips &amp; gaps tab).</div>}
      <div style={{ overflowX: 'auto', background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outlineVar}`, marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Tank</th><th style={{ ...th, textAlign: 'right' }}>Dips</th><th style={{ ...th, textAlign: 'right' }}>Net gap (L)</th>
            <th style={{ ...th, textAlign: 'right' }}>$/L</th><th style={{ ...th, textAlign: 'right' }}>Loss / gain</th><th style={th}>State</th></tr></thead>
          <tbody>{(rows || []).map(r => (
            <tr key={r.tank_id}>
              <td style={td}>{r.tank}</td><td style={num}>{r.dips}</td>
              <td style={{ ...num, color: Number(r.gap_litres) < 0 ? THEME.error : THEME.text }}>{Number(r.gap_litres) > 0 ? '+' : ''}{n1(r.gap_litres)}</td>
              <td style={num}>{r.cost_per_litre ? Number(r.cost_per_litre).toFixed(2) : '—'}</td>
              <td style={{ ...num, color: Number(r.value) < 0 ? THEME.error : THEME.text }}>{money(r.value)}</td>
              <td style={td}>{r.closed ? 'Closed' : r.open_items ? `${r.open_items} to clear` : r.dips ? 'Ready' : 'No dips'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h3 style={{ fontSize: 14, margin: '0 0 8px', color: THEME.text }}>Closed months</h3>
      {!closes.length ? <div style={{ fontSize: 13, color: THEME.textMed }}>None yet.</div> : (
        <div style={{ overflowX: 'auto', background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Month</th><th style={th}>Tank</th><th style={{ ...th, textAlign: 'right' }}>Litres</th><th style={{ ...th, textAlign: 'right' }}>Posted</th><th style={th}>Closed</th></tr></thead>
            <tbody>{closes.map(c => (
              <tr key={c.id}><td style={td}>{String(c.month).slice(0, 7)}</td><td style={td}>{c.tank?.name}</td>
                <td style={num}>{n1(c.litres)}</td><td style={num}>{money(c.value)}</td><td style={td}>{String(c.closed_at).slice(0, 10)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const TABS = [['dips', 'Dips & gaps', DipsTab], ['shifts', 'Pump shifts', ShiftsTab], ['month', 'Month-end', MonthTab]]

export default function Reconciliation() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const siteId = currentSite?.id
  const [tab, setTab] = useState('dips')
  if (!can('fuel.view') && !can('fuel.create')) return <Denied />
  if (!siteId) return null
  const Comp = TABS.find(t => t[0] === tab)[2]
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 22, color: THEME.text }}>Fuel reconciliation</h2>
        <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>Dips against the book, pump meters against recorded issues, and the month's loss or gain.</div>
      </div>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${THEME.outlineVar}`, marginBottom: 14 }}>
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
            padding: '8px 14px', color: tab === k ? COLOR : THEME.textMed, borderBottom: `2px solid ${tab === k ? COLOR : 'transparent'}` }}>{label}</button>
        ))}
      </div>
      <Comp siteId={siteId} can={can} />
    </div>
  )
}
