import { useSite } from '../contexts/SiteContext'
import { THEME } from '../utils/permissions'
import { Icon } from './ui'
import SiteSwitcher from './SiteSwitcher'

// ── SiteRequired ──────────────────────────────────────────────────────────────
// Renders a clean empty state when no site is selected (e.g. a super-admin
// who hasn't picked a site yet). Children render only when currentSiteId
// is set and the site context has finished loading.
//
// Design rule: every module that scopes data by site MUST wrap its content
// in this guard. This prevents any page from ever querying or displaying
// data without a valid site_id — enforced at the render layer, not just
// in data-fetch logic.
export default function SiteRequired({ children, moduleColor }) {
  const { currentSiteId, loading, accessibleSites } = useSite()
  const color = moduleColor || THEME.primary

  // Still resolving site access — show nothing (parent ModuleShell already
  // shows a spinner while auth/permissions are loading; SiteContext resolves
  // quickly after that).
  if (loading) return null

  // No accessible sites at all — configuration problem.
  if (!loading && accessibleSites.length === 0) return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: '16px',
      fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
    }}>
      <div style={{
        width: '56px', height: '56px', borderRadius: '18px',
        background: THEME.statusErrorBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="location_off" size={28} style={{ color: THEME.error }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '17px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>
          No site access
        </div>
        <div style={{ fontSize: '14px', color: THEME.textMed, maxWidth: '320px', lineHeight: 1.6 }}>
          Your account doesn't have access to any site yet. Ask your System Admin to assign you to a site.
        </div>
      </div>
    </div>
  )

  // Site context loaded but no site selected yet (super-admin edge case).
  if (!currentSiteId) return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '60vh', gap: '20px',
      fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
    }}>
      <div style={{
        width: '56px', height: '56px', borderRadius: '18px',
        background: color + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="location_on" size={28} style={{ color }} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '17px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>
          Select a site to continue
        </div>
        <div style={{ fontSize: '14px', color: THEME.textMed, maxWidth: '300px', lineHeight: 1.6, marginBottom: '16px' }}>
          This module is scoped per site. Use the site switcher in the top bar to choose which site to view.
        </div>
        <SiteSwitcher />
      </div>
    </div>
  )

  return children
}
