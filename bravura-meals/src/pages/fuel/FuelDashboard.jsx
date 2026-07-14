import { useMemo, useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../hooks/usePermissions'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, fmtDate } from '../../components/ui'
import FuelQuickNav from './FuelQuickNav'

const FUEL_CLR = MODULE_COLORS.fuel
const CRIT_PCT = 15
const WARN_PCT = 30
const LOW_PCT  = 20 // KPI "low tank" threshold

// Accent hexes for KPI chips / charts (literal hexes so the accent+'18' tint pattern works)
const ACCENT = {
  green:  '#2E7D32',
  blue:   '#1E88E5',
  violet: '#7C4DFF',
  amber:  '#F59E0B',
  teal:   '#00897B',
  pink:   '#EC4899',
}

const CARD_SHADOW = '0 1px 3px rgba(0,0,0,0.06)'
const RADIUS = '16px'

const fmtL = n => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} L`
const fmtK = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString()

function tankPct(tank, balance) {
  const cap = Number(tank.capacity_litres) || 0
  if (!cap) return null
  return Math.min(100, Math.max(0, (balance / cap) * 100))
}

function levelColor(pct) {
  if (pct === null) return FUEL_CLR
  if (pct < CRIT_PCT) return THEME.error
  if (pct < WARN_PCT) return THEME.warning
  return ACCENT.teal
}

/* ── KPI card — colored icon chip, big number, thin progress bar ──────── */
function KpiCard({ label, value, sub, icon, accent, pct, onClick }) {
  const clr = accent || FUEL_CLR
  const barPct = pct === null || pct === undefined ? null : Math.min(100, Math.max(0, pct))
  return (
    <div
      onClick={onClick}
      style={{
        background: THEME.surface, borderRadius: RADIUS, padding: '18px',
        boxShadow: CARD_SHADOW, display: 'flex', flexDirection: 'column',
        gap: '12px', minWidth: 0, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{
          width: '42px', height: '42px', borderRadius: '50%', background: clr + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name={icon} size={20} style={{ color: clr }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{value}</div>
          <div style={{ fontSize: '11px', color: THEME.textLow, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        </div>
      </div>
      <div>
        <div style={{ height: '5px', borderRadius: '3px', background: THEME.surfaceVar, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${barPct ?? 0}%`, background: clr, borderRadius: '3px', transition: 'width .4s' }} />
        </div>
        {sub && <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
    </div>
  )
}

