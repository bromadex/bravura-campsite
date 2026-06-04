// ─── Material Design 3 – Bravura Theme ───────────────────────────────────────
// Primary: warm burgundy/wine (not as dark as before)
export const THEME = {
  primary:      '#9C2A2A',   // wine red – MD3 primary
  primaryDark:  '#7B1A1A',
  primaryLight: '#C0504D',
  onPrimary:    '#FFFFFF',
  surface:      '#FFFBFA',   // off-white surface
  surfaceVar:   '#F5EDEE',   // tinted surface
  outline:      '#D4B8B8',   // border / divider
  outlineVar:   '#ECD8D8',
  sidebar:      '#2D1515',   // deep wine sidebar
  sidebarMid:   '#3D1E1E',
  activeBar:    '#F4A896',   // warm coral indicator
  bg:           '#FAF5F5',   // page background
  text:         '#1C0A0A',   // high-emphasis text
  textMed:      '#5C3C3C',   // medium emphasis
  textLow:      '#9E8080',   // disabled / placeholder
  error:        '#B3261E',
  success:      '#386A20',
  warning:      '#7D5700',
  info:         '#1558A6',
  breakfastClr: '#BF5400',
  lunchClr:     '#1A6B52',
  supperClr:    '#4A3C8C',
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

// ─── Permission helpers ───────────────────────────────────────────────────────
export const can = {
  enterMeals:        r => ['super_admin','meal_officer'].includes(r),
  editApproved:      r => ['super_admin'].includes(r),
  editSubmitted:     r => ['super_admin','approver'].includes(r),
  editDraft:         r => ['super_admin','meal_officer'].includes(r),
  manageEmployees:   r => ['super_admin','meal_officer','approver'].includes(r),
  deleteEmployee:    r => ['super_admin','meal_officer','approver'].includes(r),
  manageContractors: r => ['super_admin','meal_officer','approver'].includes(r),
  submitForApproval: r => ['super_admin','meal_officer'].includes(r),
  approveDay:        r => ['super_admin','approver'].includes(r),
  confirmCounts:     r => ['super_admin','kitchen'].includes(r),
  raiseFlag:         r => ['super_admin','kitchen'].includes(r),
  resolveFlag:       r => ['super_admin','approver'].includes(r),
  seeCosts:          r => ['super_admin','approver','kitchen_owner'].includes(r),
  setPrices:         r => ['super_admin','kitchen_owner'].includes(r),
  manageSettings:    r => ['super_admin'].includes(r),
  seeReports:        r => ['super_admin','meal_officer','approver','kitchen_owner'].includes(r),
}

// ─── Nav items ────────────────────────────────────────────────────────────────
export function navItemsForRole(role) {
  const all = [
    { id: 'dashboard',   label: 'Dashboard',       section: 'Main',    icon: 'dashboard' },
    { id: 'entry',       label: 'Daily Entry',      section: 'Main',    icon: 'edit_note',         show: can.enterMeals(role) },
    { id: 'approvals',   label: 'Approvals',        section: 'Main',    icon: 'task_alt',           show: can.approveDay(role) },
    { id: 'kitchen',     label: 'Kitchen Confirm',  section: 'Main',    icon: 'restaurant',         show: can.confirmCounts(role) },
    { id: 'daily',       label: 'Daily Report',     section: 'Reports', icon: 'today',              show: can.seeReports(role) },
    { id: 'range',       label: 'Range Report',     section: 'Reports', icon: 'date_range',         show: can.seeReports(role) },
    { id: 'monthly',     label: 'Monthly Report',   section: 'Reports', icon: 'bar_chart',          show: can.seeReports(role) },
    { id: 'billing',     label: 'Billing',          section: 'Reports', icon: 'receipt_long',       show: can.seeCosts(role) },
    { id: 'employees',   label: 'Employees',        section: 'Admin',   icon: 'people',             show: can.manageEmployees(role) },
    { id: 'contractors', label: 'Contractors',      section: 'Admin',   icon: 'business',           show: can.manageContractors(role) },
    { id: 'pricing',     label: 'Meal Pricing',     section: 'Admin',   icon: 'sell',               show: can.setPrices(role) },
    { id: 'flags',       label: 'Flags & Queries',  section: 'Admin',   icon: 'flag',               show: can.raiseFlag(role) || can.resolveFlag(role) },
    { id: 'settings',    label: 'Settings',         section: 'Admin',   icon: 'settings',           show: can.manageSettings(role) },
  ]
  return all.filter(item => item.show !== false)
}
