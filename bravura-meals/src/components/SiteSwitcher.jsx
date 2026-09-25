import { useState, useRef, useEffect } from 'react'
import { useSite } from '../contexts/SiteContext'
import { THEME } from '../utils/permissions'
import { Icon } from './ui'

// ── Site switcher chip ────────────────────────────────────────────────────────
// Renders nothing if the current user only has access to one site — which is
// every real user today except System Administrator. This is intentional:
// a switcher with one option is just noise.
export default function SiteSwitcher() {
  const { accessibleSites, currentSite, switchSite, loading } = useSite()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (loading || accessibleSites.length <= 1) return null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        title="Switch site"
        style={{
          display: 'flex', alignItems: 'center', gap: '7px', height: '38px',
          padding: '0 12px 0 10px', borderRadius: '12px', cursor: 'pointer',
          background: open ? THEME.surfaceVar : THEME.surface,
          border: `1px solid ${THEME.outlineVar}`, boxShadow: '0 1px 2px rgba(0,0,0,.04)',
          fontSize: '13px', fontWeight: 600, color: THEME.text,
        }}
      >
        <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22A06B', boxShadow: '0 0 0 3px #22A06B26' }} />
        {currentSite?.name || 'Select site'}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={16} style={{ color: THEME.textLow }} />
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
          background: THEME.surface, borderRadius: '12px', minWidth: '180px',
          boxShadow: THEME.shadow2, border: `1px solid ${THEME.outlineVar}`,
          overflow: 'hidden',
        }}>
          {accessibleSites.map(site => (
            <div
              key={site.id}
              onClick={() => { switchSite(site.id); setOpen(false) }}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: site.id === currentSite?.id ? THEME.surfaceVar : THEME.surface,
                color: site.id === currentSite?.id ? THEME.primary : THEME.text,
                fontWeight: site.id === currentSite?.id ? 600 : 400,
              }}
              onMouseEnter={e => { if (site.id !== currentSite?.id) e.currentTarget.style.background = THEME.surfaceHover }}
              onMouseLeave={e => { if (site.id !== currentSite?.id) e.currentTarget.style.background = THEME.surface }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {site.name}
                {site.site_type === 'head_office' && (
                  <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: '4px', background: '#5C6BC0', color: '#fff', letterSpacing: '.04em' }}>HQ</span>
                )}
              </span>
              {site.id === currentSite?.id && (
                <Icon name="check" size={15} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
