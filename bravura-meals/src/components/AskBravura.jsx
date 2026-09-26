import { Fragment, createContext, useContext, useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { supabase } from '../supabaseClient'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { useAuth } from '../auth/AuthContext'
import { FIN } from '../utils/financeTheme'
import { attachFileToRecord } from '../utils/docshareUpload'

// Ask Bravura B1 (issue #58): floating assistant on every screen.
//  • Screens publish what they show with useAskContext({...}) — name, filters, selected record, visible rows,
//    headline figures. Screens without it fall back to the visible text of the main content area.
//  • Answers come from the ask-bravura edge function (tools only, run as the asker) and carry clickable
//    record links (PO, request, journal, receipt) that open the record.
const AskCtx = createContext(null)

export function AskProvider({ moduleId, page, title, contentRef, children }) {
  const pageData = useRef(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(null)   // a question sent in with the 'open-ask-bravura' event (e.g. from the daily brief)
  const value = { moduleId, page, title, contentRef, pageData, open, setOpen, pending, setPending }
  useEffect(() => {
    const onOpen = e => { setOpen(true); if (e?.detail?.question) setPending(e.detail.question) }
    window.addEventListener('open-ask-bravura', onOpen)
    return () => { window.removeEventListener('open-ask-bravura', onOpen) }
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

// B3: attached files are turned into small JPEGs (and a PDF's text layer) in the browser, sent with the
// question, read by the assistant and thrown away — nothing is uploaded to storage.
const MAX_FILE_MB = 15
function canvasToJpeg(canvas) { return canvas.toDataURL('image/jpeg', 0.82) }
async function imageToJpeg(file, maxSide = 1600) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not open the picture')); i.src = url })
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return canvasToJpeg(c)
  } finally { URL.revokeObjectURL(url) }
}
async function pdfToParts(file) {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const images = []; let text = ''
  for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
    const page = await doc.getPage(n)
    const tc = await page.getTextContent()
    text += tc.items.map(it => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n'
    if (n <= 2) {
      const base = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: Math.min(2, 1600 / Math.max(base.width, base.height)) })
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
      images.push(canvasToJpeg(c))
    }
  }
  return { images, text: text.trim() }
}
// The AI account may have no picture-reading model, so also read the words off photos here (OCR).
async function ocr(dataUrl) {
  try {
    const { createWorker } = await import('tesseract.js')
    const w = await createWorker('eng')
    const { data } = await w.recognize(dataUrl)
    await w.terminate()
    return (data?.text || '').trim()
  } catch { return '' }
}
async function prepareFile(file) {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name} is over ${MAX_FILE_MB} MB`)
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return { name: file.name, type: 'pdf', ...(await pdfToParts(file)) }
  if (file.type.startsWith('image/')) {
    const jpeg = await imageToJpeg(file)
    return { name: file.name, type: 'image', images: [jpeg], text: await ocr(jpeg) }
  }
  throw new Error(`${file.name}: attach a photo, scan or PDF`)
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
  // Chat history lives on the server for 30 days (ai_questions); a fresh tab picks up the last conversation.
  const [historyLoaded, setHistoryLoaded] = useState(false)
  useEffect(() => {
    if (historyLoaded || chat.length) { setHistoryLoaded(true); return }
    setHistoryLoaded(true)
    supabase.from('ai_questions').select('id, question, answer, rating, created_at, tools, unverified')
      .eq('user_id', profile?.id).eq('hidden', false).gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
      .order('created_at', { ascending: false }).limit(12)
      .then(({ data }) => {
        if (!data?.length) return
        setChat(data.reverse().map(r => ({ q: r.question, a: r.answer, id: r.id, rated: r.rating || undefined, tools: r.tools || [], check: r.unverified || [],
          old: true, when: r.created_at })))
      })
  }, [profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  async function newConversation() {
    const ids = chat.map(m => m.id).filter(Boolean)
    setChat([]); rawFiles.current = {}
    if (ids.length) await supabase.from('ai_questions').update({ hidden: true }).in('id', ids)
  }
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [useScreen, setUseScreen] = useState(true)
  const [files, setFiles] = useState([])
  const [reading, setReading] = useState(false)
  const [fileErr, setFileErr] = useState('')
  const fileInput = useRef(null)
  const rawFiles = useRef({})
  // B7 voice notes: record → text (Whisper on Groq) → into the box to check before sending.
  // On a weak connection the recording is kept and sent again when the phone is back online.
  const [rec, setRec] = useState(null)          // { recorder, chunks, started }
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [voiceQueued, setVoiceQueued] = useState(null)   // { base64, type } waiting to be sent
  const [elapsed, setElapsed] = useState(0)
  const viaVoice = useRef(false)
  useEffect(() => { if (!rec) return; const t = setInterval(() => setElapsed(Math.round((Date.now() - rec.started) / 1000)), 500); return () => clearInterval(t) }, [rec])
  async function transcribe(item) {
    setVoiceBusy(true); setFileErr('')
    try {
      const { data, error } = await supabase.functions.invoke('ask-bravura', { body: { transcribe: item } })
      if (error || data?.error) throw new Error(data?.error || (await error.context?.json?.().catch(() => null))?.error || error.message)
      setVoiceQueued(null)
      if (data.text) { setQ(prev => (prev ? prev + ' ' : '') + data.text); viaVoice.current = true }
      else setFileErr('No words heard — try again closer to the phone')
    } catch (e) {
      if (!navigator.onLine || /fetch|network|Failed/i.test(e.message)) { setVoiceQueued(item); setFileErr('No connection — the voice note will be sent when you are back online') }
      else setFileErr(e.message)
    }
    setVoiceBusy(false)
  }
  useEffect(() => {
    if (!voiceQueued) return
    const retry = () => transcribe(voiceQueued)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [voiceQueued]) // eslint-disable-line react-hooks/exhaustive-deps
  async function toggleRecord() {
    if (rec) { rec.recorder.stop(); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setFileErr('This browser cannot record voice notes')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported?.(t)) || ''
      const recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined)
      const chunks = []
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        setRec(null); setElapsed(0)
        const blob = new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' })
        if (blob.size < 1500) return setFileErr('That was too short — hold on a little longer')
        const base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob) })
        transcribe({ audio: base64, type: blob.type })
      }
      recorder.start(1000)
      setRec({ recorder, started: Date.now() })
      setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, 120000)   // 2 minutes max
    } catch (e) { setFileErr(/denied|allowed/i.test(e.message) ? 'Allow the microphone to record voice notes' : e.message) }
  }   // message index → original File objects (memory only), filed on a record after Confirm
  const end = useRef(null)

  async function addFiles(list) {
    const picked = [...(list || [])].slice(0, 3 - files.length)
    if (!picked.length) return
    setReading(true); setFileErr('')
    const out = []
    for (const f of picked) { try { out.push({ ...(await prepareFile(f)), raw: f }) } catch (e) { setFileErr(e.message) } }
    setFiles(fs => [...fs, ...out].slice(0, 3))
    setReading(false)
  }
  useEffect(() => { try { sessionStorage.setItem('ask_chat', JSON.stringify(chat.slice(-20))) } catch { /* storage off */ } end.current?.scrollIntoView({ block: 'end' }) }, [chat])

  const ask = useCallback(async text => {
    const question = (text ?? q).trim()
    const sending = files
    if ((!question && !sending.length) || busy || reading) return
    setQ(''); setFiles([]); setFileErr(''); setBusy(true)
    const history = chat.slice(-3).flatMap(m => [{ role: 'user', content: m.q }, { role: 'assistant', content: m.a || '' }])
    const page = pageInfo && useScreen ? {
      module: pageInfo.moduleId, page: pageInfo.page, title: pageInfo.title,
      context: pageInfo.pageData?.current || null,
      screen_text: pageInfo.pageData?.current ? '' : screenText(pageInfo.contentRef),
    } : null
    const fileNames = sending.map(f => f.name)
    setChat(c => { rawFiles.current[c.length] = sending.map(f => f.raw).filter(Boolean); return [...c, { q: question || (fileNames.length ? 'What is this? Match it to our records.' : ''), a: null, screen: !!page, files: fileNames }] })
    const via = viaVoice.current ? 'voice' : undefined
    viaVoice.current = false
    const { data, error } = await supabase.functions.invoke('ask-bravura', { body: { question, site_id: currentSiteId, history, page, via,
      files: sending.map(f => ({ name: f.name, type: f.type, images: f.images, text: f.text })) } })
    const a = error ? (await error.context?.json?.().catch(() => null))?.error || 'The assistant could not be reached. Try again in a minute.' : data?.answer
    setChat(c => c.map((m, i) => i === c.length - 1 ? { ...m, a, links: data?.links || [], tools: data?.tools || [], id: data?.id, check: data?.check_figures || [],
      actions: (data?.actions || []).map(x => ({ ...x, state: 'proposed' })) } : m))
    setBusy(false)
  }, [q, busy, reading, files, chat, pageInfo, useScreen, currentSiteId])

  // B4: a proposal only runs when the person presses Confirm — through the same functions the screens use.
  function setAction(mi, id, patch) { setChat(c => c.map((m, i) => i === mi ? { ...m, actions: m.actions.map(x => x.id === id ? { ...x, ...patch } : x) } : m)) }
  async function confirmAction(mi, x) {
    setAction(mi, x.id, { state: 'running' })
    const { data, error } = await supabase.rpc('ai_action_confirm', { p_id: x.id })
    if (error) { await supabase.rpc('ai_action_cancel', { p_id: x.id, p_error: error.message }); return setAction(mi, x.id, { state: 'failed', message: error.message }) }
    let message = data?.message
    const raws = rawFiles.current[mi] || []
    if (raws.length && data?.record_id && data?.record_table) {
      try {
        for (const f of raws) await attachFileToRecord(f, { siteId: data.site_id || currentSiteId, table: data.record_table, recordId: data.record_id,
          category: data.record_table === 'petty_cash_transactions' ? 'Finance' : 'Procurement' })
        message += ` · ${raws.map(f => f.name).join(', ')} saved on the record`
      } catch (e) { message += ` · the file could not be saved on the record (${e.message})` }
    }
    setAction(mi, x.id, { state: 'done', message, path: data?.path })
  }
  async function cancelAction(mi, x) {
    await supabase.rpc('ai_action_cancel', { p_id: x.id, p_error: null })
    setAction(mi, x.id, { state: 'cancelled' })
  }

  useEffect(() => {
    if (!pageInfo?.pending || busy) return
    const qq = pageInfo.pending
    pageInfo.setPending(null)
    ask(qq)
  }, [pageInfo?.pending]) // eslint-disable-line react-hooks/exhaustive-deps

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
                <li><b>Read a document</b> — attach a photo or PDF of an invoice, delivery note, quote or receipt (📎, paste or drop it). I read it, find the supplier and PO, and point out differences. Nothing is saved unless you confirm an action — then the file is kept on that record.</li>
                <li><b>Do things — with your OK</b> — receive a delivery, draft a bill from an invoice, record a petty cash spend, or draft a purchase request. I show a card; nothing is saved until you press Confirm.</li>
                <li><b>Talk to me</b> — tap 🎤 and say it ("received 20 bags of cement on PO 12, two torn"). I turn it into text for you to check.</li>
                <li><b>Your day</b> — approvals waiting, late deliveries, low stock, things expiring, budgets at risk, and alerts like unusual fuel draws or duplicate bills.</li>
                <li><b>Find anything</b> — a PO, request, supplier, vehicle, employee, stock item or incident by number or name.</li>
                <li><b>Open records</b> — POs, requests and journals I mention are clickable.</li>
              </ul>
              <div style={{ fontSize: 12, color: FIN.faint }}>I only quote figures from your records — if I can't trace one, I'll say so.</div>
            </div>
            <div style={{ fontSize: 12, color: FIN.muted }}>Try:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {suggestions.map(s => <button key={s} onClick={() => ask(s)} style={{ padding: '7px 12px', borderRadius: 16, border: `1px solid ${FIN.field}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: FIN.ink, textAlign: 'left' }}>{s}</button>)}
            </div>
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '85%', background: FIN.maroon, color: '#fff', padding: '8px 12px', borderRadius: '14px 14px 4px 14px', fontSize: 14, whiteSpace: 'pre-wrap' }}>
              {(m.files || []).length > 0 && <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 2 }}>📎 {m.files.join(', ')}</div>}
              {m.q}</div>
            <div style={{ alignSelf: 'flex-start', maxWidth: '95%', background: '#fff', border: `1px solid ${FIN.line}`, padding: '10px 12px', borderRadius: '14px 14px 14px 4px', fontSize: 14, lineHeight: 1.55 }}>
              {m.a == null ? <span style={{ color: FIN.faint }}>{(m.files || []).length ? 'Reading your document and checking it against your records…' : m.screen ? 'Reading this screen and your records…' : 'Looking through your records…'}</span> : <Formatted text={m.a} />}
              {(m.links || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                  {m.links.map(l => <button key={l.path + l.label} onClick={() => { navigate(l.path); if (compact) onClose?.() }}
                    style={{ padding: '3px 10px', borderRadius: 12, border: `1px solid ${FIN.blue}40`, background: FIN.blueTint, color: FIN.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600 }}>{l.label} ↗</button>)}
                </div>
              )}
              {(m.check || []).length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: FIN.ochreText, background: FIN.ochreTint, border: `1px solid ${FIN.ochreLine}`, borderRadius: 8, padding: '5px 9px' }}>
                  ⚠ Check {m.check.length > 1 ? 'these figures' : 'this figure'}: {m.check.join(', ')} — I couldn't trace {m.check.length > 1 ? 'them' : 'it'} to your records.
                </div>
              )}
              {(m.actions || []).map(x => <ActionCard key={x.id} x={x} onConfirm={() => confirmAction(i, x)} onCancel={() => cancelAction(i, x)}
                onOpen={p => { navigate(p); if (compact) onClose?.() }} />)}
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
      <form onSubmit={e => { e.preventDefault(); ask() }}
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
        style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: compact ? '10px 14px 14px' : '10px 0 0', borderTop: compact ? `1px solid ${FIN.line}` : 'none', background: compact ? FIN.ground : 'transparent' }}>
        {pageInfo && (
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: useScreen ? FIN.blue : FIN.faint, cursor: 'pointer', alignSelf: 'flex-start' }}>
            <input type="checkbox" checked={useScreen} onChange={e => setUseScreen(e.target.checked)} />
            Using this screen{pageInfo.title ? `: ${pageInfo.title}` : ''}
          </label>
        )}
        {(files.length > 0 || reading || fileErr || voiceBusy || voiceQueued) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {files.map((f, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 3px', borderRadius: 8, border: `1px solid ${FIN.field}`, background: '#fff', fontSize: 12.5, maxWidth: 240 }}>
                {f.images?.[0] && <img src={f.images[0]} alt="" style={{ width: 28, height: 28, objectFit: 'cover', borderRadius: 4 }} />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} style={{ border: 'none', background: 'none', cursor: 'pointer', color: FIN.muted, fontSize: 14, padding: 0 }}>×</button>
              </span>
            ))}
            {reading && <span style={{ fontSize: 12, color: FIN.faint }}>Reading the file…</span>}
            {voiceBusy && <span style={{ fontSize: 12, color: FIN.faint }}>Turning your voice note into text…</span>}
            {voiceQueued && !voiceBusy && <button type="button" onClick={() => transcribe(voiceQueued)} style={{ fontSize: 12, border: 'none', background: 'none', color: FIN.blue, cursor: 'pointer', padding: 0 }}>Try sending the voice note again</button>}
            {fileErr && <span style={{ fontSize: 12, color: FIN.bad }}>{fileErr}</span>}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileInput} type="file" accept="image/*,application/pdf" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={files.length >= 3 || reading} aria-label="Attach a photo or PDF" title="Attach an invoice, delivery note, quote or receipt (photo or PDF)"
            style={{ minHeight: 44, width: 44, flexShrink: 0, background: '#fff', border: `1px solid ${FIN.field}`, borderRadius: 10, cursor: 'pointer', fontSize: 18, color: FIN.muted }}>📎</button>
          <button type="button" onClick={toggleRecord} disabled={voiceBusy} aria-label={rec ? 'Stop recording' : 'Record a voice note'} aria-pressed={!!rec}
            title={rec ? 'Tap to stop' : 'Record a voice note (up to 2 minutes)'}
            style={{ minHeight: 44, minWidth: 44, flexShrink: 0, padding: rec ? '0 10px' : 0, background: rec ? FIN.bad : '#fff', border: `1px solid ${rec ? FIN.bad : FIN.field}`, borderRadius: 10, cursor: 'pointer', fontSize: rec ? 13 : 18, color: rec ? '#fff' : FIN.muted, fontFamily: 'inherit', fontWeight: 600 }}>
            {rec ? `■ ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : '🎤'}
          </button>
          <input id="ask-bravura-q" aria-label="Ask Bravura" autoFocus={compact} value={q} onChange={e => setQ(e.target.value)} placeholder={files.length ? 'Ask about the file, or just press Ask' : 'Ask anything…'}
            onPaste={e => { const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs) } }}
            style={{ flex: 1, minHeight: 44, padding: '8px 12px', borderRadius: 10, border: `1px solid ${FIN.field}`, fontFamily: 'inherit', fontSize: 14, color: FIN.ink, background: '#fff' }} />
          <button type="submit" disabled={busy || reading || (!q.trim() && !files.length)} style={{ minHeight: 44, padding: '0 16px', background: FIN.maroon, border: 'none', borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>{busy ? '…' : 'Ask'}</button>
        </div>
        {chat.length > 0 && <button type="button" onClick={newConversation} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', color: FIN.faint, fontSize: 12, cursor: 'pointer', padding: 0 }}>New conversation</button>}
      </form>
    </div>
  )
}

const ACTION_TITLE = { receive_delivery: 'Receive delivery', draft_bill: 'Draft bill', petty_cash_spend: 'Petty cash spend', purchase_request: 'Draft purchase request',
  approval_decision: 'Approval', po_from_quote: 'Draft purchase order', stock_issue: 'Issue stock', stock_transfer: 'Send stock',
  small_asset_issue: 'Issue small asset', small_asset_return: 'Take back small asset', fleet_job: 'Open workshop job', fleet_meter: 'Meter reading' }
function ActionCard({ x, onConfirm, onCancel, onOpen }) {
  const d = x.details || {}
  const rows = x.kind === 'receive_delivery' ? (d.lines || []).filter(l => l.qty > 0).map(l => [l.what, `${l.qty} ${l.unit || ''} of ${l.still_to_come} still to come`])
    : x.kind === 'draft_bill' ? (d.lines || []).map(l => [l.what, `${l.qty} × $${Number(l.unit_price).toFixed(2)}`])
    : x.kind === 'purchase_request' ? (d.lines || []).map(l => [l.what, `${l.quantity} ${l.unit || ''}${l.estimated_cost ? ` · ~$${Number(l.estimated_cost).toFixed(2)} each` : ''}`])
    : x.kind === 'po_from_quote' ? (d.lines || []).map(l => [l.what, `${l.qty} × $${Number(l.unit_price).toFixed(2)}`])
    : x.kind === 'stock_issue' ? [...(d.lines || []).map(l => [l.what, `${l.qty} ${l.unit || ''} (${l.free} free)`]), ['To', d.to], ['From', d.store]]
    : x.kind === 'stock_transfer' ? [...(d.lines || []).map(l => [l.what, `${l.qty} ${l.unit || ''}`]), ['From', d.from], ['To', d.to], ...(d.vehicle ? [['Vehicle', d.vehicle]] : [])]
    : x.kind === 'small_asset_issue' ? [['Item', d.item], ['To', d.to], ...(d.due_back ? [['Back by', d.due_back]] : [])]
    : x.kind === 'small_asset_return' ? [['Item', d.item], ['From', d.from], ['Condition', d.condition]]
    : x.kind === 'fleet_job' ? [['Machine', d.machine], ['Fault', d.fault], ['Priority', d.priority]]
    : x.kind === 'fleet_meter' ? [['Machine', d.machine], ...(d.km != null ? [['Odometer', `${d.km} km (last ${d.last_km ?? '—'})`]] : []), ...(d.hours != null ? [['Hours', `${d.hours} h (last ${d.last_hours ?? '—'})`]] : [])]
    : x.kind === 'approval_decision' ? [['Decision', d.approve ? 'Approve' : 'Reject'], ['Item', d.title], ['Requested by', d.from || '—'], ['Step', d.step || '—'], ...(d.comment ? [['Comment', d.comment]] : [])]
    : [['From', d.fund], ['Balance after', `$${Number(d.balance_after || 0).toFixed(2)}`]]
  const warn = x.kind === 'draft_bill' && d.supplier_hold && d.supplier_hold !== 'none' ? `Supplier is on hold (${d.supplier_hold})` : x.kind === 'fleet_meter' && d.warning ? d.warning : null
  const done = x.state === 'done', failed = x.state === 'failed', off = x.state === 'cancelled'
  return (
    <div style={{ marginTop: 10, border: `1px solid ${done ? FIN.good : failed ? FIN.bad : FIN.maroon}55`, borderLeftWidth: 4, borderRadius: 10, padding: '10px 12px', background: done ? FIN.goodTint : '#FFFBFA', opacity: off ? 0.6 : 1 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', color: done ? FIN.good : FIN.maroon }}>{ACTION_TITLE[x.kind] || 'Action'} · {done ? 'done' : failed ? 'not done' : off ? 'cancelled' : 'needs your OK'}</div>
      <div style={{ fontSize: 13.5, fontWeight: 600, margin: '4px 0 6px' }}>{x.summary}</div>
      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2px 12px', fontSize: 12.5, color: FIN.muted, marginBottom: 6 }}>
          {rows.slice(0, 8).map(([a, b], k) => <Fragment key={k}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a}</span><span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{b}</span></Fragment>)}
        </div>
      )}
      {warn && <div style={{ fontSize: 12.5, color: FIN.bad, marginBottom: 6 }}>⚠ {warn}</div>}
      {x.message && <div style={{ fontSize: 12.5, color: failed ? FIN.bad : FIN.good, marginBottom: 6 }}>{x.message}</div>}
      {(x.state === 'proposed' || x.state === 'running') && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onConfirm} disabled={x.state === 'running'} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: FIN.maroon, color: '#fff', fontFamily: 'inherit', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>{x.state === 'running' ? 'Working…' : 'Confirm'}</button>
          <button onClick={onCancel} disabled={x.state === 'running'} style={{ padding: '7px 14px', borderRadius: 8, border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        </div>
      )}
      {done && x.path && <button onClick={() => onOpen(x.path)} style={{ padding: 0, border: 'none', background: 'none', color: FIN.blue, fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Open ↗</button>}
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
        <button onClick={() => ctx.setOpen(true)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} aria-label="Ask Bravura" title="Ask Bravura"
          style={{ position: 'fixed', left: '50%', bottom: narrow ? 14 : 20, transform: `translateX(-50%) translateY(${hover ? -2 : 0}px)`, zIndex: 900,
            display: 'flex', alignItems: 'center', gap: 8, height: 46, padding: '0 20px 0 14px', borderRadius: 23, border: 'none', cursor: 'pointer',
            background: `linear-gradient(135deg, ${FIN.maroon}, #6E1A1F)`, color: '#fff', fontFamily: FIN.sans, fontSize: 14.5, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(152,35,41,.35), 0 2px 6px rgba(0,0,0,.12)', transition: 'transform .15s' }}>
          <span aria-hidden="true" style={{ fontSize: 18 }}>✦</span> Ask Bravura
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
