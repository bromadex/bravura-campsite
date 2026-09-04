import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from './SiteContext'
import { useAuth } from '../auth/AuthContext'
import SiteRequired from '../components/SiteRequired'
import { MODULE_COLORS } from '../utils/permissions'

const FuelContext = createContext(null)

const VEHICLE_CATEGORIES = ['vehicle']
const EQUIPMENT_CATEGORIES = ['heavy_equipment', 'generator', 'pump', 'other']

const defaultFrom = () => new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
const defaultTo   = () => new Date().toISOString().slice(0, 10)

export function FuelProvider({ children }) {
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const userId = profile?.id

  const [fuelTypes,    setFuelTypes]    = useState([])
  const [tanks,        setTanks]        = useState([])
  const [pumps,        setPumps]        = useState([])
  const [fleetAssets,  setFleetAssets]  = useState([])
  const [operators,    setOperators]    = useState([])
  const [employees,    setEmployees]    = useState([])
  const [departments,  setDepartments]  = useState([])
  const [transactions, setTransactions] = useState([])
  const [dipReadings,  setDipReadings]  = useState([])
  const [profiles,     setProfiles]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [txnDateFrom,  setTxnDateFrom]  = useState(defaultFrom)
  const [txnDateTo,    setTxnDateTo]    = useState(defaultTo)

  const fetchRefData = useCallback(async () => {
    if (!currentSiteId) { setLoading(false); return }
    setLoading(true)
    try {
      const [ftRes, tRes, pmRes, faRes, opRes, empRes, deptRes, pRes] = await Promise.all([
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
          .from('fleet_assets')
          .select('*, fleet_asset_types(id, name, category, icon), fuel_types(id, name, code, colour)')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('asset_number'),
        supabase
          .from('fuel_operators')
          .select('*, employees(id, name)')
          .eq('site_id', currentSiteId)
          .order('created_at', { ascending: false }),
        supabase
          .from('employees')
          .select('id, name, status')
          .eq('site_id', currentSiteId)
          .eq('status', 'active')
          .order('name'),
        supabase
          .from('departments')
          .select('id, name')
          .order('name'),
        supabase
          .from('profiles')
          .select('id, full_name')
          .order('full_name'),
      ])
      setFuelTypes(ftRes.data || [])
      setTanks(tRes.data || [])
      setPumps(pmRes.data || [])
      setFleetAssets(faRes.data || [])
      setOperators(opRes.data || [])
      setEmployees(empRes.data || [])
      setDepartments(deptRes.data || [])
      setProfiles(pRes.data || [])
    } catch (err) {
      console.error('FuelContext ref data load error:', err)
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  const fetchTransactions = useCallback(async (from, to) => {
    if (!currentSiteId) return
    const [txRes, dRes] = await Promise.all([
      supabase
        .from('fuel_transactions')
        .select('*, fleet_asset:fleet_assets(id, asset_number, fleet_number, registration, description, serial_number, department_id, department_name, fleet_asset_types(id, name, category)), operator:fuel_operators(id, employee:employees(id, name)), approved_by_profile:profiles!fuel_transactions_approved_by_fkey(id, full_name)')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
        .gte('transaction_date', from)
        .lte('transaction_date', to)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('fuel_dip_readings')
        .select('*')
        .eq('site_id', currentSiteId)
        .eq('is_archived', false)
        .gte('reading_date', from)
        .lte('reading_date', to)
        .order('reading_date', { ascending: false }),
    ])
    setTransactions(txRes.data || [])
    setDipReadings(dRes.data || [])
  }, [currentSiteId])

  useEffect(() => { fetchRefData() }, [fetchRefData])
  useEffect(() => { fetchTransactions(txnDateFrom, txnDateTo) }, [fetchTransactions, txnDateFrom, txnDateTo])

  const setTxnDateRange = useCallback((from, to) => {
    setTxnDateFrom(from)
    setTxnDateTo(to)
  }, [])

  const fetchAll = useCallback(async () => {
    await fetchRefData()
    await fetchTransactions(txnDateFrom, txnDateTo)
  }, [fetchRefData, fetchTransactions, txnDateFrom, txnDateTo])

  // ── Derived vehicle/equipment arrays from fleet_assets ─────────────────────
  const vehicles = useMemo(() =>
    fleetAssets.filter(a => VEHICLE_CATEGORIES.includes(a.fleet_asset_types?.category)),
    [fleetAssets]
  )

  const equipment = useMemo(() =>
    fleetAssets.filter(a => EQUIPMENT_CATEGORIES.includes(a.fleet_asset_types?.category)),
    [fleetAssets]
  )

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
      .map(t => {
        const cat = t.fleet_asset?.fleet_asset_types?.category
        const assetType = VEHICLE_CATEGORIES.includes(cat) ? 'vehicle'
          : EQUIPMENT_CATEGORIES.includes(cat) ? 'equipment' : 'other'
        return {
          ...t,
          quantity_litres:  t.litres,
          issue_date:       t.transaction_date,
          asset_type:       assetType,
          asset_name:       t.fleet_asset?.description || t.fleet_asset?.registration || t.fleet_asset?.fleet_number || t.fleet_asset?.asset_number || t.asset_description || 'Unknown',
          asset_reg:        t.fleet_asset?.registration || t.fleet_asset?.serial_number || '',
          purpose:          t.notes || '',
          issued_by_name:   null,
          operator_name:    t.operator?.employee?.name || null,
          approved_by_name: t.approved_by_profile?.full_name || null,
          received_by:      null,
        }
      }),
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
    const prefix = type === 'delivery' ? 'DEL' : type === 'issuance' ? 'ISS' : type === 'transfer_out' || type === 'transfer_in' ? 'TRF' : 'ADJ'
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

    const now = new Date().toISOString()
    const { error } = await supabase.from('fuel_tanks')
      .update({ is_archived: true, archived_at: now })
      .eq('id', id)
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

  // ── Vehicles CRUD (now backed by fleet_assets) ─────────────────────────────

  async function addVehicle(data) {
    // Resolve asset_type_id for 'Vehicle' type if not provided
    let asset_type_id = data.asset_type_id
    if (!asset_type_id) {
      const { data: t } = await supabase.from('fleet_asset_types').select('id').eq('code', 'VEHICLE').maybeSingle()
      asset_type_id = t?.id
    }
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .insert([{ ...data, site_id: currentSiteId, asset_type_id }])
      .select('*, fleet_asset_types(id, name, category, icon), fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setFleetAssets(prev => [...prev, row].sort((a, b) => (a.asset_number || '').localeCompare(b.asset_number || '')))
    return row
  }

  async function updateVehicle(id, data) {
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .update(data)
      .eq('id', id)
      .select('*, fleet_asset_types(id, name, category, icon), fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setFleetAssets(prev => prev.map(a => a.id === id ? row : a))
    return row
  }

  async function archiveVehicle(id) {
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .update({ is_archived: true, status: 'decommissioned' })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setFleetAssets(prev => prev.filter(a => a.id !== id))
    return row
  }

  // ── Equipment CRUD (now backed by fleet_assets) ────────────────────────────

  async function addEquipment(data) {
    // Resolve asset_type_id — prefer passed value, else fall back to first heavy_equipment type
    let asset_type_id = data.asset_type_id
    if (!asset_type_id) {
      const { data: t } = await supabase.from('fleet_asset_types').select('id').in('category', EQUIPMENT_CATEGORIES).order('sort_order').limit(1).maybeSingle()
      asset_type_id = t?.id
    }
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .insert([{ ...data, site_id: currentSiteId, asset_type_id }])
      .select('*, fleet_asset_types(id, name, category, icon), fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setFleetAssets(prev => [...prev, row].sort((a, b) => (a.asset_number || '').localeCompare(b.asset_number || '')))
    return row
  }

  async function updateEquipment(id, data) {
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .update(data)
      .eq('id', id)
      .select('*, fleet_asset_types(id, name, category, icon), fuel_types(id, name, code, colour)')
      .single()
    if (error) throw error
    setFleetAssets(prev => prev.map(a => a.id === id ? row : a))
    return row
  }

  async function archiveEquipment(id) {
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .update({ is_archived: true, status: 'decommissioned' })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setFleetAssets(prev => prev.filter(a => a.id !== id))
    return row
  }

  // ── Operators CRUD ────────────────────────────────────────────────────────────

  async function addOperator(data) {
    const payload = { ...data, site_id: currentSiteId, created_by: userId }
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
    const levelBefore = tankBalance(data.tank_id)

    const payload = {
      ...data,
      site_id:            currentSiteId,
      transaction_number: nextTransactionNumber(data.transaction_type),
      tank_level_before:  levelBefore,
      created_by:         userId,
    }

    const { data: row, error } = await supabase
      .from('fuel_transactions')
      .insert([payload])
      .select('*, fleet_asset:fleet_assets(id, asset_number, fleet_number, registration, description, serial_number, department_id, department_name), approved_by_profile:profiles!fuel_transactions_approved_by_fkey(id, full_name)')
      .single()
    if (error) throw error

    // Optimistically update level for issuance-tracked tanks (DB trigger does the real update)
    const tank = tanks.find(t => t.id === data.tank_id)
    if (tank?.level_tracking_method === 'issuance' && data.transaction_type === 'issuance') {
      const newLevel = Math.max(0, Number(tank.current_level_litres) - Number(data.litres))
      setTanks(prev => prev.map(t => t.id === data.tank_id ? { ...t, current_level_litres: newLevel } : t))
    }

    setTransactions(prev => [row, ...prev])
    return row
  }

  async function updateTransaction(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_transactions')
      .update({ ...data, updated_by: userId })
      .eq('id', id)
      .eq('site_id', currentSiteId)
      .select('*, fleet_asset:fleet_assets(id, asset_number, fleet_number, registration, description, serial_number, department_id, department_name), approved_by_profile:profiles!fuel_transactions_approved_by_fkey(id, full_name)')
      .single()
    if (error) throw error
    setTransactions(prev => prev.map(t => t.id === id ? row : t))
    await fetchAll()
    return row
  }

  async function softDeleteTransaction(id, reason) {
    const { error } = await supabase
      .from('fuel_transactions')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        updated_by: userId,
        edit_reason: reason,
      })
      .eq('id', id)
      .eq('site_id', currentSiteId)
    if (error) throw error
    setTransactions(prev => prev.filter(t => t.id !== id))
    await fetchAll()
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
    const dipLevel = data.level_end_litres ?? data.level_litres
    setTanks(prev => prev.map(t =>
      t.id === data.tank_id && (!t.last_dip_date || data.reading_date >= t.last_dip_date)
        ? { ...t, last_dip_date: data.reading_date, last_dip_reading: dipLevel }
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
    const updatedLevel = data.level_end_litres ?? data.level_litres
    if (updatedLevel != null) {
      setTanks(prev => prev.map(t =>
        t.id === row.tank_id && (!t.last_dip_date || row.reading_date >= t.last_dip_date)
          ? { ...t, last_dip_date: row.reading_date, last_dip_reading: updatedLevel }
          : t
      ))
    }
    return row
  }

  async function deleteDipReading(id) {
    const reading = dipReadings.find(d => d.id === id)
    const { error } = await supabase
      .from('fuel_dip_readings')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('site_id', currentSiteId)
    if (error) throw error
    setDipReadings(prev => prev.filter(d => d.id !== id))
    if (reading) {
      setTanks(prev => prev.map(t =>
        t.id === reading.tank_id && t.last_dip_date === reading.reading_date
          ? { ...t, last_dip_date: null, last_dip_reading: null }
          : t
      ))
    }
  }

  async function deleteDelivery(id) {
    // Fetch the delivery first so we can find its companion transaction
    const { data: delivery } = await supabase
      .from('fuel_deliveries')
      .select('tank_id, delivery_date, quantity_delivered')
      .eq('id', id)
      .eq('site_id', currentSiteId)
      .maybeSingle()

    const { error } = await supabase
      .from('fuel_deliveries')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('site_id', currentSiteId)
    if (error) throw error

    // Also soft-delete at most one matching companion fuel_transactions row
    // (each delivery save also writes a transaction). Non-fatal if none found.
    if (delivery?.tank_id) {
      try {
        const { data: match } = await supabase
          .from('fuel_transactions')
          .select('id')
          .eq('site_id', currentSiteId)
          .eq('transaction_type', 'delivery')
          .eq('tank_id', delivery.tank_id)
          .eq('transaction_date', delivery.delivery_date)
          .eq('litres', delivery.quantity_delivered)
          .eq('is_deleted', false)
          .limit(1)
        if (match?.[0]) {
          await supabase
            .from('fuel_transactions')
            .update({
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              deleted_by: userId,
              updated_by: userId,
              edit_reason: 'Companion of deleted delivery',
            })
            .eq('id', match[0].id)
            .eq('site_id', currentSiteId)
          setTransactions(prev => prev.filter(t => t.id !== match[0].id))
        }
      } catch (e) {
        console.error('Companion transaction cleanup failed:', e?.message || e)
      }
    }
  }

  const value = useMemo(() => ({
    fuelTypes, tanks, pumps, vehicles, equipment, fleetAssets, operators, employees, departments, transactions, dipReadings, profiles, loading,
    txnDateFrom, txnDateTo, setTxnDateRange, fetchTransactions,
    receipts, issues,
    tankBalance, latestDip, avgDailyConsumption,
    addFuelType, updateFuelType, deactivateFuelType,
    addTank, updateTank, archiveTank, deleteTank,
    addPump, updatePump, archivePump,
    addVehicle, updateVehicle, archiveVehicle,
    addEquipment, updateEquipment, archiveEquipment,
    addOperator, updateOperator, deactivateOperator, reactivateOperator,
    addTransaction, updateTransaction, softDeleteTransaction,
    addDipReading, updateDipReading, deleteDipReading, deleteDelivery,
    refresh: fetchAll,
  }), [fuelTypes, tanks, pumps, vehicles, equipment, fleetAssets, operators, employees, departments, transactions, dipReadings, profiles, loading])

  return (
    <FuelContext.Provider value={value}>
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
