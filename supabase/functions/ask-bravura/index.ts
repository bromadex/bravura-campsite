// ── ask-bravura ─────────────────────────────────────────────────────────────
// AI assistant, stage A1 (issue #49): questions about spending.
// Principles: the model never sees tables — it can only call the read-only ai_* database functions,
// and those run as the person asking (their login is forwarded), so permissions and sites still apply.
// Every question/answer is logged in ai_questions. Provider: Groq (OpenAI-compatible), Qwen preferred.
//
// POST { question, site_id, history?: [{role, content}] }  → { answer, tools, model, id }
// POST { ping: true }                                       → { model, models }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const GROQ_KEY = Deno.env.get('GROQ_API_KEY')!
const GROQ = 'https://api.groq.com/openai/v1'
const DAILY_LIMIT = 60

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } })

let chosenModel: string | null = null
let modelList: string[] = []
async function pickModel(): Promise<string> {
  if (Deno.env.get('GROQ_MODEL')) return Deno.env.get('GROQ_MODEL')!
  if (chosenModel) return chosenModel
  try {
    const r = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${GROQ_KEY}` } })
    const d = await r.json()
    modelList = (d.data || []).map((m: { id: string }) => m.id)
  } catch { /* fall through */ }
  chosenModel = ['qwen/qwen3-32b'].find(m => modelList.includes(m))
    || modelList.find(m => /qwen/i.test(m))
    || 'llama-3.3-70b-versatile'
  return chosenModel
}

const TOOLS = [
  { type: 'function', function: {
    name: 'spend_summary',
    description: 'Total posted costs (USD) for a date range, broken down. Use for "how much did we spend this week/month", "what did we spend most on", spend by site/cost centre/project/week.',
    parameters: { type: 'object', properties: {
      site: { type: 'string', description: 'Site name, or "all" for every site the person can see. Default: the current site.' },
      date_from: { type: 'string', description: 'YYYY-MM-DD' }, date_to: { type: 'string', description: 'YYYY-MM-DD' },
      group_by: { type: 'string', enum: ['account', 'site', 'cost_centre', 'project', 'week', 'month'] },
    }, required: ['date_from', 'date_to'] } } },
  { type: 'function', function: {
    name: 'spend_on',
    description: 'How much was spent on one thing (e.g. tyres, diesel, catering, a supplier name) in a date range: costs already booked plus amounts ordered on purchase orders, with example records.',
    parameters: { type: 'object', properties: {
      search: { type: 'string', description: 'One or two words, e.g. "tyre", "diesel", "catering"' },
      site: { type: 'string' }, date_from: { type: 'string' }, date_to: { type: 'string' },
    }, required: ['search', 'date_from', 'date_to'] } } },
  { type: 'function', function: {
    name: 'supplier_history',
    description: 'Orders, bills, payments, amount owed, late orders and top items for one supplier in a date range.',
    parameters: { type: 'object', properties: {
      supplier: { type: 'string' }, site: { type: 'string' }, date_from: { type: 'string' }, date_to: { type: 'string' },
    }, required: ['supplier', 'date_from', 'date_to'] } } },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405)
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'Sign in first' }, 401)
  if (!GROQ_KEY) return json({ error: 'The AI key is not set up yet' }, 500)

  const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: userData } = await db.auth.getUser()
  const user = userData?.user
  if (!user) return json({ error: 'Sign in first' }, 401)

  let body: { question?: string; site_id?: string; history?: { role: string; content: string }[]; ping?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }
  const model = await pickModel()
  if (body.ping) return json({ model, models: modelList.filter(m => /qwen|llama|gpt-oss/i.test(m)) })

  const question = (body.question || '').trim().slice(0, 1000)
  if (!question) return json({ error: 'Ask a question' }, 400)

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { count } = await db.from('ai_questions').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since)
  if ((count || 0) >= DAILY_LIMIT) return json({ error: `You've reached today's limit of ${DAILY_LIMIT} questions` }, 429)

  // Sites this person can see, for turning "Kamativi" / "all" into ids.
  const { data: sites } = await db.from('sites').select('id, name').eq('is_active', true)
  const siteList = (sites || []) as { id: string; name: string }[]
  const current = siteList.find(s => s.id === body.site_id)
  const siteIds = (name?: string): string[] | null => {
    if (!name) return body.site_id ? [body.site_id] : null
    if (/^all/i.test(name)) return null
    const m = siteList.find(s => s.name.toLowerCase().startsWith(name.toLowerCase().trim().slice(0, 4)))
    return m ? [m.id] : (body.site_id ? [body.site_id] : null)
  }

  const today = new Date().toISOString().slice(0, 10)
  const system = `You are "Ask Bravura", the assistant inside Bravura's ERP. Bravura Zimbabwe runs mining camps; it only buys (no sales, no VAT), all amounts are USD.
Today is ${today} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}). Weeks start on Monday. The person is looking at site "${current?.name || 'unknown'}". Sites: ${siteList.map(s => s.name).join(', ')}.
Rules:
- Only state figures that come from the tools. Never guess or invent numbers. If the tools return nothing, say so plainly and suggest why (e.g. nothing posted yet in that period).
- Call a tool before answering any question about money. Work out exact dates yourself (e.g. "this week" = Monday of this week to today; "last month" = the previous calendar month).
- Answer in 1–4 short sentences, then up to 5 bullet points if useful. Plain words, no jargon. Format money like $1,234.56.
- Mention the record numbers (journal JV-…, PO numbers) you relied on so the person can check.
- Booked cost = already in the books; ordered on POs = committed but maybe not billed yet — say which you mean.
- If the question is not about spending, suppliers or costs, say you can only answer spending questions for now.`

  const messages: Record<string, unknown>[] = [{ role: 'system', content: system }]
  for (const h of (body.history || []).slice(-6)) {
    if ((h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') messages.push({ role: h.role, content: h.content.slice(0, 2000) })
  }
  messages.push({ role: 'user', content: question })

  const used: { name: string; args: unknown }[] = []
  let tokens = 0
  let answer = ''
  let error: string | null = null
  try {
    for (let round = 0; round < 5; round++) {
      const payload: Record<string, unknown> = { model, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 900 }
      if (/qwen3/i.test(model)) payload.reasoning_format = 'hidden'
      let r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      if (!r.ok && payload.reasoning_format) {
        delete payload.reasoning_format
        r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      }
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error?.message || `AI service error ${r.status}`)
      tokens += d.usage?.total_tokens || 0
      const msg = d.choices?.[0]?.message
      const calls = msg?.tool_calls || []
      if (!calls.length) { answer = (msg?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); break }
      messages.push({ role: 'assistant', content: msg.content || '', tool_calls: calls })
      for (const c of calls) {
        let args: Record<string, string> = {}
        try { args = JSON.parse(c.function.arguments || '{}') } catch { /* bad args */ }
        used.push({ name: c.function.name, args })
        let result: unknown
        if (c.function.name === 'spend_summary') {
          result = (await db.rpc('ai_spend_summary', { p_site_ids: siteIds(args.site), p_from: args.date_from, p_to: args.date_to, p_group: args.group_by || 'account' })).data
        } else if (c.function.name === 'spend_on') {
          result = (await db.rpc('ai_spend_on', { p_site_ids: siteIds(args.site), p_from: args.date_from, p_to: args.date_to, p_search: args.search })).data
        } else if (c.function.name === 'supplier_history') {
          result = (await db.rpc('ai_supplier_history', { p_site_ids: siteIds(args.site), p_supplier: args.supplier, p_from: args.date_from, p_to: args.date_to })).data
        } else result = { error: 'Unknown tool' }
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result ?? { error: 'No result — check the dates' }).slice(0, 8000) })
      }
    }
    if (!answer) answer = "I couldn't finish working that out — try asking more simply."
  } catch (e) {
    error = (e as Error).message
    answer = 'Sorry — the AI service did not answer. Please try again in a minute.'
  }

  const { data: logged } = await db.from('ai_questions').insert({ user_id: user.id, site_id: body.site_id || null, question, answer, tools: used, model, tokens, error })
    .select('id').single()
  return json({ answer, tools: used, model, id: logged?.id, error })
})
