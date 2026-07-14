// Pick the tank pages should show by default: the site's main tank.
// Prefers a tank whose name contains "main"; falls back to the largest
// capacity, then the first tank.
export function primaryTank(tanks) {
  const list = (tanks || []).filter(Boolean)
  if (list.length === 0) return null
  return (
    list.find(t => /main/i.test(t.name || '')) ||
    [...list].sort((a, b) => (Number(b.capacity_litres) || 0) - (Number(a.capacity_litres) || 0))[0]
  )
}

// Sort a tank list with the primary tank first (for dropdowns).
export function tanksPrimaryFirst(tanks) {
  const p = primaryTank(tanks)
  if (!p) return tanks || []
  return [p, ...(tanks || []).filter(t => t.id !== p.id)]
}
