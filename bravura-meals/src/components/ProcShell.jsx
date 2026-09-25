import { useState, useEffect, useMemo } from 'react'
import FinShell from './FinShell'
import { useSite } from '../contexts/SiteContext'
import { FIN } from '../utils/financeTheme'

// Procurement's frame (issue #50): the finance look, with Procurement as the breadcrumb.
export default function ProcShell(props) {
  return <FinShell module="Procurement" homePage="proc_dashboard" {...props} />
}

// HQ buys for every site, so Procurement lists can show "this site" or "all my sites".
// The choice is remembered per person on this device.
export function useSiteScope() {
  const { currentSiteId, currentSite, accessibleSites } = useSite()
  const multi = (accessibleSites || []).length > 1
  const [scope, setScopeState] = useState(() => {
    try { return localStorage.getItem('proc_site_scope') || 'site' } catch { return 'site' }
  })
  function setScope(v) {
    setScopeState(v)
    try { localStorage.setItem('proc_site_scope', v) } catch { /* storage unavailable */ }
  }
  useEffect(() => { if (!multi && scope !== 'site') setScopeState('site') }, [multi, scope])
  const siteIds = useMemo(() => (scope === 'all' && multi ? accessibleSites.map(s => s.id) : (currentSiteId ? [currentSiteId] : [])),
    [scope, multi, accessibleSites, currentSiteId])
  const label = scope === 'all' && multi ? 'All sites' : currentSite?.name
  return { scope, setScope, siteIds, multi, label, sites: accessibleSites || [] }
}

export function SiteScopeToggle({ scope, setScope, multi, siteName }) {
  if (!multi) return null
  const opt = (k, text) => (
    <button key={k} role="radio" aria-checked={scope === k} onClick={() => setScope(k)}
      style={{ minHeight: 36, padding: '0 14px', border: 'none', borderRadius: 18, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
        fontWeight: scope === k ? 600 : 400, background: scope === k ? FIN.ink : 'transparent', color: scope === k ? '#fff' : FIN.ink }}>{text}</button>
  )
  return (
    <div role="radiogroup" aria-label="Sites shown" style={{ display: 'inline-flex', gap: 2, padding: 3, borderRadius: 22, background: '#fff', border: `1px solid ${FIN.field}` }}>
      {opt('site', siteName || 'This site')}
      {opt('all', 'All sites')}
    </div>
  )
}
