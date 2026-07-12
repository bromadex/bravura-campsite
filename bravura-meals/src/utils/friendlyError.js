export function friendlyError(err) {
  if (!err) return 'Unknown error'
  const msg = err.message || String(err)
  const parts = [msg]
  if (err.details && err.details !== msg) parts.push(err.details)
  if (err.hint) parts.push(err.hint)
  return parts.join(' — ')
}
