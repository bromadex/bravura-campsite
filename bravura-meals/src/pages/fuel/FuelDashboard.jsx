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

const fmtL = n => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} L`

function tankPct(tank, balance) {
  const cap = Number(tank.capacity_litres) || 0
  if (!cap) return null
  return Math.min(100, Math.max(0, (balance / cap) * 100))
}

function levelColor(pct) {
  if (pct === null) return FUEL_CLR
  if (pct < CRIT_PCT) return THEME.error
  if (pct < WARN_PCT) return THEME.warning
  return '#00897B'
}

/* ── KPI card ─────────────────────────────────────────────────────────── */
function KpiCard({ label, value, sub, icon, color, onClick }) {
  const clr = color || FUEL_CLR
  return (
    <div
      onClick={onClick}
      style={{
        background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '12px', padding: '14px 16px', boxShadow: THEME.shadow1,
        display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
        <Icon name={icon} size={16} style={{ color: clr, flexShrink: 0 }} />
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, lineHeight: 1.15, whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow }}>{sub}</div>}
    </div>
  )
}

/* ── Section card wrapper ─────────────────────────────────────────────── */
function Section({ title, sub, action, children }) {
  return (
    <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', padding: '18px 20px', boxShadow: THEME.shadow1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '14px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>{title}</div>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '9px 0' }}>
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
        <div style={{ height: '10px', borderRadius: '5px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct ?? 0}%`, background: clr, borderRadius: '5px', transition: 'width .4s' }} />
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

