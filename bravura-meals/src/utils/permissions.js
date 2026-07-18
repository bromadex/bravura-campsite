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
  fleet:       '#1A6B52',  // green        – fleet/transport
  procurement: '#7C3AED',  // violet       – purchasing/supply chain
  feedback:    '#6B7280',  // slate        – neutral, "system meta" feel
  contractors: '#0D7377',  // deep teal    – external workforce/contracts
  inventory:   '#B45309',  // amber-brown  – warehouses/stock
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
  // Procurement — gated by procurement.view
  procurement: (role, can) => can ? can('procurement.view') : false,
  // Contract & Contractor Management — gated by contractors.view
  contractors: (role, can) => can ? can('contractors.view') : false,
  // Feedback — always open to any signed-in user. This is where the whole
  // organisation reports bugs, gaps, and suggestions during the build phase.
  inventory: (role, can) => can ? can('inventory.view') : false,
  feedback:  r => !!r,
}

// ─── Feedback nav ─────────────────────────────────────────────────────────────
export function feedbackNav() {
  return [
    { id: 'feedback_board', label: 'Feedback Board', section: 'Overview', icon: 'forum' },
    { id: 'feedback_help',  label: 'Quick Start Guide', section: 'Help',  icon: 'help' },
  ]
}

// ─── Per-module nav definitions ───────────────────────────────────────────────
export function workforceNav(role) {
  return [
    { id: 'wf_dashboard',    label: 'HR Dashboard',     section: 'Overview',     icon: 'dashboard' },
    { id: 'wf_employees',   label: 'Employees',        section: 'People',  icon: 'badge' },
    { id: 'wf_transfers',    label: 'Site Reassignment', section: 'People',  icon: 'swap_horiz' },
    { id: 'wf_leave_requests',    label: 'Leave Requests',    section: 'Leave', icon: 'event_available' },
    { id: 'wf_leave_calendar',    label: 'Leave Calendar',    section: 'Leave', icon: 'calendar_month' },
    { id: 'wf_leave_allocations', label: 'Leave Allocations', section: 'Leave', icon: 'pie_chart' },
    { id: 'wf_leave_types',       label: 'Leave Types',       section: 'Leave', icon: 'category' },
    { id: 'wf_departments',  label: 'Departments',      section: 'Organisation', icon: 'domain' },
    { id: 'wf_designations', label: 'Designations',     section: 'Organisation', icon: 'military_tech' },
    { id: 'wf_org_chart',    label: 'Org Chart',        section: 'Organisation', icon: 'account_tree' },
    { id: 'wf_shifts',       label: 'Shift Management', section: 'Attendance', icon: 'schedule' },
    { id: 'wf_attendance',   label: 'Attendance Log',   section: 'Attendance', icon: 'fact_check' },
    { id: 'wf_training',     label: 'Training Programs',section: 'Training',   icon: 'school' },
    { id: 'wf_skills',       label: 'Skills Matrix',    section: 'Training',   icon: 'psychology' },
    { id: 'wf_medicals',        label: 'Medical Surveillance', section: 'Compliance', icon: 'medical_services' },
    { id: 'wf_document_expiry', label: 'Document Expiry',      section: 'Compliance', icon: 'event_busy' },
    { id: 'wf_salary_grades',     label: 'Salary Grades',     section: 'Payroll', icon: 'payments' },
    { id: 'wf_salary_components', label: 'Salary Components', section: 'Payroll', icon: 'tune' },
    { id: 'wf_payroll',           label: 'Payroll Run',       section: 'Payroll', icon: 'calculate' },
    { id: 'wf_salary_slips',      label: 'Salary Slips',      section: 'Payroll', icon: 'receipt' },
    { id: 'wf_appraisals',   label: 'Appraisals',       section: 'Performance', icon: 'star_rate' },
    { id: 'wf_disciplinary', label: 'Disciplinary',     section: 'Performance', icon: 'gavel' },
    { id: 'wf_exit',         label: 'Exit Management',  section: 'Performance', icon: 'exit_to_app' },
    { id: 'wf_leave_balances', label: 'Leave Balances', section: 'Reports', icon: 'summarize' },
    { id: 'wf_headcount_report',  label: 'Headcount Report',  section: 'Reports', icon: 'people' },
    { id: 'wf_leave_report',      label: 'Leave Report',      section: 'Reports', icon: 'flight_takeoff' },
    { id: 'wf_turnover_report',   label: 'Turnover Report',   section: 'Reports', icon: 'trending_down' },
    { id: 'wf_attendance_report', label: 'Attendance Report', section: 'Reports', icon: 'event_available' },
    { id: 'wf_settings',     label: 'HR Settings',      section: 'Admin',        icon: 'settings' },
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
    { id: 'camp_transfers',   label: 'Site Reassignment', section: 'Management',  icon: 'swap_horiz' },
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
    { id: 'meals_forecasts', label: 'Meal Forecast',     section: 'Main',    icon: 'insights',    show: can('meals.create') },
    { id: 'meals_entry',     label: 'Daily Meal Entry',  section: 'Main',    icon: 'edit_note',   show: can('meals.create') },
    { id: 'meals_approvals', label: 'Approvals',         section: 'Main',    icon: 'task_alt',    show: can('meals.approve') },
    { id: 'meals_kitchen',   label: 'Kitchen Verify',    section: 'Main',    icon: 'restaurant',  show: can('meals.edit') },
    { id: 'meals_flags',     label: 'Flags & Queries',   section: 'Main',    icon: 'flag',        show: can('meals.view') },
    { id: 'meals_daily',     label: 'Daily Report',      section: 'Reports', icon: 'today',       show: can('meals.view') },
    { id: 'meals_range',     label: 'Range Report',      section: 'Reports', icon: 'date_range',  show: can('meals.view') },
    { id: 'meals_monthly',   label: 'Monthly Report',    section: 'Reports', icon: 'bar_chart',   show: can('meals.view') },
{ id: 'meals_billing',   label: 'Billing',           section: 'Reports', icon: 'receipt_long',show: can('meals.approve') },
    { id: 'meals_finance_export', label: 'Finance Export', section: 'Reports', icon: 'account_balance', show: false },
    { id: 'meals_providers', label: 'Meal Providers',    section: 'Admin',   icon: 'storefront',  show: can('meals.edit') },
    { id: 'meals_pricing',   label: 'Pricing Management',section: 'Admin',   icon: 'sell',        show: can('meals.edit') },
    { id: 'meals_settings',  label: 'Settings',          section: 'Admin',   icon: 'settings',    show: can('meals.delete') },
  ]
  return all.filter(item => item.show !== false)
}

