import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'

const ACCENT = MODULE_COLORS.inventory

const TYPE_LABELS = {
  opening: 'Opening', grn: 'GRN', issue: 'Issue', return: 'Return',
  transfer_out: 'Transfer Out', transfer_in: 'Transfer In',
  adjustment: 'Adjustment', stock_take: 'Stock Take',
}

export default function InvLedger() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [movements, setMovements] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [whFilter, setWhFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [itemFilter, setItemFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      let q = supabase.from('inventory_movements')
        .select('*, item:items!inventory_movements_item_id_fkey(item_code, description), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name, site_id), creator:profiles!inventory_movements_created_by_fkey(full_name)')
        .not('warehouse', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1000)
      if (dateFrom) q = q.gte('created_at', dateFrom)
      if (dateTo) q = q.lte('created_at', dateTo + 'T23:59:59')
      const [movRes, whRes, itemRes] = await Promise.all([
        q,
        supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
      ])
      if (movRes.error) throw movRes.error
      setMovements((movRes.data || []).filter(m => m.warehouse?.site_id === currentSiteId))
      setWarehouses(whRes.data || [])
      setItems(itemRes.data || [])
    } catch (err) {
      console.error('InvLedger:', err)
      showToast('Failed to load ledger', 'red')
    }
    setLoading(false)
  }, [currentSiteId, dateFrom, dateTo])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch])

  const filtered = useMemo(() => {
    let list = movements
    if (whFilter) list = list.filter(m => m.warehouse_id === whFilter)
    if (typeFilter) list = list.filter(m => m.movement_type === typeFilter)
    if (itemFilter) list = list.filter(m => m.item_id === itemFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.item?.item_code?.toLowerCase().includes(q) ||
        m.item?.description?.toLowerCase().includes(q) ||
        (m.voucher_no || '').toLowerCase().includes(q) ||
        (m.notes || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [movements, search, whFilter, typeFilter, itemFilter])

  function handleExport() {
    const headers = ['Date', 'Type', 'Voucher', 'Item Code', 'Description', 'Warehouse', 'Qty', 'Running Bal', 'Unit Cost', 'Value', 'Notes', 'By']
    const rows = filtered.map(m => [
      new Date(m.created_at).toLocaleString(), TYPE_LABELS[m.movement_type] || m.movement_type,
      m.voucher_no || '', m.item?.item_code || '', m.item?.description || '',
      m.warehouse?.name || '', m.quantity, m.qty_after ?? '',
      m.unit_cost?.toFixed(2) || '', m.value?.toFixed(2) || '',
      m.notes || '', m.creator?.full_name || '',
    ])
    exportCsv('stock_ledger.csv', headers, rows)
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <PageHeader title="Stock Ledger" site={currentSite} actions={
        <Button icon="download" onClick={handleExport}>Export</Button>
      } />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '200px' }} />
        <select value={itemFilter} onChange={e => setItemFilter(e.target.value)} style={{ ...inp, maxWidth: '220px' }}>
          <option value="">All items</option>
          {items.map(i => <option key={i.id} value={i.id}>{i.item_code} — {i.description}</option>)}
        </select>
        <select value={whFilter} onChange={e => setWhFilter(e.target.value)} style={{ ...inp, maxWidth: '180px' }}>
          <option value="">All warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, maxWidth: '150px' }} />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inp, maxWidth: '150px' }} />
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} movements</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Date', 'Type', 'Voucher', 'Item', 'Description', 'Warehouse', 'Qty', 'Balance', 'Unit Cost', 'Value', 'By'].map(h => (
                  <th key={h} style={{ ...th, textAlign: ['Qty', 'Balance', 'Unit Cost', 'Value'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No movements</td></tr>
              ) : filtered.map(m => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap', fontSize: '12px' }}>{new Date(m.created_at).toLocaleString()}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 600,
                      background: m.quantity >= 0 ? THEME.statusSuccessBg : THEME.statusErrorBg,
                      color: m.quantity >= 0 ? THEME.statusSuccessText : THEME.statusErrorText,
                    }}>{TYPE_LABELS[m.movement_type] || m.movement_type}</span>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '11px', color: THEME.textMed }}>{m.voucher_no || '—'}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{m.item?.item_code || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.text, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.item?.description || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{m.warehouse?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: m.quantity < 0 ? THEME.error : '#16a34a' }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: THEME.text }}>{m.qty_after ?? '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.textMed }}>{m.unit_cost ? `$${m.unit_cost.toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.text }}>{m.value ? `$${m.value.toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{m.creator?.full_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
