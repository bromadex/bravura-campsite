// ── Transaction codes (SAP-style T-codes) ─────────────────────────────────────
// Every function in the ERP has a short typed code. Type it into the global
// command bar (⌘K / Ctrl+K) and press Enter to jump straight there — no menu
// navigation. Codes are stable: once someone has learned FU07, it must keep
// meaning Fuel Issuance forever, so treat this file as append-only.
//
// Scheme: two-letter module prefix + two digits, grouped so related screens
// sit in adjacent numbers. ALIASES adds mnemonic shortcuts for the handful of
// screens operators hit many times a day.

export const TXN_CODES = [
  // ── Meals (ME) ────────────────────────────────────────────────────────────
  { code: 'ME01', path: '/meals/meals_dashboard',      label: 'Meals Dashboard',        module: 'meals' },
  { code: 'ME02', path: '/meals/meals_entry',          label: 'Daily Meal Entry',       module: 'meals' },
  { code: 'ME03', path: '/meals/meals_approvals',      label: 'Meal Approvals',         module: 'meals' },
  { code: 'ME04', path: '/meals/meals_kitchen',        label: 'Kitchen Verify',         module: 'meals' },
  { code: 'ME05', path: '/meals/meals_flags',          label: 'Flags & Queries',        module: 'meals' },
  { code: 'ME06', path: '/meals/meals_forecasts',      label: 'Meal Forecast',          module: 'meals' },
  { code: 'ME10', path: '/meals/meals_daily',          label: 'Meals Daily Report',     module: 'meals' },
  { code: 'ME11', path: '/meals/meals_range',          label: 'Meals Range Report',     module: 'meals' },
  { code: 'ME12', path: '/meals/meals_monthly',        label: 'Meals Monthly Report',   module: 'meals' },
  { code: 'ME13', path: '/meals/meals_billing',        label: 'Meals Billing',          module: 'meals' },
  { code: 'ME14', path: '/meals/meals_finance_export', label: 'Meals Finance Export',   module: 'meals' },
  { code: 'ME20', path: '/meals/meals_providers',      label: 'Meal Providers',         module: 'meals' },
  { code: 'ME21', path: '/meals/meals_pricing',        label: 'Meal Pricing',           module: 'meals' },
  { code: 'ME22', path: '/meals/meals_settings',       label: 'Meals Settings',         module: 'meals' },

  // ── Fuel (FU) ─────────────────────────────────────────────────────────────
  { code: 'FU01', path: '/fuel/fuel_dashboard',           label: 'Fuel Dashboard',        module: 'fuel' },
  { code: 'FU02', path: '/fuel/fuel_tanks',               label: 'Fuel Tanks',            module: 'fuel' },
  { code: 'FU03', path: '/fuel/fuel_receipts',            label: 'Tank Deliveries',       module: 'fuel' },
  { code: 'FU04', path: '/fuel/fuel_dips',                label: 'Dipstick Log',          module: 'fuel' },
  { code: 'FU05', path: '/fuel/fuel_requests_list',       label: 'Fuel Requests',         module: 'fuel' },
  { code: 'FU06', path: '/fuel/fuel_request_form',        label: 'Request Fuel',          module: 'fuel' },
  { code: 'FU07', path: '/fuel/fuel_issuance',            label: 'Fuel Issuance',         module: 'fuel' },
  { code: 'FU08', path: '/fuel/fuel_issues',              label: 'Issuance History',      module: 'fuel' },
  { code: 'FU09', path: '/fuel/fuel_transactions',        label: 'Fuel Transactions',     module: 'fuel' },
  { code: 'FU10', path: '/fuel/fuel_reconciliation',      label: 'Fuel Reconciliation',   module: 'fuel' },
  { code: 'FU11', path: '/fuel/fuel_vehicle_consumption', label: 'Vehicle Consumption',   module: 'fuel' },
  { code: 'FU12', path: '/fuel/fuel_forecasting',         label: 'Fuel Forecasting',      module: 'fuel' },
  { code: 'FU13', path: '/fuel/fuel_reports',             label: 'Fuel Reports',          module: 'fuel' },
  { code: 'FU14', path: '/fuel/fuel_report_variance',     label: 'Variance Report',       module: 'fuel' },
  { code: 'FU15', path: '/fuel/fuel_cost_allocation',     label: 'Cost Allocation',       module: 'fuel' },
  { code: 'FU16', path: '/fuel/fuel_finance_export',      label: 'Fuel Finance Export',   module: 'fuel' },
  { code: 'FU17', path: '/fuel/fuel_shift_report',        label: 'Shift Report',          module: 'fuel' },
  { code: 'FU18', path: '/fuel/fuel_bowsers',             label: 'Bowser Dispatch',       module: 'fuel' },
  { code: 'FU20', path: '/fuel/fuel_settings',            label: 'Fuel Settings',         module: 'fuel' },

  // ── Fleet (FL) ────────────────────────────────────────────────────────────
  { code: 'FL01', path: '/fleet/fleet_dashboard',      label: 'Fleet Dashboard',        module: 'fleet' },
  { code: 'FL02', path: '/fleet/fleet_vehicles',       label: 'Fleet Vehicles',         module: 'fleet' },
  { code: 'FL03', path: '/fleet/fleet_equipment',      label: 'Heavy Equipment',        module: 'fleet' },
  { code: 'FL04', path: '/fleet/fleet_generators',     label: 'Generators',             module: 'fleet' },
  { code: 'FL05', path: '/fleet/fleet_assets',         label: 'All Fleet Assets',       module: 'fleet' },
  { code: 'FL06', path: '/fleet/fleet_dispatch',       label: 'Dispatch Board',         module: 'fleet' },
  { code: 'FL07', path: '/fleet/fleet_assignments',    label: 'Fleet Assignments',      module: 'fleet' },
  { code: 'FL08', path: '/fleet/fleet_inspections',    label: 'Fleet Inspections',      module: 'fleet' },
  { code: 'FL09', path: '/fleet/fleet_trips',          label: 'Trip Logs',              module: 'fleet' },
  { code: 'FL10', path: '/fleet/fleet_drivers',        label: 'Drivers',                module: 'fleet' },
  { code: 'FL11', path: '/fleet/fleet_meter_readings', label: 'Meter Readings',         module: 'fleet' },
  { code: 'FL12', path: '/fleet/fleet_maintenance',    label: 'Fleet Maintenance',      module: 'fleet' },
  { code: 'FL13', path: '/fleet/fleet_tyres',          label: 'Tyres',                  module: 'fleet' },
  { code: 'FL14', path: '/fleet/fleet_compliance',     label: 'Fleet Compliance',       module: 'fleet' },
  { code: 'FL15', path: '/fleet/fleet_accidents',      label: 'Accidents',              module: 'fleet' },
  { code: 'FL16', path: '/fleet/fleet_contractors',    label: 'Contractor Equipment',   module: 'fleet' },
  { code: 'FL17', path: '/fleet/fleet_reports',        label: 'Fleet Reports',          module: 'fleet' },
  { code: 'FL18', path: '/fleet/fleet_settings',       label: 'Fleet Settings',         module: 'fleet' },

  // ── Campsite (CA) ─────────────────────────────────────────────────────────
  { code: 'CA01', path: '/campsite/camp_headcount',   label: 'Camp Headcount',          module: 'campsite' },
  { code: 'CA02', path: '/campsite/camp_floorplan',   label: 'Camp Visual Layout',      module: 'campsite' },
  { code: 'CA03', path: '/campsite/camp_assignments', label: 'Room Assignments',        module: 'campsite' },
  { code: 'CA04', path: '/campsite/camp_rooms',       label: 'Rooms',                   module: 'campsite' },
  { code: 'CA05', path: '/campsite/camp_blocks',      label: 'Blocks',                  module: 'campsite' },
  { code: 'CA06', path: '/campsite/camp_supplies',    label: 'Camp Supplies',           module: 'campsite' },
  { code: 'CA07', path: '/campsite/camp_transfers',   label: 'Stock Transfers',         module: 'campsite' },
  { code: 'CA08', path: '/campsite/camp_occ_report',  label: 'Occupancy Reports',       module: 'campsite' },

  // ── HR / Workforce (HR) ───────────────────────────────────────────────────
  { code: 'HR01', path: '/workforce/wf_employees',     label: 'Employees',           module: 'workforce' },
  { code: 'HR02', path: '/workforce/wf_contractors',   label: 'Contractors',         module: 'workforce' },
  { code: 'HR03', path: '/workforce/wf_leave',         label: 'Leave Management',    module: 'workforce' },
  { code: 'HR04', path: '/workforce/wf_reports',       label: 'Employee Reports',    module: 'workforce' },
  { code: 'HR05', path: '/workforce/wf_dashboard',     label: 'HR Dashboard',        module: 'workforce' },
  { code: 'HR06', path: '/workforce/wf_departments',   label: 'Departments',         module: 'workforce' },
  { code: 'HR07', path: '/workforce/wf_designations',  label: 'Designations',        module: 'workforce' },
  { code: 'HR08', path: '/workforce/wf_employee_form', label: 'New Employee',        module: 'workforce' },
  { code: 'HR09', path: '/workforce/wf_settings',      label: 'HR Settings',         module: 'workforce' },
  { code: 'HR10', path: '/workforce/wf_leave_requests',    label: 'Leave Requests',       module: 'workforce' },
  { code: 'HR11', path: '/workforce/wf_leave_calendar',    label: 'Leave Calendar',       module: 'workforce' },
  { code: 'HR12', path: '/workforce/wf_leave_allocations', label: 'Leave Allocations',    module: 'workforce' },
  { code: 'HR13', path: '/workforce/wf_leave_types',       label: 'Leave Types',          module: 'workforce' },
  { code: 'HR14', path: '/workforce/wf_org_chart',         label: 'Org Chart',            module: 'workforce' },
  { code: 'HR15', path: '/workforce/wf_transfers',         label: 'Site Transfers',       module: 'workforce' },
  { code: 'HR16', path: '/workforce/wf_leave_balances',    label: 'Leave Balance Report', module: 'workforce' },
  // Phase 3: Attendance, Training, Reports
  { code: 'HR17', path: '/workforce/wf_shifts',              label: 'Shift Management',     module: 'workforce' },
  { code: 'HR18', path: '/workforce/wf_attendance',          label: 'Attendance Log',       module: 'workforce' },
  { code: 'HR19', path: '/workforce/wf_training',            label: 'Training Programs',    module: 'workforce' },
  { code: 'HR20', path: '/workforce/wf_skills',              label: 'Skills Matrix',        module: 'workforce' },
  { code: 'HR21', path: '/workforce/wf_headcount_report',    label: 'Headcount Report',     module: 'workforce' },
  { code: 'HR22', path: '/workforce/wf_leave_report',        label: 'Leave Report',         module: 'workforce' },
  { code: 'HR23', path: '/workforce/wf_turnover_report',     label: 'Turnover Report',      module: 'workforce' },
  { code: 'HR24', path: '/workforce/wf_attendance_report',   label: 'Attendance Report',    module: 'workforce' },
  // Phase 4: Payroll, Performance, Disciplinary, Exit
  { code: 'HR25', path: '/workforce/wf_salary_grades',       label: 'Salary Grades',        module: 'workforce' },
  { code: 'HR26', path: '/workforce/wf_salary_components',   label: 'Salary Components',    module: 'workforce' },
  { code: 'HR27', path: '/workforce/wf_payroll',             label: 'Payroll Run',          module: 'workforce' },
  { code: 'HR28', path: '/workforce/wf_salary_slips',        label: 'Salary Slips',         module: 'workforce' },
  { code: 'HR29', path: '/workforce/wf_appraisals',          label: 'Appraisals',           module: 'workforce' },
  { code: 'HR30', path: '/workforce/wf_disciplinary',        label: 'Disciplinary Cases',   module: 'workforce' },
  { code: 'HR31', path: '/workforce/wf_exit',                label: 'Exit Management',      module: 'workforce' },

  // ── Admin (AD) ────────────────────────────────────────────────────────────
  { code: 'AD01', path: '/admin/admin_users', label: 'Users & Roles', module: 'admin' },
  { code: 'AD02', path: '/admin/admin_audit', label: 'Audit Log',     module: 'admin' },

  // ── Procurement (PR) / Feedback (FB) ──────────────────────────────────────
  { code: 'PR01', path: '/procurement/proc_suppliers', label: 'Suppliers',         module: 'procurement' },
  { code: 'FB01', path: '/feedback/feedback_board',    label: 'Feedback Board',    module: 'feedback' },
  { code: 'FB02', path: '/feedback/feedback_help',     label: 'Quick Start Guide', module: 'feedback' },
]

