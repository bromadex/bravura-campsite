import { THEME } from '../utils/permissions'

// ── Stat Card ────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color }) {
  const c = color || THEME.primary
  return (
    <div style={{
      background: '#fff', border: `1px solid ${THEME.cardBorder}`, borderRadius: '10px',
      padding: '14px 16px', textAlign: 'center',
      borderTop: `3px solid ${c}`,
    }}>
      <div style={{ fontSize: '10px', color: '#999', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: c, lineHeight: 1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>{sub}</div>}
    </div>
  )
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, style = {} }) {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${THEME.cardBorder}`,
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 1px 4px rgba(107,28,28,.06)',
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── Button ───────────────────────────────────────────────────────────────────
export function Button({ children, onClick, variant = 'primary', size = 'md', disabled = false, style = {} }) {
  const variants = {
    primary: { background: THEME.primary,      color: '#fff' },
    success: { background: '#375623',           color: '#fff' },
    danger:  { background: '#C00000',           color: '#fff' },
    orange:  { background: '#C55A11',           color: '#fff' },
    ghost:   { background: 'transparent',       color: '#4a5568', border: `1px solid ${THEME.cardBorder}` },
    maroon:  { background: THEME.primaryLight,  color: '#fff' },
    teal:    { background: '#00897B',           color: '#fff' },
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

// ── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(60,0,0,.35)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: '14px', padding: '24px',
        maxWidth: '520px', width: '100%', margin: '16px',
        boxShadow: '0 12px 48px rgba(107,28,28,.2)',
        borderTop: `4px solid ${THEME.primary}`,
      }}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: THEME.primary, marginBottom: '18px' }}>{title}</div>
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

// ── Confirm Dialog ───────────────────────────────────────────────────────────
export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', danger = true }) {
  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(60,0,0,.35)',
        zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: '14px', padding: '28px',
        maxWidth: '400px', width: '100%', margin: '16px',
        boxShadow: '0 12px 48px rgba(107,28,28,.2)',
        borderTop: `4px solid ${danger ? '#C00000' : THEME.primary}`,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '36px', marginBottom: '12px' }}>{danger ? '🗑️' : '⚠️'}</div>
        <div style={{ fontSize: '16px', fontWeight: 700, color: danger ? '#C00000' : THEME.primary, marginBottom: '8px' }}>
          {title}
        </div>
        <div style={{ fontSize: '13px', color: '#666', marginBottom: '24px', lineHeight: 1.6 }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <Button onClick={onClose} variant="ghost">Cancel</Button>
          <Button onClick={onConfirm} variant={danger ? 'danger' : 'primary'}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

// ── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ children, color, bg }) {
  return (
    <span style={{
      padding: '2px 10px', borderRadius: '20px', fontSize: '11px',
      fontWeight: 700,
      background: bg || '#F5EDEE',
      color: color || THEME.primary,
    }}>
      {children}
    </span>
  )
}

// ── Status Badge ─────────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const map = {
    draft:     { bg: '#FFF2CC', color: '#7B5800',  label: 'Draft' },
    submitted: { bg: '#F5EDEE', color: THEME.primary, label: 'Submitted' },
    approved:  { bg: '#E2EFDA', color: '#375623',  label: 'Approved' },
    queried:   { bg: '#FFE0E0', color: '#C00000',  label: '⚑ Queried' },
    open:      { bg: '#FFE0E0', color: '#C00000',  label: 'Open' },
    resolved:  { bg: '#E2EFDA', color: '#375623',  label: 'Resolved' },
    dismissed: { bg: '#F5F5F5', color: '#808080',  label: 'Dismissed' },
    Active:    { bg: '#E2EFDA', color: '#375623',  label: 'Active' },
    Inactive:  { bg: '#F5F5F5', color: '#808080',  label: 'Inactive' },
  }
  const s = map[status] || { bg: '#F5F5F5', color: '#888', label: status }
  return <Badge color={s.color} bg={s.bg}>{s.label}</Badge>
}

// ── Empty ────────────────────────────────────────────────────────────────────
export function Empty({ message = 'No data found' }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: '#aaa' }}>
      <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
      <p style={{ fontSize: '14px' }}>{message}</p>
    </div>
  )
}

// ── Section Label ────────────────────────────────────────────────────────────
export function SectionLabel({ children }) {
  return (
    <div style={{
      fontWeight: 700, fontSize: '11px', textTransform: 'uppercase',
      letterSpacing: '.07em', color: '#999', marginBottom: '10px',
    }}>
      {children}
    </div>
  )
}

// ── Toast ────────────────────────────────────────────────────────────────────
let toastContainer = null
export function showToast(msg, type = '') {
  if (!toastContainer) {
    toastContainer = document.createElement('div')
    toastContainer.style.cssText = 'position:fixed;bottom:24px;right:24px;display:flex;flex-direction:column;gap:8px;z-index:9999;pointer-events:none'
    document.body.appendChild(toastContainer)
  }
  const colors = { green: '#375623', red: '#C00000', '': THEME.primary }
  const t = document.createElement('div')
  t.textContent = msg
  t.style.cssText = `background:${colors[type]||colors['']};color:#fff;padding:11px 18px;border-radius:8px;font-size:13px;font-weight:500;opacity:0;transform:translateY(8px);transition:all .25s;max-width:320px;box-shadow:0 4px 16px rgba(0,0,0,.2);font-family:'Segoe UI',Arial,sans-serif`
  toastContainer.appendChild(t)
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)' })
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300) }, 3000)
}

// ── Helpers ──────────────────────────────────────────────────────────────────
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
