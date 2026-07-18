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

// ── Stat Card — SAP Fiori-style KPI tile ─────────────────────────────────────
export function StatCard({ label, value, sub, color, icon }) {
  const c = color || THEME.primary
  return (
    <div style={{
      background: THEME.surface,
      border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '10px',
      padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: '6px',
      boxShadow: '0 1px 2px rgba(0,0,0,.03)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em' }}>
          {label}
        </div>
        {icon && (
          <div style={{
            width: '26px', height: '26px', borderRadius: '7px',
            background: c + '14',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Icon name={icon} size={15} style={{ color: c }} />
          </div>
        )}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 600, color: THEME.text, lineHeight: 1.1, letterSpacing: '-.02em' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 500 }}>{sub}</div>}
    </div>
  )
}

// ── Card — SAP Fiori outlined surface ────────────────────────────────────────
export function Card({ children, style = {}, elevated = false, onClick, onMouseEnter, onMouseLeave, ...rest }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        background: THEME.surface,
        border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '10px',
        padding: '18px 20px',
        boxShadow: elevated ? '0 4px 12px rgba(0,0,0,.06)' : '0 1px 2px rgba(0,0,0,.03)',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

// ── Button — SAP Fiori style: rectangular, tight radii ───────────────────────
export function Button({ children, onClick, variant = 'filled', size = 'md', disabled = false, style = {}, icon }) {
  const variants = {
    filled:   { background: THEME.primary,     color: '#fff',         border: `1px solid ${THEME.primary}` },
    tonal:    { background: THEME.surfaceVar,   color: THEME.primary,  border: `1px solid ${THEME.outlineVar}` },
    outlined: { background: THEME.surface,      color: THEME.primary,  border: `1px solid ${THEME.outline}` },
    text:     { background: 'transparent',      color: THEME.primary,  border: '1px solid transparent' },
    danger:   { background: THEME.error,        color: '#fff',         border: `1px solid ${THEME.error}` },
    success:  { background: THEME.success,      color: '#fff',         border: `1px solid ${THEME.success}` },
    // legacy aliases
    primary:  { background: THEME.primary,     color: '#fff',         border: `1px solid ${THEME.primary}` },
    ghost:    { background: 'transparent',      color: THEME.textMed,  border: `1px solid ${THEME.outline}` },
  }
  const sizes = {
    sm: { padding: '4px 12px', fontSize: '12px', borderRadius: '6px', height: '30px' },
    md: { padding: '6px 16px', fontSize: '13px', borderRadius: '6px', height: '36px' },
    lg: { padding: '8px 20px', fontSize: '14px', borderRadius: '8px', height: '42px' },
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

// ── Chip — Fiori-style filter chip ───────────────────────────────────────────
export function Chip({ children, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
        cursor: 'pointer', border: `1px solid ${active ? (color || THEME.primary) : THEME.outlineVar}`,
        fontFamily: 'inherit', transition: 'all .15s',
        background: active ? (color ? color + '14' : THEME.primary + '10') : THEME.surface,
        color: active ? (color || THEME.primary) : THEME.textMed,
      }}
    >
      {children}
    </button>
  )
}

// ── Modal — Fiori Dialog ─────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,15,15,.42)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        background: THEME.surface, borderRadius: '12px', padding: 0,
        maxWidth: '560px', width: '100%', margin: '16px',
        boxShadow: '0 20px 48px rgba(0,0,0,.20), 0 4px 12px rgba(0,0,0,.10)',
        border: `1px solid ${THEME.outlineVar}`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 22px',
          fontSize: '16px', fontWeight: 600, color: THEME.text, letterSpacing: '-.01em',
          borderBottom: `1px solid ${THEME.outlineVar}`,
        }}>
          {title}
        </div>
        <div style={{ color: THEME.textMed, padding: '20px 22px' }}>
          {children}
        </div>
        {footer && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '14px 22px', background: THEME.surfaceVar, borderTop: `1px solid ${THEME.outlineVar}` }}>
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
        position: 'fixed', inset: 0, background: 'rgba(15,15,15,.42)',
        zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        background: THEME.surface, borderRadius: '12px', padding: '24px',
        maxWidth: '380px', width: '100%', margin: '16px',
        boxShadow: '0 20px 48px rgba(0,0,0,.20), 0 4px 12px rgba(0,0,0,.10)',
        border: `1px solid ${THEME.outlineVar}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <div style={{
            width: '38px', height: '38px', borderRadius: '9px',
            background: danger ? THEME.statusErrorBg : THEME.surfaceVar,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={danger ? 'delete' : 'warning'} size={18} style={{ color: danger ? THEME.error : THEME.primary }} />
          </div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>{title}</div>
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
    // Feedback board
    new:         { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'New' },
    triaged:     { bg: THEME.surfaceVar,       color: THEME.textMed,            label: 'Triaged' },
    in_progress: { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'In Progress' },
    done:        { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText,  label: 'Done' },
    wont_do:     { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: "Won't Do" },
    duplicate:   { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Duplicate' },
    Active:    { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Active' },
    Inactive:  { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Inactive' },
    // New lowercase employee status values (post-migration)
    active:              { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText,  label: 'Active' },
    terminated:          { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Terminated' },
    on_leave:            { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'On Leave' },
    long_leave:          { bg: THEME.statusTertiaryBg, color: THEME.statusTertiaryText, label: 'Long Leave' },
    temporary_assignment:{ bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Temporary Assignment' },
    transferred:         { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Transferred' },
    // Fleet asset statuses
    operational:         { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText,  label: 'Operational' },
    maintenance:         { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Maintenance' },
    grounded:            { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Grounded' },
    awaiting_parts:      { bg: THEME.statusTertiaryBg, color: THEME.statusTertiaryText, label: 'Awaiting Parts' },
    decommissioned:      { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Decommissioned' },
    // Fleet inspection results
    pass:                { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText,  label: 'Pass' },
    pass_with_defects:   { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Pass w/ Defects' },
    unsafe:              { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Unsafe' },
    // Fleet tyre statuses
    fitted:              { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText,  label: 'Fitted' },
    stock:               { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Stock' },
    retreaded:           { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Retreaded' },
    scrapped:            { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Scrapped' },
    // Fleet accident severity
    minor:               { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Minor' },
    moderate:            { bg: THEME.statusWarningBg,   color: THEME.statusWarningText,  label: 'Moderate' },
    major:               { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Major' },
    write_off:           { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Write-Off' },
    // Fleet accident statuses
    reported:            { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Reported' },
    investigating:       { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Investigating' },
    // Fleet maintenance
    scheduled:           { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Scheduled' },
    awaiting_approval:   { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Awaiting Approval' },
    waiting_for_parts:   { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Waiting for Parts' },
    critical:            { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Critical' },
    medium:              { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Medium' },
    // Contractor statuses
    expired:             { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Expired' },
    suspended:           { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Suspended' },
    // Inventory / procurement
    sent:                { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Sent' },
    partially_received:  { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'Partial' },
    received:            { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText,  label: 'Received' },
    rejected:            { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Rejected' },
    ordered:             { bg: THEME.statusInfoBg,     color: THEME.statusInfoText,     label: 'Ordered' },
    urgent:              { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Urgent' },
    high:                { bg: THEME.statusWarningBg,  color: THEME.statusWarningText,  label: 'High' },
    normal:              { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Normal' },
    low:                 { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Low' },
    overdue:             { bg: THEME.statusErrorBg,    color: THEME.statusErrorText,    label: 'Overdue' },
    closed:              { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Closed' },
    planned:             { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText,  label: 'Planned' },
  }
  const s = map[status] || { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: status }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 9px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, letterSpacing: '.01em',
      background: s.bg, color: s.color,
      border: `1px solid ${s.color}22`,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
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

// ── Text field — Fiori-style outlined ─────────────────────────────────────────
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
          width: '100%', padding: '8px 12px',
          border: `1px solid ${THEME.outline}`,
          borderRadius: '6px', fontSize: '13px', color: THEME.text,
          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
          transition: 'border-color .12s, box-shadow .12s',
          background: THEME.surface,
          height: '36px',
        }}
        onFocus={e => { e.target.style.borderColor = THEME.primary; e.target.style.boxShadow = `0 0 0 3px ${THEME.primary}1E` }}
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
        padding: '10px 14px', textAlign: 'left', fontWeight: 600,
        fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        color: isActive ? THEME.primary : THEME.textMed,
        transition: 'color .12s', ...style,
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        {label}
        <span className="material-symbols-rounded" style={{
          fontSize: '14px', lineHeight: 1,
          color: isActive ? THEME.primary : THEME.textLow,
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
      marginBottom: '18px', gap: '12px', flexWrap: 'wrap',
      paddingBottom: '14px', borderBottom: `1px solid ${THEME.outlineVar}`,
    }}>
      <div>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: THEME.text, margin: 0, letterSpacing: '-.01em', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {title}
          {site && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              gap: '4px', padding: '2px 8px', borderRadius: '5px',
              fontSize: '11px', fontWeight: 600,
              background: THEME.primary + '10', color: THEME.primary,
              border: `1px solid ${THEME.primary}24`,
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
    <div style={{
      overflowX: 'auto', borderRadius: '10px',
      border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
      boxShadow: '0 1px 2px rgba(0,0,0,.03)',
      ...style,
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: THEME.surface }}>
        {children}
      </table>
    </div>
  )
}
export function THead({ children }) {
  return (
    <thead>
      <tr style={{
        background: THEME.surfaceVar,
        color: THEME.textMed,
        borderBottom: `1px solid ${THEME.outlineVar}`,
      }}>
        {children}
      </tr>
    </thead>
  )
}
export function Th({ children, align = 'left', style }) {
  return (
    <th style={{
      padding: '10px 14px', textAlign: align,
      fontWeight: 600, fontSize: '11px',
      textTransform: 'uppercase', letterSpacing: '.06em',
      color: THEME.textMed, whiteSpace: 'nowrap',
      ...style,
    }}>{children}</th>
  )
}
export function TRow({ children, onClick, last, style }) {
  const [hov, setHov] = useState(false)
  return (
    <tr
      style={{
        borderBottom: last ? 'none' : `1px solid ${THEME.outlineVar}`,
        background: hov ? THEME.primary + '06' : THEME.surface,
        cursor: onClick ? 'pointer' : undefined,
        transition: 'background .1s',
        ...style,
      }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      onClick={onClick}
    >
      {children}
    </tr>
  )
}
export function Td({ children, align, style }) {
  return <td style={{ padding: '10px 14px', textAlign: align, color: THEME.text, ...style }}>{children}</td>
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
