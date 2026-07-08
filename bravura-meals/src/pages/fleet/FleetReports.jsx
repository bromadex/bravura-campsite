import { useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'

const color = MODULE_COLORS.fleet

const STATUS_COLORS = {
  operational:    { bg: THEME.statusSuccessBg,   text: THEME.statusSuccessText, bar: '#22c55e' },
  maintenance:    { bg: THEME.statusWarningBg,   text: THEME.statusWarningText, bar: '#f59e0b' },
  grounded:       { bg: THEME.statusErrorBg,     text: THEME.statusErrorText,   bar: '#ef4444' },
  awaiting_parts: { bg: THEME.statusTertiaryBg,  text: THEME.statusTertiaryText, bar: '#8b5cf6' },
  decommissioned: { bg: THEME.statusNeutralBg,   text: THEME.statusNeutralText, bar: '#9ca3af' },
}

const REPORT_CARDS = [
  { icon: 'bar_chart',      title: 'Fleet Utilisation',    desc: 'Asset utilisation by department, project, period' },
  { icon: 'payments',       title: 'Cost Analysis',        desc: 'TCO breakdown, maintenance costs per asset' },
  { icon: 'timer_off',      title: 'Downtime Report',      desc: 'MTBF/MTTR analysis, downtime by asset' },
  { icon: 'route',          title: 'Trip Summary',         desc: 'Distance, fuel consumption, driver performance' },
  { icon: 'build',          title: 'Maintenance Summary',  desc: 'Work orders by status, priority, asset' },
  { icon: 'verified_user',  title: 'Compliance Status',    desc: 'Expiry tracking, renewal forecasts' },
  { icon: 'fact_check',     title: 'Inspection Summary',   desc: 'Pass/fail rates, trends by asset type' },
  { icon: 'history',        title: 'Assignment History',   desc: 'Operator assignments over time' },
]

export default function FleetReports({ setPage }) {
  const { can } = usePermissions()
  const {
    assets, assignments, inspections, workOrders, trips, compliance,
    vehicles, heavyEquipment, generators, assetsByStatus,
    activeAssignments, expiringCompliance, loading,
  } = useFleet()

  const summary = useMemo(() => {
    const allAssets = assets || []
    const totalAssets = allAssets.length
    const vCount = (vehicles || []).length
    const eCount = (heavyEquipment || []).length
    const gCount = (generators || []).length

    const activeCount = (activeAssignments || []).length
    const utilisationRate = totalAssets > 0 ? Math.round((activeCount / totalAssets) * 100) : 0

    const allCompliance = compliance || []
    const validCompliance = allCompliance.filter(c => {
      if (!c.expiry_date) return false
      return new Date(c.expiry_date) > new Date()
    }).length
    const complianceRate = allCompliance.length > 0 ? Math.round((validCompliance / allCompliance.length) * 100) : 0

    const allInspections = inspections || []
    const passed = allInspections.filter(i => i.result === 'pass' || i.status === 'passed').length
    const inspectionRate = allInspections.length > 0 ? Math.round((passed / allInspections.length) * 100) : 0

    return { totalAssets, vCount, eCount, gCount, utilisationRate, complianceRate, inspectionRate }
  }, [assets, vehicles, heavyEquipment, generators, activeAssignments, compliance, inspections])

  const statusDistribution = useMemo(() => {
    const dist = {}
    ;(assets || []).forEach(a => {
      const s = a.status || 'operational'
      dist[s] = (dist[s] || 0) + 1
    })
    return dist
  }, [assets])

  const totalForBar = useMemo(() => {
    return Object.values(statusDistribution).reduce((a, b) => a + b, 0)
  }, [statusDistribution])

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '40px', color, animation: 'spin 1s linear infinite' }}>progress_activity</span>
        <p style={{ marginTop: '12px' }}>Loading fleet reports...</p>
      </div>
    )
  }

  const cardBase = {
    background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outline}`,
    padding: '20px', display: 'flex', flexDirection: 'column',
  }

  return (
    <div style={{ padding: '0' }}>
      <FleetQuickNav setPage={setPage} current="fleet_reports" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '12px', background: `${color}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>analytics</span>
        </div>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, margin: 0 }}>Fleet Reports</h2>
          <p style={{ fontSize: '13px', color: THEME.textLow, margin: 0 }}>Summary analytics and report hub</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        {[
          {
            icon: 'directions_car', label: 'Total Fleet Size', value: summary.totalAssets,
            sub: `${summary.vCount} vehicles, ${summary.eCount} equipment, ${summary.gCount} generators`,
          },
          {
            icon: 'speed', label: 'Utilisation Rate', value: `${summary.utilisationRate}%`,
            sub: `${(activeAssignments || []).length} active of ${(assets || []).length} assets`,
          },
          {
            icon: 'verified_user', label: 'Compliance Rate', value: `${summary.complianceRate}%`,
            sub: `${(compliance || []).length} total compliance records`,
          },
          {
            icon: 'fact_check', label: 'Inspection Pass Rate', value: `${summary.inspectionRate}%`,
            sub: `${(inspections || []).length} total inspections`,
          },
        ].map((card, i) => (
          <div key={i} style={{ ...cardBase }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px', background: `${color}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>{card.icon}</span>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textLow }}>{card.label}</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: THEME.text, marginBottom: '4px' }}>{card.value}</div>
            <div style={{ fontSize: '12px', color: THEME.textLow }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Report Cards Grid */}
      <h3 style={{ fontSize: '16px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Available Reports</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        {REPORT_CARDS.map((r, i) => (
          <div key={i} style={{
            ...cardBase, cursor: 'pointer', transition: 'box-shadow 0.15s',
          }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = `0 2px 12px ${color}22`}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '10px', background: `${color}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>{r.icon}</span>
              </div>
              <span style={{ fontSize: '15px', fontWeight: 700, color: THEME.text }}>{r.title}</span>
            </div>
            <p style={{ fontSize: '13px', color: THEME.textLow, margin: '0 0 14px 0', flex: 1 }}>{r.desc}</p>
            <button
              onClick={() => alert('Coming soon')}
              style={{
                alignSelf: 'flex-start', padding: '6px 18px', borderRadius: '8px',
                background: `${color}14`, color, border: 'none', cursor: 'pointer',
                fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>visibility</span>
              View
            </button>
          </div>
        ))}
      </div>

      {/* Asset Status Distribution */}
      <h3 style={{ fontSize: '16px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Asset Status Distribution</h3>
      <div style={{ ...cardBase, marginBottom: '24px' }}>
        {/* Bar chart */}
        <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', height: '32px', marginBottom: '16px', background: THEME.background }}>
          {Object.entries(statusDistribution).map(([status, count]) => {
            const pct = totalForBar > 0 ? (count / totalForBar) * 100 : 0
            if (pct === 0) return null
            const sc = STATUS_COLORS[status] || STATUS_COLORS.operational
            return (
              <div key={status} title={`${status}: ${count}`} style={{
                width: `${pct}%`, background: sc.bar, minWidth: pct > 0 ? '4px' : 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: '11px', fontWeight: 700,
                transition: 'width 0.3s',
              }}>
                {pct >= 8 ? `${Math.round(pct)}%` : ''}
              </div>
            )
          })}
        </div>

        {/* Legend / table */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {Object.entries(statusDistribution).map(([status, count]) => {
            const sc = STATUS_COLORS[status] || STATUS_COLORS.operational
            const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            return (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: sc.bar }} />
                <span style={{ color: THEME.text, fontWeight: 600 }}>{label}</span>
                <span style={{ color: THEME.textLow }}>{count}</span>
              </div>
            )
          })}
        </div>

        {totalForBar === 0 && (
          <p style={{ color: THEME.textLow, fontSize: '13px', textAlign: 'center', margin: '12px 0 0' }}>No asset data available</p>
        )}
      </div>
    </div>
  )
}
