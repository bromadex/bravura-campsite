// ─── Theme colours (dark maroon) ────────────────────────────────────────────
export const THEME = {
  primary:     '#6B1C1C',   // dark maroon
  primaryDark: '#4A1010',
  primaryLight:'#8B3A3A',
  accent:      '#C0392B',
  accentLight: '#E74C3C',
  sidebar:     '#3D0C0C',
  sidebarDark: '#2A0808',
  activeBar:   '#E8A87C',
  bg:          '#F7F2F2',
  cardBorder:  '#E8D5D5',
  badgeBg:     '#F5DDD D',
  badgeColor:  '#6B1C1C',
}

// ─── Role definitions ────────────────────────────────────────────────────────
export const ROLES = {
  SUPER_ADMIN:    'super_admin',
  MEAL_OFFICER:   'meal_officer',
  APPROVER:       'approver',
  KITCHEN:        'kitchen',
  KITCHEN_OWNER:  'kitchen_owner',
}

export const ROLE_LABELS = {
  super_admin:   'Super Admin',
  meal_officer:  'Meal Officer',
  approver:      'Approver',
  kitchen:       'Kitchen',
  kitchen_owner: 'Kitchen Owner',
}

// ─── Permission helpers ──────────────────────────────────────────────────────
export const can = {
  // Data entry
  enterMeals:        (role) => ['super_admin','meal_officer'].includes(role),
  editApproved:      (role) => ['super_admin'].includes(role),
  editSubmitted:     (role) => ['super_admin','approver'].includes(role),
  editDraft:         (role) => ['super_admin','meal_officer'].includes(role),

  // Employees
  manageEmployees:   (role) => ['super_admin','meal_officer','approver'].includes(role),
  deleteEmployee:    (role) => ['super_admin','meal_officer','approver'].includes(role),

  // Contractors
  manageContractors: (role) => ['super_admin','meal_officer','approver'].includes(role),

  // Approval workflow
  submitForApproval: (role) => ['super_admin','meal_officer'].includes(role),
  approveDay:        (role) => ['super_admin','approver'].includes(role),

  // Kitchen
  confirmCounts:     (role) => ['super_admin','kitchen'].includes(role),
  raiseFlag:         (role) => ['super_admin','kitchen'].includes(role),
  resolveFlag:       (role) => ['super_admin','approver'].includes(role),

  // Costs / billing
  seeCosts:          (role) => ['super_admin','approver','kitchen_owner'].includes(role),
  setPrices:         (role) => ['super_admin','kitchen_owner'].includes(role),

  // Settings
  manageSettings:    (role) => ['super_admin'].includes(role),

  // Reports
  seeReports:        (role) => ['super_admin','meal_officer','approver','kitchen_owner'].includes(role),
}

// ─── Nav items per role ──────────────────────────────────────────────────────
export function navItemsForRole(role) {
  const all = [
    { id: 'dashboard',    label: 'Dashboard',        section: 'Main',    icon: 'grid' },
    { id: 'entry',        label: 'Daily Entry',       section: 'Main',    icon: 'edit',         show: can.enterMeals(role) },
    { id: 'approvals',    label: 'Approvals',         section: 'Main',    icon: 'check-circle', show: can.approveDay(role) },
    { id: 'kitchen',      label: 'Kitchen Confirm',   section: 'Main',    icon: 'utensils',     show: can.confirmCounts(role) },
    { id: 'daily',        label: 'Daily Report',      section: 'Reports', icon: 'calendar',     show: can.seeReports(role) },
    { id: 'range',        label: 'Range Report',      section: 'Reports', icon: 'bar-chart',    show: can.seeReports(role) },
    { id: 'monthly',      label: 'Monthly Report',    section: 'Reports', icon: 'trending-up',  show: can.seeReports(role) },
    { id: 'billing',      label: 'Billing',           section: 'Reports', icon: 'dollar-sign',  show: can.seeCosts(role) },
    { id: 'employees',    label: 'Employees',         section: 'Admin',   icon: 'users',        show: can.manageEmployees(role) },
    { id: 'contractors',  label: 'Contractors',       section: 'Admin',   icon: 'building',     show: can.manageContractors(role) },
    { id: 'pricing',      label: 'Meal Pricing',      section: 'Admin',   icon: 'tag',          show: can.setPrices(role) },
    { id: 'flags',        label: 'Flags / Queries',   section: 'Admin',   icon: 'flag',         show: can.raiseFlag(role) || can.resolveFlag(role) },
    { id: 'settings',     label: 'Settings',          section: 'Admin',   icon: 'settings',     show: can.manageSettings(role) },
  ]
  return all.filter(item => item.show !== false)
}
