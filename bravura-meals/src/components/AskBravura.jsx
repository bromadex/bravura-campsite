import { createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { useAuth } from '../auth/AuthContext'
import { FIN } from '../utils/financeTheme'

// Ask Bravura B1 (issue #58): floating assistant on every screen.
//  • Screens publish what they show with useAskContext({...}) — name, filters, selected record, visible rows,
//    headline figures. Screens without it fall back to the visible text of the main content area.
//  • Answers come from the ask-bravura edge function (tools only, run as the asker) and carry clickable
//    record links (PO, request, journal, receipt) that open the record.
const AskCtx = createContext(null)

export function AskProvider({ moduleId, page, title, contentRef, children }) {
  const pageData = useRef(null)
  const [open, setOpen] = useState(false)
  const value = { moduleId, page, title, contentRef, pageData, open, setOpen }
  useEffect(() => {
    const onKey = e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen(o => !o) } }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('open-ask-bravura', onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('open-ask-bravura', onOpen) }
  }, [])
  // The button and panel are portalled to <body> so they're never part of the screen text we read.
  return <AskCtx.Provider value={value}>{children}{typeof document !== 'undefined' && createPortal(<AskFab />, document.body)}</AskCtx.Provider>
}

// Screens call this with a small, plain object describing what's on screen (only what the person sees).
export function useAskContext(data) {
  const ctx = useContext(AskCtx)
  const json = JSON.stringify(data ?? null)
  useEffect(() => {
    if (!ctx) return
    ctx.pageData.current = data ?? null
    return () => { if (ctx.pageData.current === data) ctx.pageData.current = null }
  }, [json]) // eslint-disable-line react-hooks/exhaustive-deps
}

const SUGGEST = {
  finance: ['What does this screen show?', 'How much did we spend this week?', 'Total the overdue bills on this screen', 'What did we spend the most on this month?'],
  procurement: ['What needs my attention here?', 'Which orders on this screen are late?', 'Total the orders on this screen by supplier', 'How much have we spent on tyres this year?'],
  inventory: ['What does this screen show?', 'Which items here are below reorder level?', 'Total the stock value on this screen'],
  fleet: ['Summarise this screen', 'Which vehicles need a service or have papers expiring?', 'How much fuel did each vehicle use this month?'],
  fuel: ['How much fuel did we use this month?', 'Which vehicles used the most diesel this week?', 'How much is in the tanks now?'],
  hr: ['Who is on leave today?', 'How many people do we have per department?'],
  sheq: ['Any incidents this month?', 'Which corrective actions are overdue?'],
  home: ['What needs my attention today?', 'How much fuel did we use this month?', 'How much did we spend this week?', 'Which purchase orders are late?', 'Who is on leave today?'],
  default: ['What does this screen show?', 'Summarise the numbers on this screen', 'How much did we spend this month?'],
}

function screenText(ref) {
  const el = ref?.current
  if (!el) return ''
  const t = (el.innerText || '').replace(/\n{3,}/g, '\n\n').trim()
  return t.length > 5000 ? t.slice(0, 5000) + '\n…' : t
}

