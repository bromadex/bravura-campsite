import { useState, useEffect } from 'react'
import { THEME } from '../utils/permissions'

/**
 * Shows a dismissible "Install App" banner when the browser fires
 * the `beforeinstallprompt` event (Chrome / Edge / Android WebView).
 * On iOS the banner shows manual instructions instead, since iOS doesn't
 * support the prompt API.
 */
export default function InstallBanner() {
  const [prompt,    setPrompt]    = useState(null)
  const [showIOS,   setShowIOS]   = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (localStorage.getItem('pwa_install_dismissed')) return

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isStandalone) return

    if (isIOS && !isStandalone) {
      setShowIOS(true)
      return
    }

    function onBeforeInstall(e) {
      e.preventDefault()
      setPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  function dismiss() {
    localStorage.setItem('pwa_install_dismissed', '1')
    setPrompt(null)
    setShowIOS(false)
    setDismissed(true)
  }

  async function install() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') dismiss()
    else setPrompt(null)
  }

  if (dismissed || (!prompt && !showIOS)) return null

  const banner = {
    position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
    zIndex: 9999, display: 'flex', alignItems: 'center', gap: '12px',
    background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
    borderRadius: '12px', padding: '12px 16px',
    boxShadow: '0 4px 20px rgba(0,0,0,.18)',
    maxWidth: '420px', width: 'calc(100vw - 32px)',
    fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
  }

  return (
    <div style={banner}>
      <div style={{
        width: 40, height: 40, borderRadius: '10px', flexShrink: 0,
        background: '#982329', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="material-symbols-rounded" style={{ color: '#fff', fontSize: 22 }}>home_app_logo</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>Install Bravura</div>
        {showIOS
          ? <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: 2 }}>
              Tap <strong>Share</strong> then <strong>Add to Home Screen</strong>
            </div>
          : <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: 2 }}>
              Add to your home screen for quick access
            </div>
        }
      </div>
      {!showIOS && (
        <button onClick={install} style={{
          background: '#982329', color: '#fff', border: 'none', borderRadius: '6px',
          padding: '7px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          flexShrink: 0,
        }}>
          Install
        </button>
      )}
      <button onClick={dismiss} style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
        color: THEME.textLow, flexShrink: 0, display: 'flex', alignItems: 'center',
      }}>
        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
      </button>
    </div>
  )
}
