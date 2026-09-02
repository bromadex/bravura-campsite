import { THEME } from '../utils/permissions'

const ICONS = {
  vehicle: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17h14M5 17a2 2 0 01-2-2v-3l2-5h10l2 5v3a2 2 0 01-2 2M5 17a2 2 0 100 4 2 2 0 000-4zm14 0a2 2 0 100 4 2 2 0 000-4z"/>
      <path d="M5 12h14"/>
    </svg>
  ),
  excavator: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="16" width="8" height="5" rx="1"/>
      <circle cx="4.5" cy="21" r="1.5" fill={c}/>
      <circle cx="7.5" cy="21" r="1.5" fill={c}/>
      <path d="M6 16v-3h4l6-8 2 1.5-4.5 6H10"/>
      <path d="M14 6.5l3-2"/>
    </svg>
  ),
  crane: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h20"/>
      <path d="M8 20V6l-4 2"/>
      <path d="M8 6l10-3v3"/>
      <path d="M18 6v4"/>
      <path d="M16 10h4"/>
      <path d="M18 10v4"/>
      <rect x="6" y="14" width="4" height="6" rx="0.5"/>
    </svg>
  ),
  bulldozer: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="10" width="12" height="6" rx="1.5"/>
      <path d="M4 16h16"/>
      <circle cx="7" cy="19" r="2"/>
      <circle cx="17" cy="19" r="2"/>
      <path d="M9 19h6"/>
      <path d="M4 13H2v5h2"/>
    </svg>
  ),
  adt: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 15l2-6h6l1 3h6l2 3z"/>
      <path d="M2 15h20v2H2z"/>
      <circle cx="6" cy="19" r="2"/>
      <circle cx="18" cy="19" r="2"/>
      <path d="M8 9v-3l10-1v3"/>
    </svg>
  ),
  grader: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="18" r="2.5"/>
      <circle cx="19" cy="18" r="2.5"/>
      <path d="M7.5 18H16.5"/>
      <path d="M8 15.5h10l1-4H10z"/>
      <path d="M2 21l4-6"/>
      <path d="M12 11.5V8h5v3.5"/>
    </svg>
  ),
  drill: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8" y="2" width="8" height="10" rx="1"/>
      <path d="M12 12v10"/>
      <path d="M10 22l2-2 2 2"/>
      <path d="M6 6h2M16 6h2"/>
      <path d="M10 5h4M10 8h4"/>
    </svg>
  ),
  generator: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="6" width="18" height="12" rx="2"/>
      <path d="M12 9l-2 3h4l-2 3"/>
      <path d="M7 18v2M17 18v2"/>
      <path d="M3 10h2M19 10h2"/>
    </svg>
  ),
  forklift: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="10" width="10" height="8" rx="1.5"/>
      <circle cx="6" cy="20" r="2"/>
      <circle cx="10" cy="20" r="2"/>
      <path d="M13 14h4v8M17 14h3M17 18h2"/>
      <path d="M7 10V6h5"/>
    </svg>
  ),
  water_bowser: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="13" rx="8" ry="5"/>
      <path d="M4 13v3M20 13v3"/>
      <circle cx="6" cy="19" r="2"/>
      <circle cx="18" cy="19" r="2"/>
      <path d="M8 19h8"/>
      <path d="M12 8v-3M10 5h4"/>
    </svg>
  ),
  fuel_bowser: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="12" cy="13" rx="8" ry="5"/>
      <path d="M4 13v3M20 13v3"/>
      <circle cx="6" cy="19" r="2"/>
      <circle cx="18" cy="19" r="2"/>
      <path d="M8 19h8"/>
      <path d="M12 9v2M11 10h2"/>
    </svg>
  ),
  trailer: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="14" height="8" rx="1"/>
      <circle cx="8" cy="19" r="2"/>
      <circle cx="14" cy="19" r="2"/>
      <path d="M2 14h2M18 12h4"/>
    </svg>
  ),
  compressor: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="8" width="12" height="10" rx="2"/>
      <circle cx="10" cy="13" r="3"/>
      <path d="M16 11h4l1 2v5h-5"/>
      <path d="M6 18v2M14 18v2"/>
    </svg>
  ),
  pump: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="14" r="5"/>
      <circle cx="12" cy="14" r="2"/>
      <path d="M12 9V5M9 5h6"/>
      <path d="M7 14H3M21 14h-4"/>
      <path d="M12 19v2"/>
    </svg>
  ),
  default: (c) => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 6l-8 8h4v4h8v-4h4z"/>
    </svg>
  ),
}

const TYPE_NAME_MAP = {
  'vehicle': 'vehicle',
  'adt': 'adt',
  'bulldozer': 'bulldozer',
  'crane': 'crane',
  'drill': 'drill',
  'excavator': 'excavator',
  'forklift': 'forklift',
  'loader': 'forklift',
  'grader': 'grader',
  'generator': 'generator',
  'water bowser': 'water_bowser',
  'fuel bowser': 'fuel_bowser',
  'trailer': 'trailer',
  'compressor': 'compressor',
  'pump': 'pump',
  'dumptruck': 'adt',
  'tipper': 'adt',
  'other': 'default',
}

export default function FleetAssetIcon({ typeName, size = 42, color }) {
  const c = color || THEME.primary
  const key = TYPE_NAME_MAP[(typeName || '').toLowerCase()] || 'default'
  const renderIcon = ICONS[key] || ICONS.default

  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28, flexShrink: 0,
      background: c + '14',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {renderIcon(c)}
    </div>
  )
}
