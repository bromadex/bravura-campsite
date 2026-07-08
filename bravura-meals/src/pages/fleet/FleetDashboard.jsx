import { useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import FleetQuickNav from './FleetQuickNav'

const color = MODULE_COLORS.fleet

function KpiCard({ icon, label, value, sub, accent }) {
  const c = accent || color
  return (
    <div style={{
      background: THEME.surface, borderRadius: '14px', padding: '18px',
      border: `1px solid ${THEME.outlineVar}`, flex: '1 1 160px', minWidth: '160px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '10px',
          background: c + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '20px', color: c }}>{icon}</span>
        </div>
        <div style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 600 }}>{label}</div>
      </div>
      <div style={{ fontSize: '26px', fontWeight: 600, color: THEME.text }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

function AlertRow({ icon, text, accent }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
      borderRadius: '10px', background: (accent || THEME.warning) + '12',
      border: `1px solid ${(accent || THEME.warning) + '30'}`,
    }}>
      <span className="material-symbols-rounded" style={{ fontSize: '18px', color: accent || THEME.warning }}>{icon}</span>
      <div style={{ fontSize: '12px', color: THEME.text, flex: 1 }}>{text}</div>
    </div>
  )
}

export default function FleetDashboard({ setPage }) {
  const { assets, assetsByStatus, activeAssignments, expiringCompliance, workOrders, loading } = useFleet()

  const openWorkOrders = useMemo(() =>
    workOrders.filter(w => w.status === 'open' || w.status === 'in_progress'),
    [workOrders]
  )

  const alerts = useMemo(() => {
    const list = []
    const grounded = assets.filter(a => a.status === 'grounded')
    if (grounded.length > 0) {
      list.push({ icon: 'block', text: `${grounded.length} asset${grounded.length > 1 ? 's' : ''} grounded`, accent: '#E53935' })
    }
    const maint = assets.filter(a => a.status === 'maintenance')
    if (maint.length > 0) {
      list.push({ icon: 'build', text: `${maint.length} asset${maint.length > 1 ? 's' : ''} in maintenance`, accent: '#E65100' })
    }
    if (expiringCompliance.length > 0) {
      list.push({ icon: 'warning', text: `${expiringCompliance.length} compliance item${expiringCompliance.length > 1 ? 's' : ''} expiring within 30 days`, accent: '#D97706' })
    }
    if (openWorkOrders.length > 0) {
      list.push({ icon: 'assignment', text: `${openWorkOrders.length} open work order${openWorkOrders.length > 1 ? 's' : ''}`, accent: '#0277BD' })
    }
    return list
  }, [assets, expiringCompliance, openWorkOrders])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_dashboard" />

      {/* Hero */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '20px',
        background: THEME.surface, borderRadius: '14px',
        padding: '28px', marginBottom: '20px',
        border: `1px solid ${THEME.outlineVar}`,
      }}>
        <div style={{
          width: '56px', height: '56px', borderRadius: '16px', flexShrink: 0,
          background: color + '22',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '28px', color }}>directions_car</span>
        </div>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Fleet Management</div>
          <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>
            {assets.length} total asset{assets.length !== 1 ? 's' : ''} · {assetsByStatus.operational || 0} operational
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <KpiCard icon="inventory_2" label="Total Assets" value={assets.length} sub={`${assetsByStatus.operational || 0} operational`} />
        <KpiCard icon="assignment_ind" label="Active Assignments" value={activeAssignments.length} accent="#2E7D32" />
        <KpiCard icon="build" label="In Maintenance" value={assetsByStatus.maintenance || 0} accent="#E65100" />
        <KpiCard icon="block" label="Grounded" value={assetsByStatus.grounded || 0} accent="#E53935" />
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
            Alerts
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {alerts.map((a, i) => <AlertRow key={i} {...a} />)}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
          Quick Actions
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { page: 'fleet_assets',      icon: 'inventory_2',    label: 'Asset Registry',  desc: 'View and manage all fleet assets — vehicles, equipment, generators' },
            { page: 'fleet_assignments',  icon: 'assignment_ind', label: 'Assignments',     desc: 'Assign assets to operators and projects' },
            { page: 'fleet_inspections',  icon: 'checklist',      label: 'Inspections',     desc: 'Pre-trip and periodic inspection checklists' },
            { page: 'fleet_trips',        icon: 'route',          label: 'Trip Logs',       desc: 'Mileage, operating hours and trip tracking' },
            { page: 'fleet_maintenance',  icon: 'build',          label: 'Maintenance',     desc: 'Work orders, service schedules and history' },
            { page: 'fleet_compliance',   icon: 'verified_user',  label: 'Compliance',      desc: 'Licence, insurance and COF expiry tracking' },
          ].map(item => (
            <div
              key={item.page}
              onClick={() => setPage(item.page)}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                background: THEME.surface, borderRadius: '14px', padding: '14px 20px',
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer',
                transition: 'box-shadow .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
            >
              <div style={{
                width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                background: color + '18',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>{item.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text }}>{item.label}</div>
                <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{item.desc}</div>
              </div>
              <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.textLow }}>chevron_right</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