// Mnemonic shortcuts for the highest-frequency screens. An alias resolves to
// the same entry as its target code.
export const ALIASES = {
  ISS:  'FU07',   // issue fuel
  DIP:  'FU04',   // dipstick log
  TANK: 'FU02',
  REQ:  'FU05',
  ENTRY:'ME02',   // daily meal entry
  BILL: 'ME13',
  KIT:  'ME04',
  DISP: 'FL06',   // dispatch board
  EMP:  'HR01',
  LEAVE:'HR10',   // leave requests
  HELP: 'FB02',   // quick start guide
}

// Resolve typed input to a single exact entry (code or alias), else null.
export function resolveCode(input) {
  const q = (input || '').trim().toUpperCase()
  if (!q) return null
  const target = ALIASES[q] || q
  return TXN_CODES.find(t => t.code === target) || null
}

// Fuzzy search over codes + labels for the palette list.
export function searchCodes(input) {
  const q = (input || '').trim().toUpperCase()
  if (!q) return TXN_CODES
  return TXN_CODES.filter(t =>
    t.code.startsWith(q) ||
    t.label.toUpperCase().includes(q) ||
    t.module.toUpperCase().startsWith(q) ||
    Object.keys(ALIASES).some(a => a.startsWith(q) && ALIASES[a] === t.code)
  )
}
