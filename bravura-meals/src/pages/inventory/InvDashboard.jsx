import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, StatusBadge, showToast } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle } from '../../components/dash'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.inventory

function fmtK(v) {
  const abs = Math.abs(v)
  if (abs >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  if (abs >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function DonutChart({ segments, size = 140, label, centerValue }) {
  const [hover, setHover] = useState(null)
  const r = (size - 24) / 2
  const cx = size / 2, cy = size / 2
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  let cumAngle = -90

  const arcs = segments.map(seg => {
    const pct = total > 0 ? seg.value / total : 0
    const angle = pct * 360
    const startAngle = cumAngle
    cumAngle += angle
    const endAngle = cumAngle
    const startRad = (startAngle * Math.PI) / 180
    const endRad = (endAngle * Math.PI) / 180
    const largeArc = angle > 180 ? 1 : 0
    const x1 = cx + r * Math.cos(startRad), y1 = cy + r * Math.sin(startRad)
    const x2 = cx + r * Math.cos(endRad), y2 = cy + r * Math.sin(endRad)
    return { ...seg, pct, d: pct >= 0.999 ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 1 ${cx - r - 0.01} ${cy}` : `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}` }
  })

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={THEME.outline} strokeWidth={16} />
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={16} strokeLinecap="butt"
            onMouseEnter={() => setHover(arc)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer', opacity: hover && hover.label !== arc.label ? 0.4 : 1, transition: 'opacity .2s' }}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: 16, fontWeight: 700, fill: THEME.text }}>{centerValue}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: 9, fill: THEME.textMed }}>{label}</text>
      </svg>
      {hover && (
        <div style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none' }}>
          {hover.label}: {fmtK(hover.value)} ({(hover.pct * 100).toFixed(1)}%)
        </div>
      )}
    </div>
  )
}

function HBarChart({ data, width = 500, height }) {
  const [hover, setHover] = useState(null)
  const barH = 26
  const gap = 8
  const computedH = height || (data.length * (barH + gap) + 20)
  const maxVal = Math.max(...data.map(d => d.value), 1)
  const labelW = 120, chartR = width - 60

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${width} ${computedH}`} style={{ display: 'block' }}>
        {data.map((d, i) => {
          const y = 10 + i * (barH + gap)
          const w = ((d.value / maxVal) * (chartR - labelW))
          return (
            <g key={d.label}
              onMouseEnter={() => setHover(d)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}
            >
              <text x={labelW - 8} y={y + barH / 2 + 4} textAnchor="end" style={{ fontSize: 11, fill: THEME.text, fontWeight: 500 }}>
                {d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label}
              </text>
              <rect x={labelW} y={y} width={Math.max(w, 2)} height={barH} rx={4} fill={d.color || ACCENT} opacity={hover && hover.label !== d.label ? 0.4 : 0.85} style={{ transition: 'opacity .2s' }} />
              <text x={labelW + w + 6} y={y + barH / 2 + 4} style={{ fontSize: 10, fill: THEME.textMed, fontWeight: 600 }}>{fmtK(d.value)}</text>
            </g>
          )
        })}
      </svg>
      {hover && (
        <div style={{
          position: 'absolute', top: -4, right: 0,
          background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none'
        }}>
          {hover.label}: {fmtK(hover.value)}
        </div>
      )}
    </div>
  )
}

function GaugeChart({ value, max, label, color: gaugeColor, size = 110 }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  const r = (size - 16) / 2
  const cx = size / 2, cy = size / 2
  const circumference = Math.PI * r
  const offset = circumference - (pct / 100) * circumference
  const [hov, setHov] = useState(false)

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <svg width={size} height={size / 2 + 16} viewBox={`0 0 ${size} ${size / 2 + 16}`}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={THEME.outline} strokeWidth={10} strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={gaugeColor} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: THEME.text }}>{pct.toFixed(0)}%</text>
      </svg>
      <div style={{ fontSize: 11, color: THEME.textMed, marginTop: -4 }}>{label}</div>
      {hov && (
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none', marginBottom: 4 }}>
          {label}: {value} of {max} items ({pct.toFixed(0)}%)
        </div>
      )}
    </div>
  )
}

const CAT_COLORS = ['#1565C0', '#43A047', '#E65100', '#6A1B9A', '#00838F', '#D32F2F', '#EF6C00', '#5C6BC0', '#2E7D32', '#C62828']

