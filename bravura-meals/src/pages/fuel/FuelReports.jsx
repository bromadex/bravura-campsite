import { useState, useMemo, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Icon, fmtDate, MONTHS,
  TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'
import { parseTxnNotes } from './fuelDisplay'
import FuelQuickNav from './FuelQuickNav'

const DailyTransactionReport   = lazy(() => import('./reports/DailyTransactionReport'))
const MonthlyConsumptionReport = lazy(() => import('./reports/MonthlyConsumptionReport'))
const DeliveryReport           = lazy(() => import('./reports/DeliveryReport'))

const FUEL_CLR = MODULE_COLORS.fuel
const LINE_CLR = '#1565C0'   // issuance-by-day line
const TANK_CLR = '#00897B'   // tank level line

// ── SVG chart primitives ──────────────────────────────────────────────────────

const CHART_W = 960
const CHART_H = 300
const PAD = { top: 20, right: 20, bottom: 72, left: 60 }

function niceMax(v) {
  if (v <= 0) return 10
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / mag
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return nice * mag
}

function smoothPath(pts) {
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

function ChartTooltip({ hover }) {
  if (!hover) return null
  const flipLeft = hover.xPct > 85
  const flipDown = hover.yPct < 15
  return (
    <div style={{
      position: 'absolute',
      left: `${hover.xPct}%`, top: `${hover.yPct}%`,
      transform: `translate(${flipLeft ? '-95%' : '-50%'}, ${flipDown ? '15%' : '-120%'})`,
      background: 'rgba(30,30,30,.92)', backdropFilter: 'blur(8px)',
      borderRadius: '10px', padding: '10px 14px', boxShadow: '0 4px 20px rgba(0,0,0,.25)',
      pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5,
    }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#fff', marginBottom: '3px' }}>{hover.label}</div>
      <div style={{ fontSize: '13px', color: hover.color, display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: hover.color, display: 'inline-block', boxShadow: `0 0 6px ${hover.color}88` }} />
        {hover.sub}
      </div>
    </div>
  )
}

let gradId = 0

function LineChart({ points, color, unit = 'L', onPointClick }) {
  const [hover, setHover] = useState(null)
  const [gid] = useState(() => `lg${++gradId}`)
  if (!points.length) return <EmptyChart />
  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom
  const maxV = niceMax(Math.max(...points.map(p => p.value)))
  const x = i => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = v => PAD.top + innerH - (v / maxV) * innerH

  const pts = points.map((p, i) => [x(i), y(p.value)])
  const curve = smoothPath(pts)
  const baseline = PAD.top + innerH
  const area = `${curve} L${pts[pts.length - 1][0].toFixed(1)},${baseline} L${pts[0][0].toFixed(1)},${baseline} Z`

  const step = Math.max(1, Math.ceil(points.length / 14))
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxV)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridVals.map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(v)} y2={y(v)} stroke={THEME.outlineVar} strokeWidth="1" strokeDasharray={v === 0 ? 'none' : '4 3'} />
            <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" fontSize="11" fill={THEME.textLow} fontFamily="inherit">
              {v >= 1000 ? `${(v / 1000).toLocaleString()}k` : v.toLocaleString()}
            </text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={curve} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && (
          <line x1={x(hover.i)} x2={x(hover.i)} y1={PAD.top} y2={baseline} stroke={color} strokeWidth="1" strokeDasharray="4 3" opacity="0.4" />
        )}
        {points.map((p, i) => (
          <circle
            key={i} cx={x(i)} cy={y(p.value)} r={hover?.i === i ? 6 : 3.5}
            fill={hover?.i === i ? '#fff' : color}
            stroke={color} strokeWidth={hover?.i === i ? 2.5 : 1.5}
            style={{ cursor: onPointClick ? 'pointer' : 'default', transition: 'r .15s, fill .15s' }}
            onMouseEnter={() => setHover({ i, xPct: (x(i) / CHART_W) * 100, yPct: (y(p.value) / CHART_H) * 100, label: p.label, sub: `${p.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`, color })}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPointClick?.(p, i)}
          />
        ))}
        {points.map((p, i) => (i % step === 0 || i === points.length - 1) && (
          <text
            key={`l${i}`} x={x(i)} y={CHART_H - 6} fontSize="10" fill={THEME.textLow}
            textAnchor="end" transform={`rotate(-35 ${x(i)} ${CHART_H - 6})`}
            fontFamily="inherit"
          >
            {p.label.length > 12 ? p.label.slice(0, 11) + '…' : p.label}
          </text>
        ))}
      </svg>
      <ChartTooltip hover={hover} />
    </div>
  )
}