export function adminNav(role) {
  return [
    { id: 'admin_preferences', label: 'My Preferences',       section: 'Personal',        icon: 'person' },
    { id: 'admin_dashboard',   label: 'Dashboard',            section: 'Overview',        icon: 'dashboard' },
    { id: 'admin_users',       label: 'Users & Roles',        section: 'Access Control',  icon: 'manage_accounts' },
    { id: 'admin_roles',       label: 'Role Management',      section: 'Access Control',  icon: 'shield_person' },
    { id: 'admin_permissions', label: 'Permissions',           section: 'Access Control',  icon: 'verified_user' },
    { id: 'admin_sites',       label: 'Site Management',      section: 'System',          icon: 'location_city' },
    { id: 'admin_invitations', label: 'Pending Invitations',  section: 'System',          icon: 'mail' },
    { id: 'admin_settings',    label: 'System Settings',      section: 'System',          icon: 'settings' },
    { id: 'admin_audit',       label: 'Audit Log',            section: 'System',          icon: 'history' },
  ]
}

export function fuelNav(role, can) {
  return [
    // Grouped like the old Bravura ERP fuel module:
    // Tank Management → Fuel Operations → Analytics & Reports → Admin
    { id: 'fuel_dashboard',    label: 'Dashboard',          section: 'Overview', icon: 'dashboard' },
    { id: 'fuel_tanks',         label: 'Fuel Tanks',         section: 'Tank Management', icon: 'water',             show: can('fuel.view')   },
    { id: 'fuel_receipts',      label: 'Tank Deliveries',    section: 'Tank Management', icon: 'local_shipping',    show: can('fuel.create') },
    { id: 'fuel_dips',          label: 'Dipstick Log',       section: 'Tank Management', icon: 'straighten',        show: can('fuel.create') },
    // Request form is reachable via the "New Request" button on the Fuel Requests list — no need for a separate nav item
    { id: 'fuel_request_form',  label: 'Request Fuel',       section: 'Fuel Operations', icon: 'send',              show: false },
    { id: 'fuel_requests_list', label: 'Fuel Requests',      section: 'Fuel Operations', icon: 'assignment',        show: can('fuel.view')   },
    { id: 'fuel_issuance',      label: 'Fuel Issuance',      section: 'Fuel Operations', icon: 'local_gas_station', show: can('fuel.create') },
    { id: 'fuel_issues',        label: 'Issuance History',   section: 'Fuel Operations', icon: 'history',           show: can('fuel.view') },
    { id: 'fuel_transactions',  label: 'Transactions',       section: 'Fuel Operations', icon: 'receipt_long',      show: can('fuel.view')   },
    { id: 'fuel_bowsers',       label: 'Bowser Dispatch',    section: 'Fuel Operations', icon: 'rv_hookup',         show: false },
    { id: 'fuel_shift_report',  label: 'Shift Report',       section: 'Fuel Operations', icon: 'summarize',         show: false },
    { id: 'fuel_reconciliation',      label: 'Reconciliation',      section: 'Analytics & Reports', icon: 'balance',           show: can('fuel.create') },
    { id: 'fuel_vehicle_consumption', label: 'Vehicle Consumption', section: 'Analytics & Reports', icon: 'speed',             show: can('fuel.view') },
    { id: 'fuel_forecasting',         label: 'Forecasting',         section: 'Analytics & Reports', icon: 'trending_up',       show: can('fuel.view') },
    { id: 'fuel_reports',             label: 'Fuel Reports',        section: 'Analytics & Reports', icon: 'bar_chart',         show: can('fuel.view') },
    { id: 'fuel_report_daily',        label: 'Daily Transactions',  section: 'Analytics & Reports', icon: 'today',             show: false },
    { id: 'fuel_report_monthly',      label: 'Monthly Consumption', section: 'Analytics & Reports', icon: 'calendar_month',    show: false },
    { id: 'fuel_report_deliveries',   label: 'Delivery Report',     section: 'Analytics & Reports', icon: 'local_shipping',    show: false },
    { id: 'fuel_report_variance',     label: 'Variance Report',     section: 'Analytics & Reports', icon: 'compare_arrows',    show: can('fuel.view') },
    { id: 'fuel_cost_allocation',     label: 'Cost Allocation',     section: 'Analytics & Reports', icon: 'account_balance',   show: can('fuel.view') },
    { id: 'fuel_finance_export',      label: 'Finance Export',      section: 'Analytics & Reports', icon: 'receipt_long',      show: false },
    { id: 'fuel_types',        label: 'Fuel Types',         section: 'Admin',    icon: 'oil_barrel',        show: false },
    { id: 'fuel_settings',     label: 'Fuel Settings',      section: 'Admin',    icon: 'settings',          show: can('fuel.edit') },
  ].filter(item => item.show !== false)
}

