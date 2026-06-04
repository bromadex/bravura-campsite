import { THEME } from '../utils/permissions'

// ── Material Symbol icon helper ───────────────────────────────────────────────
export const Icon = ({ name, size = 20, filled = false, style = {} }) => (
  <span
    className={`material-symbols-rounded${filled ? ' filled' : ''}`}
    style={{ fontSize: size, lineHeight: 1, color: 'inherit', ...style }}
  >
    {name}
  </span>
)

// ── Stat Card — MD3 "filled card" style ──────────────────────────────────────
export function StatCard({ label, value, sub, color, icon }) {
  const c = color || THEME.primary
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'flex', flexDirection: 'column', gap: '4px',
      boxShadow: '0 1px 2px rgba(0,0,0,.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {label}
        </div>
        {icon && <Icon name={icon} size={18} style={{ color: c, opacity: .7 }} />}
      </div>
      <div style={{ fontSize: '32px', fontWeight: 400, color: c, lineHeight: 1.1, letterSpacing: '-.02em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow }}>{sub}</div>}
    </div>
  )
}

// ── Card — MD3 outlined card ──────────────────────────────────────────────────
export function Card({ children, style = {}, elevated = false }) {
  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '16px',
      padding: '20px',
      boxShadow: elevated ? '0 2px 8px rgba(0,0,0,.08)' : '0 1px 2px rgba(0,0,0,.04)',
      ...style,
    }}>
      {children}
    </div>
  )
}

// ── Button — MD3 filled / tonal / outlined ────────────────────────────────────
export function Button({ children, onClick, variant = 'filled', size = 'md', disabled = false, style = {}, icon }) {
  const variants = {
    filled:   { background: THEME.primary,     color: '#fff',         border: 'none' },
    tonal:    { background: THEME.surfaceVar,   color: THEME.primary,  border: 'none' },
    outlined: { background: 'transparent',      color: THEME.primary,  border: `1px solid ${THEME.outline}` },
    text:     { background: 'transparent',      color: THEME.primary,  border: 'none' },
    danger:   { background: THEME.error,        color: '#fff',         border: 'none' },
    success:  { background: THEME.success,      color: '#fff',         border: 'none' },
    // legacy aliases
    primary:  { background: THEME.primary,     color: '#fff',         border: 'none' },
    ghost:    { background: 'transparent',      color: THEME.textMed,  border: `1px solid ${THEME.outline}` },
  }
  const sizes = {
    sm: { padding: '5px 14px', fontSize: '12px', borderRadius: '20px', height: '32px' },
    md: { padding: '8px 20px', fontSize: '13px', borderRadius: '20px', height: '40px' },
    lg: { padding: '10px 24px',fontSize: '14px', borderRadius: '20px', height: '48px' },
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit', whiteSpace: 'nowrap', letterSpacing: '.01em',
        opacity: disabled ? .45 : 1, transition: 'all .15s',
        ...variants[variant] || variants.filled, ...sizes[size], ...style,
      }}
    >
      {icon && <Icon name={icon} size={16} style={{ color: 'inherit' }} />}
      {children}
    </button>
  )
}

// ── Chip — MD3 filter chip ────────────────────────────────────────────────────
export function Chip({ children, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '5px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
        cursor: 'pointer', border: `1px solid ${active ? (color || THEME.primary) : THEME.outline}`,
        fontFamily: 'inherit', transition: 'all .15s',
        background: active ? (color ? color + '18' : THEME.surfaceVar) : 'transparent',
        color: active ? (color || THEME.primary) : THEME.textMed,
      }}
    >
      {children}
    </button>
  )
}

// ── Modal — MD3 Dialog ────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.32)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: '28px', padding: '24px',
        maxWidth: '560px', width: '100%', margin: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      }}>
        <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, marginBottom: '20px', letterSpacing: '-.01em' }}>
          {title}
        </div>
        <div style={{ color: THEME.textMed }}>
          {children}
        </div>
        {footer && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '24px' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Confirm Dialog ────────────────────────────────────────────────────────────
export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Delete', danger = true }) {
  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.32)',
        zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#fff', borderRadius: '28px', padding: '28px 24px',
        maxWidth: '380px', width: '100%', margin: '16px',
        boxShadow: '0 8px 32px rgba(0,0,0,.18)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: danger ? '#FDECEA' : THEME.surfaceVar,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={danger ? 'delete' : 'warning'} size={20} style={{ color: danger ? THEME.error : THEME.primary }} />
          </div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>{title}</div>
        </div>
        <div style={{ fontSize: '14px', color: THEME.textMed, lineHeight: 1.6, marginBottom: '24px' }}>
          {message}
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button onClick={onClose} variant="text">Cancel</Button>
          <Button onClick={onConfirm} variant={danger ? 'danger' : 'filled'}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}

