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
  draft:     { bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText,  label: 'Draft' },
  submitted: { bg: THEME.statusWarningBg,  text: THEME.statusWarningText,  label: 'Submitted' },
  approved:  { bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  label: 'Approved' },
  rejected:  { bg: THEME.statusErrorBg,    text: THEME.statusErrorText,    label: 'Rejected' },
  ordered:   { bg: '#dbeafe',              text: '#1e40af',                label: 'Ordered' },
  cancelled: { bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText,  label: 'Cancelled' },
}

const PRIORITY_COLORS = {
  low:    { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
  normal: { bg: '#dbeafe',            text: '#1e40af' },
  high:   { bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  urgent: { bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
}

export default function InvRequisitions() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const [reqs, setReqs] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [modal, setModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ warehouse_id: '', priority: 'normal', notes: '' })
  const [lines, setLines] = useState([{ item_id: '', quantity: '', estimated_cost: '', notes: '' }])
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [reqRes, whRes, itemRes] = await Promise.all([
        supabase.from('purchase_requisitions')
          .select('*, warehouse:warehouses!purchase_requisitions_warehouse_id_fkey(name), requester:profiles!purchase_requisitions_requested_by_fkey(full_name), approver:profiles!purchase_requisitions_approved_by_fkey(full_name), lines:requisition_lines(id, item_id, quantity, estimated_cost, item:items!requisition_lines_item_id_fkey(item_code, description))')
          .eq('site_id', currentSiteId)
          .order('created_at', { ascending: false }),
        supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
      ])
      if (reqRes.error) throw reqRes.error
      setReqs(reqRes.data || [])
      setWarehouses(whRes.data || [])
      setItems(itemRes.data || [])
    } catch (err) {
      showToast('Failed to load requisitions', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch])

  const filtered = useMemo(() => {
    let list = reqs
    if (statusFilter) list = list.filter(r => r.status === statusFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.requisition_no?.toLowerCase().includes(q) || (r.notes || '').toLowerCase().includes(q))
    }
    return list
  }, [reqs, search, statusFilter])

  function openNew() {
    setEditId(null)
    setForm({ warehouse_id: '', priority: 'normal', notes: '' })
    setLines([{ item_id: '', quantity: '', estimated_cost: '', notes: '' }])
    setModal(true)
  }

  function openEdit(req) {
    setEditId(req.id)
    setForm({ warehouse_id: req.warehouse_id || '', priority: req.priority, notes: req.notes || '' })
    setLines(req.lines?.length > 0
      ? req.lines.map(l => ({ item_id: l.item_id, quantity: l.quantity, estimated_cost: l.estimated_cost || '', notes: l.notes || '' }))
      : [{ item_id: '', quantity: '', estimated_cost: '', notes: '' }])
    setModal(true)
  }

  function addLine() { setLines([...lines, { item_id: '', quantity: '', estimated_cost: '', notes: '' }]) }
  function updateLine(i, field, val) { const n = [...lines]; n[i] = { ...n[i], [field]: val }; setLines(n) }
  function removeLine(i) { if (lines.length <= 1) return; setLines(lines.filter((_, idx) => idx !== i)) }

  async function genReqNo() {
    const { data } = await supabase.from('purchase_requisitions').select('requisition_no').eq('site_id', currentSiteId)
      .like('requisition_no', `REQ-${new Date().getFullYear()}-%`).order('requisition_no', { ascending: false }).limit(1)
    if (data?.length > 0) {
      const num = parseInt(data[0].requisition_no.split('-').pop(), 10) || 0
      return `REQ-${new Date().getFullYear()}-${String(num + 1).padStart(4, '0')}`
    }
    return `REQ-${new Date().getFullYear()}-0001`
  }

  async function handleSave(andSubmit = false) {
    const validLines = lines.filter(l => l.item_id && parseFloat(l.quantity) > 0)
    if (validLines.length === 0) { showToast('Add at least one item line', 'red'); return }
    setSaving(true)
    try {
      if (editId) {
        const { error } = await supabase.from('purchase_requisitions').update({
          warehouse_id: form.warehouse_id || null,
          priority: form.priority,
          notes: form.notes || null,
          status: andSubmit ? 'submitted' : undefined,
          updated_at: new Date().toISOString(),
        }).eq('id', editId)
        if (error) throw error

        await supabase.from('requisition_lines').delete().eq('requisition_id', editId)
        const { error: lineErr } = await supabase.from('requisition_lines').insert(
          validLines.map(l => ({
            requisition_id: editId,
            item_id: l.item_id,
            quantity: parseFloat(l.quantity),
            estimated_cost: l.estimated_cost ? parseFloat(l.estimated_cost) : null,
            notes: l.notes || null,
          }))
        )
        if (lineErr) throw lineErr
        showToast(andSubmit ? 'Requisition submitted' : 'Requisition updated', 'green')
        if (andSubmit) {
          notifyApprovers({ siteId: currentSiteId, permissionCode: 'inventory.approve', type: 'requisition_submitted', title: 'Requisition Submitted', body: `A requisition has been submitted and needs your approval.`, actionUrl: '/inventory/requisitions' })
        }
      } else {
        const reqNo = await genReqNo()
        const { data: newReq, error } = await supabase.from('purchase_requisitions').insert({
          requisition_no: reqNo,
          site_id: currentSiteId,
          warehouse_id: form.warehouse_id || null,
          priority: form.priority,
          notes: form.notes || null,
          status: andSubmit ? 'submitted' : 'draft',
          requested_by: profile?.id,
        }).select().single()
        if (error) throw error

        const { error: lineErr } = await supabase.from('requisition_lines').insert(
          validLines.map(l => ({
            requisition_id: newReq.id,
            item_id: l.item_id,
            quantity: parseFloat(l.quantity),
            estimated_cost: l.estimated_cost ? parseFloat(l.estimated_cost) : null,
            notes: l.notes || null,
          }))
        )
        if (lineErr) throw lineErr
        showToast(`Requisition ${reqNo} created`, 'green')
        if (andSubmit) {
          notifyApprovers({ siteId: currentSiteId, permissionCode: 'inventory.approve', type: 'requisition_submitted', title: 'Requisition Submitted', body: `Requisition ${reqNo} has been submitted and needs your approval.`, actionUrl: '/inventory/requisitions' })
        }
      }
      setModal(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function approveReq(req) {
    if (!can('inventory.approve')) return
    const { error } = await supabase.from('purchase_requisitions').update({
      status: 'approved', approved_by: profile?.id, approved_at: new Date().toISOString(),
    }).eq('id', req.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Requisition approved', 'green')
    if (req.requested_by) {
      sendNotification({ recipientId: req.requested_by, type: 'requisition_approved', title: 'Requisition Approved', body: `Your requisition ${req.requisition_no} has been approved.`, actionUrl: '/inventory/requisitions' })
    }
    fetch()
  }

  async function rejectReq(req) {
    if (!can('inventory.approve')) return
    const { error } = await supabase.from('purchase_requisitions').update({ status: 'rejected' }).eq('id', req.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Requisition rejected', 'green')
    if (req.requested_by) {
      sendNotification({ recipientId: req.requested_by, type: 'requisition_approved', title: 'Requisition Rejected', body: `Your requisition ${req.requisition_no} has been rejected.`, actionUrl: '/inventory/requisitions' })
    }
    fetch()
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <PageHeader title="Purchase Requisitions" site={currentSite} actions={
        can('inventory.create') && <Button icon="add" variant="filled" onClick={openNew}>New Requisition</Button>
      } />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '240px' }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} requisitions</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Req #', 'Date', 'Priority', 'Status', 'Items', 'Est. Total', 'Requested By', 'Actions'].map(h => (
                  <th key={h} style={{ ...th, textAlign: ['Items', 'Est. Total'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No requisitions</td></tr>
              ) : filtered.map(r => {
                const s = STATUS_COLORS[r.status] || STATUS_COLORS.draft
                const p = PRIORITY_COLORS[r.priority] || PRIORITY_COLORS.normal
                const est = (r.lines || []).reduce((sum, l) => sum + (l.quantity * (l.estimated_cost || 0)), 0)
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: ACCENT, fontFamily: 'monospace', fontSize: '12px' }}>{r.requisition_no}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <StatusBadge status={r.priority} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <StatusBadge status={r.status} />
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.lines?.length || 0}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{est > 0 ? `$${est.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{r.requester?.full_name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {r.status === 'draft' && can('inventory.edit') && (
                          <button onClick={() => openEdit(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {r.status === 'submitted' && can('inventory.approve') && <>
                          <button onClick={() => approveReq(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Icon name="check_circle" size={16} style={{ color: '#16a34a' }} />
                          </button>
                          <button onClick={() => rejectReq(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                            <Icon name="cancel" size={16} style={{ color: THEME.error }} />
                          </button>
                        </>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Requisition' : 'New Purchase Requisition'}
        footer={<>
          <Button variant="text" onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="outlined" onClick={() => handleSave(false)} disabled={saving}>Save Draft</Button>
          <Button variant="filled" onClick={() => handleSave(true)} disabled={saving}>{saving ? 'Saving...' : 'Save & Submit'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Deliver To Warehouse</SectionLabel>
              <select value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })} style={inp}>
                <option value="">— Any —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Priority</SectionLabel>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} style={inp}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
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
                {i === 0 && <SectionLabel>Est. Cost</SectionLabel>}
                <input type="number" min="0" step="0.01" value={l.estimated_cost} onChange={e => updateLine(i, 'estimated_cost', e.target.value)} style={inp} />
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
    </div>
  )
}
