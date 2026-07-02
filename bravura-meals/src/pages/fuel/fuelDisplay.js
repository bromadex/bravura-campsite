// ── Shared display helpers for the Fuel module ───────────────────────────────
// The legacy import (migrations 0045/0046) stored the old ERP's driver /
// authoriser / purpose inside free-text notes:
//   "Imported legacy <id> — driver: X, authorised: Y, purpose: Z"
//   "Legacy delivery <id>"
// Rendering that raw string reads like a debug dump. This parser splits it
// back into fields so tables can show "Driver", "Purpose", etc. as proper
// columns and keep the legacy id out of sight.

const CLEAN = v => {
  const s = (v || '').trim()
  if (!s || s === '—' || s === '-' || /^none$/i.test(s)) return null
  return s
}

export function parseTxnNotes(notes) {
  const out = { legacy: false, driver: null, authorised: null, purpose: null, clean: null }
  if (!notes) return out

  let m = notes.match(/^Imported legacy \S+ — driver: (.*?), authorised: (.*?), purpose: (.*)$/s)
  if (m) {
    out.legacy    = true
    out.driver    = CLEAN(m[1])
    out.authorised = CLEAN(m[2])
    out.purpose   = CLEAN(m[3])
    return out
  }

  m = notes.match(/^Legacy delivery \S+$/)
  if (m) { out.legacy = true; return out }

  m = notes.match(/^Imported legacy /)
  if (m) { out.legacy = true; return out }

  out.clean = notes
  return out
}

// Aggregate fuel usage per asset from the already-loaded transactions list.
// Returns Map(assetId → { litres30, count30, lastDate, litresAll }).
// keyField: 'vehicle_id' | 'equipment_id'
export function fuelUsageByAsset(transactions, keyField) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const map = new Map()
  for (const t of transactions) {
    if (t.transaction_type !== 'issuance') continue
    const key = t[keyField]
    if (!key) continue
    let e = map.get(key)
    if (!e) { e = { litres30: 0, count30: 0, lastDate: null, litresAll: 0 }; map.set(key, e) }
    const litres = Number(t.litres) || 0
    e.litresAll += litres
    if (t.transaction_date >= cutoffStr) { e.litres30 += litres; e.count30 += 1 }
    if (!e.lastDate || t.transaction_date > e.lastDate) e.lastDate = t.transaction_date
  }
  return map
}
