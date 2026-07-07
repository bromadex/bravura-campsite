import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const PILLS = [
  { id: 'fuel_tanks',               label: 'Tanks',         icon: 'water',             color: '#0277BD' },
  { id: 'fuel_receipts',            label: 'Deliveries',    icon: 'local_shipping',    color: '#2E7D32' },
  { id: 'fuel_issuance',            label: 'Issuance',      icon: 'local_gas_station', color: '#E65100' },
  { id: 'fuel_dips',                label: 'Dipstick Log',  icon: 'straighten',        color: '#00838F' },
  { id: 'fuel_transactions',        label: 'Transactions',  icon: 'receipt_long',      color: '#4527A0' },
  { id: 'fuel_reports',             label: 'Reports',       icon: 'bar_chart',         color: '#E53935' },
  { id: 'fuel_vehicle_consumption', label: 'Consumption',   icon: 'speed',             color: '#1565C0' },
  { id: 'fuel_forecasting',         label: 'Forecasting',   icon: 'trending_up',       color: '#00897B' },
  { id: 'fuel_reconciliation',      label: 'Reconciliation',icon: 'balance',           color: '#7C3AED' },
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
