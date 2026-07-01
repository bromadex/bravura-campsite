/**
 * Fuel Procurement Hook — Supabase Edge Function
 *
 * Creates a pending purchase requisition in procurement_requisitions when a
 * fuel tank crosses below its alert threshold and the "Auto-create Purchase
 * Requisition" toggle is ON in the site's fuel_settings.
 *
 * Normally invoked by the fuel-alerts Edge Function after it detects a
 * low-tank condition, but can also be called manually from a scheduled job
 * or an admin action.
 *
 * Expected POST body:
 * {
 *   "site_id": "<uuid>",
 *   "tank_id": "<uuid>",
 *   "tank_name": "Diesel Tank 1",
 *   "current_level_litres": 850,
 *   "capacity_litres": 5000
 * }
 *
 * Response: { ok: true, requisition_id, requisition_number, skipped? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// De-duplication window — don't create another requisition for the same
// tank if one is still pending or was created in the last N hours.
const DEDUP_WINDOW_HOURS = 24

function ok(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}
function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

async function isEnabled(site_id: string): Promise<boolean> {
  const { data } = await supabase
    .from('fuel_settings')
    .select('auto_create_requisition')
    .eq('site_id', site_id)
    .maybeSingle()
  return !!data?.auto_create_requisition
}

async function alreadyOpen(site_id: string, tank_id: string): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3600 * 1000).toISOString()
  const { count } = await supabase
    .from('procurement_requisitions')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site_id)
    .eq('source_module', 'fuel')
    .eq('source_reference_id', tank_id)
    .in('status', ['pending', 'approved', 'ordered'])
    .gte('created_at', since)
  return (count || 0) > 0
}

async function nextRequisitionNumber(site_id: string): Promise<string> {
  const yyyymm = new Date().toISOString().slice(0, 7).replace('-', '')
  const { count } = await supabase
    .from('procurement_requisitions')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site_id)
    .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
  const seq = ((count || 0) + 1).toString().padStart(4, '0')
  return `REQ-${yyyymm}-${seq}`
}

async function getUnitCost(site_id: string): Promise<number | null> {
  const { data } = await supabase
    .from('fuel_transactions')
    .select('unit_price')
    .eq('site_id', site_id)
    .eq('transaction_type', 'delivery')
    .not('unit_price', 'is', null)
    .order('transaction_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.unit_price != null ? Number(data.unit_price) : null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return err(405, 'Method not allowed')

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return err(400, 'Invalid JSON body') }

  const site_id              = body.site_id as string
  const tank_id              = body.tank_id as string
  const tank_name            = (body.tank_name as string) || 'Fuel Tank'
  const current_level_litres = Number(body.current_level_litres || 0)
  const capacity_litres      = Number(body.capacity_litres || 0)

  if (!site_id || !tank_id) return err(400, 'site_id and tank_id are required')

  if (!(await isEnabled(site_id))) {
    return ok({ skipped: 'auto_create_requisition is disabled for this site' })
  }
  if (await alreadyOpen(site_id, tank_id)) {
    return ok({ skipped: `an open requisition already exists for tank ${tank_id} within ${DEDUP_WINDOW_HOURS}h` })
  }

  // Refill quantity = space to top up to full capacity, rounded down to
  // nearest 100 L, capped by capacity itself.
  const shortfall = Math.max(0, capacity_litres - current_level_litres)
  const quantity  = capacity_litres > 0
    ? Math.max(500, Math.floor(shortfall / 100) * 100)
    : 1000

  const unitCost  = await getUnitCost(site_id)
  const totalCost = unitCost != null ? Number((quantity * unitCost).toFixed(2)) : null

  const requisition_number = await nextRequisitionNumber(site_id)

  const payload = {
    site_id,
    requisition_number,
    source_module:        'fuel',
    source_reference_id:  tank_id,
    item_description:     `Diesel refill — ${tank_name}`,
    quantity,
    unit:                 'litres',
    estimated_unit_cost:  unitCost,
    total_estimated_cost: totalCost,
    justification:        `Auto-created: ${tank_name} at ${current_level_litres.toFixed(0)} L of ${capacity_litres.toFixed(0)} L capacity — below alert threshold.`,
    status:               'pending',
    created_by:           null,
  }

  const { data, error } = await supabase
    .from('procurement_requisitions')
    .insert(payload)
    .select('id, requisition_number')
    .single()

  if (error) return err(500, `Insert failed: ${error.message}`)

  return ok({
    requisition_id:     data.id,
    requisition_number: data.requisition_number,
    quantity,
    estimated_total:    totalCost,
  })
})
