/**
 * Meals Alerts — Supabase Edge Function
 *
 * Scheduled hourly via pg_cron. Runs two checks and inserts notifications
 * (plus optional Resend email) for anyone at the affected site who holds
 * the relevant permission code. Deduplicates by title within a 6h window,
 * mirroring the fuel-alerts pattern.
 *
 * CHECKS
 *   1. Kitchen not confirmed — after 16:00 local, no confirmed_at on
 *      today's daily_submissions row for a site → notify meals.edit
 *      recipients ("kitchen" role in practice).
 *   2. Stale meal prices — latest meal_prices.effective_date > 60 days
 *      old → notify meals.approve / users.view recipients.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const APP_URL        = Deno.env.get('APP_URL') || 'https://app.bravura-campsite.com'

const STALE_PRICE_DAYS = 60
const CONFIRM_BY_HOUR  = 16   // 4 pm

// ── Helpers ─────────────────────────────────────────────────────────────────
async function insertNotification(n: {
  site_id: string
  recipient_id: string
  type: string
  title: string
  body?: string
  action_url?: string
}) {
  const { error } = await supabase.from('notifications').insert(n)
  if (error) console.error('notification insert failed', error.message, n.title)
}

async function sendEmail(to: string, subject: string, html: string) {
  if (!RESEND_API_KEY) return
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'alerts@bravura-campsite.com', to, subject, html }),
  })
  if (!res.ok) console.error('Resend error', res.status, await res.text())
}

async function alreadySent(site_id: string, type: string, title: string): Promise<boolean> {
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString()
  const { count } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site_id)
    .eq('type', type)
    .eq('title', title)
    .gte('created_at', since)
  return (count ?? 0) > 0
}

async function recipientsWithPermission(site_id: string, permCode: string): Promise<{ id: string; email: string }[]> {
  const { data: roleRows } = await supabase
    .from('role_permissions')
    .select('role_id')
    .eq('permission_code', permCode)
  const roleIds = [...new Set((roleRows || []).map(r => r.role_id))]
  if (!roleIds.length) return []

  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('user_id')
    .in('role_id', roleIds)
  const userIds = [...new Set((userRoles || []).map(r => r.user_id))]
  if (!userIds.length) return []

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, site_id')
    .in('id', userIds)
  return (profiles || [])
    .filter(p => !p.site_id || p.site_id === site_id)
    .map(p => ({ id: p.id, email: p.email || '' }))
}

// ── Check 1: Kitchen not confirmed by 4pm ────────────────────────────────────
async function checkUnconfirmedKitchen() {
  const now = new Date()
  if (now.getUTCHours() < CONFIRM_BY_HOUR) return    // only trigger after 4pm UTC
  const today = now.toISOString().slice(0, 10)

  const { data: sites } = await supabase.from('sites').select('id, name')
  for (const site of (sites || [])) {
    const { data: sub } = await supabase
      .from('daily_submissions')
      .select('id, confirmed_at, status')
      .eq('site_id', site.id)
      .eq('date', today)
      .maybeSingle()

    // Notify only if a submission exists and it hasn't been confirmed
    if (!sub || sub.confirmed_at) continue

    const title = `Kitchen not confirmed: ${site.name}`
    if (await alreadySent(site.id, 'meals_alert', title)) continue

    const body = `Today's meal submission for ${site.name} has not been confirmed by the kitchen yet. It's past ${CONFIRM_BY_HOUR}:00.`
    const recipients = await recipientsWithPermission(site.id, 'meals.edit')
    for (const r of recipients) {
      await insertNotification({
        site_id: site.id, recipient_id: r.id,
        type: 'meals_alert', title, body,
        action_url: `${APP_URL}/meals/meals_kitchen`,
      })
      if (r.email) {
        await sendEmail(r.email, `[Action] ${title}`, `<p>${body}</p><p><a href="${APP_URL}/meals/meals_kitchen">Open Kitchen Confirmation</a></p>`)
      }
    }
  }
}

// ── Check 2: Meal prices stale (>60 days) ───────────────────────────────────
async function checkStalePricing() {
  const { data: sites } = await supabase.from('sites').select('id, name')
  const cutoff = new Date(Date.now() - STALE_PRICE_DAYS * 86400_000).toISOString().slice(0, 10)

  for (const site of (sites || [])) {
    const { data: priceRow } = await supabase
      .from('meal_prices')
      .select('effective_date')
      .eq('site_id', site.id)
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!priceRow) continue    // no prices set yet — a different problem, not stale
    if (priceRow.effective_date > cutoff) continue    // fresh enough

    const title = `Meal prices are stale: ${site.name}`
    if (await alreadySent(site.id, 'meals_info', title)) continue

    const body = `Latest meal price at ${site.name} is from ${priceRow.effective_date}, more than ${STALE_PRICE_DAYS} days old. Review current unit costs so billing stays accurate.`
    const recipients = await recipientsWithPermission(site.id, 'meals.approve')
    for (const r of recipients) {
      await insertNotification({
        site_id: site.id, recipient_id: r.id,
        type: 'meals_info', title, body,
        action_url: `${APP_URL}/meals/meals_pricing`,
      })
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────
Deno.serve(async () => {
  const results = await Promise.allSettled([
    checkUnconfirmedKitchen(),
    checkStalePricing(),
  ])
  const failed = results.filter(r => r.status === 'rejected')
  if (failed.length) console.error('meals-alerts checks failed', failed)
  return new Response(JSON.stringify({ ok: true, checks: results.length, failed: failed.length }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
