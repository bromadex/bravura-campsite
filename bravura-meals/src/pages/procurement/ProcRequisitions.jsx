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

export default function ProcRequisitions({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const rt = useRealtimeRefresh('purchase_requisitions', { column: 'site_id', value: currentSiteId })

  const [reqs, setReqs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ priority: 'normal', notes: '' })
  const [lines, setLines] = useState([{ description: '', quantity: '', unit: '', estimated_cost: '' }])
  const [detail, setDetail] = useState(null)

  const fetchReqs = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data } = await supabase
      .from('purchase_requisitions')
      .select('*, requisition_lines(*, item:inventory_items(name)), requester:profiles!requested_by(full_name, username), approver:profiles!approved_by(full_name, username)')
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    setReqs(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetchReqs() }, [currentSiteId, fetchReqs, rt])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return reqs
      .filter(r => statusFilter === 'all' || r.status === statusFilter)
      .filter(r => !q || r.requisition_no?.toLowerCase().includes(q) || r.notes?.toLowerCase().includes(q))
  }, [reqs, search, statusFilter])

  const stats = useMemo(() => ({
    total: reqs.length,
    pending: reqs.filter(r => r.status === 'pending').length,
    approved: reqs.filter(r => r.status === 'approved').length,
    draft: reqs.filter(r => r.status === 'draft').length,
  }), [reqs])

  function addLine() { setLines(prev => [...prev, { description: '', quantity: '', unit: '', estimated_cost: '' }]) }
  function removeLine(i) { setLines(prev => prev.filter((_, idx) => idx !== i)) }
  function updateLine(i, field, value) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l))
  }

  async function handleCreate() {
    const validLines = lines.filter(l => l.description.trim() && l.quantity)
    if (validLines.length === 0) return showToast('Add at least one line item', 'red')
    setSaving(true)
    const reqNo = `PR-${Date.now().toString(36).toUpperCase()}`
    const { data: pr, error } = await supabase.from('purchase_requisitions').insert({
      requisition_no: reqNo, site_id: currentSiteId, status: 'draft',
      priority: form.priority, notes: form.notes || null, requested_by: user.id,
    }).select().single()
    if (error) { showToast(error.message, 'red'); setSaving(false); return }
    const lineInserts = validLines.map(l => ({
      requisition_id: pr.id, item_id: null,
      quantity: parseFloat(l.quantity),
      estimated_cost: l.estimated_cost ? parseFloat(l.estimated_cost) : null,
      notes: l.description.trim(),
    }))
    await supabase.from('requisition_lines').insert(lineInserts)
    showToast('Requisition created')
    setShowForm(false)
    setForm({ priority: 'normal', notes: '' })
    setLines([{ description: '', quantity: '', unit: '', estimated_cost: '' }])
    setSaving(false)
    fetchReqs()
  }

  async function updateStatus(id, status) {
    const updates = { status, updated_at: new Date().toISOString() }
    if (status === 'approved') { updates.approved_by = user.id; updates.approved_at = new Date().toISOString() }
    const { error } = await supabase.from('purchase_requisitions').update(updates).eq('id', id)
    if (error) showToast(error.message, 'red')
    else { showToast(`Requisition ${status}`); setDetail(null); fetchReqs() }
  }

  if (!can('procurement.view')) return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Access denied</div>

  return (
    <div>
      <PageHeader title="Purchase Requisitions" />
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_requisitions" />

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Total', value: stats.total, icon: 'description', accent: CLR },
          { label: 'Draft', value: stats.draft, icon: 'edit_note', accent: '#78909C' },
          { label: 'Pending', value: stats.pending, icon: 'pending', accent: '#F57F17' },
          { label: 'Approved', value: stats.approved, icon: 'check_circle', accent: '#2E7D32' },
        ].map(k => (
          <Card key={k.label} style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px', flex: '0 0 auto' }}>
            <Icon name={k.icon} size={22} style={{ color: k.accent }} />
            <div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
              <div style={{ fontSize: '11px', color: THEME.textMed }}>{k.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search requisitions…" style={{ ...inp, flex: '1 1 220px', minWidth: '180px' }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="all">All Statuses</option>
            {['draft', 'pending', 'approved', 'rejected', 'ordered'].map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          {can('procurement.create') && (
            <Button onClick={() => setShowForm(true)} style={{ background: CLR, color: '#fff' }}>
              <Icon name="add" size={16} /> New Requisition
            </Button>
          )}
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: CLR }} /></div>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>No requisitions found</Card>
      ) : (
        <TableWrap>
          <THead color={CLR}>
            {['PR #', 'Date', 'Items', 'Est. Total', 'Priority', 'Status', 'Requested By', 'Actions'].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {filtered.map(r => {
              const total = (r.requisition_lines || []).reduce((s, l) => s + (l.estimated_cost || 0) * l.quantity, 0)
              return (
                <TRow key={r.id} onClick={() => setDetail(r)} style={{ cursor: 'pointer' }}>
                  <Td style={{ fontWeight: 600, color: CLR }}>{r.requisition_no}</Td>
                  <Td style={{ fontSize: '12px' }}>{new Date(r.created_at).toLocaleDateString()}</Td>
                  <Td>{(r.requisition_lines || []).length}</Td>
                  <Td style={{ fontWeight: 600 }}>${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</Td>
                  <Td>
                    <span style={{
                      padding: '2px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                      background: r.priority === 'urgent' ? THEME.statusErrorBg : r.priority === 'high' ? THEME.statusWarningBg : THEME.surfaceVar,
                      color: r.priority === 'urgent' ? THEME.statusErrorText : r.priority === 'high' ? THEME.statusWarningText : THEME.textMed,
                    }}>{r.priority}</span>
                  </Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td style={{ fontSize: '12px' }}>{r.requester?.full_name || r.requester?.username || '—'}</Td>
                  <Td>
                    <Button size="sm" onClick={e => { e.stopPropagation(); setDetail(r) }} style={{ fontSize: '11px' }}>
                      <Icon name="visibility" size={14} /> View
                    </Button>
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {/* Create Form Modal */}
      {showForm && (
        <ModalOverlay onClose={() => setShowForm(false)} dirty={true}>
          <div style={{ background: THEME.surface, borderRadius: '18px', padding: '24px', width: '600px', maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>New Purchase Requisition</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Priority</label>
                <select value={form.priority} onChange={e => setForm(prev => ({ ...prev, priority: e.target.value }))} style={inp}>
                  {['low', 'normal', 'high', 'urgent'].map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Notes</label>
                <input value={form.notes} onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))} placeholder="Optional notes" style={inp} />
              </div>
            </div>

            <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '8px' }}>Line Items</label>
            {lines.map((l, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: '8px', marginBottom: '8px' }}>
                <input value={l.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder="Item description *" style={inp} />
                <input type="number" value={l.quantity} onChange={e => updateLine(i, 'quantity', e.target.value)} placeholder="Qty *" style={inp} />
                <input value={l.unit} onChange={e => updateLine(i, 'unit', e.target.value)} placeholder="Unit" style={inp} />
                <input type="number" value={l.estimated_cost} onChange={e => updateLine(i, 'estimated_cost', e.target.value)} placeholder="Est. cost" style={inp} />
                {lines.length > 1 && (
                  <button onClick={() => removeLine(i)} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '4px' }}>
                    <Icon name="close" size={16} style={{ color: THEME.error }} />
                  </button>
                )}
              </div>
            ))}
            <Button onClick={addLine} size="sm" style={{ marginBottom: '16px', fontSize: '12px' }}>
              <Icon name="add" size={14} /> Add Line
            </Button>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <Button onClick={() => setShowForm(false)} style={{ background: THEME.surfaceVar, color: THEME.text }}>Cancel</Button>
              <Button onClick={handleCreate} disabled={saving} style={{ background: CLR, color: '#fff' }}>
                {saving ? 'Creating…' : 'Create Requisition'}
              </Button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* Detail Modal */}
      {detail && (
        <ModalOverlay onClose={() => setDetail(null)} dirty={false}>
          <div style={{ background: THEME.surface, borderRadius: '18px', padding: '24px', width: '600px', maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>{detail.requisition_no}</div>
                <div style={{ fontSize: '12px', color: THEME.textMed }}>{new Date(detail.created_at).toLocaleDateString()} · {detail.requester?.full_name || '—'}</div>
              </div>
              <StatusBadge status={detail.status} />
            </div>

            {detail.notes && <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '16px', padding: '10px 12px', background: THEME.surfaceVar, borderRadius: '8px' }}>{detail.notes}</div>}

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '16px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Item', 'Qty', 'Est. Cost', 'Subtotal'].map(h => <th key={h} style={{ textAlign: 'left', padding: '8px 6px', color: THEME.textMed, fontSize: '11px', fontWeight: 600 }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {(detail.requisition_lines || []).map(l => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 6px' }}>{l.item?.name || l.notes || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{l.quantity}</td>
                    <td style={{ padding: '8px 6px' }}>${(l.estimated_cost || 0).toFixed(2)}</td>
                    <td style={{ padding: '8px 6px', fontWeight: 600 }}>${((l.estimated_cost || 0) * l.quantity).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              {detail.status === 'draft' && can('procurement.edit') && (
                <Button onClick={() => updateStatus(detail.id, 'pending')} style={{ background: '#F57F17', color: '#fff' }}>
                  <Icon name="send" size={14} /> Submit for Approval
                </Button>
              )}
              {detail.status === 'pending' && can('procurement.approve') && (
                <>
                  <Button onClick={() => updateStatus(detail.id, 'rejected')} style={{ background: THEME.statusErrorBg, color: THEME.statusErrorText }}>Reject</Button>
                  <Button onClick={() => updateStatus(detail.id, 'approved')} style={{ background: '#2E7D32', color: '#fff' }}>
                    <Icon name="check" size={14} /> Approve
                  </Button>
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