function BarChart({ bars, color, unit = 'L', onBarClick }) {
  const [hover, setHover] = useState(null)
  const [gid] = useState(() => `bg${++gradId}`)
  if (!bars.length) return <EmptyChart />
  const innerW = CHART_W - PAD.left - PAD.right
  const innerH = CHART_H - PAD.top - PAD.bottom
  const maxV = niceMax(Math.max(...bars.map(b => b.value)))
  const slot = innerW / bars.length
  const barW = Math.min(52, slot * 0.6)
  const y = v => PAD.top + innerH - (v / maxV) * innerH
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxV)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="1" />
            <stop offset="100%" stopColor={color} stopOpacity="0.6" />
          </linearGradient>
        </defs>
        {gridVals.map(v => (
          <g key={v}>
            <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(v)} y2={y(v)} stroke={THEME.outlineVar} strokeWidth="1" strokeDasharray={v === 0 ? 'none' : '4 3'} />
            <text x={PAD.left - 10} y={y(v) + 4} textAnchor="end" fontSize="11" fill={THEME.textLow} fontFamily="inherit">
              {v >= 1000 ? `${(v / 1000).toLocaleString()}k` : v.toLocaleString()}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = PAD.left + slot * i + slot / 2
          const h = (b.value / maxV) * innerH
          const isHover = hover?.i === i
          return (
            <g key={b.label}>
              <rect
                x={cx - barW / 2} y={y(b.value)} width={barW} height={Math.max(2, h)} rx="5"
                fill={`url(#${gid})`} opacity={isHover ? 0.85 : 1}
                style={{ cursor: onBarClick ? 'pointer' : 'default', transition: 'opacity .15s' }}
                onMouseEnter={() => setHover({ i, xPct: (cx / CHART_W) * 100, yPct: (y(b.value) / CHART_H) * 100, label: b.label, sub: `${b.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`, color })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onBarClick?.(b, i)}
              />
              {h > 20 && (
                <text x={cx} y={y(b.value) - 6} textAnchor="middle" fontSize="10" fontWeight="600" fill={color} fontFamily="inherit">
                  {b.value >= 1000 ? `${(b.value / 1000).toFixed(1)}k` : Math.round(b.value).toLocaleString()}
                </text>
              )}
              <text
                x={cx} y={CHART_H - 6} fontSize="10" fill={THEME.textLow}
                textAnchor="end" transform={`rotate(-30 ${cx} ${CHART_H - 6})`}
                fontFamily="inherit"
              >
                {b.label.length > 12 ? b.label.slice(0, 11) + '…' : b.label}
              </text>
            </g>
          )
        })}
      </svg>
      <ChartTooltip hover={hover} />
    </div>
  )
}

