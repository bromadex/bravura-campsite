import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from './SiteContext'

const FuelContext = createContext(null)

export function FuelProvider({ children }) {
  const { currentSiteId } = useSite()

  const [tanks,       setTanks]       = useState([])
  const [receipts,    setReceipts]    = useState([])
  const [issues,      setIssues]      = useState([])
  const [dipReadings, setDipReadings] = useState([])
  const [profiles,    setProfiles]    = useState([])
  const [loading,     setLoading]     = useState(true)

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) { setLoading(false); return }
    setLoading(true)
    try {
      const [tRes, rRes, iRes, dRes, pRes] = await Promise.all([
        supabase.from('fuel_tanks').select('*').eq('site_id', currentSiteId).order('name'),
        supabase.from('fuel_receipts').select('*').eq('site_id', currentSiteId).order('receipt_date', { ascending: false }),
        supabase.from('fuel_issues').select('*').eq('site_id', currentSiteId).order('issue_date', { ascending: false }),
        supabase.from('fuel_dip_readings').select('*').eq('site_id', currentSiteId).order('reading_date', { ascending: false }),
        supabase.from('profiles').select('id, full_name').order('full_name'),
      ])
      setTanks(tRes.data || [])
      setReceipts(rRes.data || [])
      setIssues(iRes.data || [])
      setDipReadings(dRes.data || [])
      setProfiles(pRes.data || [])
    } catch (err) {
      console.error('FuelContext load error:', err)
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Computed helpers ──────────────────────────────────────────────────────────
  function tankBalance(tankId) {
    const received = receipts.filter(r => r.tank_id === tankId).reduce((s, r) => s + Number(r.quantity_litres), 0)
    const issued   = issues.filter(i => i.tank_id === tankId).reduce((s, i) => s + Number(i.quantity_litres), 0)
    return received - issued
  }

  function latestDip(tankId) {
    const readings = dipReadings.filter(d => d.tank_id === tankId)
    if (!readings.length) return null
    return readings.reduce((best, d) => (!best || d.reading_date > best.reading_date) ? d : best, null)
  }

  // ── Tanks CRUD ────────────────────────────────────────────────────────────────
  async function addTank(data) {
    const { data: row, error } = await supabase
      .from('fuel_tanks').insert([{ ...data, site_id: currentSiteId }]).select().single()
    if (error) throw error
    setTanks(prev => [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
    return row
  }

  async function updateTank(id, data) {
    const { data: row, error } = await supabase
      .from('fuel_tanks').update(data).eq('id', id).select().single()
    if (error) throw error
    setTanks(prev => prev.map(t => t.id === id ? row : t))
    return row
  }

  async function deleteTank(id) {
    const { error } = await supabase.from('fuel_tanks').delete().eq('id', id)
    if (error) throw error
    setTanks(prev => prev.filter(t => t.id !== id))
  }

  // ── Receipts CRUD ─────────────────────────────────────────────────────────────
  async function addReceipt(data) {
    const { data: row, error } = await supabase
      .from('fuel_receipts').insert([{ ...data, site_id: currentSiteId }]).select().single()
    if (error) throw error
    setReceipts(prev => [row, ...prev])
    return row
  }

  async function deleteReceipt(id) {
    const { error } = await supabase.from('fuel_receipts').delete().eq('id', id)
    if (error) throw error
    setReceipts(prev => prev.filter(r => r.id !== id))
  }

  // ── Issues CRUD ───────────────────────────────────────────────────────────────
  async function addIssue(data) {
    const { data: row, error } = await supabase
      .from('fuel_issues').insert([{ ...data, site_id: currentSiteId }]).select().single()
    if (error) throw error
    setIssues(prev => [row, ...prev])
    return row
  }

  async function deleteIssue(id) {
    const { error } = await supabase.from('fuel_issues').delete().eq('id', id)
    if (error) throw error
    setIssues(prev => prev.filter(i => i.id !== id))
  }

  // ── Dip Readings CRUD ─────────────────────────────────────────────────────────
  async function addDipReading(data) {
    const { data: row, error } = await supabase
      .from('fuel_dip_readings').insert([{ ...data, site_id: currentSiteId }]).select().single()
    if (error) throw error
    setDipReadings(prev => [row, ...prev])
    return row
  }

  async function deleteDipReading(id) {
    const { error } = await supabase.from('fuel_dip_readings').delete().eq('id', id)
    if (error) throw error
    setDipReadings(prev => prev.filter(d => d.id !== id))
  }

  return (
    <FuelContext.Provider value={{
      tanks, receipts, issues, dipReadings, profiles, loading,
      tankBalance, latestDip,
      addTank, updateTank, deleteTank,
      addReceipt, deleteReceipt,
      addIssue, deleteIssue,
      addDipReading, deleteDipReading,
      refresh: fetchAll,
    }}>
      {children}
    </FuelContext.Provider>
  )
}

export function useFuel() {
  const ctx = useContext(FuelContext)
  if (!ctx) throw new Error('useFuel must be used inside FuelProvider')
  return ctx
}
