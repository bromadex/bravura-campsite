import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from './SiteContext'

const CampsiteContext = createContext(null)

export function CampsiteProvider({ children }) {
  const { currentSiteId } = useSite()

  const [blocks,      setBlocks]      = useState([])
  const [rooms,       setRooms]       = useState([])
  const [fixtures,    setFixtures]    = useState([])
  const [assignments, setAssignments] = useState([])
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [visitors,    setVisitors]    = useState([])
  const [supplies,    setSupplies]    = useState([])
  const [supplyTxns,  setSupplyTxns]  = useState([])
  const [loading,     setLoading]     = useState(true)

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) { setLoading(false); return }
    setLoading(true)
    try {
      // Step 1: site-scoped blocks, plus everything that doesn't depend on
      // knowing which blocks belong to this site, all in parallel.
      // Supplies and Visitors are deliberately NOT filtered by site yet —
      // that's a separate phase, since the supply-balance view doesn't
      // currently expose site_id at all and needs a small DB change first,
      // not just a frontend filter.
      const [bRes, eRes, cRes, vRes, sRes, txRes] = await Promise.all([
        supabase.from('camp_blocks').select('*').eq('site_id', currentSiteId).order('name'),
        supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').eq('status','active').eq('site_id', currentSiteId).order('name'),
        supabase.from('contractors').select('*').eq('status','Active').order('name'),
        supabase.from('camp_visitors').select('*').order('created_at', { ascending: false }),
        supabase.from('camp_supply_balance').select('*'),
        supabase.from('camp_supply_txns').select('*, item:camp_supply_items(id,name,unit), recorded_by_profile:profiles(full_name)').order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      ])

      const siteBlocks = bRes.data || []
      const blockIds = siteBlocks.map(b => b.id)

      // Step 2: rooms + fixtures depend on which blocks belong to this site.
      // Explicitly guarded on blockIds.length — an empty .in() array can
      // behave ambiguously across PostgREST versions (some return
      // everything rather than nothing), so we skip the query entirely
      // rather than trust that edge case to do the right thing.
      let roomsData = [], fixturesData = []
      if (blockIds.length > 0) {
        const [rRes, fxRes] = await Promise.all([
          supabase.from('camp_rooms').select('*, block:camp_blocks(id,name)').in('block_id', blockIds).order('room_number'),
          supabase.from('camp_fixtures').select('*').in('block_id', blockIds),
        ])
        roomsData = rRes.data || []
        fixturesData = fxRes.data || []
      }

      // Step 3: assignments depend on which rooms belong to this site —
      // same empty-array guard as above.
      let assignmentsData = []
      const roomIds = roomsData.map(r => r.id)
      if (roomIds.length > 0) {
        const aRes = await supabase.from('room_assignments').select(`
          *,
          employee:employees(id, name, status, leave_status, gender, contractor_id,
            contractor:contractors(id, name, short_code)),
          visitor:camp_visitors(id, name, gender, phone, purpose),
          room:camp_rooms(id, room_number, block_id, capacity,
            block:camp_blocks(id, name))
        `).in('room_id', roomIds).order('created_at', { ascending: false })
        assignmentsData = aRes.data || []
      }

      setBlocks(siteBlocks)
      setRooms(roomsData)
      setFixtures(fixturesData)
      setAssignments(assignmentsData)
      setEmployees(eRes.data || [])
      setContractors(cRes.data || [])
      setVisitors(vRes.data || [])
      setSupplies(sRes.data || [])
      setSupplyTxns(txRes.data || [])
    } catch (err) {
      console.error('CampsiteContext fetchAll error:', err)
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Derived room status ────────────────────────────────────────────────────
  function getRoomStatus(roomId) {
    const room = rooms.find(r => r.id === roomId)
    if (!room) return 'unknown'
    if (room.is_maintenance) return 'maintenance'
    const active = assignments.filter(a => a.room_id === roomId && a.status === 'active')
    if (active.length === 0) return 'available'
    if (room.capacity && active.length >= room.capacity) return 'occupied'
    return 'occupied'
  }

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const activeAssignments = assignments.filter(a => a.status === 'active')
  const occupiedRoomIds   = new Set(activeAssignments.map(a => a.room_id))

  const kpis = {
    totalEmployees:    employees.length,
    totalContractors:  contractors.length,
    totalResidents:    activeAssignments.length,
    totalRooms:        rooms.length,
    occupiedRooms:     occupiedRoomIds.size,
    availableRooms:    rooms.filter(r => !r.is_maintenance && !occupiedRoomIds.has(r.id)).length,
    maintenanceRooms:  rooms.filter(r => r.is_maintenance).length,
    onShortLeave:      employees.filter(e => e.leave_status === 'short_leave').length,
    onLongLeave:       employees.filter(e => e.leave_status === 'long_leave').length,
    occupancyPct:      rooms.length > 0
      ? Math.round((occupiedRoomIds.size / rooms.length) * 100)
      : 0,
  }

  // ── Blocks ─────────────────────────────────────────────────────────────────
  async function addBlock(data) {
    // Stamped with the currently selected site — otherwise the database
    // default (Kamativi) would silently apply even while viewing a
    // different site, same fix already applied for new employees.
    const { error } = await supabase.from('camp_blocks').insert({ ...data, site_id: currentSiteId })
    if (error) throw error
    await fetchAll()
  }
  async function updateBlock(id, data) {
    const { error } = await supabase.from('camp_blocks').update(data).eq('id', id)
    if (error) throw error
    await fetchAll()
  }
  async function deleteBlock(id) {
    const hasRooms = rooms.some(r => r.block_id === id)
    if (hasRooms) throw new Error('Cannot delete block — it has rooms. Remove rooms first.')
    const { error } = await supabase.from('camp_blocks').delete().eq('id', id)
    if (error) throw error
    await fetchAll()
  }

  // ── Rooms ──────────────────────────────────────────────────────────────────
  async function addRoom(data) {
    const { error } = await supabase.from('camp_rooms').insert(data)
    if (error) throw error
    await fetchAll()
  }
  async function updateRoom(id, data) {
    const { error } = await supabase.from('camp_rooms').update(data).eq('id', id)
    if (error) throw error
    await fetchAll()
  }
  async function deleteRoom(roomId) {
    const { data: existing } = await supabase
      .from('room_assignments')
      .select('id')
      .eq('room_id', roomId)
      .limit(1)
    if (existing && existing.length > 0)
      throw new Error('Cannot delete — room has assignment history. Use maintenance mode instead.')
    const { error } = await supabase.from('camp_rooms').delete().eq('id', roomId)
    if (error) throw error
    await fetchAll()
  }
  async function setMaintenance(roomId, isMaintenance, reason = '') {
    const active = assignments.filter(a => a.room_id === roomId && a.status === 'active')
    if (isMaintenance && active.length > 0)
      throw new Error('Cannot put occupied room into maintenance. Release occupants first.')
    const { error } = await supabase.from('camp_rooms').update({
      is_maintenance:     isMaintenance,
      status:             isMaintenance ? 'maintenance' : 'available',
      maintenance_reason: isMaintenance ? reason : null,
    }).eq('id', roomId)
    if (error) throw error
    await fetchAll()
  }

  // ── Assignments ────────────────────────────────────────────────────────────
  // Supports employees OR visitors via occupantType, plus a friendly
  // client-side gender pre-check (the DB trigger is the authoritative check).
  async function assignRoom({ employeeId, visitorId, roomId, occupantType = 'employee', notes, expectedCheckout, assignedBy }) {
    if (occupantType === 'employee' && !employeeId) throw new Error('Employee is required')
    if (occupantType === 'visitor'  && !visitorId)  throw new Error('Visitor is required')

    const existing = occupantType === 'employee'
      ? assignments.find(a => a.employee_id === employeeId && a.status === 'active')
      : assignments.find(a => a.visitor_id === visitorId && a.status === 'active')
    if (existing) throw new Error('This person already has an active room assignment. Transfer or release first.')

    const room = rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')
    if (room.is_maintenance) throw new Error('Room is under maintenance')
    const currentOccupancy = assignments.filter(a => a.room_id === roomId && a.status === 'active').length
    if (currentOccupancy >= room.capacity) throw new Error('Room is at full capacity')

    if (room.gender && room.gender !== 'unassigned') {
      const personGender = occupantType === 'employee'
        ? employees.find(e => e.id === employeeId)?.gender
        : visitors.find(v => v.id === visitorId)?.gender
      if (personGender && personGender !== room.gender) {
        throw new Error(`This room is allocated to ${room.gender === 'male' ? 'males' : 'females'} only`)
      }
    }

    const { error } = await supabase.from('room_assignments').insert({
      employee_id:       occupantType === 'employee' ? employeeId : null,
      visitor_id:        occupantType === 'visitor'  ? visitorId  : null,
      occupant_type:     occupantType,
      room_id:           roomId,
      assigned_date:     new Date().toISOString().slice(0, 10),
      expected_checkout: expectedCheckout || null,
      status:            'active',
      assigned_by:       assignedBy || null,
      notes:             notes || null,
    })
    if (error) throw error
    await fetchAll()
  }

  async function transferRoom({ assignmentId, newRoomId, notes, assignedBy }) {
    const assignment = assignments.find(a => a.id === assignmentId)
    if (!assignment) throw new Error('Assignment not found')

    const newRoom = rooms.find(r => r.id === newRoomId)
    if (!newRoom) throw new Error('Target room not found')
    if (newRoom.is_maintenance) throw new Error('Target room is under maintenance')
    const occupancy = assignments.filter(a => a.room_id === newRoomId && a.status === 'active').length
    if (occupancy >= newRoom.capacity) throw new Error('Target room is at full capacity')

    if (newRoom.gender && newRoom.gender !== 'unassigned') {
      const personGender = assignment.employee?.gender || assignment.visitor?.gender
      if (personGender && personGender !== newRoom.gender) {
        throw new Error(`Target room is allocated to ${newRoom.gender === 'male' ? 'males' : 'females'} only`)
      }
    }

    await supabase.from('room_assignments').update({
      status:        'transferred',
      released_date: new Date().toISOString().slice(0, 10),
    }).eq('id', assignmentId)

    const { error } = await supabase.from('room_assignments').insert({
      employee_id:       assignment.employee_id,
      visitor_id:        assignment.visitor_id,
      occupant_type:     assignment.occupant_type,
      room_id:           newRoomId,
      assigned_date:     new Date().toISOString().slice(0, 10),
      expected_checkout: assignment.expected_checkout,
      status:            'active',
      assigned_by:       assignedBy || null,
      notes:             notes || null,
    })
    if (error) throw error
    await fetchAll()
  }

  async function releaseRoom({ assignmentId, notes, releasedBy }) {
    const { error } = await supabase.from('room_assignments').update({
      status:        'released',
      released_date: new Date().toISOString().slice(0, 10),
      released_by:   releasedBy || null,
      notes:         notes || null,
    }).eq('id', assignmentId)
    if (error) throw error
    await fetchAll()
  }

  // ── Visitors ───────────────────────────────────────────────────────────────
  async function addVisitor(data) {
    const { data: created, error } = await supabase.from('camp_visitors').insert(data).select().single()
    if (error) throw error
    await fetchAll()
    return created
  }

  // ── Leave management ───────────────────────────────────────────────────────
  async function setLeaveStatus({ employeeId, leaveStatus, startDate, endDate, notes }) {
    const { error } = await supabase.from('employees').update({
      leave_status: leaveStatus,
      leave_start:  startDate || null,
      leave_end:    endDate   || null,
      leave_notes:  notes     || null,
    }).eq('id', employeeId)
    if (error) throw error
    await fetchAll()
  }

  async function returnFromLeave(employeeId) {
    const { error } = await supabase.from('employees').update({
      leave_status: 'active',
      leave_start:  null,
      leave_end:    null,
      leave_notes:  null,
    }).eq('id', employeeId)
    if (error) throw error
    await fetchAll()
  }

  // ── Camp Supplies ──────────────────────────────────────────────────────────
  async function addSupplyItem(data) {
    const { error } = await supabase.from('camp_supply_items').insert(data)
    if (error) throw error
    await fetchAll()
  }

  async function recordSupplyTxn({ itemId, txnType, quantity, reference, notes, recordedBy, txnDate }) {
    if (txnType === 'issue') {
      const item = supplies.find(s => s.id === itemId)
      if (item && parseFloat(item.balance) < parseFloat(quantity))
        throw new Error(`Insufficient stock. Balance: ${item.balance} ${item.unit}`)
    }
    const { error } = await supabase.from('camp_supply_txns').insert({
      item_id:     itemId,
      txn_type:    txnType,
      quantity:    parseFloat(quantity),
      reference:   reference || null,
      notes:       notes     || null,
      txn_date:    txnDate   || new Date().toISOString().slice(0, 10),
      recorded_by: recordedBy || null,
    })
    if (error) throw error
    await fetchAll()
  }

  return (
    <CampsiteContext.Provider value={{
      blocks, rooms, fixtures, assignments, employees, contractors, visitors,
      supplies, supplyTxns, loading, kpis,
      getRoomStatus,
      addBlock, updateBlock, deleteBlock,
      addRoom, updateRoom, deleteRoom, setMaintenance,
      assignRoom, transferRoom, releaseRoom,
      addVisitor,
      setLeaveStatus, returnFromLeave,
      addSupplyItem, recordSupplyTxn,
      refresh: fetchAll,
    }}>
      {children}
    </CampsiteContext.Provider>
  )
}

export function useCampsite() {
  const ctx = useContext(CampsiteContext)
  if (!ctx) throw new Error('useCampsite must be inside CampsiteProvider')
  return ctx
}
