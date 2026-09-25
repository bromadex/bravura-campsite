// Finance module look (agreed design, issue #49): maroon for navigation and primary buttons,
// finance blue for links and charts, ochre for budget lines and warnings, IBM Plex type,
// tabular figures everywhere. Hex values, as with THEME.
export const FIN = {
  maroon: '#982329', maroonDark: '#7A1B20', maroonTint: '#FBEFF0',
  blue: '#1F4E8C', blueTint: '#EEF3FA',
  ochre: '#C8811E', ochreText: '#9A5B00', ochreTint: '#FFF6E8', ochreLine: '#EBCB97',
  good: '#2F7D4F', goodTint: '#F1F8F3', bad: '#B3261E',
  ground: '#F2F4F2', card: '#FFFFFF', line: '#E3E7E4', lineSoft: '#EEF1EF', field: '#D5DBD7',
  ink: '#16211D', muted: '#5B6661', faint: '#6F7D77',
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  serif: "'IBM Plex Serif', Georgia, serif",
}

export const finCard = { background: FIN.card, border: `1px solid ${FIN.line}`, borderRadius: 14, padding: '18px 20px' }
export const finBtn = {
  minHeight: 44, padding: '0 16px', background: FIN.maroon, border: 'none', borderRadius: 10,
  fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: '#fff', cursor: 'pointer',
}
export const finBtn2 = {
  minHeight: 44, padding: '0 16px', background: '#fff', border: `1px solid ${FIN.field}`, borderRadius: 10,
  fontFamily: 'inherit', fontSize: 14, color: FIN.ink, cursor: 'pointer',
}
export const finInput = {
  minHeight: 40, padding: '8px 10px', borderRadius: 8, border: `1px solid ${FIN.field}`, background: '#fff',
  fontFamily: 'inherit', fontSize: 14, color: FIN.ink, boxSizing: 'border-box',
}
export const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Loads IBM Plex once for finance screens.
export function useFinanceFonts() {
  if (typeof document === 'undefined' || document.getElementById('fin-plex')) return
  const l = document.createElement('link')
  l.id = 'fin-plex'; l.rel = 'stylesheet'
  l.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Serif:wght@500;600&display=swap'
  document.head.appendChild(l)
}