/* ── Section card wrapper ─────────────────────────────────────────────── */
function Section({ title, sub, action, children }) {
  return (
    <div style={{ background: THEME.surface, borderRadius: RADIUS, padding: '20px 22px', boxShadow: CARD_SHADOW, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '16px' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{title}</div>
          {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{sub}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/* ── Compact tank level row ───────────────────────────────────────────── */
function TankRow({ tank, balance }) {
  const cap = Number(tank.capacity_litres) || 0
  const pct = tankPct(tank, balance)
  const clr = levelColor(pct)
  const tracked = tank.level_tracking_method === 'issuance'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 0' }}>
      <div style={{ width: '220px', minWidth: '140px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tank.name}</span>
          {tracked && (
            <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: FUEL_CLR + '18', color: FUEL_CLR, letterSpacing: '.03em', flexShrink: 0 }}>
              ISSUANCE
            </span>
          )}
        </div>
        <div style={{ fontSize: '11px', color: THEME.textLow }}>{tank.fuel_types?.name || 'Diesel'}</div>
      </div>
      <div style={{ flex: 1, minWidth: '80px' }}>
        <div style={{ height: '8px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct ?? 0}%`, background: clr, borderRadius: '4px', transition: 'width .4s' }} />
        </div>
      </div>
      <div style={{ width: '150px', flexShrink: 0, textAlign: 'right' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: clr }}>{pct !== null ? `${pct.toFixed(0)}%` : '—'}</span>
        <span style={{ fontSize: '11px', color: THEME.textLow, marginLeft: '8px' }}>
          {Math.round(balance).toLocaleString()}{cap ? ` / ${cap.toLocaleString()}` : ''} L
        </span>
      </div>
    </div>
  )
}

/* ── Donut fill gauge (SVG ring) ──────────────────────────────────────── */
function DonutGauge({ pct }) {
  const p = pct === null ? 0 : Math.min(100, Math.max(0, pct))
  const clr = pct === null ? FUEL_CLR : pct < CRIT_PCT ? THEME.error : pct < WARN_PCT ? THEME.warning : ACCENT.teal
  const R = 52, C = 2 * Math.PI * R
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke={THEME.surfaceVar} strokeWidth="12" />
        <circle
          cx="70" cy="70" r={R} fill="none" stroke={clr} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${(p / 100) * C} ${C}`} transform="rotate(-90 70 70)"
          style={{ transition: 'stroke-dasharray .5s' }}
        />
        <text x="70" y="66" textAnchor="middle" fontSize="24" fontWeight="700" fill={THEME.text} fontFamily="inherit">
          {pct !== null ? `${p.toFixed(0)}%` : '—'}
        </text>
        <text x="70" y="84" textAnchor="middle" fontSize="10" fill={THEME.textLow} fontFamily="inherit">
          fill level
        </text>
      </svg>
      <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: THEME.textLow, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[[ACCENT.teal, `≥ ${WARN_PCT}%`], [THEME.warning, `${CRIT_PCT}–${WARN_PCT}%`], [THEME.error, `< ${CRIT_PCT}%`]].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ── Smooth area chart (SVG, bezier through midpoint control points) ──── */
function AreaChart({ data, color, height = 170 }) {
  const W = 520, padL = 30, padR = 12, padT = 20, padB = 22
  const H = height
  const areaW = W - padL - padR
  const areaH = H - padT - padB
  const max = Math.max(...data.map(d => d.v), 1)
  const n = data.length
  const x = i => padL + (n > 1 ? (i / (n - 1)) * areaW : areaW / 2)
  const y = v => padT + areaH - (v / max) * areaH

  // Smooth cubic path: control points at horizontal midpoints
  let line = `M ${x(0)} ${y(data[0].v)}`
  for (let i = 1; i < n; i++) {
    const x0 = x(i - 1), x1 = x(i)
    const y0 = y(data[i - 1].v), y1 = y(data[i].v)
    const mx = (x0 + x1) / 2
    line += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`
  }
  const area = `${line} L ${x(n - 1)} ${padT + areaH} L ${x(0)} ${padT + areaH} Z`

  const maxIdx = data.reduce((best, d, i) => (d.v > data[best].v ? i : best), 0)
  const hasData = data.some(d => d.v > 0)
  const gradId = `area-grad-${color.replace('#', '')}`

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '360px', display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(f * max)} y2={y(f * max)} stroke={THEME.outlineVar} strokeWidth="0.5" strokeDasharray="3 3" />
            <text x={padL - 5} y={y(f * max) + 3} textAnchor="end" fontSize="8.5" fill={THEME.textLow} fontFamily="inherit">{fmtK(f * max)}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={padT + areaH} y2={padT + areaH} stroke={THEME.outlineVar} strokeWidth="1" />
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hasData && (
          <g>
            <circle cx={x(maxIdx)} cy={y(data[maxIdx].v)} r="4" fill={color} stroke={THEME.surface} strokeWidth="2" />
            <text x={x(maxIdx)} y={y(data[maxIdx].v) - 8} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">
              {fmtK(data[maxIdx].v)}
            </text>
          </g>
        )}
        {data.map((d, i) => (
          (n <= 8 || i % 2 === 0) && (
            <text key={i} x={x(i)} y={padT + areaH + 14} textAnchor="middle" fontSize="9" fill={THEME.textLow} fontFamily="inherit">{d.label}</text>
          )
        ))}
      </svg>
    </div>
  )
}

/* ── Paired bar chart: deliveries vs issuances per week ───────────────── */
function PairedBarChart({ data, colorA, colorB, labelA, labelB }) {
  const W = 520, H = 180, padL = 8, padR = 8, padT = 20, padB = 22
  const areaW = W - padL - padR
  const areaH = H - padT - padB
  const max = Math.max(...data.flatMap(d => [d.a, d.b]), 1)
  const slot = areaW / data.length
  const barW = Math.min(26, slot * 0.28)
  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', fontSize: '11px', color: THEME.textMed }}>
        {[[colorA, labelA], [colorB, labelB]].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, display: 'inline-block' }} />
            {l}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '360px', display: 'block' }}>
          {[0.25, 0.5, 0.75, 1].map(f => (
            <line key={f} x1={padL} x2={W - padR} y1={padT + areaH - f * areaH} y2={padT + areaH - f * areaH}
              stroke={THEME.outlineVar} strokeWidth="0.5" strokeDasharray="3 3" />
          ))}
          <line x1={padL} x2={W - padR} y1={padT + areaH} y2={padT + areaH} stroke={THEME.outlineVar} strokeWidth="1" />
          {data.map((d, i) => {
            const cx = padL + i * slot + slot / 2
            const hA = d.a > 0 ? Math.max(2, (d.a / max) * areaH) : 0
            const hB = d.b > 0 ? Math.max(2, (d.b / max) * areaH) : 0
            return (
              <g key={i}>
                {hA > 0 && <rect x={cx - barW - 2} y={padT + areaH - hA} width={barW} height={hA} rx={3} fill={colorA} opacity="0.85" />}
                {hB > 0 && <rect x={cx + 2} y={padT + areaH - hB} width={barW} height={hB} rx={3} fill={colorB} opacity="0.85" />}
                {d.a > 0 && <text x={cx - barW / 2 - 2} y={padT + areaH - hA - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">{fmtK(d.a)}</text>}
                {d.b > 0 && <text x={cx + barW / 2 + 2} y={padT + areaH - hB - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">{fmtK(d.b)}</text>}
                <text x={cx} y={padT + areaH + 14} textAnchor="middle" fontSize="9" fill={THEME.textLow} fontFamily="inherit">{d.label}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/* ── Transaction type meta (icon chips for the activity list) ─────────── */
const TX_META = {
  delivery:     { label: 'Delivery',     clr: ACCENT.green, icon: 'arrow_downward', sign: '+' },
  issuance:     { label: 'Issuance',     clr: ACCENT.amber, icon: 'arrow_upward',   sign: '-' },
  transfer_out: { label: 'Transfer Out', clr: ACCENT.amber, icon: 'arrow_upward',   sign: '-' },
  transfer_in:  { label: 'Transfer In',  clr: ACCENT.green, icon: 'arrow_downward', sign: '+' },
  adjustment:   { label: 'Adjustment',   clr: ACCENT.blue,  icon: 'sync_alt',       sign: '' },
}

export default function FuelDashboard({ setPage }) {
  const { tanks, transactions, loading, tankBalance } = useFuel()
  const { currentSite } = useSite()
  const { can } = usePermissions()
  const [alertDismissed, setAlertDismissed] = useState(false)

  const today = new Date().toISOString().slice(0, 10)
  const thisMonth = today.slice(0, 7)

  const activeTanks = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])

  const tankStats = useMemo(() => {
    let onHand = 0, capacity = 0, lowCount = 0
    const critical = []
    for (const t of activeTanks) {
      const bal = tankBalance(t.id)
      onHand += Math.max(0, bal)
      capacity += Number(t.capacity_litres) || 0
      const pct = tankPct(t, bal)
      if (pct !== null && pct < LOW_PCT) lowCount++
      if (pct !== null && pct < CRIT_PCT) critical.push(t)
    }
    return { onHand, capacity, lowCount, critical, fillPct: capacity ? (onHand / capacity) * 100 : null }
  }, [activeTanks, tankBalance])

  const issuances = useMemo(() => transactions.filter(t => t.transaction_type === 'issuance'), [transactions])

  const issuedToday = useMemo(() =>
    issuances.filter(t => t.transaction_date === today).reduce((s, t) => s + Number(t.litres), 0),
  [issuances, today])

  const monthIssuances = useMemo(() => issuances.filter(t => t.transaction_date?.startsWith(thisMonth)), [issuances, thisMonth])
  const issuedThisMonth = useMemo(() => monthIssuances.reduce((s, t) => s + Number(t.litres), 0), [monthIssuances])

  const receivedThisMonth = useMemo(() =>
    transactions
      .filter(t => t.transaction_type === 'delivery' && t.transaction_date?.startsWith(thisMonth))
      .reduce((s, t) => s + Number(t.litres), 0),
  [transactions, thisMonth])

  const pendingAcks = useMemo(() =>
    issuances.filter(t => t.acknowledgement_status === 'pending').length,
  [issuances])

  // Daily consumption — last 14 days
  const dailyData = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - (13 - i) * 86400000)
      const iso = d.toISOString().slice(0, 10)
      return {
        label: `${d.getDate()}/${d.getMonth() + 1}`,
        v: issuances.filter(t => t.transaction_date === iso).reduce((s, t) => s + Number(t.litres), 0),
      }
    }),
  [issuances])

  // Deliveries vs issuances — last 4 weeks
  const weeklyData = useMemo(() =>
    Array.from({ length: 4 }, (_, i) => {
      const end = new Date(Date.now() - (3 - i) * 7 * 86400000)
      const start = new Date(end - 6 * 86400000)
      const s0 = start.toISOString().slice(0, 10)
      const e0 = end.toISOString().slice(0, 10)
      const inRange = t => t.transaction_date >= s0 && t.transaction_date <= e0
      return {
        label: `${start.getDate()}/${start.getMonth() + 1} – ${end.getDate()}/${end.getMonth() + 1}`,
        a: transactions.filter(t => t.transaction_type === 'delivery' && inRange(t)).reduce((s, t) => s + Number(t.litres), 0),
        b: transactions.filter(t => t.transaction_type === 'issuance' && inRange(t)).reduce((s, t) => s + Number(t.litres), 0),
      }
    }),
  [transactions])

  // Top consumers this month
  const topConsumers = useMemo(() => {
    const map = new Map()
    for (const t of monthIssuances) {
      if (!t.fleet_asset_id) continue
      const name = t.fleet_asset?.fleet_number || t.fleet_asset?.asset_number || t.fleet_asset?.description || 'Unknown'
      const cur = map.get(t.fleet_asset_id) || { name, litres: 0 }
      cur.litres += Number(t.litres)
      map.set(t.fleet_asset_id, cur)
    }
    return [...map.values()].sort((a, b) => b.litres - a.litres).slice(0, 8)
  }, [monthIssuances])

  const recent = useMemo(() => transactions.slice(0, 8), [transactions])

  // Previous calendar month issuance total (for the KPI progress %)
  const issuedPrevMonth = useMemo(() => {
    const d = new Date(`${thisMonth}-01T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - 1)
    const prev = d.toISOString().slice(0, 7)
    return issuances.filter(t => t.transaction_date?.startsWith(prev)).reduce((s, t) => s + Number(t.litres), 0)
  }, [issuances, thisMonth])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
      <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )

  const maxConsumer = topConsumers.length ? topConsumers[0].litres : 1

  return (
    <div style={{ maxWidth: '1100px' }}>
      <FuelQuickNav setPage={setPage} current="fuel_dashboard" />

      {/* Critical low-stock banner */}
      {tankStats.critical.length > 0 && !alertDismissed && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px',
          background: THEME.statusErrorBg, borderRadius: RADIUS, boxShadow: CARD_SHADOW,
          marginBottom: '16px',
        }}>
          <Icon name="warning" size={20} style={{ color: THEME.error, flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: '13px', color: THEME.statusErrorText }}>
            <b>{tankStats.critical.length} tank{tankStats.critical.length > 1 ? 's' : ''} critically low</b>
            {' '}(&lt; {CRIT_PCT}%): {tankStats.critical.map(t => t.name).join(', ')}. Arrange a delivery as soon as possible.
          </div>
          <button onClick={() => setAlertDismissed(true)} title="Dismiss"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.statusErrorText, opacity: .6, padding: '4px', flexShrink: 0 }}>
            <Icon name="close" size={16} style={{ color: 'inherit' }} />
          </button>
        </div>
      )}

      <PageHeader
        title="Fuel Dashboard"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: THEME.textLow }}>Last 30 days</span>
            {can('fuel.create') && (
              <button onClick={() => setPage('fuel_receipts')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR + '18', color: FUEL_CLR, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="local_gas_station" size={16} style={{ color: FUEL_CLR }} /> Record Delivery
              </button>
            )}
            {can('fuel.create') && (
              <button onClick={() => setPage('fuel_issuance')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="output" size={16} style={{ color: '#fff' }} /> Issue Fuel
              </button>
            )}
          </div>
        }
      />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard
          label="Fuel On Hand"
          value={fmtL(tankStats.onHand)}
          sub={tankStats.fillPct !== null ? `${tankStats.fillPct.toFixed(0)}% of ${tankStats.capacity.toLocaleString()} L capacity` : 'no capacity set'}
          icon="propane_tank"
          accent={ACCENT.green}
          pct={tankStats.fillPct}
          onClick={() => setPage('fuel_tanks')}
        />
        <KpiCard
          label="Issued Today"
          value={fmtL(issuedToday)}
          sub={fmtDate(today)}
          icon="output"
          accent={ACCENT.blue}
          pct={issuedThisMonth > 0 ? (issuedToday / issuedThisMonth) * 100 : 0}
          onClick={() => setPage('fuel_issues')}
        />
        <KpiCard
          label="Issued This Month"
          value={fmtL(issuedThisMonth)}
          sub={`${monthIssuances.length.toLocaleString()} issuance${monthIssuances.length === 1 ? '' : 's'}`}
          icon="trending_down"
          accent={ACCENT.violet}
          pct={issuedPrevMonth > 0 ? (issuedThisMonth / issuedPrevMonth) * 100 : (issuedThisMonth > 0 ? 100 : 0)}
          onClick={() => setPage('fuel_issues')}
        />
        <KpiCard
          label="Received This Month"
          value={fmtL(receivedThisMonth)}
          sub="deliveries"
          icon="local_shipping"
          accent={ACCENT.amber}
          pct={issuedThisMonth > 0 ? (receivedThisMonth / (receivedThisMonth + issuedThisMonth)) * 100 : (receivedThisMonth > 0 ? 100 : 0)}
          onClick={() => setPage('fuel_receipts')}
        />
        <KpiCard
          label="Active Tanks"
          value={activeTanks.length}
          sub={tankStats.lowCount > 0 ? `${tankStats.lowCount} below ${LOW_PCT}%` : 'all above threshold'}
          icon="propane_tank"
          accent={ACCENT.teal}
          pct={activeTanks.length > 0 ? ((activeTanks.length - tankStats.lowCount) / activeTanks.length) * 100 : 0}
          onClick={() => setPage('fuel_tanks')}
        />
        <KpiCard
          label="Pending Acks"
          value={pendingAcks}
          sub="issuance acknowledgements"
          icon="pending_actions"
          accent={ACCENT.pink}
          pct={monthIssuances.length > 0 ? (pendingAcks / monthIssuances.length) * 100 : 0}
          onClick={() => setPage('fuel_issues')}
        />
      </div>

      {/* Tank levels + fill gauge */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(220px, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <Section
          title="Tank Levels"
          sub="Current balance per active tank"
          action={
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: THEME.textLow, flexWrap: 'wrap' }}>
              {[
                { c: ACCENT.teal, l: `≥ ${WARN_PCT}%` },
                { c: THEME.warning, l: `${CRIT_PCT}–${WARN_PCT}%` },
                { c: THEME.error, l: `< ${CRIT_PCT}%` },
              ].map(x => (
                <span key={x.l} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: x.c, display: 'inline-block' }} />{x.l}
                </span>
              ))}
            </div>
          }
        >
          {activeTanks.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.textLow, fontSize: '13px' }}>
              No tanks configured yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {activeTanks.map((t, i) => (
                <div key={t.id} style={{ borderBottom: i < activeTanks.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none' }}>
                  <TankRow tank={t} balance={tankBalance(t.id)} />
                </div>
              ))}
            </div>
          )}
        </Section>
        <Section title="Overall Fill" sub="On hand vs total capacity">
          <DonutGauge pct={tankStats.fillPct} />
        </Section>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        <Section title="Daily Consumption" sub="Issuance litres per day — last 14 days">
          <AreaChart data={dailyData} color={FUEL_CLR} />
        </Section>
        <Section title="Deliveries vs Issuances" sub="Weekly totals — last 4 weeks">
          <PairedBarChart data={weeklyData} colorA={ACCENT.green} colorB={FUEL_CLR} labelA="Delivered" labelB="Issued" />
        </Section>
      </div>

      {/* Bottom two-column row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        <Section title="Top Consumers" sub="Fleet assets by litres issued this month">
          {topConsumers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.textLow, fontSize: '13px' }}>
              No asset issuances this month.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {topConsumers.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '110px', flexShrink: 0, fontSize: '12px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>
                    {c.name}
                  </div>
                  <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${Math.max(2, (c.litres / maxConsumer) * 100)}%`,
                      background: `linear-gradient(90deg, ${FUEL_CLR}99, ${FUEL_CLR})`, borderRadius: '4px',
                    }} />
                  </div>
                  <div style={{ width: '72px', flexShrink: 0, textAlign: 'right', fontSize: '12px', fontWeight: 700, color: THEME.text }}>
                    {fmtL(c.litres)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recent Activity"
          sub="Latest fuel movements"
          action={
            <button onClick={() => setPage('fuel_ledger')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: 500, color: FUEL_CLR, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' }}>
              View all <Icon name="chevron_right" size={14} style={{ color: FUEL_CLR }} />
            </button>
          }
        >
          {recent.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.textLow, fontSize: '13px' }}>
              No transactions in the last 30 days.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recent.map((tx, idx) => {
                const meta = TX_META[tx.transaction_type] || TX_META.adjustment
                const tank = tanks.find(t => t.id === tx.tank_id)
                const assetName = tx.fleet_asset?.fleet_number || tx.fleet_asset?.asset_number || tx.fleet_asset?.description || tx.asset_description || null
                return (
                  <div key={tx.id} style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0',
                    borderBottom: idx < recent.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                  }}>
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '50%', background: meta.clr + '18',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <Icon name={meta.icon} size={16} style={{ color: meta.clr }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {assetName || tank?.name || '—'}
                      </div>
                      <div style={{ fontSize: '10px', color: THEME.textLow }}>
                        {meta.label} · {fmtDate(tx.transaction_date)}{assetName && tank ? ` · ${tank.name}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: meta.clr, flexShrink: 0 }}>
                      {meta.sign}{fmtL(tx.litres)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}
