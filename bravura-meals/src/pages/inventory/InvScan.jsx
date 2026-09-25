import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'

// IN22 — scan on a phone (issue #59, I4). Camera scanning uses the browser's BarcodeDetector (Chrome / Android);
// anywhere else, type the code or use a handheld scanner (they type the code and press Enter).
// A bin label (BIN:store:code, printed on IN17) shows what is in the bin; an item shows stock and quick Issue / Count.
const FORMATS = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'data_matrix']
const q = v => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })

export default function InvScan({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [code, setCode] = useState('')
  const [res, setRes] = useState(null)
  const [camera, setCamera] = useState(false)
  const [action, setAction] = useState(null)       // { kind: 'issue'|'count', store }
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const inputRef = useRef(null)
  const canCamera = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

  const lookup = useCallback(async (c) => {
    const text = String(c || '').trim()
    if (!text) return
    setAction(null)
    const { data, error } = await supabase.rpc('inv_scan', { p_code: text, p_site_id: currentSiteId })
    if (error) return showToast(friendlyError(error), 'red')
    if (data?.error) { setRes(null); return showToast(data.error, 'red') }
    if (navigator.vibrate) navigator.vibrate(60)
    setRes(data); setCode('')
  }, [currentSiteId])

  function stopCamera() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCamera(false)
  }

  useEffect(() => {
    if (!camera) return
    let alive = true, timer
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        const supported = await window.BarcodeDetector.getSupportedFormats?.() || FORMATS
        const detector = new window.BarcodeDetector({ formats: FORMATS.filter(f => supported.includes(f)) })
        const tick = async () => {
          if (!alive || !videoRef.current) return
          try {
            const found = await detector.detect(videoRef.current)
            if (found[0]?.rawValue) { stopCamera(); lookup(found[0].rawValue); return }
          } catch { /* frame not ready */ }
          timer = setTimeout(tick, 250)
        }
        tick()
      } catch {
        showToast('Camera not available — type or scan the code instead', 'red')
        stopCamera()
      }
    })()
    return () => { alive = false; clearTimeout(timer); streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [camera, lookup])

  useEffect(() => { inputRef.current?.focus() }, [res])

  if (!can('inventory.view')) return <Denied />
  const item = res?.kind === 'item' ? res : null
  const bin = res?.kind === 'bin' ? res : null

  return (
    <FinShell module="Inventory" homePage="inv_dashboard" setPage={setPage} title="Scan"
      subtitle="Scan an item barcode or a bin label to see stock and act on it.">
      <div style={{ ...finCard, display: 'grid', gap: 10, maxWidth: 560 }}>
        <form onSubmit={e => { e.preventDefault(); lookup(code) }} style={{ display: 'flex', gap: 8 }}>
          <input ref={inputRef} id="scan-code" aria-label="Code" value={code} onChange={e => setCode(e.target.value)} autoComplete="off"
            placeholder="Barcode, item code or bin label" style={{ ...finInput, flex: 1, minHeight: 48, fontSize: 16 }} />
          <button type="submit" style={finBtn}>Find</button>
        </form>
        {canCamera && (camera
          ? <button style={finBtn2} onClick={stopCamera}>Stop camera</button>
          : <button style={{ ...finBtn, minHeight: 52 }} onClick={() => setCamera(true)}>Scan with camera</button>)}
        {camera && <video ref={videoRef} muted playsInline style={{ width: '100%', borderRadius: 12, background: '#000', aspectRatio: '4 / 3', objectFit: 'cover' }} />}
        {!canCamera && <div style={{ fontSize: 12, color: FIN.faint }}>Camera scanning needs Chrome on Android. A handheld scanner works in any browser.</div>}
      </div>

      {bin && (
        <div style={{ ...finCard, maxWidth: 560 }}>
          <div style={{ fontSize: 12, color: FIN.muted }}>Bin · {bin.bin.warehouse}</div>
          <h2 style={{ margin: '2px 0 10px', fontFamily: FIN.serif, fontSize: 24 }}>{bin.bin.code}{bin.bin.name ? ` — ${bin.bin.name}` : ''}</h2>
          {bin.items.length === 0 ? <div style={{ color: FIN.faint }}>Nothing is placed in this bin (set bins on Store levels, IN18).</div>
            : bin.items.map(i => (
              <button key={i.item_id} onClick={() => lookup(i.item_code)} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', padding: '12px 0',
                background: 'none', border: 'none', borderBottom: `1px solid ${FIN.lineSoft}`, cursor: 'pointer', font: 'inherit', color: FIN.ink, textAlign: 'left' }}>
                <span>{i.description}<br /><span style={{ fontSize: 12, color: FIN.faint }}>{i.item_code}</span></span>
                <strong>{q(i.on_hand)}</strong>
              </button>
            ))}
        </div>
      )}

      {item && (
        <div style={{ ...finCard, maxWidth: 560, display: 'grid', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, color: FIN.muted }}>{item.item.item_code}</div>
            <h2 style={{ margin: '2px 0 0', fontFamily: FIN.serif, fontSize: 24 }}>{item.item.description}</h2>
          </div>
          {item.stores.length === 0 ? <div style={{ color: FIN.faint }}>Not stocked at this site.</div> : item.stores.map(s => (
            <div key={s.warehouse_id} style={{ border: `1px solid ${FIN.line}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{s.warehouse}{s.bin ? <span style={{ fontWeight: 400, color: FIN.muted }}> · bin {s.bin}</span> : null}</strong>
                <span style={{ fontSize: 22, fontFamily: FIN.serif, fontWeight: 600 }}>{q(s.on_hand)} <span style={{ fontSize: 13, color: FIN.faint }}>{item.item.unit || ''}</span></span>
              </div>
              <div style={{ fontSize: 13, color: FIN.muted, marginTop: 2 }}>
                {q(s.available)} free{Number(s.reserved) ? ` · ${q(s.reserved)} reserved` : ''}{Number(s.on_order) ? ` · ${q(s.on_order)} on order` : ''}{Number(s.in_transit) ? ` · ${q(s.in_transit)} on the way` : ''}{s.reorder_at ? ` · reorder at ${q(s.reorder_at)}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {can('inventory.create') && Number(s.available) > 0 && <button style={{ ...finBtn, flex: 1 }} onClick={() => setAction({ kind: 'issue', store: s })}>Issue</button>}
                {can('inventory.edit') && <button style={{ ...finBtn2, flex: 1 }} onClick={() => setAction({ kind: 'count', store: s })}>Count</button>}
              </div>
              {action?.store.warehouse_id === s.warehouse_id && (
                <QuickAction kind={action.kind} store={s} item={item.item} siteId={currentSiteId}
                  onDone={() => lookup(item.item.item_code)} onCancel={() => setAction(null)} />
              )}
            </div>
          ))}
        </div>
      )}
    </FinShell>
  )
}

