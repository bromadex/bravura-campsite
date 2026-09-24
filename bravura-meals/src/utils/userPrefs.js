import { supabase } from '../supabaseClient'

// Per-user preferences, stored server-side in profiles.preferences so they follow
// the user across devices, with a localStorage copy so they apply before login resolves.
export const PREF_DEFAULTS = {
  landing_module: '',
  table_density: 'comfortable',
  date_format: 'DD/MM/YYYY',
  font_size: 'default',
  animations: true,
  high_contrast: false,
  sound: false,
  session_timeout: 60,
  muted_notification_categories: [],
}

const CACHE_KEY = 'bravura_prefs'
const listeners = new Set()

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function pick(obj) {
  const out = {}
  for (const k of Object.keys(PREF_DEFAULTS)) if (obj && obj[k] !== undefined) out[k] = obj[k]
  return out
}

let current = { ...PREF_DEFAULTS, ...pick(readCache()) }

export function getPrefs() { return current }

export function subscribePrefs(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Called with the preferences from the signed-in user's profile.
export function setPrefsLocal(prefs) {
  current = { ...PREF_DEFAULTS, ...pick(prefs) }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(current)) } catch { /* private mode */ }
  applyDisplayPrefs(current)
  listeners.forEach(fn => fn(current))
}

export async function savePrefs(patch) {
  const next = { ...current, ...pick(patch) }
  const { error } = await supabase.rpc('set_my_preferences', { p_prefs: next })
  if (error) throw error
  setPrefsLocal(next)
  return next
}

const ZOOM = { small: '0.9', default: '', large: '1.12' }

export function applyDisplayPrefs(p = current) {
  if (typeof document === 'undefined') return
  const root = document.getElementById('root') || document.body
  root.style.zoom = ZOOM[p.font_size] || ''
  root.style.filter = p.high_contrast ? 'contrast(1.25) saturate(1.1)' : ''

  const id = 'bravura-reduce-motion'
  let tag = document.getElementById(id)
  if (!p.animations) {
    if (!tag) {
      tag = document.createElement('style')
      tag.id = id
      tag.textContent = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}'
      document.head.appendChild(tag)
    }
  } else if (tag) {
    tag.remove()
  }
}

// 'YYYY-MM-DD' (or ISO timestamp) → the user's chosen date format
export function formatDatePref(d) {
  if (!d) return '—'
  const [y, m, day] = String(d).slice(0, 10).split('-')
  if (!y || !m || !day) return String(d)
  switch (current.date_format) {
    case 'MM/DD/YYYY': return `${m}/${day}/${y}`
    case 'YYYY-MM-DD': return `${y}-${m}-${day}`
    default:           return `${day}/${m}/${y}`
  }
}

export function isMuted(category) {
  return (current.muted_notification_categories || []).includes(category || 'general')
}

let audioCtx
export function playNotificationSound(force = false) {
  if (!force && !current.sound) return
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)()
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start()
    osc.stop(audioCtx.currentTime + 0.4)
  } catch { /* audio blocked until the user interacts — non-fatal */ }
}

// Apply cached display prefs as early as possible (before auth resolves).
applyDisplayPrefs(current)
