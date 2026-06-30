// ─── Bravura Design System ──────────────────────────────────────────────────
// Colour values below are CSS variable references, not literal hex codes —
// defined for both light and dark in index.html, anchored to the real logo
// colour (#982329, sampled directly from the logo file) rather than picked
// by eye. Every existing page that already does `background: THEME.primary`
// etc. becomes theme-aware automatically through this one change, with zero
// changes needed to the pages themselves — the browser resolves the CSS
// variable to whichever theme is currently active via the data-theme
// attribute on <html>.
export const THEME = {
  primary:      'var(--color-primary)',
  primaryDark:  'var(--color-primary-dark)',
  primaryLight: 'var(--color-primary-light)',
  primaryHover: 'var(--color-primary-hover)',
  onPrimary:    'var(--color-on-primary)',
  accent:       'var(--color-accent)',
  accentDark:   'var(--color-accent-dark)',
  accentLight:  'var(--color-accent-light)',
  surface:      'var(--color-surface)',
  surfaceVar:   'var(--color-surface-variant)',
  surfaceHover: 'var(--color-surface-hover)',
  outline:      'var(--color-outline)',
  outlineVar:   'var(--color-outline-variant)',
  sidebar:      'var(--color-sidebar)',
  sidebarMid:   'var(--color-sidebar-mid)',
  activeBar:    'var(--color-active-bar)',
  bg:           'var(--color-bg)',
  text:         'var(--color-text)',
  textMed:      'var(--color-text-medium)',
  textLow:      'var(--color-text-low)',
  error:        'var(--color-error)',
  success:      'var(--color-success)',
  warning:      'var(--color-warning)',
  info:         'var(--color-info)',
  breakfastClr: 'var(--color-breakfast)',
  lunchClr:     'var(--color-lunch)',
  supperClr:    'var(--color-supper)',
  // Semantic status tint pairs — used by StatusBadge and anywhere else that
  // needs a "soft background + matching text" treatment. Six reusable pairs
  // instead of nine-plus ad-hoc hex combinations repeated per status value.
  statusSuccessBg:   'var(--status-success-bg)',   statusSuccessText:   'var(--status-success-text)',
  statusWarningBg:   'var(--status-warning-bg)',   statusWarningText:   'var(--status-warning-text)',
  statusErrorBg:     'var(--status-error-bg)',     statusErrorText:     'var(--status-error-text)',
  statusNeutralBg:   'var(--status-neutral-bg)',   statusNeutralText:   'var(--status-neutral-text)',
  statusInfoBg:      'var(--status-info-bg)',      statusInfoText:      'var(--status-info-text)',
  statusTertiaryBg:  'var(--status-tertiary-bg)',  statusTertiaryText:  'var(--status-tertiary-text)',
  shadow1: 'var(--shadow-1)',
  shadow2: 'var(--shadow-2)',
  shadow3: 'var(--shadow-3)',
}

// ─── Spacing scale — 4px base unit, standard across the app ──────────────────
// Theme-independent (spacing doesn't change between light/dark), so these
// are plain values, not CSS variables. Established now for Phase C to
// consume page by page — not yet retrofitted into every existing inline
// style, which would be the page-by-page work itself, not the foundation.
export const SPACING = {
  xs: '4px', sm: '8px', md: '12px', lg: '16px',
  xl: '20px', xxl: '24px', xxxl: '32px',
}

// ─── Border radius scale ──────────────────────────────────────────────────────
export const RADIUS = {
  sm: '8px', md: '12px', lg: '16px', xl: '20px', pill: '999px',
}

// ─── Typography scale ─────────────────────────────────────────────────────────
export const TYPE = {
  fontFamily: "'Google Sans', 'Segoe UI', Arial, sans-serif",
  xs: { size: '11px', weight: 500 },
  sm: { size: '13px', weight: 500 },
  base: { size: '14px', weight: 400 },
  lg: { size: '16px', weight: 500 },
  title: { size: '22px', weight: 400 },
  display: { size: '28px', weight: 300 },
}

