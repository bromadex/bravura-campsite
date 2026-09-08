import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Button, Icon, PageHeader, StatusBadge, showToast, TableWrap, THead, Th, TRow, Td, ModalOverlay } from '../../components/ui'
import QuickNav from '../../components/QuickNav'
import { PROCUREMENT_PILLS } from './ProcDashboard'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const CLR = MODULE_COLORS.procurement
const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function ProcInvoices({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const rt = useRealtimeRefresh('purchase_invoices', { column: 'site_id', value: currentSiteId })

  const [invoices, setInvoices] = useState([])
  const [pos, setPos] = useState([])
  const [grns, setGrns] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ po_id: '', grn_id: '', supplier_id: '', invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], due_date: '', notes: '' })
  const [lines, setLines] = useState([{ item_description: '', quantity: '', unit: '', unit_price: '' }])
  const [detail, setDetail] = useState(null)

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [invRes, poRes, grnRes, sRes] = await Promise.all([
      supabase.from('purchase_invoices').select('*, invoice_lines(*), po:purchase_orders(po_number), grn:goods_received_notes(grn_number), supplier:procurement_suppliers(supplier_name), creator:profiles!created_by(full_name, username), approver_profile:profiles!approved_by(full_name, username)')
        .eq('site_id', currentSiteId).order('created_at', { ascending: false }),
      supabase.from('purchase_orders').select('id, po_number, supplier_id, supplier:procurement_suppliers(supplier_name)')
        .eq('site_id', currentSiteId).in('status', ['approved', 'ordered', 'partial']).order('po_number'),
      supabase.from('goods_received_notes').select('id, grn_number, supplier_id, po_id')
        .eq('site_id', currentSiteId).in('status', ['accepted', 'accepted_partial']).order('grn_number'),
      supabase.from('procurement_suppliers').select('id, supplier_name').eq('site_id', currentSiteId).eq('status', 'active').order('supplier_name'),
    ])
    setInvoices(invRes.data || [])
    setPos(poRes.data || [])
    setGrns(grnRes.data || [])
    setSuppliers(sRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetchAll() }, [currentSiteId, fetchAll, rt])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return invoices
      .filter(i => statusFilter === 'all' || i.status === statusFilter)
      .filter(i => !q || i.invoice_number?.toLowerCase().includes(q) || i.supplier?.supplier_name?.toLowerCase().includes(q) || i.po?.po_number?.toLowerCase().includes(q))
  }, [invoices, search, statusFilter])

  const kpi = useMemo(() => {
    const total = invoices.length
    const draft = invoices.filter(i => i.status === 'draft').length
    const pending = invoices.filter(i => i.status === 'pending_approval').length
    const approved = invoices.filter(i => i.status === 'approved').length
    const paid = invoices.filter(i => i.status === 'paid').length
    const totalAmount = invoices.reduce((s, i) => s + (i.total_amount || 0), 0)
    return { total, draft, pending, approved, paid, totalAmount }
  }, [invoices])

  async function loadGrnLines(grnId) {
    if (!grnId) { setLines([{ item_description: '', quantity: '', unit: '', unit_price: '' }]); return }
    const { data } = await supabase.from('grn_lines').select('*').eq('grn_id', grnId).order('created_at')
    if (data?.length) {
      setLines(data.map(gl => ({
        grn_line_id: gl.id, item_description: gl.item_description,
        quantity: gl.quantity_received, unit: gl.unit || '', unit_price: gl.unit_price,
      })))
    }
    const grn = grns.find(g => g.id === grnId)
    if (grn?.supplier_id) setForm(prev => ({ ...prev, supplier_id: grn.supplier_id }))
    if (grn?.po_id) setForm(prev => ({ ...prev, po_id: grn.po_id }))
  }

  function addLine() { setLines(prev => [...prev, { item_description: '', quantity: '', unit: '', unit_price: '' }]) }
  function removeLine(i) { setLines(prev => prev.filter((_, idx) => idx !== i)) }
  function updateLine(i, field, value) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  async function handleCreate() {
    if (!form.supplier_id) return showToast('Select a supplier', 'red')
    if (!form.invoice_number.trim()) return showToast('Enter invoice number', 'red')
    const validLines = lines.filter(l => l.item_description.trim() && l.quantity)
    if (validLines.length === 0) return showToast('Add at least one line item', 'red')
    setSaving(true)
    const subtotal = validLines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0)
    const { data: inv, error } = await supabase.from('purchase_invoices').insert({
      invoice_number: form.invoice_number.trim(), site_id: currentSiteId,
      po_id: form.po_id || null, grn_id: form.grn_id || null,
      supplier_id: form.supplier_id,
      invoice_date: form.invoice_date, due_date: form.due_date || null,
      subtotal, tax_amount: 0, total_amount: subtotal,
      status: 'draft', notes: form.notes || null, created_by: user.id,
    }).select().single()
    if (error) { showToast(error.message, 'red'); setSaving(false); return }
    const lineInserts = validLines.map(l => ({
      invoice_id: inv.id, grn_line_id: l.grn_line_id || null,
      item_description: l.item_description.trim(),
      quantity: parseFloat(l.quantity),
      unit: l.unit || null, unit_price: parseFloat(l.unit_price) || 0,
    }))
    await supabase.from('invoice_lines').insert(lineInserts)
    showToast('Invoice created')
    setShowForm(false)
    setForm({ po_id: '', grn_id: '', supplier_id: '', invoice_number: '', invoice_date: new Date().toISOString().split('T')[0], due_date: '', notes: '' })
    setLines([{ item_description: '', quantity: '', unit: '', unit_price: '' }])
    setSaving(false)
    fetchAll()
  }

  async function updateStatus(id, status) {
    const updates = { status, updated_at: new Date().toISOString() }
    if (status === 'approved') updates.approved_by = user.id
    if (status === 'paid') updates.paid_at = new Date().toISOString()
    const { error } = await supabase.from('purchase_invoices').update(updates).eq('id', id)
    if (error) showToast(error.message, 'red')
    else { showToast(`Invoice ${status.replace('_', ' ')}`); setDetail(null); fetchAll() }
  }

  if (!can('procurement.view')) return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Access denied</div>

  return (
    <div>
      <PageHeader title="Purchase Invoices" />
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_invoices" />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total', value: kpi.total, color: CLR },
          { label: 'Draft', value: kpi.draft, color: '#6B7280' },
          { label: 'Pending', value: kpi.pending, color: '#F59E0B' },
          { label: 'Approved', value: kpi.approved, color: '#2E7D32' },
          { label: 'Paid', value: kpi.paid, color: '#1565C0' },
          { label: 'Total Value', value: `$${kpi.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, color: '#7C3AED' },
        ].map(k => (
          <Card key={k.label} style={{ padding: '14px 16px', textAlign: 'center' }}>
            <div style={{ fontSize: '11px', color: THEME.textMed, fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>{k.label}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.value}</div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search invoices…" style={{ ...inp, flex: '1 1 220px', minWidth: '180px' }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="all">All Statuses</option>
            {['draft', 'pending_approval', 'approved', 'paid', 'cancelled'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          {can('procurement.create') && (
            <Button onClick={() => setShowForm(true)} style={{ background: CLR, color: '#fff' }}>
              <Icon name="add" size={16} /> New Invoice
            </Button>
          )}
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: CLR }} /></div>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>No purchase invoices found</Card>
      ) : (
        <TableWrap>
          <THead color={CLR}>
            {['Invoice #', 'Date', 'Due Date', 'PO #', 'Supplier', 'Lines', 'Total', 'Status', 'Actions'].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {filtered.map(inv => (
              <TRow key={inv.id} onClick={() => setDetail(inv)} style={{ cursor: 'pointer' }}>
                <Td style={{ fontWeight: 600, color: CLR }}>{inv.invoice_number}</Td>
                <Td style={{ fontSize: '12px' }}>{new Date(inv.invoice_date).toLocaleDateString()}</Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : '—'}</Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{inv.po?.po_number || '—'}</Td>
                <Td style={{ fontSize: '12px' }}>{inv.supplier?.supplier_name || '—'}</Td>
                <Td>{(inv.invoice_lines || []).length}</Td>
                <Td style={{ fontWeight: 600 }}>${(inv.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</Td>
                <Td><StatusBadge status={inv.status} /></Td>
                <Td>
                  <Button size="sm" onClick={e => { e.stopPropagation(); setDetail(inv) }} style={{ fontSize: '11px' }}>
                    <Icon name="visibility" size={14} /> View
                  </Button>
                </Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      {/* Create Form */}
      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)} dirty={true}>
          <div style={{ background: THEME.surface, borderRadius: '18px', padding: '24px', width: '650px', maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>New Purchase Invoice</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Invoice Number *</label>
                <input value={form.invoice_number} onChange={e => setForm(prev => ({ ...prev, invoice_number: e.target.value }))} placeholder="INV-001" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Supplier *</label>
                <select value={form.supplier_id} onChange={e => setForm(prev => ({ ...prev, supplier_id: e.target.value }))} style={inp}>
                  <option value="">— Select —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>GRN (optional)</label>
                <select value={form.grn_id} onChange={e => { setForm(prev => ({ ...prev, grn_id: e.target.value })); loadGrnLines(e.target.value) }} style={inp}>
                  <option value="">— No GRN —</option>
                  {grns.map(g => <option key={g.id} value={g.id}>{g.grn_number}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Purchase Order (optional)</label>
                <select value={form.po_id} onChange={e => setForm(prev => ({ ...prev, po_id: e.target.value }))} style={inp}>
                  <option value="">— No PO —</option>
                  {pos.map(p => <option key={p.id} value={p.id}>{p.po_number} — {p.supplier?.supplier_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Invoice Date *</label>
                <input type="date" value={form.invoice_date} onChange={e => setForm(prev => ({ ...prev, invoice_date: e.target.value }))} style={inp} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setForm(prev => ({ ...prev, due_date: e.target.value }))} style={inp} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Notes</label>
                <input value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional" style={inp} />
              </div>
            </div>

            <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '8px' }}>Line Items</label>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '6px', marginBottom: '8px' }}>
                <input value={l.item_description} onChange={e => updateLine(i, 'item_description', e.target.value)} placeholder="Description *" style={inp} />
                <input type="number" value={l.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} placeholder="Qty *" style={inp} />
                <input value={l.unit} onChange={e => updateLine(i, 'unit', e.target.value)} placeholder="Unit" style={inp} />
                <input type="number" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} placeholder="Unit Price" style={inp} />
                {lines.length > 1 && (
                  <button onClick={() => removeLine(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}>
                    <Icon name="close" size={16} style={{ color: THEME.error }} />
                  </button>
                )}
              </div>
            ))}
            <Button onClick={addLine} size="sm" style={{ marginBottom: '16px', fontSize: '12px' }}><Icon name="add" size={14} /> Add Line</Button>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setShowForm(false)} style={{ background: THEME.surfaceVar, color: THEME.text }}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving} style={{ background: CLR, color: '#fff' }}>{saving ? 'Creating…' : 'Create Invoice'}</Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Detail Modal */}
      {detail && (
        <ModalOverlay onClose={() => setDetail(null)} dirty={false}>
          <div style={{ background: THEME.surface, borderRadius: '18px', padding: '24px', width: '650px', maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>{detail.invoice_number}</div>
                <div style={{ fontSize: '12px', color: THEME.textMed }}>
                  {detail.po?.po_number && <span>PO: {detail.po.po_number} · </span>}
                  {detail.grn?.grn_number && <span>GRN: {detail.grn.grn_number} · </span>}
                  {detail.supplier?.supplier_name} · {new Date(detail.invoice_date).toLocaleDateString()}
                  {detail.due_date && <span> · Due: {new Date(detail.due_date).toLocaleDateString()}</span>}
                </div>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            {detail.notes && <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>Notes: {detail.notes}</div>}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '16px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Item', 'Qty', 'Unit', 'Unit Price', 'Total'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 4px', color: THEME.textMed, fontSize: '11px', fontWeight: 600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(detail.invoice_lines || []).map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 4px' }}>{l.item_description}</td>
                    <td style={{ padding: '8px 4px' }}>{l.quantity}</td>
                    <td style={{ padding: '8px 4px', color: THEME.textMed }}>{l.unit || '—'}</td>
                    <td style={{ padding: '8px 4px' }}>${(l.unit_price || 0).toFixed(2)}</td>
                    <td style={{ padding: '8px 4px', fontWeight: 600 }}>${(l.total_price || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${THEME.outlineVar}` }}>
                  <td colSpan={4} style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600 }}>Total</td>
                  <td style={{ padding: '8px 4px', fontWeight: 700, fontSize: '15px', color: CLR }}>${(detail.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>

            <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '12px' }}>
              Created by: {detail.creator?.full_name || detail.creator?.username || '—'}
              {detail.approver_profile && <span> · Approved by: {detail.approver_profile.full_name || detail.approver_profile.username}</span>}
              {detail.paid_at && <span> · Paid: {new Date(detail.paid_at).toLocaleDateString()}</span>}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              {detail.status === 'draft' && can('procurement.edit') && (
                <>
                  <Button onClick={() => updateStatus(detail.id, 'pending_approval')} style={{ background: '#F59E0B', color: '#fff' }}>
                    <Icon name="send" size={14} /> Submit for Approval
                  </Button>
                  <Button onClick={() => updateStatus(detail.id, 'cancelled')} style={{ background: THEME.statusErrorBg, color: THEME.statusErrorText }}>Cancel</Button>
                </>
              )}
              {detail.status === 'pending_approval' && can('procurement.approve') && (
                <>
                  <Button onClick={() => updateStatus(detail.id, 'draft')} style={{ background: THEME.surfaceVar, color: THEME.text }}>Return to Draft</Button>
                  <Button onClick={() => updateStatus(detail.id, 'approved')} style={{ background: '#2E7D32', color: '#fff' }}>
                    <Icon name="check" size={14} /> Approve
                  </Button>
                </>
              )}
              {detail.status === 'approved' && can('procurement.edit') && (
                <Button onClick={() => updateStatus(detail.id, 'paid')} style={{ background: '#1565C0', color: '#fff' }}>
                  <Icon name="payments" size={14} /> Mark Paid
                </Button>
              )}
              <Button onClick={() => setDetail(null)} style={{ background: THEME.surfaceVar, color: THEME.text }}>Close</Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
