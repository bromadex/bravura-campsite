import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import Denied from '../../components/Denied'

// FU21 — Pump (issue #72, F4). The attendant's phone screen: machine, driver, litres, km/hours, optional pump meter,
// and the driver signs by typing their name. Works with no signal: lists are cached and fills wait in a queue on the
// phone ('fuel_pump_queue') until they can be sent to fuel_pump_issue (idempotent on client_ref).
// The server's rules (licence, second fill, allowance) come back as "CODE: message"; the screen asks for a reason and resends.

const COLOR = MODULE_COLORS.fuel
const QKEY = 'fuel_pump_queue'
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]') } catch { return [] } }
const writeQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)) } catch { /* storage unavailable */ } }
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const REASON_FIELD = { LICENCE: 'licence_note', SECOND_FILL: 'second_fill_reason', ALLOWANCE: 'allowance_note' }
const REASON_ASK = { LICENCE: 'Why may this driver take fuel?', SECOND_FILL: 'Why a second fill so soon?', ALLOWANCE: 'Why go over the allowance?' }

const big = { width: '100%', boxSizing: 'border-box', padding: '14px 12px', fontSize: 17, borderRadius: 10, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }
const label = { display: 'block', fontSize: 13, fontWeight: 600, color: THEME.textMed, margin: '14px 0 6px' }

const blank = tank => ({ tank_id: tank || '', pump_id: '', fleet_asset_id: '', operator_id: '', litres: '', odometer_km: '', hours_reading: '',
  meter_broken: false, meter_note: '', meter_start: '', meter_end: '', signed_by_name: '', notes: '' })

