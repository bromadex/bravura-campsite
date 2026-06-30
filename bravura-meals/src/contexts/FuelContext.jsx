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
    setTransactions([])
    setDipReadings([])
    setLoading(true)
    try {
      const [ftRes, tRes, pmRes, vRes, deptRes, txRes, dRes, pRes] = await Promise.all([
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

  // ── Fuel Transactions (immutable) ─────────────────────────────────────────────

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
        ? { ...t, last_dip_date: data.reading_date, last_dip_reading: data.reading_litres }
        : t
    ))
    return row
  }

  return (
    <FuelContext.Provider value={{
      fuelTypes, tanks, pumps, vehicles, departments, transactions, dipReadings, profiles, loading,
      // backward-compat aliases
      receipts, issues,
      // helpers
      tankBalance, latestDip, avgDailyConsumption,
      // fuel type ops
      addFuelType, updateFuelType, deactivateFuelType,
      // tank ops
      addTank, updateTank, archiveTank,
      // pump ops
      addPump, updatePump, archivePump,
      // vehicle ops
      addVehicle, updateVehicle, archiveVehicle,
      // transaction ops (immutable — no update/delete)
      addTransaction,
      // dip ops
      addDipReading,
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
