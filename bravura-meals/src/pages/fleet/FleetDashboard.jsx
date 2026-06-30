import { THEME, MODULE_COLORS } from '../../utils/permissions'

const color = MODULE_COLORS.fleet

export default function FleetDashboard({ setPage }) {
  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 0' }}>
      {/* Hero */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '20px',
        background: THEME.surface, borderRadius: '20px',
        padding: '32px', marginBottom: '28px',
        border: `1px solid ${THEME.outlineVar}`,
        boxShadow: THEME.shadow1,
      }}>
        <div style={{
          width: '64px', height: '64px', borderRadius: '18px', flexShrink: 0,
          background: color + '22',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '32px', color }}>
            directions_car
          </span>
        </div>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 500, color: THEME.text, lineHeight: 1.2 }}>
            Fleet Management
          </div>
          <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '6px' }}>
            Vehicle registry, assignments, maintenance and mileage tracking
          </div>
        </div>
      </div>

      {/* Available now */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
          Available now
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { page: 'fleet_vehicles',  icon: 'directions_car', label: 'Vehicles Registry',  desc: 'Manage your vehicle fleet — registration, fuel type, tank capacity and department assignments' },
            { page: 'fleet_equipment', icon: 'construction',   label: 'Equipment Registry', desc: 'Generators, compressors, drills and other fuel-consuming equipment' },
            { page: 'fleet_operators', icon: 'badge',          label: 'Operators',          desc: 'Licensed operators linked to HR employees — licence expiry tracking and alerts' },
          ].map(item => (
            <div
              key={item.page}
              onClick={() => setPage(item.page)}
              style={{
                display: 'flex', alignItems: 'center', gap: '14px',
                background: THEME.surface, borderRadius: '14px', padding: '16px 20px',
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer',
                transition: 'box-shadow .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
            >
              <div style={{
                width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
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

      {/* Coming soon */}
      <div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px' }}>
          Coming soon
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[
            { icon: 'assignment_ind', label: 'Assignments',     desc: 'Assign vehicles and equipment to drivers and projects' },
            { icon: 'build',          label: 'Maintenance',     desc: 'Service schedules, reminders and history' },
            { icon: 'route',          label: 'Mileage Logs',    desc: 'Trip logs and kilometre tracking' },
            { icon: 'bar_chart',      label: 'Fleet Reports',   desc: 'Utilisation, cost per km and downtime analytics' },
          ].map(item => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: '14px',
              background: THEME.surfaceVar, borderRadius: '14px', padding: '14px 20px',
              border: `1px solid ${THEME.outlineVar}`, opacity: 0.6,
            }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                background: THEME.outline + '22',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textLow }}>{item.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed }}>{item.label}</div>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px' }}>{item.desc}</div>
              </div>
              <div style={{
                fontSize: '10px', fontWeight: 600, color: THEME.textLow,
                background: THEME.outline + '22', borderRadius: '20px', padding: '3px 10px',
                letterSpacing: '.05em',
              }}>
                SOON
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
