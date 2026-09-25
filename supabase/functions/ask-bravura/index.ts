// ── ask-bravura ─────────────────────────────────────────────────────────────
// AI assistant (issues #49, #58). A1: spending questions. B2: read tools per module + find. B3: attached files read (not stored) + match_document. B1: reads the screen the person is on
// (structured context from useAskContext, or the visible text), exact `calculate` tool, record links.
// Principles: the model never sees tables — it can only call the read-only ai_* database functions,
// and those run as the person asking (their login is forwarded), so permissions and sites still apply.
// Every question/answer is logged in ai_questions. Provider: Groq (OpenAI-compatible), Qwen preferred.
//
// POST { question, site_id, history?, page?: {module, page, title, context, screen_text} } → { answer, links, tools, model, id }
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

// Free-tier Groq has small per-model token limits, so each call can fall back to another model
// (each model has its own limit). Tries the list in order on rate limits / overload / bad params.
async function groqChat(models: string[], base: Record<string, unknown>): Promise<{ ok: boolean; data: any; model: string; error?: string }> {
  let last = ''
  for (const m of [...new Set(models.filter(Boolean))]) {
    const payload: Record<string, unknown> = { ...base, model: m }
    if (/qwen3/i.test(m)) payload.reasoning_format = 'hidden'
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const d = await r.json().catch(() => ({}))
      if (r.ok) return { ok: true, data: d, model: m }
      last = `${m}: ${d?.error?.message || r.status}`
      if (attempt === 0 && payload.reasoning_format && r.status === 400) { delete payload.reasoning_format; continue }
      break
    }
  }
  return { ok: false, data: null, model: '', error: last }
}
async function chatModels(first: string): Promise<string[]> {
  if (!modelList.length) await pickModel()
  const have = (m: string) => !modelList.length || modelList.includes(m)
  return [first, ...['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'].filter(have)]
}

