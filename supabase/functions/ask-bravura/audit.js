// Ask Bravura guardrail (B8, issue #58): every figure in an answer must come from a tool result, the
// calculate tool, the screen, an attached document or the question itself. This finds the ones that don't,
// so the chat can say "check these figures" and the log can record them. Plain JS so both the edge function
// (Deno) and the app's tests (vitest) can use it.

// Record numbers (PO-2026-0012, JV-0001, BRA163, FL-2026-00032) and dates are not figures.
const NOT_FIGURES = [
  /\b[A-Z]{1,6}(?:-[A-Z]{1,6})*-\d[\d-]*\b/g,          // KAM-PO-2026-0012, JV-0001, FL-2026-00032
  /\b[A-Z]{2,}\d+\b/g,                                  // BRA163
  /\b\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\b/g,           // 2026-09-25
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,                 // 24/9/2026
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,                      // 14:52
]
const NUM = /\$?\d[\d,]*(?:\.\d+)?%?/g

function strip(text) {
  let t = String(text || '')
  for (const re of NOT_FIGURES) t = t.replace(re, ' ')
  return t
}
function toNumber(s) { return Number(String(s).replace(/[$,%]/g, '')) }

export function figuresIn(text) {
  return (strip(text).match(NUM) || []).map(s => s.replace(/[.,]+$/, '')).filter(s => /\d/.test(s))
}

// A figure is fine if it's small (counts, ordinals: ≤ 31), a year, or matches a source number exactly
// or after rounding (to 0, 1 or 2 decimals, or to thousands for "$12k"-style answers).
export function unverifiedFigures(answer, sources) {
  const known = new Set()
  for (const s of figuresIn(sources)) {
    const n = toNumber(s)
    if (!isFinite(n)) continue
    for (const v of [n, Math.round(n), Math.round(n * 10) / 10, Math.round(n * 100) / 100, Math.round(n / 1000), Math.round(n / 100) / 10]) known.add(String(v))
  }
  const out = []
  for (const s of figuresIn(answer)) {
    const n = toNumber(s)
    if (!isFinite(n)) continue
    if (n <= 31 && Number.isInteger(n)) continue
    if (Number.isInteger(n) && n >= 1900 && n <= 2100 && !s.includes('$')) continue
    if (known.has(String(n)) || known.has(String(Math.round(n * 100) / 100))) continue
    if (!out.includes(s)) out.push(s)
  }
  return out
}
