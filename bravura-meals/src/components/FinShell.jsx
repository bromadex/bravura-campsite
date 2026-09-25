import { FIN, useFinanceFonts } from '../utils/financeTheme'
import { FinEmbedContext } from './finEmbed'
import { useSite } from '../contexts/SiteContext'

// The Finance module's frame (issue #49 design): ground, IBM Plex type, serif title, breadcrumb,
// optional tabs. It also re-points the app's theme variables to the finance palette for everything
// inside it, so older screens built from the shared ui components (Card, Button, tables, modals)
// take on the same look without being rewritten.
const SCOPED_THEME = {
  '--color-primary': FIN.maroon, '--color-primary-dark': FIN.maroonDark, '--color-primary-hover': FIN.maroonDark,
  '--color-primary-light': '#C4545A', '--color-on-primary': '#FFFFFF',
  '--color-accent': FIN.blue, '--color-accent-dark': '#163A69', '--color-accent-light': '#9DB3D1',
  '--color-bg': FIN.ground, '--color-surface': FIN.card, '--color-surface-variant': '#F7F9F8', '--color-surface-hover': '#F2F5F3',
  '--color-outline': FIN.field, '--color-outline-variant': FIN.line,
  '--color-text': FIN.ink, '--color-text-medium': FIN.muted, '--color-text-low': FIN.faint,
  '--color-info': FIN.blue, '--color-success': FIN.good, '--color-error': FIN.bad, '--color-warning': FIN.ochreText,
}

export default function FinShell({ title, subtitle, actions, tabs, tab, onTab, setPage, children, embedChildren = true }) {
  useFinanceFonts()
  const { currentSite } = useSite()
  return (
    <div style={{ ...SCOPED_THEME, fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px',
      minHeight: '100%', fontVariantNumeric: 'tabular-nums', display: 'flex', flexDirection: 'column', gap: 16, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: FIN.muted }}>
            <button onClick={() => setPage?.('fi_dashboard')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Finance</button>
            {' · '}{currentSite?.name}
          </div>
          <h1 style={{ margin: '4px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 30, letterSpacing: '-0.01em' }}>{title}</h1>
          {subtitle && <div style={{ fontSize: 13, color: FIN.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {actions && <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div>}
      </header>
      {tabs && (
        <div role="tablist" aria-label={title} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.filter(Boolean).map(t => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => onTab(t.key)}
              style={{ minHeight: 40, padding: '0 16px', borderRadius: 20, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', fontWeight: tab === t.key ? 600 : 400,
                ...(tab === t.key ? { border: 'none', background: FIN.ink, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>
              {t.label}{t.count ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, borderRadius: 10, padding: '1px 7px', background: tab === t.key ? '#fff' : FIN.maroon, color: tab === t.key ? FIN.ink : '#fff' }}>{t.count}</span> : null}
            </button>
          ))}
        </div>
      )}
      <FinEmbedContext.Provider value={embedChildren}>
        <div style={{ minWidth: 0 }}>{children}</div>
      </FinEmbedContext.Provider>
    </div>
  )
}
