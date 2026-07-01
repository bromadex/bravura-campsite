import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from './AuthContext'
import { THEME } from '../utils/permissions'

/**
 * Full-screen blocking modal shown when profile.force_password_reset is true.
 * The user cannot navigate anywhere or use any part of the app until they
 * set a new password. On success we update auth + clear the flag on
 * profiles, then re-fetch the profile so the flag propagates.
 */
export default function ForcePasswordResetModal() {
  const { user, refreshProfile, signOut } = useAuth()
  const [pw1,     setPw1]     = useState('')
  const [pw2,     setPw2]     = useState('')
  const [showPw,  setShowPw]  = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  function validate() {
    if (pw1.length < 8)           return 'Password must be at least 8 characters.'
    if (!/[A-Z]/.test(pw1))       return 'Password must include at least one uppercase letter.'
    if (!/[a-z]/.test(pw1))       return 'Password must include at least one lowercase letter.'
    if (!/[0-9]/.test(pw1))       return 'Password must include at least one number.'
    if (pw1 === 'Bravura@2026!')  return 'Choose a password different from the temporary one.'
    if (pw1 !== pw2)              return 'Passwords do not match.'
    return null
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    const v = validate()
    if (v) { setError(v); return }

    setSaving(true)
    try {
      const { error: authErr } = await supabase.auth.updateUser({ password: pw1 })
      if (authErr) throw authErr

      const { error: profErr } = await supabase
        .from('profiles')
        .update({ force_password_reset: false })
        .eq('id', user.id)
      if (profErr) throw profErr

      await refreshProfile()
    } catch (err) {
      setError(err.message || 'Could not update password. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(24,10,10,.88)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '16px', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
    }}>
      <div style={{
        background: THEME.surface, borderRadius: '16px',
        padding: '32px', width: '100%', maxWidth: '420px',
        boxShadow: '0 24px 80px rgba(0,0,0,.4)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '16px',
            background: THEME.primary + '18', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: 28, color: THEME.primary }}>lock_reset</span>
          </div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 500, color: THEME.text }}>
            Set a new password
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: THEME.textMed, lineHeight: 1.5 }}>
            Your account is using a temporary password. Choose a new one to continue.
          </p>
        </div>

        <form onSubmit={submit}>
          {[
            { label: 'New password',     value: pw1, setter: setPw1 },
            { label: 'Confirm password', value: pw2, setter: setPw2 },
          ].map((f, i) => (
            <div key={i} style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 500, color: THEME.textMed, marginBottom: '6px' }}>
                {f.label}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={f.value}
                  onChange={e => f.setter(e.target.value)}
                  required
                  autoComplete="new-password"
                  style={{
                    width: '100%', padding: '11px 44px 11px 14px',
                    border: `1px solid ${THEME.outline}`,
                    borderRadius: '10px', fontSize: '14px', color: THEME.text,
                    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                  }}
                />
                {i === 0 && (
                  <button
                    type="button"
                    onClick={() => setShowPw(p => !p)}
                    style={{
                      position: 'absolute', right: '10px', top: '50%',
                      transform: 'translateY(-50%)', background: 'transparent',
                      border: 'none', cursor: 'pointer', display: 'flex',
                      alignItems: 'center', color: THEME.textLow,
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                      {showPw ? 'visibility_off' : 'visibility'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          ))}

          <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '14px', lineHeight: 1.55 }}>
            Minimum 8 characters, with an uppercase letter, a lowercase letter, and a number.
          </div>

          {error && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              background: THEME.statusErrorBg, border: `1px solid ${THEME.error}55`,
              borderRadius: '10px', padding: '10px 12px', marginBottom: '14px',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, color: THEME.error, marginTop: 1 }}>error</span>
              <span style={{ fontSize: '12px', color: THEME.error }}>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            style={{
              width: '100%', padding: '13px',
              background: saving ? THEME.textLow : THEME.primary,
              color: '#fff', border: 'none', borderRadius: '10px',
              fontSize: '14px', fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            {saving ? 'Updating…' : 'Update password'}
          </button>

          <button
            type="button"
            onClick={signOut}
            style={{
              width: '100%', marginTop: '10px', padding: '9px',
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: THEME.textLow, fontSize: '12px', fontFamily: 'inherit',
            }}
          >
            Sign out instead
          </button>
        </form>
      </div>
    </div>
  )
}