// ── Exact arithmetic (the model must not do sums in its head) ────────────────
// Numbers, + - * / ^ %, parentheses and sum/avg/min/max/round/abs/count. No variables, no code.
function calc(expr: string): number {
  const src = expr.replace(/,(?=\d{3}(\D|$))/g, '').replace(/\$/g, '')
  let i = 0
  const peek = () => src[i]
  const ws = () => { while (/\s/.test(src[i] || '')) i++ }
  const num = (): number => {
    ws(); const m = /^-?\d+(\.\d+)?/.exec(src.slice(i)); if (!m) throw new Error('Expected a number at ' + i); i += m[0].length; return parseFloat(m[0])
  }
  const fnArgs = (): number[] => { ws(); if (peek() !== '(') throw new Error('Expected ('); i++; const a = [expr_()]; ws(); while (peek() === ',') { i++; a.push(expr_()); ws() } if (peek() !== ')') throw new Error('Expected )'); i++; return a }
  const atom = (): number => {
    ws()
    const f = /^(sum|avg|average|min|max|round|abs|count)\b/i.exec(src.slice(i))
    if (f) { i += f[0].length; const a = fnArgs(); const n = f[0].toLowerCase()
      if (n === 'sum') return a.reduce((x, y) => x + y, 0)
      if (n === 'avg' || n === 'average') return a.reduce((x, y) => x + y, 0) / a.length
      if (n === 'min') return Math.min(...a)
      if (n === 'max') return Math.max(...a)
      if (n === 'abs') return Math.abs(a[0])
      if (n === 'count') return a.length
      return Math.round(a[0] * 10 ** (a[1] ?? 2)) / 10 ** (a[1] ?? 2) }
    if (peek() === '(') { i++; const v = expr_(); ws(); if (peek() !== ')') throw new Error('Expected )'); i++; return v }
    if (peek() === '-') { i++; return -atom() }
    return num()
  }
  const pow = (): number => { let v = atom(); ws(); while (peek() === '^') { i++; v = v ** atom(); ws() } return v }
  const term = (): number => { let v = pow(); ws(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = src[i++]; const r = pow(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; ws() } return v }
  function expr_(): number { let v = term(); ws(); while (peek() === '+' || peek() === '-') { const o = src[i++]; const r = term(); v = o === '+' ? v + r : v - r; ws() } return v }
  const v = expr_(); ws(); if (i < src.length) throw new Error('Unexpected "' + src.slice(i, i + 10) + '"')
  if (!isFinite(v)) throw new Error('Result is not a number (division by zero?)')
  return Math.round(v * 1e6) / 1e6
}

// Record numbers mentioned in the answer / tool results → links that open the record.
async function findLinks(db: ReturnType<typeof createClient>, text: string, siteId?: string) {
  const uniq = (re: RegExp) => [...new Set(text.match(re) || [])].slice(0, 8)
  const links: { label: string; path: string }[] = []
  const pos = uniq(/\b[A-Z]{2,5}-PO-\d{4}-\d{3,6}(?:-\d+)?\b/g)
  if (pos.length) { const { data } = await db.from('purchase_orders').select('id, po_number').in('po_number', pos); for (const r of data || []) links.push({ label: r.po_number, path: `/procurement/proc_orders:${r.id}` }) }
  const reqs = uniq(/\b[A-Z]{2,5}-PR-\d{4}-\d{3,6}\b/g)
  if (reqs.length) { const { data } = await db.from('purchase_requisitions').select('id, requisition_no').in('requisition_no', reqs); for (const r of data || []) links.push({ label: r.requisition_no, path: `/procurement/proc_requisitions:${r.id}` }) }
  const jvs = uniq(/\bJV-\d{3,6}\b/g)
  if (jvs.length && siteId) { const { data } = await db.from('journal_entries').select('id, entry_number').eq('site_id', siteId).in('entry_number', jvs); for (const r of data || []) links.push({ label: r.entry_number, path: `/finance/fi_journal_detail:${r.id}` }) }
  for (const g of uniq(/\b[A-Z]{2,5}-GRN-\d{4}-\d{3,6}\b/g)) links.push({ label: g, path: '/procurement/proc_grn' })
  for (const a of uniq(/\b[A-Z]{2,5}-AG-\d{4}-\d{3,6}\b/g)) links.push({ label: a, path: '/procurement/proc_agreements' })
  return links
}

const TOOLS = [
  { type: 'function', function: {
    name: 'calculate',
    description: 'Exact arithmetic. ALWAYS use this for any total, difference, average, percentage or per-unit figure instead of working it out yourself. Example: "sum(120.50, 80, 45.25)" or "(4380 - 3900) / 3900 * 100".',
    parameters: { type: 'object', properties: { expression: { type: 'string' }, label: { type: 'string', description: 'What is being calculated, e.g. "total overdue"' } }, required: ['expression'] } } },

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
  { type: 'function', function: {
    name: 'match_document',
    description: 'Match an ATTACHED document (invoice, delivery note, quote, receipt) to our records: finds the supplier, the purchase order(s) it belongs to (with ordered/received lines, receipts and bills) and whether a bill with that number already exists. Call it for every attached supplier document.',
    parameters: { type: 'object', properties: {
      supplier: { type: 'string', description: 'Supplier name as printed' }, doc_number: { type: 'string', description: 'Invoice / delivery note number' },
      po_ref: { type: 'string', description: 'Our PO number if printed on it' }, total: { type: 'number' }, site: { type: 'string' },
    }, required: ['supplier'] } } },
  { type: 'function', function: {
    name: 'notifications',
    description: "The person's own notifications (approvals waiting, reminders, alerts): unread count, by category and the latest items with title, message and time. Use for 'do I have notifications', 'what needs my approval', 'any alerts'.",
    parameters: { type: 'object', properties: {
      unread_only: { type: 'boolean', description: 'Default true' }, search: { type: 'string', description: 'Optional word or category, e.g. approval, leave, fuel' },
    } } } },
  // B4: proposals. These never change anything — they put a card in front of the person, who presses Confirm.
  { type: 'function', function: {
    name: 'propose_receive_delivery',
    description: 'Propose receiving a delivery against a purchase order (e.g. from a delivery note the person attached, or "we received the 4 tyres on PO …"). Leave lines empty to receive everything still to come.',
    parameters: { type: 'object', properties: {
      po: { type: 'string', description: 'PO number' }, delivery_ref: { type: 'string', description: "Supplier's delivery note number" },
      lines: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, qty: { type: 'number' } } } }, site: { type: 'string' },
    }, required: ['po'] } } },
  { type: 'function', function: {
    name: 'propose_draft_bill',
    description: "Propose saving a supplier invoice as a DRAFT bill (it still needs approval in Pay Suppliers). Use after reading an attached invoice. Lines need what, qty and unit_price.",
    parameters: { type: 'object', properties: {
      supplier: { type: 'string' }, invoice_number: { type: 'string' }, invoice_date: { type: 'string', description: 'YYYY-MM-DD' }, po: { type: 'string' },
      lines: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, unit_price: { type: 'number' } } } }, site: { type: 'string' },
    }, required: ['supplier', 'invoice_number', 'lines'] } } },
  { type: 'function', function: {
    name: 'propose_petty_cash_spend',
    description: "Propose recording money spent from the person's petty cash box (e.g. from a till slip). Amount in USD.",
    parameters: { type: 'object', properties: {
      amount: { type: 'number' }, what: { type: 'string' }, category: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD' }, site: { type: 'string' },
    }, required: ['amount', 'what'] } } },
  { type: 'function', function: {
    name: 'propose_purchase_request',
    description: 'Propose a DRAFT purchase request for things the site needs (the person checks it and sends it for approval).',
    parameters: { type: 'object', properties: {
      title: { type: 'string' }, needed_by: { type: 'string', description: 'YYYY-MM-DD' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
      lines: { type: 'array', items: { type: 'object', properties: { what: { type: 'string' }, qty: { type: 'number' }, unit: { type: 'string' }, estimated_cost: { type: 'number' } } } }, site: { type: 'string' },
    }, required: ['title', 'lines'] } } },
  ...([
    ['fuel', 'Fuel: litres issued and delivered, top-using vehicles/machines, litres per day, tank levels now. Use for fuel consumption/usage/diesel questions. Optional search narrows to one vehicle (fleet no., reg, make).', true, true],
    ['fleet', 'Fleet: vehicles/machines by status, open work orders, services due in 14 days, licence/insurance/roadworthy expiring in 30 days, maintenance jobs and cost in the period.', true, false],
    ['stock', 'Stores: on-hand quantity and value for items matching the search (per store), or with no search the total stock value and items at/below reorder level.', false, true],
    ['people', 'HR: active employees and by department, who is on leave today, leave waiting approval, attendance (absent, late, hours, overtime) in the period.', true, false],
    ['sheq', 'Safety (SHEQ): incidents in the period, open incidents, open and overdue corrective actions.', true, false],
    ['meals', 'Meals: breakfasts, lunches and suppers served in the period, per day.', true, false],
    ['camp', 'Camp accommodation: rooms, beds, occupied now, who checks out in the next 7 days.', false, false],
    ['procurement', 'Procurement status now: open requests, POs by status, POs waiting approval, late deliveries.', false, false],
    ['leave', 'Leave requests in a period (by applied or start date) with status approved / pending / rejected / cancelled, who, dates, days and the rejection reason. Optional search = a status to filter by.', true, true],
    ['find', 'Find a record by number or name across modules (POs, requests, suppliers, vehicles, employees, stock items, incidents). Use when the person names something specific.', false, true],
  ] as [string, string, boolean, boolean][]).map(([name, description, dated, search]) => ({ type: 'function', function: { name, description,
    parameters: { type: 'object', properties: {
      site: { type: 'string', description: 'Site name, or "all". Default: the current site.' },
      ...(dated ? { date_from: { type: 'string', description: 'YYYY-MM-DD' }, date_to: { type: 'string', description: 'YYYY-MM-DD' } } : {}),
      ...(search ? { search: { type: 'string' } } : {}),
    }, required: [...(dated ? ['date_from', 'date_to'] : []), ...(name === 'find' ? ['search'] : [])] } } })),
]

