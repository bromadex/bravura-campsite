import { THEME } from '../../../utils/permissions'
import { ROOM_STATUS_COLORS } from './geometry'

// ── Colour legend explaining room status indicators ───────────────────────────
export default function FloorplanLegend() {
  const items = [
    { key: 'available',   label: 'Available' },
    { key: 'partial',     label: 'Partially Occupied' },
    { key: 'full',        label: 'Full' },
    { key: 'maintenance', label: 'Maintenance' },
  ]
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
      {items.map(item => {
        const c = ROOM_STATUS_COLORS[item.key]
        return (
          <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '4px', background: c.fill, border: `2px solid ${c.stroke}` }} />
            <span style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 500 }}>{item.label}</span>
          </div>
        )
      })}
    </div>
  )
}
