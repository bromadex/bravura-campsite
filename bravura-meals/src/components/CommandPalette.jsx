import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { THEME, MODULE_COLORS } from '../utils/permissions'
import { resolveCode, searchCodes, ALIASES } from '../utils/txnCodes'

// ── Global command palette (SAP-style transaction codes) ──────────────────────
// Opens on ⌘K / Ctrl+K anywhere in the app (or via window event
// 'open-command-palette' for UI triggers like the top-bar search box).
// Type a T-code (FU07) or an alias (ISS) and press Enter to jump straight
// there; or type part of a screen name and pick from the filtered list.

export default function CommandPalette() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selIdx, setSelIdx] = useState(0)
  const inputRef = useRef(null)

  const results = useMemo(() => searchCodes(query).slice(0, 12), [query])
  const exact = useMemo(() => resolveCode(query), [query])

  const close = useCallback(() => { setOpen(false); setQuery(''); setSelIdx(0) }, [])

  const go = useCallback((entry) => {
    if (!entry) return
    close()
    navigate(entry.path)
  }, [navigate, close])

  // Global hotkey + custom event trigger
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    function onOpenEvent() { setOpen(true) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-command-palette', onOpenEvent)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('open-command-palette', onOpenEvent)
    }
  }, [])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30) }, [open])
  useEffect(() => { setSelIdx(0) }, [query])

  if (!open) return null

  function onInputKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Exact T-code/alias wins; otherwise the highlighted row.
      go(exact || results[selIdx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelIdx(i => Math.max(i - 1, 0))
    }
  }

  const aliasForCode = code => Object.keys(ALIASES).find(a => ALIASES[a] === code)

  return (
    <>
      <div
        onClick={close}
        style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(20,10,10,.45)', backdropFilter: 'blur(2px)' }}
      />
      <div style={{
        position: 'fixed', top: '14vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(560px, calc(100vw - 32px))', zIndex: 401,
        background: THEME.surface, borderRadius: '16px',
        boxShadow: '0 24px 80px rgba(0,0,0,.35)',
        overflow: 'hidden', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
      }}>
        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
          <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.textLow }}>bolt</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Type a code (FU07, ME02, ISS…) or search screens"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              fontSize: '15px', color: THEME.text, fontFamily: 'inherit',
            }}
          />
          {exact && (
            <span style={{
              fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '6px',
              background: (MODULE_COLORS[exact.module] || THEME.primary) + '18',
              color: MODULE_COLORS[exact.module] || THEME.primary,
              whiteSpace: 'nowrap',
            }}>
              ↵ {exact.label}
            </span>
          )}
        </div>

        {/* Results */}
        <div style={{ maxHeight: '46vh', overflowY: 'auto', padding: '6px' }}>
          {results.length === 0 ? (
            <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
              No screen matches “{query}”
            </div>
          ) : results.map((r, i) => {
            const c = MODULE_COLORS[r.module] || THEME.primary
            const active = i === selIdx
            const alias = aliasForCode(r.code)
            return (
              <div
                key={r.code}
                onClick={() => go(r)}
                onMouseEnter={() => setSelIdx(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '10px 12px', borderRadius: '10px', cursor: 'pointer',
                  background: active ? c + '12' : 'transparent',
                }}
              >
                <span style={{
                  fontFamily: 'monospace', fontSize: '12px', fontWeight: 700,
                  color: c, background: c + '14', borderRadius: '6px',
                  padding: '3px 8px', minWidth: '46px', textAlign: 'center', flexShrink: 0,
                }}>
                  {r.code}
                </span>
                <span style={{ flex: 1, fontSize: '14px', color: THEME.text, fontWeight: active ? 600 : 400 }}>
                  {r.label}
                </span>
                {alias && (
                  <span style={{ fontSize: '10px', color: THEME.textLow, fontFamily: 'monospace' }}>
                    ={alias}
                  </span>
                )}
                <span style={{ fontSize: '11px', color: THEME.textLow, textTransform: 'capitalize', flexShrink: 0 }}>
                  {r.module}
                </span>
              </div>
            )
          })}
        </div>

        {/* Footer hints */}
        <div style={{
          display: 'flex', gap: '16px', padding: '9px 18px',
          borderTop: `1px solid ${THEME.outlineVar}`, background: THEME.surfaceVar,
          fontSize: '11px', color: THEME.textLow,
        }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span style={{ marginLeft: 'auto' }}>⌘K anywhere</span>
        </div>
      </div>
    </>
  )
}
