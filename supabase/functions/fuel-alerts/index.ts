import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const APP_URL        = Deno.env.get('APP_URL') || 'https://app.bravura-campsite.com'
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Invoke the procurement hook Edge Function so a low-tank alert can spawn
// a purchase requisition when the site has auto_create_requisition enabled.
async function invokeProcurementHook(tank: {
  id: string
  site_id: string
  tank_name: string
  current_level_litres: number
  capacity_litres: number
}) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/fuel-procurement-hook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        site_id: tank.site_id,
        tank_id: tank.id,
        tank_name: tank.tank_name,
        current_level_litres: tank.current_level_litres,
        capacity_litres: tank.capacity_litres,
      }),
    })
    if (!res.ok) console.error('procurement-hook non-2xx', res.status, await res.text())
  } catch (e) {
    console.error('procurement-hook invoke failed', (e as Error).message)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  if (!RESEND_API_KEY) { console.warn('RESEND_API_KEY not set — skipping email'); return }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'alerts@bravura-campsite.com', to, subject, html }),
  })
  if (!res.ok) console.error('Resend error', res.status, await res.text())
}

// Deduplicate: skip if same type+title+site was already sent in the last 6 hours
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

// Fetch all profiles at a site with a given permission code
async function recipientsWithPermission(site_id: string, permCode: string): Promise<{ id: string; email: string }[]> {
  // Get all role_ids that have this permission
  const { data: perms } = await supabase
    .from('role_permissions')
    .select('role_id')
    .eq('permission_code', permCode)
  if (!perms?.length) return []
  const roleIds = perms.map(p => p.role_id)

  // Get all user_roles at this site with one of those roles
  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('user_id, profiles!inner(id, email)')
    .eq('site_id', site_id)
    .in('role_id', roleIds)
  return (userRoles || []).map((r: any) => ({ id: r.profiles.id, email: r.profiles.email }))
}

// ── Check 1: Tanks below threshold ───────────────────────────────────────────

async function checkLowTanks() {
  const { data: tanks } = await supabase
    .from('fuel_tanks')
    .select('id, tank_name, site_id, current_level_litres, capacity_litres, min_threshold_percent')
    .eq('status', 'active')
    .eq('is_archived', false)
    .not('capacity_litres', 'is', null)
    .not('min_threshold_percent', 'is', null)

  for (const tank of (tanks || [])) {
    const pct = (Number(tank.current_level_litres) / Number(tank.capacity_litres)) * 100
    if (pct > Number(tank.min_threshold_percent)) continue

    const title = `Low fuel: ${tank.tank_name}`
    if (await alreadySent(tank.site_id, 'fuel_alert', title)) continue

    const body = `${tank.tank_name} is at ${pct.toFixed(0)}% (${Number(tank.current_level_litres).toFixed(0)} L) — below the ${tank.min_threshold_percent}% minimum threshold.`
    const recipients = await recipientsWithPermission(tank.site_id, 'fuel.edit')

    for (const r of recipients) {
      await insertNotification({
        site_id: tank.site_id, recipient_id: r.id,
        type: 'fuel_alert', title, body,
        action_url: `${APP_URL}/fuel/fuel_tanks`,
      })
      if (r.email) {
        await sendEmail(r.email, `[URGENT] ${title}`, `<p>${body}</p><p><a href="${APP_URL}/fuel/fuel_tanks">View Tanks</a></p>`)
      }
    }

    // Fire the procurement hook — it internally checks the site's
    // auto_create_requisition toggle and dedup window before creating a row.
    await invokeProcurementHook({
      id: tank.id,
      site_id: tank.site_id,
      tank_name: tank.tank_name,
      current_level_litres: Number(tank.current_level_litres),
      capacity_litres: Number(tank.capacity_litres),
    })
  }
}

// ── Check 2: Tanks with no dip reading in 24 hours ────────────────────────────

async function checkMissingDips() {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)

  const { data: tanks } = await supabase
    .from('fuel_tanks')
    .select('id, tank_name, site_id')
    .eq('status', 'active')
    .eq('is_archived', false)

  for (const tank of (tanks || [])) {
    const { count } = await supabase
      .from('fuel_dip_readings')
      .select('id', { count: 'exact', head: true })
      .eq('tank_id', tank.id)
      .gte('reading_date', yesterday)

    if ((count ?? 0) > 0) continue

    const title = `No dip reading: ${tank.tank_name}`
    if (await alreadySent(tank.site_id, 'fuel_warning', title)) continue

    const body = `${tank.tank_name} has not had a dip reading recorded in the last 24 hours.`
    const recipients = await recipientsWithPermission(tank.site_id, 'fuel.create')

    for (const r of recipients) {
      await insertNotification({
        site_id: tank.site_id, recipient_id: r.id,
        type: 'fuel_warning', title, body,
        action_url: `${APP_URL}/fuel/fuel_dips`,
      })
    }
  }
}

// ── Check 3: Reconciliation overdue (>7 days since last period_end) ──────────