// ── B3: attached files are read here, never stored ─────────────────────────
// The browser sends images (photos, scans, PDF pages rendered to JPEG) and any text layer of a PDF.
// A vision model turns each into structured JSON; the chat model then matches it with match_document.
type AskFile = { name?: string; type?: string; images?: string[]; text?: string }
// Vision models come and go on Groq, so try every image-capable model the account lists, in order.
async function visionCandidates(): Promise<string[]> {
  if (!modelList.length) {
    try { const r = await fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${GROQ_KEY}` } }); modelList = ((await r.json()).data || []).map((m: { id: string }) => m.id) } catch { /* none */ }
  }
  const pref = [/llama-4-maverick/i, /llama-4-scout/i, /vision/i, /[-_/]vl\b|-vl-/i, /gemma-?3/i, /llava/i, /pixtral/i, /qwen.*(2\.5|3).*vl/i, /qwen3\.[5-9]|qwen-?3\.[5-9]/i]
  const found = pref.flatMap(re => modelList.filter(m => re.test(m)))
  return [...new Set([Deno.env.get('GROQ_VISION_MODEL') || '', ...found].filter(Boolean))]
}
const READ_PROMPT = `Read this business document (a supplier invoice, delivery note, quotation, receipt, statement or other). Return ONLY JSON:
{"doc_type": "invoice|delivery_note|quote|receipt|statement|other", "supplier": "", "doc_number": "", "date": "YYYY-MM-DD", "po_ref": "", "currency": "",
 "subtotal": null, "tax": null, "total": null, "lines": [{"description": "", "qty": null, "unit_price": null, "amount": null}], "notes": "anything else important, short"}
Copy numbers exactly as printed. Use null when something is not on the document. Do not guess.`
async function readFile(f: AskFile): Promise<Record<string, unknown>> {
  const images = (f.images || []).filter(u => typeof u === 'string' && u.startsWith('data:image/')).slice(0, 3)
  const text = (f.text || '').slice(0, 12000)
  if (!images.length && !text) return { file: f.name, error: 'Nothing readable in this file' }
  const content: unknown[] = [{ type: 'text', text: READ_PROMPT + (text ? '\n\nText layer of the document:\n' + text : '') }]
  for (const u of images) content.push({ type: 'image_url', image_url: { url: u } })
  // Try picture-reading models first; if none works, fall back to the words read off the picture in the browser (OCR).
  const vision = images.length ? await visionCandidates() : []
  const textModels = (await chatModels(await pickModel())).reverse()   // smallest first: keeps the main model's quota for the answer
  const attempts: [string, boolean][] = [...vision.map(m => [m, true] as [string, boolean]), ...(text ? textModels.map(m => [m, false] as [string, boolean]) : [])]
  if (!attempts.length) return { file: f.name, error: 'No picture-reading model on the AI account and no text could be read from the picture' }
  let d: Record<string, any> | null = null; let lastErr = ''; let how = ''
  for (const [model, withImages] of attempts) {
    for (const json_mode of [true, false]) {
      const payload: Record<string, unknown> = { model, messages: [{ role: 'user', content: withImages ? content : (content[0] as { text: string }).text }], temperature: 0, max_tokens: 1500 }
      if (json_mode) payload.response_format = { type: 'json_object' }
      if (/qwen3/i.test(model)) payload.reasoning_format = 'hidden'
      const r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await r.json()
      if (r.ok) { d = body; how = withImages ? 'picture' : 'text read from the file'; break }
      lastErr = `${model}: ${body?.error?.message || r.status}`
      if (/does not exist|not have access|decommission|image|vision|multimodal|content.*(array|type)|rate limit|429/i.test(lastErr) || r.status === 429) break
    }
    if (d) break
  }
  if (!d) return { file: f.name, error: lastErr + ' | tried: ' + attempts.map(a => a[0]).join(', ') + ' | available: ' + modelList.join(', ') }
  const raw = String(d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '')
  const note = how === 'picture' || f.type !== 'image' ? {} : { read_from: 'OCR text of the picture — spelling and numbers may be slightly off; say so if something looks wrong' }
  try { return { file: f.name, ...note, ...JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) } }
  catch { return { file: f.name, ...note, text: raw.slice(0, 3000) } }
}

// B4 (0224): tool → [action kind, prepare RPC, params, one-line summary for the card]
const money = (n: unknown) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PROPOSE: Record<string, [string, string, (a: Record<string, any>, s: string[] | null) => Record<string, unknown>, (p: Record<string, any>) => string]> = {
  propose_receive_delivery: ['receive_delivery', 'ai_prepare_receive', (a, s) => ({ p_site_ids: s, p_po: a.po, p_lines: a.lines?.length ? a.lines : null, p_delivery_ref: a.delivery_ref || null }),
    p => `Receive on ${p.po} (${p.supplier}): ` + (p.lines || []).filter((l: any) => l.qty > 0).map((l: any) => `${l.qty} ${l.unit || ''} ${l.what}`.replace(/\s+/g, ' ')).join(', ')],
  propose_draft_bill: ['draft_bill', 'ai_prepare_bill', (a, s) => ({ p_site_ids: s, p_supplier: a.supplier, p_invoice_number: a.invoice_number, p_invoice_date: a.invoice_date || null, p_lines: a.lines || [], p_po: a.po || null }),
    p => `Draft bill ${p.invoice_number} from ${p.supplier} for ${money(p.total)}${p.po ? ` (PO ${p.po})` : ''}`],
  propose_petty_cash_spend: ['petty_cash_spend', 'ai_prepare_petty_cash', (a, s) => ({ p_site_ids: s, p_amount: Number(a.amount), p_what: a.what, p_category: a.category || null, p_date: a.date || null }),
    p => `Spend ${money(p.amount)} from ${p.fund} for ${p.what} (leaves ${money(p.balance_after)})`],
  propose_purchase_request: ['purchase_request', 'ai_prepare_request', (a, s) => ({ p_site_ids: s, p_title: a.title, p_lines: a.lines || [], p_needed_by: a.needed_by || null, p_priority: a.priority || 'normal' }),
    p => `Draft request "${p.title}": ` + (p.lines || []).map((l: any) => `${l.quantity} ${l.unit || ''} ${l.what}`.replace(/\s+/g, ' ')).join(', ')],
}

// B2 (0221): one read-only ai_* function per module → [rpc, takes dates, takes search]
const MODULE_RPC: Record<string, [string, boolean, boolean]> = {
  fuel: ['ai_fuel', true, true], fleet: ['ai_fleet', true, false], stock: ['ai_stock', false, true], people: ['ai_people', true, false],
  sheq: ['ai_sheq', true, false], meals: ['ai_meals', true, false], camp: ['ai_camp', false, false], procurement: ['ai_procurement', false, false],
  find: ['ai_find', false, true], leave: ['ai_leave', true, true],
}
const EXTRA_ARG: Record<string, string> = { leave: 'p_status' }

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

  let body: { files?: AskFile[]; question?: string; site_id?: string; history?: { role: string; content: string }[]; ping?: boolean;
    page?: { module?: string; page?: string; title?: string; context?: unknown; screen_text?: string } | null } = {}
  try { body = await req.json() } catch { /* empty */ }
  const model = await pickModel()
  if (body.ping) return json({ model, models: modelList.filter(m => /qwen|llama|gpt-oss/i.test(m)) })

  const files = (Array.isArray(body.files) ? body.files : []).slice(0, 3)
  const question = ((body.question || '').trim() || (files.length ? 'What is this document? Match it to our records.' : '')).slice(0, 1000)
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
  const system = `You are "Ask Bravura", the assistant inside Bravura's ERP. Bravura Zimbabwe runs mining camps; it only buys (no sales, no VAT), all amounts are USD. You can also read the person's own notifications. Modules: finance, procurement, fuel, fleet, stores, HR, SHEQ (safety), meals, camp. You have a read tool for each — pick the one that fits (fuel usage → fuel, not spend_on).
Today is ${today} (${new Date().toLocaleDateString('en-GB', { weekday: 'long' })}). Weeks start on Monday. The person is looking at site "${current?.name || 'unknown'}". Sites: ${siteList.map(s => s.name).join(', ')}.
Rules:
- Only state figures that come from the tools or the SCREEN section. Never guess or invent numbers. If the tools return nothing, say so plainly and suggest why (e.g. nothing posted yet in that period).
- If a tool returns an error saying the person has no access, tell them plainly.
- For money questions not answered by the SCREEN section, call a tool first. Work out exact dates yourself (e.g. "this week" = Monday of this week to today; "last month" = the previous calendar month).
- Answer in 1–4 short sentences, then up to 5 bullet points if useful. Plain words, no jargon. Format money like $1,234.56.
- Mention the record numbers (journal JV-…, PO numbers) you relied on so the person can check.
- Booked cost = already in the books; ordered on POs = committed but maybe not billed yet — say which you mean.
- For ANY arithmetic (totals, differences, averages, percentages), call the calculate tool and use its result. Show the working briefly.
- When the person asks about "this screen", "here", "these", use the SCREEN section below. Only use figures that appear there or come from tools.
- If you can't answer from the screen or the tools, say what you can answer instead.\n- You never change anything yourself. For receiving a delivery, drafting a bill, recording a petty cash spend or drafting a purchase request, call the matching propose_ tool: the person gets a card and must press Confirm. Only propose when the person asks for it or clearly wants it (e.g. 'record this', 'receive it', 'draft the bill'). Other changes (approvals, payments, POs) are done on their screens — say which one.`
  const pg = body.page
  const screen = pg ? `\n\nSCREEN the person is looking at — module: ${pg.module || '?'}, page: ${pg.title || pg.page || '?'}\n` +
    (pg.context ? 'Structured data shown on screen:\n' + JSON.stringify(pg.context).slice(0, 7000)
                : (pg.screen_text ? 'Visible text on screen:\n' + String(pg.screen_text).slice(0, files.length ? 1500 : 5000) : '(nothing captured)')) : ''

  const docs = files.length ? await Promise.all(files.map(f => readFile(f).catch(e => ({ file: f.name, error: (e as Error).message })))) : []
  const attached = docs.length ? '\n\nATTACHED DOCUMENTS (read from the files the person attached just now; nothing is saved):\n' + JSON.stringify(docs).slice(0, 6000) +
    '\nSay what each document is and its key figures, call match_document for supplier documents, then point out differences (prices, quantities, totals, already billed, supplier on hold). Use calculate for any sums. If they ask, you can propose receiving it (delivery note) or a draft bill (invoice) or a petty cash spend (till slip) — they confirm on the card.' : ''
  const messages: Record<string, unknown>[] = [{ role: 'system', content: system + screen + attached }]
  for (const h of (body.history || []).slice(-6)) {
    if ((h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string') messages.push({ role: h.role, content: h.content.slice(0, 2000) })
  }
  messages.push({ role: 'user', content: question })

  const used: { name: string; args: unknown }[] = []
  const actions: { id: string; kind: string; summary: string; details: unknown }[] = []
  let tokens = 0
  let answer = ''
  let error: string | null = null
  let usedModel = model
  try {
    for (let round = 0; round < 5; round++) {
      const res = await groqChat(await chatModels(usedModel), { messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 900 })
      if (!res.ok) throw new Error(res.error || 'AI service error')
      usedModel = res.model
      const d = res.data
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
        if (c.function.name === 'calculate') {
          try { result = { expression: args.expression, result: calc(String(args.expression || '')), label: args.label } }
          catch (e) { result = { error: (e as Error).message, expression: args.expression } }
        } else if (c.function.name === 'spend_summary') {
          result = (await db.rpc('ai_spend_summary', { p_site_ids: siteIds(args.site), p_from: args.date_from, p_to: args.date_to, p_group: args.group_by || 'account' })).data
        } else if (c.function.name === 'spend_on') {
          result = (await db.rpc('ai_spend_on', { p_site_ids: siteIds(args.site), p_from: args.date_from, p_to: args.date_to, p_search: args.search })).data
        } else if (c.function.name === 'supplier_history') {
          result = (await db.rpc('ai_supplier_history', { p_site_ids: siteIds(args.site), p_supplier: args.supplier, p_from: args.date_from, p_to: args.date_to })).data
        } else if (PROPOSE[c.function.name]) {
          const a = args as Record<string, any>
          const [kind, fn, params, summarise] = PROPOSE[c.function.name]
          const r = await db.rpc(fn, params(a, siteIds(a.site)))
          const prep = r.error ? { error: r.error.message } : r.data
          if (!prep || prep.error) result = { error: prep?.error || 'Could not prepare that' }
          else {
            const summary = summarise(prep)
            const { data: id, error: pe } = await db.rpc('ai_action_propose', { p_kind: kind, p_site: prep.site_id || body.site_id || null, p_summary: summary, p_payload: prep })
            if (pe) result = { error: pe.message }
            else { actions.push({ id, kind, summary, details: prep }); result = { proposed: true, summary, note: 'A card with a Confirm button is shown to the person. Nothing has been saved yet — tell them to check it and press Confirm.' } }
          }
        } else if (c.function.name === 'notifications') {
          const r = await db.rpc('ai_notifications', { p_unread_only: String(args.unread_only) !== 'false', p_search: args.search || null })
          result = r.error ? { error: r.error.message } : r.data
        } else if (c.function.name === 'match_document') {
          const r = await db.rpc('ai_match_document', { p_site_ids: siteIds(args.site), p_supplier: args.supplier, p_doc_number: args.doc_number || null,
            p_po_ref: args.po_ref || null, p_total: args.total ? Number(args.total) : null })
          result = r.error ? { error: r.error.message } : r.data
        } else if (MODULE_RPC[c.function.name]) {
          const [fn, dated, search] = MODULE_RPC[c.function.name]
          const p: Record<string, unknown> = { p_site_ids: siteIds(args.site) }
          if (dated) { p.p_from = args.date_from; p.p_to = args.date_to }
          if (search) p[EXTRA_ARG[c.function.name] || 'p_search'] = args.search || null
          const r = await db.rpc(fn, p)
          result = r.error ? { error: r.error.message } : r.data
        } else result = { error: 'Unknown tool' }
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result ?? { error: 'No result — check the dates' }).slice(0, 8000) })
      }
    }
    if (!answer) answer = "I couldn't finish working that out — try asking more simply."
  } catch (e) {
    error = (e as Error).message
    answer = /rate limit|429/i.test(error) ? 'The AI service is busy (free-plan limit reached) — please try again in about a minute.' : 'Sorry — the AI service did not answer. Please try again in a minute.'
  }

  const toolText = messages.filter(m => m.role === 'tool').map(m => String(m.content)).join('\n')
  const links = error ? [] : await findLinks(db, answer + '\n' + toolText, body.site_id).catch(() => [])
  const { data: logged } = await db.from('ai_questions').insert({ user_id: user.id, site_id: body.site_id || null, question, answer, model: usedModel,
    tools: [...used, ...docs.map(d => ({ name: 'file', args: { name: d.file, doc_type: (d as Record<string, unknown>).doc_type ?? null, error: (d as Record<string, unknown>).error ?? null } })), ...(pg ? [{ name: 'screen', args: { page: pg.page, structured: !!pg.context } }] : [])], tokens, error })
    .select('id').single()
  return json({ answer, links, tools: used, docs, actions, model: usedModel, id: logged?.id, error })
})
