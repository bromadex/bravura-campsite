import { useState, useEffect } from 'react'
import { THEME } from '../utils/permissions'

/**
 * Install prompt banner. Reads a pre-buffered event from
 * window.__deferredInstallPrompt (populated in index.html before React
 * mounts, so Chrome's early beforeinstallprompt is never missed). Falls
 * back to iOS "Add to Home Screen" instructions on Safari, where the
 * prompt API doesn't exist.
 */
export default function InstallBanner() {
  const [prompt,    setPrompt]    = useState(() =>
    typeof window !== 'undefined' ? window.__deferredInstallPrompt : null
  )
  const [showIOS,   setShowIOS]   = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    if (isStandalone) return

    if (localStorage.getItem('pwa_install_dismissed')) return

    if (isIOS) {
      setShowIOS(true)
      return
    }

    // Late-arriving prompt: index.html buffers to __deferredInstallPrompt
    // and fires bravura-install-ready. Also keep listening in case the
    // browser fires beforeinstallprompt again after the SW activates.
    function absorbBuffered() {
      if (window.__deferredInstallPrompt) {
        setPrompt(window.__deferredInstallPrompt)
      }
    }
    function onDirect(e) {
      e.preventDefault()
      setPrompt(e)
    }
    absorbBuffered()
    window.addEventListener('bravura-install-ready', absorbBuffered)
    window.addEventListener('beforeinstallprompt', onDirect)
    return () => {
      window.removeEventListener('bravura-install-ready', absorbBuffered)
      window.removeEventListener('beforeinstallprompt', onDirect)
    }
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
    window.__deferredInstallPrompt = null
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
