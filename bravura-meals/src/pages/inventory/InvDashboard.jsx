import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, StatusBadge, showToast } from '../../components/ui'
import { DashCard, KpiCard, ProgressRow, SectionTitle } from '../../components/dash'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.inventory

export default function InvDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [balances, setBalances] = useState([])
  const [categories, setCategories] = useState([])
  const [recentGrns, setRecentGrns] = useState([])
  const [recentIssues, setRecentIssues] = useState([])
  const [pendingReqs, setPendingReqs] = useState([])
  const [pendingPOs, setPendingPOs] = useState([])

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [itemRes, whRes, balRes, catRes, grnRes, issueRes, reqRes, poRes] = await Promise.all([
        supabase.from('items').select('id, item_code, description, category_id, reorder_level, status, is_archived').eq('is_archived', false),
        supabase.from('warehouses').select('id, name, code, type, site_id').eq('site_id', currentSiteId).eq('is_active', true),
        supabase.from('stock_balances').select('item_id, warehouse_id, on_hand_qty, stock_value, warehouse:warehouses!stock_balances_warehouse_id_fkey(site_id)').not('warehouse', 'is', null),
        supabase.from('item_categories').select('id, name'),
        supabase.from('goods_received_notes').select('id, grn_number, supplier_name, total_amount, status, received_date').eq('site_id', currentSiteId).order('received_date', { ascending: false }).limit(5),
        supabase.from('stock_issues').select('id, issue_number, issued_to, status, issue_date').eq('site_id', currentSiteId).order('issue_date', { ascending: false }).limit(5),
        supabase.from('purchase_requisitions').select('id, req_number, title, status, created_at').eq('site_id', currentSiteId).in('status', ['draft', 'submitted', 'pending_approval']).order('created_at', { ascending: false }).limit(5),
        supabase.from('purchase_orders').select('id, po_number, total_amount, status, delivery_status, created_at').eq('site_id', currentSiteId).not('status', 'in', '("completed","cancelled")').order('created_at', { ascending: false }).limit(5),
      ])
      if (itemRes.error) throw itemRes.error
      if (whRes.error) throw whRes.error
      if (balRes.error) throw balRes.error
      if (catRes.error) throw catRes.error
      setItems(itemRes.data || [])
      setWarehouses(whRes.data || [])
      setBalances((balRes.data || []).filter(b => b.warehouse?.site_id === currentSiteId))
      setCategories(catRes.data || [])
      setRecentGrns(grnRes.data || [])
      setRecentIssues(issueRes.data || [])
      setPendingReqs(reqRes.data || [])
      setPendingPOs(poRes.data || [])
    } catch (err) {
      console.error('InvDashboard fetch:', err)
      showToast('Failed to load inventory data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('inventory.view')) fetch() }, [currentSiteId, fetch])

  const stats = useMemo(() => {
    const totalSkus = items.length
    const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]))
    const itemMap = Object.fromEntries(items.map(i => [i.id, i]))

    const totalValue = balances.reduce((s, b) => s + (b.stock_value || 0), 0)
    const totalQty = balances.reduce((s, b) => s + (b.on_hand_qty || 0), 0)

    const itemBalances = {}
    balances.forEach(b => {
      itemBalances[b.item_id] = (itemBalances[b.item_id] || 0) + b.on_hand_qty
    })

    let lowStock = 0
    let outOfStock = 0
    const lowStockItems = []
    items.forEach(i => {
      const qty = itemBalances[i.id] || 0
      if (qty <= 0) { outOfStock++; lowStockItems.push({ ...i, qty, level: 'out' }) }
      else if (i.reorder_level && qty <= i.reorder_level) { lowStock++; lowStockItems.push({ ...i, qty, level: 'low' }) }
    })

    const byCat = {}
    balances.forEach(b => {
      const item = itemMap[b.item_id]
      if (!item) return
      const cat = catMap[item.category_id] || 'Uncategorised'
      byCat[cat] = (byCat[cat] || 0) + (b.stock_value || 0)
    })
    const catRows = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, val]) => ({ cat, val, pct: totalValue > 0 ? (val / totalValue) * 100 : 0 }))

    const whMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]))
    const byWh = {}
    balances.forEach(b => {
      const name = whMap[b.warehouse_id] || 'Unknown'
      byWh[name] = (byWh[name] || 0) + (b.stock_value || 0)
    })
    const whRows = Object.entries(byWh).sort((a, b) => b[1] - a[1])

    return { totalSkus, totalValue, totalQty, lowStock, outOfStock, catRows, warehouseCount: warehouses.length, lowStockItems: lowStockItems.slice(0, 8), whRows }
  }, [items, balances, categories, warehouses])

  if (!can('inventory.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: 10, color: THEME.textMed, fontSize: 14 }}>You don't have permission to view inventory.</div>
      </Card>
    )
  }

  const fmt = v => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_dashboard" />
      <PageHeader title="Inventory Dashboard" site={currentSite} />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          {(stats.lowStock > 0 || stats.outOfStock > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, marginBottom: 16, background: stats.outOfStock > 0 ? THEME.statusErrorBg : THEME.statusWarningBg, border: `1px solid ${stats.outOfStock > 0 ? THEME.error + '30' : THEME.warning + '30'}` }}>
              <Icon name="warning" size={18} style={{ color: stats.outOfStock > 0 ? THEME.error : THEME.warning }} />
              <span style={{ fontSize: 13, color: THEME.text }}>
                {stats.outOfStock > 0 && <strong>{stats.outOfStock} items out of stock. </strong>}
                {stats.lowStock > 0 && <span>{stats.lowStock} items below reorder level.</span>}
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: 12, marginBottom: 18 }}>
            <KpiCard label="Total SKUs" value={stats.totalSkus} icon="category" accent={ACCENT} />
            <KpiCard label="Inventory Value" value={fmt(stats.totalValue)} icon="payments" accent={THEME.success} />
            <KpiCard label="Total Qty" value={stats.totalQty.toLocaleString()} icon="inventory" accent="#5C6BC0" />
            <KpiCard label="Warehouses" value={stats.warehouseCount} icon="warehouse" accent="#1A6B52" />
            <KpiCard label="Low Stock" value={stats.lowStock} icon="trending_down" accent={THEME.warning}
              progress={stats.totalSkus > 0 ? (stats.lowStock / stats.totalSkus) * 100 : undefined} />
            <KpiCard label="Out of Stock" value={stats.outOfStock} icon="remove_shopping_cart" accent={THEME.error}
              progress={stats.totalSkus > 0 ? (stats.outOfStock / stats.totalSkus) * 100 : undefined} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginBottom: 18 }}>
            <DashCard>
              <SectionTitle title="Stock Value by Category" />
              {stats.catRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No stock data yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.catRows.slice(0, 10).map(r => (
                    <ProgressRow key={r.cat} label={r.cat} value={fmt(r.val)} pct={r.pct} color={ACCENT} />
                  ))}
                </div>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Stock by Warehouse" />
              {stats.whRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No warehouse data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.whRows.map(([name, val]) => {
                    const max = Math.max(...stats.whRows.map(r => r[1]))
                    return <ProgressRow key={name} label={name} value={fmt(val)} pct={max > 0 ? (val / max) * 100 : 0} color="#1A6B52" />
                  })}
                </div>
              )}
            </DashCard>
          </div>

          {stats.lowStockItems.length > 0 && (
            <DashCard style={{ marginBottom: 18 }}>
              <SectionTitle title="Items Needing Attention" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                      {['Code', 'Description', 'On Hand', 'Reorder Level', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 700, color: THEME.text }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.lowStockItems.map(i => (
                      <tr key={i.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                        <td style={{ padding: '8px 6px', fontWeight: 600, color: ACCENT }}>{i.item_code}</td>
                        <td style={{ padding: '8px 6px', color: THEME.text }}>{i.description}</td>
                        <td style={{ padding: '8px 6px', color: i.level === 'out' ? THEME.error : THEME.warning, fontWeight: 600 }}>{i.qty}</td>
                        <td style={{ padding: '8px 6px', color: THEME.textMed }}>{i.reorder_level || '—'}</td>
                        <td style={{ padding: '8px 6px' }}><StatusBadge status={i.level === 'out' ? 'out_of_stock' : 'low_stock'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashCard>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginBottom: 18 }}>
            <DashCard>
              <SectionTitle title="Recent Goods Received" />
              {recentGrns.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No recent GRNs</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentGrns.map(g => (
                    <div key={g.id} onClick={() => setPage('inv_grn')} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${THEME.outline}`, cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text }}>{g.grn_number}</div>
                        <div style={{ fontSize: 11, color: THEME.textMed }}>{g.supplier_name} · {new Date(g.received_date).toLocaleDateString()}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: THEME.text }}>${(g.total_amount || 0).toLocaleString()}</div>
                        <StatusBadge status={g.status} />
                      </div>
                    </div>
                  ))}
                  <div onClick={() => setPage('inv_grn')} style={{ fontSize: 12, color: ACCENT, cursor: 'pointer', fontWeight: 600, textAlign: 'center', paddingTop: 6 }}>View all →</div>
                </div>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Recent Stock Issues" />
              {recentIssues.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No recent issues</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {recentIssues.map(i => (
                    <div key={i.id} onClick={() => setPage('inv_issues')} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${THEME.outline}`, cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text }}>{i.issue_number}</div>
                        <div style={{ fontSize: 11, color: THEME.textMed }}>{i.issued_to} · {new Date(i.issue_date).toLocaleDateString()}</div>
                      </div>
                      <StatusBadge status={i.status} />
                    </div>
                  ))}
                  <div onClick={() => setPage('inv_issues')} style={{ fontSize: 12, color: ACCENT, cursor: 'pointer', fontWeight: 600, textAlign: 'center', paddingTop: 6 }}>View all →</div>
                </div>
              )}
            </DashCard>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginBottom: 18 }}>
            <DashCard>
              <SectionTitle title="Pending Requisitions" />
              {pendingReqs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No pending requisitions</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendingReqs.map(r => (
                    <div key={r.id} onClick={() => setPage('inv_requisitions')} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${THEME.outline}`, cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text }}>{r.req_number || 'REQ'}</div>
                        <div style={{ fontSize: 11, color: THEME.textMed }}>{r.title}</div>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                  ))}
                  <div onClick={() => setPage('inv_requisitions')} style={{ fontSize: 12, color: ACCENT, cursor: 'pointer', fontWeight: 600, textAlign: 'center', paddingTop: 6 }}>View all →</div>
                </div>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Active Purchase Orders" />
              {pendingPOs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No active POs</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendingPOs.map(p => (
                    <div key={p.id} onClick={() => setPage('inv_purchase_orders')} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${THEME.outline}`, cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text }}>{p.po_number}</div>
                        <div style={{ fontSize: 11, color: THEME.textMed }}>${(p.total_amount || 0).toLocaleString()}</div>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <StatusBadge status={p.delivery_status || 'pending'} />
                      </div>
                    </div>
                  ))}
                  <div onClick={() => setPage('inv_purchase_orders')} style={{ fontSize: 12, color: ACCENT, cursor: 'pointer', fontWeight: 600, textAlign: 'center', paddingTop: 6 }}>View all →</div>
                </div>
              )}
            </DashCard>
          </div>

          <DashCard>
            <SectionTitle title="Quick Links" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              {[
                { icon: 'category', label: 'Items', page: 'inv_items', color: ACCENT },
                { icon: 'warehouse', label: 'Warehouses', page: 'inv_warehouses', color: '#1A6B52' },
                { icon: 'inventory', label: 'Balances', page: 'inv_balances', color: '#5C6BC0' },
                { icon: 'move_to_inbox', label: 'Goods Received', page: 'inv_grn', color: '#00838F' },
                { icon: 'outbox', label: 'Issues', page: 'inv_issues', color: '#E65100' },
                { icon: 'fact_check', label: 'Stock Take', page: 'inv_stock_take', color: '#6A1B9A' },
                { icon: 'request_quote', label: 'Requisitions', page: 'inv_requisitions', color: '#0277BD' },
                { icon: 'shopping_cart', label: 'Purchase Orders', page: 'inv_purchase_orders', color: '#4527A0' },
              ].map(q => (
                <div key={q.page} onClick={() => setPage(q.page)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, cursor: 'pointer', border: `1px solid ${THEME.outline}`, background: THEME.surface }}>
                  <Icon name={q.icon} size={20} style={{ color: q.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: THEME.text }}>{q.label}</span>
                </div>
              ))}
            </div>
          </DashCard>
        </>
      )}
    </div>
  )
}
