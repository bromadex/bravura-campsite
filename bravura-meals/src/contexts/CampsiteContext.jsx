import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from './SiteContext'

const CampsiteContext = createContext(null)

export function CampsiteProvider({ children }) {
  const { currentSiteId } = useSite()

  const [blocks,      setBlocks]      = useState([])
  const [rooms,       setRooms]       = useState([])
  const [fixtures,    setFixtures]    = useState([])
  const [beds,        setBeds]        = useState([])
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
      // Step 1: site-scoped blocks and supplies, plus everything that
      // doesn't depend on knowing which blocks belong to this site, all in
      // parallel. Supplies now filters by site too — the balance view was
      // updated to expose site_id (see fix_supply_balance_site_id.sql).
      // Visitors remain unfiltered for now — a known, smaller, separate gap.
      const [bRes, eRes, cRes, vRes, sRes] = await Promise.all([
        supabase.from('camp_blocks').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
        // Widened to include on_leave/long_leave, not just active. The KPI
        // counts below and the Assignments page's "On Leave" tab both
        // depend on these employees actually being present in this list —
        // filtering to status='active' only meant anyone currently on
        // leave was invisible to both, independent of anything else fixed
        // in this same pass.
        supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').in('status', ['active','on_leave','long_leave']).eq('site_id', currentSiteId).order('name'),
        supabase.from('contractors').select('*').eq('status','Active').order('name'),
        supabase.from('camp_visitors').select('*').eq('site_id', currentSiteId).order('created_at', { ascending: false }),
        supabase.from('camp_supply_balance').select('*').eq('site_id', currentSiteId),
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
          supabase.from('camp_rooms').select('*, block:camp_blocks(id,name)').in('block_id', blockIds).eq('is_archived', false).order('room_number'),
          supabase.from('camp_fixtures').select('*').in('block_id', blockIds),
        ])
        roomsData = rRes.data || []
        fixturesData = fxRes.data || []
      }

      // Step 3: assignments and beds both depend on which rooms belong to
      // this site — same empty-array guard as above. Beds are fetched here
      // (not alongside rooms in step 2) because they share the exact same
      // dependency on roomIds that assignments does.
      let assignmentsData = [], bedsData = []
      const roomIds = roomsData.map(r => r.id)
      if (roomIds.length > 0) {
        const [aRes, bedsRes] = await Promise.all([
          supabase.from('room_assignments').select(`
            *,
            employee:employees(id, name, status, gender, contractor_id,
              contractor:contractors(id, name, short_code)),
            visitor:camp_visitors(id, name, gender, phone, purpose),
            room:camp_rooms(id, room_number, block_id, capacity,
              block:camp_blocks(id, name)),
            bed:beds(id, bed_number)
          `).in('room_id', roomIds).order('created_at', { ascending: false }),
          supabase.from('beds').select('*').in('room_id', roomIds).order('bed_number'),
        ])
        assignmentsData = aRes.data || []
        bedsData = bedsRes.data || []
      }

      // Step 4: supply transactions depend on which supply items belong to
      // this site — same empty-array guard as everywhere else above.
      const siteSupplies = sRes.data || []
      const itemIds = siteSupplies.map(s => s.id)
      let txnsData = []
      if (itemIds.length > 0) {
        const txRes = await supabase.from('camp_supply_txns')
          .select('*, item:camp_supply_items(id,name,unit), recorded_by_profile:profiles(full_name), issued_to_employee:employees(id,name)')
          .in('item_id', itemIds)
          .eq('is_archived', false)
          .order('txn_date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(200)
        txnsData = txRes.data || []
      }

      setBlocks(siteBlocks)
      setRooms(roomsData)
      setFixtures(fixturesData)
      setBeds(bedsData)
      setAssignments(assignmentsData)
      setEmployees(eRes.data || [])
      setContractors(cRes.data || [])
      setVisitors(vRes.data || [])
      setSupplies(siteSupplies)
      setSupplyTxns(txnsData)
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
  // Store and Maintenance room types were never meant to house people —
  // excluding them from occupancy stats is the actual point of room types
  // existing at all. Accommodation, VIP, and Isolation are all genuinely
  // occupiable categories and stay counted.
  const occupiableRooms  = rooms.filter(r => r.room_type !== 'store' && r.room_type !== 'maintenance')

  const kpis = {
    totalEmployees:    employees.length,
    totalContractors:  contractors.length,
    totalResidents:    activeAssignments.length,
    totalRooms:        occupiableRooms.length,
    occupiedRooms:     occupiedRoomIds.size,
    availableRooms:    occupiableRooms.filter(r => !r.is_maintenance && !occupiedRoomIds.has(r.id)).length,
    maintenanceRooms:  rooms.filter(r => r.is_maintenance).length,
    storeRooms:        rooms.filter(r => r.room_type === 'store').length,
    onShortLeave:      employees.filter(e => e.status === 'on_leave').length,
    onLongLeave:       employees.filter(e => e.status === 'long_leave').length,
    occupancyPct:      occupiableRooms.length > 0
      ? Math.round((occupiedRoomIds.size / occupiableRooms.length) * 100)
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
    const { error } = await supabase.from('camp_blocks')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    await fetchAll()
  }

  // ── Rooms ──────────────────────────────────────────────────────────────────
  async function addRoom(data) {
    // Store and Maintenance rooms can't contain occupants — force capacity
    // to 0 regardless of what was passed, rather than trusting the form
    // alone to enforce this.
    const isNonOccupiable = data.room_type === 'store' || data.room_type === 'maintenance'
    const payload = isNonOccupiable ? { ...data, capacity: 0 } : data

    const { data: created, error } = await supabase.from('camp_rooms').insert(payload).select().single()
    if (error) throw error

    const capacity = parseInt(payload.capacity) || 0
    if (capacity > 0) {
      const newBeds = Array.from({ length: capacity }, (_, i) => ({
        room_id: created.id,
        bed_number: String(i + 1),
      }))
      await supabase.from('beds').insert(newBeds)
    }
    await fetchAll()
  }

  async function updateRoom(id, data) {
    const existingRoom = rooms.find(r => r.id === id)
    const existingBeds = beds.filter(b => b.room_id === id)
    const oldType = existingRoom?.room_type || 'accommodation'
    const newType = data.room_type || oldType
    const nonOccupiableTypes = ['store', 'maintenance']
    const becomingNonOccupiable = nonOccupiableTypes.includes(newType) && !nonOccupiableTypes.includes(oldType)

    let payload = data

    if (becomingNonOccupiable) {
      // Converting to Store or Maintenance — can't have occupants or beds.
      // Block rather than silently evict anyone currently assigned here.
      const hasOccupants = existingBeds.some(b => b.status === 'occupied')
      if (hasOccupants) {
        throw new Error('Cannot change to this room type while people are assigned here. Release or transfer them first.')
      }
      if (existingBeds.length > 0) {
        await supabase.from('beds').delete().in('id', existingBeds.map(b => b.id))
      }
      payload = { ...data, capacity: 0 }
    } else if (data.capacity != null) {
      // Same reconciliation as before — covers both a plain capacity edit
      // on an already-occupiable room, and converting FROM Store/Maintenance
      // back to an occupiable type (existingBeds.length is 0 in that case,
      // so this naturally creates exactly the right number of new beds).
      const newCapacity = parseInt(data.capacity) || 0
      const diff = newCapacity - existingBeds.length

      if (diff > 0) {
        const existingNumbers = existingBeds.map(b => parseInt(b.bed_number) || 0)
        const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0
        const newBeds = Array.from({ length: diff }, (_, i) => ({
          room_id: id,
          bed_number: String(maxNum + i + 1),
        }))
        await supabase.from('beds').insert(newBeds)
      } else if (diff < 0) {
        const removable = existingBeds.filter(b => b.status !== 'occupied')
        if (removable.length < Math.abs(diff)) {
          throw new Error(`Cannot reduce capacity — ${existingBeds.length - removable.length} bed(s) in this room are currently occupied. Release or transfer those assignments first.`)
        }
        const toRemove = removable.slice(0, Math.abs(diff)).map(b => b.id)
        await supabase.from('beds').delete().in('id', toRemove)
      }
    }

    const { error } = await supabase.from('camp_rooms').update(payload).eq('id', id)
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
    const { error } = await supabase.from('camp_rooms')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', roomId)
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
  async function assignRoom({ employeeId, visitorId, roomId, bedId, occupantType = 'employee', notes, expectedCheckout, assignedBy }) {
    if (occupantType === 'employee' && !employeeId) throw new Error('Employee is required')
    if (occupantType === 'visitor'  && !visitorId)  throw new Error('Visitor is required')

    const existing = occupantType === 'employee'
      ? assignments.find(a => a.employee_id === employeeId && a.status === 'active')
      : assignments.find(a => a.visitor_id === visitorId && a.status === 'active')
    if (existing) throw new Error('This person already has an active room assignment. Transfer or release first.')

    const room = rooms.find(r => r.id === roomId)
    if (!room) throw new Error('Room not found')
    if (room.is_maintenance) throw new Error('Room is under maintenance')

    // Bed-level occupancy — the actual source of truth now, rather than
    // just comparing an assignment count to the capacity number. If a
    // specific bed was chosen (e.g. from the floorplan detail panel), it's
    // validated directly. If not (e.g. dragging onto the room as a whole),
    // the first available bed is picked automatically — this keeps
    // existing room-level drag-and-drop flows working unchanged.
    const roomBeds = beds.filter(b => b.room_id === roomId)
    let targetBed
    if (bedId) {
      targetBed = roomBeds.find(b => b.id === bedId)
      if (!targetBed) throw new Error('Selected bed not found in this room')
      if (targetBed.status === 'occupied') throw new Error('That bed is already occupied')
      if (targetBed.status === 'maintenance') throw new Error('That bed is under maintenance')
    } else {
      targetBed = roomBeds.find(b => b.status === 'available')
      if (!targetBed) throw new Error('Room is at full capacity')
    }

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
      bed_id:            targetBed.id,
      assigned_date:     new Date().toISOString().slice(0, 10),
      expected_checkout: expectedCheckout || null,
      status:            'active',
      assigned_by:       assignedBy || null,
      notes:             notes || null,
    })
    if (error) throw error
    await fetchAll()
  }

  async function transferRoom({ assignmentId, newRoomId, newBedId, notes, assignedBy }) {
    const assignment = assignments.find(a => a.id === assignmentId)
    if (!assignment) throw new Error('Assignment not found')

    const newRoom = rooms.find(r => r.id === newRoomId)
    if (!newRoom) throw new Error('Target room not found')
    if (newRoom.is_maintenance) throw new Error('Target room is under maintenance')

    // Same bed-level validation as assignRoom — a specific bed if chosen,
    // otherwise auto-pick the first free one in the target room.
    const targetRoomBeds = beds.filter(b => b.room_id === newRoomId)
    let targetBed
    if (newBedId) {
      targetBed = targetRoomBeds.find(b => b.id === newBedId)
      if (!targetBed) throw new Error('Selected bed not found in target room')
      if (targetBed.status === 'occupied') throw new Error('That bed is already occupied')
      if (targetBed.status === 'maintenance') throw new Error('That bed is under maintenance')
    } else {
      targetBed = targetRoomBeds.find(b => b.status === 'available')
      if (!targetBed) throw new Error('Target room is at full capacity')
    }

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
      bed_id:            targetBed.id,
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
    const { data: created, error } = await supabase.from('camp_visitors').insert({ ...data, site_id: currentSiteId }).select().single()
    if (error) throw error
    await fetchAll()
    return created
  }

  // ── Leave management — now backed by employee_movements ───────────────────
  // Going on leave used to write directly to employees.leave_status. That
  // column is now retired in favour of the real movement system: this
  // inserts a 'leave' movement, and the existing database trigger
  // (sync_employee_status_from_movement) automatically updates
  // employees.status to 'on_leave' or 'long_leave' depending on category —
  // which in turn fires the room auto-release trigger for long-leave
  // categories, exactly as it did before, just through the correct chain.
  //
  // leaveCategory must be one of: annual, sick, compassionate (short —
  // room stays assigned), or maternity, study, extended_medical (long —
  // room releases automatically). The short/long split is derived from the
  // category, not chosen directly, matching the original design.
  async function setLeaveStatus({ employeeId, leaveCategory, startDate, endDate, reason, createdBy, siteId }) {
    const { error } = await supabase.from('employee_movements').insert({
      employee_id:         employeeId,
      movement_type:       'leave',
      leave_category:      leaveCategory,
      // Leave isn't a location change — both sides record the employee's
      // current site so reporting ("who was on leave at Kamativi in June")
      // works directly off this table, per the original movement design.
      // siteId is passed in by the caller, since this employee is still
      // status='active' at the moment of going on leave and would be
      // present in CampsiteContext's own (active-only) employee list — but
      // returnFromLeave below can't rely on that same lookup, since an
      // on-leave employee is, by definition, no longer status='active'.
      from_site_id:        siteId || null,
      to_site_id:          siteId || null,
      effective_date:      startDate,
      expected_return_date: endDate || null,
      reason:              reason || null,
      created_by:          createdBy || null,
    })
    if (error) throw error
    await fetchAll()
  }

  async function returnFromLeave(employeeId, createdBy, siteId) {
    const { error } = await supabase.from('employee_movements').insert({
      employee_id:    employeeId,
      movement_type:  'return_from_leave',
      from_site_id:   siteId || null,
      to_site_id:     siteId || null,
      effective_date: new Date().toISOString().slice(0, 10),
      created_by:     createdBy || null,
    })
    if (error) throw error
    await fetchAll()
    // Room reassignment after returning from long leave is deliberately
    // manual, per the original design — this only restores 'active' status.
  }

  // ── Camp Supplies ──────────────────────────────────────────────────────────
  async function addSupplyItem(data) {
    // Stamped with the currently selected site — same fix already applied
    // to new employees and new blocks, for the same reason.
    // .select().single() added for the same reason as recordSupplyTxn —
    // Stock Transfers needs the new item's id immediately when
    // auto-provisioning a destination catalog entry that didn't exist yet.
    const { data: created, error } = await supabase.from('camp_supply_items').insert({ ...data, site_id: currentSiteId }).select().single()
    if (error) throw error
    await fetchAll()
    return created
  }

  async function recordSupplyTxn({ itemId, txnType, quantity, reference, notes, recordedBy, txnDate, issuedToEmployeeId, issuedToText }) {
    if (txnType === 'issue') {
      const item = supplies.find(s => s.id === itemId)
      if (item && parseFloat(item.balance) < parseFloat(quantity))
        throw new Error(`Insufficient stock. Balance: ${item.balance} ${item.unit}`)
    }
    // .select().single() added so callers that need to link this
    // transaction elsewhere (e.g. Stock Transfers, which records the
    // resulting txn id back onto the transfer record) have the created
    // row's id available — existing callers that ignore the return value
    // are unaffected.
    const { data: created, error } = await supabase.from('camp_supply_txns').insert({
      item_id:               itemId,
      txn_type:              txnType,
      quantity:               parseFloat(quantity),
      reference:              reference || null,
      notes:                  notes     || null,
      txn_date:               txnDate   || new Date().toISOString().slice(0, 10),
      recorded_by:            recordedBy || null,
      // Recipient only makes sense for an issue — who the stock went to,
      // as distinct from recorded_by (the staff member who handed it out).
      // Either a real employee or a free-text recipient like "Kitchen".
      issued_to_employee_id: txnType === 'issue' ? (issuedToEmployeeId || null) : null,
      issued_to_text:        txnType === 'issue' ? (issuedToText || null) : null,
    }).select().single()
    if (error) throw error
    await fetchAll()
    return created
  }

  // Would changing this transaction's quantity (or removing it entirely)
  // push the item's balance negative? Same protective principle as
  // blocking deletion of the last System Administrator — don't let an
  // edit or delete silently corrupt a number that's depended on elsewhere.
  function wouldGoNegative(txn, newQuantity) {
    const item = supplies.find(s => s.id === txn.item_id)
    if (!item) return false
    const currentBalance = parseFloat(item.balance)
    const oldQty = parseFloat(txn.quantity)
    const newQty = newQuantity == null ? 0 : parseFloat(newQuantity) // null = deletion
    // A 'receive' adds to balance; removing/shrinking one subtracts.
    // An 'issue' subtracts from balance; removing/shrinking one adds back.
    const delta = txn.txn_type === 'receive' ? (newQty - oldQty) : (oldQty - newQty)
    return currentBalance + delta < 0
  }

  async function updateSupplyTxn({ txnId, quantity, reference, notes, txnDate, issuedToEmployeeId, issuedToText, updatedBy }) {
    const txn = supplyTxns.find(t => t.id === txnId)
    if (!txn) throw new Error('Transaction not found')

    if (wouldGoNegative(txn, quantity)) {
      throw new Error('This change would push stock below zero. Check the new quantity against current balance.')
    }

    const { error } = await supabase.from('camp_supply_txns').update({
      quantity:               parseFloat(quantity),
      reference:              reference || null,
      notes:                  notes     || null,
      txn_date:               txnDate   || txn.txn_date,
      issued_to_employee_id: txn.txn_type === 'issue' ? (issuedToEmployeeId || null) : null,
      issued_to_text:        txn.txn_type === 'issue' ? (issuedToText || null) : null,
      updated_by:             updatedBy || null,
      updated_at:             new Date().toISOString(),
    }).eq('id', txnId)
    if (error) throw error
    await fetchAll()
  }

  async function deleteSupplyTxn(txnId) {
    const txn = supplyTxns.find(t => t.id === txnId)
    if (!txn) throw new Error('Transaction not found')

    if (wouldGoNegative(txn, null)) {
      throw new Error('Cannot delete — this transaction is part of the stock history other balances depend on. Removing it would push stock below zero.')
    }

    const { error } = await supabase.from('camp_supply_txns')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', txnId)
    if (error) throw error
    await fetchAll()
  }

  return (
    <CampsiteContext.Provider value={{
      blocks, rooms, fixtures, beds, assignments, employees, contractors, visitors,
      supplies, supplyTxns, loading, kpis,
      getRoomStatus,
      addBlock, updateBlock, deleteBlock,
      addRoom, updateRoom, deleteRoom, setMaintenance,
      assignRoom, transferRoom, releaseRoom,
      addVisitor,
      setLeaveStatus, returnFromLeave,
      addSupplyItem, recordSupplyTxn, updateSupplyTxn, deleteSupplyTxn,
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
