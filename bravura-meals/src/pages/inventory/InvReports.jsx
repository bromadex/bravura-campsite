import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.inventory

const REPORTS = [
  { id: 'valuation', label: 'Stock Valuation', icon: 'attach_money', desc: 'Total stock value by warehouse and item' },
  { id: 'movement_summary', label: 'Movement Summary', icon: 'swap_vert', desc: 'In/out totals by item over a period' },
  { id: 'slow_moving', label: 'Slow-Moving Items', icon: 'hourglass_empty', desc: 'Items with no movement in 30+ days' },
  { id: 'reorder', label: 'Reorder Report', icon: 'shopping_cart', desc: 'Items at or below reorder level' },
]

export default function InvReports({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [activeReport, setActiveReport] = useState('')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  const runReport = useCallback(async (reportId) => {
    if (!currentSiteId) return
    setActiveReport(reportId)
    setLoading(true)
    setData([])
    try {
      if (reportId === 'valuation') {
        const { data: rows, error } = await supabase.from('stock_balances')
          .select('*, item:items!stock_balances_item_id_fkey(item_code, description, category_id), warehouse:warehouses!stock_balances_warehouse_id_fkey(name, site_id)')
          .not('warehouse', 'is', null)
        if (error) throw error
        setData((rows || []).filter(r => r.warehouse?.site_id === currentSiteId && r.on_hand_qty > 0).sort((a, b) => (b.stock_value || 0) - (a.stock_value || 0)))
      } else if (reportId === 'movement_summary') {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
        const { data: rows, error } = await supabase.from('inventory_movements')
          .select('item_id, movement_type, quantity, item:items!inventory_movements_item_id_fkey(item_code, description), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name, site_id)')
          .gte('created_at', thirtyDaysAgo)
          .not('warehouse', 'is', null)
        if (error) throw error
        const siteRows = (rows || []).filter(r => r.warehouse?.site_id === currentSiteId)
        const map = {}
        siteRows.forEach(r => {
          const key = r.item_id
          if (!map[key]) map[key] = { item_code: r.item?.item_code, description: r.item?.description, total_in: 0, total_out: 0, count: 0 }
          map[key].count++
          if (r.quantity > 0) map[key].total_in += r.quantity
          else map[key].total_out += Math.abs(r.quantity)
        })
        setData(Object.values(map).sort((a, b) => b.count - a.count))
      } else if (reportId === 'slow_moving') {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
        const { data: balances, error } = await supabase.from('stock_balances')
          .select('item_id, on_hand_qty, item:items!stock_balances_item_id_fkey(item_code, description), warehouse:warehouses!stock_balances_warehouse_id_fkey(name, site_id)')
          .gt('on_hand_qty', 0)
          .not('warehouse', 'is', null)
        if (error) throw error
        const siteBalances = (balances || []).filter(b => b.warehouse?.site_id === currentSiteId)
        const { data: recentMoves } = await supabase.from('inventory_movements')
          .select('item_id')
          .gte('created_at', thirtyDaysAgo)
        const activeItems = new Set((recentMoves || []).map(m => m.item_id))
        setData(siteBalances.filter(b => !activeItems.has(b.item_id)))
      } else if (reportId === 'reorder') {
        const { data: rows, error } = await supabase.from('stock_balances')
          .select('on_hand_qty, item:items!stock_balances_item_id_fkey(item_code, description, reorder_level, reorder_qty, min_stock), warehouse:warehouses!stock_balances_warehouse_id_fkey(name, site_id)')
          .not('warehouse', 'is', null)
        if (error) throw error
        setData((rows || []).filter(r => r.warehouse?.site_id === currentSiteId && r.item?.reorder_level && r.on_hand_qty <= r.item.reorder_level).sort((a, b) => a.on_hand_qty - b.on_hand_qty))
      }
    } catch (err) {
      console.error('InvReports:', err)
      showToast('Report failed', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  function exportReport() {
    if (activeReport === 'valuation') {
      exportCsv('stock_valuation.csv', ['Item Code', 'Description', 'Warehouse', 'On Hand', 'Unit Value', 'Stock Value'],
        data.map(r => [r.item?.item_code, r.item?.description, r.warehouse?.name, r.on_hand_qty, r.valuation_rate?.toFixed(2), r.stock_value?.toFixed(2)]))
    } else if (activeReport === 'movement_summary') {
      exportCsv('movement_summary.csv', ['Item Code', 'Description', 'Movements', 'Total In', 'Total Out'],
        data.map(r => [r.item_code, r.description, r.count, r.total_in, r.total_out]))
    } else if (activeReport === 'slow_moving') {
      exportCsv('slow_moving.csv', ['Item Code', 'Description', 'Warehouse', 'On Hand'],
        data.map(r => [r.item?.item_code, r.item?.description, r.warehouse?.name, r.on_hand_qty]))
    } else if (activeReport === 'reorder') {
      exportCsv('reorder_report.csv', ['Item Code', 'Description', 'Warehouse', 'On Hand', 'Reorder Level', 'Reorder Qty'],
        data.map(r => [r.item?.item_code, r.item?.description, r.warehouse?.name, r.on_hand_qty, r.item?.reorder_level, r.item?.reorder_qty]))
    }
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_reports" />
      <PageHeader title="Inventory Reports" site={currentSite} actions={
        activeReport && data.length > 0 && <Button icon="download" onClick={exportReport}>Export</Button>
      } />

      {!activeReport ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {REPORTS.map(r => (
            <Card key={r.id} onClick={() => runReport(r.id)} style={{ cursor: 'pointer', padding: '24px', transition: 'box-shadow .15s' }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={r.icon} size={22} style={{ color: ACCENT }} />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>{r.label}</div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{r.desc}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
            <button onClick={() => { setActiveReport(''); setData([]) }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: ACCENT, fontSize: '13px', fontWeight: 600, fontFamily: 'inherit' }}>
              <Icon name="arrow_back" size={18} /> All Reports
            </button>
            <span style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{REPORTS.find(r => r.id === activeReport)?.label}</span>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{data.length} rows</span>
          </div>

          {loading ? (
            <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Running report...</Card>
          ) : (
            <Card style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                {activeReport === 'valuation' && <>
                  <thead><tr>{['Item Code', 'Description', 'Warehouse', 'On Hand', 'Unit Value', 'Stock Value'].map(h => <th key={h} style={{ ...th, textAlign: ['On Hand', 'Unit Value', 'Stock Value'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{r.item?.item_code}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{r.item?.description}</td>
                        <td style={{ padding: '8px 10px', color: THEME.textMed }}>{r.warehouse?.name}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{r.on_hand_qty}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.textMed }}>${r.valuation_rate?.toFixed(2)}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: THEME.text }}>${r.stock_value?.toFixed(2)}</td>
                      </tr>
                    ))}
                    {data.length > 0 && (
                      <tr style={{ borderTop: `2px solid ${THEME.outline}` }}>
                        <td colSpan={5} style={{ padding: '10px', fontWeight: 700, textAlign: 'right', color: THEME.text }}>Total</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700, color: ACCENT, fontSize: '14px' }}>${data.reduce((s, r) => s + (r.stock_value || 0), 0).toFixed(2)}</td>
                      </tr>
                    )}
                  </tbody>
                </>}
                {activeReport === 'movement_summary' && <>
                  <thead><tr>{['Item Code', 'Description', 'Movements', 'Total In', 'Total Out', 'Net'].map(h => <th key={h} style={{ ...th, textAlign: ['Movements', 'Total In', 'Total Out', 'Net'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{r.item_code}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{r.description}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{r.count}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>+{r.total_in}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.error, fontWeight: 600 }}>-{r.total_out}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{r.total_in - r.total_out}</td>
                      </tr>
                    ))}
                  </tbody>
                </>}
                {activeReport === 'slow_moving' && <>
                  <thead><tr>{['Item Code', 'Description', 'Warehouse', 'On Hand'].map(h => <th key={h} style={{ ...th, textAlign: h === 'On Hand' ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No slow-moving items found</td></tr> :
                    data.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{r.item?.item_code}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{r.item?.description}</td>
                        <td style={{ padding: '8px 10px', color: THEME.textMed }}>{r.warehouse?.name}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: THEME.warning }}>{r.on_hand_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </>}
                {activeReport === 'reorder' && <>
                  <thead><tr>{['Item Code', 'Description', 'Warehouse', 'On Hand', 'Reorder At', 'Order Qty'].map(h => <th key={h} style={{ ...th, textAlign: ['On Hand', 'Reorder At', 'Order Qty'].includes(h) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>All items above reorder level</td></tr> :
                    data.map((r, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{r.item?.item_code}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{r.item?.description}</td>
                        <td style={{ padding: '8px 10px', color: THEME.textMed }}>{r.warehouse?.name}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: THEME.error }}>{r.on_hand_qty}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.textMed }}>{r.item?.reorder_level}</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600 }}>{r.item?.reorder_qty || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </>}
              </table>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
