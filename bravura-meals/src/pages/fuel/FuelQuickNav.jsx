import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const PILLS = [
  { id: 'fuel_forecasting',         label: 'Forecasting',  icon: 'trending_up',       color: '#00897B' },
  { id: 'fuel_reports',             label: 'Reports',       icon: 'bar_chart',         color: '#E53935' },
  { id: 'fuel_vehicle_consumption', label: 'Consumption',   icon: 'speed',             color: '#1565C0' },
  { id: 'fuel_reconciliation',      label: 'Reconciliation',icon: 'balance',           color: '#7C3AED' },
  { id: 'fuel_shift_report',        label: 'Shifts',        icon: 'summarize',         color: '#F57C00' },
]

export default function FuelQuickNav({ setPage, current }) {
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
