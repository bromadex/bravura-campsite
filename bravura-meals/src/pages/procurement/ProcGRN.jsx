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

export default function ProcGRN({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const rt = useRealtimeRefresh('goods_received_notes', { column: 'site_id', value: currentSiteId })

  const [grns, setGrns] = useState([])
  const [pos, setPos] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ po_id: '', supplier_id: '', delivery_note_ref: '', notes: '' })
  const [lines, setLines] = useState([{ item_description: '', quantity_expected: '', quantity_received: '', unit: '', unit_price: '' }])
  const [detail, setDetail] = useState(null)
  const [poLines, setPoLines] = useState([])

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [gRes, poRes, sRes] = await Promise.all([
      supabase.from('goods_received_notes').select('*, grn_lines(*), po:purchase_orders(po_number), supplier:procurement_suppliers(supplier_name), receiver:profiles!received_by(full_name, username)')
        .eq('site_id', currentSiteId).order('created_at', { ascending: false }),
      supabase.from('purchase_orders').select('id, po_number, supplier_id, supplier:procurement_suppliers(supplier_name)')
        .eq('site_id', currentSiteId).in('status', ['approved', 'ordered', 'partial']).order('po_number'),
      supabase.from('procurement_suppliers').select('id, supplier_name').eq('site_id', currentSiteId).eq('status', 'active').order('supplier_name'),
    ])
    setGrns(gRes.data || [])
    setPos(poRes.data || [])
    setSuppliers(sRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetchAll() }, [currentSiteId, fetchAll, rt])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return grns
      .filter(g => statusFilter === 'all' || g.status === statusFilter)
      .filter(g => !q || g.grn_number?.toLowerCase().includes(q) || g.supplier?.supplier_name?.toLowerCase().includes(q) || g.po?.po_number?.toLowerCase().includes(q))
  }, [grns, search, statusFilter])

  async function loadPoLines(poId) {
    if (!poId) { setPoLines([]); setLines([{ item_description: '', quantity_expected: '', quantity_received: '', unit: '', unit_price: '' }]); return }
    const { data } = await supabase.from('po_lines').select('*').eq('po_id', poId).order('created_at')
    setPoLines(data || [])
    if (data?.length) {
      setLines(data.map(pl => ({
        po_line_id: pl.id, item_description: pl.item_description,
        quantity_expected: pl.quantity, quantity_received: pl.quantity,
        unit: pl.unit || '', unit_price: pl.unit_price,
      })))
    }
    const po = pos.find(p => p.id === poId)
    if (po?.supplier_id) setForm(prev => ({ ...prev, supplier_id: po.supplier_id }))
  }

  function addLine() { setLines(prev => [...prev, { item_description: '', quantity_expected: '', quantity_received: '', unit: '', unit_price: '' }]) }
  function removeLine(i) { setLines(prev => prev.filter((_, idx) => idx !== i)) }
  function updateLine(i, field, value) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  async function handleCreate() {
    if (!form.supplier_id) return showToast('Select a supplier', 'red')
    const validLines = lines.filter(l => l.item_description.trim() && l.quantity_received)
    if (validLines.length === 0) return showToast('Add at least one line item', 'red')
    setSaving(true)
    const grnNumber = `GRN-${Date.now().toString(36).toUpperCase()}`
    const { data: grn, error } = await supabase.from('goods_received_notes').insert({
      grn_number: grnNumber, site_id: currentSiteId,
      po_id: form.po_id || null, supplier_id: form.supplier_id,
      received_by: user.id, received_date: new Date().toISOString().split('T')[0],
      status: 'draft', delivery_note_ref: form.delivery_note_ref || null, notes: form.notes || null,
    }).select().single()
    if (error) { showToast(error.message, 'red'); setSaving(false); return }
    const lineInserts = validLines.map(l => ({
      grn_id: grn.id, po_line_id: l.po_line_id || null,
      item_description: l.item_description.trim(),
      quantity_expected: parseFloat(l.quantity_expected) || 0,
      quantity_received: parseFloat(l.quantity_received),
      quantity_rejected: 0, unit: l.unit || null,
      unit_price: parseFloat(l.unit_price) || 0,
    }))
    await supabase.from('grn_lines').insert(lineInserts)
    showToast('GRN created')
    setShowForm(false)
    setForm({ po_id: '', supplier_id: '', delivery_note_ref: '', notes: '' })
    setLines([{ item_description: '', quantity_expected: '', quantity_received: '', unit: '', unit_price: '' }])
    setSaving(false)
    fetchAll()
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('goods_received_notes').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) showToast(error.message, 'red')
    else { showToast(`GRN ${status}`); setDetail(null); fetchAll() }
  }

  if (!can('procurement.view')) return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Access denied</div>

  return (
    <div>
      <PageHeader title="Goods Received" />
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_grn" />

      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search GRNs…" style={{ ...inp, flex: '1 1 220px', minWidth: '180px' }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="all">All Statuses</option>
            {['draft', 'inspecting', 'accepted', 'accepted_partial', 'rejected'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
          {can('procurement.create') && (
            <Button onClick={() => setShowForm(true)} style={{ background: CLR, color: '#fff' }}>
              <Icon name="add" size={16} /> New GRN
            </Button>
          )}
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: CLR }} /></div>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>No goods received notes found</Card>
      ) : (
        <TableWrap>
          <THead color={CLR}>
            {['GRN #', 'Date', 'PO #', 'Supplier', 'Items', 'Status', 'Received By', 'Actions'].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {filtered.map(g => (
              <TRow key={g.id} onClick={() => setDetail(g)} style={{ cursor: 'pointer' }}>
                <Td style={{ fontWeight: 600, color: CLR }}>{g.grn_number}</Td>
                <Td style={{ fontSize: '12px' }}>{new Date(g.received_date).toLocaleDateString()}</Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{g.po?.po_number || '—'}</Td>
                <Td style={{ fontSize: '12px' }}>{g.supplier?.supplier_name || '—'}</Td>
                <Td>{(g.grn_lines || []).length}</Td>
                <Td><StatusBadge status={g.status} /></Td>
                <Td style={{ fontSize: '12px' }}>{g.receiver?.full_name || g.receiver?.username || '—'}</Td>
                <Td>
                  <Button size="sm" onClick={e => { e.stopPropagation(); setDetail(g) }} style={{ fontSize: '11px' }}>
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
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>New Goods Received Note</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Purchase Order (optional)</label>
                <select value={form.po_id} onChange={e => { setForm(prev => ({ ...prev, po_id: e.target.value })); loadPoLines(e.target.value) }} style={inp}>
                  <option value="">— No PO —</option>
                  {pos.map(p => <option key={p.id} value={p.id}>{p.po_number} — {p.supplier?.supplier_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Supplier *</label>
                <select value={form.supplier_id} onChange={e => setForm(prev => ({ ...prev, supplier_id: e.target.value }))} style={inp}>
                  <option value="">— Select —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Delivery Note Ref</label>
                <input value={form.delivery_note_ref} onChange={e => setForm(prev => ({ ...prev, delivery_note_ref: e.target.value }))} placeholder="DN reference" style={inp} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Notes</label>
                <input value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional" style={inp} />
              </div>
            </div>

            <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '8px' }}>Line Items</label>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr auto', gap: '6px', marginBottom: '8px' }}>
                <input value={l.item_description} onChange={e => updateLine(i, 'item_description', e.target.value)} placeholder="Description *" style={inp} />
                <input type="number" value={l.quantity_expected} onChange={e => updateLine(i, 'quantity_expected', e.target.value)} placeholder="Expected" style={inp} />
                <input type="number" value={l.quantity_received} onChange={e => updateLine(i, 'quantity_received', e.target.value)} placeholder="Received *" style={inp} />
                <input value={l.unit} onChange={e => updateLine(i, 'unit', e.target.value)} placeholder="Unit" style={inp} />
                <input type="number" value={l.unit_price} onChange={e => updateLine(i, 'unit_price', e.target.value)} placeholder="Price" style={inp} />
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
              <Button onClick={handleCreate} disabled={saving} style={{ background: CLR, color: '#fff' }}>{saving ? 'Creating…' : 'Create GRN'}</Button>
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
                <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>{detail.grn_number}</div>
                <div style={{ fontSize: '12px', color: THEME.textMed }}>
                  {detail.po?.po_number && <span>PO: {detail.po.po_number} · </span>}
                  {detail.supplier?.supplier_name} · {new Date(detail.received_date).toLocaleDateString()}
                </div>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            {detail.delivery_note_ref && <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>DN Ref: {detail.delivery_note_ref}</div>}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '16px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Item', 'Expected', 'Received', 'Rejected', 'Unit Price', 'Value'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 4px', color: THEME.textMed, fontSize: '11px', fontWeight: 600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(detail.grn_lines || []).map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 4px' }}>{l.item_description}</td>
                    <td style={{ padding: '8px 4px' }}>{l.quantity_expected}</td>
                    <td style={{ padding: '8px 4px', fontWeight: 600 }}>{l.quantity_received}</td>
                    <td style={{ padding: '8px 4px', color: l.quantity_rejected > 0 ? THEME.error : THEME.textLow }}>{l.quantity_rejected}</td>
                    <td style={{ padding: '8px 4px' }}>${(l.unit_price || 0).toFixed(2)}</td>
                    <td style={{ padding: '8px 4px', fontWeight: 600 }}>${(l.quantity_received * (l.unit_price || 0)).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              {detail.status === 'draft' && can('procurement.edit') && (
                <>
                  <Button onClick={() => updateStatus(detail.id, 'inspecting')} style={{ background: '#F57F17', color: '#fff' }}>
                    <Icon name="search" size={14} /> Start Inspection
                  </Button>
                  <Button onClick={() => updateStatus(detail.id, 'accepted')} style={{ background: '#2E7D32', color: '#fff' }}>
                    <Icon name="check" size={14} /> Accept All
                  </Button>
                </>
              )}
              {detail.status === 'inspecting' && can('procurement.edit') && (
                <>
                  <Button onClick={() => updateStatus(detail.id, 'rejected')} style={{ background: THEME.statusErrorBg, color: THEME.statusErrorText }}>Reject</Button>
                  <Button onClick={() => updateStatus(detail.id, 'accepted_partial')} style={{ background: '#F57F17', color: '#fff' }}>Accept Partial</Button>
                  <Button onClick={() => updateStatus(detail.id, 'accepted')} style={{ background: '#2E7D32', color: '#fff' }}>Accept All</Button>
                </>
              )}
              <Button onClick={() => setDetail(null)} style={{ background: THEME.surfaceVar, color: THEME.text }}>Close</Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
