import { useState } from 'react'
import { useAuth } from './AuthContext'

export default function LoginPage() {
  const { signIn } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

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
      background: 'linear-gradient(135deg, #1F3864 0%, #2F5496 60%, #1F3864 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Segoe UI', Arial, sans-serif",
      padding: '16px',
    }}>
      {/* Background pattern */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle at 20% 80%, rgba(196,90,17,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(68,114,196,0.2) 0%, transparent 50%)',
      }} />

      <div style={{
        background: '#fff',
        borderRadius: '16px',
        padding: '40px',
        width: '100%',
        maxWidth: '400px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.3)',
        position: 'relative',
      }}>
        {/* Logo area */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '16px',
            background: '#1F3864',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: '28px',
          }}>
            🍽️
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#1F3864', margin: 0 }}>
            Bravura Zimbabwe
          </h1>
          <p style={{ fontSize: '14px', color: '#888', margin: '4px 0 0' }}>
            Meal Management System
          </p>
        </div>

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{
              display: 'block', fontSize: '11px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: '#4a5568', marginBottom: '5px',
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
                width: '100%', padding: '10px 12px', border: '1px solid #dde2ea',
                borderRadius: '8px', fontSize: '14px', color: '#1a1a2e',
                fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = '#4472C4'}
              onBlur={e => e.target.style.borderColor = '#dde2ea'}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block', fontSize: '11px', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color: '#4a5568', marginBottom: '5px',
            }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid #dde2ea',
                borderRadius: '8px', fontSize: '14px', color: '#1a1a2e',
                fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => e.target.style.borderColor = '#4472C4'}
              onBlur={e => e.target.style.borderColor = '#dde2ea'}
            />
          </div>

          {error && (
            <div style={{
              background: '#FFE0E0', color: '#C00000', border: '1px solid #f5b8b8',
              borderRadius: '8px', padding: '10px 14px', fontSize: '13px',
              marginBottom: '16px',
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px', background: loading ? '#4a5568' : '#1F3864',
              color: '#fff', border: 'none', borderRadius: '8px',
              fontSize: '14px', fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', transition: 'background 0.15s',
            }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p style={{ textAlign: 'center', fontSize: '12px', color: '#aaa', marginTop: '24px', marginBottom: 0 }}>
          Kamativi Mine Site · Secure Access
        </p>
      </div>
    </div>
  )
}