async function checkReconciliationOverdue() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10)

  // Get all active sites
  const { data: sites } = await supabase.from('sites').select('id')

  for (const site of (sites || [])) {
    const { data: latest } = await supabase
      .from('fuel_reconciliations')
      .select('period_end')
      .eq('site_id', site.id)
      .order('period_end', { ascending: false })
      .limit(1)
      .single()

    const lastEnd = latest?.period_end
    if (lastEnd && lastEnd >= sevenDaysAgo) continue

    const title = 'Reconciliation overdue'
    if (await alreadySent(site.id, 'fuel_warning', title)) continue

    const body = lastEnd
      ? `Last reconciliation period ended ${lastEnd} — more than 7 days ago. A new reconciliation should be completed.`
      : 'No fuel reconciliation has been completed for this site.'

    const recipients = await recipientsWithPermission(site.id, 'fuel.approve')
    for (const r of recipients) {
      await insertNotification({
        site_id: site.id, recipient_id: r.id,
        type: 'fuel_warning', title, body,
        action_url: `${APP_URL}/fuel/fuel_reconciliation`,
      })
    }
  }
}

// ── Check 4: Vehicles consuming >150% of expected (last 7 days) ──────────────

async function checkExcessiveConsumption() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10)

  const { data: txns } = await supabase
    .from('fuel_transactions')
    .select('site_id, vehicle_id, litres, meter_start, meter_end, vehicle:fuel_vehicles(fleet_number, registration, expected_consumption_lpkm)')
    .eq('transaction_type', 'issuance')
    .not('vehicle_id', 'is', null)
    .gte('transaction_date', sevenDaysAgo)

  // Group by site + vehicle
  const map: Record<string, { site_id: string; litres: number; km: number; expected: number | null; label: string }> = {}
  for (const t of (txns || [])) {
    const key = `${t.site_id}::${t.vehicle_id}`
    if (!map[key]) {
      const v = t.vehicle || {}
      map[key] = {
        site_id: t.site_id,
        litres: 0, km: 0,
        expected: v.expected_consumption_lpkm ? Number(v.expected_consumption_lpkm) : null,
        label: v.fleet_number ? `${v.fleet_number}${v.registration ? ` (${v.registration})` : ''}` : t.vehicle_id,
      }
    }
    map[key].litres += Number(t.litres)
    if (t.meter_start != null && t.meter_end != null) {
      const km = Number(t.meter_end) - Number(t.meter_start)
      if (km > 0) map[key].km += km
    }
  }

  for (const [, row] of Object.entries(map)) {
    if (!row.expected || row.km <= 0) continue
    const actual = row.litres / row.km
    const ratio = actual / row.expected
    if (ratio <= 1.5) continue

    const title = `Excessive consumption: ${row.label}`
    if (await alreadySent(row.site_id, 'fuel_alert', title)) continue

    const body = `${row.label} consumed ${row.litres.toFixed(0)} L over ${row.km.toFixed(0)} km in the last 7 days — ${(ratio * 100).toFixed(0)}% of the expected rate (${row.expected.toFixed(3)} L/km).`
    const recipients = await recipientsWithPermission(row.site_id, 'fuel.edit')

    for (const r of recipients) {
      await insertNotification({
        site_id: row.site_id, recipient_id: r.id,
        type: 'fuel_alert', title, body,
        action_url: `${APP_URL}/fuel/fuel_vehicle_consumption`,
      })
    }
  }
}

// ── Check 5: Operator licence expiring within 14 days ────────────────────────

async function checkLicenceExpiry() {
  const now = new Date()
  const in14 = new Date(now.getTime() + 14 * 86400 * 1000).toISOString().slice(0, 10)
  const todayStr = now.toISOString().slice(0, 10)

  const { data: operators } = await supabase
    .from('fuel_operators')
    .select('id, full_name, site_id, licence_expiry_date')
    .eq('is_active', true)
    .not('licence_expiry_date', 'is', null)
    .lte('licence_expiry_date', in14)
    .gte('licence_expiry_date', todayStr)

  for (const op of (operators || [])) {
    const daysLeft = Math.ceil((new Date(op.licence_expiry_date).getTime() - now.getTime()) / 86400000)
    const title = `Licence expiring: ${op.full_name}`
    if (await alreadySent(op.site_id, 'fuel_warning', title)) continue

    const body = `${op.full_name}'s fuel operator licence expires on ${op.licence_expiry_date} (${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining). Renewal should be arranged immediately.`
    const recipients = await recipientsWithPermission(op.site_id, 'fuel.edit')

    for (const r of recipients) {
      await insertNotification({
        site_id: op.site_id, recipient_id: r.id,
        type: 'fuel_warning', title, body,
        action_url: `${APP_URL}/fuel/fuel_operators`,
      })
    }
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  try {
    await Promise.allSettled([
      checkLowTanks(),
      checkMissingDips(),
      checkReconciliationOverdue(),
      checkExcessiveConsumption(),
      checkLicenceExpiry(),
    ])
    return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('fuel-alerts fatal', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
