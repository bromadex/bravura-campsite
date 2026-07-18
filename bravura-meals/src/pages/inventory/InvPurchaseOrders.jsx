import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast, StatusBadge } from '../../components/ui'
import { sendNotification, notifyApprovers } from '../../utils/notify'

const ACCENT = MODULE_COLORS.inventory

const STATUS_COLORS = {
  draft:              { bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText,  label: 'Draft' },
  sent:               { bg: '#dbeafe',              text: '#1e40af',                label: 'Sent' },
  partially_received: { bg: THEME.statusWarningBg,  text: THEME.statusWarningText,  label: 'Partial' },
  received:           { bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  label: 'Received' },
  cancelled:          { bg: THEME.statusErrorBg,    text: THEME.statusErrorText,    label: 'Cancelled' },
}

export default function InvPurchaseOrders() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [approvedReqs, setApprovedReqs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ supplier_id: '', warehouse_id: '', requisition_id: '', order_date: '', expected_date: '', notes: '' })
  const [lines, setLines] = useState([{ item_id: '', quantity: '', unit_cost: '' }])
  const [saving, setSaving] = useState(false)

  const [receiveModal, setReceiveModal] = useState(false)
  const [receivePo, setReceivePo] = useState(null)
  const [receiveLines, setReceiveLines] = useState([])
  const [receiveSaving, setReceiveSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [poRes, supRes, whRes, itemRes, reqRes] = await Promise.all([
        supabase.from('purchase_orders')
          .select('*, supplier:procurement_suppliers!purchase_orders_supplier_id_fkey(name), warehouse:warehouses!purchase_orders_warehouse_id_fkey(name), creator:profiles!purchase_orders_created_by_fkey(full_name), lines:po_lines(id, item_id, quantity, unit_cost, received_qty, line_total, item:items!po_lines_item_id_fkey(item_code, description))')
          .eq('site_id', currentSiteId)
          .order('created_at', { ascending: false }),
        supabase.from('procurement_suppliers').select('id, name').eq('is_active', true).order('name'),
        supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
        supabase.from('purchase_requisitions').select('id, requisition_no, lines:requisition_lines(item_id, quantity, estimated_cost)')
          .eq('site_id', currentSiteId).eq('status', 'approved'),
      ])
      if (poRes.error) throw poRes.error
      setOrders(poRes.data || [])
      setSuppliers(supRes.data || [])
      setWarehouses(whRes.data || [])
      setItems(itemRes.data || [])
      setApprovedReqs(reqRes.data || [])
    } catch (err) {
      showToast('Failed to load purchase orders', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch])

  const filtered = useMemo(() => {
    let list = orders
    if (statusFilter) list = list.filter(o => o.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(o => o.po_number?.toLowerCase().includes(q) || o.supplier?.name?.toLowerCase().includes(q))
    }
    return list
  }, [orders, search, statusFilter])

  function addLine() { setLines([...lines, { item_id: '', quantity: '', unit_cost: '' }]) }
  function updateLine(i, f, v) { const n = [...lines]; n[i] = { ...n[i], [f]: v }; setLines(n) }
  function removeLine(i) { if (lines.length <= 1) return; setLines(lines.filter((_, idx) => idx !== i)) }

  function openNew() {
    setEditId(null)
    setForm({ supplier_id: '', warehouse_id: '', requisition_id: '', order_date: new Date().toISOString().split('T')[0], expected_date: '', notes: '' })
    setLines([{ item_id: '', quantity: '', unit_cost: '' }])
    setModal(true)
  }

  function fromReq(req) {
    setEditId(null)
    setForm({ supplier_id: '', warehouse_id: '', requisition_id: req.id, order_date: new Date().toISOString().split('T')[0], expected_date: '', notes: `From ${req.requisition_no}` })
    setLines(req.lines?.map(l => ({ item_id: l.item_id, quantity: l.quantity, unit_cost: l.estimated_cost || '' })) || [{ item_id: '', quantity: '', unit_cost: '' }])
    setModal(true)
  }

  async function genPoNo() {
    const { data } = await supabase.from('purchase_orders').select('po_number').eq('site_id', currentSiteId)
      .like('po_number', `PO-${new Date().getFullYear()}-%`).order('po_number', { ascending: false }).limit(1)
    if (data?.length > 0) {
      const num = parseInt(data[0].po_number.split('-').pop(), 10) || 0
      return `PO-${new Date().getFullYear()}-${String(num + 1).padStart(4, '0')}`
    }
    return `PO-${new Date().getFullYear()}-0001`
  }

  async function handleSave(sendIt = false) {
    if (!form.supplier_id) { showToast('Select a supplier', 'red'); return }
    const validLines = lines.filter(l => l.item_id && parseFloat(l.quantity) > 0)
    if (validLines.length === 0) { showToast('Add at least one item line', 'red'); return }
    setSaving(true)
    try {
      const total = validLines.reduce((s, l) => s + parseFloat(l.quantity) * (parseFloat(l.unit_cost) || 0), 0)
      if (editId) {
        const { error } = await supabase.from('purchase_orders').update({
          supplier_id: form.supplier_id,
          warehouse_id: form.warehouse_id || null,
          order_date: form.order_date || null,
          expected_date: form.expected_date || null,
          notes: form.notes || null,
          total_amount: total,
          status: sendIt ? 'sent' : undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', editId)
        if (error) throw error
        await supabase.from('po_lines').delete().eq('po_id', editId)
        const { error: lineErr } = await supabase.from('po_lines').insert(
          validLines.map(l => ({ po_id: editId, item_id: l.item_id, quantity: parseFloat(l.quantity), unit_cost: parseFloat(l.unit_cost) || 0 }))
        )
        if (lineErr) throw lineErr
        showToast(sendIt ? 'PO sent' : 'PO updated', 'green')
        if (sendIt) {
          notifyApprovers({ siteId: currentSiteId, permissionCode: 'inventory.approve', type: 'inventory_approval', title: 'Purchase Order Sent', body: `A purchase order has been sent and may need your attention.`, actionUrl: '/inventory/purchase-orders' })
        }
      } else {
        const poNo = await genPoNo()
        const { data: newPo, error } = await supabase.from('purchase_orders').insert({
          po_number: poNo, site_id: currentSiteId, supplier_id: form.supplier_id,
          warehouse_id: form.warehouse_id || null, requisition_id: form.requisition_id || null,
          order_date: form.order_date || null, expected_date: form.expected_date || null,
          notes: form.notes || null, total_amount: total,
          status: sendIt ? 'sent' : 'draft', created_by: profile?.id,
        }).select().single()
        if (error) throw error
        const { error: lineErr } = await supabase.from('po_lines').insert(
          validLines.map(l => ({ po_id: newPo.id, item_id: l.item_id, quantity: parseFloat(l.quantity), unit_cost: parseFloat(l.unit_cost) || 0 }))
        )
        if (lineErr) throw lineErr
        if (form.requisition_id) {
          await supabase.from('purchase_requisitions').update({ status: 'ordered' }).eq('id', form.requisition_id)
        }
        showToast(`PO ${poNo} created`, 'green')
        if (sendIt) {
          notifyApprovers({ siteId: currentSiteId, permissionCode: 'inventory.approve', type: 'inventory_approval', title: 'Purchase Order Sent', body: `Purchase order ${poNo} has been sent.`, actionUrl: '/inventory/purchase-orders' })
        }
      }
      setModal(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  function openReceive(po) {
    setReceivePo(po)
    setReceiveLines((po.lines || []).map(l => ({ ...l, receive_qty: '' })))
    setReceiveModal(true)
  }

  async function handleReceive() {
    const toReceive = receiveLines.filter(l => parseFloat(l.receive_qty) > 0)
    if (toReceive.length === 0) { showToast('Enter quantities to receive', 'red'); return }
    setReceiveSaving(true)
    try {
      const grnRows = toReceive.map(l => ({
        item_id: l.item_id, warehouse_id: receivePo.warehouse_id,
        movement_type: 'grn', quantity: parseFloat(l.receive_qty),
        unit_cost: l.unit_cost || 0, value: parseFloat(l.receive_qty) * (l.unit_cost || 0),
        voucher_type: 'PO', voucher_no: receivePo.po_number,
        source_module: 'inventory', source_reference_id: receivePo.id,
        notes: `Received against ${receivePo.po_number}`, created_by: profile?.id,
      }))
      const { error: movErr } = await supabase.from('inventory_movements').insert(grnRows)
      if (movErr) throw movErr

      for (const l of toReceive) {
        const newRcv = (l.received_qty || 0) + parseFloat(l.receive_qty)
        await supabase.from('po_lines').update({ received_qty: newRcv }).eq('id', l.id)
      }

      const allLines = receivePo.lines || []
      const fullyReceived = allLines.every(l => {
        const rcv = toReceive.find(r => r.id === l.id)
        const total = (l.received_qty || 0) + (rcv ? parseFloat(rcv.receive_qty) : 0)
        return total >= l.quantity
      })

      await supabase.from('purchase_orders').update({
        status: fullyReceived ? 'received' : 'partially_received',
        updated_at: new Date().toISOString(),
      }).eq('id', receivePo.id)

      showToast(`Received ${toReceive.length} item(s) against ${receivePo.po_number}`, 'green')
      if (receivePo.created_by) {
        sendNotification({ recipientId: receivePo.created_by, type: 'inventory_po_received', title: 'Goods Received', body: `${toReceive.length} item(s) received against ${receivePo.po_number}.`, actionUrl: '/inventory/purchase-orders' })
      }
      setReceiveModal(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setReceiveSaving(false)
  }

  function handleExport() {
    const headers = ['PO #', 'Date', 'Supplier', 'Status', 'Items', 'Total', 'Created By']
    const rows = filtered.map(o => [
      o.po_number, o.order_date || '', o.supplier?.name || '', o.status,
      o.lines?.length || 0, o.total_amount?.toFixed(2) || '', o.creator?.full_name || '',
    ])
    exportCsv('purchase_orders.csv', headers, rows)
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <PageHeader title="Purchase Orders" site={currentSite} actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button icon="download" onClick={handleExport}>Export</Button>
          {can('inventory.create') && <Button icon="add" variant="filled" onClick={openNew}>New PO</Button>}
        </div>
      } />

      {approvedReqs.length > 0 && (
        <Card style={{ padding: '14px 18px', marginBottom: '14px', background: ACCENT + '08', border: `1px solid ${ACCENT}30` }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: ACCENT, marginBottom: '8px' }}>Approved Requisitions Ready for PO</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {approvedReqs.map(r => (
              <button key={r.id} onClick={() => fromReq(r)} style={{
                padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                background: THEME.surface, border: `1px solid ${THEME.outline}`, cursor: 'pointer',
                color: ACCENT, fontFamily: 'inherit',
              }}>{r.requisition_no} ({r.lines?.length || 0} items)</button>
            ))}
          </div>
        </Card>
      )}

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input placeholder="Search PO or supplier..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} orders</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['PO #', 'Date', 'Supplier', 'Warehouse', 'Status', 'Items', 'Total', 'Actions'].map(h => (
                  <th key={h} style={{ ...th, textAlign: ['Items', 'Total'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No purchase orders</td></tr>
              ) : filtered.map(o => {
                const s = STATUS_COLORS[o.status] || STATUS_COLORS.draft
                return (
                  <tr key={o.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: ACCENT, fontFamily: 'monospace', fontSize: '12px' }}>{o.po_number}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{o.order_date || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 500 }}>{o.supplier?.name || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed }}>{o.warehouse?.name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <StatusBadge status={o.status} />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{o.lines?.length || 0}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{o.total_amount ? `$${o.total_amount.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {(o.status === 'sent' || o.status === 'partially_received') && o.warehouse_id && can('inventory.create') && (
                          <button onClick={() => openReceive(o)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Receive goods">
                            <Icon name="move_to_inbox" size={16} style={{ color: '#16a34a' }} />
                          </button>
                        )}
                        {o.status === 'draft' && can('inventory.edit') && (
                          <button onClick={() => { setEditId(o.id); setForm({ supplier_id: o.supplier_id || '', warehouse_id: o.warehouse_id || '', requisition_id: o.requisition_id || '', order_date: o.order_date || '', expected_date: o.expected_date || '', notes: o.notes || '' }); setLines(o.lines?.map(l => ({ item_id: l.item_id, quantity: l.quantity, unit_cost: l.unit_cost })) || [{ item_id: '', quantity: '', unit_cost: '' }]); setModal(true) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Purchase Order' : 'New Purchase Order'}
        footer={<>
          <Button variant="text" onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="outlined" onClick={() => handleSave(false)} disabled={saving}>Save Draft</Button>
          <Button variant="filled" onClick={() => handleSave(true)} disabled={saving}>{saving ? 'Saving...' : 'Save & Send'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Supplier *</SectionLabel>
              <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} style={inp}>
                <option value="">— Select —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Deliver To Warehouse</SectionLabel>
              <select value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })} style={inp}>
                <option value="">— Select —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Order Date</SectionLabel>
              <input type="date" value={form.order_date} onChange={e => setForm({ ...form, order_date: e.target.value })} style={inp} />
            </div>
            <div>
              <SectionLabel>Expected Delivery</SectionLabel>
              <input type="date" value={form.expected_date} onChange={e => setForm({ ...form, expected_date: e.target.value })} style={inp} />
            </div>
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={inp} />
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: ACCENT, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' }}>Line Items</div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
              <div>
                {i === 0 && <SectionLabel>Item *</SectionLabel>}
                <select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} style={inp}>
                  <option value="">— Select —</option>
                  {items.map(it => <option key={it.id} value={it.id}>{it.item_code} — {it.description}</option>)}
                </select>
              </div>
              <div>
                {i === 0 && <SectionLabel>Qty *</SectionLabel>}
                <input type="number" min="0.01" step="0.01" value={l.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} style={inp} />
              </div>
              <div>
                {i === 0 && <SectionLabel>Unit Cost</SectionLabel>}
                <input type="number" min="0" step="0.01" value={l.unit_cost} onChange={e => updateLine(i, 'unit_cost', e.target.value)} style={inp} />
              </div>
              <div style={{ paddingBottom: '2px' }}>
                {lines.length > 1 && (
                  <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px' }}>
                    <Icon name="close" size={18} style={{ color: THEME.textLow }} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button icon="add" variant="text" onClick={addLine} style={{ alignSelf: 'flex-start' }}>Add Line</Button>
        </div>
      </Modal>

      <Modal open={receiveModal} onClose={() => setReceiveModal(false)} title={`Receive: ${receivePo?.po_number || ''}`}
        footer={<>
          <Button variant="text" onClick={() => setReceiveModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={handleReceive} disabled={receiveSaving}>{receiveSaving ? 'Receiving...' : 'Receive Goods'}</Button>
        </>}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Item', 'Ordered', 'Received', 'Outstanding', 'Receive Now'].map(h => (
                  <th key={h} style={{ ...th, textAlign: h !== 'Item' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {receiveLines.map((l, i) => {
                const outstanding = l.quantity - (l.received_qty || 0)
                return (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 10px', color: THEME.text }}>{l.item?.item_code} — {l.item?.description}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{l.quantity}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.textMed }}>{l.received_qty || 0}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: outstanding > 0 ? THEME.warning : '#16a34a' }}>{outstanding}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <input type="number" min="0" max={outstanding} step="0.01"
                        value={l.receive_qty}
                        onChange={e => { const n = [...receiveLines]; n[i] = { ...n[i], receive_qty: e.target.value }; setReceiveLines(n) }}
                        style={{ ...inp, width: '80px', padding: '6px 8px', textAlign: 'right' }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  )
}
