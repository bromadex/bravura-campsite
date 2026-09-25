import { useState, useRef, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import Denied from '../../components/Denied'
import FinShell from '../../components/FinShell'
import { FIN, finCard, finBtn, finInput } from '../../utils/financeTheme'

// FI29 — Ask Bravura (AI stage A1, issue #49). Plain-language questions about spending. The answer comes
// from the ask-bravura edge function, which can only use read-only spending functions that run with the
// asker's own permissions. Every answer shows which lookups it used.
const EXAMPLES = [
  'How much did we spend this week?',
  'What did we spend the most on this month?',
  'How much have we spent on diesel since 1 September?',
  'Compare spending by site this month',
  'What have we bought from our main tyre supplier this year?',
]
const TOOL_LABEL = { spend_summary: 'Spending summary', spend_on: 'Spending on an item', supplier_history: 'Supplier history' }

export default function AskBravura({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [chat, setChat] = useState([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'auto', block: 'end' }) }, [chat])

  if (!can('finance.view') && !can('procurement.view')) return <Denied />

  async function ask(text) {
    const question = (text ?? q).trim()
    if (!question || busy) return
    setQ(''); setBusy(true)
    const history = chat.flatMap(m => [{ role: 'user', content: m.q }, { role: 'assistant', content: m.a || '' }])
    setChat(c => [...c, { q: question, a: null }])
    const { data, error } = await supabase.functions.invoke('ask-bravura', { body: { question, site_id: currentSiteId, history } })
    const a = error ? (await error.context?.json?.().catch(() => null))?.error || 'The assistant could not be reached. Try again in a minute.' : data?.answer
    setChat(c => c.map((m, i) => i === c.length - 1 ? { ...m, a, tools: data?.tools || [], id: data?.id, model: data?.model } : m))
    setBusy(false)
  }
  async function rate(m, v) {
    if (!m.id) return
    await supabase.from('ai_questions').update({ rating: v }).eq('id', m.id)
    setChat(c => c.map(x => x === m ? { ...x, rated: v } : x))
  }

  return (
    <FinShell title="Ask Bravura" subtitle="Ask about spending in plain words — answers come only from your own records" setPage={setPage}>
      <div style={{ maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {chat.length === 0 && (
          <section style={{ ...finCard }}>
            <div style={{ fontSize: 14, color: FIN.muted, marginBottom: 10 }}>Try one of these:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {EXAMPLES.map(e => <button key={e} onClick={() => ask(e)} style={{ padding: '8px 14px', borderRadius: 18, border: `1px solid ${FIN.field}`, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, color: FIN.ink }}>{e}</button>)}
            </div>
            <div style={{ fontSize: 12, color: FIN.faint, marginTop: 12 }}>It reads, never changes anything, and only sees sites you have access to. Questions are logged. Check important figures in Reports.</div>
          </section>
        )}
        {chat.map((m, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ alignSelf: 'flex-end', maxWidth: '80%', background: FIN.maroon, color: '#fff', padding: '10px 14px', borderRadius: '14px 14px 4px 14px', fontSize: 14, whiteSpace: 'pre-wrap' }}>{m.q}</div>
            <div style={{ ...finCard, alignSelf: 'flex-start', maxWidth: '90%', padding: '12px 16px', fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
              {m.a == null ? <span style={{ color: FIN.faint }}>Looking through the books…</span> : m.a}
              {m.a != null && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, fontSize: 11.5, color: FIN.faint }}>
                  {(m.tools || []).length > 0 && <span>Used: {[...new Set(m.tools.map(t => TOOL_LABEL[t.name] || t.name))].join(', ')}{m.tools[0]?.args?.date_from ? ` · ${m.tools[0].args.date_from} to ${m.tools[0].args.date_to}` : ''}</span>}
                  {m.id && (m.rated ? <span>Thanks for the feedback</span> : <>
                    <button onClick={() => rate(m, 1)} aria-label="Helpful" style={{ border: 'none', background: 'none', cursor: 'pointer', color: FIN.muted }}>👍</button>
                    <button onClick={() => rate(m, -1)} aria-label="Not helpful" style={{ border: 'none', background: 'none', cursor: 'pointer', color: FIN.muted }}>👎</button>
                  </>)}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={end} />
        <form onSubmit={e => { e.preventDefault(); ask() }} style={{ display: 'flex', gap: 8, position: 'sticky', bottom: 0, background: FIN.ground, paddingBlock: 8 }}>
          <input id="ask-q" aria-label="Your question" value={q} onChange={e => setQ(e.target.value)} placeholder="e.g. How much did we spend on tyres this year?" style={{ ...finInput, flex: 1, minHeight: 48, fontSize: 15 }} />
          <button type="submit" style={{ ...finBtn, minHeight: 48 }} disabled={busy || !q.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
        </form>
      </div>
    </FinShell>
  )
}
