// scheduled-reports — called hourly by pg_cron (migration 0192) with a private x-cron-token.
// Emails every report subscription that is due (Africa/Harare time) through Resend, then records it
// as sent and leaves an in-app notification. Reports are built in the database by report_build().
// Deployed with verify_jwt = false; the token check below is the authentication.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const APP_URL        = Deno.env.get('APP_URL') || 'https://bravura-campsite.vercel.app'
const FROM           = Deno.env.get('REPORTS_FROM') || 'Bravura ERP <reports@bravura-campsite.com>'
const GROQ_KEY       = Deno.env.get('GROQ_API_KEY')

const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

type Item = { label: string; value: string; tone?: string | null }
type Section = { heading: string; items?: Item[]; columns?: string[]; rows?: (string | number)[][] }
type Report = { title: string; site: string; period: string; sections: Section[] }

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const TONE: Record<string, string> = { bad: '#C62828', warn: '#B26A00' }

// Ask Bravura B6 (issue #58): a short written commentary on top of each report. Only figures that are in
// the report may be quoted; if the AI is unavailable the email simply goes without it.
async function commentary(r: Report): Promise<string | null> {
  if (!GROQ_KEY) return null
  const prompt = `You write the 2-4 sentence summary at the top of a mining-camp management report email. Plain words, no jargon, no greeting.
Say what matters most and anything that needs action. Quote ONLY numbers that appear in the report below, exactly as written. If nothing stands out, say so briefly.
REPORT: ${JSON.stringify(r).slice(0, 6000)}`
  for (const model of ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3-32b', 'llama-3.3-70b-versatile']) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST',
        headers: { Authorization: `Bearer ${GROQ_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 300 }) })
      if (!res.ok) continue
      const d = await res.json()
      const text = String(d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\*\*/g, '').trim()
      if (text) return text
    } catch { /* try next */ }
  }
  return null
}

function render(r: Report, name: string, link: string, note: string | null = null): string {
  const sections = r.sections.map(s => {
    const items = (s.items || []).map(i => `
      <tr><td style="padding:6px 0;color:#444">${esc(i.label)}</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;color:${TONE[i.tone || ''] || '#111'}">${esc(i.value)}</td></tr>`).join('')
    const table = s.columns ? (s.rows?.length ? `
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:4px">
        <tr>${s.columns.map((c, i) => `<th style="text-align:${i ? 'right' : 'left'};padding:6px 4px;border-bottom:1px solid #ddd;color:#666;font-weight:600">${esc(c)}</th>`).join('')}</tr>
        ${s.rows.map(row => `<tr>${row.map((v, i) => `<td style="text-align:${i ? 'right' : 'left'};padding:6px 4px;border-bottom:1px solid #eee">${esc(v)}</td>`).join('')}</tr>`).join('')}
      </table>` : '<div style="color:#888;font-size:13px;padding:4px 0">Nothing to report.</div>') : ''
    return `<h3 style="font-size:14px;margin:20px 0 6px;color:#982329">${esc(s.heading)}</h3>
            ${items ? `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${items}</table>` : ''}${table}`
  }).join('')
  return `<!doctype html><html><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:8px">
        <tr><td style="background:#982329;color:#fff;padding:18px 24px;border-radius:8px 8px 0 0">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">${esc(r.site)} · ${esc(r.period)}</div>
          <div style="font-size:20px;font-weight:700;margin-top:4px">${esc(r.title)}</div></td></tr>
        <tr><td style="padding:8px 24px 24px">
          <p style="font-size:14px;color:#444">Hello ${esc(name.split(' ')[0] || 'there')},</p>
          ${note ? `<div style="background:#FBF3F3;border-left:3px solid #982329;padding:10px 14px;margin:8px 0 4px;font-size:14px;color:#333;line-height:1.5">
            <div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#982329;margin-bottom:4px">In short · Ask Bravura</div>${esc(note)}</div>` : ''}
          ${sections}
          <p style="margin-top:24px"><a href="${esc(link)}" style="background:#982329;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:14px">Open Bravura ERP</a></p>
          <p style="font-size:12px;color:#888;margin-top:20px">You get this because you subscribed in My Preferences → Email reports. Change or stop it there.</p>
        </td></tr>
      </table></td></tr></table></body></html>`
}

const LINKS: Record<string, string> = {
  ops_daily: '/', fleet_weekly: '/fleet/fleet_preventive', procurement_weekly: '/procurement/proc_supplier_performance',
  hr_weekly: '/workforce/wf_dashboard', finance_monthly: '/finance/fi_dimension_report',
}

Deno.serve(async req => {
  // Authenticate the cron call against the token stored in the database.
  const { data: tok } = await db.from('report_cron_token').select('token').eq('id', 1).maybeSingle()
  if (!tok?.token || req.headers.get('x-cron-token') !== tok.token) return new Response('Forbidden', { status: 403 })

  const { data: due, error } = await db.rpc('report_due_subscriptions')
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })

  const results: unknown[] = []
  const notes = new Map<string, string | null>()   // one commentary per report + site per run
  for (const s of due || []) {
    try {
      const { data: report, error: rErr } = await db.rpc('report_build', { p_code: s.report_code, p_site_id: s.site_id })
      if (rErr) throw rErr
      const r = report as Report
      const link = APP_URL + (LINKS[s.report_code] || '/')
      const subject = `${r.title} — ${r.site} — ${r.period}`
      if (!RESEND_API_KEY) {
        results.push({ id: s.id, skipped: 'RESEND_API_KEY not set' })
        continue   // don't mark as sent, so it goes once email is configured
      }
      const nk = s.report_code + ':' + s.site_id
      if (!notes.has(nk)) notes.set(nk, await commentary(r))
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM, to: s.email, subject, html: render(r, s.full_name || '', link, notes.get(s.report_code + ':' + s.site_id) ?? null) }),
      })
      if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`)
      await db.rpc('report_mark_sent', { p_id: s.id, p_title: subject, p_link: LINKS[s.report_code] || '/' })
      results.push({ id: s.id, sent: true })
    } catch (e) {
      console.error('report failed', s.id, e)
      results.push({ id: s.id, error: String((e as Error).message || e) })
    }
  }
  return new Response(JSON.stringify({ due: (due || []).length, results }), { headers: { 'Content-Type': 'application/json' } })
})
