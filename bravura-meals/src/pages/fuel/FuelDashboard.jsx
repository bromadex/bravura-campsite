import { useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, fmtDate } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

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

function TankCard({ tank, balance, dip, setPage }) {
  const variance = dip ? balance - Number(dip.reading_litres) : null
  const pct = tank.capacity_litres ? Math.min(100, Math.max(0, (balance / Number(tank.capacity_litres)) * 100)) : null

  let levelColor = FUEL_CLR
  if (pct !== null) {
    if (pct < 20) levelColor = THEME.error
    else if (pct < 40) levelColor = THEME.warning
    else levelColor = THEME.success
  }

  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '16px', padding: '18px', boxShadow: THEME.shadow1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>{tank.name}</div>
          {tank.designation && (
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{tank.designation}</div>
          )}
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
          background: FUEL_CLR + '18', color: FUEL_CLR,
        }}>
          {tank.fuel_type}
        </span>
      </div>

      {/* Level bar */}
      {pct !== null && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '11px', color: THEME.textLow }}>Level</span>
            <span style={{ fontSize: '11px', fontWeight: 600, color: levelColor }}>{pct.toFixed(0)}%</span>
          </div>
          <div style={{ height: '6px', borderRadius: '4px', background: THEME.outlineVar }}>
            <div style={{ height: '100%', borderRadius: '4px', width: `${pct}%`, background: levelColor, transition: 'width .3s' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: dip ? '10px' : 0 }}>
        <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '10px' }}>
          <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' }}>Calculated</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>{balance.toFixed(1)} <span style={{ fontSize: '11px', fontWeight: 400 }}>L</span></div>
        </div>
        <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '10px' }}>
          <div style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' }}>Dip Reading</div>
          <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
            {dip ? `${Number(dip.reading_litres).toFixed(1)} L` : '—'}
          </div>
        </div>
      </div>

      {variance !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '8px 12px', borderRadius: '10px',
          background: Math.abs(variance) > 10 ? THEME.statusErrorBg : THEME.statusSuccessBg,
          color: Math.abs(variance) > 10 ? THEME.statusErrorText : THEME.statusSuccessText,
          fontSize: '12px', fontWeight: 500,
        }}>
          <Icon name={Math.abs(variance) > 10 ? 'warning' : 'check_circle'} size={14} style={{ color: 'inherit' }} />
          {variance > 0
            ? `${variance.toFixed(1)} L unaccounted (spillage / loss)`
            : variance < 0
              ? `${Math.abs(variance).toFixed(1)} L surplus (check dip reading)`
              : 'No variance'
          }
        </div>
      )}

      {dip && (
        <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '8px' }}>
          Last dip: {fmtDate(dip.reading_date)}
        </div>
      )}
    </div>
  )
}

export default function FuelDashboard({ setPage }) {
  const { tanks, receipts, issues, loading, tankBalance, latestDip } = useFuel()
  const { currentSite } = useSite()

  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const monthReceipts = receipts.filter(r => r.receipt_date?.startsWith(thisMonth))
  const monthIssues   = issues.filter(i => i.issue_date?.startsWith(thisMonth))
  const totalReceived = monthReceipts.reduce((s, r) => s + Number(r.quantity_litres), 0)
  const totalIssued   = monthIssues.reduce((s, i) => s + Number(i.quantity_litres), 0)
  const totalStock    = tanks.filter(t => t.is_active).reduce((s, t) => s + Math.max(0, tankBalance(t.id)), 0)

  const recent = useMemo(() => {
    const items = [
      ...receipts.slice(0, 15).map(r => ({ ...r, _type: 'receipt', _date: r.receipt_date })),
      ...issues.slice(0, 15).map(i => ({ ...i, _type: 'issue',   _date: i.issue_date })),
    ]
    return items.sort((a, b) => b._date.localeCompare(a._date)).slice(0, 8)
  }, [receipts, issues])

  const activeTanks = tanks.filter(t => t.is_active)

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
      <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )

  return (
    <div style={{ padding: '20px', maxWidth: '1100px' }}>
      <PageHeader
        title="Fuel Management"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setPage('fuel_receipts')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 500,
                background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer',
              }}
            >
              <Icon name="local_gas_station" size={16} style={{ color: FUEL_CLR }} />
              Record Receipt
            </button>
            <button
              onClick={() => setPage('fuel_issues')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 500,
                background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              <Icon name="output" size={16} style={{ color: '#fff' }} />
              Issue Fuel
            </button>
          </div>
        }
      />

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <StatCard label="Active Tanks"       value={activeTanks.length}          icon="propane_tank"       />
        <StatCard label="Total Stock"        value={`${totalStock.toFixed(0)} L`} icon="water_full"         />
        <StatCard label="Received This Month" value={`${totalReceived.toFixed(0)} L`} icon="arrow_downward" color={THEME.success} />
        <StatCard label="Issued This Month"  value={`${totalIssued.toFixed(0)} L`}  icon="arrow_upward"    color={THEME.warning} />
      </div>

      {/* Tank cards */}
      {activeTanks.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 24px',
          background: THEME.surface, borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`,
          marginBottom: '24px',
        }}>
          <Icon name="propane_tank" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <p style={{ color: THEME.textLow, fontSize: '14px', margin: '0 0 16px' }}>No tanks configured yet.</p>
          <button
            onClick={() => setPage('fuel_tanks')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 20px', borderRadius: '20px', fontSize: '13px', fontWeight: 500,
              background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >
            <Icon name="add" size={16} style={{ color: '#fff' }} />
            Add First Tank
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Tank Levels
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px', marginBottom: '24px' }}>
            {activeTanks.map(tank => (
              <TankCard
                key={tank.id}
                tank={tank}
                balance={tankBalance(tank.id)}
                dip={latestDip(tank.id)}
                setPage={setPage}
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            {recent.map((item, idx) => {
              const isReceipt = item._type === 'receipt'
              const tankName  = tanks.find(t => t.id === item.tank_id)?.name || '—'
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 0',
                    borderBottom: idx < recent.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                  }}
                >
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                    background: isReceipt ? THEME.statusSuccessBg : THEME.statusWarningBg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon
                      name={isReceipt ? 'arrow_downward' : 'arrow_upward'}
                      size={16}
                      style={{ color: isReceipt ? THEME.statusSuccessText : THEME.statusWarningText }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: THEME.text, fontWeight: 500 }}>
                      {isReceipt
                        ? `Received ${Number(item.quantity_litres).toFixed(0)} L`
                        : `Issued ${Number(item.quantity_litres).toFixed(0)} L to ${item.asset_name}`
                      }
                    </div>
                    <div style={{ fontSize: '11px', color: THEME.textLow }}>
                      {tankName} · {fmtDate(item._date)}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '13px', fontWeight: 600,
                    color: isReceipt ? THEME.statusSuccessText : THEME.statusWarningText,
                    flexShrink: 0,
                  }}>
                    {isReceipt ? '+' : '-'}{Number(item.quantity_litres).toFixed(0)} L
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
