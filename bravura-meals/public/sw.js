// Bravura Campsite — Service Worker
// Minimal SW: enables PWA installability and a basic offline landing.
// Deliberately does NOT cache hashed JS/CSS chunks — Vite renames chunk
// files on every deploy, so caching old ones only extends the window in
// which the app tries to load files that no longer exist on the CDN.
//
// Strategy:
//   • Supabase / Google API requests → straight to network, untouched
//   • Navigation (HTML) requests    → network-first, cache fallback (offline)
//   • Hashed /assets/*              → always network, never cached by us
//   • Icons / manifest              → cache-first (rarely change)

const CACHE = 'bravura-shell-v2'
const SHELL_URLS = [
  '/',
  '/manifest.json',
  '/logo/bravura-logo.png',
  '/logo/bravura-icon-512.png',
  '/logo/favicon-192.png',
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(SHELL_URLS.map(u => cache.add(u).catch(() => {})))
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Third-party APIs: don't touch.
  if (url.hostname.includes('supabase') || url.hostname.includes('googleapis')) return

  // Hashed asset chunks: always fresh from network, never cached by us.
  // These names change every deploy; caching them causes stale-deploy 404s.
  if (url.pathname.startsWith('/assets/')) return

  // HTML navigation: network-first with offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/'))
    )
    return
  }

  // Static shell assets (icons, manifest): cache-first, populate on miss.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      }).catch(() => cached)
    })
  )
})