export function procurementNav(role, can) {
  return [
    { id: 'proc_dashboard', label: 'Dashboard',  section: 'Overview',   icon: 'dashboard',      show: can('procurement.view') },
    { id: 'proc_suppliers', label: 'Suppliers',   section: 'Registry',   icon: 'business',       show: can('procurement.view') },
    { id: 'proc_rfqs',      label: 'RFQs',        section: 'Purchasing', icon: 'request_quote',  show: can('procurement.view') },
    { id: 'proc_orders',    label: 'Orders',      section: 'Purchasing', icon: 'shopping_cart',  show: can('procurement.view') },
    { id: 'proc_tracking',  label: 'Tracking',    section: 'Logistics',  icon: 'local_shipping', show: can('procurement.view') },
    { id: 'proc_reports',   label: 'Reports',     section: 'Analytics',  icon: 'bar_chart',      show: can('procurement.view') },
  ].filter(item => item.show !== false)
}

export function contractorsNav(role, can) {
  return [
    { id: 'cl_dashboard',            label: 'Dashboard',           section: 'Overview',     icon: 'dashboard' },
    { id: 'cl_companies',            label: 'Contractor Companies',section: 'Contractors',  icon: 'business' },
    { id: 'cl_contracts',            label: 'Contracts',           section: 'Contractors',  icon: 'description' },
    { id: 'cl_casual_workers',       label: 'Casual Workers',      section: 'Contractors',  icon: 'engineering' },
    { id: 'cl_contractor_employees', label: 'Contractor Employees',section: 'Contractors',  icon: 'group' },
    { id: 'cl_timesheets',           label: 'Timesheets',          section: 'Operations',   icon: 'schedule' },
    { id: 'cl_hired_vehicles',       label: 'Hired Vehicles',      section: 'Operations',   icon: 'local_shipping' },
    { id: 'cl_hired_equipment',      label: 'Hired Equipment',     section: 'Operations',   icon: 'construction' },
    { id: 'cl_cost_dashboard',       label: 'Cost Dashboard',      section: 'Costs',        icon: 'payments' },
    { id: 'cl_reports',              label: 'Reports',             section: 'Reports',      icon: 'bar_chart' },
    { id: 'cl_settings',             label: 'Settings',            section: 'Admin',        icon: 'settings' },
  ]
}

