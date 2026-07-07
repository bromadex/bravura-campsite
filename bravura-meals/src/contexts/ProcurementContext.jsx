import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from './SiteContext'

const ProcurementContext = createContext(null)

export function ProcurementProvider({ children }) {
  const { currentSiteId } = useSite()
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading]     = useState(true)

  const fetchAll = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data } = await supabase
      .from('procurement_suppliers')
      .select('*')
      .eq('site_id', currentSiteId)
      .order('supplier_name')
    setSuppliers(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchAll() }, [fetchAll])

  return (
    <ProcurementContext.Provider value={{ suppliers, setSuppliers, loading, fetchAll }}>
      {children}
    </ProcurementContext.Provider>
  )
}

export function useProcurement() {
  const ctx = useContext(ProcurementContext)
  if (!ctx) throw new Error('useProcurement must be inside ProcurementProvider')
  return ctx
}
