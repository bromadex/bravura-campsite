import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (error) {
      // Surfaced clearly rather than silently leaving profile null forever
      // — a transient failure here used to be indistinguishable from "not
      // logged in" at all, which is the root of the refresh-to-login bug.
      console.error('fetchProfile error:', error)
    }
    if (!error && data) setProfile(data)
  }

  useEffect(() => {
    let mounted = true

    async function init() {
      // Awaited properly now — loading only becomes false once the profile
      // has actually arrived (or definitively failed), never while it's
      // still in flight. That in-between window was the actual bug: a
      // valid session with a profile fetch that simply hadn't completed
      // yet was being treated as "not authenticated."
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return
      setUser(session?.user ?? null)
      if (session?.user) await fetchProfile(session.user.id)
      if (mounted) setLoading(false)
    }
    init()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        await fetchProfile(session.user.id)
      } else {
        setProfile(null)
      }
      if (mounted) setLoading(false)
    })

    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const value = { user, profile, loading, signIn, signOut, role: profile?.role }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
