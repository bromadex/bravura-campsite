// ── Shared UI primitives ────────────────────────────────────────────────────

export function StatCard({ label, value, sub, color = '#1F3864' }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #dde2ea', borderRadius: '8px',
      padding: '14px 16px', textAlign: 'center',
    }}>
      <div style={{ fontSize: '11px', color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: '#fff', border: '1px solid #dde2ea', borderRadius: '12px',
      padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,.08)', ...style,
    }}>
      {children}
    </div>
  )
}

export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, style = {} }) {
  const variants = {
    primary: { background: '#2F5496', color: '#fff' },
    success: { background: '#375623', color: '#fff' },
    danger:  { background: '#C00000', color: '#fff' },
    orange:  { background: '#C55A11', color: '#fff' },
    ghost:   { background: 'transparent', color: '#4a5568', border: '1px solid #dde2ea' },
    teal:    { background: '#00897B', color: '#fff' },
  }
  const sizes = {
    sm: { padding: '5px 11px', fontSize: '12px' },
    md: { padding: '8px 16px', fontSize: '13px' },
    lg: { padding: '11px 20px', fontSize: '14px' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        borderRadius: '8px', fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none', fontFamily: 'inherit', whiteSpace: 'nowrap',
        opacity: disabled ? 0.55 : 1, transition: 'all .15s',
        ...variants[variant], ...sizes[size], ...style,
      }}
    >
      {children}
    </button>
  )
}

export function FormGroup({ label, children }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{
        display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568',
        marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em',
      }}>
        {label}
      </label>
      {children}
    </div>
  )
}

export function Input({ style = {}, ...props }) {
  return (
    <input
      style={{
        width: '100%', padding: '8px 12px', border: '1px solid #dde2ea',
        borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
        color: '#1a1a2e', background: '#fff', boxSizing: 'border-box',
        outline: 'none', transition: 'border-color .15s', ...style,
      }}
      onFocus={e => e.target.style.borderColor = '#4472C4'}
      onBlur={e => e.target.style.borderColor = '#dde2ea'}
      {...props}
    />
  )
}

export function Select({ children, style = {}, ...props }) {
  return (
    <select
      style={{
        width: '100%', padding: '8px 12px', border: '1px solid #dde2ea',
        borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
        color: '#1a1a2e', background: '#fff', cursor: 'pointer',
        outline: 'none', boxSizing: 'border-box', ...style,
      }}
      {...props}
    >
      {children}
    </select>
  )
}

export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: '12px', padding: '24px',
        maxWidth: '520px', width: '100%', margin: '16px',
        boxShadow: '0 8px 40px rgba(0,0,0,.2)',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>{title}</div>
        {children}
        {footer && (
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function Badge({ children, color = '#1F3864', bg = '#D6E4F0' }) {
  return (
    <span style={{
      padding: '2px 10px', borderRadius: '20px', fontSize: '11px',
      fontWeight: 700, background: bg, color,
    }}>
      {children}
    </span>
  )
}

export function Empty({ message = 'No data found' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: '#888' }}>
      <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
      <p style={{ fontSize: '14px' }}>{message}</p>
    </div>
  )
}

export function StatusBadge({ status }) {
  const map = {
    draft:     { bg: '#FFF2CC', color: '#7B5800', label: 'Draft' },
    submitted: { bg: '#D6E4F0', color: '#1F3864', label: 'Submitted' },
    approved:  { bg: '#E2EFDA', color: '#375623', label: 'Approved' },
    queried:   { bg: '#FFE0E0', color: '#C00000', label: '⚑ Queried' },
    open:      { bg: '#FFE0E0', color: '#C00000', label: 'Open' },
    resolved:  { bg: '#E2EFDA', color: '#375623', label: 'Resolved' },
    dismissed: { bg: '#F5F5F5', color: '#808080', label: 'Dismissed' },
  }
  const s = map[status] || { bg: '#F5F5F5', color: '#888', label: status }
  return <Badge color={s.color} bg={s.bg}>{s.label}</Badge>
}

// Toast system
let toastContainer = null
export function showToast(msg, type = '') {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.style.cssText = 'position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:9999;pointer-events:none'
    document.body.appendChild(toastContainer)
  }
  const colors = { green: '#375623', red: '#C00000', '': '#1F3864' }
  const t = document.createElement('div')
  t.textContent = msg
  t.style.cssText = `background:${colors[type]||colors['']};color:#fff;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:500;opacity:0;transform:translateY(8px);transition:all .25s;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,.18);font-family:'Segoe UI',Arial,sans-serif`
  toastContainer.appendChild(t)
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)' })
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300) }, 3000)
}

// Date helpers
export function today() { return new Date().toISOString().slice(0, 10) }
export function fmtDate(d) {
  if (!d) return '—'
  const p = d.split('-')
  return `${p[2]}/${p[1]}/${p[0]}`
}
export function initials(n) {
  return n.trim().split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
