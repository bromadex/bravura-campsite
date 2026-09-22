import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSite } from '../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../utils/permissions'
import { resolveCode, searchCodes, ALIASES } from '../utils/txnCodes'
import { searchEntities, SEARCH_CATEGORIES } from '../utils/searchEngine'

const Icon = ({ name, size = 20, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', ...style }}>{name}</span>
)

export default function CommandPalette() {
  const navigate = useNavigate()
  const { currentSiteId } = useSite()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selIdx, setSelIdx] = useState(0)
  const [entityResults, setEntityResults] = useState([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const codeResults = useMemo(() => searchCodes(query).slice(0, 8), [query])
  const exact = useMemo(() => resolveCode(query), [query])

  useEffect(() => {
    if (!open || query.trim().length < 2) { setEntityResults([]); return }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      const results = await searchEntities(query, currentSiteId)
      setEntityResults(results)
      setSearching(false)
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, open, currentSiteId])

  const allResults = useMemo(() => {
    const items = []
    codeResults.forEach(r => items.push({ kind: 'code', entry: r }))
    entityResults.forEach(r => items.push({ kind: 'entity', entry: r }))
    return items
  }, [codeResults, entityResults])

  const close = useCallback(() => {
    setOpen(false); setQuery(''); setSelIdx(0); setEntityResults([])
  }, [])

  const go = useCallback((item) => {
    if (!item) return
    close()
    navigate(item.kind === 'code' ? item.entry.path : item.entry.path)
  }, [navigate, close])

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
      if (exact) { close(); navigate(exact.path); return }
      if (allResults[selIdx]) go(allResults[selIdx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelIdx(i => Math.min(i + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelIdx(i => Math.max(i - 1, 0))
    }
  }

  const aliasForCode = code => Object.keys(ALIASES).find(a => ALIASES[a] === code)

  let globalIdx = -1

  return (
    <>
      <div
        onClick={close}
        style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(20,10,10,.45)', backdropFilter: 'blur(2px)' }}
      />
      <div style={{
        position: 'fixed', top: '14vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(600px, calc(100vw - 32px))', zIndex: 401,
        background: THEME.surface, borderRadius: '16px',
        boxShadow: '0 24px 80px rgba(0,0,0,.35)',
        overflow: 'hidden', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
      }}>
        {/* Input row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
          <Icon name="search" size={20} style={{ color: THEME.textLow }} />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="Search screens, employees, vehicles, incidents…"
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
          {searching && (
            <Icon name="hourglass_empty" size={16} style={{ color: THEME.textLow, animation: 'spin 1s linear infinite' }} />
          )}
        </div>

        {/* Results */}
        <div style={{ maxHeight: '52vh', overflowY: 'auto', padding: '6px' }}>
          {/* T-code results */}
          {codeResults.length > 0 && (
            <>
              <div style={{ padding: '8px 12px 4px', fontSize: '10px', fontWeight: 700, color: THEME.textLow, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                Screens
              </div>
              {codeResults.map((r) => {
                globalIdx++
                const idx = globalIdx
                const c = MODULE_COLORS[r.module] || THEME.primary
                const active = idx === selIdx
                const alias = aliasForCode(r.code)
                return (
                  <div
                    key={'c-' + r.code}
                    onClick={() => go({ kind: 'code', entry: r })}
                    onMouseEnter={() => setSelIdx(idx)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '9px 12px', borderRadius: '10px', cursor: 'pointer',
                      background: active ? c + '12' : 'transparent',
                    }}
                  >
                    <span style={{
                      fontFamily: 'monospace', fontSize: '11px', fontWeight: 700,
                      color: c, background: c + '14', borderRadius: '6px',
                      padding: '2px 7px', minWidth: '42px', textAlign: 'center', flexShrink: 0,
                    }}>
                      {r.code}
                    </span>
                    <span style={{ flex: 1, fontSize: '13px', color: THEME.text, fontWeight: active ? 600 : 400 }}>
                      {r.label}
                    </span>
                    {alias && (
                      <span style={{ fontSize: '10px', color: THEME.textLow, fontFamily: 'monospace' }}>
                        ={alias}
                      </span>
                    )}
                    <span style={{ fontSize: '10px', color: THEME.textLow, textTransform: 'capitalize', flexShrink: 0 }}>
                      {r.module}
                    </span>
                  </div>
                )
              })}
            </>
          )}

          {/* Entity results grouped by type */}
          {entityResults.length > 0 && (() => {
            const grouped = {}
            entityResults.forEach(r => {
              if (!grouped[r.type]) grouped[r.type] = []
              grouped[r.type].push(r)
            })
            return Object.entries(grouped).map(([type, items]) => {
              const cat = SEARCH_CATEGORIES.find(c => c.type === type) || {}
              return (
                <div key={type}>
                  <div style={{ padding: '10px 12px 4px', fontSize: '10px', fontWeight: 700, color: THEME.textLow, letterSpacing: '.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Icon name={cat.icon || 'search'} size={13} style={{ color: cat.color || THEME.textLow }} />
                    {cat.label || type}
                  </div>
                  {items.map((r) => {
                    globalIdx++
                    const idx = globalIdx
                    const active = idx === selIdx
                    const c = r.color || cat.color || THEME.primary
                    return (
                      <div
                        key={'e-' + r.type + '-' + r.path + '-' + idx}
                        onClick={() => go({ kind: 'entity', entry: r })}
                        onMouseEnter={() => setSelIdx(idx)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '9px 12px', borderRadius: '10px', cursor: 'pointer',
                          background: active ? c + '12' : 'transparent',
                        }}
                      >
                        <div style={{
                          width: 28, height: 28, borderRadius: '8px', flexShrink: 0,
                          background: c + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon name={r.icon || cat.icon || 'search'} size={15} style={{ color: c }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', color: THEME.text, fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.label}
                          </div>
                          {r.sublabel && (
                            <div style={{ fontSize: '11px', color: THEME.textLow, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.sublabel}
                            </div>
                          )}
                        </div>
                        <span style={{ fontSize: '10px', color: c, fontWeight: 600, flexShrink: 0 }}>
                          {cat.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })
          })()}

          {/* Empty state */}
          {allResults.length === 0 && query.trim() && !searching && (
            <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
              No results for "{query}"
            </div>
          )}

          {/* Searching indicator */}
          {searching && entityResults.length === 0 && codeResults.length === 0 && (
            <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
              Searching…
            </div>
          )}
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
