import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from './SiteContext'
import SiteRequired from '../components/SiteRequired'

const FleetContext = createContext(null)

export function FleetProvider({ children }) {
  const { currentSiteId } = useSite()

  const [assetTypes,   setAssetTypes]   = useState([])
  const [assets,       setAssets]       = useState([])
  const [departments,  setDepartments]  = useState([])
  const [employees,    setEmployees]    = useState([])
  const [assignments,  setAssignments]  = useState([])
  const [inspections,  setInspections]  = useState([])
  const [workOrders,   setWorkOrders]   = useState([])
  const [trips,        setTrips]        = useState([])
  const [compliance,   setCompliance]   = useState([])
  const [loading,      setLoading]      = useState(true)

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) { setLoading(false); return }
    setLoading(true)
    try {
      const [atRes, aRes, dRes, eRes, asgnRes, insRes, woRes, trRes, cRes] = await Promise.all([
        supabase
          .from('fleet_asset_types')
          .select('*')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('fleet_assets')
          .select('*, fleet_asset_types(id, name, category, icon)')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('asset_number'),
        supabase
          .from('departments')
          .select('id, name')
          .order('name'),
        supabase
          .from('employees')
          .select('id, name, status')
          .eq('site_id', currentSiteId)
          .eq('status', 'active')
          .order('name'),
        supabase
          .from('fleet_assignments')
          .select('*, fleet_assets(id, asset_number, description)')
          .eq('site_id', currentSiteId)
          .order('start_date', { ascending: false }),
        supabase
          .from('fleet_inspections')
          .select('*, fleet_assets(id, asset_number, description)')
          .eq('site_id', currentSiteId)
          .order('inspection_date', { ascending: false })
          .limit(100),
        supabase
          .from('fleet_work_orders')
          .select('*, fleet_assets(id, asset_number, description)')
          .eq('site_id', currentSiteId)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('fleet_trips')
          .select('*, fleet_assets(id, asset_number, description)')
          .eq('site_id', currentSiteId)
          .order('trip_date', { ascending: false })
          .limit(200),
        supabase
          .from('fleet_compliance')
          .select('*, fleet_assets(id, asset_number, description)')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('expiry_date'),
      ])
      setAssetTypes(atRes.data || [])
      setAssets(aRes.data || [])
      setDepartments(dRes.data || [])
      setEmployees(eRes.data || [])
      setAssignments(asgnRes.data || [])
      setInspections(insRes.data || [])
      setWorkOrders(woRes.data || [])
      setTrips(trRes.data || [])
      setCompliance(cRes.data || [])
    } catch (err) {
      console.error('FleetContext load error:', err)
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Asset CRUD ────────────────────────────────────────────────────────────────

  async function addAsset(data) {
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .insert([{ ...data, site_id: currentSiteId }])
      .select('*, fleet_asset_types(id, name, category, icon)')
      .single()
    if (error) throw error
    setAssets(prev => [...prev, row].sort((a, b) => (a.asset_number || '').localeCompare(b.asset_number || '')))
    return row
  }

  async function updateAsset(id, data) {
    const { data: row, error } = await supabase
      .from('fleet_assets')
      .update(data)
      .eq('id', id)
      .eq('site_id', currentSiteId)
      .select('*, fleet_asset_types(id, name, category, icon)')
      .single()
    if (error) throw error
    setAssets(prev => prev.map(a => a.id === id ? row : a))
    return row
  }

  async function archiveAsset(id) {
    const { error } = await supabase
      .from('fleet_assets')
      .update({ is_archived: true, status: 'decommissioned' })
      .eq('id', id)
      .eq('site_id', currentSiteId)
    if (error) throw error
    setAssets(prev => prev.filter(a => a.id !== id))
  }

  // ── Computed helpers ──────────────────────────────────────────────────────────

  const categoryOf = useCallback((asset) => {
    if (asset.fleet_asset_types?.category) return asset.fleet_asset_types.category
    const t = assetTypes.find(at => at.id === asset.asset_type_id)
    return t?.category || null
  }, [assetTypes])

  const vehicles = useMemo(() => assets.filter(a => categoryOf(a) === 'vehicle'), [assets, categoryOf])
  const heavyEquipment = useMemo(() => assets.filter(a => categoryOf(a) === 'heavy_equipment'), [assets, categoryOf])
  const generators = useMemo(() => assets.filter(a => categoryOf(a) === 'generator'), [assets, categoryOf])

  const activeAssignments = useMemo(() =>
    assignments.filter(a => a.is_active === true),
    [assignments]
  )

  const expiringCompliance = useMemo(() => {
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    const cutoff = in30.toISOString().slice(0, 10)
    return compliance.filter(c => c.status !== 'expired' && c.expiry_date && c.expiry_date <= cutoff)
  }, [compliance])

  const assetsByStatus = useMemo(() => {
    const counts = {}
    assets.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1 })
    return counts
  }, [assets])

  const value = {
    loading, fetchAll,
    assetTypes, assets, departments, employees,
    assignments, inspections, workOrders, trips, compliance,
    vehicles, heavyEquipment, generators,
    activeAssignments, expiringCompliance, assetsByStatus,
    addAsset, updateAsset, archiveAsset,
  }

  return (
    <SiteRequired>
      <FleetContext.Provider value={value}>
        {children}
      </FleetContext.Provider>
    </SiteRequired>
  )
}

export function useFleet() {
  const ctx = useContext(FleetContext)
  if (!ctx) throw new Error('useFleet must be used within FleetProvider')
  return ctx
}
