import { Component } from 'react'
import { THEME } from '../utils/permissions'
import { supabase } from '../supabaseClient'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, retryCount: 0, reported: false, reporting: false }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidMount() {
    if (this.state.error === null) sessionStorage.removeItem('bravura_reload_attempted')
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    this._componentStack = info.componentStack

    const msg = String(error?.message || '')
    const isChunkFailure =
      /dynamically imported module/i.test(msg) ||
      /Loading chunk [\d]+ failed/i.test(msg) ||
      /Importing a module script failed/i.test(msg)

    if (isChunkFailure && !sessionStorage.getItem('bravura_reload_attempted')) {
      sessionStorage.setItem('bravura_reload_attempted', '1')
      window.location.reload()
      return
    }

    if (this.props.level === 'page' && this.state.retryCount < 1) {
      this.setState(s => ({ error: null, retryCount: s.retryCount + 1 }))
    }
  }

  async alertAdmin() {
    this.setState({ reporting: true })
    const { error } = this.state
    const pageUrl = window.location.href
    const errorMsg = error?.message || 'Unknown error'
    const stack = (this._componentStack || '').trim().split('\n').slice(0, 5).join('\n')

    const body = [
      `Page: ${pageUrl}`,
      `Error: ${errorMsg}`,
      stack ? `\nComponent stack:\n${stack}` : '',
      `\nBrowser: ${navigator.userAgent}`,
      `Time: ${new Date().toISOString()}`,
    ].filter(Boolean).join('\n')

    const { error: dbErr } = await supabase.from('feedback_submissions').insert({
      module: null,
      kind: 'bug',
      title: `[Auto] Page crash: ${errorMsg.slice(0, 80)}`,
      body,
      submitter_id: null,
    })

    if (dbErr) {
      this.setState({ reporting: false })
      try { await navigator.clipboard.writeText(`Bug report — ${pageUrl}\n\n${body}`) } catch {}
      alert('Could not submit automatically. The error details have been copied to your clipboard — please paste them to the system admin.')
      return
    }

    try { await navigator.clipboard.writeText(pageUrl) } catch {}
    this.setState({ reported: true, reporting: false })
  }

  render() {
    if (!this.state.error) return this.props.children

    const { error, reported, reporting } = this.state
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
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            onClick={() => isPage ? this.setState({ error: null, reported: false }) : window.location.reload()}
            style={{
              padding: '9px 20px', borderRadius: '6px', border: 'none',
              background: THEME.primary, color: '#fff', fontSize: '13px', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isPage ? 'Try again' : 'Refresh page'}
          </button>
          <button
            onClick={() => this.alertAdmin()}
            disabled={reported || reporting}
            style={{
              padding: '9px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
              cursor: reported || reporting ? 'default' : 'pointer',
              border: `1.5px solid ${reported ? THEME.success : THEME.error}`,
              background: reported ? THEME.success + '14' : 'transparent',
              color: reported ? THEME.success : THEME.error,
              display: 'flex', alignItems: 'center', gap: '6px',
              opacity: reporting ? 0.6 : 1,
            }}
          >
            <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>
              {reported ? 'check_circle' : 'flag'}
            </span>
            {reporting ? 'Sending...' : reported ? 'Admin alerted — link copied' : 'Alert Admin'}
          </button>
        </div>
        {reported && (
          <div style={{ fontSize: '11px', color: THEME.success, marginTop: '10px', maxWidth: '400px' }}>
            Error report submitted to the feedback board. The page link has been copied to your clipboard.
          </div>
        )}
      </div>
    )
  }
}
