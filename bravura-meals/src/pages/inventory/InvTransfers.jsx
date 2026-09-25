import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { useAskContext } from '../../components/AskBravura'

// IN20 — stock on the move (issue #59, I3). Load a truck (several items) from a store here to any store, it is
// "in transit" until the receiving store confirms what arrived. Between sites Finance posts through 2500 at each end;
// anything short is written off at the receiving store.
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const link = { background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }

export default function InvTransfers({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [tab, setTab] = useState('incoming')
  const [ships, setShips] = useState([])
  const [stores, setStores] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)          // shipment being received / viewed
  const [lines, setLines] = useState([])
  const [got, setGot] = useState({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [s, st] = await Promise.all([
      supabase.from('inv_shipments').select('*').or(`from_site_id.eq.${currentSiteId},to_site_id.eq.${currentSiteId}`)
        .order('dispatched_at', { ascending: false }).limit(200),
      supabase.rpc('inv_store_list'),
    ])
    if (s.error) showToast(friendlyError(s.error), 'red')
    setShips(s.data || []); setStores(st.data || [])
    setLoading(false)
  }, [currentSiteId])
  useEffect(() => { load() }, [load])

  const storeName = useMemo(() => Object.fromEntries(stores.map(s => [s.id, `${s.name}`])), [stores])
  const incoming = ships.filter(s => s.to_site_id === currentSiteId && s.status === 'in_transit')
  const outgoing = ships.filter(s => s.from_site_id === currentSiteId && s.status === 'in_transit')
  const done = ships.filter(s => s.status === 'received')
  useAskContext({ screen: 'Stores transfers', incoming_in_transit: incoming.length, outgoing_in_transit: outgoing.length,
    shipments: ships.slice(0, 20).map(s => ({ no: s.shipment_no, from: storeName[s.from_warehouse_id], to: storeName[s.to_warehouse_id], status: s.status, sent: s.dispatched_at })) })

  async function openShip(s) {
    setOpen(s); setGot({})
    const { data } = await supabase.from('inv_shipment_lines').select('*, item:items(item_code, description)').eq('shipment_id', s.id)
    setLines(data || [])
  }

  async function receive() {
    const payload = lines.map(l => ({ line_id: l.id, qty_received: got[l.id] === undefined || got[l.id] === '' ? Number(l.qty_sent) : Number(got[l.id]) }))
    const short = payload.filter((p, i) => p.qty_received < Number(lines[i].qty_sent))
    if (short.length && !confirm(`${short.length} line(s) arrived short. The missing stock will be written off as "short in transit". Continue?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('inv_receive_shipment', { p_id: open.id, p_lines: payload })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(`Received ${open.shipment_no}${data.short_value > 0 ? ` — $${money(data.short_value)} short written off` : ''}`, 'green')
    setOpen(null); load()
  }

  if (!can('inventory.view')) return <Denied />
  const list = tab === 'incoming' ? incoming : tab === 'outgoing' ? outgoing : done
  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
  const td = { padding: '10px 12px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 14 }

  return (
    <FinShell module="Stores" homePage="inv_dashboard" setPage={setPage} title="Transfers"
      subtitle="Stock on the move between stores and sites. It stays in transit until the receiving store confirms it."
      tabs={[{ key: 'incoming', label: 'Coming in', count: incoming.length }, { key: 'outgoing', label: 'Sent, on the way', count: outgoing.length },
             { key: 'done', label: 'Received' }, can('inventory.create') && { key: 'send', label: 'Load a truck' }]}
      tab={tab} onTab={setTab}>
      {tab === 'send' ? <SendForm stores={stores} siteId={currentSiteId} onSent={() => { setTab('outgoing'); load() }} /> : (
        <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Shipment</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Vehicle / driver</th><th style={th}>Sent</th>
              <th style={th}>{tab === 'done' ? 'Received' : 'Days on the road'}</th><th style={th} /></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 32, color: FIN.faint }}>Loading…</td></tr>
                : list.length === 0 ? <tr><td colSpan={7} style={{ ...td, textAlign: 'center', padding: 32, color: FIN.faint }}>
                  {tab === 'incoming' ? 'Nothing on its way to this site' : tab === 'outgoing' ? 'Nothing in transit from this site' : 'No received shipments yet'}</td></tr>
                : list.map(s => {
                  const days = Math.floor((Date.now() - new Date(s.dispatched_at)) / 864e5)
                  return (
                    <tr key={s.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{s.shipment_no}</td>
                      <td style={td}>{storeName[s.from_warehouse_id] || '—'}</td>
                      <td style={td}>{storeName[s.to_warehouse_id] || '—'}</td>
                      <td style={{ ...td, color: FIN.muted }}>{[s.vehicle, s.driver].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={td}>{fmtDate(s.dispatched_at)}</td>
                      <td style={{ ...td, color: tab !== 'done' && days > 3 ? FIN.ochreText : FIN.ink }}>{tab === 'done' ? fmtDate(s.received_at) : `${days} day${days === 1 ? '' : 's'}`}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button style={tab === 'incoming' && can('inventory.create') ? { ...finBtn, minHeight: 36 } : link} onClick={() => openShip(s)}>
                          {tab === 'incoming' && can('inventory.create') ? 'Receive' : 'View'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <div role="dialog" aria-modal="true" onClick={() => setOpen(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ ...finCard, width: 'min(720px, 100%)', maxHeight: '90vh', overflowY: 'auto', fontFamily: FIN.sans }}>
            <h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>{open.shipment_no}</h2>
            <div style={{ fontSize: 13, color: FIN.muted, margin: '4px 0 14px' }}>
              {storeName[open.from_warehouse_id]} → {storeName[open.to_warehouse_id]} · sent {fmtDate(open.dispatched_at)}{open.vehicle ? ` · ${open.vehicle}` : ''}{open.driver ? ` · ${open.driver}` : ''}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Item</th><th style={{ ...th, textAlign: 'right' }}>Sent</th><th style={{ ...th, textAlign: 'right' }}>Received</th><th style={{ ...th, textAlign: 'right' }}>Value</th></tr></thead>
              <tbody>{lines.map(l => (
                <tr key={l.id}>
                  <td style={td}><span style={{ fontSize: 12, color: FIN.muted }}>{l.item?.item_code}</span><br />{l.item?.description}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{Number(l.qty_sent)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {open.status === 'in_transit' && open.to_site_id === currentSiteId && can('inventory.create')
                      ? <input aria-label={`Received ${l.item?.item_code}`} type="number" min="0" max={l.qty_sent} placeholder={String(Number(l.qty_sent))}
                          value={got[l.id] ?? ''} onChange={e => setGot({ ...got, [l.id]: e.target.value })} style={{ ...finInput, width: 90, textAlign: 'right' }} />
                      : (l.qty_received ?? '—')}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>${money(l.qty_sent * l.unit_cost)}</td>
                </tr>
              ))}</tbody>
            </table>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button style={finBtn2} onClick={() => setOpen(null)}>Close</button>
              {open.status === 'in_transit' && open.to_site_id === currentSiteId && can('inventory.create') &&
                <button style={finBtn} disabled={busy} onClick={receive}>{busy ? 'Receiving…' : 'Confirm received'}</button>}
            </div>
            {open.status === 'in_transit' && open.to_site_id === currentSiteId && <div style={{ fontSize: 12, color: FIN.faint, marginTop: 8 }}>Leave a line blank if it all arrived.</div>}
          </div>
        </div>
      )}
    </FinShell>
  )
}

// The truck: pick a store here, a destination store anywhere, then add items with the quantity.
function SendForm({ stores, siteId, onSent }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [stock, setStock] = useState([])
  const [cart, setCart] = useState([])
  const [pick, setPick] = useState({ item_id: '', qty: '' })
  const [meta, setMeta] = useState({ vehicle: '', driver: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const mine = stores.filter(s => s.site_id === siteId)

  useEffect(() => { if (!from && mine[0]) setFrom(mine[0].id) }, [mine, from])
  useEffect(() => {
    if (!from) return
    supabase.rpc('inv_position', { p_site_ids: [siteId], p_warehouse: from })
      .then(({ data }) => setStock((data || []).filter(r => Number(r.available) > 0)))
    setCart([])
  }, [from, siteId])

  const item = stock.find(s => s.item_id === pick.item_id)
  function add() {
    const q = Number(pick.qty)
    if (!item || !(q > 0)) return showToast('Choose an item and a quantity', 'red')
    const already = cart.filter(c => c.item_id === item.item_id).reduce((s, c) => s + c.qty, 0)
    if (already + q > Number(item.available)) return showToast(`Only ${Number(item.available)} ${item.unit || ''} free to send`, 'red')
    setCart([...cart, { item_id: item.item_id, code: item.item_code, description: item.description, unit: item.unit, qty: q, value: q * (Number(item.value) / Math.max(Number(item.on_hand), 1)) }])
    setPick({ item_id: '', qty: '' })
  }

  async function send() {
    if (!to) return showToast('Choose where the truck is going', 'red')
    if (!cart.length) return showToast('Load at least one item', 'red')
    setBusy(true)
    const { data, error } = await supabase.rpc('inv_dispatch', { p: { from_warehouse_id: from, to_warehouse_id: to, ...meta,
      lines: cart.map(c => ({ item_id: c.item_id, qty: c.qty })) } })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(`${data.shipment} dispatched — ${data.lines} item(s), $${money(data.value)}`, 'green')
    onSent()
  }

  const total = cart.reduce((s, c) => s + c.value, 0)
  const label = { fontSize: 12, color: FIN.muted }
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
      <div style={{ ...finCard, display: 'grid', gap: 12 }}>
        <label style={label}>From store<br />
          <select id="send-from" value={from} onChange={e => setFrom(e.target.value)} style={{ ...finInput, width: '100%' }}>
            {mine.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label style={label}>To store<br />
          <select id="send-to" value={to} onChange={e => setTo(e.target.value)} style={{ ...finInput, width: '100%' }}>
            <option value="">— Choose —</option>
            {stores.filter(s => s.id !== from).map(s => <option key={s.id} value={s.id}>{s.site_name} — {s.name}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...label, flex: 1 }}>Vehicle<br /><input id="send-vehicle" value={meta.vehicle} onChange={e => setMeta({ ...meta, vehicle: e.target.value })} placeholder="Registration" style={{ ...finInput, width: '100%' }} /></label>
          <label style={{ ...label, flex: 1 }}>Driver<br /><input id="send-driver" value={meta.driver} onChange={e => setMeta({ ...meta, driver: e.target.value })} style={{ ...finInput, width: '100%' }} /></label>
        </div>
        <label style={label}>Notes<br /><input id="send-notes" value={meta.notes} onChange={e => setMeta({ ...meta, notes: e.target.value })} style={{ ...finInput, width: '100%' }} /></label>
        {to && stores.find(s => s.id === to)?.site_id !== siteId && (
          <div style={{ fontSize: 13, color: FIN.muted, background: FIN.blueTint, borderRadius: 8, padding: '8px 10px' }}>
            Another site: Finance records what that site owes this one (2500) when it leaves and when it arrives.
          </div>
        )}
      </div>
      <div style={{ ...finCard, display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ ...label, flex: 1, minWidth: 180 }}>Item<br />
            <select id="send-item" value={pick.item_id} onChange={e => setPick({ ...pick, item_id: e.target.value })} style={{ ...finInput, width: '100%' }}>
              <option value="">— Choose —</option>
              {stock.map(s => <option key={s.item_id} value={s.item_id}>{s.item_code} — {s.description} ({Number(s.available)} free)</option>)}
            </select>
          </label>
          <label style={label}>Qty<br /><input id="send-qty" type="number" min="0" value={pick.qty} onChange={e => setPick({ ...pick, qty: e.target.value })} style={{ ...finInput, width: 90 }} /></label>
          <button style={finBtn2} onClick={add}>Add to truck</button>
        </div>
        {cart.length === 0 ? <div style={{ color: FIN.faint, fontSize: 14, padding: '12px 0' }}>The truck is empty.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>{cart.map((c, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${FIN.lineSoft}` }}>
                <td style={{ padding: '8px 0', fontSize: 14 }}>{c.description} <span style={{ color: FIN.faint, fontSize: 12 }}>{c.code}</span></td>
                <td style={{ textAlign: 'right', fontSize: 14 }}>{c.qty} {c.unit || ''}</td>
                <td style={{ textAlign: 'right', fontSize: 14, color: FIN.muted }}>${money(c.value)}</td>
                <td style={{ textAlign: 'right' }}><button aria-label={`Remove ${c.code}`} onClick={() => setCart(cart.filter((_, j) => j !== i))} style={link}>Remove</button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, color: FIN.muted }}>{cart.length} item{cart.length === 1 ? '' : 's'} · about ${money(total)}</span>
          <button style={finBtn} disabled={busy || !cart.length} onClick={send}>{busy ? 'Dispatching…' : 'Dispatch'}</button>
        </div>
      </div>
    </div>
  )
}
