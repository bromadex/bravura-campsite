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
  finance:     '#1565C0',  // blue         – finance/accounting
  projects:    '#1B5E20',  // deep green   – project management
  concrete:    '#EF6C00',  // deep orange  – concrete/batch plant
  sheq:        '#D32F2F',  // red          – safety/health/environment/quality
  dept:        '#37474F',  // blue-grey    – department workspaces
  governance:  '#6D4C41',  // brown        – governance/policy
  connect:     '#00838F',  // cyan         – messaging/connect
  notifications: '#FF6F00', // amber       – alerts/notifications
  docshare:      '#4527A0', // deep purple – document management
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
// Order follows business cycle: Finance → Procurement → Inventory → Fuel →
// Fleet → HR → Contractors → Departments → Campsite → Meals → Concrete →
// Projects, then Admin, Feedback.
export const moduleAccess = {
  finance:      r => !!r,
  procurement:  (role, can) => can ? can('procurement.view') : false,
  inventory:    (role, can) => can ? can('inventory.view') : false,
  fuel:         (role, can) => can ? can('fuel.view') : false,
  fleet:        r => !!r,
  workforce:    r => !!r,
  contractors:  (role, can) => can ? can('contractors.view') : false,
  dept:         (role, can) => can ? can('dept.view') : false,
  campsite:     r => !!r,
  meals:        (role, can) => can ? can('meals.view') : false,
  concrete:     (role, can) => can ? can('concrete.view') : false,
  sheq:         r => !!r,
  projects:     (role, can) => can ? can('projects.view') : false,
  admin:        (role, can) => can ? can('users.view') : false,
  governance:   (role, can) => can ? can('governance.view') : false,
  connect:      (role, can) => can ? can('connect.view') : false,
  notifications: r => !!r,
  docshare:     (role, can) => can ? can('ds.view') : false,
  feedback:     r => !!r,
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
    { id: 'wf_statutory',         label: 'Statutory Returns', section: 'Payroll', icon: 'account_balance' },
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
    { id: 'admin_approval_routes', label: 'Approval Routes',  section: 'System',          icon: 'alt_route' },
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

export function financeNav(role, can) {
  return [
    { id: 'fi_dashboard',         label: 'Dashboard',         section: 'Overview',       icon: 'dashboard' },
    { id: 'fi_chart_of_accounts', label: 'Chart of Accounts', section: 'General Ledger', icon: 'account_balance' },
    { id: 'fi_journal_entries',   label: 'Journal Entries',   section: 'General Ledger', icon: 'receipt_long' },
    { id: 'fi_posting_rules',     label: 'Posting Rules',     section: 'General Ledger', icon: 'rule' },
    { id: 'fi_bank_accounts',     label: 'Bank Accounts',     section: 'Banking',        icon: 'account_balance_wallet' },
    { id: 'fi_trial_balance',     label: 'Trial Balance',     section: 'Reports',        icon: 'balance' },
    { id: 'fi_profit_and_loss',   label: 'Profit & Loss',     section: 'Reports',        icon: 'trending_up' },
    { id: 'fi_balance_sheet',     label: 'Balance Sheet',     section: 'Reports',        icon: 'account_tree' },
    { id: 'fi_cash_flow',         label: 'Cash Flow',         section: 'Reports',        icon: 'water_drop' },
    { id: 'fi_cost_centres',      label: 'Cost Centres',      section: 'Cost Tracking',  icon: 'category' },
    { id: 'fi_cost_report',       label: 'Cost Centre Report',section: 'Cost Tracking',  icon: 'bar_chart' },
  ]
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

export function projectsNav(role, can) {
  return [
    { id: 'pj_dashboard',     label: 'Dashboard',      section: 'Overview',         icon: 'dashboard' },
    { id: 'pj_projects',      label: 'Projects',       section: 'Projects',         icon: 'folder_open' },
    { id: 'pj_tasks',         label: 'My Tasks',       section: 'Projects',         icon: 'task_alt' },
    { id: 'pj_timeline',      label: 'Timeline',       section: 'Projects',         icon: 'timeline' },
    { id: 'pj_documents',     label: 'Documents',      section: 'Document Control', icon: 'description' },
    { id: 'pj_costs',         label: 'Costs & EVM',    section: 'Cost Management',  icon: 'payments' },
    { id: 'pj_changes',       label: 'Change Orders',  section: 'Cost Management',  icon: 'swap_horiz' },
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

export function concreteNav(role, can) {
  return [
    { id: 'co_dashboard',       label: 'Dashboard',          section: 'Overview',    icon: 'dashboard' },
    { id: 'co_mix_designs',     label: 'Mix Designs',        section: 'Production',  icon: 'science' },
    { id: 'co_batches',         label: 'Batches',            section: 'Production',  icon: 'factory' },
    { id: 'co_cement',          label: 'Cement Inventory',   section: 'Inventory',   icon: 'inventory' },
    { id: 'co_aggregates',      label: 'Aggregate Inventory',section: 'Inventory',   icon: 'layers' },
    { id: 'co_cube_tests',      label: 'Cube Tests',         section: 'Quality',     icon: 'verified' },
    { id: 'co_project_costing', label: 'Project Costing',    section: 'Reports',     icon: 'request_quote' },
    { id: 'co_settings',        label: 'Settings',           section: 'Admin',       icon: 'settings' },
  ]
}

export function sheqNav(role, can) {
  return [
    { id: 'sq_dashboard',      label: 'Dashboard',           section: 'Overview',       icon: 'dashboard' },
    { id: 'sq_incidents',      label: 'Incidents',           section: 'Safety',         icon: 'warning' },
    { id: 'sq_hazards',        label: 'Hazard Reports',      section: 'Safety',         icon: 'report_problem' },
    { id: 'sq_observations',   label: 'Safety Observations', section: 'Safety',         icon: 'visibility' },
    { id: 'sq_capa',           label: 'CAPA',                section: 'Actions',        icon: 'task_alt' },
    { id: 'sq_risk_register',  label: 'Risk Register',       section: 'Risk',           icon: 'shield' },
    { id: 'sq_risk_assessments', label: 'Risk Assessments',  section: 'Risk',           icon: 'assignment' },
    { id: 'sq_permits',        label: 'Permit to Work',      section: 'Permits',        icon: 'description' },
    { id: 'sq_ptw_board',      label: 'PTW Board',           section: 'Permits',        icon: 'view_kanban' },
    { id: 'sq_loto',           label: 'LOTO Register',       section: 'Permits',        icon: 'lock' },
    { id: 'sq_risk_matrix',    label: 'Risk Matrix',         section: 'Admin',          icon: 'grid_on' },
    { id: 'sq_inspections',    label: 'Inspections',         section: 'Inspections',    icon: 'checklist' },
    { id: 'sq_templates',      label: 'Templates',           section: 'Inspections',    icon: 'list_alt' },
    { id: 'sq_audits',         label: 'Audits',              section: 'Audits',         icon: 'verified' },
    { id: 'sq_audit_findings', label: 'Audit Findings',      section: 'Audits',         icon: 'find_in_page' },
    { id: 'sq_calendar',       label: 'SHEQ Calendar',       section: 'Audits',         icon: 'calendar_month' },
    { id: 'sq_training',       label: 'Training Matrix',     section: 'Training',       icon: 'school' },
    { id: 'sq_medical',        label: 'Medical Fitness',     section: 'Training',       icon: 'medical_services' },
    { id: 'sq_toolbox',        label: 'Toolbox Talks',       section: 'Training',       icon: 'record_voice_over' },
    { id: 'sq_emp_profile',    label: 'Employee Profile',    section: 'Training',       icon: 'badge' },
    { id: 'sq_inductions',     label: 'Inductions',          section: 'Training',       icon: 'how_to_reg' },
    { id: 'sq_environmental',  label: 'Environmental',       section: 'Environment',    icon: 'eco' },
    { id: 'sq_waste',          label: 'Waste Management',    section: 'Environment',    icon: 'delete_sweep' },
    { id: 'sq_spills',         label: 'Spill Management',    section: 'Environment',    icon: 'water_drop' },
    { id: 'sq_env_monitoring', label: 'Env Monitoring',      section: 'Environment',    icon: 'monitor_heart' },
    { id: 'sq_ppe',            label: 'PPE Register',        section: 'PPE',            icon: 'health_and_safety' },
    { id: 'sq_resources',      label: 'Resource Consumption', section: 'Environment',   icon: 'bolt' },
    { id: 'sq_legal',              label: 'Legal Register',        section: 'Compliance',     icon: 'gavel' },
    { id: 'sq_doc_control',        label: 'Document Control',      section: 'Compliance',     icon: 'folder_managed' },
    { id: 'sq_contractor_compliance', label: 'Contractor Compliance', section: 'Compliance',  icon: 'engineering' },
    { id: 'sq_emergency_plans',    label: 'Emergency Plans',       section: 'Emergency',      icon: 'emergency' },
    { id: 'sq_emergency_drills',   label: 'Emergency Drills',      section: 'Emergency',      icon: 'fire_truck' },
    { id: 'sq_mgmt_review',       label: 'Management Review',     section: 'Management',     icon: 'supervisor_account' },
    { id: 'sq_analytics',         label: 'SHEQ Analytics',        section: 'Reports',        icon: 'analytics' },
    { id: 'sq_reports',        label: 'Reports',             section: 'Reports',        icon: 'bar_chart' },
    { id: 'sq_settings',       label: 'Settings',            section: 'Admin',          icon: 'settings' },
  ]
}

export function deptNav(role, can) {
  return [
    { id: 'dept_dashboard',      label: 'Dashboard',       section: 'Overview',   icon: 'dashboard' },
    { id: 'dept_projects',       label: 'Projects',        section: 'Projects',   icon: 'folder_open' },
    { id: 'dept_templates',      label: 'Templates',       section: 'Projects',   icon: 'content_copy' },
    { id: 'dept_costs',          label: 'Cost Tracker',    section: 'Finance',    icon: 'account_balance' },
    { id: 'dept_approvals',      label: 'Approvals',       section: 'Finance',    icon: 'verified' },
    { id: 'dept_documents',      label: 'Documents',       section: 'Resources',  icon: 'description' },
    { id: 'dept_team',           label: 'Team',            section: 'Resources',  icon: 'group' },
    { id: 'dept_notifications',  label: 'Overdue Tasks',   section: 'Resources',  icon: 'notifications_active' },
    { id: 'dept_import',         label: 'Import Tasks',    section: 'Admin',      icon: 'upload' },
    { id: 'dept_settings',       label: 'Settings',        section: 'Admin',      icon: 'settings' },
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

export function governanceNav(role, can) {
  return [
    { id: 'gov_announcements', label: 'Announcements',        section: 'Documents', icon: 'campaign' },
    { id: 'gov_policies',      label: 'Policies & Compliance', section: 'Documents', icon: 'policy' },
  ]
}

export function connectNav(role, can) {
  return [
    { id: 'connect_chat', label: 'Bravura Connect', section: 'Messaging', icon: 'chat' },
  ]
}

export function notificationsNav(role, can) {
  return [
    { id: 'notification_center', label: 'Notification Center', section: 'Overview', icon: 'notifications' },
    { id: 'approvals_inbox',     label: 'Approvals',           section: 'Overview', icon: 'approval' },
    { id: 'my_preferences',      label: 'My Preferences',      section: 'Personal', icon: 'tune' },
  ]
}

export function docshareNav(role, can) {
  return [
    { id: 'ds_library',          label: 'Document Library',     section: 'Documents', icon: 'folder_shared' },
    { id: 'ds_detail',           label: 'Document Detail',      section: 'Documents', icon: 'description' },
    { id: 'ds_acknowledgements', label: 'My Acknowledgements',  section: 'Documents', icon: 'task_alt' },
    { id: 'ds_compliance',       label: 'Compliance Dashboard', section: 'Reports',   icon: 'verified' },
    { id: 'ds_reports',          label: 'Document Reports',     section: 'Reports',   icon: 'summarize' },
    { id: 'ds_settings',         label: 'Settings',             section: 'Admin',     icon: 'settings' },
  ]
}