// ─── Module accent colours (match dashboard card style) ───────────────────────
export const MODULE_COLORS = {
  workforce: '#E07B39',  // warm orange  – HR/people feel
  campsite:  '#2A9D8F',  // teal         – outdoors/camp
  meals:     '#982329',  // maroon       – food/dining, matches the real logo anchor colour
  admin:     '#5C6BC0',  // indigo       – system/administration, distinct from the 3 business modules
  fuel:      '#D97706',  // amber        – petroleum/fuel association
  fleet:     '#1A6B52',  // green        – fleet/transport
}

// ─── Role definitions ─────────────────────────────────────────────────────────
export const ROLE_LABELS = {
  super_admin:   'Super Admin',
  meal_officer:  'Meal Officer',
  approver:      'Approver',
  kitchen:       'Kitchen',
  kitchen_owner: 'Kitchen Owner',
}

// ─── Module access ────────────────────────────────────────────────────────────
export const moduleAccess = {
  // All authenticated users can see Workforce & Campsite
  workforce: r => !!r,
  campsite:  r => !!r,
  // Meals: swapped to real RBAC alongside the PIN gate removal — every page
  // inside Meals is now permission-gated, so the module tile should use the
  // same single source of truth rather than a separate hardcoded role list.
  // Camp Supervisor (old 'approver') loses the tile too — consistent, not a
  // new narrowing, since they'd already lost every meaningful action inside
  // Meals in the page-level swap.
  meals:     (role, can) => can ? can('meals.view') : false,
  // Administration is new code — gated by REAL RBAC from the start, not the
  // legacy role string. Signature is (role, can) so the same .access(role, can)
  // call works for every module; the three above simply ignore the extra arg.
  admin:     (role, can) => can ? can('users.view') : false,
  // Fuel Management — gated by fuel.view from the start.
  fuel:      (role, can) => can ? can('fuel.view') : false,
  // Fleet Management — all authenticated users can access; vehicle registry is
  // not sensitive operational data and is useful across roles.
  fleet:     r => !!r,
}

// ─── Per-module nav definitions ───────────────────────────────────────────────
export function workforceNav(role) {
  return [
    { id: 'wf_employees',   label: 'Employees',        section: 'People',  icon: 'badge' },
    { id: 'wf_contractors', label: 'Contractors',      section: 'People',  icon: 'business' },
    { id: 'wf_leave',       label: 'Leave Management', section: 'People',  icon: 'flight_takeoff' },
    { id: 'wf_reports',     label: 'Employee Reports', section: 'Reports', icon: 'bar_chart' },
  ].filter(item => item.show !== false)
}

export function campsiteNav(role) {
  return [
    { id: 'camp_headcount',   label: 'Headcount',        section: 'Overview',    icon: 'people_alt' },
    { id: 'camp_floorplan',   label: 'Visual Layout',     section: 'Management',  icon: 'view_in_ar' },
    { id: 'camp_assignments', label: 'Room Assignments',  section: 'Management',  icon: 'assignment_ind' },
    { id: 'camp_rooms',       label: 'Rooms',            section: 'Management',  icon: 'meeting_room' },
    { id: 'camp_blocks',      label: 'Blocks',           section: 'Management',  icon: 'domain' },
    { id: 'camp_supplies',    label: 'Camp Supplies',    section: 'Management',  icon: 'inventory_2' },
    { id: 'camp_transfers',   label: 'Stock Transfers',  section: 'Management',  icon: 'sync_alt' },
    { id: 'camp_occ_report',  label: 'Occupancy Reports',section: 'Reports',     icon: 'analytics' },
  ]
}

