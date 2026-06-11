import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'

const CampsiteContext = createContext(null)

export function CampsiteProvider({ children }) {
  const [blocks,      setBlocks]      = useState([])
  const [rooms,       setRooms]       = useState([])
  const [assignments, setAssignments] = useState([])
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [supplies,    setSupplies]    = useState([])
  const [supplyTxns,  setSupplyTxns]  = useState([])
  const [loading,     setLoading]     = useState(true)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [bRes, rRes, aRes, eRes, cRes, sRes, txRes] = await Promise.all([
        supabase.from('camp_blocks').select('*').order('name'),
        supabase.from('camp_rooms').select('*, block:camp_blocks(id,name)').order('room_number'),
        supabase.from('room_assignments').select(`
          *,
          employee:employees(id, name, status, leave_status, contractor_id,
            contractor:contractors(id, name, short_code)),
          room:camp_rooms(id, room_number, block_id, capacity,
            block:camp_blocks(id, name))
        `).order('created_at', { ascending: false }),
        supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').eq('status','Active').order('name'),
        supabase.from('contractors').select('*').eq('status','Active').order('name'),
        supabase.from('camp_supply_balance').select('*'),
        supabase.from('camp_supply_txns').select('*, item:camp_supply_items(id,name,unit), recorded_by_profile:profiles(full_name)').order('txn_date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      ])
      setBlocks(bRes.data || [])
      setRooms(rRes.data || [])
      setAssignments(aRes.data || [])
      setEmployees(eRes.data || [])
      setContractors(cRes.data || [])
      setSupplies(sRes.data || [])
      setSupplyTxns(txRes.data || [])
    } catch (err) {
      console.error('CampsiteContext fetchAll error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

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
    const { error } = await supabase.from('camp_blocks').insert(data)
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
  async function assignRoom({ employeeId, roomId, notes, assignedBy }) {
    // Check employee doesn't already have a room
    const existing = assignments.find(a => a.employee_id === employeeId && a.status === 'active')
    if (existing) throw new Error('Employee already has an active room assignment. Transfer or release first.')

    // Check room capacity
    const room = rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')
    if (room.is_maintenance) throw new Error('Room is under maintenance')
    const currentOccupancy = assignments.filter(a => a.room_id === roomId && a.status === 'active').length
    if (currentOccupancy >= room.capacity) throw new Error('Room is at full capacity')

    const { error } = await supabase.from('room_assignments').insert({
      employee_id:   employeeId,
      room_id:       roomId,
      assigned_date: new Date().toISOString().slice(0, 10),
      status:        'active',
      assigned_by:   assignedBy || null,
      notes:         notes || null,
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

    // Release old
    await supabase.from('room_assignments').update({
      status:        'transferred',
      released_date: new Date().toISOString().slice(0, 10),
    }).eq('id', assignmentId)

    // Create new
    const { error } = await supabase.from('room_assignments').insert({
      employee_id:   assignment.employee_id,
      room_id:       newRoomId,
      assigned_date: new Date().toISOString().slice(0, 10),
      status:        'active',
      assigned_by:   assignedBy || null,
      notes:         notes || null,
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

  // ── Leave management ───────────────────────────────────────────────────────
  async function setLeaveStatus({ employeeId, leaveStatus, startDate, endDate, notes }) {
    const { error } = await supabase.from('employees').update({
      leave_status: leaveStatus,
      leave_start:  startDate || null,
      leave_end:    endDate   || null,
      leave_notes:  notes     || null,
    }).eq('id', employeeId)
    if (error) throw error
    // Triggers in DB handle auto-release for long leave
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
      blocks, rooms, assignments, employees, contractors,
      supplies, supplyTxns, loading, kpis,
      getRoomStatus,
      addBlock, updateBlock, deleteBlock,
      addRoom, updateRoom, setMaintenance,
      assignRoom, transferRoom, releaseRoom,
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
