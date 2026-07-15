import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast } from '../../components/ui'
import { DashCard, KpiCard, DonutGauge, ProgressRow, SectionTitle } from '../../components/dash'

const ACCENT = MODULE_COLORS.inventory

export default function InvDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [balances, setBalances] = useState([])
  const [categories, setCategories] = useState([])

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [itemRes, whRes, balRes, catRes] = await Promise.all([
        supabase.from('items').select('id, item_code, description, category_id, reorder_level, status, is_archived').eq('is_archived', false),
        supabase.from('warehouses').select('id, name, code, type, site_id').eq('site_id', currentSiteId).eq('is_active', true),
        supabase.from('stock_balances').select('item_id, warehouse_id, on_hand_qty, stock_value, warehouse:warehouses!stock_balances_warehouse_id_fkey(site_id)').not('warehouse', 'is', null),
        supabase.from('item_categories').select('id, name'),
      ])
      if (itemRes.error) throw itemRes.error
      if (whRes.error) throw whRes.error
      if (balRes.error) throw balRes.error
      if (catRes.error) throw catRes.error
      setItems(itemRes.data || [])
      setWarehouses(whRes.data || [])
      setBalances((balRes.data || []).filter(b => b.warehouse?.site_id === currentSiteId))
      setCategories(catRes.data || [])
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
    items.forEach(i => {
      const qty = itemBalances[i.id] || 0
      if (qty <= 0) outOfStock++
      else if (i.reorder_level && qty <= i.reorder_level) lowStock++
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

    return { totalSkus, totalValue, totalQty, lowStock, outOfStock, catRows, warehouseCount: warehouses.length }
  }, [items, balances, categories, warehouses])

  if (!can('inventory.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>You don't have permission to view inventory.</div>
      </Card>
    )
  }

  const fmt = v => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

  const quickLinks = [
    { icon: 'category', label: 'Items', page: 'inv_items', color: ACCENT },
    { icon: 'warehouse', label: 'Warehouses', page: 'inv_warehouses', color: '#1A6B52' },
    { icon: 'inventory', label: 'Stock Balances', page: 'inv_balances', color: '#5C6BC0' },
    { icon: 'account_tree', label: 'Categories', page: 'inv_categories', color: '#D97706' },
  ]

  return (
    <div>
      <PageHeader title="Inventory Dashboard" site={currentSite} />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          {(stats.lowStock > 0 || stats.outOfStock > 0) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px',
              borderRadius: '12px', marginBottom: '16px',
              background: stats.outOfStock > 0 ? THEME.statusErrorBg : THEME.statusWarningBg,
              border: `1px solid ${stats.outOfStock > 0 ? THEME.error + '30' : THEME.warning + '30'}`,
            }}>
              <Icon name="warning" size={18} style={{ color: stats.outOfStock > 0 ? THEME.error : THEME.warning }} />
              <span style={{ fontSize: '13px', color: THEME.text }}>
                {stats.outOfStock > 0 && <strong>{stats.outOfStock} items out of stock. </strong>}
                {stats.lowStock > 0 && <span>{stats.lowStock} items below reorder level.</span>}
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <KpiCard label="Total SKUs" value={stats.totalSkus} icon="category" accent={ACCENT} />
            <KpiCard label="Inventory Value" value={fmt(stats.totalValue)} icon="payments" accent={THEME.success} />
            <KpiCard label="Warehouses" value={stats.warehouseCount} icon="warehouse" accent="#5C6BC0" />
            <KpiCard label="Low Stock" value={stats.lowStock} icon="trending_down" accent={THEME.warning}
              progress={stats.totalSkus > 0 ? (stats.lowStock / stats.totalSkus) * 100 : undefined} />
            <KpiCard label="Out of Stock" value={stats.outOfStock} icon="remove_shopping_cart" accent={THEME.error}
              progress={stats.totalSkus > 0 ? (stats.outOfStock / stats.totalSkus) * 100 : undefined} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px', marginBottom: '18px' }}>
            <DashCard>
              <SectionTitle title="Stock Value by Category" />
              {stats.catRows.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: THEME.textLow, fontSize: '13px' }}>No stock data yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {stats.catRows.slice(0, 10).map(r => (
                    <ProgressRow key={r.cat} label={r.cat} value={fmt(r.val)} pct={r.pct} color={ACCENT} />
                  ))}
                </div>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Quick Links" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {quickLinks.map(q => (
                  <div key={q.page} onClick={() => setPage(q.page)} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '14px',
                    borderRadius: '12px', cursor: 'pointer',
                    border: `1px solid ${THEME.outline}`, background: THEME.surface,
                  }}>
                    <Icon name={q.icon} size={22} style={{ color: q.color }} />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{q.label}</span>
                  </div>
                ))}
              </div>
            </DashCard>
          </div>
        </>
      )}
    </div>
  )
}