export function AskChat({ compact = false, pageInfo, onClose }) {
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const firstName = (profile?.full_name || '').split(' ')[0]
  const navigate = useNavigate()
  const [chat, setChat] = useState(() => { try { return JSON.parse(sessionStorage.getItem('ask_chat') || '[]') } catch { return [] } })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [useScreen, setUseScreen] = useState(true)
  const end = useRef(null)
  useEffect(() => { try { sessionStorage.setItem('ask_chat', JSON.stringify(chat.slice(-20))) } catch { /* storage off */ } end.current?.scrollIntoView({ block: 'end' }) }, [chat])

  const ask = useCallback(async text => {
    const question = (text ?? q).trim()
    if (!question || busy) return
    setQ(''); setBusy(true)
    const history = chat.slice(-3).flatMap(m => [{ role: 'user', content: m.q }, { role: 'assistant', content: m.a || '' }])
    const page = pageInfo && useScreen ? {
      module: pageInfo.moduleId, page: pageInfo.page, title: pageInfo.title,
      context: pageInfo.pageData?.current || null,
      screen_text: pageInfo.pageData?.current ? '' : screenText(pageInfo.contentRef),
    } : null
    setChat(c => [...c, { q: question, a: null, screen: !!page }])
    const { data, error } = await supabase.functions.invoke('ask-bravura', { body: { question, site_id: currentSiteId, history, page } })
    const a = error ? (await error.context?.json?.().catch(() => null))?.error || 'The assistant could not be reached. Try again in a minute.' : data?.answer
    setChat(c => c.map((m, i) => i === c.length - 1 ? { ...m, a, links: data?.links || [], tools: data?.tools || [], id: data?.id } : m))
    setBusy(false)
  }, [q, busy, chat, pageInfo, useScreen, currentSiteId])

  async function rate(m, v) {
    if (!m.id) return
    await supabase.from('ai_questions').update({ rating: v }).eq('id', m.id)
    setChat(c => c.map(x => x === m ? { ...x, rated: v } : x))
  }
  const suggestions = SUGGEST[pageInfo?.moduleId] || SUGGEST.default

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, fontFamily: FIN.sans, color: FIN.ink }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: compact ? '12px 14px' : 0 }}>
        {chat.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ alignSelf: 'flex-start', maxWidth: '100%', background: '#fff', border: `1px solid ${FIN.line}`, padding: '12px 14px', borderRadius: '14px 14px 14px 4px', fontSize: 13.5, lineHeight: 1.55 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 4 }}>Hi{firstName ? ` ${firstName}` : ''} — I'm Ask Bravura.</div>
              <div style={{ color: FIN.muted, marginBottom: 8 }}>
                Ask in plain words. I look things up in <b>your</b> records (only the sites and modules you have access to), read the screen you're on,
                and show the records I used as links you can open. I never change anything — later, when I can help with tasks, you'll always confirm first.
              </div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>What I can do now</div>
              <ul style={{ margin: '0 0 8px', paddingLeft: 18, color: FIN.ink }}>
                <li><b>Explain this screen</b> — what it shows, what needs attention.</li>
                <li><b>Do the maths</b> — totals, differences, averages, percentages, worked out exactly.</li>
                <li><b>Spending</b> — how much, on what, by site, supplier, cost centre or week.</li>
                <li><b>Suppliers</b> — orders, bills, what we owe, late deliveries.</li>
                <li><b>Every module</b> — fuel used and tank levels, fleet services and expiring papers, stock on hand, who's on leave, safety incidents, meals served, camp beds.</li>
                <li><b>Find anything</b> — a PO, request, supplier, vehicle, employee, stock item or incident by number or name.</li>
                <li><b>Open records</b> — POs, requests and journals I mention are clickable.</li>
              </ul>
              <div style={{ fontSize: 12, color: FIN.faint }}>Coming soon: reading receipts and delivery notes you attach, and doing tasks you approve.</div>
            </div>
            <div style={{ fontSize: 12, color: FIN.muted }}>Try:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggestions.map(s => <button key={s} onClick={() => ask(s)} style={{ padding: '7px 12px', borderRadius: 16, border: `1px solid ${FIN.field}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: FIN.ink, textAlign: 'left' }}>{s}</button>)}
            </div>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '85%', background: FIN.maroon, color: '#fff', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.q}</div>
            <div style={{ alignSelf: 'flex-start', maxWidth: '95%', background: '#fff', border: `1px solid ${FIN.line}`, padding: '10px 12px', borderRadius: '14px 14px 14px 4px', fontSize: 14, lineHeight: 1.55 }}>
              {m.a == null ? <span style={{ color: FIN.faint }}>{m.screen ? 'Reading this screen and your records…' : 'Looking through your records…'}</span> : <Formatted text={m.a} />}
              {(m.links || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {m.links.map(l => <button key={l.path + l.label} onClick={() => { navigate(l.path); if (compact) onClose?.() }}
                    style={{ padding: '3px 10px', borderRadius: 12, border: `1px solid ${FIN.blue}40`, background: FIN.blueTint, color: FIN.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600 }}>{l.label} ↗</button>)}
                </div>
              )}
              {m.a != null && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 11.5, color: FIN.faint }}>
                  {m.screen && <span>used this screen</span>}
                  {(m.tools || []).some(t => t.name === 'calculate') && <span>· calculated</span>}
                  {m.id && (m.rated ? <span>· thanks</span> : <>
                    <button onClick={() => rate(m, 1)} aria-label="Helpful" style={{ border: 'none', background: 'none', cursor: 'pointer' }}>👍</button>
                    <button onClick={() => rate(m, -1)} aria-label="Not helpful" style={{ border: 'none', background: 'none', cursor: 'pointer' }}>👎</button>
                  </>)}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={e => { e.preventDefault(); ask() }} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: compact ? '10px 14px 14px' : '10px 0 0', borderTop: compact ? `1px solid ${FIN.line}` : 'none', background: compact ? FIN.ground : 'transparent' }}>
        {pageInfo && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: useScreen ? FIN.blue : FIN.faint, cursor: 'pointer', alignSelf: 'flex-start' }}>
            <input type="checkbox" checked={useScreen} onChange={e => setUseScreen(e.target.checked)} />
            Using this screen{pageInfo.title ? `: ${pageInfo.title}` : ''}
          </label>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="ask-bravura-q" aria-label="Ask Bravura" autoFocus={compact} value={q} onChange={e => setQ(e.target.value)} placeholder="Ask anything…"
            style={{ flex: 1, minHeight: 44, padding: '8px 12px', borderRadius: 10, border: `1px solid ${FIN.field}`, fontFamily: 'inherit', fontSize: 14, color: FIN.ink, background: '#fff' }} />
          <button type="submit" disabled={busy || !q.trim()} style={{ minHeight: 44, padding: '0 16px', background: FIN.maroon, border: 'none', borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{busy ? '…' : 'Ask'}</button>
        </div>
        {chat.length > 0 && <button type="button" onClick={() => setChat([])} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', color: FIN.faint, fontSize: 12, cursor: 'pointer', padding: 0 }}>New conversation</button>}
      </form>
    </div>
  )
}

function AskFab() {
  const ctx = useContext(AskCtx)
  const { can } = usePermissions()
  const [hover, setHover] = useState(false)
  const narrow = typeof window !== 'undefined' && window.innerWidth < 768
  const [box, setBox] = useState(() => {
    try { const b = JSON.parse(localStorage.getItem('ask_box') || 'null'); if (b && b.w > 0) return clampBox(b) } catch { /* default */ }
    return defaultBox()
  })
  const [sheetH, setSheetH] = useState(60)
  useEffect(() => { try { localStorage.setItem('ask_box', JSON.stringify(box)) } catch { /* storage off */ } }, [box])

  function startDrag(e, mode) {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY, b0 = { ...box }
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy
      let { x, y, w, h } = b0
      if (mode === 'move') { x += dx; y += dy }
      if (mode.includes('e')) w = b0.w + dx
      if (mode.includes('s')) h = b0.h + dy
      if (mode.includes('w')) { w = b0.w - dx; x = b0.x + dx }
      if (mode.includes('n')) { h = b0.h - dy; y = b0.y + dy }
      if (w < MIN_W) { if (mode.includes('w')) x -= MIN_W - w; w = MIN_W }
      if (h < MIN_H) { if (mode.includes('n')) y -= MIN_H - h; h = MIN_H }
      setBox(clampBox({ x, y, w, h }))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  function startSheetDrag(e) {
    const sy = e.clientY, h0 = sheetH
    const move = ev => setSheetH(Math.max(35, Math.min(95, h0 - (ev.clientY - sy) / window.innerHeight * 100)))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const resetBox = () => setBox(defaultBox())
  if (!ctx || !(can('finance.view') || can('procurement.view') || can('inventory.view'))) return null
  return (
    <>
      {!ctx.open && (
        <button onClick={() => ctx.setOpen(true)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-label="Ask Bravura (Ctrl J)" title="Ask Bravura (Ctrl J)"
          style={{ position: 'fixed', left: '50%', bottom: narrow ? 14 : 20, transform: `translateX(-50%) translateY(${hover ? -2 : 0}px)`, zIndex: 900,
            display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 20px 0 14px', borderRadius: 23, border: 'none', cursor: 'pointer',
            background: `linear-gradient(135deg, ${FIN.maroon}, #6E1A1F)`, color: '#fff', fontFamily: FIN.sans, fontSize: 14.5, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(152,35,41,.35), 0 2px 6px rgba(0,0,0,.12)', transition: 'transform .15s' }}>
          <span aria-hidden="true" style={{ fontSize: 18 }}>✦</span> Ask Bravura
          {!narrow && <kbd style={{ fontFamily: 'inherit', fontSize: 11, opacity: .75, border: '1px solid rgba(255,255,255,.4)', borderRadius: 5, padding: '1px 5px' }}>Ctrl J</kbd>}
        </button>
      )}
      {ctx.open && (narrow ? (
        <div role="dialog" aria-label="Ask Bravura" style={{ position: 'fixed', zIndex: 950, left: 0, right: 0, bottom: 0, height: `${sheetH}dvh`, background: FIN.ground,
          display: 'flex', flexDirection: 'column', borderRadius: '16px 16px 0 0', boxShadow: '0 -8px 30px rgba(0,0,0,.2)' }}>
          <div onPointerDown={startSheetDrag} style={{ touchAction: 'none', cursor: 'ns-resize', padding: '8px 0 2px', display: 'flex', justifyContent: 'center' }} aria-label="Drag to resize">
            <span style={{ width: 44, height: 5, borderRadius: 3, background: FIN.field }} />
          </div>
          <PanelHeader onClose={() => ctx.setOpen(false)} />
          <AskChat compact pageInfo={ctx} onClose={() => ctx.setOpen(false)} />
        </div>
      ) : (
        <div role="dialog" aria-label="Ask Bravura" style={{ position: 'fixed', zIndex: 950, left: box.x, top: box.y, width: box.w, height: box.h, background: FIN.ground,
          display: 'flex', flexDirection: 'column', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,.22)', border: `1px solid ${FIN.line}` }}>
          <PanelHeader onClose={() => ctx.setOpen(false)} onDragStart={e => startDrag(e, 'move')} onReset={resetBox} />
          <AskChat compact pageInfo={ctx} onClose={() => ctx.setOpen(false)} />
          {/* drag any edge or corner to resize */}
          {[['n', { top: -4, left: 12, right: 12, height: 8, cursor: 'ns-resize' }], ['s', { bottom: -4, left: 12, right: 12, height: 8, cursor: 'ns-resize' }],
            ['w', { left: -4, top: 12, bottom: 12, width: 8, cursor: 'ew-resize' }], ['e', { right: -4, top: 12, bottom: 12, width: 8, cursor: 'ew-resize' }],
            ['nw', { top: -4, left: -4, width: 16, height: 16, cursor: 'nwse-resize' }], ['ne', { top: -4, right: -4, width: 16, height: 16, cursor: 'nesw-resize' }],
            ['sw', { bottom: -4, left: -4, width: 16, height: 16, cursor: 'nesw-resize' }], ['se', { bottom: -4, right: -4, width: 16, height: 16, cursor: 'nwse-resize' }]]
            .map(([k, st]) => <div key={k} onPointerDown={e => startDrag(e, k)} aria-hidden="true" style={{ position: 'absolute', zIndex: 2, touchAction: 'none', ...st }} />)}
        </div>
      ))}
    </>
  )
}

// Desktop panel geometry: opens bottom-centre, a comfortable size (not full screen); remembered per device.
const MIN_W = 340, MIN_H = 320
function defaultBox() {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280, vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const w = Math.min(460, vw - 32), h = Math.min(560, vh - 120)
  return { x: Math.round((vw - w) / 2), y: vh - h - 24, w, h }
}
function clampBox(b) {
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.min(Math.max(b.w, MIN_W), vw - 16), h = Math.min(Math.max(b.h, MIN_H), vh - 16)
  return { w, h, x: Math.min(Math.max(b.x, 8), vw - w - 8), y: Math.min(Math.max(b.y, 8), vh - h - 8) }
}

function PanelHeader({ onClose, onDragStart, onReset }) {
  return (
    <div onPointerDown={e => { if (e.target.closest('button')) return; onDragStart?.(e) }} onDoubleClick={onReset}
      title={onDragStart ? 'Drag to move · drag any edge to resize · double-click to reset' : undefined}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${FIN.line}`, background: '#fff',
        borderRadius: '16px 16px 0 0', cursor: onDragStart ? 'move' : 'default', userSelect: 'none', touchAction: 'none' }}>
      <div style={{ fontFamily: FIN.sans, fontWeight: 600, fontSize: 15, color: FIN.ink }}><span style={{ color: FIN.maroon }}>✦</span> Ask Bravura</div>
      <div style={{ display: 'flex', gap: 4 }}>
        {onReset && <button onClick={onReset} aria-label="Reset size" title="Reset size" style={{ border: 'none', background: 'none', fontSize: 14, cursor: 'pointer', color: FIN.muted }}>⤢</button>}
        <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 20, cursor: 'pointer', color: FIN.muted, lineHeight: 1 }}>×</button>
      </div>
    </div>
  )
}

// Answers come back in light Markdown. Show real formatting instead of the raw ** and - characters:
// **bold**, *italic*, `code`, "- " / "• " / "1. " lists and "#" headings. Plain text only — no HTML is injected.
function inline(text, key) {
  const parts = []
  const re = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*)/g
  let last = 0, m, i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const t = m[0]
    if (t.startsWith('**') || t.startsWith('__')) parts.push(<strong key={key + '-' + i++}>{t.slice(2, -2)}</strong>)
    else if (t.startsWith('`')) parts.push(<code key={key + '-' + i++} style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.92em', background: FIN.lineSoft, padding: '0 4px', borderRadius: 4 }}>{t.slice(1, -1)}</code>)
    else parts.push(<em key={key + '-' + i++}>{t.slice(1, -1)}</em>)
    last = m.index + t.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}
