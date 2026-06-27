import { useCampsite } from '../../contexts/CampsiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Icon } from '../../components/ui'

const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457']

function KPICard({ label, value, icon, color, sub }) {
  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '16px', padding: '20px',
      borderTop: `4px solid ${color || THEME.primary}`,
      boxShadow: '0 1px 3px rgba(0,0,0,.05)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '8px' }}>
            {label}
          </div>
          <div style={{ fontSize: '36px', fontWeight: 300, color: color || THEME.primary, lineHeight: 1 }}>
            {value}
          </div>
          {sub && <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '6px' }}>{sub}</div>}
        </div>
        {icon && (
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: (color || THEME.primary) + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={icon} size={22} style={{ color: color || THEME.primary }} />
          </div>
        )}
      </div>
    </div>
  )
}

export default function CampHeadcount() {
  const { kpis, employees, contractors, assignments, loading } = useCampsite()

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px', color: THEME.textLow, gap: '10px' }}>
      <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} /> Loading…
    </div>
  )

  // Contractor breakdown
  const contractorMap = {}
  contractors.forEach(c => { contractorMap[c.id] = c })
  const coBreakdown = contractors.map((c, i) => {
    const empCount = employees.filter(e => e.contractor_id === c.id).length
    const resCount = assignments.filter(a =>
      a.status === 'active' &&
      a.employee?.contractor_id === c.id
    ).length
    return { ...c, empCount, resCount, color: CO_COLORS[i % CO_COLORS.length] }
  }).filter(c => c.empCount > 0)

  const occupancyBar = Math.min(kpis.occupancyPct, 100)
  const occupancyColor = occupancyBar > 90 ? THEME.error : occupancyBar > 70 ? THEME.warning : THEME.success

  return (
    <div className="print-page">

      {/* Print header */}
      <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
        <div style={{ borderBottom: `3px solid ${THEME.primary}`, paddingBottom: '10px', marginBottom: '12px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.primary }}>Bravura Zimbabwe Ltd — Kamativi Mine Site</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>Camp Headcount Report</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>Printed: {new Date().toLocaleString('en-GB')}</div>
        </div>
      </div>

      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>Headcount Dashboard</h2>
        <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: THEME.surfaceVar, border: `1px solid ${THEME.outline}`, borderRadius: '20px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: THEME.primary, fontFamily: 'inherit' }}>
          <Icon name="print" size={16} style={{ color: THEME.primary }} /> Print
        </button>
      </div>

      {/* Main KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '14px', marginBottom: '24px' }}>
        <KPICard label="Total Employees"     value={kpis.totalEmployees}   icon="badge"          color={THEME.primary} />
        <KPICard label="Total Contractors"   value={kpis.totalContractors} icon="business"       color="#1558A6" />
        <KPICard label="Camp Residents"      value={kpis.totalResidents}   icon="hotel"          color="#1A6B52" />
        <KPICard label="Occupied Rooms"      value={kpis.occupiedRooms}    icon="door_front"     color={THEME.error} />
        <KPICard label="Available Rooms"     value={kpis.availableRooms}   icon="meeting_room"   color={THEME.success} />
        <KPICard label="Maintenance Rooms"   value={kpis.maintenanceRooms} icon="construction"   color={THEME.warning} />
        <KPICard label="On Short Leave"      value={kpis.onShortLeave}     icon="schedule"       color={THEME.warning} sub="Room kept" />
        <KPICard label="On Long Leave"       value={kpis.onLongLeave}      icon="flight_takeoff" color="#5E35B1" sub="Room released" />
        <KPICard
          label="Occupancy Rate"
          value={`${kpis.occupancyPct}%`}
          icon="percent"
          color={occupancyColor}
          sub={`${kpis.occupiedRooms} of ${kpis.totalRooms} rooms`}
        />
      </div>

      {/* Occupancy bar */}
      <Card style={{ marginBottom: '20px', padding: '20px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text }}>Room Occupancy</div>
          <div style={{ fontSize: '20px', fontWeight: 300, color: occupancyColor }}>{kpis.occupancyPct}%</div>
        </div>
        <div style={{ height: '12px', background: THEME.outlineVar, borderRadius: '6px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: '6px',
            width: `${occupancyBar}%`,
            background: occupancyColor,
            transition: 'width .6s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: THEME.textLow }}>
          <span>{kpis.occupiedRooms} occupied</span>
          <span>{kpis.availableRooms} available</span>
          <span>{kpis.totalRooms} total</span>
        </div>
      </Card>

      {/* By contractor */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <Card elevated>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Icon name="business" size={18} style={{ color: THEME.primary }} />
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Headcount by Contractor</div>
          </div>
          {coBreakdown.length === 0 ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>No contractors with active employees.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {coBreakdown.map(co => {
                const pct = kpis.totalEmployees > 0 ? Math.round(co.empCount / kpis.totalEmployees * 100) : 0
                return (
                  <div key={co.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{co.name}</span>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '12px' }}>
                        <span style={{ color: THEME.textMed }}>{co.empCount} emp</span>
                        <span style={{ color: co.color, fontWeight: 600 }}>{co.resCount} resident</span>
                      </div>
                    </div>
                    <div style={{ height: '6px', background: THEME.outlineVar, borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: co.color, borderRadius: '3px', transition: 'width .4s' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card elevated>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <Icon name="transfer_within_a_station" size={18} style={{ color: THEME.primary }} />
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Leave Status Summary</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              { label: 'Active on Site',   value: employees.filter(e => e.status === 'active').length,            color: THEME.success,  icon: 'check_circle' },
              { label: 'Short Leave',      value: kpis.onShortLeave,                                              color: THEME.warning,  icon: 'schedule' },
              { label: 'Long Leave',       value: kpis.onLongLeave,                                               color: THEME.statusTertiaryText,      icon: 'flight_takeoff' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: THEME.surfaceVar, borderRadius: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icon name={row.icon} size={16} style={{ color: row.color }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{row.label}</span>
                </div>
                <span style={{ fontSize: '18px', fontWeight: 600, color: row.color }}>{row.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
