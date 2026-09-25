import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, finBtn2, finInput } from '../../utils/financeTheme'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ProcGRN = lazy(() => import('./ProcGRN'))

// PR08 — Receiving (issue #54). The site ticks off what arrived against its open orders — stock goes on
// the shelf, services are confirmed as done. "Receipts" keeps the GRN history and landed costs.
export default function ProcReceiving({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const sc = useSiteScope()
  const rt = useRealtimeRefresh('purchase_orders', { column: 'site_id', value: currentSiteId })
  const [tab, setTab] = useState('receive')
  const [pos, setPos] = useState(null)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    if (!sc.siteIds.length) return
    const { data, error } = await supabase.from('purchase_orders')
      .select('id, po_number, status, expected_date, acknowledged_at, site_id, site:sites(name), supplier:procurement_suppliers(supplier_name), warehouse:warehouses(name), lines:po_lines(id, item_id, description, unit, quantity, received_qty, promised_date, is_archived, item:items(item_code, description))')
      .in('site_id', sc.siteIds).in('status', ['sent', 'partially_received']).order('expected_date', { ascending: true, nullsFirst: false })
    if (error) showToast(error.message, 'red')
    setPos(data || [])
  }, [sc.siteIds])
  useEffect(() => { load() }, [load, rt])

  if (!can('procurement.view') && !can('inventory.view')) return <Denied />
  const today = new Date().toISOString().slice(0, 10)

  return (
    <ProcShell title="Receiving" subtitle="Tick off deliveries against open orders" setPage={setPage} siteText={sc.label}
      tabs={[{ key: 'receive', label: 'To receive', count: pos?.length || 0 }, { key: 'receipts', label: 'Receipts & landed costs' }]} tab={tab} onTab={setTab}
      actions={<SiteScopeToggle {...sc} siteName={sc.sites.find(s => s.id === currentSiteId)?.name} />}>
      {tab === 'receipts' && <Suspense fallback={<div style={{ ...finCard, color: FIN.faint }}>Loading…</div>}><ProcGRN setPage={setPage} /></Suspense>}
      {tab === 'receive' && (!pos ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : pos.length === 0 ? (
        <div style={{ ...finCard, color: FIN.muted, fontSize: 14 }}>No deliveries expected — ordered POs appear here until everything has arrived.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pos.map(p => {
            const lines = (p.lines || []).filter(l => !l.is_archived)
            const left = lines.filter(l => Number(l.received_qty) < Number(l.quantity)).length
            const late = p.expected_date && p.expected_date < today
            return (
              <div key={p.id} style={{ ...finCard, padding: '12px 16px' }}>
                <button onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id}
                  style={{ width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>
                    <span style={{ fontWeight: 600, color: FIN.blue }}>{p.po_number}</span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: FIN.ink, marginLeft: 8 }}>{p.supplier?.supplier_name}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: FIN.muted }}>
                      {p.site?.name}{p.warehouse?.name ? ` · into ${p.warehouse.name}` : ''} · {left} of {lines.length} line{lines.length === 1 ? '' : 's'} still to come
                      {!p.acknowledged_at && ' · not confirmed by supplier'}
                    </span>
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: late ? FIN.bad : FIN.muted }}>
                    {p.expected_date ? `${late ? 'Late — was due' : 'Due'} ${new Date(p.expected_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'No date'}
                  </span>
                </button>
                {open === p.id && <ReceiveForm po={p} lines={lines} canReceive={can('procurement.create') || can('inventory.create')} onDone={() => { setOpen(null); load() }} />}
              </div>
            )
          })}
        </div>
      ))}
    </ProcShell>
  )
}

function ReceiveForm({ po, lines, canReceive, onDone }) {
  const open = lines.filter(l => Number(l.received_qty) < Number(l.quantity))
  const [qty, setQty] = useState(() => Object.fromEntries(open.map(l => [l.id, String(Number(l.quantity) - Number(l.received_qty))])))
  const [rej, setRej] = useState({})
  const [why, setWhy] = useState({})
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const payload = open.map(l => ({ po_line_id: l.id, qty: Number(qty[l.id] || 0), rejected: Number(rej[l.id] || 0), reason: why[l.id] || null })).filter(x => x.qty > 0)
    if (!payload.length) return showToast('Enter what arrived on at least one line', 'red')
    if (payload.some(x => x.rejected > 0 && !x.reason)) return showToast('Say why items were rejected', 'red')
    setBusy(true)
    const { error } = await supabase.rpc('proc_receive_po', { p_po_id: po.id, p_lines: payload, p_delivery_ref: ref || null, p_notes: notes || null })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Delivery received')
    onDone()
  }
  const inp = { ...finInput, width: '100%' }
  return (
    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {open.map(l => {
        const due = Number(l.quantity) - Number(l.received_qty)
        return (
          <div key={l.id} style={{ border: `1px solid ${FIN.line}`, borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: 'minmax(180px, 2fr) repeat(3, minmax(90px, 1fr))', gap: 8, alignItems: 'end' }}>
            <div style={{ fontSize: 13.5 }}>
              <div style={{ fontWeight: 600 }}>{l.item ? `${l.item.item_code} — ${l.item.description}` : l.description}</div>
              <div style={{ fontSize: 12, color: FIN.muted }}>{due} {l.unit || ''} still to come{!l.item_id && ' · service — confirm it was done'}</div>
            </div>
            <label style={{ fontSize: 12, color: FIN.muted }}>{l.item_id ? 'Arrived' : 'Done'}
              <input type="number" inputMode="decimal" min="0" max={due} step="any" value={qty[l.id] ?? ''} onChange={e => setQty({ ...qty, [l.id]: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: FIN.muted }}>Rejected
              <input type="number" inputMode="decimal" min="0" step="any" value={rej[l.id] ?? ''} onChange={e => setRej({ ...rej, [l.id]: e.target.value })} style={inp} /></label>
            <label style={{ fontSize: 12, color: FIN.muted }}>Why rejected
              <input value={why[l.id] || ''} onChange={e => setWhy({ ...why, [l.id]: e.target.value })} placeholder="damaged, wrong item…" style={inp} /></label>
          </div>
        )
      })}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
        <label style={{ fontSize: 12, color: FIN.muted }}>Supplier's delivery note no.
          <input value={ref} onChange={e => setRef(e.target.value)} style={inp} /></label>
        <label style={{ fontSize: 12, color: FIN.muted }}>Notes
          <input value={notes} onChange={e => setNotes(e.target.value)} style={inp} /></label>
      </div>
      {canReceive ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={finBtn2} onClick={() => setQty(Object.fromEntries(open.map(l => [l.id, '0'])))}>Clear</button>
          <button style={finBtn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Receive delivery'}</button>
        </div>
      ) : <div style={{ fontSize: 12.5, color: FIN.faint }}>You can see deliveries but not record them.</div>}
    </div>
  )
}
