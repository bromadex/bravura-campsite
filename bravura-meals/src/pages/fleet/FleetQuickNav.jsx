import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon } from '../../components/ui'

const FLEET_CLR = MODULE_COLORS.fleet

const PILLS = [
  { id: 'fleet_vehicles',    label: 'Vehicles',      icon: 'directions_car', color: '#1A6B52' },
  { id: 'fleet_equipment',   label: 'Equipment',     icon: 'construction',   color: '#5D4037' },
  { id: 'fleet_generators',  label: 'Generators',    icon: 'bolt',           color: '#E65100' },
  { id: 'fleet_assets',      label: 'All Assets',    icon: 'inventory_2',    color: '#455A64' },
  { id: 'fleet_assignments', label: 'Assignments',   icon: 'assignment_ind', color: '#2E7D32' },
  { id: 'fleet_inspections', label: 'Inspections',   icon: 'checklist',      color: '#0277BD' },
  { id: 'fleet_trips',       label: 'Trip Logs',     icon: 'route',          color: '#6A1B9A' },
  { id: 'fleet_maintenance', label: 'Maintenance',   icon: 'build',          color: '#6D4C41' },
  { id: 'fleet_compliance',  label: 'Compliance',    icon: 'verified_user',  color: '#00838F' },
  { id: 'fleet_drivers',     label: 'Drivers',       icon: 'badge',          color: '#1565C0' },
  { id: 'fleet_meter_readings', label: 'Meters',     icon: 'speed',          color: '#4527A0' },
  { id: 'fleet_accidents',   label: 'Accidents',     icon: 'car_crash',      color: '#C62828' },
  { id: 'fleet_reports',     label: 'Reports',       icon: 'bar_chart',      color: '#E53935' },
  { id: 'fleet_settings',    label: 'Settings',      icon: 'settings',       color: '#546E7A' },
]

export default function FleetQuickNav({ setPage, current }) {
  if (!setPage) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
      {PILLS.map(p => {
        const active = current === p.id
        return (
          <button
            key={p.id}
            onClick={() => setPage(p.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
              background: active ? p.color : p.color + '14',
              color: active ? '#fff' : p.color,
              border: `1px solid ${active ? p.color : p.color + '40'}`,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all .15s',
            }}
          >
            <Icon name={p.icon} size={14} style={{ color: 'inherit' }} />
            {p.label}
          </button>
        )
      })}
    </div>
  )
}
