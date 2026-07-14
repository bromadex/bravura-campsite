import { useState, useMemo } from 'react'
import { primaryTank } from '../../utils/tanks'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Card, Icon, fmtDate } from '../../components/ui'
import FuelQuickNav from './FuelQuickNav'

const FUEL_CLR = MODULE_COLORS.fuel
const TANK_CLR = '#00897B'

const RATE_WINDOWS = [
  { key: '7d',  label: '7-day',  days: 7  },
  { key: '14d', label: '14-day', days: 14 },
  { key: '30d', label: '30-day', days: 30 },
]

function avgDailyRate(issuances, days) {
  const today = new Date()
  const cutoff = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10)
  const recent = issuances.filter(t => t.transaction_date >= cutoff)
  if (!recent.length) return 0
  const total = recent.reduce((s, t) => s + Number(t.litres), 0)
  return total / days
}

export default function Forecasting({ setPage }) {
  const { currentSite } = useSite()
  const { tanks, transactions, loading } = useFuel()
  const [rateWindow, setRateWindow] = useState('14d')
  const [tankSel, setTankSel] = useState('')

  const activeTanks = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])
  const tank = useMemo(() => activeTanks.find(t => t.id === tankSel) || primaryTank(activeTanks), [activeTanks, tankSel])

  const issuances = useMemo(() => {
    if (!tank) return []
    return transactions.filter(t => t.transaction_type === 'issuance' && t.tank_id === tank.id)
  }, [transactions, tank])

  const rates = useMemo(() => ({
    '7d':  avgDailyRate(issuances, 7),
    '14d': avgDailyRate(issuances, 14),
    '30d': avgDailyRate(issuances, 30),
  }), [issuances])

  const activeRate = rates[rateWindow]
  const current = tank ? Number(tank.current_level_litres) : 0
  const capacity = tank ? Number(tank.capacity_litres) || 0 : 0
  const reorderPct = tank ? Number(tank.min_threshold_percent) || 20 : 20
  const reorderLevel = capacity * (reorderPct / 100)
  const pctFull = capacity ? Math.min(100, Math.max(0, (current / capacity) * 100)) : 0

  const forecast = useMemo(() => {
    if (!activeRate || activeRate <= 0) return null
    const daysToReorder   = Math.max(0, (current - reorderLevel) / activeRate)
    const daysToEmpty     = current / activeRate
    const reorderDate     = new Date(Date.now() + daysToReorder * 86400000)
    const depletionDate   = new Date(Date.now() + daysToEmpty * 86400000)
    const fillTo90        = capacity * 0.9
    const recommendedOrder = Math.max(0, fillTo90 - current)
    return { daysToReorder, daysToEmpty, reorderDate, depletionDate, recommendedOrder, fillTo90 }
  }, [activeRate, current, reorderLevel, capacity])

  const projection = useMemo(() => {
    if (!activeRate) return []
    return [5, 10, 15, 20, 25, 30, 35].map(day => {
      const level = Math.max(0, current - activeRate * day)
      const pct = capacity ? (level / capacity) * 100 : 0
      const date = new Date(Date.now() + day * 86400000)
      return { day, date, level, pct }
    })
  }, [activeRate, current, capacity])

  const trend = useMemo(() => {
    const today = new Date()
    const cutoff = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10)
    const m = new Map()
    for (const t of issuances) {
      if (t.transaction_date < cutoff) continue
      m.set(t.transaction_date, (m.get(t.transaction_date) || 0) + Number(t.litres))
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, litres]) => ({ date, litres }))
  }, [issuances])

  if (loading) return null

  const selStyle = {
    padding: '7px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
    fontSize: '13px', color: THEME.text, background: THEME.surface,
    fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <FuelQuickNav setPage={setPage} current="fuel_forecasting" />
      <PageHeader title="Fuel Forecasting" site={currentSite} />

      {activeTanks.length > 1 && (
        <div style={{ marginBottom: '20px' }}>
          <select value={tank?.id || ''} onChange={e => setTankSel(e.target.value)} style={selStyle}>
            {activeTanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {!tank ? (
        <Card style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No active tanks to forecast.</Card>
      ) : (
        <>
          {/* ── Current Tank Status ── */}
          <Card style={{ padding: '20px 22px', marginBottom: '20px' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Current Tank Status</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '30px', fontWeight: 700, color: TANK_CLR }}>{current.toLocaleString(undefined, { maximumFractionDigits: 0 })} L</span>
              <span style={{ fontSize: '13px', color: THEME.textLow }}>of {capacity.toLocaleString()} L capacity</span>
              <span style={{ marginLeft: 'auto', fontSize: '18px', fontWeight: 700, color: TANK_CLR }}>{pctFull.toFixed(1)}%</span>
            </div>
            <div style={{ position: 'relative', height: '10px', borderRadius: '5px', background: THEME.surfaceVar, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${pctFull}%`, background: TANK_CLR, transition: 'width .4s' }} />
              {capacity > 0 && (
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${reorderPct}%`, width: '2px', background: THEME.warning }} />
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: THEME.textLow }}>
              <span>0</span>
              <span style={{ color: THEME.warning, fontWeight: 600 }}>Reorder at {reorderPct}% ({reorderLevel.toLocaleString(undefined, { maximumFractionDigits: 0 })} L)</span>
              <span>{capacity.toLocaleString()} L</span>
            </div>
          </Card>

          {/* ── Consumption Rates ── */}
          <Card style={{ padding: '20px 22px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Consumption Rates</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {RATE_WINDOWS.map(w => (
                  <button
                    key={w.key}
                    onClick={() => setRateWindow(w.key)}
                    style={{
                      padding: '6px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600,
                      border: `1px solid ${rateWindow === w.key ? FUEL_CLR : THEME.outlineVar}`,
                      background: rateWindow === w.key ? FUEL_CLR : THEME.surface,
                      color: rateWindow === w.key ? '#fff' : THEME.textMed,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px' }}>
              {RATE_WINDOWS.map(w => (
                <div
                  key={w.key}
                  onClick={() => setRateWindow(w.key)}
                  style={{
                    padding: '14px 16px', borderRadius: '10px', cursor: 'pointer',
                    border: `1.5px solid ${rateWindow === w.key ? FUEL_CLR : THEME.outlineVar}`,
                    background: rateWindow === w.key ? FUEL_CLR + '0c' : THEME.surface,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px' }}>
                    <Icon name="trending_down" size={14} style={{ color: THEME.textLow }} />
                    <span style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>{w.label} avg</span>
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: rateWindow === w.key ? FUEL_CLR : THEME.text }}>
                    {rates[w.key].toFixed(2)}<span style={{ fontSize: '13px', fontWeight: 500 }}> L/day</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* ── Forecast ── */}
          <Card style={{ padding: '20px 22px', marginBottom: '20px' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>
              Forecast (using {RATE_WINDOWS.find(w => w.key === rateWindow)?.label})
            </div>
            {!forecast ? (
              <div style={{ textAlign: 'center', padding: '20px', color: THEME.textLow, fontSize: '13px' }}>
                Not enough consumption data to forecast.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                <div style={{ padding: '16px', borderRadius: '10px', background: THEME.statusWarningBg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <Icon name="shopping_cart" size={16} style={{ color: THEME.statusWarningText }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.statusWarningText }}>Reorder Date</span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.statusWarningText }}>{fmtDate(forecast.reorderDate.toISOString().slice(0, 10))}</div>
                  <div style={{ fontSize: '11px', color: THEME.statusWarningText, opacity: .8, marginTop: '2px' }}>
                    in {Math.round(forecast.daysToReorder)} day{Math.round(forecast.daysToReorder) !== 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{ padding: '16px', borderRadius: '10px', background: THEME.statusErrorBg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <Icon name="hourglass_bottom" size={16} style={{ color: THEME.statusErrorText }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.statusErrorText }}>Depletion Date</span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.statusErrorText }}>{fmtDate(forecast.depletionDate.toISOString().slice(0, 10))}</div>
                  <div style={{ fontSize: '11px', color: THEME.statusErrorText, opacity: .8, marginTop: '2px' }}>
                    in {Math.round(forecast.daysToEmpty)} days at {activeRate.toFixed(2)} L/day
                  </div>
                </div>
                <div style={{ padding: '16px', borderRadius: '10px', background: THEME.statusSuccessBg }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <Icon name="local_shipping" size={16} style={{ color: THEME.statusSuccessText }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.statusSuccessText }}>Recommended Order</span>
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.statusSuccessText }}>{Math.round(forecast.recommendedOrder).toLocaleString()} L</div>
                  <div style={{ fontSize: '11px', color: THEME.statusSuccessText, opacity: .8, marginTop: '2px' }}>
                    fills tank to 90% ({Math.round(forecast.fillTo90).toLocaleString()} L)
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* ── 30-Day Projection ── */}
          <Card style={{ padding: 0, marginBottom: '20px' }}>
            <div style={{ padding: '16px 20px', fontSize: '15px', fontWeight: 600, color: THEME.text }}>
              30-Day Projection (every 5 days, {RATE_WINDOWS.find(w => w.key === rateWindow)?.label} rate)
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: THEME.surfaceVar }}>
                    {['Day', 'Date', 'Projected Level', '% Full', 'Level'].map((h, i) => (
                      <th key={h} style={{ padding: '9px 16px', textAlign: i >= 2 && i < 4 ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projection.map((row, idx) => {
                    const color = row.pct <= 20 ? THEME.error : row.pct <= 40 ? THEME.warning : THEME.text
                    return (
                      <tr key={row.day} style={{ borderBottom: idx === projection.length - 1 ? 'none' : `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '10px 16px', color: THEME.text, fontWeight: 500 }}>Day {row.day}</td>
                        <td style={{ padding: '10px 16px', color: THEME.textMed }}>{fmtDate(row.date.toISOString().slice(0, 10))}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color }}>{row.level.toLocaleString(undefined, { maximumFractionDigits: 2 })} L</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color }}>{row.pct.toFixed(1)}%</td>
                        <td style={{ padding: '10px 16px', width: '160px' }}>
                          <div style={{ height: '6px', borderRadius: '3px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, row.pct))}%`, background: color, transition: 'width .3s' }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Consumption Trend ── */}
          <Card style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Consumption Trend — Last 30 Days</div>
            <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '14px' }}>Daily litres issued (from fuel log)</div>
            {trend.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: THEME.textLow, fontSize: '13px' }}>No issuances in the last 30 days.</div>
            ) : (
              <TrendBarChart data={trend} color={FUEL_CLR} onBarClick={() => setPage?.('fuel_issuance')} />
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function TrendBarChart({ data, color, onBarClick }) {
  const [hover, setHover] = useState(null)
  const W = 960, H = 220, PAD = { top: 24, right: 10, bottom: 26, left: 10 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const max = Math.max(...data.map(d => d.litres), 1)
  const slot = innerW / data.length
  const barW = Math.min(34, slot * 0.6)

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', display: 'block', overflow: 'visible' }}>
        {data.map((d, i) => {
          const h = (d.litres / max) * innerH
          const cx = PAD.left + slot * i + slot / 2
          const y = PAD.top + innerH - h
          const isHover = hover?.i === i
          return (
            <g key={d.date}>
              <rect
                x={cx - barW / 2} y={y} width={barW} height={Math.max(2, h)} rx="3"
                fill={color} opacity={isHover ? 0.8 : 1}
                style={{ cursor: onBarClick ? 'pointer' : 'default' }}
                onMouseEnter={() => setHover({ i, xPct: (cx / W) * 100, yPct: (y / H) * 100 })}
                onMouseLeave={() => setHover(null)}
                onClick={() => onBarClick?.(d, i)}
              />
              {i % Math.ceil(data.length / 15) === 0 && (
                <text x={cx} y={H - 6} fontSize="9" fill={THEME.textLow} textAnchor="middle">{d.date.slice(5)}</text>
              )}
            </g>
          )
        })}
      </svg>
      {hover && (
        <div style={{
          position: 'absolute', left: `${hover.xPct}%`, top: `${hover.yPct}%`,
          transform: 'translate(-50%, -115%)',
          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
          borderRadius: '8px', padding: '7px 11px', boxShadow: THEME.shadow2,
          pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5,
          fontSize: '12px', fontWeight: 600, color: THEME.text,
        }}>
          {data[hover.i].date} — {data[hover.i].litres.toLocaleString()} L
        </div>
      )}
    </div>
  )
}
