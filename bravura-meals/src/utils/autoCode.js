// Generates the next sequential code for a form's "code" field, e.g.
// nextCode(existingCodes, { prefix: 'T', pad: 2 }) -> 'T03' if T01, T02 exist.
// Skips any number already taken so it never collides, even with gaps or
// codes that don't match the prefix pattern. Always editable afterward —
// this only fills a sensible default.
export function nextCode(existingCodes, { prefix = '', pad = 2 } = {}) {
  const taken = new Set((existingCodes || []).map(c => (c || '').toUpperCase()))
  const re = new RegExp(`^${prefix}(\\d+)$`, 'i')
  let max = 0
  for (const code of taken) {
    const m = code.match(re)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  let n = max + 1
  let candidate = `${prefix}${String(n).padStart(pad, '0')}`
  while (taken.has(candidate.toUpperCase())) {
    n += 1
    candidate = `${prefix}${String(n).padStart(pad, '0')}`
  }
  return candidate
}
