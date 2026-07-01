/**
 * Flow Meter Ingest — Supabase Edge Function
 *
 * Receives cumulative readings from flow meter devices attached to fuel pumps.
 * Computes litres dispensed since the last reading; if significant flow is
 * detected (> MIN_FLOW_LITRES) it creates an immutable fuel_transaction entry.
 *
 * Expected POST body:
 * {
 *   "flow_meter_id": "FM-PUMP-01",          // or omit and supply pump_id
 *   "pump_id": "<uuid>",                    // alternative to flow_meter_id
 *   "timestamp": "2026-07-01T08:30:00Z",
 *   "cumulative_litres": 12345.6,           // total lifetime reading on the meter
 *   "operator_id": "<uuid>",               // optional — fuel_operators.id
 *   "vehicle_id": "<uuid>",                // optional
 *   "equipment_id": "<uuid>",              // optional
 *   "docket_number": "D-1234"              // optional
 * }
 *
 * Response: { ok: true, transaction_id?, litres_dispensed? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// Minimum flow to treat as a real issuance (filters out meter drift / sensor noise)
const MIN_FLOW_LITRES = 1.0

// ── Helpers ──────────────────────────────────────────────────────────────────

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

function ok(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, ...body }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return err(405, 'Method not allowed')

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return err(400, 'Invalid JSON body')
  }

  const { flow_meter_id, pump_id, timestamp, cumulative_litres, operator_id, vehicle_id, equipment_id, docket_number } = body as {
    flow_meter_id?: string
    pump_id?: string
    timestamp: string
    cumulative_litres: number
    operator_id?: string
    vehicle_id?: string
    equipment_id?: string
    docket_number?: string
  }

  if (!timestamp || cumulative_litres == null) {
    return err(400, 'timestamp and cumulative_litres are required')
  }
  if (!flow_meter_id && !pump_id) {
    return err(400, 'Either flow_meter_id or pump_id is required')
  }

  // ── 1. Resolve pump record ─────────────────────────────────────────────────

  let pumpQuery = supabase
    .from('fuel_pumps')
    .select('id, site_id, tank_id, last_flow_meter_reading, last_flow_meter_read_at, flow_meter_id')

  if (pump_id) {
    pumpQuery = pumpQuery.eq('id', pump_id)
  } else {
    pumpQuery = pumpQuery.eq('flow_meter_id', flow_meter_id)
  }

  const { data: pumps, error: pumpErr } = await pumpQuery.limit(1)
  if (pumpErr) return err(500, `Pump lookup failed: ${pumpErr.message}`)
  if (!pumps?.length) return err(404, `No pump found for ${flow_meter_id ? `flow_meter_id=${flow_meter_id}` : `pump_id=${pump_id}`}`)

  const pump = pumps[0]

  // ── 2. Compute litres dispensed ────────────────────────────────────────────

  const prev = pump.last_flow_meter_reading != null ? Number(pump.last_flow_meter_reading) : null
  const current = Number(cumulative_litres)

  // Handle meter rollover (cumulative counter reset to 0)
  let litresDispensed: number | null = null
  if (prev !== null) {
    litresDispensed = current >= prev
      ? current - prev
      : current   // meter rolled over — treat entire new reading as dispensed
  }

  // ── 3. Update pump's last reading ─────────────────────────────────────────

  const { error: updateErr } = await supabase
    .from('fuel_pumps')
    .update({
      last_flow_meter_reading: current,
      last_flow_meter_read_at: timestamp,
    })
    .eq('id', pump.id)

  if (updateErr) console.error('Failed to update pump reading', updateErr.message)

  // ── 4. Create transaction if significant flow detected ────────────────────

  let transactionId: string | undefined

  if (litresDispensed !== null && litresDispensed >= MIN_FLOW_LITRES) {
    // Generate transaction number: FM-<site-prefix>-<timestamp-ms>
    const txNum = `FM-${pump.site_id.slice(0, 6).toUpperCase()}-${Date.now()}`

    const txPayload: Record<string, unknown> = {
      site_id:          pump.site_id,
      tank_id:          pump.tank_id,
      pump_id:          pump.id,
      transaction_number: txNum,
      transaction_date: new Date(timestamp).toISOString().slice(0, 10),
      transaction_type: 'issuance',
      litres:           Number(litresDispensed.toFixed(3)),
      notes:            `Auto-generated from flow meter ${pump.flow_meter_id || pump.id}`,
    }

    if (operator_id)   txPayload.operator_id   = operator_id
    if (vehicle_id)    txPayload.vehicle_id     = vehicle_id
    if (equipment_id)  txPayload.equipment_id   = equipment_id
    if (docket_number) txPayload.docket_number  = docket_number

    const { data: txData, error: txErr } = await supabase
      .from('fuel_transactions')
      .insert(txPayload)
      .select('id')
      .single()

    if (txErr) {
      console.error('Transaction insert failed', txErr.message)
    } else {
      transactionId = txData.id
    }
  }

  return ok({
    pump_id: pump.id,
    site_id: pump.site_id,
    previous_reading: prev,
    current_reading: current,
    litres_dispensed: litresDispensed,
    transaction_created: !!transactionId,
    transaction_id: transactionId ?? null,
    below_threshold: litresDispensed !== null && litresDispensed < MIN_FLOW_LITRES
      ? `${litresDispensed.toFixed(3)} L is below ${MIN_FLOW_LITRES} L minimum — no transaction created`
      : undefined,
  })
})
