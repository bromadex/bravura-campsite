const BOM = '﻿'

function escapeCell(val) {
  if (val == null) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export function exportCsv(filename, headers, rows) {
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map(r => r.map(escapeCell).join(',')),
  ]
  const blob = new Blob([BOM + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
