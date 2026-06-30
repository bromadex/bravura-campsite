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
      background: THEME.surface,
      border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '16px',
      padding: '16px',
      display: 'flex', flexDirection: 'column', gap: '4px',
      boxShadow: THEME.shadow1,
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
export function Card({ children, style = {}, elevated = false, onClick, onMouseEnter, onMouseLeave, ...rest }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: THEME.surface,
        border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '16px',
        padding: '20px',
        boxShadow: elevated ? THEME.shadow2 : THEME.shadow1,
        ...style,
      }}
      {...rest}
    >
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
        background: THEME.surface, borderRadius: '28px', padding: '24px',
        maxWidth: '560px', width: '100%', margin: '16px',
        boxShadow: THEME.shadow3,
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
        background: THEME.surface, borderRadius: '28px', padding: '28px 24px',
        maxWidth: '380px', width: '100%', margin: '16px',
        boxShadow: THEME.shadow3,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: danger ? THEME.statusErrorBg : THEME.surfaceVar,
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
    draft:     { bg: THEME.statusWarningBg, color: THEME.statusWarningText, label: 'Draft' },
    submitted: { bg: THEME.surfaceVar,      color: THEME.primary,           label: 'Submitted' },
    approved:  { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Approved' },
    queried:   { bg: THEME.statusErrorBg,   color: THEME.statusErrorText,   label: 'Queried' },
    // Stock transfer workflow states
    pending:    { bg: THEME.statusWarningBg, color: THEME.statusWarningText, label: 'Pending' },
    in_transit: { bg: THEME.surfaceVar,      color: THEME.info,              label: 'In Transit' },
    completed:  { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Completed' },
    cancelled:  { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Cancelled' },
    open:      { bg: THEME.statusErrorBg,   color: THEME.statusErrorText,   label: 'Open' },
    resolved:  { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Resolved' },
    dismissed: { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Dismissed' },
    Active:    { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Active' },
    Inactive:  { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Inactive' },
    // New lowercase employee status values (post-migration)
    active:              { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText,  label: 'Active' },
    terminated:          { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Terminated' },
    on_leave:            { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'On Leave' },
    long_leave:          { bg: THEME.statusTertiaryBg, color: THEME.statusTertiaryText, label: 'Long Leave' },
    temporary_assignment:{ bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Temporary Assignment' },
    transferred:         { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Transferred' },
  }
  const s = map[status] || { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: status }
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
          background: THEME.surface,
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

// ── PageHeader — standard page title + optional site badge + right actions ────
// Replaces the copy-pasted h2+badge block across every page.
// `site` accepts a site object {name} or a plain string. `actions` renders
// to the right. `children` renders below the title row (e.g. StatusBadge).
export function PageHeader({ title, site, actions, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      marginBottom: '20px', gap: '12px', flexWrap: 'wrap',
    }}>
      <div>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>
          {title}
          {site && (
            <span style={{
              marginLeft: '10px', display: 'inline-flex', alignItems: 'center',
              gap: '4px', padding: '2px 10px', borderRadius: '20px',
              fontSize: '12px', fontWeight: 600,
              background: THEME.surfaceVar, color: THEME.primary, verticalAlign: 'middle',
            }}>
              <Icon name="location_on" size={12} style={{ color: THEME.primary }} />
              {typeof site === 'string' ? site : (site?.name || '—')}
            </span>
          )}
        </h2>
        {children && <div style={{ marginTop: '6px' }}>{children}</div>}
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          {actions}
        </div>
      )}
    </div>
  )
}

// ── Table helpers — shared across all list/report pages ───────────────────────
// TableWrap: scrollable outer container + styled table element
// THead:     thead with a coloured header row (defaults to THEME.primary)
// Th:        plain header cell
// TRow:      tbody row with hover highlight + optional click handler
// Td:        body data cell
export function TableWrap({ children, style }) {
  return (
    <div style={{ overflowX: 'auto', borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`, ...style }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: THEME.surface }}>
        {children}
      </table>
    </div>
  )
}
export function THead({ children, color }) {
  return (
    <thead>
      <tr style={{ background: color || THEME.primary, color: '#fff' }}>
        {children}
      </tr>
    </thead>
  )
}
export function Th({ children, align = 'left', style }) {
  return <th style={{ padding: '11px 14px', textAlign: align, fontWeight: 500, fontSize: '12px', ...style }}>{children}</th>
}
export function TRow({ children, onClick, last, style }) {
  const [hov, setHov] = useState(false)
  return (
    <tr
      style={{ borderBottom: last ? 'none' : `1px solid ${THEME.outlineVar}`, background: hov ? THEME.surfaceVar : THEME.surface, cursor: onClick ? 'pointer' : undefined, ...style }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
    >
      {children}
    </tr>
  )
}
export function Td({ children, align, style }) {
  return <td style={{ padding: '11px 14px', textAlign: align, ...style }}>{children}</td>
}

// need useState for useSortState
import { useState } from 'react'
import { useTheme } from '../contexts/ThemeContext'

// ── Theme toggle — sun/moon switch ────────────────────────────────────────────
export function ThemeToggle({ size = 'md' }) {
  const { theme, toggleTheme } = useTheme()
  const dim = size === 'sm' ? '30px' : '34px'
  return (
    <button
      onClick={toggleTheme}
      title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      style={{
        width: dim, height: dim, borderRadius: '50%',
        border: `1px solid ${THEME.outlineVar}`, background: THEME.surfaceVar,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background .15s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceHover}
      onMouseLeave={e => e.currentTarget.style.background = THEME.surfaceVar}
    >
      <Icon name={theme === 'light' ? 'dark_mode' : 'light_mode'} size={16} style={{ color: THEME.primary }} />
    </button>
  )
}