export default function InvDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('stock_balances', { column: 'site_id', value: currentSiteId })
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [balances, setBalances] = useState([])
  const [categories, setCategories] = useState([])
  const [pendingReqs, setPendingReqs] = useState([])
  const [pendingPOs, setPendingPOs] = useState([])

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [itemRes, whRes, balRes, catRes, reqRes, poRes] = await Promise.all([
        supabase.from('items').select('id, item_code, description, category_id, reorder_level, status, is_archived').eq('is_archived', false),
        supabase.from('warehouses').select('id, name, code, type, site_id').eq('site_id', currentSiteId).eq('is_active', true),
        supabase.from('stock_balances').select('item_id, warehouse_id, on_hand_qty, stock_value, warehouse:warehouses!stock_balances_warehouse_id_fkey(site_id)').not('warehouse', 'is', null),
        supabase.from('item_categories').select('id, name'),
        supabase.from('purchase_requisitions').select('id, requisition_no, status, created_at').eq('site_id', currentSiteId).in('status', ['draft', 'submitted', 'pending_approval']).order('created_at', { ascending: false }).limit(5),
        supabase.from('purchase_orders').select('id, po_number, total_amount, status, delivery_status, created_at').eq('site_id', currentSiteId).not('status', 'in', '("completed","cancelled")').order('created_at', { ascending: false }).limit(5),
      ])
      if (itemRes.error) throw itemRes.error
      setItems(itemRes.data || [])
      setWarehouses(whRes.data || [])
      setBalances((balRes.data || []).filter(b => b.warehouse?.site_id === currentSiteId))
      setCategories(catRes.data || [])
      setPendingReqs(reqRes.data || [])
      setPendingPOs(poRes.data || [])
    } catch (err) {
      console.error('InvDashboard fetch:', err)
      showToast('Failed to load inventory data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('inventory.view')) load() }, [currentSiteId, load, rt])

  const stats = useMemo(() => {
    const totalSkus = items.length
    const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]))
    const itemMap = Object.fromEntries(items.map(i => [i.id, i]))

    const totalValue = balances.reduce((s, b) => s + (b.stock_value || 0), 0)
    const totalQty = balances.reduce((s, b) => s + (b.on_hand_qty || 0), 0)

    const itemBalances = {}
    balances.forEach(b => { itemBalances[b.item_id] = (itemBalances[b.item_id] || 0) + b.on_hand_qty })

    let lowStock = 0, outOfStock = 0
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
    const catSegments = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([cat, val], i) => ({ label: cat, value: val, color: CAT_COLORS[i % CAT_COLORS.length] }))

    const whMap = Object.fromEntries(warehouses.map(w => [w.id, w.name]))
    const byWh = {}
    balances.forEach(b => {
      const name = whMap[b.warehouse_id] || 'Unknown'
      byWh[name] = (byWh[name] || 0) + (b.stock_value || 0)
    })
    const whBars = Object.entries(byWh).sort((a, b) => b[1] - a[1]).map(([name, val]) => ({ label: name, value: val, color: '#1A6B52' }))

    return { totalSkus, totalValue, totalQty, lowStock, outOfStock, catSegments, warehouseCount: warehouses.length, lowStockItems: lowStockItems.slice(0, 8), whBars }
  }, [items, balances, categories, warehouses])

  if (!can('inventory.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: 40 }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: 10, color: THEME.textMed, fontSize: 14 }}>You don't have permission to view inventory.</div>
      </Card>
    )
  }

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_dashboard" />
      <PageHeader title="Inventory Dashboard" site={currentSite} />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>
          <Icon name="progress_activity" size={22} style={{ color: THEME.textLow, animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>Loading…</div>
        </Card>
      ) : (
        <>
          {(stats.lowStock > 0 || stats.outOfStock > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, marginBottom: 16, background: stats.outOfStock > 0 ? THEME.statusErrorBg : THEME.statusWarningBg, border: `1px solid ${stats.outOfStock > 0 ? THEME.error + '30' : THEME.warning + '30'}` }}>
              <Icon name="warning" size={18} style={{ color: stats.outOfStock > 0 ? THEME.error : THEME.warning }} />
              <span style={{ fontSize: 13, color: THEME.text }}>
                {stats.outOfStock > 0 && <strong>{stats.outOfStock} item{stats.outOfStock !== 1 ? 's' : ''} out of stock. </strong>}
                {stats.lowStock > 0 && <span>{stats.lowStock} item{stats.lowStock !== 1 ? 's' : ''} below reorder level.</span>}
              </span>
            </div>
          )}

          {/* KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <DashCard style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Inventory Value</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: THEME.success }}>{fmtK(stats.totalValue)}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>Across {stats.warehouseCount} warehouse{stats.warehouseCount !== 1 ? 's' : ''}</div>
                </div>
                <Icon name="payments" size={28} style={{ color: THEME.success, opacity: 0.3 }} />
              </div>
            </DashCard>

            <DashCard style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Total SKUs</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: ACCENT }}>{stats.totalSkus}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>{stats.totalQty.toLocaleString()} units on hand</div>
                </div>
                <Icon name="category" size={28} style={{ color: ACCENT, opacity: 0.3 }} />
              </div>
            </DashCard>

            <DashCard style={{ padding: '18px' }}>
              <GaugeChart value={stats.lowStock} max={stats.totalSkus || 1} label="Low Stock Items" color={THEME.warning} size={110} />
            </DashCard>

            <DashCard style={{ padding: '18px' }}>
              <GaugeChart value={stats.outOfStock} max={stats.totalSkus || 1} label="Out of Stock" color={THEME.error} size={110} />
            </DashCard>
          </div>

          {/* Row 2: Category Donut + Warehouse Bars */}
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, marginBottom: 20, alignItems: 'stretch' }}>
            <DashCard>
              <SectionTitle title="Value by Category" />
              {stats.catSegments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No stock data</div>
              ) : (
                <>
                  <DonutChart segments={stats.catSegments} label="Total Value" centerValue={fmtK(stats.totalValue)} size={150} />
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {stats.catSegments.map(s => (
                      <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                          <span style={{ color: THEME.textMed }}>{s.label}</span>
                        </span>
                        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmtK(s.value)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Stock Value by Warehouse" />
              {stats.whBars.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No warehouse data</div>
              ) : (
                <HBarChart data={stats.whBars} />
              )}
            </DashCard>
          </div>

          {/* Row 3: Low Stock Table */}
          {stats.lowStockItems.length > 0 && (
            <DashCard style={{ marginBottom: 20 }}>
              <SectionTitle title="Items Needing Attention" />
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                      {['Code', 'Description', 'On Hand', 'Reorder Level', 'Status'].map(h => (
                        <th key={h} style={{ padding: '8px 6px', textAlign: 'left', fontWeight: 700, color: THEME.text, fontSize: 10, textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.lowStockItems.map(i => (
                      <tr key={i.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                        <td style={{ padding: '8px 6px', fontWeight: 600, color: ACCENT }}>{i.item_code}</td>
                        <td style={{ padding: '8px 6px', color: THEME.text }}>{i.description}</td>
                        <td style={{ padding: '8px 6px', color: i.level === 'out' ? THEME.error : THEME.warning, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{i.qty}</td>
                        <td style={{ padding: '8px 6px', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{i.reorder_level || '—'}</td>
                        <td style={{ padding: '8px 6px' }}><StatusBadge status={i.level === 'out' ? 'out_of_stock' : 'low_stock'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DashCard>
          )}

          {/* Row 4: Pending Requisitions + Active POs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 20 }}>
            <DashCard>
              <SectionTitle title="Pending Requisitions" />
              {pendingReqs.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No pending requisitions</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pendingReqs.map(r => (
                    <div key={r.id} onClick={() => setPage('inv_requisitions')} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${THEME.outline}`, cursor: 'pointer' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text }}>{r.requisition_no || 'REQ'}</div>
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
                      <StatusBadge status={p.delivery_status || 'pending'} />
                    </div>
                  ))}
                  <div onClick={() => setPage('inv_purchase_orders')} style={{ fontSize: 12, color: ACCENT, cursor: 'pointer', fontWeight: 600, textAlign: 'center', paddingTop: 6 }}>View all →</div>
                </div>
              )}
            </DashCard>
          </div>

          {/* Quick Links */}
          <DashCard>
            <SectionTitle title="Quick Links" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
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
                <button key={q.page} onClick={() => setPage(q.page)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  background: THEME.surfaceVar, border: 'none', borderRadius: 8, cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: 600, color: THEME.text,
                }}>
                  <Icon name={q.icon} size={18} style={{ color: q.color }} />
                  {q.label}
                </button>
              ))}
            </div>
          </DashCard>
        </>
      )}
    </div>
  )
}
