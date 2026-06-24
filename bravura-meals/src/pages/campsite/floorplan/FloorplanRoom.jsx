import { ROOM_STATUS_COLORS, getRoomOccupancyStatus, roomOccupancy } from './geometry'

// ── A single room on the floorplan ────────────────────────────────────────────
// Renders the room rectangle, door opening + swing arc, room number label,
// and an occupancy badge. Fully interactive: click, hover, drag-drop target.
export default function FloorplanRoom({
  room,
  activeAssignments,
  isSelected,
  isDragOver,
  onClick,
  onHoverChange,
  onDrop,
  onDragOver,
  draggable = true,
}) {
  const status = getRoomOccupancyStatus(room, activeAssignments)
  const colors = ROOM_STATUS_COLORS[status]
  const occ    = roomOccupancy(room, activeAssignments)

  const { pos_x: x, pos_y: y, width: w, height: h, door_side } = room
  if (x == null || y == null || w == null || h == null) return null // ungeometered room — skip

  // Door opening dimensions (a gap in the wall + swing arc)
  const doorWidth = Math.min(900, w * 0.4)
  const doorX = x + (w - doorWidth) / 2

  // Door arc path depends which wall it's on
  let doorArc = null
  if (door_side === 'bottom') {
    doorArc = `M ${doorX} ${y + h} A ${doorWidth} ${doorWidth} 0 0 0 ${doorX + doorWidth} ${y + h - doorWidth}`
  } else if (door_side === 'top') {
    doorArc = `M ${doorX} ${y} A ${doorWidth} ${doorWidth} 0 0 1 ${doorX + doorWidth} ${y + doorWidth}`
  } else if (door_side === 'left') {
    doorArc = `M ${x} ${y + (h - doorWidth) / 2} A ${doorWidth} ${doorWidth} 0 0 1 ${x + doorWidth} ${y + (h - doorWidth) / 2 + doorWidth}`
  } else if (door_side === 'right') {
    doorArc = `M ${x + w} ${y + (h - doorWidth) / 2} A ${doorWidth} ${doorWidth} 0 0 0 ${x + w - doorWidth} ${y + (h - doorWidth) / 2 + doorWidth}`
  }

  const labelFontSize = Math.min(w, h) * 0.22
  const subFontSize   = Math.min(w, h) * 0.11

  return (
    <g
      className="floorplan-room"
      style={{ cursor: 'pointer' }}
      onClick={() => onClick(room)}
      onMouseEnter={() => onHoverChange(room)}
      onMouseLeave={() => onHoverChange(null)}
      onDragOver={e => { e.preventDefault(); onDragOver?.(room) }}
      onDrop={e => { e.preventDefault(); onDrop?.(room) }}
    >
      {/* Room rectangle */}
      <rect
        x={x} y={y} width={w} height={h}
        fill={isDragOver ? '#FFF9C4' : colors.fill}
        stroke={isSelected ? '#1A73E8' : colors.stroke}
        strokeWidth={isSelected ? 60 : 28}
        rx={20}
      />

      {/* Door gap mask — draw a white rectangle over the wall where the door is to "cut" it visually */}
      {door_side === 'bottom' && (
        <rect x={doorX} y={y + h - 14} width={doorWidth} height={28} fill={colors.fill} />
      )}
      {door_side === 'top' && (
        <rect x={doorX} y={y - 14} width={doorWidth} height={28} fill={colors.fill} />
      )}
      {door_side === 'left' && (
        <rect x={x - 14} y={y + (h - doorWidth) / 2} width={28} height={doorWidth} fill={colors.fill} />
      )}
      {door_side === 'right' && (
        <rect x={x + w - 14} y={y + (h - doorWidth) / 2} width={28} height={doorWidth} fill={colors.fill} />
      )}

      {/* Door swing arc */}
      {doorArc && (
        <path d={doorArc} fill="none" stroke={colors.stroke} strokeWidth={14} opacity={0.55} />
      )}

      {/* Room number */}
      <text
        x={x + w / 2} y={y + h / 2 - subFontSize * 0.6}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={labelFontSize} fontWeight="700"
        fill={colors.label}
        style={{ fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", userSelect: 'none' }}
      >
        {room.room_number}
      </text>

      {/* Occupancy badge */}
      <text
        x={x + w / 2} y={y + h / 2 + subFontSize * 1.3}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={subFontSize} fontWeight="600"
        fill={colors.label} opacity={0.85}
        style={{ fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", userSelect: 'none' }}
      >
        {occ} / {room.capacity}
      </text>

      {/* Maintenance icon overlay */}
      {room.is_maintenance && (
        <text
          x={x + w - subFontSize} y={y + subFontSize * 1.4}
          textAnchor="middle" dominantBaseline="middle"
          fontSize={subFontSize * 1.4} fill={colors.label}
          style={{ fontFamily: 'Material Symbols Rounded' }}
        >
          build
        </text>
      )}
    </g>
  )
}
