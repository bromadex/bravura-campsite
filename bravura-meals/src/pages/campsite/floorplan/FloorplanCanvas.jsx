import { useRef, useState, useCallback } from 'react'
import { THEME } from '../../../utils/permissions'
import { Icon } from '../../../components/ui'
import FloorplanRoom from './FloorplanRoom'
import FloorplanFixtures from './FloorplanFixtures'
import { computeViewBox } from './geometry'

// ── Zoomable, pannable SVG canvas ─────────────────────────────────────────────
// Mouse wheel = zoom, click-drag on empty space = pan, pinch on touch = zoom.
// Rooms and fixtures are rendered as children at their real-world mm coords;
// this component only handles the viewport transform.
export default function FloorplanCanvas({
  block, rooms, fixtures, activeAssignments,
  selectedRoomId, dragOverRoomId,
  onRoomClick, onRoomHover, onRoomDrop, onFixtureHover,
}) {
  const svgRef = useRef(null)
  const [zoom, setZoom]   = useState(1)
  const [pan, setPan]     = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })

  const baseViewBox = computeViewBox(block.floorplan_width, block.floorplan_height)
  const [vbX, vbY, vbW, vbH] = baseViewBox.split(' ').map(Number)

  // Apply zoom/pan to the viewBox
  const viewBox = `${vbX + pan.x} ${vbY + pan.y} ${vbW / zoom} ${vbH / zoom}`

  function handleWheel(e) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(z => Math.min(4, Math.max(0.5, z * delta)))
  }

  function handleMouseDown(e) {
    if (e.target === svgRef.current || e.target.tagName === 'svg') {
      setIsPanning(true)
      panStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
    }
  }

  function handleMouseMove(e) {
    if (!isPanning) return
    const scale = (vbW / zoom) / svgRef.current.clientWidth
    const dx = (e.clientX - panStart.current.x) * scale
    const dy = (e.clientY - panStart.current.y) * scale
    setPan({ x: panStart.current.panX - dx, y: panStart.current.panY - dy })
  }

  function handleMouseUp() { setIsPanning(false) }

  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }) }

  // HTML5 drag-and-drop: track which room is currently hovered while dragging
  const handleDragOver = useCallback((room) => { onRoomHover?.(room, true) }, [onRoomHover])
  const handleDrop = useCallback((room) => { onRoomDrop?.(room) }, [onRoomDrop])

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'hidden', background: '#F5F5F5' }}>
      <svg
        ref={svgRef}
        viewBox={viewBox}
        width="100%" height="100%"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning ? 'grabbing' : 'grab', display: 'block' }}
      >
        {/* Building outer shell */}
        <rect
          x={0} y={0} width={block.floorplan_width} height={block.floorplan_height}
          fill="#FAFAFA" stroke="#37474F" strokeWidth={40}
        />

        {/* Fixtures render first (behind rooms) */}
        <FloorplanFixtures fixtures={fixtures} onHoverChange={onFixtureHover} />

        {/* Rooms */}
        {rooms.map(room => (
          <FloorplanRoom
            key={room.id}
            room={room}
            activeAssignments={activeAssignments}
            isSelected={room.id === selectedRoomId}
            isDragOver={room.id === dragOverRoomId}
            onClick={onRoomClick}
            onHoverChange={(r) => onRoomHover?.(r, false)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        ))}
      </svg>

      {/* Zoom controls */}
      <div style={{
        position: 'absolute', bottom: '20px', right: '20px',
        display: 'flex', flexDirection: 'column', gap: '6px',
        background: '#fff', borderRadius: '14px', padding: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,.15)',
      }}>
        <IconBtn icon="add"          onClick={() => setZoom(z => Math.min(4, z * 1.2))} />
        <IconBtn icon="remove"       onClick={() => setZoom(z => Math.max(0.5, z / 1.2))} />
        <IconBtn icon="center_focus_strong" onClick={resetView} />
      </div>

      {/* Zoom level indicator */}
      <div style={{
        position: 'absolute', bottom: '20px', left: '20px',
        background: 'rgba(255,255,255,.92)', borderRadius: '20px',
        padding: '6px 14px', fontSize: '12px', fontWeight: 600, color: THEME.textMed,
        boxShadow: '0 2px 8px rgba(0,0,0,.1)',
      }}>
        {Math.round(zoom * 100)}%
      </div>
    </div>
  )
}

function IconBtn({ icon, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '36px', height: '36px', border: 'none', borderRadius: '10px',
        background: 'transparent', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <Icon name={icon} size={20} style={{ color: THEME.textMed }} />
    </button>
  )
}
