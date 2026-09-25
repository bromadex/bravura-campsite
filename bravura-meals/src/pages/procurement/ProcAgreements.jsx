import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Modal, showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'

// PR13 — Agreements (issue #55).
//  Blanket order: prices (and optionally quantities) agreed with one supplier for a period; each PO draws
//  down the agreed quantity at the agreed price.
//  Purchase template: a standard list you reorder often (camp consumables, PPE) — pick a supplier each time.
const TYPE = { blanket: 'Blanket order', template: 'Purchase template' }
const STATUS = { draft: ['Draft', FIN.muted, FIN.lineSoft], active: ['Active', FIN.good, FIN.goodTint], closed: ['Closed', FIN.faint, FIN.lineSoft] }

export default function ProcAgreements({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const sc = useSiteScope()
  const [rows, setRows] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [edit, setEdit] = useState(null)
  const [order, setOrder] = useState(null)

  const load = useCallback(async () => {
    if (!sc.siteIds.length) return
    const [a, s] = await Promise.all([
      supabase.rpc('proc_agreement_list', { p_site_ids: sc.siteIds }),
      supabase.from('procurement_suppliers').select('id, supplier_name').eq('status', 'active').order('supplier_name'),
    ])
    if (a.error) showToast(a.error.message, 'red')
    setRows(a.data || []); setSuppliers(s.data || [])
  }, [sc.siteIds])
  useEffect(() => { load() }, [load])

  if (!can('procurement.view')) return <Denied />
  async function setStatus(a, status) {
    const { error } = await supabase.rpc('proc_agreement_set_status', { p_id: a.id, p_status: status })
    if (error) return showToast(error.message, 'red')
    showToast(status === 'active' ? 'Agreement active' : status === 'closed' ? 'Agreement closed' : 'Back to draft'); load()
  }

  return (
    <ProcShell title="Agreements" subtitle="Agreed prices for a period, and standard reorder lists" setPage={setPage} siteText={sc.label}
      actions={<>
        <SiteScopeToggle {...sc} siteName={sc.sites.find(s => s.id === currentSiteId)?.name} />
        {can('procurement.create') && <button style={finBtn} onClick={() => setEdit({ agreement_type: 'blanket', site_id: currentSiteId, lines: [] })}>New agreement</button>}
      </>}>
      {!rows ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : rows.length === 0 ? (
        <div style={{ ...finCard, color: FIN.muted, fontSize: 14 }}>No agreements yet. A <b>blanket order</b> fixes prices with a supplier for a period; a <b>purchase template</b> is a list you reorder often.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {rows.map(a => {
            const [sl, sc2, sbg] = STATUS[a.status]
            const agreed = a.lines.reduce((t, l) => t + Number(l.quantity || 0) * Number(l.price || 0), 0)
            const used = a.lines.reduce((t, l) => t + Number(l.drawn || 0) * Number(l.price || 0), 0)
            return (
              <section key={a.id} style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, color: FIN.muted }}>{a.agreement_no} · {TYPE[a.agreement_type]}</div>
                    <div style={{ fontWeight: 600, fontSize: 16 }}>{a.title}</div>
                    <div style={{ fontSize: 12.5, color: FIN.muted }}>{a.supplier || 'Any supplier'} · {a.site}</div>
                  </div>
                  <span style={{ alignSelf: 'flex-start', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: sbg, color: sc2 }}>{a.expired && a.status === 'active' ? 'Expired' : sl}</span>
                </div>
                <div style={{ fontSize: 12.5, color: FIN.muted }}>
                  {a.valid_from || a.valid_to ? `${a.valid_from || '…'} → ${a.valid_to || '…'}` : 'No end date'} · {a.lines.length} line{a.lines.length === 1 ? '' : 's'}
                </div>
                {a.agreement_type === 'blanket' && agreed > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: FIN.muted, marginBottom: 3 }}>Used ${money(used)} of ${money(agreed)}</div>
                    <div style={{ height: 8, borderRadius: 4, background: FIN.lineSoft }}><div style={{ width: `${Math.min(100, used / agreed * 100)}%`, height: '100%', borderRadius: 4, background: FIN.blue }} /></div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 'auto' }}>
                  {a.status === 'active' && can('procurement.create') && !a.expired && <button style={finBtn} onClick={() => setOrder(a)}>Order from this</button>}
                  {a.status !== 'closed' && <button style={finBtn2} onClick={() => setEdit(a)}>{a.status === 'draft' ? 'Edit' : 'View / edit'}</button>}
                  {a.status === 'draft' && can('procurement.approve') && <button style={finBtn2} onClick={() => setStatus(a, 'active')}>Activate</button>}
                  {a.status === 'active' && can('procurement.edit') && <button style={finBtn2} onClick={() => setStatus(a, 'closed')}>Close</button>}
                </div>
              </section>
            )
          })}
        </div>
      )}
      {edit && <AgreementForm a={edit} suppliers={suppliers} sites={sc.sites} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load() }} />}
      {order && <OrderFrom a={order} suppliers={suppliers} sites={sc.sites} onClose={() => setOrder(null)} onDone={() => { setOrder(null); setPage('proc_orders') }} />}
    </ProcShell>
  )
}

