import { useMemo, useState, useEffect } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../hooks/usePermissions'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, fmtDate } from '../../components/ui'
import { supabase } from '../../supabaseClient'

const FUEL_CLR = MODULE_COLORS.fuel
const LOW_PCT  = 20
const WARN_PCT = 40

function StatCard({ label, value, sub, icon, color, onClick, trend }) {
  const trendColor = trend > 0 ? THEME.success : trend < 0 ? THEME.error : null
  return (
    <div
      onClick={onClick}
      style={{
        background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '12px', padding: '18px 20px', boxShadow: THEME.shadow1,
        display: 'flex', flexDirection: 'column', gap: '4px',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'box-shadow .15s, transform .15s',
      }}
      onMouseEnter={e => { if (onClick) { e.currentTarget.style.boxShadow = THEME.shadow2; e.currentTarget.style.transform = 'translateY(-1px)' } }}
      onMouseLeave={e => { if (onClick) { e.currentTarget.style.boxShadow = THEME.shadow1; e.currentTarget.style.transform = 'none' } }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {label}
        </div>
        <div style={{
          width: 30, height: 30, borderRadius: '8px', flexShrink: 0,
          background: (color || FUEL_CLR) + '14',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={icon} size={16} style={{ color: color || FUEL_CLR }} />
        </div>
      </div>
      <div style={{ fontSize: '26px', fontWeight: 700, color: color || FUEL_CLR, lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {sub && <div style={{ fontSize: '11px', color: THEME.textLow, flex: 1 }}>{sub}</div>}
        {trend != null && trend !== 0 && (
          <span style={{ fontSize: '10px', fontWeight: 600, color: trendColor, display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
            <Icon name={trend > 0 ? 'trending_up' : 'trending_down'} size={12} style={{ color: trendColor }} />
            {Math.abs(trend)}%
          </span>
        )}
      </div>
    </div>
  )
}

function Sparkline({ data, color, width = 120, height = 32 }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data, 1)
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - (v / max) * (height - 4) - 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${pts.join(' L')} L${width},${height} L0,${height} Z`} fill="url(#sparkGrad)" />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={parseFloat(pts[pts.length - 1])} cy={parseFloat(pts[pts.length - 1].split(',')[1])} r="2.5" fill={color} />
    </svg>
  )
}

function DonutChart({ segments, size = 110 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  if (!total) return null
  const r = (size - 14) / 2
  const cx = size / 2
  const circ = 2 * Math.PI * r
  let offset = 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={THEME.outlineVar} strokeWidth={10} />
        {segments.map((seg, i) => {
          const pct = seg.value / total
          const dash = pct * circ
          const el = (
            <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={seg.color} strokeWidth={10}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray .4s, stroke-dashoffset .4s' }}
            />
          )
          offset += dash
          return el
        })}
        <text x={cx} y={cx} textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="700" fill={THEME.text}
          style={{ transform: 'rotate(90deg)', transformOrigin: `${cx}px ${cx}px` }}>
          {total >= 1000 ? `${(total / 1000).toFixed(1)}k` : Math.round(total)}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
            <span style={{ color: THEME.textMed, fontWeight: 500 }}>{seg.label}</span>
            <span style={{ color: THEME.textLow, marginLeft: 'auto', fontWeight: 600 }}>{Math.round(seg.value).toLocaleString()} L</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function GaugeRing({ pct, color, size = 84 }) {
  const r = (size - 10) / 2
  const cx = size / 2
  const circ = 2 * Math.PI * r
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={THEME.outlineVar} strokeWidth={8} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray .5s' }}
      />
    </svg>
  )
}

function TankCard({ tank, balance, dip, daysRemaining }) {
  const pct = tank.capacity_litres
    ? Math.min(100, Math.max(0, (balance / Number(tank.capacity_litres)) * 100))
    : null
  const isLow  = pct !== null && pct <= LOW_PCT
  const isWarn = pct !== null && pct > LOW_PCT && pct < WARN_PCT
  const levelColor = pct === null ? FUEL_CLR : isLow ? THEME.error : isWarn ? THEME.warning : THEME.success

  const daysColor = daysRemaining === null ? null
    : daysRemaining < 3 ? THEME.error
    : daysRemaining < 7 ? THEME.warning
    : THEME.success

  const variance = dip ? balance - Number(dip.level_end_litres ?? dip.level_litres) : null

  return (
    <div style={{
      background: THEME.surface,
      border: `1.5px solid ${isLow ? THEME.error + '55' : THEME.outlineVar}`,
      borderRadius: '10px', padding: '18px', boxShadow: THEME.shadow1,
      position: 'relative', overflow: 'hidden',
    }}>
      {isLow && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: THEME.error }} />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tank.name}</div>
          {tank.designation && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{tank.designation}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0, marginLeft: '8px' }}>
          {daysRemaining !== null && (
            <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: daysColor + '18', color: daysColor }}>
              ~{daysRemaining}d
            </span>
          )}
          <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: FUEL_CLR + '18', color: FUEL_CLR }}>
            {tank.fuel_types?.name || 'Diesel'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '12px' }}>
        {pct !== null ? (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <GaugeRing pct={pct} color={levelColor} />
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: '17px', fontWeight: 700, color: levelColor, lineHeight: 1 }}>{pct.toFixed(0)}%</span>
              {isLow && <Icon name="warning" size={11} style={{ color: THEME.error, marginTop: '2px' }} />}
            </div>
          </div>
        ) : (
          <div style={{ width: '84px', height: '84px', borderRadius: '50%', flexShrink: 0, border: `2px dashed ${THEME.outline}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
            <Icon name="help_outline" size={20} style={{ color: THEME.textLow }} />
            <span style={{ fontSize: '9px', color: THEME.textLow, textAlign: 'center', lineHeight: 1.3 }}>No{'\n'}capacity</span>
          </div>
        )}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '8px 12px' }}>
            <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.04em' }}>Calculated</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, lineHeight: 1.2 }}>
              {balance.toFixed(0)}<span style={{ fontSize: '12px', fontWeight: 400, marginLeft: '3px' }}>L</span>
            </div>
          </div>
          <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '8px 12px' }}>
            <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.04em' }}>Last Dip</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: dip ? THEME.text : THEME.textLow, lineHeight: 1.2 }}>
              {dip ? `${Number(dip.level_end_litres ?? dip.level_litres).toFixed(0)} L` : '—'}
            </div>
            {dip && <div style={{ fontSize: '10px', color: THEME.textLow }}>{fmtDate(dip.reading_date)}</div>}
          </div>
        </div>
      </div>

      {pct !== null && (
        <div style={{ marginBottom: variance !== null ? '10px' : 0 }}>
          <div style={{ height: '6px', borderRadius: '4px', background: THEME.outlineVar }}>
            <div style={{ height: '100%', borderRadius: '4px', width: `${pct}%`, background: levelColor, transition: 'width .4s' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '3px', fontSize: '10px', color: THEME.textLow }}>
            <span>0 L</span>
            <span>{Number(tank.capacity_litres).toLocaleString()} L capacity</span>
          </div>
        </div>
      )}

      {variance !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '10px',
          background: Math.abs(variance) > 10 ? THEME.statusErrorBg : THEME.statusSuccessBg,
          color: Math.abs(variance) > 10 ? THEME.statusErrorText : THEME.statusSuccessText,
          fontSize: '12px', fontWeight: 500,
        }}>
          <Icon name={Math.abs(variance) > 10 ? 'warning' : 'check_circle'} size={14} style={{ color: 'inherit' }} />
          {variance > 0
            ? `${variance.toFixed(1)} L unaccounted (possible loss)`
            : variance < 0
              ? `${Math.abs(variance).toFixed(1)} L surplus — check dip reading`
              : 'No variance'}
        </div>
      )}
    </div>
  )
}