function Formatted({ text }) {
  const blocks = []
  let list = null
  const flush = () => { if (list) { blocks.push(list); list = null } }
  String(text || '').split('\n').forEach((raw, n) => {
    const line = raw.trimEnd()
    const bullet = /^\s*(?:[-*•])\s+(.*)$/.exec(line)
    const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    const heading = /^\s*#{1,4}\s+(.*)$/.exec(line)
    if (bullet || numbered) {
      const ordered = !!numbered
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push(inline(bullet ? bullet[1] : numbered[2], 'l' + n))
      return
    }
    flush()
    if (heading) blocks.push({ h: inline(heading[1], 'h' + n) })
    else if (line.trim() === '') blocks.push({ gap: true })
    else blocks.push({ p: inline(line, 'p' + n) })
  })
  flush()
  return (
    <div>
      {blocks.map((b, i) => b.items ? (
        b.ordered
          ? <ol key={i} style={{ margin: '4px 0', paddingLeft: 20 }}>{b.items.map((it, j) => <li key={j} style={{ margin: '2px 0' }}>{it}</li>)}</ol>
          : <ul key={i} style={{ margin: '4px 0', paddingLeft: 18 }}>{b.items.map((it, j) => <li key={j} style={{ margin: '2px 0' }}>{it}</li>)}</ul>
      ) : b.h ? <div key={i} style={{ fontWeight: 700, margin: '6px 0 2px' }}>{b.h}</div>
        : b.gap ? <div key={i} style={{ height: 6 }} />
        : <div key={i}>{b.p}</div>)}
    </div>
  )
}
