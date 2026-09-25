import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useFleet } from '../../contexts/FleetContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import Denied from '../../components/Denied'
import FleetQuickNav from './FleetQuickNav'

// FL20 — pre-start check on a phone (Fleet A3, #64). Works offline: finished checks wait in this browser
// and send themselves when the signal is back (fleet_prestart_submit ignores a resend with the same client_ref).
const CLR = MODULE_COLORS.fleet
const QKEY = 'fleet_prestart_queue'
const readQ = () => { try { return JSON.parse(localStorage.getItem(QKEY) || '[]') } catch { return [] } }
const writeQ = q => { try { localStorage.setItem(QKEY, JSON.stringify(q)) } catch { /* storage unavailable */ } }
const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)

const inp = { width: '100%', padding: '12px', borderRadius: 10, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 16, boxSizing: 'border-box' }
const card = { background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: 14, padding: 16 }
const RES = [['pass', 'OK', THEME.statusSuccessText, THEME.statusSuccessBg], ['fail', 'Fault', THEME.statusErrorText, THEME.statusErrorBg], ['na', 'N/A', THEME.textMed, THEME.surfaceVar]]

export default function FleetPrestart({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { assets } = useFleet()
  const [tab, setTab] = useState('check')
  const [assetId, setAssetId] = useState('')
  const [tpl, setTpl] = useState(null)
  const [items, setItems] = useState([])
  const [km, setKm] = useState('')
  const [hours, setHours] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [queued, setQueued] = useState(readQ().length)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [last, setLast] = useState(null)

  const machines = useMemo(() => (assets || []).filter(a => a.status !== 'decommissioned')
    .sort((a, b) => String(a.fleet_number || a.asset_number).localeCompare(String(b.fleet_number || b.asset_number))), [assets])
  const asset = machines.find(a => a.id === assetId)
  const cat = asset?.fleet_asset_types?.category

  // Keep the last template per machine for offline use.
  useEffect(() => {
    if (!assetId) { setTpl(null); setItems([]); return }
    const key = `fleet_prestart_tpl_${assetId}`
    const use = t => { setTpl(t); setItems((t?.items || []).map(i => ({ ...i, result: '', notes: '' }))) }
    supabase.rpc('fleet_prestart_template', { p_asset_id: assetId }).then(({ data, error }) => {
      if (!error && data) { use(data); try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* ignore */ } }
      else { try { use(JSON.parse(localStorage.getItem(key) || 'null')) } catch { use(null) } }
    })
  }, [assetId])

  const flush = useCallback(async () => {
    const q = readQ()
    if (!q.length || !navigator.onLine) return
    const left = []
    for (const p of q) {
      const { error } = await supabase.rpc('fleet_prestart_submit', { p })
      if (error) {
        // Network trouble: keep it. A real refusal (e.g. no permission): drop it and say so.
        if (/fetch|network|Failed to/i.test(error.message || '')) left.push(p)
        else showToast(`A saved check could not be sent: ${friendlyError(error)}`, 'red')
      }
    }
    writeQ(left); setQueued(left.length)
    if (left.length < q.length) showToast(`${q.length - left.length} saved check(s) sent`, 'green')
  }, [])

  useEffect(() => {
    const on = () => { setOnline(true); flush() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    flush()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [flush])

  if (!(can('fleet.view') || can('fleet.create'))) return <Denied />

  const setItem = (i, patch) => setItems(prev => prev.map((x, j) => j === i ? { ...x, ...patch } : x))
  const done = items.length > 0 && items.every(i => i.result)
  const fails = items.filter(i => i.result === 'fail')

  async function submit() {
    if (!asset) return showToast('Choose the machine', 'red')
    if (!done) return showToast('Mark every item OK, Fault or N/A', 'red')
    if (fails.some(f => !f.notes.trim())) return showToast('Say what is wrong for each fault', 'red')
    const p = { client_ref: newRef(), asset_id: asset.id, template_id: tpl?.template_id || '', inspection_date: new Date().toISOString().slice(0, 10),
      odometer_km: km, hours, notes, items: items.map(({ label, category, critical, result, notes: n }) => ({ label, category, critical: !!critical, result, notes: n })) }
    setBusy(true)
    let sent = false
    if (navigator.onLine) {
      const { data, error } = await supabase.rpc('fleet_prestart_submit', { p })
      if (!error) {
        sent = true
        setLast({ machine: asset.fleet_number || asset.asset_number, ...data })
        showToast(data.fails ? `Saved — ${data.fails} fault(s) sent to the workshop (${data.work_order_number})` : 'Saved — all OK', data.fails ? '' : 'green')
      } else if (!/fetch|network|Failed to/i.test(error.message || '')) {
        setBusy(false); return showToast(friendlyError(error), 'red')
      }
    }
    if (!sent) {
      const q = [...readQ(), p]; writeQ(q); setQueued(q.length)
      setLast({ machine: asset.fleet_number || asset.asset_number, offline: true })
      showToast('No signal — saved on this phone, it will send itself', '')
    }
    setBusy(false)
    setAssetId(''); setKm(''); setHours(''); setNotes('')
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'grid', gap: 12 }}>
      <FleetQuickNav setPage={setPage} current="fleet_prestart" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 600, color: THEME.text }}>Pre-start check</div>
          <div style={{ fontSize: 12, color: THEME.textMed }}>Before the first start of the shift. Faults go straight to the workshop.</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['check', 'defects'].map(k => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ padding: '8px 14px', borderRadius: 18, cursor: 'pointer', fontSize: 13,
              border: `1px solid ${tab === k ? CLR : THEME.outline}`, background: tab === k ? CLR : THEME.surface, color: tab === k ? '#fff' : THEME.text }}>
              {k === 'check' ? 'Check' : 'Open faults'}</button>
          ))}
        </div>
      </div>

      {(!online || queued > 0) && (
        <div style={{ ...card, background: THEME.statusWarningBg, color: THEME.statusWarningText, padding: 12, fontSize: 13 }}>
          {!online ? 'No signal. ' : ''}{queued > 0 ? `${queued} check(s) saved on this phone, waiting to send.` : 'Checks will be saved on this phone.'}
          {online && queued > 0 && <button onClick={flush} style={{ marginLeft: 8, border: 'none', background: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>Send now</button>}
        </div>
      )}

      {tab === 'defects' ? <OpenDefects siteId={currentSiteId} canEdit={can('fleet.edit')} /> : (
        <>
          {last && (
            <div style={{ ...card, padding: 12, fontSize: 13, color: THEME.textMed }}>
              Last: {last.machine} — {last.offline ? 'saved on phone' : last.fails ? `${last.fails} fault(s), job ${last.work_order_number}${last.grounded ? ', machine grounded' : ''}` : 'all OK'}
            </div>
          )}
          <div style={card}>
            <label htmlFor="ps-asset" style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed }}>Machine</label>
            <select id="ps-asset" style={{ ...inp, marginTop: 4 }} value={assetId} onChange={e => setAssetId(e.target.value)}>
              <option value="">Choose…</option>
              {machines.map(a => <option key={a.id} value={a.id}>{a.fleet_number || a.asset_number} · {a.description || [a.make, a.model].filter(Boolean).join(' ')}{a.registration ? ` (${a.registration})` : ''}</option>)}
            </select>
            {asset && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                {cat !== 'generator' && cat !== 'heavy_equipment' && (
                  <div><label htmlFor="ps-km" style={{ fontSize: 12, color: THEME.textMed }}>Odometer (km)</label>
                    <input id="ps-km" type="number" inputMode="numeric" style={inp} value={km} onChange={e => setKm(e.target.value)} placeholder={asset.current_odometer_km ? `last ${asset.current_odometer_km}` : ''} /></div>
                )}
                {cat !== 'vehicle' && (
                  <div><label htmlFor="ps-hr" style={{ fontSize: 12, color: THEME.textMed }}>Hour meter</label>
                    <input id="ps-hr" type="number" inputMode="decimal" style={inp} value={hours} onChange={e => setHours(e.target.value)} placeholder={asset.current_hours ? `last ${asset.current_hours}` : ''} /></div>
                )}
              </div>
            )}
          </div>

          {asset && !tpl && <div style={{ ...card, color: THEME.textMed }}>Loading the checklist…</div>}
          {items.map((it, i) => (
            <div key={i} style={{ ...card, padding: 12, borderColor: it.result === 'fail' ? THEME.statusErrorText : THEME.outlineVar }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 15, color: THEME.text }}>{it.label}{it.critical ? <span style={{ fontSize: 11, color: THEME.statusErrorText, marginLeft: 6 }}>must pass</span> : null}
                  <div style={{ fontSize: 11, color: THEME.textLow }}>{it.category}</div></div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {RES.map(([k, label, fg, bg]) => (
                    <button key={k} aria-pressed={it.result === k} onClick={() => setItem(i, { result: k })} style={{ minWidth: 52, minHeight: 44, borderRadius: 10, cursor: 'pointer', fontWeight: 600,
                      border: `1px solid ${it.result === k ? fg : THEME.outline}`, background: it.result === k ? bg : THEME.surface, color: it.result === k ? fg : THEME.textMed }}>{label}</button>
                  ))}
                </div>
              </div>
              {it.result === 'fail' && (
                <input aria-label={`What is wrong: ${it.label}`} style={{ ...inp, marginTop: 8 }} placeholder="What is wrong?" value={it.notes} onChange={e => setItem(i, { notes: e.target.value })} />
              )}
            </div>
          ))}
          {items.length > 0 && (
            <div style={card}>
              <label htmlFor="ps-notes" style={{ fontSize: 12, color: THEME.textMed }}>Anything else (optional)</label>
              <input id="ps-notes" style={{ ...inp, marginTop: 4 }} value={notes} onChange={e => setNotes(e.target.value)} />
              <button disabled={busy} onClick={submit} style={{ width: '100%', marginTop: 12, minHeight: 52, borderRadius: 12, border: 'none', background: CLR, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
                {busy ? 'Saving…' : fails.length ? `Submit — ${fails.length} fault(s)` : 'Submit — all OK'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function OpenDefects({ siteId, canEdit }) {
  const [rows, setRows] = useState(null)
  const load = useCallback(() => {
    supabase.from('fleet_defects').select('id, item_label, category, critical, notes, status, reported_at, asset:fleet_assets(fleet_number, asset_number, registration), wo:fleet_work_orders(work_order_number, status)')
      .eq('site_id', siteId).in('status', ['open', 'in_work', 'deferred']).eq('is_archived', false).order('reported_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [siteId])
  useEffect(() => { if (siteId) load() }, [siteId, load])
  async function mark(id, status) {
    const { error } = await supabase.from('fleet_defects').update({ status, closed_at: status === 'not_a_fault' ? new Date().toISOString() : null }).eq('id', id).eq('site_id', siteId)
    if (error) return showToast(friendlyError(error), 'red')
    load()
  }
  if (!rows) return <div style={{ ...card, color: THEME.textMed }}>Loading…</div>
  if (!rows.length) return <div style={{ ...card, color: THEME.textMed }}>No open faults.</div>
  return rows.map(r => (
    <div key={r.id} style={{ ...card, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong style={{ color: THEME.text }}>{r.asset?.fleet_number || r.asset?.asset_number || r.asset?.registration} · {r.item_label}</strong>
        <span style={{ fontSize: 12, color: r.critical ? THEME.statusErrorText : THEME.textMed }}>{r.critical ? 'Critical · ' : ''}{r.status.replace('_', ' ')}</span>
      </div>
      <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{r.notes || '—'} · {new Date(r.reported_at).toLocaleDateString()}{r.wo ? ` · job ${r.wo.work_order_number} (${r.wo.status})` : ''}</div>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {r.status !== 'deferred' && <button onClick={() => mark(r.id, 'deferred')} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer' }}>Defer</button>}
          <button onClick={() => mark(r.id, 'not_a_fault')} style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer' }}>Not a fault</button>
        </div>
      )}
    </div>
  ))
}