function relativeDayLabel(dateStr) {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today - d) / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays > 1)   return `${diffDays} days ago`
  return fmtDate(dateStr)
}

function TankHeroBar({ tank, balance }) {
  const cap = Number(tank.capacity_litres) || 0
  const pct = cap ? Math.min(100, Math.max(0, (balance / cap) * 100)) : null
  const isLow  = pct !== null && pct <= LOW_PCT
  const isWarn = pct !== null && pct > LOW_PCT && pct < WARN_PCT
  const color  = pct === null ? FUEL_CLR : isLow ? THEME.error : isWarn ? THEME.warning : '#00897B'
  const status = pct === null ? '—' : isLow ? 'Low' : isWarn ? 'Watch' : 'Normal'
  const statusBg = isLow ? THEME.statusErrorBg : isWarn ? THEME.statusWarningBg : THEME.statusSuccessBg
  const statusTx = isLow ? THEME.statusErrorText : isWarn ? THEME.statusWarningText : THEME.statusSuccessText

  const lastDipRel = relativeDayLabel(tank.last_dip_date)
  const staleDays = tank.last_dip_date
    ? Math.round((new Date().setHours(0,0,0,0) - new Date(tank.last_dip_date).setHours(0,0,0,0)) / 86400000)
    : null
  const isStale = staleDays !== null && staleDays >= 2

  const meta = [
    tank.code,
    tank.fuel_types?.name || 'Diesel',
    cap ? `Capacity: ${cap.toLocaleString()} L` : null,
    tank.location_description,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '12px', padding: '18px 22px', marginBottom: '14px', boxShadow: THEME.shadow1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '17px', fontWeight: 700, color: THEME.text }}>{tank.name}</div>
          <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{meta}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {pct !== null && <span style={{ fontSize: '26px', fontWeight: 700, color }}>{pct.toFixed(0)}%</span>}
          <span style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: statusBg, color: statusTx, letterSpacing: '.04em' }}>
            {status}
          </span>
        </div>
      </div>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: '7px',
        padding: '6px 14px', borderRadius: '8px', marginBottom: '12px',
        background: isStale ? THEME.statusWarningBg : THEME.statusSuccessBg,
        color: isStale ? THEME.statusWarningText : THEME.statusSuccessText,
        fontSize: '13px', fontWeight: 700,
      }}>
        <Icon name="straighten" size={16} style={{ color: 'inherit' }} />
        {tank.last_dip_date
          ? <span>Last dip reading: {lastDipRel} — {fmtDate(tank.last_dip_date)}</span>
          : <span>No dip reading recorded yet</span>}
      </div>

      <div style={{ position: 'relative', height: '30px', borderRadius: '6px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
        {/* 20% segment gridlines */}
        {[20, 40, 60, 80].map(p => (
          <div key={p} style={{ position: 'absolute', top: 0, bottom: 0, left: `${p}%`, width: '1px', background: THEME.surface, zIndex: 2 }} />
        ))}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: 0,
          width: `${pct ?? 0}%`, background: color, transition: 'width .5s',
          display: 'flex', alignItems: 'center',
        }}>
          <span style={{ marginLeft: '12px', fontSize: '12px', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap' }}>
            {Math.round(balance).toLocaleString()} L
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: THEME.textLow }}>
        {['0', '20%', '40%', '60%', '80%', '100%'].map(t => <span key={t}>{t}</span>)}
      </div>
    </div>
  )
}