export default function FuelPump() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const siteId = currentSite?.id
  const [lists, setLists] = useState(null)
  const [form, setForm] = useState(blank())
  const [search, setSearch] = useState('')
  const [dsearch, setDsearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [queue, setQueue] = useState(readQ())
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [check, setCheck] = useState(null)

  // lists: fresh when online, cached for offline
  useEffect(() => {
    if (!siteId) return
    const key = `fuel_pump_lists_${siteId}`
    supabase.rpc('fuel_pump_lists', { p_site: siteId }).then(({ data, error }) => {
      if (!error && data) { setLists(data); try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* ignore */ } }
      else { try { setLists(JSON.parse(localStorage.getItem(key) || 'null')) } catch { setLists(null) } }
    })
  }, [siteId])
  useEffect(() => { if (lists?.tanks?.length === 1) setForm(f => f.tank_id ? f : { ...f, tank_id: lists.tanks[0].id }) }, [lists])

  const send = useCallback(async item => {
    const { data, error } = await supabase.rpc('fuel_pump_issue', { p: item })
    if (error) {
      const code = (error.message.match(/^(LICENCE|SECOND_FILL|ALLOWANCE):/) || [])[1]
      return { ok: false, code, message: error.message.replace(/ — give a reason to go ahead$/, ''), network: /fetch|network|Failed to/i.test(error.message) }
    }
    return { ok: true, data }
  }, [])

  const flush = useCallback(async () => {
    let q = readQ()
    for (const item of [...q]) {
      if (item._needs) continue
      const r = await send(item)
      if (r.ok) q = q.filter(x => x.client_ref !== item.client_ref)
      else if (!r.network) q = q.map(x => x.client_ref === item.client_ref ? { ...x, _needs: r.code || 'ERROR', _message: r.message } : x)
      else break
    }
    writeQ(q); setQueue(q)
  }, [send])

  useEffect(() => {
    const on = () => { setOnline(true); flush() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    if (navigator.onLine) flush()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [flush])

  const machine = useMemo(() => lists?.machines?.find(m => m.id === form.fleet_asset_id), [lists, form.fleet_asset_id])
  const driver = useMemo(() => lists?.drivers?.find(d => d.id === form.operator_id), [lists, form.operator_id])
  const meterNeeded = lists?.meter_required_from && new Date().toISOString().slice(0, 10) >= lists.meter_required_from
  const isVehicle = machine?.category === 'vehicle'
  const licenceBad = driver && (!driver.licence_expiry || driver.licence_expiry < new Date().toISOString().slice(0, 10))

  // live rule check while online
  useEffect(() => {
    if (!online || !form.fleet_asset_id || !siteId) { setCheck(null); return }
    const t = setTimeout(() => {
      supabase.rpc('fuel_pump_check', { p: { site_id: siteId, fleet_asset_id: form.fleet_asset_id, operator_id: form.operator_id || '', litres: form.litres || 0 } })
        .then(({ data }) => setCheck(data || null))
    }, 400)
    return () => clearTimeout(t)
  }, [online, siteId, form.fleet_asset_id, form.operator_id, form.litres])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (extra = {}) => {
    setMsg(null)
    if (!form.tank_id) return setMsg({ bad: true, text: 'Choose the tank or bowser' })
    if (!form.fleet_asset_id) return setMsg({ bad: true, text: 'Choose the machine' })
    if (!(Number(form.litres) > 0)) return setMsg({ bad: true, text: 'Enter the litres' })
    if (meterNeeded && !form.meter_broken && !form.odometer_km && !form.hours_reading) return setMsg({ bad: true, text: `Enter the ${isVehicle ? 'km' : 'hours'} reading, or tick "Meter broken"` })
    if (form.meter_broken && !form.meter_note.trim()) return setMsg({ bad: true, text: 'Say what is wrong with the meter' })
    if (!form.signed_by_name.trim()) return setMsg({ bad: true, text: 'The driver must type their name to sign' })
    const item = { ...form, ...extra, client_ref: extra.client_ref || uid(), issued_at: extra.issued_at || new Date().toISOString() }
    setBusy(true)
    const r = online ? await send(item) : { ok: false, network: true }
    setBusy(false)
    if (r.ok) {
      setMsg({ text: `Saved ${r.data.number} — ${form.litres} L${r.data.recharge ? ` · charged back to ${r.data.recharge.contractor}` : ''}` })
      setForm(blank(form.tank_id)); setSearch(''); setDsearch('')
      return
    }
    if (r.code) {
      const why = window.prompt(`${r.message}\n\n${REASON_ASK[r.code]}`)
      if (why && why.trim()) return submit({ ...extra, client_ref: item.client_ref, issued_at: item.issued_at, [REASON_FIELD[r.code]]: why.trim() })
      return setMsg({ bad: true, text: r.message })
    }
    if (r.network) {
      const q = [...readQ(), item]; writeQ(q); setQueue(q)
      setMsg({ text: `No signal — saved on this phone (${q.length} waiting). It will send when the signal is back.` })
      setForm(blank(form.tank_id)); setSearch(''); setDsearch('')
      return
    }
    setMsg({ bad: true, text: r.message })
  }

  const fixQueued = async item => {
    const why = window.prompt(`${item._message}\n\n${REASON_ASK[item._needs] || 'Reason'}`)
    if (!why || !why.trim()) return
    const fixed = { ...item, [REASON_FIELD[item._needs] || 'notes']: why.trim() }
    delete fixed._needs; delete fixed._message
    const q = readQ().map(x => x.client_ref === item.client_ref ? fixed : x)
    writeQ(q); setQueue(q); flush()
  }

  if (!can('fuel.create')) return <Denied />
  if (!siteId) return null
  const machines = (lists?.machines || []).filter(m => !search || m.label.toLowerCase().includes(search.toLowerCase())).slice(0, 40)
  const drivers = (lists?.drivers || []).filter(d => !dsearch || `${d.name} ${d.number || ''}`.toLowerCase().includes(dsearch.toLowerCase())).slice(0, 40)
  const pumps = (lists?.pumps || []).filter(p => !form.tank_id || p.tank_id === form.tank_id)

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: '0 0 40px' }}>
      <h2 style={{ margin: '4px 0 2px', fontSize: 22, color: THEME.text }}>Issue fuel</h2>
      <div style={{ fontSize: 13, color: THEME.textMed }}>At the pump. Works without signal.</div>

      {(!online || queue.length > 0) && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 10, background: THEME.surfaceVar, fontSize: 13, color: THEME.text }}>
          {!online ? 'No signal. ' : ''}{queue.length ? `${queue.length} fill(s) on this phone waiting to send.` : 'Fills will be saved on this phone.'}
          {online && queue.some(x => !x._needs) && <button onClick={flush} style={{ marginLeft: 8, border: 'none', background: 'none', color: COLOR, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>Send now</button>}
          {queue.filter(x => x._needs).map(x => (
            <div key={x.client_ref} style={{ marginTop: 6, color: THEME.error }}>
              {x.litres} L — {x._message} <button onClick={() => fixQueued(x)} style={{ border: 'none', background: 'none', color: COLOR, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}>Give reason</button>
            </div>
          ))}
        </div>
      )}

      {msg && <div style={{ marginTop: 10, padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 600,
        background: msg.bad ? '#FDECEC' : '#E8F5E9', color: msg.bad ? THEME.error : '#1B5E20' }}>{msg.text}</div>}

      <label style={label} htmlFor="p-tank">Tank or bowser</label>
      <select id="p-tank" value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={big}>
        <option value="">Choose…</option>{(lists?.tanks || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>

      <label style={label} htmlFor="p-machine">Machine</label>
      <input id="p-machine" placeholder="Type fleet no. or registration" value={machine ? machine.label : search}
        onChange={e => { set('fleet_asset_id', ''); setSearch(e.target.value) }} style={big} />
      {!machine && search && (
        <div style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: 10, marginTop: 4, maxHeight: 240, overflowY: 'auto', background: THEME.surface }}>
          {machines.map(m => (
            <div key={m.id} onClick={() => { set('fleet_asset_id', m.id); setSearch('') }} style={{ padding: '12px', borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontSize: 15 }}>
              {m.label}{m.hired && <span style={{ marginLeft: 6, fontSize: 11, color: THEME.warning }}>HIRED · recharge</span>}
            </div>
          ))}
          {!machines.length && <div style={{ padding: 12, color: THEME.textMed }}>No machine matches.</div>}
        </div>
      )}
      {machine?.hired && <div style={{ fontSize: 12, color: THEME.warning, marginTop: 4 }}>Hired machine — the contractor pays for this fuel; it will be charged back.</div>}

      <label style={label} htmlFor="p-driver">Driver / operator</label>
      <input id="p-driver" placeholder="Type name or employee no." value={driver ? driver.name : dsearch}
        onChange={e => { set('operator_id', ''); setDsearch(e.target.value) }} style={big} />
      {!driver && dsearch && (
        <div style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: 10, marginTop: 4, maxHeight: 240, overflowY: 'auto', background: THEME.surface }}>
          {drivers.map(d => (
            <div key={d.id} onClick={() => { setForm(f => ({ ...f, operator_id: d.id, signed_by_name: f.signed_by_name || '' })); setDsearch('') }}
              style={{ padding: '12px', borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontSize: 15 }}>
              {d.name} <span style={{ fontSize: 12, color: THEME.textMed }}>{d.number}</span>
            </div>
          ))}
          {!drivers.length && <div style={{ padding: 12, color: THEME.textMed }}>No driver matches.</div>}
        </div>
      )}
      {licenceBad && <div style={{ fontSize: 12, color: THEME.error, marginTop: 4 }}>
        {driver.licence_expiry ? `Licence expired ${driver.licence_expiry}` : 'No licence on record'} — you will be asked for a reason.</div>}

      <label style={label} htmlFor="p-litres">Litres</label>
      <input id="p-litres" type="number" inputMode="decimal" value={form.litres} onChange={e => set('litres', e.target.value)} style={{ ...big, fontSize: 26, fontWeight: 700 }} />

      <label style={label} htmlFor="p-meter">{isVehicle ? 'Odometer (km)' : 'Hour meter'}{meterNeeded ? '' : ' (optional until ' + (lists?.meter_required_from || '') + ')'}</label>
      <input id="p-meter" type="number" inputMode="decimal" disabled={form.meter_broken}
        placeholder={isVehicle ? (machine?.km ? `last ${machine.km}` : '') : (machine?.hours ? `last ${machine.hours}` : '')}
        value={isVehicle ? form.odometer_km : form.hours_reading} onChange={e => set(isVehicle ? 'odometer_km' : 'hours_reading', e.target.value)} style={big} />
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, marginTop: 8, color: THEME.text }}>
        <input type="checkbox" checked={form.meter_broken} onChange={e => set('meter_broken', e.target.checked)} /> Meter broken
      </label>
      {form.meter_broken && <input placeholder="What is wrong with the meter?" value={form.meter_note} onChange={e => set('meter_note', e.target.value)} style={{ ...big, marginTop: 6 }} />}

      {pumps.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ fontSize: 13, color: THEME.textMed, cursor: 'pointer' }}>Pump meter (optional)</summary>
          <select value={form.pump_id} onChange={e => { const p = pumps.find(x => x.id === e.target.value); setForm(f => ({ ...f, pump_id: e.target.value, meter_start: p?.meter ?? f.meter_start })) }} style={{ ...big, marginTop: 6 }}>
            <option value="">Pump…</option>{pumps.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input type="number" inputMode="decimal" placeholder="Start" value={form.meter_start} onChange={e => set('meter_start', e.target.value)} style={big} />
            <input type="number" inputMode="decimal" placeholder="End" value={form.meter_end}
              onChange={e => setForm(f => ({ ...f, meter_end: e.target.value, litres: f.meter_start && e.target.value ? String(Number(e.target.value) - Number(f.meter_start)) : f.litres }))} style={big} />
          </div>
        </details>
      )}

      {check?.allowances?.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13 }}>
          {check.allowances.map(a => (
            <div key={a.label} style={{ color: a.pct > 100 ? THEME.error : a.pct >= 80 ? THEME.warning : THEME.textMed }}>
              {a.label}: {Math.round(a.after)} of {Math.round(a.litres)} L after this fill ({a.pct}%)
            </div>
          ))}
        </div>
      )}
      {check?.problems?.filter(p => p.code === 'SECOND_FILL').map(p => (
        <div key={p.code} style={{ marginTop: 8, fontSize: 13, color: THEME.error }}>{p.message}</div>
      ))}

      <label style={label} htmlFor="p-sign">Driver signs — type your full name</label>
      <input id="p-sign" value={form.signed_by_name} onChange={e => set('signed_by_name', e.target.value)} style={{ ...big, fontStyle: 'italic' }}
        placeholder={driver ? driver.name : 'Full name'} autoComplete="off" />

      <button disabled={busy} onClick={() => submit()} style={{ width: '100%', marginTop: 20, padding: 16, fontSize: 18, fontWeight: 700, border: 'none', borderRadius: 12,
        background: COLOR, color: '#fff', cursor: 'pointer', opacity: busy ? 0.6 : 1, fontFamily: 'inherit' }}>
        {busy ? 'Saving…' : 'Save fill'}
      </button>
    </div>
  )
}