function AgreementForm({ a, suppliers, sites, onClose, onSaved }) {
  const [f, setF] = useState({ site_id: a.site_id, agreement_type: a.agreement_type, supplier_id: a.supplier_id || '', title: a.title || '', valid_from: a.valid_from || '', valid_to: a.valid_to || '', notes: a.notes || '' })
  const [lines, setLines] = useState(() => (a.lines || []).map(l => ({ ...l, item_text: l.item_id ? l.what : '' })).concat(a.lines?.length ? [] : [{ item_text: '', item_id: '', description: '', unit: '', price: '', quantity: '' }]))
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description').limit(5000).then(({ data }) => setItems(data || [])) }, [])
  const label = it => `${it.item_code} — ${it.description}`
  const setLine = (i, p) => setLines(ls => ls.map((l, k) => k === i ? { ...l, ...p } : l))
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('proc_agreement_save', { p: { ...f, id: a.id || null,
      lines: lines.map(l => ({ id: l.id || null, item_id: l.item_id || null, description: l.item_id ? null : (l.description || l.item_text), unit: l.unit, price: l.price, quantity: l.quantity })) } })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Agreement saved'); onSaved()
  }
  const inp = { ...finInput, width: '100%' }
  const lab = { display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }
  return (
    <Modal open onClose={onClose} dirty maxWidth={860} title={a.id ? `${a.agreement_no} · ${a.title}` : 'New agreement'}
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
        <button style={finBtn2} onClick={onClose}>Close</button><button style={finBtn} disabled={busy} onClick={save}>Save</button></div>}>
      <div style={{ fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div role="radiogroup" aria-label="Type" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          {[['blanket', 'Blanket order', 'One supplier, agreed prices for a period'], ['template', 'Purchase template', 'A standard list — choose the supplier each time']].map(([k, t, d]) => (
            <button key={k} role="radio" aria-checked={f.agreement_type === k} onClick={() => setF({ ...f, agreement_type: k })} style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
              border: `1.5px solid ${f.agreement_type === k ? FIN.maroon : FIN.field}`, background: f.agreement_type === k ? FIN.maroonTint : '#fff' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t}</div><div style={{ fontSize: 12, color: FIN.muted }}>{d}</div>
            </button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label style={{ gridColumn: 'span 2' }}><span style={lab}>Title</span><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="e.g. Diesel filters 2026" style={inp} /></label>
          <label><span style={lab}>Site</span><select disabled={!!a.id} value={f.site_id} onChange={e => setF({ ...f, site_id: e.target.value })} style={inp}>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label><span style={lab}>Supplier{f.agreement_type === 'template' ? ' (optional)' : ''}</span>
            <select value={f.supplier_id} onChange={e => setF({ ...f, supplier_id: e.target.value })} style={inp}><option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></label>
          <label><span style={lab}>Valid from</span><input type="date" value={f.valid_from} onChange={e => setF({ ...f, valid_from: e.target.value })} style={inp} /></label>
          <label><span style={lab}>Valid to</span><input type="date" value={f.valid_to} onChange={e => setF({ ...f, valid_to: e.target.value })} style={inp} /></label>
        </div>
        <datalist id="ag-items">{items.map(it => <option key={it.id} value={label(it)} />)}</datalist>
        {lines.map((l, i) => (
          <div key={l.id || i} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 3fr) repeat(3, minmax(80px, 1fr)) auto', gap: 8, alignItems: 'end' }}>
            <label><span style={lab}>Item or service</span><input list="ag-items" value={l.item_id ? l.item_text : (l.item_text || l.description || '')}
              onChange={e => { const it = items.find(x => label(x) === e.target.value); setLine(i, { item_text: e.target.value, item_id: it?.id || '', description: it ? '' : e.target.value }) }} style={inp} /></label>
            <label><span style={lab}>Unit</span><input value={l.unit || ''} onChange={e => setLine(i, { unit: e.target.value })} style={inp} /></label>
            <label><span style={lab}>{f.agreement_type === 'blanket' ? 'Agreed price' : 'Usual price'}</span><input type="number" min="0" step="0.01" value={l.price ?? ''} onChange={e => setLine(i, { price: e.target.value })} style={inp} /></label>
            <label><span style={lab}>{f.agreement_type === 'blanket' ? 'Agreed qty (optional)' : 'Usual qty'}</span><input type="number" min="0" step="any" value={l.quantity ?? ''} onChange={e => setLine(i, { quantity: e.target.value })} style={inp} /></label>
            <button aria-label="Remove line" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))} style={{ ...finBtn2, minHeight: 40, padding: '0 10px' }}>✕</button>
          </div>
        ))}
        <button style={{ ...finBtn2, alignSelf: 'flex-start' }} onClick={() => setLines(ls => [...ls, { item_text: '', item_id: '', description: '', unit: '', price: '', quantity: '' }])}>Add a line</button>
        <label><span style={lab}>Notes / terms</span><textarea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} style={{ ...inp, resize: 'vertical' }} /></label>
      </div>
    </Modal>
  )
}

