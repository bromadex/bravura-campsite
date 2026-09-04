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

function useAnimatedPct(pct, animate) {
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

  return displayPct
}

function useColors(fuelColor, fuelName, isLow) {
  const colors = fuelColor
    ? { fill: fuelColor, surface: fuelColor, highlight: fuelColor + '88' }
    : getFuelColor(fuelName)
  const lowColors = { fill: '#E53935', surface: '#EF5350', highlight: '#EF9A9A' }
  return isLow ? lowColors : colors
}

function uid() { return Math.random().toString(36).slice(2, 8) }

function DrumTank({ displayPct, c, showLabel, width, height }) {
  const imgH = height || 180
  const imgW = Math.round(imgH * 0.6)
  const gaugeH = imgH - 24
  const fillH = (displayPct / 100) * gaugeH

  return (
    <div style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '6px' }}>
      {/* Delo barrel image + percentage overlay */}
      <div style={{ position: 'relative', width: imgW, height: imgH }}>
        <img
          src="/assets/delo-barrel.png"
          alt="Delo fuel drum"
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
        {showLabel && (
          <div style={{
            position: 'absolute', bottom: '18%', left: 0, right: 0,
            textAlign: 'center', fontSize: `${Math.max(14, imgH * 0.12)}px`,
            fontWeight: 700, color: '#fff',
            textShadow: '0 1px 4px rgba(0,0,0,0.7), 0 0 8px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
          }}>
            {Math.round(displayPct)}%
          </div>
        )}
      </div>

      {/* Level glass — same style as main tank */}
      <svg width="14" height={imgH} style={{ display: 'block' }}>
        <rect x="3" y="12" width="8" height={gaugeH} rx="4"
          fill="#E0E4E8" stroke="#8A9099" strokeWidth="1" />
        {displayPct > 0 && (
          <rect
            x="4"
            y={12 + gaugeH - fillH}
            width="6" height={fillH}
            rx="3" fill={c.fill} opacity="0.7"
          />
        )}
      </svg>
    </div>
  )
}

