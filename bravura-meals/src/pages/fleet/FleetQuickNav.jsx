import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon } from '../../components/ui'

const FLEET_CLR = MODULE_COLORS.fleet

const PILLS = [
  { id: 'fleet_assets',      label: 'Assets',       icon: 'inventory_2',    color: '#1A6B52' },
  { id: 'fleet_assignments', label: 'Assignments',   icon: 'assignment_ind', color: '#2E7D32' },
  { id: 'fleet_inspections', label: 'Inspections',   icon: 'checklist',      color: '#0277BD' },
  { id: 'fleet_trips',       label: 'Trip Logs',     icon: 'route',          color: '#E65100' },
  { id: 'fleet_maintenance', label: 'Maintenance',   icon: 'build',          color: '#6D4C41' },
  { id: 'fleet_compliance',  label: 'Compliance',    icon: 'verified_user',  color: '#00838F' },
  { id: 'fleet_reports',     label: 'Reports',       icon: 'bar_chart',      color: '#E53935' },
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
