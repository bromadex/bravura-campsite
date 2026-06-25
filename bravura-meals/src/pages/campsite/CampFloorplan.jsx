import { useState, useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME } from '../../utils/permissions'
import { Card, Icon, showToast } from '../../components/ui'
import FloorplanCanvas from './floorplan/FloorplanCanvas'
import FloorplanLegend from './floorplan/FloorplanLegend'
import RoomTooltip from './floorplan/RoomTooltip'
import RoomDetailPanel from './floorplan/RoomDetailPanel'
import EmployeeDragList from './floorplan/EmployeeDragList'
import { getRoomOccupancyStatus } from './floorplan/geometry'

export default function CampFloorplan() {
  const { profile } = useAuth()
  const {
    blocks, rooms, fixtures, assignments, employees, contractors,
    loading, assignRoom,
  } = useCampsite()

  const [selectedBlockId, setSelectedBlockId] = useState(null)
  const [selectedRoom,    setSelectedRoom]    = useState(null)
  const [hoveredRoom,     setHoveredRoom]     = useState(null)
  const [mousePos,        setMousePos]        = useState({ x: 0, y: 0 })
  const [dragOverRoomId,  setDragOverRoomId]  = useState(null)
  const [draggingInfo,    setDraggingInfo]    = useState(null)

  const activeAssignments = assignments.filter(a => a.status === 'active')

  // ── Block picker screen ──
  if (!selectedBlockId) {
    return (
      <div>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: '0 0 6px' }}>
          Accommodation Layout
        </h2>
        <p style={{ fontSize: '13px', color: THEME.textLow, margin: '0 0 24px' }}>
          Select a block to view its interactive floorplan
        </p>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
            <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
          </div>
        ) : blocks.length === 0 ? (
          <Card>
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
              <Icon name="domain" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
              No blocks configured yet. Add a block first under Blocks management.
            </div>
          </Card>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '14px' }}>
            {blocks.map(block => {
              const blockRooms = rooms.filter(r => r.block_id === block.id)
              const occRooms   = blockRooms.filter(r => getRoomOccupancyStatus(r, activeAssignments) !== 'available').length
              const hasGeometry = blockRooms.some(r => r.pos_x != null)
              return (
                <Card
                  key={block.id}
                  style={{
                    cursor: hasGeometry ? 'pointer' : 'default',
                    borderTop: `4px solid ${hasGeometry ? THEME.primary : THEME.outline}`,
                    transition: 'transform .15s, box-shadow .15s',
                    position: 'relative',
                  }}
                  onClick={() => hasGeometry && setSelectedBlockId(block.id)}
                  onMouseEnter={e => { if (hasGeometry) e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = '' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                    <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: hasGeometry ? THEME.surfaceVar : '#F3F3F3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="apartment" size={22} style={{ color: hasGeometry ? THEME.primary : THEME.textLow }} />
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>{block.name}</div>
                      <div style={{ fontSize: '11px', color: THEME.textLow }}>{blockRooms.length} rooms</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed }}>
                    <span>{occRooms} occupied</span>
                    <span>{blockRooms.length - occRooms} available</span>
                  </div>
                  {!hasGeometry && (
                    <div style={{
                      marginTop: '10px', display: 'flex', alignItems: 'center', gap: '5px',
                      fontSize: '11px', fontWeight: 500, color: THEME.textLow,
                      background: '#F3F3F3', borderRadius: '8px', padding: '5px 9px',
                    }}>
                      <Icon name="info" size={13} style={{ color: THEME.textLow }} />
                      Visual layout not set up yet
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Floorplan view ──
  const block = blocks.find(b => b.id === selectedBlockId)
  const blockRooms    = rooms.filter(r => r.block_id === selectedBlockId && r.pos_x != null)
  const blockFixtures = fixtures.filter(f => f.block_id === selectedBlockId)

  const totalBeds    = blockRooms.reduce((a, r) => a + r.capacity, 0)
  const occupiedBeds = activeAssignments.filter(a => blockRooms.some(r => r.id === a.room_id)).length
  const availableBeds = totalBeds - occupiedBeds
  const maintenanceRooms = blockRooms.filter(r => r.is_maintenance).length
  const occPct = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0

  function handleRoomClick(room) {
    setSelectedRoom(room)
  }

  function handleRoomHover(room, isDragOver) {
    if (isDragOver) {
      setDragOverRoomId(room?.id || null)
      return
    }
    setHoveredRoom(room)
  }

  function handleFixtureHover(fixture) {
    setHoveredRoom(fixture)
  }

  async function handleRoomDrop(room) {
    setDragOverRoomId(null)
    if (!draggingInfo) return

    const status = getRoomOccupancyStatus(room, activeAssignments)
    if (status === 'maintenance') { showToast('Room is under maintenance', 'red'); return }
    if (status === 'full')        { showToast('Room is at full capacity', 'red'); return }

    try {
      if (draggingInfo.type === 'employee') {
        await assignRoom({ roomId: room.id, employeeId: draggingInfo.employee.id, occupantType: 'employee', assignedBy: profile?.id })
        showToast(`${draggingInfo.employee.name} assigned to Room ${room.room_number}`, 'green')
      } else if (draggingInfo.type === 'team') {
        const freeSpace = room.capacity - activeAssignments.filter(a => a.room_id === room.id).length
        const toAssign = draggingInfo.people.slice(0, freeSpace)
        if (toAssign.length < draggingInfo.people.length) {
          showToast(`Only ${toAssign.length} of ${draggingInfo.people.length} fit — room capacity reached`, 'red')
        }
        for (const person of toAssign) {
          await assignRoom({ roomId: room.id, employeeId: person.id, occupantType: 'employee', assignedBy: profile?.id })
        }
        showToast(`${toAssign.length} assigned to Room ${room.room_number}`, 'green')
      }
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setDraggingInfo(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', margin: '-24px' }} onMouseMove={e => setMousePos({ x: e.clientX, y: e.clientY })}>

      {/* Header bar with back button + stats */}
      <div style={{ padding: '20px 24px', borderBottom: `1px solid ${THEME.outlineVar}`, background: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button onClick={() => { setSelectedBlockId(null); setSelectedRoom(null) }} style={{
              display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 14px',
              border: `1px solid ${THEME.outline}`, borderRadius: '20px', background: '#fff',
              cursor: 'pointer', fontSize: '13px', fontWeight: 500, color: THEME.textMed, fontFamily: 'inherit',
            }}>
              <Icon name="arrow_back" size={16} style={{ color: THEME.textMed }} /> All Blocks
            </button>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>{block.name}</div>
              <div style={{ fontSize: '12px', color: THEME.textLow }}>{blockRooms.length} rooms · interactive layout</div>
            </div>
          </div>
          <FloorplanLegend />
        </div>

        {/* Stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: '10px' }}>
          <MiniStat label="Total Rooms"   value={blockRooms.length} />
          <MiniStat label="Total Beds"    value={totalBeds} />
          <MiniStat label="Occupied"      value={occupiedBeds} color={THEME.error} />
          <MiniStat label="Available"     value={availableBeds} color={THEME.success} />
          <MiniStat label="Occupancy"     value={`${occPct}%`} color={THEME.primary} />
          <MiniStat label="Maintenance"   value={maintenanceRooms} color={THEME.warning} />
        </div>
      </div>

      {/* Main area: drag list + canvas */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <EmployeeDragList
          employees={employees}
          contractors={contractors}
          assignments={assignments}
          onDragStart={(info) => setDraggingInfo(info)}
          onDragEnd={() => setDragOverRoomId(null)}
        />

        <FloorplanCanvas
          block={block}
          rooms={blockRooms}
          fixtures={blockFixtures}
          activeAssignments={activeAssignments}
          selectedRoomId={selectedRoom?.id}
          dragOverRoomId={dragOverRoomId}
          onRoomClick={handleRoomClick}
          onRoomHover={handleRoomHover}
          onRoomDrop={handleRoomDrop}
          onFixtureHover={handleFixtureHover}
        />
      </div>

      {/* Hover tooltip */}
      {hoveredRoom && !selectedRoom && (
        <RoomTooltip
          room={hoveredRoom}
          activeAssignments={activeAssignments}
          employees={employees}
          mouseX={mousePos.x}
          mouseY={mousePos.y}
        />
      )}

      {/* Selected room detail panel */}
      {selectedRoom && (
        <RoomDetailPanel
          room={selectedRoom}
          onClose={() => setSelectedRoom(null)}
          profile={profile}
        />
      )}
    </div>
  )
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '8px', background: THEME.surfaceVar, borderRadius: '10px' }}>
      <div style={{ fontSize: '18px', fontWeight: 700, color: color || THEME.text }}>{value}</div>
      <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px' }}>{label}</div>
    </div>
  )
}
