// ── Floorplan geometry helpers ────────────────────────────────────────────────
// All real-world coordinates are in millimetres (mm), matching the
// architectural drawing. We render them 1:1 into an SVG viewBox of the
// same numeric scale, then let the SVG's width/height + viewBox handle
// on-screen scaling responsively.

export const WALL_THICKNESS = 115 // mm, matches drawing wall thickness

// Room status colour tokens (kept separate from THEME so floorplan has its
// own clear visual language, similar to airline seat maps)
export const ROOM_STATUS_COLORS = {
  available:   { fill: '#E6F4EA', stroke: '#34A853', label: '#1E7E34', dot: '#34A853' }, // green
  partial:     { fill: '#FFF4E0', stroke: '#F9A825', label: '#B26A00', dot: '#F9A825' }, // orange
  full:        { fill: '#FDE7E7', stroke: '#D93025', label: '#B3261E', dot: '#D93025' }, // red
  maintenance: { fill: '#EFEFEF', stroke: '#9AA0A6', label: '#5F6368', dot: '#9AA0A6' }, // grey — temporarily out of service
  store:       { fill: '#EDE7F6', stroke: '#7E57C2', label: '#4527A0', dot: '#7E57C2' }, // purple — Store room type
  workshop:    { fill: '#E0E0E0', stroke: '#757575', label: '#424242', dot: '#757575' }, // dark grey — Maintenance room type
}

export function getRoomOccupancyStatus(room, activeAssignments) {
  // Room TYPE (a permanent designation) is checked before is_maintenance
  // (a temporary out-of-service flag) — they're separate concepts. A
  // Store or Maintenance-type room was never meant to house people in
  // the first place, regardless of whether it's currently flagged as
  // under repair.
  if (room.room_type === 'store') return 'store'
  if (room.room_type === 'maintenance') return 'workshop'
  if (room.is_maintenance) return 'maintenance'
  const occ = activeAssignments.filter(a => a.room_id === room.id).length
  if (occ === 0) return 'available'
  if (occ >= room.capacity) return 'full'
  return 'partial'
}

export function roomOccupancy(room, activeAssignments) {
  return activeAssignments.filter(a => a.room_id === room.id).length
}

// Fixture visual styling
export const FIXTURE_STYLES = {
  ablution:   { fill: '#DCE8F5', stroke: '#7AA7D9', icon: 'shower' },
  toilet:     { fill: '#DCE8F5', stroke: '#7AA7D9', icon: 'wc' },
  corridor:   { fill: '#FAFAFA', stroke: '#E0E0E0', icon: null },
  entrance:   { fill: 'transparent', stroke: '#1A73E8', icon: 'login' },
  door_swing: { fill: 'transparent', stroke: '#BDBDBD', icon: null },
  wall:       { fill: '#37474F', stroke: '#37474F', icon: null },
}

// Door swing arc path generator (quarter circle from hinge point)
// side: which wall the door is hinged on relative to the room
export function doorArcPath(x, y, radius, startAngle, endAngle) {
  const toRad = a => (a * Math.PI) / 180
  const x1 = x + radius * Math.cos(toRad(startAngle))
  const y1 = y + radius * Math.sin(toRad(startAngle))
  const x2 = x + radius * Math.cos(toRad(endAngle))
  const y2 = y + radius * Math.sin(toRad(endAngle))
  return `M ${x} ${y} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`
}

// Compute the bounding viewBox for a block's full floorplan, with margin
export function computeViewBox(blockWidth, blockHeight, margin = 600) {
  const w = Number.isFinite(blockWidth)  && blockWidth  > 0 ? blockWidth  : 20000
  const h = Number.isFinite(blockHeight) && blockHeight > 0 ? blockHeight : 10000
  return `${-margin} ${-margin} ${w + margin * 2} ${h + margin * 2}`
}

// Double-door swing icon (two quarter-circles meeting in the middle) —
// matches the "bowtie" swing symbol seen in the architectural drawing
export function crossDoorSwingPaths(x, y, width, height) {
  const cx = x + width / 2
  const cy = y + height / 2
  const r = Math.min(width, height) / 2
  // Two opposite quarter-circle leaves forming a bowtie/butterfly shape
  const leftLeaf  = `M ${cx} ${cy - r} A ${r} ${r} 0 0 0 ${cx} ${cy + r} L ${cx} ${cy} Z`
  const rightLeaf = `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} L ${cx} ${cy} Z`
  return [leftLeaf, rightLeaf]
}

export function fmtMm(mm) {
  return (mm / 1000).toFixed(2) + 'm'
}