export function mealsNav(role, can) {
  // Matches exactly the same permission codes already used for the actual
  // page routes in App.jsx's getMealsPage — nav visibility and real access
  // were quietly out of sync until now, since this function was never
  // converted during the original RBAC swap even though every page route
  // underneath it was.
  const all = [
    { id: 'meals_dashboard', label: 'Dashboard',         section: 'Main',    icon: 'dashboard' },
    { id: 'meals_entry',     label: 'Daily Meal Entry',  section: 'Main',    icon: 'edit_note',   show: can('meals.create') },
    { id: 'meals_approvals', label: 'Approvals',         section: 'Main',    icon: 'task_alt',    show: can('meals.approve') },
    { id: 'meals_kitchen',   label: 'Kitchen Verify',    section: 'Main',    icon: 'restaurant',  show: can('meals.edit') },
    { id: 'meals_flags',     label: 'Flags & Queries',   section: 'Main',    icon: 'flag',        show: can('meals.view') },
    { id: 'meals_daily',     label: 'Daily Report',      section: 'Reports', icon: 'today',       show: can('meals.view') },
    { id: 'meals_range',     label: 'Range Report',      section: 'Reports', icon: 'date_range',  show: can('meals.view') },
    { id: 'meals_monthly',   label: 'Monthly Report',    section: 'Reports', icon: 'bar_chart',   show: can('meals.view') },
    { id: 'meals_billing',   label: 'Billing',           section: 'Reports', icon: 'receipt_long',show: can('meals.approve') },
    { id: 'meals_providers', label: 'Meal Providers',    section: 'Admin',   icon: 'storefront',  show: can('meals.edit') },
    { id: 'meals_pricing',   label: 'Pricing Management',section: 'Admin',   icon: 'sell',        show: can('meals.edit') },
    { id: 'meals_settings',  label: 'Settings',          section: 'Admin',   icon: 'settings',    show: can('meals.delete') },
  ]
  return all.filter(item => item.show !== false)
}

export function adminNav(role) {
  return [
    { id: 'admin_users', label: 'Users & Roles', section: 'Administration', icon: 'manage_accounts' },
    { id: 'admin_audit',  label: 'Audit Log',     section: 'Administration', icon: 'history' },
  ]
}

export function fuelNav(role, can) {
  return [
    { id: 'fuel_dashboard', label: 'Dashboard',        section: 'Overview',     icon: 'dashboard' },
    { id: 'fuel_ledger',    label: 'Fuel Ledger',       section: 'Overview',     icon: 'receipt_long' },
    { id: 'fuel_receipts',  label: 'Fuel Deliveries',  section: 'Records',      icon: 'local_gas_station', show: can('fuel.create') },
    { id: 'fuel_issuance',  label: 'Fuel Issuance',    section: 'Records',      icon: 'output',            show: can('fuel.create') },
    { id: 'fuel_issues',        label: 'Issuance History',   section: 'Records',  icon: 'history',       show: can('fuel.view') },
    { id: 'fuel_transactions',  label: 'All Transactions',   section: 'Records',  icon: 'receipt_long',  show: can('fuel.view') },
    { id: 'fuel_dips',      label: 'Dip Readings',     section: 'Records',      icon: 'straighten',        show: can('fuel.create') },
    { id: 'fuel_reports',   label: 'Reports',          section: 'Reports',      icon: 'bar_chart',         show: can('fuel.view') },
    { id: 'fuel_tanks',     label: 'Tanks',            section: 'Assets',       icon: 'propane_tank',      show: can('fuel.view') },
    { id: 'fuel_types',     label: 'Fuel Types',       section: 'Admin',        icon: 'oil_barrel',        show: can('fuel.edit') },
  ].filter(item => item.show !== false)
}

export function fleetNav(role, can) {
  return [
    { id: 'fleet_dashboard', label: 'Dashboard',   section: 'Overview',  icon: 'dashboard' },
    { id: 'fleet_vehicles',  label: 'Vehicles',    section: 'Registry',  icon: 'directions_car' },
    { id: 'fleet_equipment', label: 'Equipment',   section: 'Registry',  icon: 'construction' },
    { id: 'fleet_operators', label: 'Operators',   section: 'Registry',  icon: 'badge' },
  ]
}
