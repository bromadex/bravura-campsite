import { useState, useRef, useEffect } from 'react'
import { useSite } from '../contexts/SiteContext'
import { THEME } from '../utils/permissions'
import { Icon } from './ui'

// ── Site switcher chip ────────────────────────────────────────────────────────
// Renders nothing if the current user only has access to one site — which is
// every real user today except System Administrator. This is intentional:
// a switcher with one option is just noise.
//
// IMPORTANT — current scope: switching sites here does not yet change what
// data any page shows. Every existing page still queries exactly as it did
// before this phase. This component only makes the *selection* real; making
// the rest of the app actually respect that selection is the next phase.
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
        title="Switch site — selection does not yet filter page data"
        style={{
          display: 'flex', alignItems: 'center', gap: '5px',
          padding: '5px 12px', borderRadius: '20px', cursor: 'pointer',
          background: open ? THEME.surfaceVar : '#fff',
          border: `1px solid ${THEME.outlineVar}`,
          fontSize: '12px', fontWeight: 600, color: THEME.primary,
        }}
      >
        <Icon name="location_on" size={14} style={{ color: THEME.primary }} />
        {currentSite?.name || 'Select site'}
        <Icon name={open ? 'expand_less' : 'expand_more'} size={14} style={{ color: THEME.textLow }} />
      </div>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 50,
          background: '#fff', borderRadius: '12px', minWidth: '180px',
          boxShadow: '0 4px 16px rgba(0,0,0,.12)', border: `1px solid ${THEME.outlineVar}`,
          overflow: 'hidden',
        }}>
          {accessibleSites.map(site => (
            <div
              key={site.id}
              onClick={() => { switchSite(site.id); setOpen(false) }}
              style={{
                padding: '10px 14px', cursor: 'pointer', fontSize: '13px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: site.id === currentSite?.id ? THEME.surfaceVar : '#fff',
                color: site.id === currentSite?.id ? THEME.primary : THEME.text,
                fontWeight: site.id === currentSite?.id ? 600 : 400,
              }}
              onMouseEnter={e => { if (site.id !== currentSite?.id) e.currentTarget.style.background = THEME.bg }}
              onMouseLeave={e => { if (site.id !== currentSite?.id) e.currentTarget.style.background = '#fff' }}
            >
              {site.name}
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
