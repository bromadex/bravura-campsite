import { FIXTURE_STYLES, crossDoorSwingPaths } from './geometry'

// ── Non-assignable building elements ──────────────────────────────────────────
// Toilets/ablutions, corridors, entrances, and cross-corridor double-swing doors.
// These render behind the rooms and are never clickable for assignment —
// only an info tooltip on hover (handled by parent via onHoverChange).
export default function FloorplanFixtures({ fixtures, onHoverChange }) {
  return (
    <g className="floorplan-fixtures">
      {fixtures.map(fx => {
        const style = FIXTURE_STYLES[fx.fixture_type] || FIXTURE_STYLES.wall
        const { pos_x: x, pos_y: y, width: w, height: h } = fx

        if (fx.fixture_type === 'corridor') {
          return (
            <rect
              key={fx.id}
              x={x} y={y} width={w} height={h}
              fill={style.fill} stroke={style.stroke} strokeWidth={8}
              opacity={0.6}
            />
          )
        }

        if (fx.fixture_type === 'door_swing') {
          const [leftLeaf, rightLeaf] = crossDoorSwingPaths(x, y, w, h)
          return (
            <g key={fx.id}>
              <path d={leftLeaf}  fill="none" stroke={style.stroke} strokeWidth={14} />
              <path d={rightLeaf} fill="none" stroke={style.stroke} strokeWidth={14} />
            </g>
          )
        }

        if (fx.fixture_type === 'entrance') {
          // Simple arrow/chevron marker pointing into the building
          const cx = x + w / 2
          const cy = y + h / 2
          return (
            <g key={fx.id} onMouseEnter={() => onHoverChange?.(fx)} onMouseLeave={() => onHoverChange?.(null)}>
              <path
                d={`M ${cx - 230} ${cy} L ${cx} ${cy + 230} L ${cx + 230} ${cy}`}
                fill="none" stroke={style.stroke} strokeWidth={40} strokeLinecap="round" strokeLinejoin="round"
              />
            </g>
          )
        }

        // ablution / toilet cubicles
        return (
          <g
            key={fx.id}
            onMouseEnter={() => onHoverChange?.(fx)}
            onMouseLeave={() => onHoverChange?.(null)}
            style={{ cursor: 'default' }}
          >
            <rect
              x={x} y={y} width={w} height={h}
              fill={style.fill} stroke={style.stroke} strokeWidth={20}
              rx={10}
            />
            {/* Door arc for the cubicle, hinged at left edge swinging in */}
            <path
              d={`M ${x} ${y} A ${h} ${h} 0 0 1 ${x + h} ${y + h}`}
              fill="none" stroke={style.stroke} strokeWidth={10} opacity={0.45}
            />
            {/* Small label */}
            <text
              x={x + w / 2} y={y + h / 2}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={Math.min(w, h) * 0.35}
              fill={style.stroke} fontWeight="600"
              style={{ fontFamily: 'Material Symbols Rounded', userSelect: 'none' }}
            >
              {fx.fixture_type === 'ablution' ? 'shower' : 'wc'}
            </text>
          </g>
        )
      })}
    </g>
  )
}
