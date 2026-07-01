import { THEME } from '../../../utils/permissions'
import { ROOM_STATUS_COLORS, getRoomOccupancyStatus, roomOccupancy } from './geometry'
import { Icon } from '../../../components/ui'

// ── Hover tooltip shown over a room without clicking ──────────────────────────
export default function RoomTooltip({ room, activeAssignments, employees, mouseX, mouseY }) {
  if (!room) return null

  // Fixture hover (ablution/entrance) — simpler card
  if (!room.room_number) {
    return (
      <div style={{
        position: 'fixed', left: mouseX + 16, top: mouseY + 16, zIndex: 2000,
        background: THEME.sidebar, color: '#fff', padding: '8px 12px',
        borderRadius: '10px', fontSize: '12px', fontWeight: 500,
        pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,.25)',
        whiteSpace: 'nowrap',
      }}>
        {room.label || (room.fixture_type === 'ablution' ? 'Ablution Facility' : 'Entrance')}
      </div>
    )
  }

  const status = getRoomOccupancyStatus(room, activeAssignments)
  const colors = ROOM_STATUS_COLORS[status]
  const occ    = roomOccupancy(room, activeAssignments)
  const occupants = activeAssignments.filter(a => a.room_id === room.id)

  const statusLabel = { available: 'Available', partial: 'Partially Occupied', full: 'Full', maintenance: 'Maintenance' }[status]

  return (
    <div style={{
      position: 'fixed', left: mouseX + 16, top: mouseY + 16, zIndex: 2000,
      background: THEME.surface, borderRadius: '14px', padding: '14px 16px',
      minWidth: '220px', boxShadow: '0 8px 28px rgba(0,0,0,.22)',
      border: `1px solid ${THEME.outlineVar}`, pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: THEME.text }}>Room {room.room_number}</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '3px 9px', borderRadius: '6px',
          background: colors.fill, color: colors.label, fontSize: '11px', fontWeight: 600,
        }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: colors.dot }} />
          {statusLabel}
        </div>
      </div>

      <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <Icon name="bed" size={14} style={{ color: THEME.textLow }} />
        {occ} / {room.capacity} occupied
      </div>

      {room.gender && room.gender !== 'unassigned' && (
        <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name={room.gender === 'male' ? 'man' : 'woman'} size={14} style={{ color: THEME.textLow }} />
          {room.gender === 'male' ? 'Male' : 'Female'} room
        </div>
      )}

      {occupants.length > 0 && (
        <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: `1px solid ${THEME.outlineVar}` }}>
          {occupants.slice(0, 3).map(a => (
            <div key={a.id} style={{ fontSize: '12px', color: THEME.text, marginBottom: '2px' }}>
              • {a.employee?.name || a.visitor?.name || 'Occupant'}
              {a.employee?.contractor?.short_code && (
                <span style={{ color: THEME.textLow }}> ({a.employee.contractor.short_code})</span>
              )}
            </div>
          ))}
          {occupants.length > 3 && (
            <div style={{ fontSize: '11px', color: THEME.textLow }}>+{occupants.length - 3} more</div>
          )}
        </div>
      )}

      {status === 'maintenance' && room.maintenance_reason && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: colors.label }}>
          {room.maintenance_reason}
        </div>
      )}
    </div>
  )
}
