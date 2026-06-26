import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'

// ── SiteContext ────────────────────────────────────────────────────────────────
// Phase scope (deliberately narrow): know which sites exist, know which sites
// the current user can access, and expose a "current site" selection.
//
// What this phase does NOT do yet: it does not change how any existing page
// fetches data. Employees, Daily Entry, Reports, Campsite — all of them keep
// querying exactly as they do today. Wiring those queries to actually filter
// by the selected site is a separate, later phase, reviewed on its own,
// specifically so this phase can't break anything currently working.
//
// Default behaviour matches today's real-world fact: every existing user is
// scoped to Kamativi (or, for System Administrator, has access to all sites
// but there is currently only one site with real data). Selecting a
// different site here changes nothing visible yet — it's the foundation the
// next phase builds on, not the filtering itself.

const SiteContext = createContext(null)

export function SiteProvider({ children }) {
  const { profile } = useAuth()
  const [allSites,        setAllSites]        = useState([])
  const [accessibleSites, setAccessibleSites] = useState([])
  const [hasAllSiteAccess, setHasAllSiteAccess] = useState(false)
  const [currentSiteId,   setCurrentSiteId]   = useState(null)
  const [loading,         setLoading]         = useState(true)

  const loadSiteAccess = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const [sitesRes, userRolesRes] = await Promise.all([
        supabase.from('sites').select('*').eq('is_active', true).order('name'),
        // A user_roles row with site_id = null means that role grants access
        // to every site, including ones created in the future — exactly the
        // "Group Administrator sees everything automatically" behaviour the
        // foundation was designed for.
        supabase.from('user_roles').select('site_id').eq('user_id', profile.id),
      ])

      const sites = sitesRes.data || []
      setAllSites(sites)

      const roleRows = userRolesRes.data || []
      const allSiteAccess = roleRows.some(r => r.site_id === null)
      setHasAllSiteAccess(allSiteAccess)

      let accessible
      if (allSiteAccess) {
        accessible = sites
      } else {
        const accessibleIds = new Set(roleRows.map(r => r.site_id).filter(Boolean))
        accessible = sites.filter(s => accessibleIds.has(s.id))
      }
      setAccessibleSites(accessible)

      // Default selection: Kamativi if accessible, otherwise the first
      // accessible site. This preserves today's behaviour exactly — every
      // current user either only has Kamativi, or (System Administrator)
      // defaults to seeing Kamativi first since it's the only site with
      // real data right now.
      setCurrentSiteId(prev => {
        if (prev && accessible.some(s => s.id === prev)) return prev // keep existing selection if still valid
        const kamativi = accessible.find(s => s.code === 'KAM')
        return kamativi?.id || accessible[0]?.id || null
      })
    } catch (err) {
      console.error('SiteContext load error:', err)
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { loadSiteAccess() }, [loadSiteAccess])

  const currentSite = allSites.find(s => s.id === currentSiteId) || null

  function switchSite(siteId) {
    if (accessibleSites.some(s => s.id === siteId)) {
      setCurrentSiteId(siteId)
    }
  }

  return (
    <SiteContext.Provider value={{
      allSites,
      accessibleSites,
      hasAllSiteAccess,
      currentSiteId,
      currentSite,
      switchSite,
      loading,
      refresh: loadSiteAccess,
    }}>
      {children}
    </SiteContext.Provider>
  )
}

export function useSite() {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error('useSite must be used inside SiteProvider')
  return ctx
}
