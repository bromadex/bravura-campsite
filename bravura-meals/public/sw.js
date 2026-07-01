// Bravura Campsite — Service Worker
// Minimal SW: enables PWA installability and provides a basic offline fallback.
// API calls to Supabase always go network-first; only the app shell (HTML/JS/CSS)
// is served from cache when the network is unavailable.

const CACHE = 'bravura-v1'
const OFFLINE_URL = '/'

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.add(OFFLINE_URL))
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

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Let Supabase API and auth requests go straight to the network.
  if (url.hostname.includes('supabase') || url.hostname.includes('googleapis')) {
    return
  }

  // Navigation requests: serve from cache if offline, else network.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL))
    )
    return
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached
      return fetch(request).then(response => {
        if (response.ok && request.method === 'GET') {
          const clone = response.clone()
          caches.open(CACHE).then(cache => cache.put(request, clone))
        }
        return response
      })
    })
  )
})
