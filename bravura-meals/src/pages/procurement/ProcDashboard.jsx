import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, StatusBadge, showToast } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle } from '../../components/dash'
import QuickNav, { PROCUREMENT_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.procurement
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export { PROCUREMENT_PILLS }

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
          {hover.label}: {hover.value} ({(hover.pct * 100).toFixed(1)}%)
        </div>
      )}
    </div>
  )
}

function BarChart({ data, width = 500, height = 220, accent }) {
  const [tooltip, setTooltip] = useState(null)
  const maxVal = Math.max(...data.map(d => d.value), 1)
  const barW = Math.min(28, (width - 80) / data.length / 1.8)
  const chartH = height - 50
  const chartL = 55, chartR = width - 10

  return (
    <div style={{ position: 'relative' }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = 10 + chartH * (1 - f)
          return (
            <g key={f}>
              <line x1={chartL} y1={y} x2={chartR} y2={y} stroke={THEME.outline} strokeWidth={0.5} />
              <text x={chartL - 6} y={y + 4} textAnchor="end" style={{ fontSize: 9, fill: THEME.textMed }}>{fmtK(maxVal * f)}</text>
            </g>
          )
        })}
        {data.map((d, i) => {
          const x = chartL + ((chartR - chartL) / data.length) * (i + 0.5)
          const h = (d.value / maxVal) * chartH
          return (
            <g key={d.label}
              onMouseEnter={() => setTooltip({ x, ...d })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={x - barW / 2} y={10 + chartH - h} width={barW} height={h} rx={3} fill={accent} opacity={0.85} />
              <text x={x} y={height - 6} textAnchor="middle" style={{ fontSize: 9, fill: THEME.textMed }}>{d.label}</text>
            </g>
          )
        })}
      </svg>
      {tooltip && (
        <div style={{
          position: 'absolute', top: 0, left: `${(tooltip.x / width) * 100}%`, transform: 'translateX(-50%)',
          background: THEME.text, color: THEME.surface, padding: '8px 12px', borderRadius: 8, fontSize: 12, zIndex: 10, pointerEvents: 'none', whiteSpace: 'nowrap'
        }}>
          <div style={{ fontWeight: 700 }}>{tooltip.label}</div>
          <div>{tooltip.count} order{tooltip.count !== 1 ? 's' : ''} — {fmtK(tooltip.value)}</div>
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
  const [hover, setHover] = useState(false)

  return (
    <div style={{ textAlign: 'center', position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <svg width={size} height={size / 2 + 16} viewBox={`0 0 ${size} ${size / 2 + 16}`}>
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={THEME.outline} strokeWidth={10} strokeLinecap="round" />
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={gaugeColor} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: THEME.text }}>{value}</text>
      </svg>
      <div style={{ fontSize: 11, color: THEME.textMed, marginTop: -4 }}>{label}</div>
      {hover && (
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 11, whiteSpace: 'nowrap', zIndex: 10, pointerEvents: 'none', marginBottom: 4 }}>
          {label}: {value} of {max} total ({pct.toFixed(0)}%)
        </div>
      )}
    </div>
  )
}

function SparkLine({ data, width = 100, height = 30, color: lineColor = ACCENT }) {
  if (!data.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  )
}