/* ── Vertical bar chart (inline SVG) ──────────────────────────────────── */
function BarChart({ data, color, height = 160, valueFmt = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString() }) {
  const W = 520, padL = 8, padR = 8, padT = 20, padB = 22
  const H = height
  const areaW = W - padL - padR
  const areaH = H - padT - padB
  const max = Math.max(...data.map(d => d.v), 1)
  const slot = areaW / data.length
  const barW = Math.min(30, slot * 0.62)
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '360px', display: 'block' }}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + areaH - f * areaH} y2={padT + areaH - f * areaH}
            stroke={THEME.outlineVar} strokeWidth="0.5" strokeDasharray="3 3" />
        ))}
        <line x1={padL} x2={W - padR} y1={padT + areaH} y2={padT + areaH} stroke={THEME.outlineVar} strokeWidth="1" />
        {data.map((d, i) => {
          const barH = d.v > 0 ? Math.max(2, (d.v / max) * areaH) : 0
          const x = padL + i * slot + (slot - barW) / 2
          const y = padT + areaH - barH
          return (
            <g key={i}>
              {barH > 0 && <rect x={x} y={y} width={barW} height={barH} rx={3} fill={color} opacity="0.9" />}
              {d.v > 0 && d.v === max && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">
                  {valueFmt(d.v)}
                </text>
              )}
              <text x={x + barW / 2} y={padT + areaH + 14} textAnchor="middle" fontSize="9" fill={THEME.textLow} fontFamily="inherit">{d.label}</text>
            </g>
          )
        })}
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
      <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', fontSize: '11px', color: THEME.textMed }}>
        {[[colorA, labelA], [colorB, labelB]].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '9px', height: '9px', borderRadius: '2px', background: c, display: 'inline-block' }} />
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
                {hA > 0 && <rect x={cx - barW - 2} y={padT + areaH - hA} width={barW} height={hA} rx={3} fill={colorA} opacity="0.9" />}
                {hB > 0 && <rect x={cx + 2} y={padT + areaH - hB} width={barW} height={hB} rx={3} fill={colorB} opacity="0.9" />}
                {d.a > 0 && <text x={cx - barW / 2 - 2} y={padT + areaH - hA - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">{d.a >= 1000 ? `${(d.a / 1000).toFixed(1)}k` : Math.round(d.a)}</text>}
                {d.b > 0 && <text x={cx + barW / 2 + 2} y={padT + areaH - hB - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">{d.b >= 1000 ? `${(d.b / 1000).toFixed(1)}k` : Math.round(d.b)}</text>}
                <text x={cx} y={padT + areaH + 14} textAnchor="middle" fontSize="9" fill={THEME.textLow} fontFamily="inherit">{d.label}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/* ── Transaction type chips ───────────────────────────────────────────── */
const TX_META = {
  delivery:     { label: 'Delivery',     bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, sign: '+' },
  issuance:     { label: 'Issuance',     bg: THEME.statusWarningBg, text: THEME.statusWarningText, sign: '-' },
  transfer_out: { label: 'Transfer Out', bg: THEME.statusWarningBg, text: THEME.statusWarningText, sign: '-' },
  transfer_in:  { label: 'Transfer In',  bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, sign: '+' },
  adjustment:   { label: 'Adjustment',   bg: THEME.statusInfoBg,    text: THEME.statusInfoText,    sign: '' },
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
          display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
          background: THEME.statusErrorBg, border: `1px solid ${THEME.error}55`,
          borderRadius: '12px', marginBottom: '16px',
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
              <button onClick={() => setPage('fuel_receipts')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="local_gas_station" size={16} style={{ color: FUEL_CLR }} /> Record Delivery
              </button>
            )}
            {can('fuel.create') && (
              <button onClick={() => setPage('fuel_issuance')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="output" size={16} style={{ color: '#fff' }} /> Issue Fuel
              </button>
            )}
          </div>
        }
      />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard
          label="Fuel On Hand"
          value={fmtL(tankStats.onHand)}
          sub={tankStats.fillPct !== null ? `${tankStats.fillPct.toFixed(0)}% of ${tankStats.capacity.toLocaleString()} L capacity` : 'no capacity set'}
          icon="propane_tank"
          onClick={() => setPage('fuel_tanks')}
        />
        <KpiCard
          label="Issued Today"
          value={fmtL(issuedToday)}
          sub={fmtDate(today)}
          icon="output"
          color={THEME.warning}
          onClick={() => setPage('fuel_issues')}
        />
        <KpiCard
          label="Issued This Month"
          value={fmtL(issuedThisMonth)}
          sub={`${monthIssuances.length.toLocaleString()} issuance${monthIssuances.length === 1 ? '' : 's'}`}
          icon="trending_down"
          color={THEME.warning}
          onClick={() => setPage('fuel_issues')}
        />
        <KpiCard
          label="Received This Month"
          value={fmtL(receivedThisMonth)}
          sub="deliveries"
          icon="local_shipping"
          color={THEME.success}
          onClick={() => setPage('fuel_receipts')}
        />
        <KpiCard
          label="Active Tanks"
          value={activeTanks.length}
          sub={tankStats.lowCount > 0 ? `${tankStats.lowCount} below ${LOW_PCT}%` : 'all above threshold'}
          icon="propane_tank"
          color={tankStats.lowCount > 0 ? THEME.warning : FUEL_CLR}
          onClick={() => setPage('fuel_tanks')}
        />
        <KpiCard
          label="Pending Acks"
          value={pendingAcks}
          sub="issuance acknowledgements"
          icon="pending_actions"
          color={pendingAcks > 0 ? THEME.warning : THEME.textLow}
          onClick={() => setPage('fuel_issues')}
        />
      </div>

      {/* Tank levels */}
      <div style={{ marginBottom: '16px' }}>
        <Section
          title="Tank Levels"
          action={
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: THEME.textLow, flexWrap: 'wrap' }}>
              {[
                { c: '#00897B', l: `≥ ${WARN_PCT}%` },
                { c: THEME.warning, l: `${CRIT_PCT}–${WARN_PCT}%` },
                { c: THEME.error, l: `< ${CRIT_PCT}%` },
              ].map(x => (
                <span key={x.l} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: x.c, display: 'inline-block' }} />{x.l}
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
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        <Section title="Daily Consumption" sub="Issuance litres per day — last 14 days">
          <BarChart data={dailyData} color={FUEL_CLR} />
        </Section>
        <Section title="Deliveries vs Issuances" sub="Weekly totals — last 4 weeks">
          <PairedBarChart data={weeklyData} colorA={THEME.success} colorB={FUEL_CLR} labelA="Delivered" labelB="Issued" />
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {topConsumers.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '110px', flexShrink: 0, fontSize: '12px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>
                    {c.name}
                  </div>
                  <div style={{ flex: 1, height: '12px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.max(2, (c.litres / maxConsumer) * 100)}%`, background: FUEL_CLR, borderRadius: '4px', opacity: 0.9 }} />
                  </div>
                  <div style={{ width: '72px', flexShrink: 0, textAlign: 'right', fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>
                    {fmtL(c.litres)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Recent Activity"
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
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0',
                    borderBottom: idx < recent.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                  }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '5px', background: meta.bg, color: meta.text, flexShrink: 0, letterSpacing: '.02em', whiteSpace: 'nowrap' }}>
                      {meta.label}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {assetName || tank?.name || '—'}
                      </div>
                      <div style={{ fontSize: '10px', color: THEME.textLow }}>
                        {fmtDate(tx.transaction_date)}{assetName && tank ? ` · ${tank.name}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: meta.text, flexShrink: 0 }}>
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
