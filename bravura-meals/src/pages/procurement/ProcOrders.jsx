import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, StatusBadge, showToast } from '../../components/ui'
import QuickNav from '../../components/QuickNav'
import { PROCUREMENT_PILLS } from './ProcDashboard'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const CLR = MODULE_COLORS.procurement

export default function ProcOrders({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('purchase_orders', { column: 'site_id', value: currentSiteId })
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const fetchOrders = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data } = await supabase
      .from('purchase_orders')
      .select('id, po_number, supplier:procurement_suppliers(supplier_name), total_amount, status, delivery_status, priority, current_location, tracking_ref, shipped_at, delivered_at, delivery_address, created_at')
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetchOrders() }, [currentSiteId, fetchOrders, rt])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return orders
      .filter(o => statusFilter === 'all' || o.delivery_status === statusFilter)
      .filter(o => priorityFilter === 'all' || o.priority === priorityFilter)
      .filter(o => !q || o.po_number?.toLowerCase().includes(q) || o.supplier?.supplier_name?.toLowerCase().includes(q) || o.current_location?.toLowerCase().includes(q))
  }, [orders, search, statusFilter, priorityFilter])

  const totalValue = useMemo(() => filtered.reduce((s, o) => s + (o.total_amount || 0), 0), [filtered])

  if (!can('procurement.view')) return <Card style={{ textAlign: 'center', padding: 40 }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /></Card>

  return (
    <div>
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_orders" />
      <PageHeader title="Purchase Orders" site={currentSite} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search PO#, supplier, location..." style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13 }}>
          <option value="all">All Status</option>
          {['pending','ordered','in_transit','at_customs','at_warehouse','delivered','delayed'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13 }}>
          <option value="all">All Priority</option>
          {['low','normal','high','urgent'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 12, color: THEME.textMed, fontWeight: 600 }}>{filtered.length} orders · ${totalValue.toLocaleString()}</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>Loading...</Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textLow }}>No orders found</Card>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                {['PO #', 'Supplier', 'Amount', 'Priority', 'Delivery Status', 'Location', 'Shipped', 'Delivered'].map(h => (
                  <th key={h} style={{ padding: '10px 8px', textAlign: 'left', fontWeight: 700, color: THEME.text, fontSize: 12 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => (
                <tr key={o.id} style={{ borderBottom: `1px solid ${THEME.outline}`, cursor: 'pointer' }} onClick={() => setPage('proc_tracking')}>
                  <td style={{ padding: '10px 8px', fontWeight: 600, color: CLR }}>{o.po_number}</td>
                  <td style={{ padding: '10px 8px', color: THEME.text }}>{o.supplier?.supplier_name || '—'}</td>
                  <td style={{ padding: '10px 8px', color: THEME.text }}>${(o.total_amount || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px 8px' }}><StatusBadge status={o.priority} /></td>
                  <td style={{ padding: '10px 8px' }}><StatusBadge status={o.delivery_status || 'pending'} /></td>
                  <td style={{ padding: '10px 8px', color: THEME.textMed, fontSize: 12 }}>{o.current_location || '—'}</td>
                  <td style={{ padding: '10px 8px', color: THEME.textLow, fontSize: 11 }}>{o.shipped_at ? new Date(o.shipped_at).toLocaleDateString() : '—'}</td>
                  <td style={{ padding: '10px 8px', color: THEME.textLow, fontSize: 11 }}>{o.delivered_at ? new Date(o.delivered_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
