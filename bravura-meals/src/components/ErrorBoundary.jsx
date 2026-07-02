import { Component } from 'react'
import { THEME } from '../utils/permissions'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidMount() {
    // Clear the one-shot reload guard on any healthy mount so a later
    // chunk failure can still recover.
    if (this.state.error === null) sessionStorage.removeItem('bravura_reload_attempted')
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)

    // Stale-deploy recovery: when Vercel ships a new build, the old JS
    // chunks referenced by the cached index.html get purged from the CDN.
    // The next lazy import then fails with "Failed to fetch dynamically
    // imported module". Force a full reload so the browser fetches the
    // fresh index.html + new chunk hashes. Guarded to reload at most once
    // per session so a genuinely broken chunk can't cause a reload loop.
    const msg = String(error?.message || '')
    const isChunkFailure =
      /dynamically imported module/i.test(msg) ||
      /Loading chunk [\d]+ failed/i.test(msg) ||
      /Importing a module script failed/i.test(msg)

    if (isChunkFailure && !sessionStorage.getItem('bravura_reload_attempted')) {
      sessionStorage.setItem('bravura_reload_attempted', '1')
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) return this.props.children

    const { error } = this.state
    const isPage = this.props.level === 'page'

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: isPage ? '300px' : '100vh',
        padding: '40px 24px', textAlign: 'center',
        background: isPage ? 'transparent' : THEME.bg,
        fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
      }}>
        <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.error, marginBottom: '16px' }}>
          error
        </span>
        <div style={{ fontSize: '17px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>
          {isPage ? 'This page ran into a problem' : 'Something went wrong'}
        </div>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '24px', maxWidth: '400px' }}>
          {isPage
            ? 'The rest of the app is still working. Try refreshing or navigating to another page.'
            : 'Please refresh the page. If the problem persists, contact support.'}
        </div>
        {isPage && (
          <div style={{
            fontSize: '11px', color: THEME.textLow, fontFamily: 'monospace',
            background: THEME.surfaceVar, padding: '8px 14px', borderRadius: '8px',
            maxWidth: '500px', wordBreak: 'break-word',
          }}>
            {error.message}
          </div>
        )}
        <button
          onClick={() => isPage ? this.setState({ error: null }) : window.location.reload()}
          style={{
            marginTop: '20px', padding: '9px 20px', borderRadius: '6px', border: 'none',
            background: THEME.primary, color: '#fff', fontSize: '13px', fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {isPage ? 'Try again' : 'Refresh page'}
        </button>
      </div>
    )
  }
}