export function fleetNav(role, can) {
  return [
    { id: 'fleet_dashboard',   label: 'Dashboard',       section: 'Overview',     icon: 'dashboard' },
    { id: 'fleet_vehicles',    label: 'Vehicles',        section: 'Registry',     icon: 'directions_car' },
    { id: 'fleet_equipment',   label: 'Heavy Equipment', section: 'Registry',     icon: 'construction' },
    { id: 'fleet_generators',  label: 'Generators',      section: 'Registry',     icon: 'bolt' },
    { id: 'fleet_assets',      label: 'All Assets',      section: 'Registry',     icon: 'inventory_2' },
    { id: 'fleet_assignments', label: 'Assignments',     section: 'Operations',   icon: 'assignment_ind' },
    { id: 'fleet_inspections', label: 'Inspections',     section: 'Operations',   icon: 'checklist' },
    { id: 'fleet_trips',       label: 'Trip Logs',       section: 'Operations',   icon: 'route' },
    { id: 'fleet_maintenance', label: 'Maintenance',     section: 'Maintenance',  icon: 'build' },
    { id: 'fleet_compliance',  label: 'Compliance',      section: 'Compliance',   icon: 'verified_user' },
    { id: 'fleet_drivers',     label: 'Drivers',         section: 'Operations',   icon: 'badge' },
    { id: 'fleet_meter_readings', label: 'Meter Readings', section: 'Operations', icon: 'speed' },
    { id: 'fleet_accidents',   label: 'Accidents',       section: 'Safety',       icon: 'car_crash' },
    { id: 'fleet_tyres',      label: 'Tyres',            section: 'Maintenance',  icon: 'tire_repair' },
    { id: 'fleet_dispatch',   label: 'Dispatch Board',   section: 'Operations',   icon: 'hub' },
    { id: 'fleet_contractors', label: 'Contractor Equipment', section: 'Registry', icon: 'handshake' },
    { id: 'fleet_reports',     label: 'Reports',         section: 'Reports',      icon: 'bar_chart' },
    { id: 'fleet_settings',    label: 'Settings',        section: 'Admin',        icon: 'settings' },
  ]
}

export function inventoryNav(role, can) {
  return [
    { id: 'inv_dashboard',    label: 'Dashboard',          section: 'Overview',   icon: 'dashboard' },
    { id: 'inv_items',        label: 'Items',              section: 'Catalogue',  icon: 'category' },
    { id: 'inv_categories',   label: 'Categories & UoM',   section: 'Catalogue',  icon: 'account_tree' },
    { id: 'inv_warehouses',   label: 'Warehouses',         section: 'Warehouse',  icon: 'warehouse' },
    { id: 'inv_balances',     label: 'Stock Balances',     section: 'Warehouse',  icon: 'inventory' },
    { id: 'inv_grn',          label: 'Goods Received',     section: 'Operations', icon: 'move_to_inbox' },
    { id: 'inv_issues',       label: 'Issues & Returns',   section: 'Operations', icon: 'outbox' },
    { id: 'inv_site_moves',   label: 'Site Reassignment',  section: 'Operations', icon: 'swap_horiz' },
    { id: 'inv_adjustments',  label: 'Adjustments',        section: 'Operations', icon: 'tune' },
    { id: 'inv_ledger',       label: 'Stock Ledger',       section: 'Reports',    icon: 'menu_book' },
    { id: 'inv_reports',      label: 'Reports',            section: 'Reports',    icon: 'bar_chart' },
    { id: 'inv_stock_take',    label: 'Stock Take',         section: 'Operations', icon: 'fact_check' },
    { id: 'inv_requisitions',  label: 'Requisitions',       section: 'Purchasing', icon: 'request_quote' },
    { id: 'inv_purchase_orders', label: 'Purchase Orders',  section: 'Purchasing', icon: 'shopping_cart' },
    { id: 'inv_settings',     label: 'Settings',           section: 'Admin',      icon: 'settings' },
  ]
}
