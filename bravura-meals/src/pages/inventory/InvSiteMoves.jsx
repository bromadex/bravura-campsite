import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.inventory

export default function InvSiteMoves({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('inventory_movements', { column: 'site_id', value: currentSiteId })
  const [movements, setMovements] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [allWarehouses, setAllWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ item_id: '', from_warehouse_id: '', to_warehouse_id: '', qty: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [movRes, whRes, allWhRes, itemRes] = await Promise.all([
        supabase.from('inventory_movements')
          .select('*, item:items!inventory_movements_item_id_fkey(item_code, description), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name, site_id), creator:profiles!inventory_movements_created_by_fkey(full_name)')
          .in('movement_type', ['transfer_out', 'transfer_in'])
          .not('warehouse', 'is', null)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('warehouses').select('id, name, code, site_id').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('warehouses').select('id, name, code, site_id, site:sites!warehouses_site_id_fkey(name)').eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
      ])
      if (movRes.error) throw movRes.error
      setMovements((movRes.data || []).filter(m => m.warehouse?.site_id === currentSiteId))
      setWarehouses(whRes.data || [])
      setAllWarehouses(allWhRes.data || [])
      setItems(itemRes.data || [])
    } catch (err) {
      console.error('InvSiteMoves:', err)
      showToast('Failed to load data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch, rt])

  const filtered = useMemo(() => movements, [movements])

  async function handleSubmit() {
    const { item_id, from_warehouse_id, to_warehouse_id, qty } = form
    if (!item_id || !from_warehouse_id || !to_warehouse_id) { showToast('Select item and both warehouses', 'red'); return }
    if (from_warehouse_id === to_warehouse_id) { showToast('Source and destination must differ', 'red'); return }
    const q = parseFloat(qty)
    if (!q || q <= 0) { showToast('Enter a valid quantity', 'red'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('inventory_movements').insert([
        {
          item_id, warehouse_id: from_warehouse_id, movement_type: 'transfer_out',
          quantity: -q, unit_cost: 0, value: 0,
          voucher_type: 'TRANSFER', source_module: 'inventory',
          notes: form.notes || null, created_by: profile?.id,
        },
        {
          item_id, warehouse_id: to_warehouse_id, movement_type: 'transfer_in',
          quantity: q, unit_cost: 0, value: 0,
          voucher_type: 'TRANSFER', source_module: 'inventory',
          notes: form.notes || null, created_by: profile?.id,
        },
      ])
      if (error) throw error
      showToast('Stock reassignment recorded', 'green')
      setModalOpen(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_site_moves" />
      <PageHeader title="Site Reassignment" site={currentSite} actions={
        can('inventory.create') && <Button icon="swap_horiz" variant="filled" onClick={() => {
          setForm({ item_id: '', from_warehouse_id: '', to_warehouse_id: '', qty: '', notes: '' })
          setModalOpen(true)
        }}>New Reassignment</Button>
      } />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Date', 'Type', 'Item', 'Description', 'Warehouse', 'Qty', 'Notes', 'By'].map(h => (
                  <th key={h} style={{ ...th, textAlign: h === 'Qty' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No reassignment records</td></tr>
              ) : filtered.map(m => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                      background: m.movement_type === 'transfer_out' ? THEME.statusWarningBg : THEME.statusSuccessBg,
                      color: m.movement_type === 'transfer_out' ? THEME.statusWarningText : THEME.statusSuccessText,
                    }}>{m.movement_type === 'transfer_out' ? 'Out' : 'In'}</span>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{m.item?.item_code || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.text }}>{m.item?.description || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{m.warehouse?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: m.quantity < 0 ? THEME.error : '#16a34a' }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{m.notes || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{m.creator?.full_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Stock Reassignment"
        footer={<>
          <Button variant="text" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="filled" onClick={handleSubmit} disabled={saving}>{saving ? 'Saving...' : 'Transfer'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <SectionLabel>Item *</SectionLabel>
            <select value={form.item_id} onChange={e => setForm({ ...form, item_id: e.target.value })} style={inp}>
              <option value="">— Select item —</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.item_code} — {i.description}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>From Warehouse *</SectionLabel>
              <select value={form.from_warehouse_id} onChange={e => setForm({ ...form, from_warehouse_id: e.target.value })} style={inp}>
                <option value="">— Select —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>To Warehouse *</SectionLabel>
              <select value={form.to_warehouse_id} onChange={e => setForm({ ...form, to_warehouse_id: e.target.value })} style={inp}>
                <option value="">— Select —</option>
                {allWarehouses.map(w => <option key={w.id} value={w.id}>{w.site?.name ? `${w.site.name} — ` : ''}{w.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <SectionLabel>Quantity *</SectionLabel>
            <input type="number" min="0.01" step="0.01" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={inp} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