// ── Status Chip ───────────────────────────────────────────────────────────────
export function StatusBadge({ status }) {
  const map = {
    draft:     { bg: '#FFF8E1', color: '#7D5700', label: 'Draft' },
    submitted: { bg: THEME.surfaceVar, color: THEME.primary, label: 'Submitted' },
    approved:  { bg: '#E8F5E9', color: '#1B5E20', label: 'Approved' },
    queried:   { bg: '#FDECEA', color: THEME.error, label: 'Queried' },
    open:      { bg: '#FDECEA', color: THEME.error, label: 'Open' },
    resolved:  { bg: '#E8F5E9', color: '#1B5E20', label: 'Resolved' },
    dismissed: { bg: '#F5F5F5', color: '#757575', label: 'Dismissed' },
    Active:    { bg: '#E8F5E9', color: '#1B5E20', label: 'Active' },
    Inactive:  { bg: '#F5F5F5', color: '#757575', label: 'Inactive' },
  }
  const s = map[status] || { bg: '#F5F5F5', color: '#757575', label: status }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
      background: s.bg, color: s.color,
    }}>
      {s.label}
    </span>
  )
}

// ── Section label ─────────────────────────────────────────────────────────────
export function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: '12px', fontWeight: 500, color: THEME.textMed,
      marginBottom: '6px', letterSpacing: '.01em',
    }}>
      {children}
    </div>
  )
}

// ── Text field — MD3 outlined ─────────────────────────────────────────────────
export function TextField({ label, value, onChange, placeholder, type = 'text', autoFocus, onKeyDown, style = {} }) {
  return (
    <div style={{ marginBottom: '14px', ...style }}>
      {label && <SectionLabel>{label}</SectionLabel>}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        style={{
          width: '100%', padding: '10px 14px',
          border: `1px solid ${THEME.outline}`,
          borderRadius: '12px', fontSize: '14px', color: THEME.text,
          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
          transition: 'border-color .15s, box-shadow .15s',
          background: '#fff',
        }}
        onFocus={e => { e.target.style.borderColor = THEME.primary; e.target.style.boxShadow = `0 0 0 2px ${THEME.primary}22` }}
        onBlur={e => { e.target.style.borderColor = THEME.outline; e.target.style.boxShadow = 'none' }}
      />
    </div>
  )
}

// ── Sortable table header cell ─────────────────────────────────────────────────
export function SortTh({ label, sortKey, sortState, onSort, style = {} }) {
  const { key, dir } = sortState
  const isActive = key === sortKey
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        padding: '12px 14px', textAlign: 'left', fontWeight: 500,
        fontSize: '12px', letterSpacing: '.04em', textTransform: 'uppercase',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        color: isActive ? THEME.primary : 'rgba(255,255,255,.85)',
        transition: 'color .15s', ...style,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {label}
        <span className="material-symbols-rounded" style={{
          fontSize: '14px', lineHeight: 1,
          color: isActive ? THEME.activeBar : 'rgba(255,255,255,.3)',
          transform: isActive && dir === 'desc' ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform .2s',
        }}>
          {isActive ? 'arrow_upward' : 'unfold_more'}
        </span>
      </div>
    </th>
  )
}

// ── useSortState hook ─────────────────────────────────────────────────────────
export function useSortState(defaultKey = 'name', defaultDir = 'asc') {
  const [sortState, setSortState] = useState({ key: defaultKey, dir: defaultDir })
  function onSort(key) {
    setSortState(prev => ({
      key,
      dir: prev.key === key ? (prev.dir === 'asc' ? 'desc' : 'asc') : 'asc',
    }))
  }
  return [sortState, onSort]
}

// ── Sort helper ───────────────────────────────────────────────────────────────
export function sortRows(rows, key, dir) {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? 0
    const bv = b[key] ?? 0
    if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return dir === 'asc' ? av - bv : bv - av
  })
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastEl = null
export function showToast(msg, type = '') {
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;z-index:9999;pointer-events:none;align-items:center'
    document.body.appendChild(toastEl)
  }
  const bgMap = { green: THEME.success, red: THEME.error, '': THEME.text }
  const t = document.createElement('div')
  t.textContent = msg
  t.style.cssText = `background:${bgMap[type]||bgMap['']};color:#fff;padding:12px 24px;border-radius:28px;font-size:13px;font-weight:500;opacity:0;transform:translateY(8px);transition:all .25s;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.2);font-family:inherit`
  toastEl.appendChild(t)
  requestAnimationFrame(() => { t.style.opacity='1'; t.style.transform='translateY(0)' })
  setTimeout(() => { t.style.opacity='0'; setTimeout(() => t.remove(), 300) }, 3000)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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

// need useState for useSortState
import { useState } from 'react'
