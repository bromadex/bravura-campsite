import { createContext, useContext, useState, useEffect } from 'react'

const ThemeContext = createContext(null)

// The actual theme application happens via the data-theme attribute on
// <html>, which every CSS custom property in index.html keys off. This
// context's job is just to expose that state to React components (for the
// toggle button) and keep it persisted — the inline script in index.html
// already set the correct attribute before React even mounted, so there's
// no flash-of-wrong-theme on load; this just reads that same starting
// value back out rather than guessing or defaulting blindly.
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof document !== 'undefined') {
      return document.documentElement.getAttribute('data-theme') || 'light'
    }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('bravura_theme', theme) } catch { /* private browsing etc — non-fatal */ }
  }, [theme])

  function toggleTheme() {
    setTheme(t => t === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