function EmptyChart() {
  return (
    <div style={{ height: '200px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: THEME.textLow, fontSize: '13px', gap: '8px' }}>
      <Icon name="show_chart" size={36} style={{ color: THEME.outline, opacity: 0.5 }} />
      No data to plot yet.
    </div>
  )
}

function ChartCard({ title, legend, legendColor, children, right }) {
  return (
    <Card style={{ padding: '20px 22px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {right}
          {legend && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: legendColor, display: 'inline-block', boxShadow: `0 0 4px ${legendColor}44` }} />
              {legend}
            </div>
          )}
        </div>
      </div>
      {children}
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FuelReports({ setPage }) {
  const navigate = useNavigate()
  const { currentSite } = useSite()
  const { tanks, transactions, dipReadings, tankBalance, loading } = useFuel()

  const activeTanks = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])
  const [tankSel, setTankSel] = useState('')

  const issuances = useMemo(() => transactions.filter(t => t.transaction_type === 'issuance'), [transactions])

  // ── Issuance by day ──
  const byDay = useMemo(() => {
    const m = new Map()
    for (const t of issuances) m.set(t.transaction_date, (m.get(t.transaction_date) || 0) + Number(t.litres))
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([d, v]) => ({ label: d.slice(5), value: v, date: d }))
  }, [issuances])

  // ── Top 10 consumers ──
  const top10 = useMemo(() => {
    const m = new Map()
    for (const t of issuances) {
      const label = t.fleet_asset
        ? (t.fleet_asset.registration || t.fleet_asset.fleet_number || t.fleet_asset.asset_number)
        : t.asset_description || 'Other'
      m.set(label, (m.get(label) || 0) + Number(t.litres))
    }
    return [...m.entries()].sort(([, a], [, b]) => b - a).slice(0, 10)
      .map(([label, value]) => ({ label, value }))
  }, [issuances])

  // ── Tank level over time (dip readings) ──
  const dipTankId = tankSel || activeTanks[0]?.id || ''
  const tankLevelPoints = useMemo(() => {
    return dipReadings
      .filter(d => d.tank_id === dipTankId)
      .sort((a, b) => a.reading_date.localeCompare(b.reading_date))
      .map(d => ({ label: d.reading_date.slice(5), value: Number(d.level_litres) }))
  }, [dipReadings, dipTankId])

  // ── Predicted empty / next order date ──
  const prediction = useMemo(() => {
    if (!issuances.length) return null
    const dates = issuances.map(t => t.transaction_date).sort()
    const lastDate = dates[dates.length - 1]
    const cutoff = new Date(new Date(lastDate + 'T00:00:00').getTime() - 30 * 86400000).toISOString().slice(0, 10)
    const recent = issuances.filter(t => t.transaction_date >= cutoff)
    if (!recent.length) return null
    const perDay = recent.reduce((s, t) => s + Number(t.litres), 0) / 30
    if (perDay <= 0) return null
    const stock = activeTanks.reduce((s, t) => s + tankBalance(t.id), 0)
    const days = stock / perDay
    const emptyDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
    return { perDay, stock, days, emptyDate }
  }, [issuances, activeTanks, tankBalance])

  // ── Anomalous issuances (≥ 2.5× asset average) ──
  const anomalies = useMemo(() => {
    const byAsset = new Map()
    for (const t of issuances) {
      const key = t.fleet_asset_id
      if (!key) continue
      if (!byAsset.has(key)) byAsset.set(key, [])
      byAsset.get(key).push(t)
    }
    const out = []
    for (const list of byAsset.values()) {
      if (list.length < 3) continue
      const avg = list.reduce((s, t) => s + Number(t.litres), 0) / list.length
      for (const t of list) {
        if (Number(t.litres) >= 2.5 * avg) {
          out.push({ tx: t, avg, excess: Number(t.litres) - avg })
        }
      }
    }
    return out.sort((a, b) => b.excess - a.excess).slice(0, 15)
  }, [issuances])

  // ── Monthly usage table (kept from previous version) ──
  const now = new Date()
  const receipts = useMemo(() => transactions.filter(t => t.transaction_type === 'delivery'), [transactions])
  const defaultMonth = useMemo(() => {
    if (!transactions.length) return { y: now.getFullYear(), m: now.getMonth() }
    const latest = transactions.reduce((best, t) => t.transaction_date > best ? t.transaction_date : best, transactions[0].transaction_date)
    const [y, m] = latest.split('-').map(Number)
    return { y, m: m - 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions])
  const [repYear, setRepYear] = useState(null)
  const [repMonth, setRepMonth] = useState(null)
  const selYear = repYear ?? defaultMonth.y
  const selMonth = repMonth ?? defaultMonth.m

  const monthlyRows = useMemo(() => {
    const month = `${selYear}-${String(selMonth + 1).padStart(2, '0')}`
    return tanks.map(tank => {
      const rec = receipts.filter(r => r.tank_id === tank.id && r.transaction_date?.startsWith(month))
      const iss = issuances.filter(i => i.tank_id === tank.id && i.transaction_date?.startsWith(month))
      const received = rec.reduce((s, r) => s + Number(r.litres), 0)
      const issued = iss.reduce((s, i) => s + Number(i.litres), 0)
      return { tank, received, issued, net: received - issued, currentBalance: tankBalance(tank.id) }
    })
  }, [tanks, receipts, issuances, selYear, selMonth, tankBalance])

  const [reportTab, setReportTab] = useState('overview')
  const REPORT_TABS = [
    { id: 'overview',  label: 'Overview',             icon: 'dashboard' },
    { id: 'daily',     label: 'Daily Transactions',   icon: 'today' },
    { id: 'monthly',   label: 'Monthly Consumption',  icon: 'calendar_month' },
    { id: 'delivery',  label: 'Delivery Report',      icon: 'local_shipping' },
  ]

  if (loading) return null

  const assetLabel = tx => tx.fleet_asset
    ? (tx.fleet_asset.registration || tx.fleet_asset.fleet_number || tx.fleet_asset.asset_number)
    : tx.asset_description || '—'

  const selStyle = {
    padding: '7px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
    fontSize: '13px', color: THEME.text, background: THEME.surface,
    fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <FuelQuickNav setPage={setPage} current="fuel_reports" />

      <PageHeader
        title="Fuel Reports"
        site={currentSite}
        actions={
          <button
            onClick={() => window.print()}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '9px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
              background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Icon name="print" size={15} style={{ color: '#fff' }} /> Print
          </button>
        }
      />

      {/* ── Report tabs ── */}
      <div style={{ display: 'flex', gap: '0', borderBottom: `2px solid ${THEME.outlineVar}`, marginBottom: '20px' }}>
        {REPORT_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setReportTab(t.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '10px 20px', fontSize: '13px', fontWeight: reportTab === t.id ? 700 : 500,
              color: reportTab === t.id ? FUEL_CLR : THEME.textMed,
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              borderBottom: reportTab === t.id ? `2px solid ${FUEL_CLR}` : '2px solid transparent',
              marginBottom: '-2px', transition: 'color .15s',
            }}
          >
            <Icon name={t.icon} size={16} style={{ color: 'inherit' }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Sub-report tabs ── */}
      {reportTab === 'daily' && (
        <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>}>
          <DailyTransactionReport />
        </Suspense>
      )}
      {reportTab === 'monthly' && (
        <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>}>
          <MonthlyConsumptionReport />
        </Suspense>
      )}
      {reportTab === 'delivery' && (
        <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>}>
          <DeliveryReport />
        </Suspense>
      )}

      {reportTab === 'overview' && <>
      {/* ── Predicted next order date banner ── */}
      {prediction && (
        <Card style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <div style={{
            width: 40, height: 40, borderRadius: '10px', flexShrink: 0,
            background: FUEL_CLR + '16', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="insights" size={20} style={{ color: FUEL_CLR }} />
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '3px' }}>
              Predicted next order date
            </div>
            <div style={{ fontSize: '13px', color: THEME.textMed }}>
              Based on recent consumption (~{Math.round(prediction.perDay).toLocaleString()} L/day),
              current stock of {Math.round(prediction.stock).toLocaleString()} L will run out
              around <strong style={{ color: THEME.text }}>{fmtDate(prediction.emptyDate)}</strong>
              {prediction.days < 21 ? ' — plan a purchase order.' : '.'}
            </div>
          </div>
        </Card>
      )}

      {/* ── Fuel issuance by day ── */}
      <ChartCard title="Fuel Issuance by Day" legend="Litres Issued" legendColor={LINE_CLR}>
        <LineChart points={byDay} color={LINE_CLR} />
      </ChartCard>

      {/* ── Top 10 consumers ── */}
      <ChartCard title="Fuel Issuance by Vehicle (Top 10)" legend="Litres Issued" legendColor={FUEL_CLR}>
        <BarChart bars={top10} color={FUEL_CLR} onBarClick={() => setPage?.('fuel_vehicle_consumption')} />
      </ChartCard>

      {/* ── Tank level over time ── */}
      <ChartCard
        title="Tank Level Over Time"
        legend="Litres in Tank"
        legendColor={TANK_CLR}
        right={activeTanks.length > 1 && (
          <select value={dipTankId} onChange={e => setTankSel(e.target.value)} style={selStyle}>
            {activeTanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      >
        <LineChart points={tankLevelPoints} color={TANK_CLR} />
      </ChartCard>

      {/* ── Anomalous issuances ── */}
      <Card style={{ padding: 0, marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="warning" size={18} style={{ color: THEME.error }} />
            <span style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Anomalous Issuances</span>
            {anomalies.length > 0 && (
              <span style={{
                minWidth: 20, height: 20, borderRadius: '10px', padding: '0 6px',
                background: THEME.error, color: '#fff', fontSize: '11px', fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {anomalies.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: '12px', color: THEME.textLow }}>
            Statistically unusual fuel draws (≥ 2.5× asset average)
          </span>
        </div>
        {anomalies.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow, fontSize: '13px' }}>
            No anomalous issuances detected.
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Asset</Th>
              <Th>Driver</Th>
              <Th align="right">Issued (L)</Th>
              <Th align="right">Asset Avg (L)</Th>
              <Th align="right">Excess (L)</Th>
              <Th>Purpose</Th>
              <Th>Flag</Th>
            </THead>
            <tbody>
              {anomalies.map(({ tx, avg, excess }, idx) => {
                const parsed = parseTxnNotes(tx.notes)
                return (
                  <TRow
                    key={tx.id} last={idx === anomalies.length - 1}
                    style={{ background: THEME.error + '06', cursor: setPage ? 'pointer' : 'default' }}
                    onClick={() => setPage?.('fuel_vehicle_consumption')}
                  >
                    <Td style={{ whiteSpace: 'nowrap', color: THEME.textMed }}>{tx.transaction_date}</Td>
                    <Td style={{ fontWeight: 600, color: THEME.text }}>{assetLabel(tx)}</Td>
                    <Td style={{ color: THEME.textMed }}>{parsed.driver || '—'}</Td>
                    <Td align="right" style={{ fontWeight: 700, color: THEME.error }}>{Number(tx.litres).toLocaleString()}</Td>
                    <Td align="right" style={{ color: THEME.textLow }}>{Math.round(avg).toLocaleString()}</Td>
                    <Td align="right" style={{ fontWeight: 600, color: THEME.error }}>+{Math.round(excess).toLocaleString()}</Td>
                    <Td style={{ color: THEME.textMed, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {parsed.purpose || parsed.clean || '—'}
                    </Td>
                    <Td>
                      <span style={{
                        padding: '3px 9px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
                        background: THEME.statusErrorBg, color: THEME.statusErrorText, letterSpacing: '.04em',
                      }}>
                        ANOMALY
                      </span>
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* ── Monthly usage summary ── */}
      <Card style={{ padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', flexWrap: 'wrap', gap: '10px' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Monthly Usage by Tank</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select value={selMonth} onChange={e => setRepMonth(Number(e.target.value))} style={selStyle}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={selYear} onChange={e => setRepYear(Number(e.target.value))} style={{ ...selStyle, width: '90px' }}>
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
        <TableWrap>
          <THead>
            <Th>Tank</Th>
            <Th align="right">Received (L)</Th>
            <Th align="right">Issued (L)</Th>
            <Th align="right">Net (L)</Th>
            <Th align="right">Current Balance (L)</Th>
          </THead>
          <tbody>
            {monthlyRows.map((row, idx) => (
              <TRow key={row.tank.id} last={idx === monthlyRows.length - 1} onClick={() => navigate(`/fuel/tanks/${row.tank.id}`)}>
                <Td><span style={{ fontWeight: 500 }}>{row.tank.name}</span></Td>
                <Td align="right" style={{ color: row.received > 0 ? THEME.success : THEME.textMed, fontWeight: row.received > 0 ? 600 : 400 }}>
                  {row.received > 0 ? `+${row.received.toFixed(1)}` : '—'}
                </Td>
                <Td align="right" style={{ color: row.issued > 0 ? THEME.warning : THEME.textMed, fontWeight: row.issued > 0 ? 600 : 400 }}>
                  {row.issued > 0 ? row.issued.toFixed(1) : '—'}
                </Td>
                <Td align="right" style={{ fontWeight: 600, color: row.net >= 0 ? THEME.text : THEME.error }}>
                  {row.net >= 0 ? '+' : ''}{row.net.toFixed(1)}
                </Td>
                <Td align="right" style={{ fontWeight: 600 }}>{row.currentBalance.toFixed(1)}</Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      </Card>
      </>}
    </div>
  )
}
