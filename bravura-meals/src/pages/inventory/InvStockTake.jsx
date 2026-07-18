import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast, StatusBadge } from '../../components/ui'
import { notifyApprovers } from '../../utils/notify'

const ACCENT = MODULE_COLORS.inventory

const STATUS_COLORS = {
  draft:       { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Draft' },
  in_progress: { bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'In Progress' },
  completed:   { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'Completed' },
  cancelled:   { bg: THEME.statusErrorBg,   text: THEME.statusErrorText,   label: 'Cancelled' },
}

export default function InvStockTake() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const [takes, setTakes] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [newModal, setNewModal] = useState(false)
  const [newForm, setNewForm] = useState({ warehouse_id: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const [detailModal, setDetailModal] = useState(false)
  const [activeTake, setActiveTake] = useState(null)
  const [lines, setLines] = useState([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [postingSaving, setPostingSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [stRes, whRes] = await Promise.all([
        supabase.from('stock_takes')
          .select('*, warehouse:warehouses!stock_takes_warehouse_id_fkey(name, site_id), creator:profiles!stock_takes_created_by_fkey(full_name)')
          .not('warehouse', 'is', null)
          .order('created_at', { ascending: false }),
        supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
      ])
      if (stRes.error) throw stRes.error
      setTakes((stRes.data || []).filter(t => t.warehouse?.site_id === currentSiteId))
      setWarehouses(whRes.data || [])
    } catch (err) {
      showToast('Failed to load stock takes', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch])

  async function createTake() {
    if (!newForm.warehouse_id) { showToast('Select a warehouse', 'red'); return }
    setSaving(true)
    try {
      const seq = takes.length + 1
      const ref = `ST-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`

      const balRes = await supabase.from('stock_balances')
        .select('item_id, on_hand_qty')
        .eq('warehouse_id', newForm.warehouse_id)
        .gt('on_hand_qty', 0)
      if (balRes.error) throw balRes.error

      const { data: st, error: stErr } = await supabase.from('stock_takes').insert({
        reference: ref,
        warehouse_id: newForm.warehouse_id,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        notes: newForm.notes || null,
        created_by: profile?.id,
      }).select().single()
      if (stErr) throw stErr

      if (balRes.data?.length > 0) {
        const stLines = balRes.data.map(b => ({
          stock_take_id: st.id,
          item_id: b.item_id,
          system_qty: b.on_hand_qty,
          counted_qty: null,
        }))
        const { error: lineErr } = await supabase.from('stock_take_lines').insert(stLines)
        if (lineErr) throw lineErr
      }

      showToast(`Stock take ${ref} created with ${balRes.data?.length || 0} items`, 'green')
      setNewModal(false)
      fetch()
      openDetail(st)
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function openDetail(take) {
    setActiveTake(take)
    setDetailModal(true)
    setLinesLoading(true)
    try {
      const { data, error } = await supabase.from('stock_take_lines')
        .select('*, item:items!stock_take_lines_item_id_fkey(item_code, description, uom:units_of_measure!items_uom_id_fkey(abbreviation))')
        .eq('stock_take_id', take.id)
        .order('created_at')
      if (error) throw error
      setLines(data || [])
    } catch (err) {
      showToast('Failed to load lines', 'red')
    }
    setLinesLoading(false)
  }

  function updateCount(lineId, val) {
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, counted_qty: val === '' ? null : parseFloat(val) } : l))
  }

  async function saveCounts() {
    setSaving(true)
    try {
      const updates = lines.filter(l => l.counted_qty !== null && l.counted_qty !== undefined)
      for (const l of updates) {
        const { error } = await supabase.from('stock_take_lines')
          .update({ counted_qty: l.counted_qty })
          .eq('id', l.id)
        if (error) throw error
      }
      showToast('Counts saved', 'green')
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function postAdjustments() {
    if (!can('inventory.approve')) { showToast('Approval permission required', 'red'); return }
    const variances = lines.filter(l => l.counted_qty !== null && l.counted_qty !== undefined && (l.counted_qty - l.system_qty) !== 0)
    if (variances.length === 0) { showToast('No variances to post', 'red'); return }
    if (!confirm(`Post ${variances.length} adjustment(s) from this stock take?`)) return
    setPostingSaving(true)
    try {
      const movs = variances.map(l => ({
        item_id: l.item_id,
        warehouse_id: activeTake.warehouse_id,
        movement_type: 'stock_take',
        quantity: l.counted_qty - l.system_qty,
        unit_cost: 0, value: 0,
        voucher_type: 'ST',
        voucher_no: activeTake.reference,
        source_module: 'inventory',
        notes: `Stock take ${activeTake.reference}: system ${l.system_qty}, counted ${l.counted_qty}`,
        created_by: profile?.id,
      }))
      const { error: movErr } = await supabase.from('inventory_movements').insert(movs)
      if (movErr) throw movErr

      const { error: upErr } = await supabase.from('stock_takes')
        .update({ status: 'completed', completed_at: new Date().toISOString(), approved_by: profile?.id })
        .eq('id', activeTake.id)
      if (upErr) throw upErr

      showToast(`${variances.length} adjustment(s) posted`, 'green')
      notifyApprovers({ siteId: currentSiteId, permissionCode: 'inventory.view', type: 'stock_take_completed', title: 'Stock Take Completed', body: `A stock take has been completed with ${variances.length} adjustment(s).`, actionUrl: '/inventory/stock-take' })
      setDetailModal(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setPostingSaving(false)
  }

  function exportTake() {
    const headers = ['Item Code', 'Description', 'UoM', 'System Qty', 'Counted Qty', 'Variance']
    const rows = lines.map(l => [
      l.item?.item_code || '', l.item?.description || '', l.item?.uom?.abbreviation || '',
      l.system_qty, l.counted_qty ?? '', l.counted_qty != null ? l.counted_qty - l.system_qty : '',
    ])
    exportCsv(`stock_take_${activeTake?.reference || 'export'}.csv`, headers, rows)
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <PageHeader title="Stock Take" site={currentSite} actions={
        can('inventory.create') && <Button icon="add" variant="filled" onClick={() => {
          setNewForm({ warehouse_id: '', notes: '' })
          setNewModal(true)
        }}>New Stock Take</Button>
      } />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : takes.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
          <Icon name="fact_check" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          No stock takes yet
        </Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Reference', 'Warehouse', 'Status', 'Started', 'Completed', 'By'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {takes.map(t => {
                const s = STATUS_COLORS[t.status] || STATUS_COLORS.draft
                return (
                  <tr key={t.id} onClick={() => openDetail(t)} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = ''}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: ACCENT, fontFamily: 'monospace', fontSize: '12px' }}>{t.reference}</td>
                    <td style={{ padding: '8px 10px', color: THEME.text }}>{t.warehouse?.name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <StatusBadge status={t.status} />
                    </td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{t.started_at ? new Date(t.started_at).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{t.completed_at ? new Date(t.completed_at).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{t.creator?.full_name || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={newModal} onClose={() => setNewModal(false)} title="New Stock Take"
        footer={<>
          <Button variant="text" onClick={() => setNewModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={createTake} disabled={saving}>{saving ? 'Creating...' : 'Start Stock Take'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <SectionLabel>Warehouse *</SectionLabel>
            <select value={newForm.warehouse_id} onChange={e => setNewForm({ ...newForm, warehouse_id: e.target.value })} style={inp}>
              <option value="">— Select —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <textarea value={newForm.notes} onChange={e => setNewForm({ ...newForm, notes: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} />
          </div>
          <div style={{ fontSize: '12px', color: THEME.textLow }}>
            A count sheet will be generated from all items with stock in the selected warehouse.
          </div>
        </div>
      </Modal>

      <Modal open={detailModal} onClose={() => setDetailModal(false)} title={`Stock Take: ${activeTake?.reference || ''}`}
        footer={<div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
          <Button icon="download" variant="text" onClick={exportTake}>Export</Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="text" onClick={() => setDetailModal(false)}>Close</Button>
            {activeTake?.status === 'in_progress' && can('inventory.edit') && (
              <Button variant="outlined" onClick={saveCounts} disabled={saving}>{saving ? 'Saving...' : 'Save Counts'}</Button>
            )}
            {activeTake?.status === 'in_progress' && can('inventory.approve') && (
              <Button variant="filled" onClick={postAdjustments} disabled={postingSaving}>{postingSaving ? 'Posting...' : 'Post Adjustments'}</Button>
            )}
          </div>
        </div>}>
        {linesLoading ? (
          <div style={{ textAlign: 'center', padding: '30px', color: THEME.textMed }}>Loading count sheet...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Item Code', 'Description', 'UoM', 'System', 'Count', 'Variance'].map(h => (
                    <th key={h} style={{ ...th, textAlign: ['System', 'Count', 'Variance'].includes(h) ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: THEME.textLow }}>No items in count sheet</td></tr>
                ) : lines.map(l => {
                  const v = l.counted_qty != null ? l.counted_qty - l.system_qty : null
                  return (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{l.item?.item_code || '—'}</td>
                      <td style={{ padding: '6px 10px', color: THEME.text }}>{l.item?.description || '—'}</td>
                      <td style={{ padding: '6px 10px', color: THEME.textMed }}>{l.item?.uom?.abbreviation || '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed }}>{l.system_qty}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        {activeTake?.status === 'in_progress' ? (
                          <input type="number" min="0" step="0.01"
                            value={l.counted_qty ?? ''}
                            onChange={e => updateCount(l.id, e.target.value)}
                            style={{ ...inp, width: '80px', padding: '6px 8px', textAlign: 'right', fontSize: '13px' }} />
                        ) : (
                          <span style={{ fontWeight: 600 }}>{l.counted_qty ?? '—'}</span>
                        )}
                      </td>
                      <td style={{
                        padding: '6px 10px', textAlign: 'right', fontWeight: 600,
                        color: v == null ? THEME.textLow : v === 0 ? '#16a34a' : v > 0 ? '#2563eb' : THEME.error,
                      }}>{v != null ? (v > 0 ? `+${v}` : v) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {lines.length > 0 && (() => {
              const counted = lines.filter(l => l.counted_qty != null).length
              const withVar = lines.filter(l => l.counted_qty != null && l.counted_qty !== l.system_qty).length
              return (
                <div style={{ padding: '12px 10px', fontSize: '12px', color: THEME.textMed, borderTop: `1px solid ${THEME.outlineVar}` }}>
                  {counted}/{lines.length} counted · {withVar} variance{withVar !== 1 ? 's' : ''}
                </div>
              )
            })()}
          </div>
        )}
      </Modal>
    </div>
  )
}
