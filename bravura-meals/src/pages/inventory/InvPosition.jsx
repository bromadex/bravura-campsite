import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { exportCsv } from '../../utils/csv'
import { useAskContext } from '../../components/AskBravura'

// IN21 — stock position (issue #59, I3): on hand, reserved, free to use, on order (open POs), on the way (shipments),
// and reservations — stock held in a store for a request or a work order so nobody else issues it.
const n = v => Number(v || 0)
const q = v => n(v).toLocaleString('en-US', { maximumFractionDigits: 3 })
const link = { background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }

export default function InvPosition({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { scope, setScope, siteIds, multi, label } = useSiteScope()
  const [tab, setTab] = useState('position')
  const [rows, setRows] = useState([])
  const [res, setRes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [only, setOnly] = useState('all')
  const [reserveFor, setReserveFor] = useState(null)   // position row being reserved

  const load = useCallback(async () => {
    if (!siteIds.length) return
    setLoading(true)
    const [p, r] = await Promise.all([
      supabase.rpc('inv_position', { p_site_ids: siteIds }),
      supabase.from('stock_reservations').select('*, item:items(item_code, description), warehouse:warehouses(name, site_id), request:purchase_requisitions(requisition_no, title), wo:fleet_work_orders(work_order_number)')
        .eq('status', 'open').order('created_at', { ascending: false }).limit(500),
    ])
    if (p.error) showToast(friendlyError(p.error), 'red')
    setRows(p.data || [])
    setRes((r.data || []).filter(x => siteIds.includes(x.warehouse?.site_id)))
    setLoading(false)
  }, [siteIds])
  useEffect(() => { load() }, [load])

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return rows.filter(r => {
      if (s && !`${r.item_code} ${r.description} ${r.bin || ''}`.toLowerCase().includes(s)) return false
      if (only === 'reserved') return n(r.reserved) > 0
      if (only === 'transit') return n(r.in_transit) > 0
      if (only === 'order') return n(r.on_order) > 0
      if (only === 'short') return n(r.reorder_at) > 0 && n(r.available) + n(r.on_order) + n(r.in_transit) <= n(r.reorder_at)
      return true
    })
  }, [rows, search, only])

  const tot = useMemo(() => ({
    value: rows.reduce((s, r) => s + n(r.value), 0),
    reservedValue: rows.reduce((s, r) => s + (n(r.on_hand) > 0 ? n(r.reserved) * n(r.value) / n(r.on_hand) : 0), 0),
    transit: rows.filter(r => n(r.in_transit) > 0).length,
    order: rows.filter(r => n(r.on_order) > 0).length,
    short: rows.filter(r => n(r.reorder_at) > 0 && n(r.available) + n(r.on_order) + n(r.in_transit) <= n(r.reorder_at)).length,
  }), [rows])
  useAskContext({ screen: 'Stock position', sites: label, stock_value: Math.round(tot.value), reserved_value: Math.round(tot.reservedValue),
    items_below_reorder_after_orders: tot.short, open_reservations: res.length,
    rows: list.slice(0, 40).map(r => ({ item: `${r.item_code} ${r.description}`, store: r.warehouse, on_hand: n(r.on_hand), reserved: n(r.reserved), free: n(r.available), on_order: n(r.on_order), in_transit: n(r.in_transit) })) })

  async function release(r) {
    if (!confirm(`Release ${q(n(r.qty) - n(r.qty_issued))} ${r.item?.description} held for ${r.request?.requisition_no || r.wo?.work_order_number}?`)) return
    const { error } = await supabase.rpc('inv_release', { p_id: r.id })
    if (error) return showToast(friendlyError(error), 'red')
    showToast('Released', 'green'); load()
  }

  function exportRows() {
    exportCsv('stock_position.csv', ['Item code', 'Description', 'Store', 'Site', 'Bin', 'On hand', 'Reserved', 'Free', 'On order', 'On the way', 'Reorder at', 'Value'],
      list.map(r => [r.item_code, r.description, r.warehouse, r.site, r.bin || '', n(r.on_hand), n(r.reserved), n(r.available), n(r.on_order), n(r.in_transit), r.reorder_at ?? '', n(r.value).toFixed(2)]))
  }

  if (!can('inventory.view')) return <Denied />
  const th = { textAlign: 'right', padding: '10px 10px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
  const td = { padding: '8px 10px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 14, textAlign: 'right' }
  const kpi = (lbl, v, sub) => (
    <div style={{ ...finCard, padding: '14px 16px', flex: '1 1 160px' }}>
      <div style={{ fontSize: 12, color: FIN.muted }}>{lbl}</div>
      <div style={{ fontSize: 24, fontWeight: 600, fontFamily: FIN.serif, marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 12, color: FIN.faint }}>{sub}</div>}
    </div>
  )

  return (
    <FinShell module="Stores" homePage="inv_dashboard" setPage={setPage} title="Stock position" siteText={label}
      subtitle="What is on the shelf, what is spoken for, and what is coming."
      actions={<>
        <SiteScopeToggle scope={scope} setScope={setScope} multi={multi} />
        <button style={finBtn2} onClick={exportRows}>Export CSV</button>
      </>}
      tabs={[{ key: 'position', label: 'Position' }, { key: 'reservations', label: 'Reservations', count: res.length }]} tab={tab} onTab={setTab}>
      {tab === 'position' ? <>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {kpi('Stock value', `$${money(tot.value)}`)}
          {kpi('Reserved', `$${money(tot.reservedValue)}`, `${res.length} open reservation${res.length === 1 ? '' : 's'}`)}
          {kpi('On order', tot.order, 'items with open POs')}
          {kpi('On the way', tot.transit, 'items in transit to a store')}
          {kpi('Still short', tot.short, 'at or below reorder even after orders')}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input id="pos-search" aria-label="Search" placeholder="Search item, code or bin" value={search} onChange={e => setSearch(e.target.value)} style={{ ...finInput, width: 260 }} />
          {[['all', 'Everything'], ['reserved', 'Reserved'], ['order', 'On order'], ['transit', 'On the way'], ['short', 'Still short']].map(([k, l]) => (
            <button key={k} onClick={() => setOnly(k)} style={{ minHeight: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${only === k ? FIN.maroon : FIN.field}`,
              background: only === k ? FIN.maroonTint : '#fff', color: only === k ? FIN.maroon : FIN.ink, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>{l}</button>
          ))}
        </div>
        <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>Item</th><th style={{ ...th, textAlign: 'left' }}>Store</th>
              <th style={th}>On hand</th><th style={th}>Reserved</th><th style={th}>Free</th><th style={th}>On order</th><th style={th}>On the way</th>
              <th style={th}>Reorder at</th><th style={th}>Value</th><th style={th} />
            </tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: 32, color: FIN.faint }}>Loading…</td></tr>
                : list.length === 0 ? <tr><td colSpan={10} style={{ ...td, textAlign: 'center', padding: 32, color: FIN.faint }}>Nothing to show</td></tr>
                : list.slice(0, 500).map(r => {
                  const short = n(r.reorder_at) > 0 && n(r.available) + n(r.on_order) + n(r.in_transit) <= n(r.reorder_at)
                  return (
                    <tr key={`${r.item_id}-${r.warehouse_id}`}>
                      <td style={{ ...td, textAlign: 'left' }}><span style={{ fontSize: 12, color: FIN.muted }}>{r.item_code}{r.bin ? ` · bin ${r.bin}` : ''}</span><br />{r.description}</td>
                      <td style={{ ...td, textAlign: 'left', color: FIN.muted }}>{r.warehouse}{scope === 'all' ? <><br /><span style={{ fontSize: 12 }}>{r.site}</span></> : null}</td>
                      <td style={td}>{q(r.on_hand)} <span style={{ fontSize: 12, color: FIN.faint }}>{r.unit || ''}</span></td>
                      <td style={{ ...td, color: n(r.reserved) ? FIN.ochreText : FIN.faint }}>{n(r.reserved) ? q(r.reserved) : '—'}</td>
                      <td style={{ ...td, fontWeight: 600, color: short ? FIN.bad : FIN.ink }}>{q(r.available)}</td>
                      <td style={{ ...td, color: n(r.on_order) ? FIN.blue : FIN.faint }}>{n(r.on_order) ? q(r.on_order) : '—'}</td>
                      <td style={{ ...td, color: n(r.in_transit) ? FIN.blue : FIN.faint }}>{n(r.in_transit) ? q(r.in_transit) : '—'}</td>
                      <td style={{ ...td, color: FIN.muted }}>{r.reorder_at ?? '—'}</td>
                      <td style={td}>${money(r.value)}</td>
                      <td style={td}>{can('inventory.create') && n(r.available) > 0 && r.site && <button style={link} onClick={() => setReserveFor(r)}>Reserve</button>}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
        {list.length > 500 && <div style={{ fontSize: 13, color: FIN.muted }}>Showing 500 of {list.length} — search to narrow down, or export.</div>}
      </> : (
        <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>Item</th><th style={{ ...th, textAlign: 'left' }}>Store</th><th style={{ ...th, textAlign: 'left' }}>Held for</th>
              <th style={th}>Reserved</th><th style={th}>Issued</th><th style={th}>Still held</th><th style={{ ...th, textAlign: 'left' }}>Needed by</th><th style={th} />
            </tr></thead>
            <tbody>
              {res.length === 0 ? <tr><td colSpan={8} style={{ ...td, textAlign: 'center', padding: 32, color: FIN.faint }}>No open reservations. Reserve from the Position tab.</td></tr>
                : res.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...td, textAlign: 'left' }}><span style={{ fontSize: 12, color: FIN.muted }}>{r.item?.item_code}</span><br />{r.item?.description}</td>
                    <td style={{ ...td, textAlign: 'left', color: FIN.muted }}>{r.warehouse?.name}</td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      {r.request ? <button style={link} onClick={() => setPage(`proc_requisitions:${r.requisition_id}`)}>{r.request.requisition_no}</button>
                        : r.wo ? <>Work order {r.wo.work_order_number}</> : '—'}
                      {r.notes ? <div style={{ fontSize: 12, color: FIN.faint }}>{r.notes}</div> : null}
                    </td>
                    <td style={td}>{q(r.qty)}</td><td style={td}>{q(r.qty_issued)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{q(n(r.qty) - n(r.qty_issued))}</td>
                    <td style={{ ...td, textAlign: 'left', color: r.needed_by && new Date(r.needed_by) < new Date() ? FIN.bad : FIN.ink }}>{r.needed_by || '—'}</td>
                    <td style={td}>{can('inventory.create') && <button style={link} onClick={() => release(r)}>Release</button>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {reserveFor && <ReserveDialog row={reserveFor} siteId={currentSiteId} onClose={() => setReserveFor(null)} onDone={() => { setReserveFor(null); load() }} />}
    </FinShell>
  )
}

function ReserveDialog({ row, onClose, onDone }) {
  const [kind, setKind] = useState('request')
  const [reqs, setReqs] = useState([])
  const [wos, setWos] = useState([])
  const [form, setForm] = useState({ ref: '', qty: '', needed_by: '', notes: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('warehouses').select('site_id').eq('id', row.warehouse_id).single().then(({ data }) => {
      if (!data) return
      supabase.from('purchase_requisitions').select('id, requisition_no, title').eq('site_id', data.site_id).in('status', ['submitted', 'approved', 'ordered'])
        .eq('is_archived', false).order('created_at', { ascending: false }).limit(100).then(r => setReqs(r.data || []))
      supabase.from('fleet_work_orders').select('id, work_order_number, fault_description').eq('site_id', data.site_id).not('status', 'in', '(completed,closed,cancelled)')
        .order('created_at', { ascending: false }).limit(100).then(r => setWos(r.data || []))
    })
  }, [row.warehouse_id])

  async function save() {
    const qty = Number(form.qty)
    if (!form.ref) return showToast(`Choose the ${kind === 'request' ? 'request' : 'work order'}`, 'red')
    if (!(qty > 0) || qty > n(row.available)) return showToast(`Reserve between 0 and ${q(row.available)}`, 'red')
    setBusy(true)
    const { error } = await supabase.rpc('inv_reserve', { p: { warehouse_id: row.warehouse_id, [kind === 'request' ? 'requisition_id' : 'work_order_id']: form.ref,
      needed_by: form.needed_by || null, notes: form.notes || null, lines: [{ item_id: row.item_id, qty }] } })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast('Reserved', 'green'); onDone()
  }

  const label = { fontSize: 12, color: FIN.muted, display: 'block' }
  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ ...finCard, width: 'min(480px, 100%)', display: 'grid', gap: 12, fontFamily: FIN.sans }}>
        <h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>Reserve stock</h2>
        <div style={{ fontSize: 14, color: FIN.muted }}>{row.description} · {row.warehouse} · {q(row.available)} {row.unit || ''} free</div>
        <div role="radiogroup" style={{ display: 'flex', gap: 6 }}>
          {[['request', 'For a request'], ['wo', 'For a work order']].map(([k, l]) => (
            <button key={k} role="radio" aria-checked={kind === k} onClick={() => { setKind(k); setForm({ ...form, ref: '' }) }}
              style={{ minHeight: 36, padding: '0 14px', borderRadius: 999, border: `1px solid ${kind === k ? FIN.maroon : FIN.field}`, background: kind === k ? FIN.maroonTint : '#fff', color: kind === k ? FIN.maroon : FIN.ink, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>{l}</button>
          ))}
        </div>
        <label style={label}>{kind === 'request' ? 'Request' : 'Work order'}
          <select id="reserve-ref" value={form.ref} onChange={e => setForm({ ...form, ref: e.target.value })} style={{ ...finInput, width: '100%', marginTop: 4 }}>
            <option value="">— Choose —</option>
            {kind === 'request' ? reqs.map(r => <option key={r.id} value={r.id}>{r.requisition_no} — {r.title || ''}</option>)
              : wos.map(w => <option key={w.id} value={w.id}>{w.work_order_number} — {(w.fault_description || '').slice(0, 50)}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...label, flex: 1 }}>Quantity<input id="reserve-qty" type="number" min="0" max={row.available} value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} style={{ ...finInput, width: '100%', marginTop: 4 }} /></label>
          <label style={{ ...label, flex: 1 }}>Needed by<input id="reserve-date" type="date" value={form.needed_by} onChange={e => setForm({ ...form, needed_by: e.target.value })} style={{ ...finInput, width: '100%', marginTop: 4 }} /></label>
        </div>
        <label style={label}>Note<input id="reserve-note" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={{ ...finInput, width: '100%', marginTop: 4 }} /></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button style={finBtn2} onClick={onClose}>Cancel</button>
          <button style={finBtn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Reserve'}</button>
        </div>
      </div>
    </div>
  )
}
