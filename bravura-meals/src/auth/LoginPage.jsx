import { useState } from 'react'
import { useAuth } from './AuthContext'
import { THEME } from '../utils/permissions'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [showPw,   setShowPw]   = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try { await signIn(email, password) }
    catch (err) { setError(err.message || 'Login failed. Check your credentials.') }
    finally { setLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: THEME.sidebar,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Google Sans', 'Segoe UI', Arial, sans-serif", padding: '16px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Decorative background shapes */}
      <div style={{ position:'absolute', width:'500px', height:'500px', borderRadius:'50%', border: '1px solid rgba(255,255,255,.04)', top:'-160px', right:'-120px', pointerEvents:'none' }} />
      <div style={{ position:'absolute', width:'360px', height:'360px', borderRadius:'50%', border: '1px solid rgba(255,255,255,.04)', bottom:'-100px', left:'-80px', pointerEvents:'none' }} />

      <div style={{
        background: THEME.surface,
        borderRadius: '28px',
        padding: '40px',
        width: '100%', maxWidth: '400px',
        boxShadow: '0 24px 80px rgba(0,0,0,.4)',
        position: 'relative',
      }}>
        {/* Logomark */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <img
            src="/logo/bravura-logo.png"
            alt="Bravura"
            style={{ height: '64px', width: 'auto', margin: '0 auto 16px', display: 'block' }}
          />
          <h1 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0, letterSpacing: '-.01em' }}>
            Bravura Zimbabwe
          </h1>
          <p style={{ fontSize: '13px', color: THEME.textLow, margin: '6px 0 0' }}>
            Meal Management System
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{
              display: 'block', fontSize: '12px', fontWeight: 500,
              color: THEME.textMed, marginBottom: '6px',
            }}>
              Email address
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              required placeholder="your@email.com"
              style={{
                width: '100%', padding: '12px 16px',
                border: `1px solid ${THEME.outline}`,
                borderRadius: '14px', fontSize: '14px', color: THEME.text,
                fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                transition: 'border-color .15s, box-shadow .15s',
              }}
              onFocus={e => { e.target.style.borderColor = THEME.primary; e.target.style.boxShadow = `0 0 0 3px ${THEME.primary}22` }}
              onBlur={e => { e.target.style.borderColor = THEME.outline; e.target.style.boxShadow = 'none' }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block', fontSize: '12px', fontWeight: 500,
              color: THEME.textMed, marginBottom: '6px',
            }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                required placeholder="••••••••"
                style={{
                  width: '100%', padding: '12px 48px 12px 16px',
                  border: `1px solid ${THEME.outline}`,
                  borderRadius: '14px', fontSize: '14px', color: THEME.text,
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color .15s, box-shadow .15s',
                }}
                onFocus={e => { e.target.style.borderColor = THEME.primary; e.target.style.boxShadow = `0 0 0 3px ${THEME.primary}22` }}
                onBlur={e => { e.target.style.borderColor = THEME.outline; e.target.style.boxShadow = 'none' }}
              />
              <button
                type="button" onClick={() => setShowPw(p => !p)}
                style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', color: THEME.textLow,
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>
                  {showPw ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '10px',
              background: THEME.statusErrorBg, border: `1px solid ${THEME.error}55`,
              borderRadius: '14px', padding: '12px 16px', marginBottom: '16px',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.error, flexShrink: 0, marginTop: '1px' }}>error</span>
              <span style={{ fontSize: '13px', color: THEME.error }}>{error}</span>
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              width: '100%', padding: '14px',
              background: loading ? THEME.textLow : THEME.primary,
              color: '#fff', border: 'none', borderRadius: '14px',
              fontSize: '14px', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', letterSpacing: '.01em',
              transition: 'background .15s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            {loading ? (
              <>
                <span className="material-symbols-rounded" style={{ fontSize: '18px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
                Signing in…
              </>
            ) : 'Sign in'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '11px', color: THEME.textLow, marginTop: '24px', marginBottom: 0 }}>
          Kamativi Mine Site · Bravura Zimbabwe Ltd
        </p>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