function QuickAction({ kind, store, item, siteId, onDone, onCancel }) {
  const [qty, setQty] = useState('')
  const [dept, setDept] = useState('')
  const [depts, setDepts] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (kind !== 'issue') return
    supabase.from('departments').select('id, name').eq('site_id', siteId).order('name').then(({ data }) => setDepts(data || []))
  }, [kind, siteId])

  async function go() {
    const v = Number(qty)
    if (qty === '' || v < 0 || (kind === 'issue' && !(v > 0))) return showToast('Enter a quantity', 'red')
    setBusy(true)
    let r
    if (kind === 'issue') {
      if (!dept) { setBusy(false); return showToast('Choose the department', 'red') }
      r = await supabase.rpc('inv_issue', { p: { warehouse_id: store.warehouse_id, department_id: dept, notes: 'Scanned issue', lines: [{ item_id: item.id, qty: v }] } })
    } else {
      const diff = v - Number(store.on_hand)
      if (diff === 0) { setBusy(false); showToast('Count matches — nothing to change', 'green'); return onDone() }
      r = await supabase.rpc('inv_adjust', { p: { warehouse_id: store.warehouse_id, reason: `Spot count: system ${store.on_hand}, counted ${v}`, lines: [{ item_id: item.id, qty: diff }] } })
    }
    setBusy(false)
    if (r.error) return showToast(friendlyError(r.error), 'red')
    showToast(kind === 'issue' ? `Issued — ${r.data.voucher}` : `Count saved — ${r.data.voucher}`, 'green')
    onDone()
  }

  const inp = { ...finInput, width: '100%', minHeight: 48, fontSize: 16 }
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${FIN.lineSoft}` }}>
      {kind === 'issue' && (
        <select id="scan-dept" aria-label="Department" value={dept} onChange={e => setDept(e.target.value)} style={inp}>
          <option value="">Issue to department…</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      )}
      <input id="scan-qty" aria-label={kind === 'issue' ? 'Quantity to issue' : 'Counted quantity'} type="number" inputMode="decimal" min="0" autoFocus
        placeholder={kind === 'issue' ? `Quantity (max ${q(store.available)})` : `Counted on the shelf (system says ${q(store.on_hand)})`}
        value={qty} onChange={e => setQty(e.target.value)} style={inp} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...finBtn2, flex: 1 }} onClick={onCancel}>Cancel</button>
        <button style={{ ...finBtn, flex: 1 }} disabled={busy} onClick={go}>{busy ? 'Saving…' : kind === 'issue' ? 'Issue' : 'Save count'}</button>
      </div>
    </div>
  )
}
