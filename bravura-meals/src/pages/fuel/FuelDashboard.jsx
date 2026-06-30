import { useMemo, useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, fmtDate } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel
const LOW_PCT  = 20
const WARN_PCT = 40

function StatCard({ label, value, sub, icon, color }) {
  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '16px', padding: '16px', boxShadow: THEME.shadow1,
      display: 'flex', flexDirection: 'column', gap: '4px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {label}
        </div>
        <Icon name={icon} size={18} style={{ color: color || FUEL_CLR, opacity: .7 }} />
      </div>
      <div style={{ fontSize: '28px', fontWeight: 400, color: color || FUEL_CLR, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow }}>{sub}</div>}
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
  const variance = dip ? balance - Number(dip.reading_litres) : null
  const pct = tank.capacity_litres
    ? Math.min(100, Math.max(0, (balance / Number(tank.capacity_litres)) * 100))
    : null
  const isLow  = pct !== null && pct <= LOW_PCT
  const isWarn = pct !== null && pct > LOW_PCT && pct < WARN_PCT
  const levelColor = pct === null ? FUEL_CLR : isLow ? THEME.error : isWarn ? THEME.warning : THEME.success

  const daysColor = daysRemaining === null ? null
    : daysRemaining < 3  ? THEME.error
    : daysRemaining < 7  ? THEME.warning
    : THEME.success

  return (
    <div style={{
      background: THEME.surface,
      border: `1.5px solid ${isLow ? THEME.error + '55' : THEME.outlineVar}`,
      borderRadius: '16px', padding: '18px', boxShadow: THEME.shadow1,
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
            <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: daysColor + '18', color: daysColor }}>
              ~{daysRemaining}d
            </span>
          )}
          <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: FUEL_CLR + '18', color: FUEL_CLR }}>
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
              {dip ? `${Number(dip.reading_litres).toFixed(0)} L` : '—'}
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
            ? `${variance.toFixed(1)} L unaccounted (spillage / loss)`
            : variance < 0
              ? `${Math.abs(variance).toFixed(1)} L surplus — check dip reading`
              : 'No variance'}
        </div>
      )}
    </div>
  )
}

export default function FuelDashboard({ setPage }) {
  const { tanks, receipts, issues, loading, tankBalance, latestDip, avgDailyConsumption } = useFuel()
  const { currentSite } = useSite()
  const [alertDismissed, setAlertDismissed] = useState(false)

  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const monthReceipts = receipts.filter(r => r.transaction_date?.startsWith(thisMonth))
  const monthIssues   = issues.filter(i => i.transaction_date?.startsWith(thisMonth))
  const totalReceived = monthReceipts.reduce((s, r) => s + Number(r.quantity_litres), 0)
  const totalIssued   = monthIssues.reduce((s, i) => s + Number(i.quantity_litres), 0)
  const totalStock    = tanks.filter(t => t.is_active).reduce((s, t) => s + Math.max(0, tankBalance(t.id)), 0)

  const lowTanks = useMemo(() => (
    tanks.filter(t => t.status === 'active' && !t.is_archived && t.capacity_litres).filter(t => {
      const pct = Math.min(100, Math.max(0, (tankBalance(t.id) / Number(t.capacity_litres)) * 100))
      return pct <= LOW_PCT
    })
  ), [tanks, tankBalance])

  const recent = useMemo(() => {
    const items = [
      ...receipts.slice(0, 15).map(r => ({ ...r, _type: 'receipt', _date: r.transaction_date })),
      ...issues.slice(0, 15).map(i => ({ ...i, _type: 'issue', _date: i.transaction_date })),
    ]
    return items.sort((a, b) => b._date.localeCompare(a._date)).slice(0, 8)
  }, [receipts, issues])

  const activeTanks = tanks.filter(t => t.status === 'active' && !t.is_archived)

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
                    padding: '3px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
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
            <button onClick={() => setPage('fuel_receipts')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 500, background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer' }}>
              <Icon name="local_gas_station" size={16} style={{ color: FUEL_CLR }} /> Record Receipt
            </button>
            <button onClick={() => setPage('fuel_issues')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer' }}>
              <Icon name="output" size={16} style={{ color: '#fff' }} /> Issue Fuel
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <StatCard label="Active Tanks"        value={activeTanks.length}              icon="propane_tank" />
        <StatCard label="Total Stock"         value={`${totalStock.toFixed(0)} L`}    icon="water_full" />
        <StatCard label="Received This Month" value={`${totalReceived.toFixed(0)} L`} icon="arrow_downward" color={THEME.success} />
        <StatCard label="Issued This Month"   value={`${totalIssued.toFixed(0)} L`}   icon="arrow_upward"   color={THEME.warning} />
        {lowTanks.length > 0 && (
          <StatCard label="Low-Fuel Alerts" value={lowTanks.length} sub={`Tank${lowTanks.length > 1 ? 's' : ''} \u2264 ${LOW_PCT}%`} icon="warning" color={THEME.error} />
        )}
      </div>

      {/* Tank cards */}
      {activeTanks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', background: THEME.surface, borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`, marginBottom: '24px' }}>
          <Icon name="propane_tank" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <p style={{ color: THEME.textLow, fontSize: '14px', margin: '0 0 16px' }}>No tanks configured yet.</p>
          <button onClick={() => setPage('fuel_tanks')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer' }}>
            <Icon name="add" size={16} style={{ color: '#fff' }} /> Add First Tank
          </button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>Tank Levels</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11px', color: THEME.textLow }}>
              {[{ color: THEME.success, label: `\u2265 ${WARN_PCT}%` }, { color: THEME.warning, label: `${LOW_PCT}\u2013${WARN_PCT}%` }, { color: THEME.error, label: `\u2264 ${LOW_PCT}%` }].map(l => (
                <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: l.color, display: 'inline-block' }} />
                  {l.label}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            {activeTanks.map(tank => (
              <TankCard key={tank.id} tank={tank} balance={tankBalance(tank.id)} dip={latestDip(tank.id)} setPage={setPage}
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

      {/* Recent activity */}
      {recent.length > 0 && (
        <div style={{ background: THEME.surface, borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`, padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Recent Activity
          </div>
          {recent.map((item, idx) => {
            const isReceipt = item._type === 'receipt'
            const tankName = tanks.find(t => t.id === item.tank_id)?.name || '—'
            return (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: idx < recent.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0, background: isReceipt ? THEME.statusSuccessBg : THEME.statusWarningBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={isReceipt ? 'arrow_downward' : 'arrow_upward'} size={16} style={{ color: isReceipt ? THEME.statusSuccessText : THEME.statusWarningText }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', color: THEME.text, fontWeight: 500 }}>
                    {isReceipt ? `Received ${Number(item.litres).toFixed(0)} L` : `Issued ${Number(item.litres).toFixed(0)} L to ${item.asset_name}`}
                  </div>
                  <div style={{ fontSize: '11px', color: THEME.textLow }}>{tankName} \u00b7 {fmtDate(item._date)}</div>
                </div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: isReceipt ? THEME.statusSuccessText : THEME.statusWarningText, flexShrink: 0 }}>
                  {isReceipt ? '+' : '-'}{Number(item.litres).toFixed(0)} L
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
