import { useEffect, useRef } from 'react'

/**
 * Re-calls `onRefresh` when:
 *   1. The tab becomes visible again after being hidden for at least `minHiddenMs`
 *   2. Every `intervalMs` while the tab is visible
 *
 * Uses a ref internally so the caller doesn't need to memoize `onRefresh`.
 */
export function useAutoRefresh(onRefresh, {
  intervalMs  = 5 * 60 * 1000,
  minHiddenMs = 5 * 60 * 1000,
} = {}) {
  const cbRef    = useRef(onRefresh)
  const hiddenAt = useRef(null)

  useEffect(() => { cbRef.current = onRefresh })

  useEffect(() => {
    function refresh() { cbRef.current?.() }

    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt.current = Date.now()
      } else {
        const elapsed = hiddenAt.current ? Date.now() - hiddenAt.current : 0
        hiddenAt.current = null
        if (elapsed >= minHiddenMs) refresh()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    const id = setInterval(refresh, intervalMs)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      clearInterval(id)
    }
  }, [intervalMs, minHiddenMs])
}
