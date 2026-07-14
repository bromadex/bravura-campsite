import { useId, useState } from 'react'
import { THEME } from '../utils/permissions'
import { Icon } from './ui'

const CARD_SHADOW = '0 1px 3px rgba(0,0,0,0.06)'
const CARD_SHADOW_HOVER = '0 4px 12px rgba(0,0,0,0.10)'
const RADIUS = '16px'

const fmtK = v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v).toString()
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Borderless dashboard card: surface bg, 16px radius, soft shadow. */
export function DashCard({ children, style }) {
  return (
    <div style={{ background: THEME.surface, borderRadius: RADIUS, padding: '20px 22px', boxShadow: CARD_SHADOW, minWidth: 0, ...style }}>
      {children}
    </div>
  )
}

/** KPI stat card: tinted circular icon chip, bold value, muted label, optional sub + thin accent progress bar. */
export function KpiCard({ icon, label, value, sub, accent, progress, onClick }) {
  const clr = accent || THEME.primary
  const [hover, setHover] = useState(false)
  const barPct = progress === null || progress === undefined ? null : clamp(progress, 0, 100)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: THEME.surface, borderRadius: RADIUS, padding: '18px',
        boxShadow: hover ? CARD_SHADOW_HOVER : CARD_SHADOW,
        transform: hover ? 'translateY(-1px)' : 'none',
        transition: 'box-shadow .15s, transform .15s',
        display: 'flex', flexDirection: 'column',
        gap: '12px', minWidth: 0, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{
          width: '42px', height: '42px', borderRadius: '50%', background: clr + '18',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name={icon} size={20} style={{ color: clr }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, lineHeight: 1.15, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          <div style={{ fontSize: '11px', color: THEME.textLow, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
        </div>
      </div>
      <div>
        <div style={{ height: '5px', borderRadius: '3px', background: THEME.surfaceVar, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${barPct ?? 0}%`, background: clr, borderRadius: '3px', transition: 'width .4s' }} />
        </div>
        {sub && <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
      </div>
    </div>
  )
}

/** Smooth bezier area chart (SVG): gradient fill, gridlines, y ticks, max-point label, faint dots on all points. */
export function AreaChart({ points = [], width = 520, height = 170, color, valueSuffix = '', labels = [] }) {
  const gradId = useId()
  const W = width, H = height
  const padL = 30, padR = 12, padT = 20, padB = 22
  const areaW = W - padL - padR
  const areaH = H - padT - padB
  const vals = points.map(v => Number(v) || 0)
  const n = vals.length
  const max = Math.max(...(n ? vals : [0]), 1)
  const x = i => padL + (n > 1 ? (i / (n - 1)) * areaW : areaW / 2)
  const y = v => padT + areaH - (v / max) * areaH

  let line = null, area = null
  if (n > 0) {
    line = `M ${x(0)} ${y(vals[0])}`
    for (let i = 1; i < n; i++) {
      const x0 = x(i - 1), x1 = x(i)
      const y0 = y(vals[i - 1]), y1 = y(vals[i])
      const mx = (x0 + x1) / 2
      line += ` C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`
    }
    area = `${line} L ${x(n - 1)} ${padT + areaH} L ${x(0)} ${padT + areaH} Z`
  }

  const maxIdx = n ? vals.reduce((best, v, i) => (v > vals[best] ? i : best), 0) : -1
  const hasData = vals.some(v => v > 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '360px', display: 'block' }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(f * max)} y2={y(f * max)} stroke={THEME.outlineVar} strokeWidth="0.5" strokeDasharray="3 3" />
            <text x={padL - 5} y={y(f * max) + 3} textAnchor="end" fontSize="8.5" fill={THEME.textLow} fontFamily="inherit">{fmtK(f * max)}{valueSuffix}</text>
          </g>
        ))}
        <line x1={padL} x2={W - padR} y1={padT + areaH} y2={padT + areaH} stroke={THEME.outlineVar} strokeWidth="1" />
        {n > 1 && <path d={area} fill={`url(#${gradId})`} />}
        {n > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {vals.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="2" fill={color} opacity="0.4" />
        ))}
        {hasData && maxIdx >= 0 && (
          <g>
            <circle cx={x(maxIdx)} cy={y(vals[maxIdx])} r="4" fill={color} stroke={THEME.surface} strokeWidth="2" />
            <text x={x(maxIdx)} y={y(vals[maxIdx]) - 8} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">
              {fmtK(vals[maxIdx])}{valueSuffix}
            </text>
          </g>
        )}
        {labels.map((l, i) => (
          (n <= 8 || i % 2 === 0) && i < n ? (
            <text key={i} x={x(i)} y={padT + areaH + 14} textAnchor="middle" fontSize="9" fill={THEME.textLow} fontFamily="inherit">{l}</text>
          ) : null
        ))}
      </svg>
    </div>
  )
}

/** Donut ring gauge (SVG) with bold % centered, optional label under the % and dot legend below. */
export function DonutGauge({ pct, color, size = 140, label, legend }) {
  const p = pct === null || pct === undefined ? null : clamp(pct, 0, 100)
  const R = size * (52 / 140), C = 2 * Math.PI * R
  const mid = size / 2
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', padding: '8px 0' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={mid} cy={mid} r={R} fill="none" stroke={THEME.surfaceVar} strokeWidth="12" />
        <circle
          cx={mid} cy={mid} r={R} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={`${((p ?? 0) / 100) * C} ${C}`} transform={`rotate(-90 ${mid} ${mid})`}
          style={{ transition: 'stroke-dasharray .5s' }}
        />
        <text x={mid} y={mid - 4} textAnchor="middle" fontSize="24" fontWeight="700" fill={THEME.text} fontFamily="inherit" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {p !== null ? `${p.toFixed(0)}%` : '—'}
        </text>
        {label && (
          <text x={mid} y={mid + 14} textAnchor="middle" fontSize="10" fill={THEME.textLow} fontFamily="inherit">
            {label}
          </text>
        )}
      </svg>
      {legend && legend.length > 0 && (
        <div style={{ display: 'flex', gap: '12px', fontSize: '10px', color: THEME.textLow, flexWrap: 'wrap', justifyContent: 'center' }}>
          {legend.map(([c, l]) => (
            <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Paired rounded bar chart (SVG): two series per slot with value labels and a dot legend. */
export function PairedBars({ series = [], width = 520, height = 180, colorA, colorB, labelA, labelB, labels = [] }) {
  const W = width, H = height
  const padL = 8, padR = 8, padT = 20, padB = 22
  const areaW = W - padL - padR
  const areaH = H - padT - padB
  const max = Math.max(...series.flatMap(d => [Number(d.a) || 0, Number(d.b) || 0]), 1)
  const slot = series.length ? areaW / series.length : areaW
  const barW = Math.min(26, slot * 0.28)
  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', fontSize: '11px', color: THEME.textMed }}>
        {[[colorA, labelA], [colorB, labelB]].map(([c, l]) => (
          <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, display: 'inline-block' }} />
            {l}
          </span>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '360px', display: 'block' }}>
          {[0.25, 0.5, 0.75, 1].map(f => (
            <line key={f} x1={padL} x2={W - padR} y1={padT + areaH - f * areaH} y2={padT + areaH - f * areaH}
              stroke={THEME.outlineVar} strokeWidth="0.5" strokeDasharray="3 3" />
          ))}
          <line x1={padL} x2={W - padR} y1={padT + areaH} y2={padT + areaH} stroke={THEME.outlineVar} strokeWidth="1" />
          {series.map((d, i) => {
            const a = Number(d.a) || 0, b = Number(d.b) || 0
            const cx = padL + i * slot + slot / 2
            const hA = a > 0 ? Math.max(2, (a / max) * areaH) : 0
            const hB = b > 0 ? Math.max(2, (b / max) * areaH) : 0
            return (
              <g key={i}>
                {hA > 0 && <rect x={cx - barW - 2} y={padT + areaH - hA} width={barW} height={hA} rx={3} fill={colorA} opacity="0.85" />}
                {hB > 0 && <rect x={cx + 2} y={padT + areaH - hB} width={barW} height={hB} rx={3} fill={colorB} opacity="0.85" />}
                {a > 0 && <text x={cx - barW / 2 - 2} y={padT + areaH - hA - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">{fmtK(a)}</text>}
                {b > 0 && <text x={cx + barW / 2 + 2} y={padT + areaH - hB - 5} textAnchor="middle" fontSize="9" fontWeight="600" fill={THEME.textMed} fontFamily="inherit">{fmtK(b)}</text>}
                <text x={cx} y={padT + areaH + 14} textAnchor="middle" fontSize="9" fill={THEME.textLow} fontFamily="inherit">{labels[i] ?? ''}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/** Label + rounded gradient progress bar + bold right value (top-consumers style row). */
export function ProgressRow({ label, value, pct, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div style={{ width: '110px', flexShrink: 0, fontSize: '12px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={typeof label === 'string' ? label : undefined}>
        {label}
      </div>
      <div style={{ flex: 1, height: '8px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${clamp(pct ?? 0, 2, 100)}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`, borderRadius: '4px',
        }} />
      </div>
      <div style={{ width: '72px', flexShrink: 0, textAlign: 'right', fontSize: '12px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
    </div>
  )
}

/** Activity list row: circular tinted icon chip, title + sub, right value; subtle bottom separator unless last. */
export function ActivityRow({ icon, iconColor, title, sub, right, rightColor, isLast }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0',
      borderBottom: isLast ? 'none' : `1px solid ${THEME.outlineVar}`,
    }}>
      <div style={{
        width: '32px', height: '32px', borderRadius: '50%', background: iconColor + '18',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon name={icon} size={16} style={{ color: iconColor }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </div>
        <div style={{ fontSize: '10px', color: THEME.textLow }}>{sub}</div>
      </div>
      {right !== undefined && (
        <div style={{ fontSize: '12px', fontWeight: 700, color: rightColor || THEME.text, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {right}
        </div>
      )}
    </div>
  )
}

/** Section heading: 14px/600 title, muted subtitle, optional right-side action node. */
export function SectionTitle({ title, subtitle, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '16px' }}>
      <div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{title}</div>
        {subtitle && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}
