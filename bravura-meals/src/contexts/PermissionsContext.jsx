import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { useSite } from './SiteContext'

// ── PermissionsContext ────────────────────────────────────────────────────────
// Phase scope (deliberately narrow, same pattern SiteContext shipped with):
// this makes REAL RBAC data — roles → role_permissions → permissions,
// scoped by user_roles.site_id — queryable from anywhere via can('module.action').
//
// What this phase does NOT do: it does not replace a single existing
// permission check anywhere in the app. Every page still gates access
// exactly the way it did before this phase, using the old hardcoded
// can.* functions in permissions.js. Swapping those over happens module by
// module, as its own separate, reviewable phase — specifically so a mistake
// in one module's swap can't take down every other module's access control
// at the same time.
//
// A user_roles row with site_id = null grants that permission everywhere,
// including sites created in the future — this is what makes System
// Administrator / Group Administrator work correctly without needing a row
// per site.

const PermissionsContext = createContext(null)

export function PermissionsProvider({ children }) {
  const { profile } = useAuth()
  const { currentSiteId } = useSite()
  const [allSiteGrants,    setAllSiteGrants]    = useState(new Set())
  const [siteScopedGrants, setSiteScopedGrants] = useState(new Map())
  const [loading,          setLoading]          = useState(true)

  const loadPermissions = useCallback(async () => {
    if (!profile?.id) { setLoading(false); return }
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select(`
          site_id,
          roles (
            role_permissions (
              permissions ( code )
            )
          )
        `)
        .eq('user_id', profile.id)

      if (error) throw error

      const allSite = new Set()
      const scoped  = new Map()

      ;(data || []).forEach(row => {
        const codes = (row.roles?.role_permissions || [])
          .map(rp => rp.permissions?.code)
          .filter(Boolean)

        if (row.site_id === null) {
          codes.forEach(c => allSite.add(c))
        } else {
          if (!scoped.has(row.site_id)) scoped.set(row.site_id, new Set())
          codes.forEach(c => scoped.get(row.site_id).add(c))
        }
      })

      setAllSiteGrants(allSite)
      setSiteScopedGrants(scoped)
    } catch (err) {
      console.error('PermissionsContext load error:', err)
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => { loadPermissions() }, [loadPermissions])

  // can('accommodation.approve') checks the user's CURRENT site by default.
  // An explicit siteId can be passed for cases like "could this user manage
  // Selous" regardless of what site they're currently viewing — useful later
  // for things like a transfer form picking a destination site.
  //
  // Memoized: this provider wraps the entire app, so an unstable `can`
  // reference (or value object) forces a full-tree re-render on every
  // provider render. References only change when the grants or site change.
  const can = useCallback((code, siteId = currentSiteId) => {
    if (allSiteGrants.has(code)) return true
    if (siteId && siteScopedGrants.get(siteId)?.has(code)) return true
    return false
  }, [allSiteGrants, siteScopedGrants, currentSiteId])

  const canAny = useCallback(
    (codes, siteId = currentSiteId) => codes.some(c => can(c, siteId)),
    [can, currentSiteId]
  )

  const value = useMemo(
    () => ({ can, canAny, loading, refresh: loadPermissions }),
    [can, canAny, loading, loadPermissions]
  )

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function usePermissions() {
  const ctx = useContext(PermissionsContext)
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider')
  return ctx
}
