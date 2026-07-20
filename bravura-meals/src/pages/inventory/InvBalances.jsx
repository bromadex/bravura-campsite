import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.inventory

export default function InvBalances({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('stock_balances', { column: 'site_id', value: currentSiteId })
  const [balances, setBalances] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [whFilter, setWhFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [openingModal, setOpeningModal] = useState(false)
  const [openingForm, setOpeningForm] = useState({ item_id: '', warehouse_id: '', qty: '', unit_cost: '' })
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [balRes, whRes, itemRes, catRes] = await Promise.all([
        supabase.from('stock_balances')
          .select('*, item:items!stock_balances_item_id_fkey(id, item_code, description, category_id, reorder_level, uom:units_of_measure!items_uom_id_fkey(abbreviation)), warehouse:warehouses!stock_balances_warehouse_id_fkey(id, name, site_id)')
          .not('warehouse', 'is', null),
        supabase.from('warehouses').select('id, name, code').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
        supabase.from('item_categories').select('id, name'),
      ])
      if (balRes.error) throw balRes.error
      if (whRes.error) throw whRes.error
      setBalances((balRes.data || []).filter(b => b.warehouse?.site_id === currentSiteId))
      setWarehouses(whRes.data || [])
      setItems(itemRes.data || [])
      setCategories(catRes.data || [])
    } catch (err) {
      console.error('InvBalances:', err)
      showToast('Failed to load stock balances', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch, rt])

  const filtered = useMemo(() => {
    let list = balances
    if (whFilter) list = list.filter(b => b.warehouse_id === whFilter)
    if (stockFilter === 'low') list = list.filter(b => b.item?.reorder_level && b.on_hand_qty > 0 && b.on_hand_qty <= b.item.reorder_level)
    if (stockFilter === 'out') list = list.filter(b => b.on_hand_qty <= 0)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(b =>
        b.item?.item_code?.toLowerCase().includes(q) ||
        b.item?.description?.toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => (a.item?.description || '').localeCompare(b.item?.description || ''))
  }, [balances, search, whFilter, stockFilter])

  async function postOpening() {
    const { item_id, warehouse_id, qty, unit_cost } = openingForm
    if (!item_id || !warehouse_id) { showToast('Select item and warehouse', 'red'); return }
    const q = parseFloat(qty)
    if (!q || q <= 0) { showToast('Enter a valid quantity', 'red'); return }
    const cost = parseFloat(unit_cost) || 0
    setSaving(true)
    try {
      const { error } = await supabase.from('inventory_movements').insert({
        item_id,
        warehouse_id,
        movement_type: 'opening',
        quantity: q,
        unit_cost: cost,
        value: q * cost,
        notes: 'Opening stock capture',
        created_by: profile?.id,
      })
      if (error) throw error
      showToast('Opening stock recorded', 'green')
      setOpeningModal(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  function handleExport() {
    const headers = ['Item Code', 'Description', 'Warehouse', 'On Hand', 'UoM', 'Unit Value', 'Stock Value']
    const rows = filtered.map(b => [
      b.item?.item_code || '', b.item?.description || '', b.warehouse?.name || '',
      b.on_hand_qty, b.item?.uom?.abbreviation || '', b.valuation_rate?.toFixed(2) || '', b.stock_value?.toFixed(2) || '',
    ])
    exportCsv('stock_balances.csv', headers, rows)
  }

  if (!can('inventory.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div>
      </Card>
    )
  }

  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  const totalValue = filtered.reduce((s, b) => s + (b.stock_value || 0), 0)

  return (
    <div>
      <PageHeader title="Stock Balances" site={currentSite} actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          {can('inventory.edit') && <Button icon="download" onClick={handleExport}>Export</Button>}
          {can('inventory.create') && <Button icon="add" variant="filled" onClick={() => {
            setOpeningForm({ item_id: '', warehouse_id: '', qty: '', unit_cost: '' })
            setOpeningModal(true)
          }}>Opening Stock</Button>}
        </div>
      } />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }} />
        <select value={whFilter} onChange={e => setWhFilter(e.target.value)} style={{ ...inp, maxWidth: '200px' }}>
          <option value="">All warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="">All stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
          {filtered.length} rows · Value: ${totalValue.toFixed(2)}
        </span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Code', 'Description', 'Warehouse', 'On Hand', 'UoM', 'Unit Value', 'Stock Value'].map(h => (
                  <th key={h} style={{ ...th, textAlign: h === 'On Hand' || h === 'Unit Value' || h === 'Stock Value' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
                  No stock balances found
                </td></tr>
              ) : filtered.map(b => {
                const isLow = b.item?.reorder_level && b.on_hand_qty > 0 && b.on_hand_qty <= b.item.reorder_level
                const isOut = b.on_hand_qty <= 0
                return (
                  <tr key={b.id || `${b.item_id}-${b.warehouse_id}`} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 10px', color: ACCENT, fontWeight: 600, fontFamily: 'monospace', fontSize: '12px' }}>{b.item?.item_code || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 500 }}>{b.item?.description || '—'}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed }}>{b.warehouse?.name || '—'}</td>
                    <td style={{
                      padding: '8px 10px', textAlign: 'right', fontWeight: 600,
                      color: isOut ? THEME.error : isLow ? THEME.warning : THEME.text,
                    }}>
                      {b.on_hand_qty}
                      {isOut && <Icon name="error" size={14} style={{ marginLeft: '4px', verticalAlign: 'middle', color: THEME.error }} />}
                      {isLow && !isOut && <Icon name="warning" size={14} style={{ marginLeft: '4px', verticalAlign: 'middle', color: THEME.warning }} />}
                    </td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed }}>{b.item?.uom?.abbreviation || '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.textMed }}>{b.valuation_rate ? `$${b.valuation_rate.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.text, fontWeight: 600 }}>{b.stock_value ? `$${b.stock_value.toFixed(2)}` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      <Modal dirty={true} open={openingModal} onClose={() => setOpeningModal(false)} title="Capture Opening Stock"
        footer={<>
          <Button variant="text" onClick={() => setOpeningModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={postOpening} disabled={saving}>{saving ? 'Recording...' : 'Record Opening'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_balances" />
          <div>
            <SectionLabel>Item *</SectionLabel>
            <select value={openingForm.item_id} onChange={e => setOpeningForm({ ...openingForm, item_id: e.target.value })} style={inp}>
              <option value="">— Select item —</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.item_code} — {i.description}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Warehouse *</SectionLabel>
            <select value={openingForm.warehouse_id} onChange={e => setOpeningForm({ ...openingForm, warehouse_id: e.target.value })} style={inp}>
              <option value="">— Select warehouse —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Quantity *</SectionLabel>
            <input type="number" min="0.01" step="0.01" value={openingForm.qty}
              onChange={e => setOpeningForm({ ...openingForm, qty: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Unit Cost</SectionLabel>
            <input type="number" min="0" step="0.01" value={openingForm.unit_cost}
              onChange={e => setOpeningForm({ ...openingForm, unit_cost: e.target.value })} style={inp} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
