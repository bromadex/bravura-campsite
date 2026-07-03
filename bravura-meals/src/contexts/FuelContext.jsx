import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from './SiteContext'
import SiteRequired from '../components/SiteRequired'
import { MODULE_COLORS } from '../utils/permissions'

const FuelContext = createContext(null)

export function FuelProvider({ children }) {
  const { currentSiteId } = useSite()

  const [fuelTypes,    setFuelTypes]    = useState([])
  const [tanks,        setTanks]        = useState([])
  const [pumps,        setPumps]        = useState([])
  const [vehicles,     setVehicles]     = useState([])
  const [equipment,    setEquipment]    = useState([])
  const [operators,    setOperators]    = useState([])
  const [employees,    setEmployees]    = useState([])
  const [departments,  setDepartments]  = useState([])
  const [transactions, setTransactions] = useState([])
  const [dipReadings,  setDipReadings]  = useState([])
  const [profiles,     setProfiles]     = useState([])
  const [loading,      setLoading]      = useState(true)

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) { setLoading(false); return }
    setTanks([])
    setPumps([])
    setVehicles([])
    setEquipment([])
    setOperators([])
    setEmployees([])
    setTransactions([])
    setDipReadings([])
    setLoading(true)
    try {
      const [ftRes, tRes, pmRes, vRes, eqRes, opRes, empRes, deptRes, txRes, dRes, pRes] = await Promise.all([
        supabase
          .from('fuel_types')
          .select('*')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('fuel_tanks')
          .select('*, fuel_types(id, name, code, colour)')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('name'),
        supabase
          .from('fuel_pumps')
          .select('*')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('name'),
        supabase
          .from('fuel_vehicles')
          .select('*, fuel_types(id, name, code, colour)')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('fleet_number'),
        supabase
          .from('fuel_equipment')
          .select('*, fuel_types(id, name, code, colour)')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('equipment_number'),
        supabase
          .from('fuel_operators')
          .select('*, employees(id, name, contractor:contractors(id, name, short_code))')
          .eq('site_id', currentSiteId)
          .order('created_at', { ascending: false }),
        supabase
          .from('employees')
          .select('id, name, status, contractor:contractors(id, name, short_code)')
          .eq('site_id', currentSiteId)
          .eq('status', 'active')
          .order('name'),
        supabase
          .from('departments')
          .select('id, name')
          .order('name'),
        supabase
          .from('fuel_transactions')
          .select('*, fuel_vehicles(id, fleet_number, registration), fuel_equipment(id, name, equipment_number), approved_by_profile:profiles!fuel_transactions_approved_by_fkey(id, full_name)')
          .eq('site_id', currentSiteId)
          .order('transaction_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('fuel_dip_readings')
          .select('*')
          .eq('site_id', currentSiteId)
          .order('reading_date', { ascending: false }),
        supabase
          .from('profiles')
          .select('id, full_name')
          .order('full_name'),
      ])
      setFuelTypes(ftRes.data || [])
      setTanks(tRes.data || [])
      setPumps(pmRes.data || [])
      setVehicles(vRes.data || [])
      setEquipment(eqRes.data || [])
      setOperators(opRes.data || [])
      setEmployees(empRes.data || [])
      setDepartments(deptRes.data || [])
      setTransactions(txRes.data || [])
      setDipReadings(dRes.data || [])
      setProfiles(pRes.data || [])
    } catch (err) {
      console.error('FuelContext load error:', err)
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Backward-compatible aliases for existing pages ────────────────────────────
  // Pages that used the old fuel_receipts / fuel_issues tables get shaped data
  // so they don't all need simultaneous rewrites.

  const receipts = useMemo(() =>
    transactions
      .filter(t => t.transaction_type === 'delivery')
      .map(t => ({
        ...t,
        quantity_litres:   t.litres,
        receipt_date:      t.transaction_date,
        delivery_note_ref: t.docket_number,
        recorded_by_name:  null,  // populated via created_by join when needed
      })),
    [transactions]
  )

  const issues = useMemo(() =>
    transactions
      .filter(t => t.transaction_type === 'issuance')
      .map(t => ({
        ...t,
        quantity_litres:  t.litres,
        issue_date:       t.transaction_date,
        asset_type:       t.vehicle_id ? 'vehicle' : t.equipment_id ? 'equipment' : 'other',
        asset_name:       t.fuel_vehicles?.fleet_number || t.fuel_equipment?.name || t.asset_description || 'Unknown',
        asset_reg:        t.fuel_vehicles?.registration || t.fuel_equipment?.equipment_number || '',
        purpose:          t.notes || '',
        issued_by_name:   null,
        approved_by_name: t.approved_by_profile?.full_name || null,
        received_by:      null,
      })),
    [transactions]
  )

  // ── Computed helpers ──────────────────────────────────────────────────────────

  // Authoritative tank balance from the DB (updated by trigger after each transaction)
  function tankBalance(tankId) {
    const tank = tanks.find(t => t.id === tankId)
    return tank ? Number(tank.current_level_litres) : 0
  }

  function latestDip(tankId) {
    const readings = dipReadings.filter(d => d.tank_id === tankId)
    if (!readings.length) return null
    return readings.reduce((best, d) => (!best || d.reading_date > best.reading_date) ? d : best, null)
  }

  function avgDailyConsumption(tankId, days = 30) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    const recent = transactions.filter(
      t => t.tank_id === tankId && t.transaction_type === 'issuance' && t.transaction_date >= cutoffStr
    )
    if (!recent.length) return null
    const total = recent.reduce((s, t) => s + Number(t.litres), 0)
    return total / days
  }

  // ── Transaction number generator ──────────────────────────────────────────────
  function nextTransactionNumber(type) {
    const prefix = type === 'delivery' ? 'DEL' : type === 'issuance' ? 'ISS' : 'ADJ'
    return `${prefix}-${Date.now()}`
  }

  // ── Fuel Types CRUD ───────────────────────────────────────────────────────────

  async function addFuelType(data) {
    const { data: row, error } = await supabase
      .from('fuel_types')
      .insert([data])
      .select()
      .single()
    if (error) throw error
    setFuelTypes(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }

  async function updateFuelType(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_types')
      .update(data)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setFuelTypes(prev => prev.map(ft => ft.id === id ? row : ft).filter(ft => ft.is_active))
    return row
  }

  async function deactivateFuelType(id) {
    const { data: row, error } = await supabase
      .from('fuel_types')
      .update({ is_active: false })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setFuelTypes(prev => prev.filter(ft => ft.id !== id))
    return row
  }

  // ── Tanks CRUD ────────────────────────────────────────────────────────────────

  async function addTank(data) {
    const { data: row, error } = await supabase
      .from('fuel_tanks')
      .insert([{ ...data, site_id: currentSiteId }])
      .select('*, fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setTanks(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }

  async function updateTank(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_tanks')
      .update(data)
      .eq('id', id)
      .select('*, fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setTanks(prev => prev.map(t => t.id === id ? row : t))
    return row
  }

  async function archiveTank(id) {
    const { data: row, error } = await supabase
      .from('fuel_tanks')
      .update({ is_archived: true, archived_at: new Date().toISOString(), status: 'decommissioned' })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setTanks(prev => prev.filter(t => t.id !== id))
    return row
  }

  // Hard-delete a tank. Refuses if any fuel_transaction ever referenced
  // it — transactions are immutable and their tank_id would dangle.
  // Also removes pumps, dip readings, and calibration rows for the tank.
  async function deleteTank(id) {
    const { count, error: countErr } = await supabase
      .from('fuel_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('tank_id', id)
    if (countErr) throw countErr
    if ((count ?? 0) > 0) {
      throw new Error(
        `This tank has ${count} transaction${count === 1 ? '' : 's'} against it and cannot be deleted. ` +
        'Decommission it instead — that keeps the history intact.'
      )
    }

    // Wipe dependent config rows first so FKs don't block the tank delete.
    await supabase.from('tank_calibrations').delete().eq('tank_id', id)
    await supabase.from('fuel_pumps').delete().eq('tank_id', id)
    await supabase.from('fuel_dip_readings').delete().eq('tank_id', id)

    const { error } = await supabase.from('fuel_tanks').delete().eq('id', id)
    if (error) throw error
    setTanks(prev => prev.filter(t => t.id !== id))
  }

  // ── Pumps CRUD ────────────────────────────────────────────────────────────────

  async function addPump(data) {
    const { data: row, error } = await supabase
      .from('fuel_pumps')
      .insert([{ ...data, site_id: currentSiteId }])
      .select()
      .single()
    if (error) throw error
    setPumps(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }

  async function updatePump(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_pumps')
      .update(data)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setPumps(prev => prev.map(p => p.id === id ? row : p))
    return row
  }

  async function archivePump(id) {
    const { data: row, error } = await supabase
      .from('fuel_pumps')
      .update({ is_archived: true, status: 'decommissioned' })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setPumps(prev => prev.filter(p => p.id !== id))
    return row
  }

  // ── Vehicles CRUD ─────────────────────────────────────────────────────────────

  async function addVehicle(data) {
    const { data: row, error } = await supabase
      .from('fuel_vehicles')
      .insert([{ ...data, site_id: currentSiteId }])
      .select('*, fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setVehicles(prev => [...prev, row].sort((a, b) => a.fleet_number.localeCompare(b.fleet_number)))
    return row
  }

  async function updateVehicle(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_vehicles')
      .update(data)
      .eq('id', id)
      .select('*, fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setVehicles(prev => prev.map(v => v.id === id ? row : v))
    return row
  }

  async function archiveVehicle(id) {
    const { data: row, error } = await supabase
      .from('fuel_vehicles')
      .update({ is_archived: true, archived_at: new Date().toISOString(), status: 'decommissioned' })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setVehicles(prev => prev.filter(v => v.id !== id))
    return row
  }

  // ── Equipment CRUD ────────────────────────────────────────────────────────────

  async function addEquipment(data) {
    const { data: row, error } = await supabase
      .from('fuel_equipment')
      .insert([{ ...data, site_id: currentSiteId }])
      .select('*, fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setEquipment(prev => [...prev, row].sort((a, b) => a.equipment_number.localeCompare(b.equipment_number)))
    return row
  }

  async function updateEquipment(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_equipment')
      .update(data)
      .eq('id', id)
      .select('*, fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setEquipment(prev => prev.map(e => e.id === id ? row : e))
    return row
  }

  async function archiveEquipment(id) {
    const { data: row, error } = await supabase
      .from('fuel_equipment')
      .update({ is_archived: true, status: 'decommissioned' })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setEquipment(prev => prev.filter(e => e.id !== id))
    return row
  }

  // ── Operators CRUD ────────────────────────────────────────────────────────────

  async function addOperator(data) {
    const { data: { user } } = await supabase.auth.getUser()
    const payload = { ...data, site_id: currentSiteId, created_by: user?.id || null }
    const { data: row, error } = await supabase
      .from('fuel_operators')
      .insert([payload])
      .select('*, employees(id, name, contractor:contractors(id, name, short_code))')
      .single()
    if (error) throw error
    setOperators(prev => [row, ...prev])
    return row
  }

  async function updateOperator(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_operators')
      .update(data)
      .eq('id', id)
      .select('*, employees(id, name, contractor:contractors(id, name, short_code))')
      .single()
    if (error) throw error
    setOperators(prev => prev.map(o => o.id === id ? row : o))
    return row
  }

  async function deactivateOperator(id) {
    return updateOperator(id, { is_active: false, deactivated_at: new Date().toISOString() })
  }

  async function reactivateOperator(id) {
    return updateOperator(id, { is_active: true, deactivated_at: null })
  }

  // ── Fuel Transactions ─────────────────────────────────────────────────────────

  async function addTransaction(data) {
    const { data: { user } } = await supabase.auth.getUser()
    const levelBefore = tankBalance(data.tank_id)

    const payload = {
      ...data,
      site_id:            currentSiteId,
      transaction_number: nextTransactionNumber(data.transaction_type),
      tank_level_before:  levelBefore,
      created_by:         user?.id || null,
    }

    const { data: row, error } = await supabase
      .from('fuel_transactions')
      .insert([payload])
      .select('*, fuel_vehicles(id, fleet_number, registration), fuel_equipment(id, name, equipment_number), approved_by_profile:profiles!fuel_transactions_approved_by_fkey(id, full_name)')
      .single()
    if (error) throw error

    // Optimistically update tank level (trigger will also update DB)
    const delta = data.transaction_type === 'issuance'
      ? -Number(data.litres)
      : Number(data.litres)
    setTanks(prev => prev.map(t =>
      t.id === data.tank_id
        ? { ...t, current_level_litres: Math.max(0, Number(t.current_level_litres) + delta) }
        : t
    ))

    setTransactions(prev => [row, ...prev])
    return row
  }

  async function updateTransaction(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_transactions')
      .update(data)
      .eq('id', id)
      .eq('site_id', currentSiteId)
      .select('*, fuel_vehicles(id, fleet_number, registration), fuel_equipment(id, name, equipment_number), approved_by_profile:profiles!fuel_transactions_approved_by_fkey(id, full_name)')
      .single()
    if (error) throw error
    setTransactions(prev => prev.map(t => t.id === id ? row : t))
    await fetchAll()
    return row
  }

  // ── Dip Readings ──────────────────────────────────────────────────────────────

  async function addDipReading(data) {
    const { data: row, error } = await supabase
      .from('fuel_dip_readings')
      .insert([{ ...data, site_id: currentSiteId }])
      .select()
      .single()
    if (error) throw error
    setDipReadings(prev => [row, ...prev])
    // Update tank snapshot (trigger does it in DB too)
    setTanks(prev => prev.map(t =>
      t.id === data.tank_id && (!t.last_dip_date || data.reading_date >= t.last_dip_date)
        ? { ...t, last_dip_date: data.reading_date, last_dip_reading: data.level_litres }
        : t
    ))
    return row
  }

  async function updateDipReading(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_dip_readings')
      .update(data)
      .eq('id', id)
      .eq('site_id', currentSiteId)
      .select()
      .single()
    if (error) throw error
    setDipReadings(prev => prev.map(d => d.id === id ? row : d))
    if (data.level_litres != null) {
      setTanks(prev => prev.map(t =>
        t.id === row.tank_id && (!t.last_dip_date || row.reading_date >= t.last_dip_date)
          ? { ...t, last_dip_date: row.reading_date, last_dip_reading: row.level_litres }
          : t
      ))
    }
    return row
  }

  return (
    <FuelContext.Provider value={{
      fuelTypes, tanks, pumps, vehicles, equipment, operators, employees, departments, transactions, dipReadings, profiles, loading,
      // backward-compat aliases
      receipts, issues,
      // helpers
      tankBalance, latestDip, avgDailyConsumption,
      // fuel type ops
      addFuelType, updateFuelType, deactivateFuelType,
      // tank ops
      addTank, updateTank, archiveTank, deleteTank,
      // pump ops
      addPump, updatePump, archivePump,
      // vehicle ops
      addVehicle, updateVehicle, archiveVehicle,
      // equipment ops
      addEquipment, updateEquipment, archiveEquipment,
      // operator ops
      addOperator, updateOperator, deactivateOperator, reactivateOperator,
      // transaction ops
      addTransaction, updateTransaction,
      // dip ops
      addDipReading, updateDipReading,
      refresh: fetchAll,
    }}>
      <SiteRequired moduleColor={MODULE_COLORS.fuel}>
        {children}
      </SiteRequired>
    </FuelContext.Provider>
  )
}

export function useFuel() {
  const ctx = useContext(FuelContext)
  if (!ctx) throw new Error('useFuel must be used inside FuelProvider')
  return ctx
}