function OrderFrom({ a, suppliers, sites, onClose, onDone }) {
  const [site, setSite] = useState(a.site_id)
  const [sup, setSup] = useState(a.supplier_id || '')
  const [qty, setQty] = useState(() => Object.fromEntries(a.lines.map(l => [l.id, a.agreement_type === 'template' && l.quantity ? String(Number(l.quantity)) : ''])))
  const [busy, setBusy] = useState(false)
  async function go() {
    setBusy(true)
    const { error } = await supabase.rpc('proc_po_from_agreement', { p_agreement: a.id, p_site: site, p_supplier: sup || null,
      p_lines: Object.entries(qty).map(([agreement_line_id, quantity]) => ({ agreement_line_id, quantity: Number(quantity) || 0 })), p_warehouse: null, p_expected: null })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Draft order created — review and confirm it in Purchase Orders'); onDone()
  }
  const inp = { ...finInput, width: '100%' }
  return (
    <Modal open onClose={onClose} maxWidth={720} title={`Order from ${a.title}`}
      footer={<div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
        <button style={finBtn2} onClick={onClose}>Close</button><button style={finBtn} disabled={busy || (a.agreement_type === 'template' && !sup)} onClick={go}>Create draft order</button></div>}>
      <div style={{ fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <label style={{ fontSize: 12, color: FIN.muted }}>For site<select value={site} onChange={e => setSite(e.target.value)} style={inp}>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {a.agreement_type === 'template' && <label style={{ fontSize: 12, color: FIN.muted }}>Supplier<select value={sup} onChange={e => setSup(e.target.value)} style={inp}><option value="">Choose…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></label>}
        </div>
        {a.lines.map(l => {
          const left = a.agreement_type === 'blanket' && l.quantity != null ? Number(l.quantity) - Number(l.drawn) : null
          return (
            <div key={l.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 3fr) minmax(100px, 1fr)', gap: 8, alignItems: 'end' }}>
              <div style={{ fontSize: 13.5 }}>{l.what}<div style={{ fontSize: 12, color: FIN.muted }}>{l.price ? `$${money(l.price)}${l.unit ? ' / ' + l.unit : ''}` : 'priced from the supplier'}{left != null ? ` · ${left} left` : ''}</div></div>
              <input type="number" min="0" max={left ?? undefined} step="any" aria-label={`Quantity of ${l.what}`} value={qty[l.id]} onChange={e => setQty({ ...qty, [l.id]: e.target.value })} style={inp} />
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
