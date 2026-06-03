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
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err.message || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: `linear-gradient(135deg, ${THEME.sidebarDark} 0%, ${THEME.sidebar} 60%, ${THEME.primaryLight} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Segoe UI', Arial, sans-serif", padding: '16px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Decorative circles */}
      <div style={{ position:'absolute', width:'400px', height:'400px', borderRadius:'50%', background:'rgba(255,255,255,.03)', top:'-100px', right:'-80px', pointerEvents:'none' }} />
      <div style={{ position:'absolute', width:'300px', height:'300px', borderRadius:'50%', background:'rgba(255,255,255,.03)', bottom:'-60px', left:'-60px', pointerEvents:'none' }} />

      <div style={{
        background: '#fff',
        borderRadius: '18px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 24px 80px rgba(0,0,0,.35)',
        position: 'relative',
        borderTop: `5px solid ${THEME.accent}`,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '68px', height: '68px', borderRadius: '18px',
            background: `linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.accent} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 14px', fontSize: '32px',
            boxShadow: `0 8px 24px ${THEME.primary}55`,
          }}>
            🍽️
          </div>
          <h1 style={{ fontSize: '20px', fontWeight: 800, color: THEME.primary, margin: 0, letterSpacing: '-.02em' }}>
            Bravura Zimbabwe
          </h1>
          <p style={{ fontSize: '13px', color: '#aaa', margin: '4px 0 0' }}>
            Meal Management System · Kamativi
          </p>
        </div>

        <form onSubmit={handleLogin}>
          {/* Email */}
          <div style={{ marginBottom: '14px' }}>
            <label style={{
              display: 'block', fontSize: '11px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.06em',
              color: THEME.primary, marginBottom: '6px',
            }}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              style={{
                width: '100%', padding: '11px 14px',
                border: `1.5px solid ${THEME.cardBorder}`,
                borderRadius: '10px', fontSize: '14px', color: '#1a1a2e',
                fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = THEME.primary}
              onBlur={e => e.target.style.borderColor = THEME.cardBorder}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: '22px' }}>
            <label style={{
              display: 'block', fontSize: '11px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '.06em',
              color: THEME.primary, marginBottom: '6px',
            }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: '100%', padding: '11px 42px 11px 14px',
                  border: `1.5px solid ${THEME.cardBorder}`,
                  borderRadius: '10px', fontSize: '14px', color: '#1a1a2e',
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.target.style.borderColor = THEME.primary}
                onBlur={e => e.target.style.borderColor = THEME.cardBorder}
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)}
                style={{
                  position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                  background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#aaa',
                }}
              >
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && (
            <div style={{
              background: '#FFE0E0', color: '#C00000', border: '1px solid #f5b8b8',
              borderRadius: '10px', padding: '10px 14px', fontSize: '13px', marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '13px',
              background: loading ? '#aaa' : `linear-gradient(135deg, ${THEME.primary} 0%, ${THEME.accent} 100%)`,
              color: '#fff', border: 'none', borderRadius: '10px',
              fontSize: '14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', boxShadow: loading ? 'none' : `0 4px 16px ${THEME.primary}44`,
              transition: 'all 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '11px', color: '#ccc', marginTop: '24px', marginBottom: 0 }}>
          Secured · Kamativi Mine Site · Bravura Zimbabwe Ltd
        </p>
      </div>
    </div>
  )
}
