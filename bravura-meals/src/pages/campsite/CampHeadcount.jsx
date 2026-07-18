import { useState } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader } from '../../components/ui'
import {
  computeViewBox,
  getRoomOccupancyStatus,
  roomOccupancy,
  ROOM_STATUS_COLORS,
} from './floorplan/geometry'
import RoomTooltip from './floorplan/RoomTooltip'
import QuickNav, { CAMPSITE_PILLS } from '../../components/QuickNav'

const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457']

// ── Compact KPI tile ──────────────────────────────────────────────────────────
function KPICard({ label, value, icon, color, sub }) {
  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '10px', padding: '16px 18px',
      boxShadow: '0 1px 2px rgba(0,0,0,.03)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '6px', whiteSpace: 'nowrap' }}>
            {label}
          </div>
          <div style={{ fontSize: '30px', fontWeight: 300, color: color || THEME.primary, lineHeight: 1 }}>
            {value}
          </div>
          {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>{sub}</div>}
        </div>
        {icon && (
          <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: (color || THEME.primary) + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={icon} size={18} style={{ color: color || THEME.primary }} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Small status chip ─────────────────────────────────────────────────────────
function Chip({ label, color }) {
  return (
    <div style={{
      padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
      background: color + '18', color, border: `1px solid ${color}30`,
    }}>
      {label}
    </div>
  )
}

// ── Read-only block floorplan minimap ─────────────────────────────────────────
function BlockMinimap({ block, rooms, assignments, onRoomHover, onRoomLeave }) {
  const activeAssignments = assignments.filter(a => a.status === 'active')
  const blockRooms = rooms.filter(r => r.block_id === block.id && r.pos_x != null)

  const boardW = Number(block.floorplan_width)  || 20000
  const boardH = Number(block.floorplan_height) || 10000
  const viewBox = computeViewBox(boardW, boardH)

  const occupied   = activeAssignments.filter(a => blockRooms.some(r => r.id === a.room_id)).length
  const totalBeds  = blockRooms.reduce((s, r) => s + (r.capacity || 0), 0)
  const available  = totalBeds - occupied
  const maintenance = blockRooms.filter(r => r.is_maintenance || r.room_type === 'maintenance').length
  const occPct     = totalBeds > 0 ? Math.round(occupied / totalBeds * 100) : 0
  const occColor   = occPct > 90 ? THEME.error : occPct > 70 ? THEME.warning : THEME.success

  return (
    <Card style={{ overflow: 'hidden', padding: 0 }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px', borderBottom: `1px solid ${THEME.outlineVar}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: THEME.surface,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: 38, height: 38, borderRadius: '10px', background: THEME.primary + '14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="apartment" size={20} style={{ color: THEME.primary }} />
          </div>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>{block.name}</div>
            <div style={{ fontSize: '11px', color: THEME.textLow }}>{blockRooms.length} rooms · {totalBeds} beds</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Chip label={`${occupied} occupied`}  color={THEME.error} />
          <Chip label={`${available} free`}     color={THEME.success} />
          {maintenance > 0 && <Chip label={`${maintenance} maint.`} color={THEME.warning} />}
          <Chip label={`${occPct}%`}            color={occColor} />
        </div>
      </div>

      {/* Occupancy progress bar */}
      <div style={{ height: '4px', background: THEME.outlineVar }}>
        <div style={{ height: '100%', width: `${Math.min(occPct, 100)}%`, background: occColor, transition: 'width .5s ease' }} />
      </div>

      {/* SVG canvas */}
      {blockRooms.length === 0 ? (
        <div style={{ padding: '48px 24px', textAlign: 'center', color: THEME.textLow, background: THEME.bg }}>
          <Icon name="view_in_ar" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
          <div style={{ fontSize: '13px' }}>No layout configured yet</div>
        </div>
      ) : (
        <svg
          viewBox={viewBox}
          width="100%"
          style={{ display: 'block', maxHeight: '460px', background: THEME.bg }}
        >
          {/* Building outer shell */}
          <rect x={0} y={0} width={boardW} height={boardH} fill="#FAFAFA" stroke="#37474F" strokeWidth={40} />

          {/* Block name — centered watermark */}
          <text
            x={boardW / 2} y={boardH / 2}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={boardH * 0.09} fontWeight="900"
            fill="rgba(0,0,0,0.05)"
            style={{ fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", userSelect: 'none' }}
          >
            {block.name.toUpperCase()}
          </text>

          {/* Rooms */}
          {blockRooms.map(room => {
            const status = getRoomOccupancyStatus(room, activeAssignments)
            const colors = ROOM_STATUS_COLORS[status]
            const occ    = roomOccupancy(room, activeAssignments)
            const { pos_x: rx, pos_y: ry, width: rw, height: rh } = room
            if (rx == null || ry == null || rw == null || rh == null) return null
            const labelFs = Math.min(rw, rh) * 0.22
            const subFs   = Math.min(rw, rh) * 0.11
            return (
              <g
                key={room.id}
                style={{ cursor: 'pointer', transition: 'filter .15s' }}
                onMouseEnter={e => { onRoomHover?.(room); e.currentTarget.style.filter = 'brightness(0.94)' }}
                onMouseMove={e => onRoomHover?.(room, e.clientX, e.clientY)}
                onMouseLeave={e => { onRoomLeave?.(); e.currentTarget.style.filter = '' }}
              >
                <rect x={rx} y={ry} width={rw} height={rh}
                  fill={colors.fill} stroke={colors.stroke} strokeWidth={28} rx={20}
                />
                <text
                  x={rx + rw / 2} y={ry + rh / 2 - subFs * 0.6}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={labelFs} fontWeight="700" fill={colors.label}
                  style={{ fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", userSelect: 'none' }}
                >
                  {room.room_number}
                </text>
                <text
                  x={rx + rw / 2} y={ry + rh / 2 + subFs * 1.3}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={subFs} fontWeight="600" fill={colors.label} opacity={0.85}
                  style={{ fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif", userSelect: 'none' }}
                >
                  {room.room_type === 'store'       ? 'STORE'
                    : room.room_type === 'maintenance' ? 'WORK'
                    : `${occ}/${room.capacity}`}
                </text>
              </g>
            )
          })}
        </svg>
      )}

      {/* Legend */}
      <div style={{
        padding: '8px 18px', borderTop: `1px solid ${THEME.outlineVar}`,
        display: 'flex', gap: '14px', flexWrap: 'wrap', background: THEME.surfaceVar,
      }}>
        {Object.entries(ROOM_STATUS_COLORS).map(([st, cl]) => (
          <div key={st} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: THEME.textMed }}>
            <div style={{ width: 10, height: 10, borderRadius: '3px', background: cl.fill, border: `1.5px solid ${cl.stroke}` }} />
            {st.charAt(0).toUpperCase() + st.slice(1)}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function CampHeadcount({ setPage }) {
  const { currentSite } = useSite()
  const { kpis, blocks, employees, contractors, rooms, assignments, loading } = useCampsite()

  // Live tooltip state for block-minimap hover — mirrors the Visual Layout page
  const [hoveredRoom, setHoveredRoom] = useState(null)
  const [mousePos,    setMousePos]    = useState({ x: 0, y: 0 })

  const activeAssignments = assignments.filter(a => a.status === 'active')

  function handleRoomHover(room, clientX, clientY) {
    setHoveredRoom(room)
    if (clientX != null && clientY != null) setMousePos({ x: clientX, y: clientY })
  }

  // Only show Block 1 and Block 2 on this dashboard — everything else is
  // pending layout and only clutters the overview. Matched by name so this
  // survives block-id changes and works across sites that use the same
  // naming convention.
  const featuredBlocks = blocks.filter(b => {
    const n = (b.name || '').toLowerCase().trim()
    return n === 'block 1' || n === 'block 2'
  })

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px', color: THEME.textLow, gap: '10px' }}>
      <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} /> Loading…
    </div>
  )

  // ── Contractor breakdown ──────────────────────────────────────────────────
  const coBreakdown = contractors.map((c, i) => {
    const empCount = employees.filter(e => e.contractor_id === c.id).length
    const resCount = assignments.filter(a => a.status === 'active' && a.employee?.contractor_id === c.id).length
    return { ...c, empCount, resCount, color: CO_COLORS[i % CO_COLORS.length] }
  }).filter(c => c.empCount > 0)

  const occupancyBar   = Math.min(kpis.occupancyPct, 100)
  const occupancyColor = occupancyBar > 90 ? THEME.error : occupancyBar > 70 ? THEME.warning : THEME.success

  return (
    <div className="print-page">

      {/* Print header */}
      <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
        <div style={{ borderBottom: `3px solid ${THEME.primary}`, paddingBottom: '10px', marginBottom: '12px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.primary }}>{currentSite?.name || 'Bravura Campsite'}</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '16px', fontWeight: 600 }}>Camp Headcount Report</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>Printed: {new Date().toLocaleString('en-GB')}</div>
        </div>
      </div>

      <PageHeader
        title="Headcount Dashboard"
        actions={
          <button onClick={() => window.print()} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', background: THEME.surfaceVar, border: `1px solid ${THEME.outline}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: THEME.primary, fontFamily: 'inherit' }}>
            <Icon name="print" size={16} style={{ color: THEME.primary }} /> Print
          </button>
        }
      />

      {/* KPI row — 7 tiles, single row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <KPICard label="Camp Residents"    value={kpis.totalResidents}   icon="hotel"          color="#1A6B52" />
        <KPICard label="Occupied Rooms"    value={kpis.occupiedRooms}    icon="door_front"     color={THEME.error} />
        <KPICard label="Available Rooms"   value={kpis.availableRooms}   icon="meeting_room"   color={THEME.success} />
        <KPICard label="Maintenance Rooms" value={kpis.maintenanceRooms} icon="construction"   color={THEME.warning} />
        <KPICard label="On Short Leave"    value={kpis.onShortLeave}     icon="schedule"       color={THEME.warning} sub="Room kept" />
        <KPICard label="On Long Leave"     value={kpis.onLongLeave}      icon="flight_takeoff" color="#5E35B1" sub="Room released" />
        <KPICard
          label="Occupancy Rate"
          value={`${kpis.occupancyPct}%`}
          icon="percent"
          color={occupancyColor}
          sub={`${kpis.occupiedRooms} of ${kpis.totalRooms} rooms`}
        />
      </div>

      {/* Block minimaps — Block 1 and Block 2 stacked, each full-width */}
      {featuredBlocks.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '16px',
          marginBottom: '24px',
        }}>
          {featuredBlocks.map(block => (
            <BlockMinimap
              key={block.id}
              block={block}
              rooms={rooms}
              assignments={assignments}
              onRoomHover={handleRoomHover}
              onRoomLeave={() => setHoveredRoom(null)}
            />
          ))}
        </div>
      )}

      {/* Hover tooltip — mirrors Visual Layout behaviour */}
      {hoveredRoom && (
        <RoomTooltip
          room={hoveredRoom}
          activeAssignments={activeAssignments}
          employees={employees}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
        />
      )}

      {/* Occupancy progress bar card */}
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

      {/* Contractor breakdown + Leave status */}
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
      <QuickNav pills={CAMPSITE_PILLS} setPage={setPage} current="camp_headcount" />
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
              { label: 'Active on Site', value: employees.filter(e => e.status === 'active').length, color: THEME.success, icon: 'check_circle' },
              { label: 'Short Leave',    value: kpis.onShortLeave,                                   color: THEME.warning, icon: 'schedule' },
              { label: 'Long Leave',     value: kpis.onLongLeave,                                    color: THEME.statusTertiaryText, icon: 'flight_takeoff' },
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