const TX_ICONS = {
  delivery:   { icon: 'arrow_downward', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'Delivery' },
  issuance:   { icon: 'arrow_upward',   bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'Issuance' },
  adjustment: { icon: 'sync_alt',       bg: THEME.statusInfoBg,    text: THEME.statusInfoText,    label: 'Adjustment' },
  dip:        { icon: 'straighten',     bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Dip' },
}

function BarChart({ data, color }) {
  const W = 480, H = 120, BAR_W = 36, GAP = 10
  const max = Math.max(...data.map(d => d.v), 1)
  const total = data.length
  const slotW = (W - GAP) / total

  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} style={{ width: '100%', maxWidth: W, overflow: 'visible' }}>
      <defs>
        <linearGradient id="dashBarGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={0} x2={W} y1={H - f * H} y2={H - f * H} stroke={THEME.outlineVar} strokeWidth="0.5" strokeDasharray="3 3" />
      ))}
      {data.map((d, i) => {
        const barH = Math.max(2, (d.v / max) * H)
        const x = i * slotW + (slotW - BAR_W) / 2
        const y = H - barH
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={BAR_W} height={barH} rx={5} fill="url(#dashBarGrad)" opacity={d.v > 0 ? 1 : 0.12} />
            {d.v > 0 && (
              <text x={x + BAR_W / 2} y={y - 6} textAnchor="middle" fontSize={10} fontWeight="600" fill={color} fontFamily="inherit">
                {d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v.toFixed(0)}
              </text>
            )}
            <text x={x + BAR_W / 2} y={H + 18} textAnchor="middle" fontSize={10} fontWeight="500" fill={THEME.textLow} fontFamily="inherit">{d.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function FuelDashboard({ setPage }) {
  const { tanks, operators, transactions, loading, tankBalance, latestDip, avgDailyConsumption } = useFuel()
  const { currentSite, currentSiteId } = useSite()
  const { can } = usePermissions()
  const [alertDismissed, setAlertDismissed] = useState(false)
  const [pendingRequests, setPendingRequests] = useState(null)
  const [deliveryCost, setDeliveryCost] = useState(null)
  const [anomalies, setAnomalies] = useState([])

  const today = new Date().toISOString().slice(0, 10)
  const thisMonth = today.slice(0, 7)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('fuel_requests').select('id', { count: 'exact', head: true })
      .eq('site_id', currentSiteId).eq('status', 'pending')
      .then(({ count }) => setPendingRequests(count ?? 0))
  }, [currentSiteId])

  useEffect(() => {
    if (!currentSiteId) return
    const start = thisMonth + '-01'
    supabase.from('fuel_transactions')
      .select('litres, unit_price')
      .eq('site_id', currentSiteId)
      .eq('is_deleted', false)
      .eq('transaction_type', 'delivery')
      .gte('transaction_date', start)
      .then(({ data }) => {
        const cost = (data || []).reduce((s, r) => s + (r.unit_price && r.litres ? Number(r.unit_price) * Number(r.litres) : 0), 0)
        setDeliveryCost(cost)
      })
  }, [currentSiteId, thisMonth])

  const activeTanks    = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])
  const activeOperators = useMemo(() => operators.filter(o => o.is_active), [operators])

  const lowTanks = useMemo(() =>
    activeTanks.filter(t => {
      if (!t.capacity_litres) return false
      const pct = Math.min(100, Math.max(0, (tankBalance(t.id) / Number(t.capacity_litres)) * 100))
      return pct <= LOW_PCT
    }), [activeTanks, tankBalance])

  // KPIs from raw transactions (litres field)
  const issuedToday = useMemo(() =>
    transactions
      .filter(t => t.transaction_type === 'issuance' && t.transaction_date === today)
      .reduce((s, t) => s + Number(t.litres), 0),
  [transactions, today])

  const deliveredThisMonth = useMemo(() =>
    transactions
      .filter(t => t.transaction_type === 'delivery' && t.transaction_date?.startsWith(thisMonth))
      .reduce((s, t) => s + Number(t.litres), 0),
  [transactions, thisMonth])

  // Anomaly detection — runs after context data loads
  useEffect(() => {
    if (loading || !currentSiteId || !tanks.length) return
    const found = []
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
    const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10)
    const yesterday = new Date(now - 86400000).toISOString().slice(0, 10)
    const twoDaysAgo = new Date(now - 2 * 86400000).toISOString().slice(0, 10)

    // 1. Tanks with no dip reading in last 24h
    const activeTankList = tanks.filter(t => t.status === 'active' && !t.is_archived)
    for (const tank of activeTankList) {
      const dip = latestDip(tank.id)
      if (!dip || dip.reading_date < yesterday) {
        found.push({
          type: 'no_dip',
          severity: 'warning',
          icon: 'straighten',
          title: 'No dip reading in 24 h',
          detail: tank.name || tank.tank_name,
          value: dip ? `Last: ${dip.reading_date}` : 'Never recorded',
          action: 'fuel_dips',
        })
      }
    }

    // 2. Vehicle excessive consumption — 7 days (compute from context transactions)
    const recentIssuances = transactions.filter(t =>
      t.transaction_type === 'issuance' && t.vehicle_id && t.transaction_date >= sevenDaysAgo
    )
    const vMap = {}
    for (const t of recentIssuances) {
      if (!vMap[t.vehicle_id]) vMap[t.vehicle_id] = { litres: 0, km: 0, expected: null, label: '' }
      vMap[t.vehicle_id].litres += Number(t.litres)
      if (t.meter_start != null && t.meter_end != null) {
        const km = Number(t.meter_end) - Number(t.meter_start)
        if (km > 0) vMap[t.vehicle_id].km += km
      }
      if (!vMap[t.vehicle_id].label) {
        const v = t.vehicle || t.fuel_vehicles
        vMap[t.vehicle_id].label = v?.fleet_number || t.vehicle_id
        vMap[t.vehicle_id].expected = v?.expected_consumption_lpkm ? Number(v.expected_consumption_lpkm) : null
      }
    }
    for (const [, row] of Object.entries(vMap)) {
      if (row.km > 0 && row.expected) {
        const actual = row.litres / row.km
        const ratio = actual / row.expected
        if (ratio > 1.2) {
          found.push({
            type: 'excess_consumption',
            severity: 'error',
            icon: 'local_gas_station',
            title: 'Excessive fuel consumption',
            detail: row.label,
            value: `${(ratio * 100).toFixed(0)}% of expected (7 days)`,
            action: 'fuel_vehicle_consumption',
          })
        }
      }
    }

    // 3. Operators with >10 issuances today
    const MAX_ISSUANCES_PER_DAY = 10
    const opToday = {}
    for (const t of transactions.filter(t => t.transaction_type === 'issuance' && t.transaction_date === todayStr && t.operator_id)) {
      opToday[t.operator_id] = (opToday[t.operator_id] || { count: 0, name: '' })
      opToday[t.operator_id].count += 1
      if (!opToday[t.operator_id].name) opToday[t.operator_id].name = t.operator?.full_name || t.operator_id
    }
    for (const [, op] of Object.entries(opToday)) {
      if (op.count > MAX_ISSUANCES_PER_DAY) {
        found.push({
          type: 'operator_volume',
          severity: 'warning',
          icon: 'badge',
          title: 'High issuance volume',
          detail: op.name,
          value: `${op.count} issuances today (limit: ${MAX_ISSUANCES_PER_DAY})`,
          action: 'fuel_issues',
        })
      }
    }

    // 4 & 5. Unconfirmed deliveries >48h + dip variance — async checks
    supabase.from('fuel_transactions')
      .select('id, transaction_date, tank:fuel_tanks(name), created_at')
      .eq('site_id', currentSiteId)
      .eq('is_deleted', false)
      .eq('transaction_type', 'delivery')
      .is('approved_at', null)
      .lte('transaction_date', twoDaysAgo)
      .then(({ data: unconfirmed }) => {
        for (const d of (unconfirmed || [])) {
          found.push({
            type: 'unconfirmed_delivery',
            severity: 'warning',
            icon: 'local_shipping',
            title: 'Delivery awaiting confirmation',
            detail: d.tank?.name || '—',
            value: `Recorded ${d.transaction_date} — unconfirmed >48 h`,
            action: 'fuel_receipts',
          })
        }
      })

    supabase.from('fuel_dip_readings')
      .select('tank_id, variance_percent, reading_date, tank:fuel_tanks(name)')
      .eq('site_id', currentSiteId)
      .not('variance_percent', 'is', null)
      .gte('reading_date', sevenDaysAgo)
      .then(({ data: dips }) => {
        const seen = new Set()
        for (const d of (dips || [])) {
          if (!seen.has(d.tank_id) && Math.abs(Number(d.variance_percent)) > 5) {
            seen.add(d.tank_id)
            found.push({
              type: 'dip_variance',
              severity: 'error',
              icon: 'compare_arrows',
              title: 'High dip variance',
              detail: d.tank?.name || '—',
              value: `${Number(d.variance_percent).toFixed(1)}% on ${d.reading_date}`,
              action: 'fuel_report_variance',
            })
          }
        }
        setAnomalies([...found])
      })

    setAnomalies([...found])
  }, [loading, currentSiteId, tanks, transactions, latestDip])

  // 7-day daily issuance for bar chart
  const sevenDayData = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(Date.now() - (6 - i) * 86400000)
      const label = d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)
      const iso = d.toISOString().slice(0, 10)
      const v = transactions
        .filter(t => t.transaction_type === 'issuance' && t.transaction_date === iso)
        .reduce((s, t) => s + Number(t.litres), 0)
      return { label, v }
    })
  }, [transactions])

  // 14-day sparkline data for issuance trend
  const sparkData = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const iso = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10)
      return transactions
        .filter(t => t.transaction_type === 'issuance' && t.transaction_date === iso)
        .reduce((s, t) => s + Number(t.litres), 0)
    })
  }, [transactions])

  // Issuance trend: this week vs last week
  const issuanceTrend = useMemo(() => {
    const thisWeek = sevenDayData.reduce((s, d) => s + d.v, 0)
    const prevWeekData = Array.from({ length: 7 }, (_, i) => {
      const iso = new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10)
      return transactions
        .filter(t => t.transaction_type === 'issuance' && t.transaction_date === iso)
        .reduce((s, t) => s + Number(t.litres), 0)
    })
    const lastWeek = prevWeekData.reduce((s, v) => s + v, 0)
    if (!lastWeek) return null
    return Math.round(((thisWeek - lastWeek) / lastWeek) * 100)
  }, [sevenDayData, transactions])

  // Fuel type breakdown (issuances this month)
  const fuelTypeBreakdown = useMemo(() => {
    const byType = new Map()
    const colors = ['#D97706', '#1565C0', '#00897B', '#7C3AED', '#E53935']
    for (const t of transactions) {
      if (t.transaction_type !== 'issuance' || !t.transaction_date?.startsWith(thisMonth)) continue
      const tank = tanks.find(tk => tk.id === t.tank_id)
      const fuelName = tank?.fuel_types?.name || 'Unknown'
      byType.set(fuelName, (byType.get(fuelName) || 0) + Number(t.litres))
    }
    return [...byType.entries()].map(([label, value], i) => ({ label, value, color: colors[i % colors.length] }))
  }, [transactions, tanks, thisMonth])

  // Last 10 transactions for the feed
  const recent = useMemo(() => transactions.slice(0, 10), [transactions])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
      <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ maxWidth: '1100px' }}>

      {/* Low-fuel alert banner */}
      {lowTanks.length > 0 && !alertDismissed && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '12px',
          padding: '14px 18px',
          background: THEME.statusErrorBg,
          border: `1px solid ${THEME.error}55`,
          borderRadius: '14px', marginBottom: '20px',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
            background: THEME.error + '22',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="warning" size={20} style={{ color: THEME.error }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.statusErrorText, marginBottom: '6px' }}>
              Low fuel — {lowTanks.length} tank{lowTanks.length > 1 ? 's' : ''} at or below {LOW_PCT}%
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {lowTanks.map(t => {
                const bal = tankBalance(t.id)
                const pct = Math.min(100, Math.max(0, (bal / Number(t.capacity_litres)) * 100))
                return (
                  <span key={t.id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '5px',
                    padding: '3px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                    background: THEME.error + '18', color: THEME.statusErrorText,
                    border: `1px solid ${THEME.error}33`,
                  }}>
                    <Icon name="propane_tank" size={13} style={{ color: THEME.error }} />
                    {t.name} — {pct.toFixed(0)}% ({bal.toFixed(0)} L)
                  </span>
                )
              })}
            </div>
            <div style={{ fontSize: '12px', color: THEME.statusErrorText, opacity: .75, marginTop: '6px' }}>
              Arrange a fuel delivery and record a receipt as soon as possible to avoid a shortage.
            </div>
          </div>
          <button onClick={() => setAlertDismissed(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, color: THEME.statusErrorText, opacity: .6, padding: '4px' }} title="Dismiss">
            <Icon name="close" size={18} style={{ color: 'inherit' }} />
          </button>
        </div>
      )}

      <PageHeader
        title="Fuel Dashboard"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {can('fuel.create') && (
              <button onClick={() => setPage('fuel_receipts')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer' }}>
                <Icon name="local_gas_station" size={16} style={{ color: FUEL_CLR }} /> Record Delivery
              </button>
            )}
            {can('fuel.create') && (
              <button onClick={() => setPage('fuel_issuance')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer' }}>
                <Icon name="output" size={16} style={{ color: '#fff' }} /> Issue Fuel
              </button>
            )}
          </div>
        }
      />

      {/* Hero tank level bars */}
      {activeTanks.length > 0 && (
        <div style={{ marginBottom: '10px' }}>
          {activeTanks.map(t => (
            <TankHeroBar key={t.id} tank={t} balance={tankBalance(t.id)} />
          ))}
        </div>
      )}

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <StatCard
          label="Total Tanks"
          value={activeTanks.length}
          sub="active at this site"
          icon="propane_tank"
          onClick={() => setPage('fuel_tanks')}
        />
        <StatCard
          label="Below Threshold"
          value={lowTanks.length}
          sub={`tanks ≤ ${LOW_PCT}%`}
          icon="warning"
          color={lowTanks.length > 0 ? THEME.error : THEME.textLow}
        />
        <StatCard
          label="Issued Today"
          value={`${issuedToday.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`}
          sub={today}
          icon="output"
          color={THEME.warning}
          onClick={() => setPage('fuel_issues')}
          trend={issuanceTrend}
        />
        <StatCard
          label="Delivered This Month"
          value={`${deliveredThisMonth.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`}
          sub={deliveryCost != null && deliveryCost > 0 ? `$${deliveryCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} cost` : thisMonth}
          icon="local_gas_station"
          color={THEME.success}
          onClick={() => setPage('fuel_receipts')}
        />
        <StatCard
          label="Pending Requests"
          value={pendingRequests ?? '…'}
          sub="awaiting approval"
          icon="pending_actions"
          color={pendingRequests > 0 ? THEME.warning : THEME.textLow}
          onClick={() => setPage('fuel_requests_list')}
        />
        <StatCard
          label="Active Operators"
          value={activeOperators.length}
          sub="licensed operators"
          icon="badge"
          color={FUEL_CLR}
        />
      </div>

      {/* Charts row: 7-day bar + fuel type donut */}
      <div style={{ display: 'grid', gridTemplateColumns: fuelTypeBreakdown.length > 0 ? '1fr 320px' : '1fr', gap: '16px', marginBottom: '24px' }}>
        <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '18px 22px', boxShadow: THEME.shadow1 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Daily Issuance — Last 7 Days
            </div>
            <Sparkline data={sparkData} color={FUEL_CLR} />
          </div>
          <BarChart data={sevenDayData} color={FUEL_CLR} />
        </div>
        {fuelTypeBreakdown.length > 0 && (
          <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '18px 22px', boxShadow: THEME.shadow1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '16px' }}>
              Fuel Type Breakdown
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DonutChart segments={fuelTypeBreakdown} />
            </div>
            <div style={{ fontSize: '10px', color: THEME.textLow, textAlign: 'center', marginTop: '8px' }}>
              Issuances this month by fuel type
            </div>
          </div>
        )}
      </div>

      {/* Quick links */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px', marginBottom: '24px' }}>
        {[
          { label: 'Pending Requests', icon: 'pending_actions', page: 'fuel_requests_list', badge: pendingRequests > 0 ? pendingRequests : null },
          { label: "Today's Shift Report", icon: 'summarize', page: 'fuel_shift_report' },
          { label: 'Reconciliations', icon: 'balance', page: 'fuel_reconciliation' },
        ].map(l => (
          <button
            key={l.label}
            onClick={() => setPage(l.page)}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', cursor: 'pointer', fontFamily: 'inherit', boxShadow: THEME.shadow1, transition: 'box-shadow .15s' }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = THEME.shadow2 }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = THEME.shadow1 }}
          >
            <Icon name={l.icon} size={18} style={{ color: FUEL_CLR }} />
            <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text, flex: 1, textAlign: 'left' }}>{l.label}</span>
            {l.badge && (
              <span style={{ background: THEME.warning, color: '#fff', borderRadius: '6px', fontSize: '11px', fontWeight: 700, padding: '1px 7px' }}>{l.badge}</span>
            )}
            <Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} />
          </button>
        ))}
      </div>

      {/* Anomalies */}
      {anomalies.length > 0 && (
        <div style={{ background: THEME.surface, borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, padding: '16px 20px', marginBottom: '24px', boxShadow: THEME.shadow1 }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="warning" size={15} style={{ color: THEME.warning }} />
            Anomaly Alerts ({anomalies.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {anomalies.map((a, i) => {
              const isError = a.severity === 'error'
              const bc = isError ? THEME.statusErrorBg : THEME.statusWarningBg
              const tc = isError ? THEME.statusErrorText : THEME.statusWarningText
              return (
                <div
                  key={i}
                  onClick={() => setPage(a.action)}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: bc, borderRadius: '10px', cursor: 'pointer', border: `1px solid ${tc}20` }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '.85' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                >
                  <Icon name={a.icon} size={18} style={{ color: tc, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: tc }}>{a.title}</div>
                    <div style={{ fontSize: '12px', color: tc, opacity: .8 }}>{a.detail} — {a.value}</div>
                  </div>
                  <Icon name="chevron_right" size={16} style={{ color: tc, flexShrink: 0 }} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tank level overview */}
      {activeTanks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: THEME.surface, borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, marginBottom: '24px' }}>
          <Icon name="propane_tank" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <p style={{ color: THEME.textLow, fontSize: '14px', margin: '0 0 16px' }}>No tanks configured yet.</p>
          {can('fuel.edit') && (
            <button onClick={() => setPage('fuel_tanks')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer' }}>
              <Icon name="add" size={16} style={{ color: '#fff' }} /> Add First Tank
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tank Level Overview</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', color: THEME.textLow }}>
              {[
                { color: THEME.success, label: `≥ ${WARN_PCT}%` },
                { color: THEME.warning, label: `${LOW_PCT}–${WARN_PCT}%` },
                { color: THEME.error,   label: `≤ ${LOW_PCT}%` },
              ].map(l => (
                <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: l.color, display: 'inline-block' }} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px', marginBottom: '28px' }}>
            {activeTanks.map(tank => (
              <TankCard
                key={tank.id}
                tank={tank}
                balance={tankBalance(tank.id)}
                dip={latestDip(tank.id)}
                daysRemaining={(() => {
                  const avg = avgDailyConsumption(tank.id)
                  if (!avg || avg <= 0) return null
                  return Math.floor(Math.max(0, tankBalance(tank.id)) / avg)
                })()}
              />
            ))}
          </div>
        </>
      )}

      {/* Recent transactions */}
      <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '18px 22px', boxShadow: THEME.shadow1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Recent Transactions
          </div>
          <button
            onClick={() => setPage('fuel_ledger')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 500, color: FUEL_CLR, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '8px' }}
          >
            View all <Icon name="chevron_right" size={15} style={{ color: FUEL_CLR }} />
          </button>
        </div>

        {recent.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: THEME.textLow, fontSize: '13px' }}>
            No transactions recorded yet.
          </div>
        ) : (
          recent.map((tx, idx) => {
            const meta = TX_ICONS[tx.transaction_type] || TX_ICONS.adjustment
            const tank = tanks.find(t => t.id === tx.tank_id)
            const assetName = tx.fuel_vehicles?.fleet_number
              ? `${tx.fuel_vehicles.fleet_number}${tx.fuel_vehicles.registration ? ` (${tx.fuel_vehicles.registration})` : ''}`
              : tx.fuel_equipment?.name || tx.asset_description || null

            return (
              <div key={tx.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 0',
                borderBottom: idx < recent.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
              }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                  background: meta.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name={meta.icon} size={16} style={{ color: meta.text }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: THEME.text, fontWeight: 500 }}>
                    {meta.label}
                    {assetName && <span style={{ fontWeight: 400, color: THEME.textMed }}> · {assetName}</span>}
                  </div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '1px' }}>
                    {tank?.name || 'Unknown tank'} · {fmtDate(tx.transaction_date)}
                    {tx.notes && <span> · {tx.notes}</span>}
                  </div>
                </div>
                <div style={{
                  fontSize: '14px', fontWeight: 700, color: meta.text, flexShrink: 0,
                  textAlign: 'right',
                }}>
                  {tx.transaction_type === 'delivery' ? '+' : tx.transaction_type === 'issuance' ? '-' : ''}
                  {Number(tx.litres).toLocaleString(undefined, { maximumFractionDigits: 0 })} L
                </div>
              </div>
            )
          })
        )}
      </div>

    </div>
  )
}