function HorizontalTank({ displayPct, c, showLabel, width, height }) {
  const VB_W = 340
  const VB_H = 180
  const BODY_X = 30
  const BODY_Y = 20
  const BODY_W = 270
  const BODY_H = 100
  const BODY_RX = 50
  const BODY_RY = 50

  const liquidH = (displayPct / 100) * BODY_H
  const liquidY = BODY_Y + BODY_H - liquidH

  const clipId = `tank-clip-${uid()}`
  const gradId = `tank-grad-${uid()}`
  const bodyGradId = `body-grad-${uid()}`

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width={width} height={height} style={{ display: 'block' }}>
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

      <rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H}
        rx={BODY_RX} ry={BODY_RY}
        fill={`url(#${bodyGradId})`} stroke="#8A9099" strokeWidth="2" />
      <rect x={BODY_X + 10} y={BODY_Y + 8} width={BODY_W - 20} height={12}
        rx={6} ry={6} fill="white" opacity="0.18" />

      {displayPct > 0.5 && (
        <g clipPath={`url(#${clipId})`}>
          <rect x={BODY_X} y={liquidY} width={BODY_W} height={liquidH + 2}
            fill={`url(#${gradId})`} />
          {displayPct > 3 && displayPct < 97 && (
            <path
              d={`M ${BODY_X} ${liquidY}
                  Q ${BODY_X + BODY_W * 0.15} ${liquidY - 2.5} ${BODY_X + BODY_W * 0.3} ${liquidY}
                  Q ${BODY_X + BODY_W * 0.45} ${liquidY + 2.5} ${BODY_X + BODY_W * 0.6} ${liquidY}
                  Q ${BODY_X + BODY_W * 0.75} ${liquidY - 2} ${BODY_X + BODY_W * 0.9} ${liquidY}
                  L ${BODY_X + BODY_W} ${liquidY}
                  L ${BODY_X + BODY_W} ${liquidY + 4}
                  L ${BODY_X} ${liquidY + 4} Z`}
              fill={c.surface} opacity="0.5"
            >
              <animateTransform attributeName="transform" type="translate"
                values="0,0; 8,-1; 0,0; -8,1; 0,0" dur="4s" repeatCount="indefinite" />
            </path>
          )}
          {displayPct > 5 && displayPct < 95 && (
            <rect x={BODY_X + 20} y={liquidY} width={BODY_W - 40} height={3}
              rx={1.5} fill="white" opacity="0.2" />
          )}
        </g>
      )}

      <rect x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H}
        rx={BODY_RX} ry={BODY_RY} fill="none" stroke="#8A9099" strokeWidth="2" />

      <line x1={BODY_X + BODY_W * 0.33} y1={BODY_Y + 2} x2={BODY_X + BODY_W * 0.33} y2={BODY_Y + BODY_H - 2} stroke="#9EA6AE" strokeWidth="0.8" opacity="0.4" />
      <line x1={BODY_X + BODY_W * 0.66} y1={BODY_Y + 2} x2={BODY_X + BODY_W * 0.66} y2={BODY_Y + BODY_H - 2} stroke="#9EA6AE" strokeWidth="0.8" opacity="0.4" />

      <ellipse cx={BODY_X + BODY_RX} cy={BODY_Y + BODY_H / 2} rx={3} ry={BODY_RY - 4} fill="none" stroke="#9EA6AE" strokeWidth="0.8" opacity="0.3" />
      <ellipse cx={BODY_X + BODY_W - BODY_RX} cy={BODY_Y + BODY_H / 2} rx={3} ry={BODY_RY - 4} fill="none" stroke="#9EA6AE" strokeWidth="0.8" opacity="0.3" />

      <rect x={BODY_X + BODY_W / 2 - 15} y={12} width={30} height={10} rx={3} fill="#9EA6AE" stroke="#7A828A" strokeWidth="1" />
      <circle cx={BODY_X + BODY_W / 2} cy={12} r={4} fill="#B0B8C1" stroke="#7A828A" strokeWidth="1" />
      <rect x={BODY_X + BODY_W * 0.6} y={8} width={6} height={14} rx={1} fill="#9EA6AE" stroke="#7A828A" strokeWidth="0.8" />
      <rect x={BODY_X + BODY_W * 0.6 - 2} y={6} width={10} height={3} rx={1.5} fill="#A8B0B8" stroke="#7A828A" strokeWidth="0.8" />
      <rect x={BODY_X + BODY_W * 0.25} y={10} width={8} height={12} rx={1} fill="#9EA6AE" stroke="#7A828A" strokeWidth="0.8" />

      <g>
        <path d={`M ${BODY_X + BODY_W * 0.15} ${BODY_Y + BODY_H} L ${BODY_X + BODY_W * 0.15 - 10} ${BODY_Y + BODY_H + 30} L ${BODY_X + BODY_W * 0.15 + 10} ${BODY_Y + BODY_H + 30} Z`} fill="#7A828A" stroke="#6A727A" strokeWidth="1" />
        <rect x={BODY_X + BODY_W * 0.15 - 13} y={BODY_Y + BODY_H + 28} width={26} height={5} rx={1} fill="#6A727A" />
        <path d={`M ${BODY_X + BODY_W * 0.7} ${BODY_Y + BODY_H} L ${BODY_X + BODY_W * 0.7 - 10} ${BODY_Y + BODY_H + 30} L ${BODY_X + BODY_W * 0.7 + 10} ${BODY_Y + BODY_H + 30} Z`} fill="#7A828A" stroke="#6A727A" strokeWidth="1" />
        <rect x={BODY_X + BODY_W * 0.7 - 13} y={BODY_Y + BODY_H + 28} width={26} height={5} rx={1} fill="#6A727A" />
      </g>

      <rect x={BODY_X + BODY_W + 4} y={BODY_Y + 8} width={8} height={BODY_H - 16} rx={4} fill="#E0E4E8" stroke="#8A9099" strokeWidth="1" />
      {displayPct > 0 && (
        <rect
          x={BODY_X + BODY_W + 5}
          y={BODY_Y + 8 + (BODY_H - 16) * (1 - displayPct / 100)}
          width={6} height={(BODY_H - 16) * (displayPct / 100)}
          rx={3} fill={c.fill} opacity="0.7"
        />
      )}

      {showLabel && (
        <text x={BODY_X + BODY_W / 2} y={BODY_Y + BODY_H / 2 + 6}
          textAnchor="middle" fontSize="20" fontWeight="700" fontFamily="inherit"
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
  const displayPct = useAnimatedPct(pct, animate)
  const c = useColors(fuelColor, fuelName, isLow)

  const isDrum = capacity > 0 && capacity <= 2000

  if (isDrum) {
    return <DrumTank displayPct={displayPct} c={c} showLabel={showLabel}
      width={width} height={Math.max(height, width * 1.2)} />
  }

  return <HorizontalTank displayPct={displayPct} c={c} showLabel={showLabel}
    width={width} height={height} />
}
