import { useState } from 'react'
import { MODULE_COLORS, THEME } from '../utils/permissions'

// The Meals module requires re-authentication (PIN) even after main login.
// PIN is the last 4 digits of the user's password — or a separate meals_pin
// stored in the profile. For now we validate against a fixed per-role PIN
// stored in Supabase profiles.meals_pin column (fallback: '1234' for dev).

const COLOR = MODULE_COLORS.meals

export default function MealsPinGate({ profile, onUnlock, onBack }) {
  const [pin,     setPin]     = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  // Expected PIN: profile.meals_pin if set, otherwise last 4 chars of role name (dev fallback)
  async function verify() {
    if (pin.length < 4) { setError('Enter a 4-digit PIN'); return }
    setLoading(true)
    setError('')

    // Import supabase here to verify pin against profiles table
    const { supabase } = await import('../supabaseClient')
    const { data } = await supabase
      .from('profiles')
      .select('meals_pin')
      .eq('id', profile.id)
      .single()

    const stored = data?.meals_pin || null

    // If no PIN has been set yet for this user, accept '0000' (admin can set it later)
    const expected = stored || '0000'
    setLoading(false)

    if (pin === expected) {
      onUnlock()
    } else {
      setError('Incorrect PIN. Try again.')
      setPin('')
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter') verify()
  }

  return (
    <div style={{
      minHeight: '100vh', background: '#F0F2F5',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
      padding: '16px',
    }}>
      <div style={{
        background: '#fff', borderRadius: '24px', padding: '40px 32px',
        maxWidth: '360px', width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,.12)',
        textAlign: 'center',
        borderTop: `5px solid ${COLOR}`,
      }}>
        {/* Icon */}
        <div style={{
          width: '72px', height: '72px', borderRadius: '20px',
          background: COLOR + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 20px',
        }}>
          <span className="material-symbols-rounded filled" style={{ fontSize: '36px', color: COLOR }}>
            restaurant
          </span>
        </div>

        <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1A1A2E', margin: '0 0 6px' }}>
          Meal Management
        </h2>
        <p style={{ fontSize: '13px', color: '#9CA3AF', margin: '0 0 28px' }}>
          Enter your 4-digit PIN to access this module
        </p>

        {/* PIN input */}
        <input
          type="password"
          inputMode="numeric"
          maxLength={4}
          value={pin}
          onChange={e => { setPin(e.target.value.replace(/\D/g,'')); setError('') }}
          onKeyDown={handleKey}
          placeholder="• • • •"
          autoFocus
          style={{
            width: '100%', padding: '14px', textAlign: 'center',
            fontSize: '24px', letterSpacing: '8px',
            border: `2px solid ${error ? THEME.error : pin.length === 4 ? COLOR : THEME.outline}`,
            borderRadius: '14px', outline: 'none', fontFamily: 'inherit',
            boxSizing: 'border-box', transition: 'border-color .15s',
            background: error ? '#FDECEA' : '#fff',
          }}
        />

        {error && (
          <div style={{ marginTop: '10px', fontSize: '13px', color: THEME.error, fontWeight: 500 }}>
            {error}
          </div>
        )}

        <button
          onClick={verify}
          disabled={loading || pin.length < 4}
          style={{
            marginTop: '20px', width: '100%', padding: '13px',
            background: pin.length === 4 ? COLOR : '#E5E7EB',
            color: pin.length === 4 ? '#fff' : '#9CA3AF',
            border: 'none', borderRadius: '14px', fontSize: '14px', fontWeight: 600,
            cursor: pin.length === 4 ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit', transition: 'all .15s',
          }}
        >
          {loading ? 'Verifying…' : 'Unlock Module'}
        </button>

        <button
          onClick={onBack}
          style={{
            marginTop: '12px', width: '100%', padding: '10px',
            background: 'transparent', border: 'none',
            color: '#9CA3AF', fontSize: '13px', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Back to Home
        </button>

        <div style={{ marginTop: '20px', fontSize: '11px', color: '#D1D5DB' }}>
          Default PIN for new users: <strong>0000</strong>
        </div>
      </div>
    </div>
  )
}
