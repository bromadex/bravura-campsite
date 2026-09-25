import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { Modal, showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'

const ProcSupplierPerf = lazy(() => import('./ProcSupplierPerformance'))

// PR02 — Suppliers (issue #55). One profile per supplier: details and bank, price list, scorecard,
// orders, and hold. Scorecards & aging for all suppliers is a tab.
const HOLD = { none: 'Not on hold', all: 'On hold — everything', bills: 'On hold — bills', payments: 'On hold — payments' }
const BLANK = { supplier_name: '', contact_person: '', phone: '', email: '', address: '', category: '', notes: '', payment_terms_days: 30, reminder_days: 2, bank_name: '', bank_branch: '', bank_account_number: '' }

export default function ProcSuppliers({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const sc = useSiteScope()
  const [tab, setTab] = useState('list')
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState('active')
  const [open, setOpen] = useState(null)  // supplier row or {} for new

  const load = useCallback(async () => {
    if (!sc.siteIds.length) return
    const { data, error } = await supabase.from('procurement_suppliers').select('*, site:sites(name)').in('site_id', sc.siteIds).order('supplier_name')
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [sc.siteIds])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    let r = rows || []
    if (show === 'active') r = r.filter(s => s.status === 'active')
    if (show === 'hold') r = r.filter(s => s.hold_type && s.hold_type !== 'none')
    if (show === 'inactive') r = r.filter(s => s.status !== 'active')
    if (q) { const x = q.toLowerCase(); r = r.filter(s => `${s.supplier_name} ${s.category || ''} ${s.contact_person || ''}`.toLowerCase().includes(x)) }
    return r
  }, [rows, show, q])

  if (!can('procurement.view')) return <Denied />
  return (
    <ProcShell title="Suppliers" subtitle="Who we buy from — details, prices, performance and holds" setPage={setPage} siteText={sc.label}
      tabs={[{ key: 'list', label: 'Suppliers' }, { key: 'scores', label: 'Scorecards & aging' }]} tab={tab} onTab={setTab}
      actions={<>
        <SiteScopeToggle {...sc} siteName={sc.sites.find(s => s.id === currentSiteId)?.name} />
        {can('procurement.create') && <button style={finBtn} onClick={() => setOpen({ ...BLANK })}>New supplier</button>}
      </>}>
      {tab === 'scores' && <Suspense fallback={<div style={{ ...finCard, color: FIN.faint }}>Loading…</div>}><ProcSupplierPerf setPage={setPage} /></Suspense>}
      {tab === 'list' && <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          {[['active', 'Active'], ['hold', 'On hold'], ['inactive', 'Inactive'], ['all', 'All']].map(([k, t]) => (
            <button key={k} aria-pressed={show === k} onClick={() => setShow(k)} style={{ minHeight: 34, padding: '0 12px', borderRadius: 17, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
              ...(show === k ? { border: 'none', background: FIN.maroon, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{t}</button>
          ))}
          <input aria-label="Search suppliers" placeholder="Name, category or contact" value={q} onChange={e => setQ(e.target.value)} style={{ ...finInput, marginLeft: 'auto', minWidth: 220 }} />
        </div>
        {!rows ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : shown.length === 0 ? <div style={{ ...finCard, color: FIN.muted }}>No suppliers here.</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {shown.map(s => (
              <button key={s.id} onClick={() => setOpen(s)} style={{ ...finCard, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
                borderColor: s.hold_type && s.hold_type !== 'none' ? '#E8B4B0' : FIN.line }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: FIN.ink }}>{s.supplier_name}</div>
                <div style={{ fontSize: 12.5, color: FIN.muted }}>{[s.category, s.contact_person, s.phone].filter(Boolean).join(' · ') || '—'}</div>
                <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {sc.scope === 'all' && <span style={{ color: FIN.faint }}>{s.site?.name}</span>}
                  <span style={{ color: FIN.muted }}>{s.payment_terms_days ?? 30} days to pay</span>
                  {s.hold_type && s.hold_type !== 'none' && <span style={{ color: FIN.bad, fontWeight: 600 }}>{HOLD[s.hold_type]}</span>}
                  {s.status !== 'active' && <span style={{ color: FIN.faint }}>Inactive</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </>}
      {open && <SupplierProfile s={open} siteId={currentSiteId} onClose={() => setOpen(null)} onSaved={row => { load(); if (row) setOpen(row) }} setPage={setPage} />}
    </ProcShell>
  )
}

function SupplierProfile({ s, siteId, onClose, onSaved, setPage }) {
  const { can } = usePermissions()
  const { user } = useAuth()
  const isNew = !s.id
  const [tab, setTab] = useState('details')
  const [f, setF] = useState(() => Object.fromEntries(Object.keys(BLANK).map(k => [k, s[k] ?? BLANK[k]])))
  const [busy, setBusy] = useState(false)
  const [score, setScore] = useState(null)
  const [orders, setOrders] = useState(null)
  const [hold, setHold] = useState({ type: s.hold_type || 'none', reason: s.hold_reason || '' })
  const canEdit = can('procurement.edit') || (isNew && can('procurement.create'))

  useEffect(() => {
    if (isNew) return
    supabase.rpc('proc_supplier_scorecard', { p_supplier: s.id }).then(({ data }) => setScore(data))
    supabase.from('purchase_orders').select('id, po_number, status, total_amount, order_date, expected_date, acknowledged_at').eq('supplier_id', s.id)
      .not('status', 'in', '(cancelled)').order('created_at', { ascending: false }).limit(50).then(({ data }) => setOrders(data || []))
  }, [s.id, isNew])

  async function save() {
    if (!f.supplier_name.trim()) return showToast('Enter the supplier name', 'red')
    setBusy(true)
    const body = { ...f, payment_terms_days: Number(f.payment_terms_days) || 0, reminder_days: Number(f.reminder_days) || 0, updated_at: new Date().toISOString() }
    const res = isNew
      ? await supabase.from('procurement_suppliers').insert([{ ...body, status: 'active', site_id: siteId, created_by: user?.id || null }]).select('*, site:sites(name)').single()
      : await supabase.from('procurement_suppliers').update(body).eq('id', s.id).select('*, site:sites(name)').single()
    setBusy(false)
    if (res.error) return showToast(res.error.message, 'red')
    showToast(isNew ? 'Supplier added' : 'Saved'); onSaved(res.data)
  }
  async function setActive(active) {
    const { error } = await supabase.from('procurement_suppliers').update({ status: active ? 'active' : 'inactive', updated_at: new Date().toISOString() }).eq('id', s.id)
    if (error) return showToast(error.message, 'red')
    showToast(active ? 'Supplier re-activated' : 'Supplier made inactive'); onSaved(null); onClose()
  }
  async function saveHold() {
    const { error } = await supabase.rpc('proc_supplier_set_hold', { p_supplier: s.id, p_hold: hold.type, p_reason: hold.reason })
    if (error) return showToast(error.message, 'red')
    showToast(hold.type === 'none' ? 'Hold lifted' : 'Supplier put on hold'); onSaved({ ...s, hold_type: hold.type, hold_reason: hold.reason })
  }

  const lab = { display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }
  const inp = { ...finInput, width: '100%' }
  const field = (k, label, props = {}) => (
    <label key={k}><span style={lab}>{label}</span><input disabled={!canEdit} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} style={inp} {...props} /></label>
  )
  const onTimePct = score && Number(score.delivered) > 0 ? Math.round(Number(score.on_time) / Number(score.delivered) * 100) : null
  const tabs = isNew ? [['details', 'Details']] : [['details', 'Details'], ['prices', 'Price list'], ['score', 'Scorecard'], ['orders', 'Orders'], ['hold', 'Hold']]

  return (
    <Modal open onClose={onClose} dirty={tab === 'details' && canEdit} maxWidth={820} title={isNew ? 'New supplier' : s.supplier_name}
      footer={tab === 'details' && <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', width: '100%' }}>
        {!isNew && can('procurement.edit') && <button style={finBtn2} onClick={() => setActive(s.status !== 'active')}>{s.status === 'active' ? 'Make inactive' : 'Re-activate'}</button>}
        {!isNew && <button style={finBtn2} onClick={() => setPage('fi_pay_suppliers')}>Statement & payments</button>}
        {canEdit && <button style={finBtn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
      </div>}>
      <div style={{ fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {tabs.length > 1 && (
          <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {tabs.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ minHeight: 34, padding: '0 14px', borderRadius: 17, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
              ...(tab === k ? { border: 'none', background: FIN.ink, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{t}</button>)}
          </div>
        )}
        {s.hold_type && s.hold_type !== 'none' && <div role="alert" style={{ fontSize: 13, padding: '8px 12px', borderRadius: 8, background: '#FDF3F2', color: FIN.bad }}>{HOLD[s.hold_type]}: {s.hold_reason}</div>}

        {tab === 'details' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            {field('supplier_name', 'Name')}{field('category', 'Category', { placeholder: 'Tyres, fuel, spares…' })}
            {field('contact_person', 'Contact person')}{field('phone', 'Phone (with country code for WhatsApp)')}
            {field('email', 'Email', { type: 'email' })}{field('address', 'Address')}
            {field('payment_terms_days', 'Days to pay', { type: 'number', min: 0 })}{field('reminder_days', 'Remind days before delivery', { type: 'number', min: 0 })}
            {field('bank_name', 'Bank')}{field('bank_branch', 'Branch')}{field('bank_account_number', 'Account number')}
            <label style={{ gridColumn: '1 / -1' }}><span style={lab}>Notes</span>
              <textarea disabled={!canEdit} rows={2} value={f.notes || ''} onChange={e => setF({ ...f, notes: e.target.value })} style={{ ...inp, resize: 'vertical' }} /></label>
          </div>
        )}

        {tab === 'prices' && <PriceList supplier={s} canEdit={can('procurement.edit') || can('procurement.create')} />}

        {tab === 'score' && (!score ? <div style={{ color: FIN.faint }}>Loading…</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {[['On time', onTimePct == null ? '—' : `${onTimePct}%`, onTimePct != null && onTimePct < 80 ? FIN.bad : FIN.good, `${score.on_time} of ${score.delivered} deliveries`],
              ['Average lead time', score.avg_lead_days == null ? '—' : `${score.avg_lead_days} days`, FIN.ink, 'order to first delivery'],
              ['Rejected', score.reject_rate == null ? '—' : `${score.reject_rate}%`, Number(score.reject_rate) > 5 ? FIN.bad : FIN.ink, 'of quantities received'],
              ['Confirmed orders', `${score.acknowledged} of ${score.orders}`, FIN.ink, 'via the confirmation link'],
              ['Spend, last 12 months', `$${money(score.spend_12m)}`, FIN.ink, `${score.orders} orders`],
              ['Open orders', score.open_orders, Number(score.late_now) > 0 ? FIN.bad : FIN.ink, `${score.late_now} late`],
              ['Owed now', `$${money(score.owed)}`, FIN.ink, 'approved bills not yet paid'],
              ['Price list', score.prices, FIN.ink, 'agreed prices on file']].map(([l, v, c, d]) => (
              <div key={l} style={{ border: `1px solid ${FIN.line}`, borderRadius: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 12, color: FIN.muted }}>{l}</div>
                <div style={{ fontSize: 22, fontFamily: FIN.serif, color: c }}>{v}</div>
                <div style={{ fontSize: 11.5, color: FIN.faint }}>{d}</div>
              </div>
            ))}
          </div>
        ))}

        {tab === 'orders' && (!orders ? <div style={{ color: FIN.faint }}>Loading…</div> : orders.length === 0 ? <div style={{ color: FIN.muted }}>No orders yet.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <tbody>{orders.map(o => (
              <tr key={o.id} style={{ borderBottom: `1px solid ${FIN.lineSoft}` }}>
                <td style={{ padding: '8px 4px', color: FIN.blue, fontWeight: 600 }}>{o.po_number}</td>
                <td style={{ padding: '8px 4px', color: FIN.muted }}>{o.status.replace(/_/g, ' ')}{o.acknowledged_at ? ' · confirmed' : ''}</td>
                <td style={{ padding: '8px 4px', color: FIN.muted }}>{o.order_date || ''}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right' }}>${money(o.total_amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        ))}

        {tab === 'hold' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: FIN.muted }}>A hold stops new orders, bills or payments for this supplier until it's lifted — e.g. during a dispute or while documents are outstanding. Procurement or finance approvers can set it.</div>
            <div role="radiogroup" aria-label="Hold" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(HOLD).map(([k, t]) => <button key={k} role="radio" aria-checked={hold.type === k} onClick={() => setHold({ ...hold, type: k })}
                style={{ minHeight: 36, padding: '0 12px', borderRadius: 18, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
                  ...(hold.type === k ? { border: 'none', background: k === 'none' ? FIN.good : FIN.bad, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{t}</button>)}
            </div>
            {hold.type !== 'none' && <label><span style={lab}>Reason</span><input value={hold.reason} onChange={e => setHold({ ...hold, reason: e.target.value })} style={inp} /></label>}
            <button style={{ ...finBtn, alignSelf: 'flex-start' }} disabled={!(can('procurement.approve') || can('finance.approve'))} onClick={saveHold}>Save hold</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

function PriceList({ supplier, canEdit }) {
  const [rows, setRows] = useState(null)
  const [items, setItems] = useState([])
  const [f, setF] = useState({ item_text: '', item_id: '', unit: '', price: '', min_qty: '', lead_time_days: '', valid_from: '', valid_to: '' })
  const load = useCallback(() => supabase.from('supplier_prices').select('*, item:items(item_code, description)').eq('supplier_id', supplier.id).eq('is_archived', false)
    .order('created_at', { ascending: false }).then(({ data }) => setRows(data || [])), [supplier.id])
  useEffect(() => { load(); supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description').limit(5000).then(({ data }) => setItems(data || [])) }, [load])
  const label = it => `${it.item_code} — ${it.description}`
  async function add() {
    if (!(Number(f.price) >= 0) || f.price === '') return showToast('Enter the price', 'red')
    if (!f.item_id && !f.item_text.trim()) return showToast('Pick an item or describe it', 'red')
    const { error } = await supabase.from('supplier_prices').insert([{ site_id: supplier.site_id, supplier_id: supplier.id, item_id: f.item_id || null,
      description: f.item_id ? null : f.item_text.trim(), unit: f.unit || null, price: Number(f.price), min_qty: Number(f.min_qty) || 0,
      lead_time_days: f.lead_time_days ? Number(f.lead_time_days) : null, valid_from: f.valid_from || null, valid_to: f.valid_to || null }])
    if (error) return showToast(error.message, 'red')
    setF({ item_text: '', item_id: '', unit: '', price: '', min_qty: '', lead_time_days: '', valid_from: '', valid_to: '' }); load()
  }
  async function archive(id) {
    const { error } = await supabase.from('supplier_prices').update({ is_archived: true }).eq('id', id)
    if (error) return showToast(error.message, 'red')
    load()
  }
  const inp = { ...finInput, width: '100%' }
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, color: FIN.muted }}>Agreed prices are used first when this supplier's orders are priced.</div>
      {!rows ? <div style={{ color: FIN.faint }}>Loading…</div> : rows.length === 0 ? <div style={{ color: FIN.muted, fontSize: 13 }}>No prices on file.</div> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: FIN.muted, fontSize: 12 }}><th>Item</th><th style={{ textAlign: 'right' }}>Price</th><th>Min qty</th><th>Lead time</th><th>Valid</th><th /></tr></thead>
          <tbody>{rows.map(r => {
            const expired = r.valid_to && r.valid_to < today
            return (
              <tr key={r.id} style={{ borderTop: `1px solid ${FIN.lineSoft}`, color: expired ? FIN.faint : FIN.ink }}>
                <td style={{ padding: '6px 4px' }}>{r.item ? label(r.item) : r.description}</td>
                <td style={{ padding: '6px 4px', textAlign: 'right' }}>${money(r.price)}{r.unit ? ` / ${r.unit}` : ''}</td>
                <td style={{ padding: '6px 4px' }}>{Number(r.min_qty) || '—'}</td>
                <td style={{ padding: '6px 4px' }}>{r.lead_time_days ? `${r.lead_time_days} days` : '—'}</td>
                <td style={{ padding: '6px 4px' }}>{r.valid_from || '…'} → {r.valid_to || '…'}{expired ? ' (expired)' : ''}</td>
                <td>{canEdit && <button aria-label="Remove price" onClick={() => archive(r.id)} style={{ ...finBtn2, minHeight: 30, padding: '0 8px' }}>✕</button>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      {canEdit && (
        <div style={{ border: `1px solid ${FIN.line}`, borderRadius: 10, padding: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, alignItems: 'end' }}>
          <datalist id="sp-items">{items.map(it => <option key={it.id} value={label(it)} />)}</datalist>
          <label style={{ gridColumn: 'span 2', fontSize: 12, color: FIN.muted }}>Item or service
            <input list="sp-items" value={f.item_text} onChange={e => { const it = items.find(x => label(x) === e.target.value); setF({ ...f, item_text: e.target.value, item_id: it?.id || '' }) }} style={inp} /></label>
          <label style={{ fontSize: 12, color: FIN.muted }}>Price ($)<input type="number" min="0" step="0.01" value={f.price} onChange={e => setF({ ...f, price: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12, color: FIN.muted }}>Unit<input value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12, color: FIN.muted }}>Min qty<input type="number" min="0" value={f.min_qty} onChange={e => setF({ ...f, min_qty: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12, color: FIN.muted }}>Lead days<input type="number" min="0" value={f.lead_time_days} onChange={e => setF({ ...f, lead_time_days: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12, color: FIN.muted }}>Valid from<input type="date" value={f.valid_from} onChange={e => setF({ ...f, valid_from: e.target.value })} style={inp} /></label>
          <label style={{ fontSize: 12, color: FIN.muted }}>Valid to<input type="date" value={f.valid_to} onChange={e => setF({ ...f, valid_to: e.target.value })} style={inp} /></label>
          <button style={finBtn} onClick={add}>Add price</button>
        </div>
      )}
    </div>
  )
}
