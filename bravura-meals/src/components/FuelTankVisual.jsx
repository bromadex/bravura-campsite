import { useState, useEffect, useRef } from 'react'
import { THEME } from '../utils/permissions'

const FUEL_COLORS = {
  diesel:  { fill: '#D4A017', surface: '#E8C84A', highlight: '#F5E06B' },
  petrol:  { fill: '#4CAF50', surface: '#66BB6A', highlight: '#81C784' },
  default: { fill: '#D4A017', surface: '#E8C84A', highlight: '#F5E06B' },
}

function getFuelColor(fuelName) {
  const n = (fuelName || '').toLowerCase()
  if (n.includes('petrol') || n.includes('gasoline') || n.includes('unleaded')) return FUEL_COLORS.petrol
  return FUEL_COLORS.diesel
}

export default function FuelTankVisual({
  percentage = 0,
  capacity = 0,
  currentLevel = 0,
  fuelName = '',
  fuelColor,
  isLow = false,
  width = 260,
  height = 140,
  showLabel = true,
  animate = true,
}) {
  const pct = Math.min(100, Math.max(0, percentage))
  const [displayPct, setDisplayPct] = useState(pct)
  const animRef = useRef(null)
  const prevPct = useRef(pct)

  useEffect(() => {
    if (!animate) { setDisplayPct(pct); return }
    const from = prevPct.current
    const to = pct
    prevPct.current = pct
    if (Math.abs(from - to) < 0.5) { setDisplayPct(to); return }
    const duration = 800
    const start = performance.now()
    function tick(now) {
      const elapsed = now - start
      const t = Math.min(1, elapsed / duration)
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      setDisplayPct(from + (to - from) * ease)
      if (t < 1) animRef.current = requestAnimationFrame(tick)
    }
    animRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animRef.current)
  }, [pct, animate])

  const colors = fuelColor
    ? { fill: fuelColor, surface: fuelColor, highlight: fuelColor + '88' }
    : getFuelColor(fuelName)

  const lowColors = { fill: '#E53935', surface: '#EF5350', highlight: '#EF9A9A' }
  const c = isLow ? lowColors : colors

  const VB_W = 280
  const VB_H = 150
  const BODY_X = 30
  const BODY_Y = 20
  const BODY_W = 220
  const BODY_H = 80
  const BODY_RX = 40
  const BODY_RY = 40

  const liquidH = (displayPct / 100) * BODY_H
  const liquidY = BODY_Y + BODY_H - liquidH

  const clipId = `tank-clip-${Math.random().toString(36).slice(2, 8)}`
  const gradId = `tank-grad-${Math.random().toString(36).slice(2, 8)}`
  const bodyGradId = `body-grad-${Math.random().toString(36).slice(2, 8)}`
  const waveId = `wave-${Math.random().toString(36).slice(2, 8)}`

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={width}
      height={height}
      style={{ display: 'block' }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H} rx={BODY_RX} ry={BODY_RY} />
        </clipPath>

        <linearGradient id={bodyGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#B0B8C1" />
          <stop offset="30%" stopColor="#D6DCE2" />
          <stop offset="50%" stopColor="#E8ECF0" />
          <stop offset="70%" stopColor="#D6DCE2" />
          <stop offset="100%" stopColor="#A0A8B0" />
        </linearGradient>

        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c.highlight} stopOpacity="0.9" />
          <stop offset="40%" stopColor={c.fill} stopOpacity="0.85" />
          <stop offset="100%" stopColor={c.fill} stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* Tank body shell */}
      <rect
        x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H}
        rx={BODY_RX} ry={BODY_RY}
        fill={`url(#${bodyGradId})`}
        stroke="#8A9099" strokeWidth="2"
      />

      {/* Metallic highlight stripe */}
      <rect
        x={BODY_X + 10} y={BODY_Y + 8} width={BODY_W - 20} height={12}
        rx={6} ry={6}
        fill="white" opacity="0.18"
      />

      {/* Liquid fill */}
      {displayPct > 0.5 && (
        <g clipPath={`url(#${clipId})`}>
          <rect
            x={BODY_X} y={liquidY} width={BODY_W} height={liquidH + 2}
            fill={`url(#${gradId})`}
          />
          {/* Wave surface line */}
          {displayPct > 3 && displayPct < 97 && (
            <path
              d={`M ${BODY_X} ${liquidY}
                  Q ${BODY_X + BODY_W * 0.15} ${liquidY - 2.5}
                    ${BODY_X + BODY_W * 0.3} ${liquidY}
                  Q ${BODY_X + BODY_W * 0.45} ${liquidY + 2.5}
                    ${BODY_X + BODY_W * 0.6} ${liquidY}
                  Q ${BODY_X + BODY_W * 0.75} ${liquidY - 2}
                    ${BODY_X + BODY_W * 0.9} ${liquidY}
                  L ${BODY_X + BODY_W} ${liquidY}
                  L ${BODY_X + BODY_W} ${liquidY + 4}
                  L ${BODY_X} ${liquidY + 4} Z`}
              fill={c.surface}
              opacity="0.5"
            >
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0,0; 8,-1; 0,0; -8,1; 0,0"
                dur="4s"
                repeatCount="indefinite"
              />
            </path>
          )}
          {/* Liquid surface reflection */}
          {displayPct > 5 && displayPct < 95 && (
            <rect
              x={BODY_X + 20} y={liquidY} width={BODY_W - 40} height={3}
              rx={1.5} fill="white" opacity="0.2"
            />
          )}
        </g>
      )}

      {/* Re-stroke tank outline over liquid */}
      <rect
        x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H}
        rx={BODY_RX} ry={BODY_RY}
        fill="none" stroke="#8A9099" strokeWidth="2"
      />

      {/* Weld seams */}
      <line x1={BODY_X + BODY_W * 0.33} y1={BODY_Y + 2} x2={BODY_X + BODY_W * 0.33} y2={BODY_Y + BODY_H - 2} stroke="#9EA6AE" strokeWidth="0.8" opacity="0.4" />
      <line x1={BODY_X + BODY_W * 0.66} y1={BODY_Y + 2} x2={BODY_X + BODY_W * 0.66} y2={BODY_Y + BODY_H - 2} stroke="#9EA6AE" strokeWidth="0.8" opacity="0.4" />

      {/* Left end cap (ellipse suggestion) */}
      <ellipse cx={BODY_X + BODY_RX} cy={BODY_Y + BODY_H / 2} rx={3} ry={BODY_RY - 4} fill="none" stroke="#9EA6AE" strokeWidth="0.8" opacity="0.3" />
      {/* Right end cap */}
      <ellipse cx={BODY_X + BODY_W - BODY_RX} cy={BODY_Y + BODY_H / 2} rx={3} ry={BODY_RY - 4} fill="none" stroke="#9EA6AE" strokeWidth="0.8" opacity="0.3" />

      {/* Top fittings — manhole */}
      <rect x={125} y={12} width={30} height={10} rx={3} fill="#9EA6AE" stroke="#7A828A" strokeWidth="1" />
      <circle cx={140} cy={12} r={4} fill="#B0B8C1" stroke="#7A828A" strokeWidth="1" />

      {/* Vent pipe */}
      <rect x={180} y={8} width={6} height={14} rx={1} fill="#9EA6AE" stroke="#7A828A" strokeWidth="0.8" />
      <rect x={178} y={6} width={10} height={3} rx={1.5} fill="#A8B0B8" stroke="#7A828A" strokeWidth="0.8" />

      {/* Fill pipe */}
      <rect x={90} y={10} width={8} height={12} rx={1} fill="#9EA6AE" stroke="#7A828A" strokeWidth="0.8" />

      {/* Legs/supports */}
      <g>
        {/* Left support */}
        <path d="M 65 100 L 55 130 L 75 130 Z" fill="#7A828A" stroke="#6A727A" strokeWidth="1" />
        <rect x={52} y={128} width={26} height={5} rx={1} fill="#6A727A" />
        {/* Right support */}
        <path d="M 215 100 L 205 130 L 225 130 Z" fill="#7A828A" stroke="#6A727A" strokeWidth="1" />
        <rect x={202} y={128} width={26} height={5} rx={1} fill="#6A727A" />
      </g>

      {/* Sight glass / gauge */}
      <rect x={BODY_X + BODY_W + 4} y={BODY_Y + 8} width={8} height={BODY_H - 16} rx={4} fill="#E0E4E8" stroke="#8A9099" strokeWidth="1" />
      {displayPct > 0 && (
        <rect
          x={BODY_X + BODY_W + 5}
          y={BODY_Y + 8 + (BODY_H - 16) * (1 - displayPct / 100)}
          width={6}
          height={(BODY_H - 16) * (displayPct / 100)}
          rx={3}
          fill={c.fill}
          opacity="0.7"
        />
      )}

      {/* Center percentage label */}
      {showLabel && (
        <text
          x={BODY_X + BODY_W / 2}
          y={BODY_Y + BODY_H / 2 + 6}
          textAnchor="middle"
          fontSize="20"
          fontWeight="700"
          fontFamily="inherit"
          fill={displayPct > 50 ? '#FFFFFF' : THEME.text}
          opacity={displayPct > 50 ? 0.95 : 0.8}
          style={{ textShadow: displayPct > 50 ? '0 1px 2px rgba(0,0,0,0.3)' : 'none' }}
        >
          {Math.round(displayPct)}%
        </text>
      )}
    </svg>
  )
}