export default function ProcDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('purchase_orders', { column: 'site_id', value: currentSiteId })
  const [loading, setLoading] = useState(true)
  const [pos, setPos] = useState([])
  const [rfqs, setRfqs] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [events, setEvents] = useState([])

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [poRes, rfqRes, supRes] = await Promise.all([
        supabase.from('purchase_orders').select('id, po_number, supplier_id, total_amount, status, delivery_status, priority, created_at').eq('site_id', currentSiteId),
        supabase.from('rfqs').select('id, rfq_number, title, status, deadline, created_at').eq('site_id', currentSiteId),
        supabase.from('procurement_suppliers').select('id, supplier_name, status').eq('site_id', currentSiteId),
      ])
      setPos(poRes.data || [])
      setRfqs(rfqRes.data || [])
      setSuppliers(supRes.data || [])
      const poIds = (poRes.data || []).map(p => p.id)
      if (poIds.length > 0) {
        const evRes = await supabase.from('po_tracking_events').select('id, po_id, event_type, location, notes, created_at').in('po_id', poIds).order('created_at', { ascending: false }).limit(20)
        setEvents(evRes.data || [])
      } else {
        setEvents([])
      }
    } catch (err) {
      showToast('Failed to load procurement data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) load() }, [currentSiteId, load, rt])

  const stats = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const currentMonth = now.getMonth()

    const activePOs = pos.filter(p => !['cancelled', 'completed'].includes(p.status))
    const inTransit = pos.filter(p => p.delivery_status === 'in_transit')
    const delayed = pos.filter(p => p.delivery_status === 'delayed')
    const atCustoms = pos.filter(p => p.delivery_status === 'at_customs')
    const openRFQs = rfqs.filter(r => ['draft', 'sent', 'responses_received'].includes(r.status))
    const totalSpend = pos.filter(p => p.status !== 'cancelled').reduce((s, p) => s + (p.total_amount || 0), 0)
    const urgent = pos.filter(p => p.priority === 'urgent' && !['cancelled', 'completed'].includes(p.status))

    const deliverySegments = []
    const deliveryMap = {}
    pos.forEach(p => {
      const st = p.delivery_status || 'pending'
      deliveryMap[st] = (deliveryMap[st] || 0) + 1
    })
    const deliveryColors = { pending: '#9E9E9E', in_transit: '#E65100', at_customs: '#D97706', delayed: THEME.error, delivered: THEME.success, partial: '#5C6BC0' }
    Object.entries(deliveryMap).sort((a, b) => b[1] - a[1]).forEach(([st, count]) => {
      deliverySegments.push({ label: st.replace(/_/g, ' '), value: count, color: deliveryColors[st] || ACCENT })
    })

    const statusSegments = []
    const statusMap = {}
    pos.forEach(p => { statusMap[p.status || 'unknown'] = (statusMap[p.status || 'unknown'] || 0) + 1 })
    const statusColors = { draft: '#9E9E9E', submitted: '#1565C0', approved: '#43A047', in_progress: '#E65100', completed: THEME.success, cancelled: THEME.error }
    Object.entries(statusMap).sort((a, b) => b[1] - a[1]).forEach(([st, count]) => {
      statusSegments.push({ label: st.replace(/_/g, ' '), value: count, color: statusColors[st] || ACCENT })
    })

    const monthlySpend = {}
    for (let m = 0; m <= currentMonth; m++) monthlySpend[m] = { count: 0, value: 0 }
    pos.forEach(p => {
      if (p.status === 'cancelled') return
      const d = new Date(p.created_at)
      if (d.getFullYear() !== year) return
      const m = d.getMonth()
      if (m <= currentMonth) {
        monthlySpend[m].count++
        monthlySpend[m].value += (p.total_amount || 0)
      }
    })
    const monthlyData = Object.entries(monthlySpend).map(([m, d]) => ({
      label: MONTHS[m], value: d.value, count: d.count,
    }))

    const spendSparkline = monthlyData.map(d => d.value)

    return {
      activePOs: activePOs.length, inTransit: inTransit.length, delayed: delayed.length,
      atCustoms: atCustoms.length, openRFQs: openRFQs.length, totalSpend, urgent: urgent.length,
      supplierCount: suppliers.filter(s => s.status === 'active').length,
      deliverySegments, statusSegments, monthlyData, spendSparkline,
      totalPOs: pos.length,
    }
  }, [pos, rfqs, suppliers])

  if (!can('procurement.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: 10, color: THEME.textMed, fontSize: 14 }}>No procurement access.</div></Card>
  }

  return (
    <div>
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_dashboard" />
      <PageHeader title="Procurement Dashboard" site={currentSite} />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>
          <Icon name="progress_activity" size={22} style={{ color: THEME.textLow, animation: 'spin 1s linear infinite' }} />
          <div style={{ marginTop: 8 }}>Loading…</div>
        </Card>
      ) : (
        <>
          {(stats.delayed > 0 || stats.urgent > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, marginBottom: 16, background: THEME.statusErrorBg, border: `1px solid ${THEME.error}30` }}>
              <Icon name="warning" size={18} style={{ color: THEME.error }} />
              <span style={{ fontSize: 13, color: THEME.text }}>
                {stats.delayed > 0 && <strong>{stats.delayed} delayed order{stats.delayed !== 1 ? 's' : ''}. </strong>}
                {stats.urgent > 0 && <span>{stats.urgent} urgent order{stats.urgent !== 1 ? 's' : ''} pending.</span>}
              </span>
            </div>
          )}

          {/* KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <DashCard style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Total Spend (YTD)</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: ACCENT }}>{fmtK(stats.totalSpend)}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>{stats.totalPOs} purchase orders</div>
                </div>
                <SparkLine data={stats.spendSparkline} color={ACCENT} />
              </div>
            </DashCard>

            <DashCard style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Active Orders</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{stats.activePOs}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>{stats.inTransit} in transit</div>
                </div>
                <Icon name="local_shipping" size={28} style={{ color: ACCENT, opacity: 0.3 }} />
              </div>
            </DashCard>

            <DashCard style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Open RFQs</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#00838F' }}>{stats.openRFQs}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>Awaiting responses</div>
                </div>
                <Icon name="request_quote" size={28} style={{ color: '#00838F', opacity: 0.3 }} />
              </div>
            </DashCard>

            <DashCard style={{ padding: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 6 }}>Active Suppliers</div>
                  <div style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#1565C0' }}>{stats.supplierCount}</div>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginTop: 4 }}>Registered vendors</div>
                </div>
                <Icon name="business" size={28} style={{ color: '#1565C0', opacity: 0.3 }} />
              </div>
            </DashCard>
          </div>

          {/* Row 2: Gauges + Monthly Spend chart */}
          <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, marginBottom: 20, alignItems: 'stretch' }}>
            <DashCard>
              <SectionTitle title="Order Pipeline" />
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, marginTop: 8 }}>
                <GaugeChart value={stats.inTransit} max={stats.activePOs || 1} label="In Transit" color="#E65100" size={100} />
                <GaugeChart value={stats.atCustoms} max={stats.activePOs || 1} label="At Customs" color="#D97706" size={100} />
                <GaugeChart value={stats.delayed} max={stats.activePOs || 1} label="Delayed" color={THEME.error} size={100} />
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: THEME.textMed, textAlign: 'center' }}>
                {stats.activePOs} active orders
              </div>
            </DashCard>

            <DashCard>
              <SectionTitle title="Monthly Spend (YTD)" />
              {stats.monthlyData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No spend data</div>
              ) : (
                <BarChart data={stats.monthlyData} accent={ACCENT} />
              )}
            </DashCard>
          </div>

          {/* Row 3: Delivery Donut + Status Donut + Tracking Events */}
          <div style={{ display: 'grid', gridTemplateColumns: '200px 200px 1fr', gap: 16, marginBottom: 20 }}>
            <DashCard>
              <SectionTitle title="Delivery Status" />
              {stats.deliverySegments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No orders</div>
              ) : (
                <>
                  <DonutChart segments={stats.deliverySegments} label="Orders" centerValue={stats.totalPOs} size={130} />
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {stats.deliverySegments.map(s => (
                      <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                          <span style={{ color: THEME.textMed, textTransform: 'capitalize' }}>{s.label}</span>
                        </span>
                        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="PO Status" />
              {stats.statusSegments.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No orders</div>
              ) : (
                <>
                  <DonutChart segments={stats.statusSegments} label="Orders" centerValue={stats.totalPOs} size={130} />
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {stats.statusSegments.map(s => (
                      <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                          <span style={{ color: THEME.textMed, textTransform: 'capitalize' }}>{s.label}</span>
                        </span>
                        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Recent Tracking Events" />
              {events.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No tracking events yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {events.slice(0, 10).map(ev => (
                    <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${THEME.outline}` }}>
                      <div style={{ width: 28, height: 28, borderRadius: 6, background: ACCENT + '15', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="place" size={14} style={{ color: ACCENT }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: THEME.text, textTransform: 'capitalize' }}>{ev.event_type.replace(/_/g, ' ')}</div>
                        {ev.location && <div style={{ fontSize: 11, color: THEME.textMed }}>{ev.location}</div>}
                      </div>
                      <span style={{ fontSize: 10, color: THEME.textLow, whiteSpace: 'nowrap' }}>{new Date(ev.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </DashCard>
          </div>

          {/* Quick Actions */}
          <DashCard>
            <SectionTitle title="Quick Actions" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
              {[
                { icon: 'add_circle', label: 'New RFQ', page: 'proc_rfqs', color: '#00838F' },
                { icon: 'local_shipping', label: 'Track Orders', page: 'proc_tracking', color: '#E65100' },
                { icon: 'business', label: 'Suppliers', page: 'proc_suppliers', color: '#1565C0' },
                { icon: 'bar_chart', label: 'Reports', page: 'proc_reports', color: '#C62828' },
                { icon: 'shopping_cart', label: 'Purchase Orders', page: 'proc_purchase_orders', color: ACCENT },
                { icon: 'request_quote', label: 'RFQ List', page: 'proc_rfqs', color: '#6A1B9A' },
              ].map(q => (
                <button key={q.page + q.label} onClick={() => setPage(q.page)} style={{
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
