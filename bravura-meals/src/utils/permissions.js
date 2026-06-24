// ─── MD3 Bravura Theme ────────────────────────────────────────────────────────
export const THEME = {
  primary:      '#9C2A2A',
  primaryDark:  '#7B1A1A',
  primaryLight: '#C0504D',
  onPrimary:    '#FFFFFF',
  surface:      '#FFFBFA',
  surfaceVar:   '#F5EDEE',
  outline:      '#D4B8B8',
  outlineVar:   '#ECD8D8',
  sidebar:      '#2D1515',
  sidebarMid:   '#3D1E1E',
  activeBar:    '#F4A896',
  bg:           '#FAF5F5',
  text:         '#1C0A0A',
  textMed:      '#5C3C3C',
  textLow:      '#9E8080',
  error:        '#B3261E',
  success:      '#386A20',
  warning:      '#7D5700',
  info:         '#1558A6',
  breakfastClr: '#BF5400',
  lunchClr:     '#1A6B52',
  supperClr:    '#4A3C8C',
}

// ─── Module accent colours (match ERP card style) ─────────────────────────────
export const MODULE_COLORS = {
  workforce: '#E07B39',  // warm orange  – HR/people feel
  campsite:  '#2A9D8F',  // teal         – outdoors/camp
  meals:     '#9C2A2A',  // maroon       – food/dining
}

// ─── Role definitions ─────────────────────────────────────────────────────────
export const ROLES = {
  SUPER_ADMIN:   'super_admin',
  MEAL_OFFICER:  'meal_officer',
  APPROVER:      'approver',
  KITCHEN:       'kitchen',
  KITCHEN_OWNER: 'kitchen_owner',
}

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
  // Meals requires specific roles (separate PIN gate enforced in UI)
  meals:     r => ['super_admin','meal_officer','approver','kitchen','kitchen_owner'].includes(r),
}

// ─── Permission helpers ───────────────────────────────────────────────────────
export const can = {
  // Meals
  enterMeals:        r => ['super_admin','meal_officer'].includes(r),
  editApproved:      r => ['super_admin'].includes(r),
  editSubmitted:     r => ['super_admin','approver'].includes(r),
  editDraft:         r => ['super_admin','meal_officer'].includes(r),
  submitForApproval: r => ['super_admin','meal_officer'].includes(r),
  approveDay:        r => ['super_admin','approver'].includes(r),
  confirmCounts:     r => ['super_admin','kitchen'].includes(r),
  raiseFlag:         r => ['super_admin','kitchen'].includes(r),
  resolveFlag:       r => ['super_admin','approver'].includes(r),
  seeCosts:          r => ['super_admin','approver','kitchen_owner'].includes(r),
  setPrices:         r => ['super_admin','kitchen_owner'].includes(r),
  manageSettings:    r => ['super_admin'].includes(r),
  seeReports:        r => ['super_admin','meal_officer','approver','kitchen_owner'].includes(r),
  // Workforce / shared
  manageEmployees:   r => ['super_admin','meal_officer','approver'].includes(r),
  deleteEmployee:    r => ['super_admin','meal_officer','approver'].includes(r),
  manageContractors: r => ['super_admin','meal_officer','approver'].includes(r),
  // Campsite
  manageCampsite:    r => ['super_admin','approver','meal_officer'].includes(r),
  viewCampsite:      r => !!r,
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
    { id: 'camp_assignments', label: 'Room Assignments',  section: 'Management',  icon: 'assignment_ind' },
    { id: 'camp_rooms',       label: 'Rooms',            section: 'Management',  icon: 'meeting_room' },
    { id: 'camp_blocks',      label: 'Blocks',           section: 'Management',  icon: 'domain' },
    { id: 'camp_supplies',    label: 'Camp Supplies',    section: 'Management',  icon: 'inventory_2' },
    { id: 'camp_occ_report',  label: 'Occupancy Reports',section: 'Reports',     icon: 'analytics' },
  ]
}

export function mealsNav(role) {
  const all = [
    { id: 'meals_dashboard', label: 'Dashboard',         section: 'Main',    icon: 'dashboard' },
    { id: 'meals_entry',     label: 'Daily Meal Entry',  section: 'Main',    icon: 'edit_note',   show: can.enterMeals(role) },
    { id: 'meals_approvals', label: 'Approvals',         section: 'Main',    icon: 'task_alt',    show: can.approveDay(role) },
    { id: 'meals_kitchen',   label: 'Kitchen Verify',    section: 'Main',    icon: 'restaurant',  show: can.confirmCounts(role) },
    { id: 'meals_flags',     label: 'Flags & Queries',   section: 'Main',    icon: 'flag',        show: can.raiseFlag(role) || can.resolveFlag(role) },
    { id: 'meals_daily',     label: 'Daily Report',      section: 'Reports', icon: 'today',       show: can.seeReports(role) },
    { id: 'meals_range',     label: 'Range Report',      section: 'Reports', icon: 'date_range',  show: can.seeReports(role) },
    { id: 'meals_monthly',   label: 'Monthly Report',    section: 'Reports', icon: 'bar_chart',   show: can.seeReports(role) },
    { id: 'meals_billing',   label: 'Billing',           section: 'Reports', icon: 'receipt_long',show: can.seeCosts(role) },
    { id: 'meals_pricing',   label: 'Pricing Management',section: 'Admin',   icon: 'sell',        show: can.setPrices(role) },
    { id: 'meals_settings',  label: 'Settings',          section: 'Admin',   icon: 'settings',    show: can.manageSettings(role) },
  ]
  return all.filter(item => item.show !== false)
}
