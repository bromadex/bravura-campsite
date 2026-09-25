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
  { code: 'ME14', path: '/meals/meals_finance_export', label: 'Meals Finance Export (retired)', module: 'meals' },
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
  { code: 'FU16', path: '/fuel/fuel_finance_export',      label: 'Fuel Finance Export (retired)', module: 'fuel' },
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
  { code: 'FL19', path: '/fleet/fleet_preventive',     label: 'Preventive Maintenance & Downtime', module: 'fleet' },

  // ── Campsite (CA) ─────────────────────────────────────────────────────────
  { code: 'CA01', path: '/campsite/camp_headcount',   label: 'Camp Headcount',          module: 'campsite' },
  { code: 'CA02', path: '/campsite/camp_floorplan',   label: 'Camp Visual Layout',      module: 'campsite' },
  { code: 'CA03', path: '/campsite/camp_assignments', label: 'Room Assignments',        module: 'campsite' },
  { code: 'CA04', path: '/campsite/camp_rooms',       label: 'Rooms',                   module: 'campsite' },
  { code: 'CA05', path: '/campsite/camp_blocks',      label: 'Blocks',                  module: 'campsite' },
  { code: 'CA06', path: '/campsite/camp_supplies',    label: 'Camp Supplies',           module: 'campsite' },
  { code: 'CA07', path: '/campsite/camp_transfers',   label: 'Site Reassignment',       module: 'campsite' },
  { code: 'CA08', path: '/campsite/camp_occ_report',  label: 'Occupancy Reports',       module: 'campsite' },
  { code: 'CA09', path: '/campsite/camp_faults',      label: 'Room Faults',             module: 'campsite' },

  // ── HR / Workforce (HR) ───────────────────────────────────────────────────
  { code: 'HR01', path: '/workforce/wf_employees',     label: 'Employees',           module: 'workforce' },
  { code: 'HR02', path: '/workforce/wf_contractors',   label: 'Contractors (moved to CL02)', module: 'workforce' },
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
  { code: 'HR15', path: '/workforce/wf_transfers',         label: 'Site Reassignment',    module: 'workforce' },
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
  { code: 'HR32', path: '/workforce/wf_medicals',            label: 'Medical Surveillance', module: 'workforce' },
  { code: 'HR33', path: '/workforce/wf_document_expiry',     label: 'Document Expiry',      module: 'workforce' },
  { code: 'HR34', path: '/workforce/wf_ppe',                 label: 'PPE Tracking',         module: 'workforce' },
  // Phase 5: Analytics
  { code: 'HR35', path: '/workforce/wf_analytics',            label: 'HR Analytics',         module: 'workforce' },
  { code: 'HR36', path: '/workforce/wf_statutory',            label: 'Statutory Returns',    module: 'workforce' },
  { code: 'HR37', path: '/workforce/wf_detail_changes',       label: 'Employee Detail Changes', module: 'workforce' },
  { code: 'HR38', path: '/workforce/wf_salary_advances',      label: 'Salary Advances & Loans', module: 'workforce' },
  { code: 'HR39', path: '/workforce/wf_holidays',             label: 'Public Holidays',      module: 'workforce' },

  // ── Contract & Contractor Management (CL) ──────────────────────────────
  { code: 'CL01', path: '/contractors/cl_dashboard',            label: 'CL Dashboard',         module: 'contractors' },
  { code: 'CL02', path: '/contractors/cl_companies',            label: 'Contractor Companies',  module: 'contractors' },
  { code: 'CL03', path: '/contractors/cl_contracts',            label: 'Contracts',             module: 'contractors' },
  { code: 'CL04', path: '/contractors/cl_casual_workers',       label: 'Casual Workers',        module: 'contractors' },
  { code: 'CL05', path: '/contractors/cl_contractor_employees', label: 'Contractor Employees',  module: 'contractors' },
  { code: 'CL06', path: '/contractors/cl_timesheets',           label: 'Timesheets',            module: 'contractors' },
  { code: 'CL07', path: '/contractors/cl_hired_vehicles',       label: 'Hired Vehicles',        module: 'contractors' },
  { code: 'CL08', path: '/contractors/cl_hired_equipment',      label: 'Hired Equipment',       module: 'contractors' },
  { code: 'CL09', path: '/contractors/cl_cost_dashboard',       label: 'Cost Dashboard',        module: 'contractors' },
  { code: 'CL10', path: '/contractors/cl_reports',              label: 'CL Reports',            module: 'contractors' },
  { code: 'CL11', path: '/contractors/cl_settings',             label: 'CL Settings',           module: 'contractors' },
  { code: 'CL12', path: '/contractors/cl_casual_payroll',      label: 'Casual Payroll',        module: 'contractors' },
  { code: 'CL13', path: '/contractors/cl_equipment_usage',    label: 'Equipment Usage',       module: 'contractors' },

  // ── Projects (PJ) ─────────────────────────────────────────────────────────
  { code: 'PJ01', path: '/projects/pj_dashboard', label: 'Project Dashboard',  module: 'projects' },
  { code: 'PJ02', path: '/projects/pj_projects',  label: 'Project List',       module: 'projects' },
  { code: 'PJ03', path: '/projects/pj_detail',    label: 'Project Detail',     module: 'projects' },
  { code: 'PJ04', path: '/projects/pj_tasks',     label: 'My Tasks',           module: 'projects' },
  { code: 'PJ05', path: '/projects/pj_timeline',  label: 'Project Timeline',   module: 'projects' },
  { code: 'PJ06', path: '/projects/pj_areas',      label: 'Area Codes',         module: 'projects' },
  { code: 'PJ07', path: '/projects/pj_documents',  label: 'Document Register',  module: 'projects' },
  { code: 'PJ08', path: '/projects/pj_transmittals', label: 'Transmittals',      module: 'projects' },
  { code: 'PJ09', path: '/projects/pj_costs',         label: 'Costs & EVM',        module: 'projects' },
  { code: 'PJ10', path: '/projects/pj_changes',       label: 'Change Orders',      module: 'projects' },

  // ── Admin (AD) ────────────────────────────────────────────────────────────
  { code: 'AD01', path: '/admin/admin_dashboard',   label: 'Admin Dashboard',      module: 'admin' },
  { code: 'AD02', path: '/admin/admin_users',       label: 'Users & Roles',        module: 'admin' },
  { code: 'AD03', path: '/admin/admin_roles',       label: 'Role Management',      module: 'admin' },
  { code: 'AD04', path: '/admin/admin_sites',       label: 'Site Management',      module: 'admin' },
  { code: 'AD05', path: '/admin/admin_invitations', label: 'Pending Invitations',  module: 'admin' },
  { code: 'AD06', path: '/admin/admin_settings',    label: 'System Settings',      module: 'admin' },
  { code: 'AD07', path: '/admin/admin_permissions', label: 'Permissions Catalogue', module: 'admin' },
  { code: 'AD08', path: '/admin/admin_audit',       label: 'Audit Log',            module: 'admin' },
  { code: 'AD09', path: '/admin/admin_preferences', label: 'My Preferences',       module: 'admin' },
  { code: 'AD10', path: '/admin/admin_employee_links', label: 'Employee Links',    module: 'admin' },
  { code: 'AD11', path: '/admin/admin_approval_routes', label: 'Approval Routes', module: 'admin' },

  // ── Inventory (IN) ──────────────────────────────────────────────────────
  { code: 'IN01', path: '/inventory/inv_dashboard',   label: 'Inventory Dashboard',  module: 'inventory' },
  { code: 'IN02', path: '/inventory/inv_items',        label: 'Items',                module: 'inventory' },
  { code: 'IN03', path: '/inventory/inv_categories',   label: 'Categories & UoM',     module: 'inventory' },
  { code: 'IN04', path: '/inventory/inv_warehouses',   label: 'Warehouses',           module: 'inventory' },
  { code: 'IN05', path: '/inventory/inv_balances',     label: 'Stock Balances',       module: 'inventory' },
  { code: 'IN06', path: '/inventory/inv_grn',          label: 'Goods Received',       module: 'inventory' },
  { code: 'IN07', path: '/inventory/inv_issues',       label: 'Issues & Returns',     module: 'inventory' },
  { code: 'IN08', path: '/inventory/inv_site_moves',   label: 'Site Reassignment',    module: 'inventory' },
  { code: 'IN09', path: '/inventory/inv_adjustments',  label: 'Adjustments',          module: 'inventory' },
  { code: 'IN10', path: '/inventory/inv_ledger',       label: 'Stock Ledger',         module: 'inventory' },
  { code: 'IN11', path: '/inventory/inv_reports',      label: 'Inventory Reports',    module: 'inventory' },
  { code: 'IN12', path: '/inventory/inv_settings',     label: 'Inventory Settings',   module: 'inventory' },
  { code: 'IN13', path: '/inventory/inv_stock_take',   label: 'Stock Take',           module: 'inventory' },
  { code: 'IN14', path: '/inventory/inv_requisitions', label: 'Purchase Requisitions', module: 'inventory' },
  { code: 'IN15', path: '/inventory/inv_purchase_orders', label: 'Purchase Orders',   module: 'inventory' },
  { code: 'IN16', path: '/inventory/inv_reorder',      label: 'Reorder & Expiry',     module: 'inventory' },

  // ── Department Workspaces (DW) ──────────────────────────────────────────────
  { code: 'DW01', path: '/dept/dept_dashboard',  label: 'Dept Dashboard',     module: 'dept' },
  { code: 'DW02', path: '/dept/dept_projects',   label: 'Dept Projects',      module: 'dept' },
  { code: 'DW03', path: '/dept/dept_board',      label: 'Project Board',      module: 'dept' },
  { code: 'DW04', path: '/dept/dept_grid',       label: 'Project Grid',       module: 'dept' },
  { code: 'DW05', path: '/dept/dept_calendar',   label: 'Project Calendar',   module: 'dept' },
  { code: 'DW06', path: '/dept/dept_charts',     label: 'Project Charts',     module: 'dept' },
  { code: 'DW07', path: '/dept/dept_settings',   label: 'Dept Settings',      module: 'dept' },
  { code: 'DW08', path: '/dept/dept_documents',  label: 'Dept Documents',     module: 'dept' },
  { code: 'DW09', path: '/dept/dept_team',       label: 'Dept Team',          module: 'dept' },
  { code: 'DW10', path: '/dept/dept_costs',      label: 'Dept Cost Tracker',  module: 'dept' },
  { code: 'DW11', path: '/dept/dept_approvals',   label: 'Task Approvals',     module: 'dept' },
  { code: 'DW12', path: '/dept/dept_import',      label: 'Import Tasks',       module: 'dept' },
  { code: 'DW13', path: '/dept/dept_notifications', label: 'Overdue Tasks',    module: 'dept' },
  { code: 'DW14', path: '/dept/dept_templates',   label: 'Project Templates',  module: 'dept' },

  // ── Procurement (PR) / Feedback (FB) ──────────────────────────────────────
  { code: 'PR01', path: '/procurement/proc_dashboard', label: 'Procurement Dashboard', module: 'procurement' },
  { code: 'PR02', path: '/procurement/proc_suppliers', label: 'Suppliers',             module: 'procurement' },
  { code: 'PR03', path: '/procurement/proc_rfqs',      label: 'RFQs',                  module: 'procurement' },
  { code: 'PR04', path: '/procurement/proc_orders',    label: 'Purchase Orders',       module: 'procurement' },
  { code: 'PR05', path: '/procurement/proc_tracking',  label: 'Order Tracking',        module: 'procurement' },
  { code: 'PR06', path: '/procurement/proc_reports',       label: 'Procurement Reports',   module: 'procurement' },
  { code: 'PR07', path: '/procurement/proc_requisitions', label: 'Requisitions',          module: 'procurement' },
  { code: 'PR08', path: '/procurement/proc_grn',          label: 'Goods Received Notes',  module: 'procurement' },
  { code: 'PR09', path: '/procurement/proc_invoices',     label: 'Purchase Invoices',     module: 'procurement' },
  { code: 'PR10', path: '/procurement/proc_rfq_compare',  label: 'Quote Comparison',      module: 'procurement' },
  { code: 'PR11', path: '/procurement/proc_budgets',      label: 'Purchasing Budgets',    module: 'procurement' },
  { code: 'PR12', path: '/procurement/proc_supplier_performance', label: 'Supplier Aging & Scorecards', module: 'procurement' },
  // ── Finance ──
  { code: 'FI01', path: '/finance/fi_chart_of_accounts', label: 'Chart of Accounts',      module: 'finance' },
  { code: 'FI02', path: '/finance/fi_journal_entries',   label: 'Journal Entries',         module: 'finance' },
  { code: 'FI03', path: '/finance/fi_journal_detail',    label: 'Journal Entry Detail',    module: 'finance' },
  { code: 'FI04', path: '/finance/fi_bank_accounts',    label: 'Bank Accounts',           module: 'finance' },
  { code: 'FI05', path: '/finance/fi_reconciliation',   label: 'Bank Reconciliation',     module: 'finance' },
  { code: 'FI06', path: '/finance/fi_trial_balance',   label: 'Trial Balance',           module: 'finance' },
  { code: 'FI07', path: '/finance/fi_profit_and_loss', label: 'Profit & Loss',           module: 'finance' },
  { code: 'FI08', path: '/finance/fi_balance_sheet',   label: 'Balance Sheet',           module: 'finance' },
  { code: 'FI09', path: '/finance/fi_cash_flow',      label: 'Cash Flow Statement',     module: 'finance' },
  { code: 'FI10', path: '/finance/fi_cost_centres',   label: 'Cost Centres',            module: 'finance' },
  { code: 'FI11', path: '/finance/fi_cost_report',    label: 'Cost Centre Report',      module: 'finance' },
  { code: 'FI12', path: '/finance/fi_dashboard',      label: 'Finance Dashboard',       module: 'finance' },
  { code: 'FI13', path: '/finance/fi_posting_rules',  label: 'Posting Rules',           module: 'finance' },
  { code: 'FI14', path: '/finance/fi_expense_claims', label: 'Expense Claims',          module: 'finance' },
  { code: 'FI15', path: '/finance/fi_petty_cash',      label: 'Petty Cash',              module: 'finance' },
  { code: 'FI16', path: '/finance/fi_fixed_assets',    label: 'Fixed Asset Register',    module: 'finance' },
  { code: 'FI17', path: '/finance/fi_asset_depreciation', label: 'Asset Depreciation',   module: 'finance' },
  { code: 'FI18', path: '/finance/fi_asset_verification', label: 'Asset Counts',         module: 'finance' },
  { code: 'FI19', path: '/finance/fi_dimension_report', label: 'Costs by Cost Centre & Project', module: 'finance' },

  // ── Batch Plant Operations ──
  { code: 'CO01', path: '/concrete/co_dashboard',       label: 'Concrete Dashboard',   module: 'concrete' },
  { code: 'CO02', path: '/concrete/co_mix_designs',     label: 'Mix Designs',          module: 'concrete' },
  { code: 'CO03', path: '/concrete/co_batches',         label: 'Concrete Batches',     module: 'concrete' },
  { code: 'CO04', path: '/concrete/co_cement',          label: 'Cement Inventory',     module: 'concrete' },
  { code: 'CO05', path: '/concrete/co_aggregates',      label: 'Aggregate Inventory',  module: 'concrete' },
  { code: 'CO06', path: '/concrete/co_cube_tests',      label: 'Cube Tests',           module: 'concrete' },
  { code: 'CO07', path: '/concrete/co_project_costing', label: 'Project Costing',      module: 'concrete' },
  { code: 'CO08', path: '/concrete/co_settings',        label: 'Batch Plant Settings', module: 'concrete' },

  // ── SHEQ (SQ) ──────────────────────────────────────────────────────────────
  { code: 'SQ01', path: '/sheq/sq_dashboard',     label: 'SHEQ Dashboard',        module: 'sheq' },
  { code: 'SQ02', path: '/sheq/sq_incidents',      label: 'Incidents',             module: 'sheq' },
  { code: 'SQ03', path: '/sheq/sq_hazards',        label: 'Hazard Reports',        module: 'sheq' },
  { code: 'SQ04', path: '/sheq/sq_observations',   label: 'Safety Observations',   module: 'sheq' },
  { code: 'SQ05', path: '/sheq/sq_capa',           label: 'CAPA',                  module: 'sheq' },
  { code: 'SQ06', path: '/sheq/sq_reports',         label: 'SHEQ Reports',          module: 'sheq' },
  { code: 'SQ07', path: '/sheq/sq_settings',        label: 'SHEQ Settings',         module: 'sheq' },
  { code: 'SQ08', path: '/sheq/sq_risk_register',   label: 'Risk Register',         module: 'sheq' },
  { code: 'SQ09', path: '/sheq/sq_risk_assessments', label: 'Risk Assessments',     module: 'sheq' },
  { code: 'SQ10', path: '/sheq/sq_permits',          label: 'Permit to Work',       module: 'sheq' },
  { code: 'SQ11', path: '/sheq/sq_ptw_board',        label: 'PTW Board',            module: 'sheq' },
  { code: 'SQ12', path: '/sheq/sq_loto',             label: 'LOTO Register',        module: 'sheq' },
  { code: 'SQ13', path: '/sheq/sq_risk_matrix',      label: 'Risk Matrix',          module: 'sheq' },
  { code: 'SQ14', path: '/sheq/sq_environmental',    label: 'Environmental Register', module: 'sheq' },
  { code: 'SQ15', path: '/sheq/sq_waste',             label: 'Waste Management',      module: 'sheq' },
  { code: 'SQ16', path: '/sheq/sq_spills',            label: 'Spill Management',      module: 'sheq' },
  { code: 'SQ17', path: '/sheq/sq_env_monitoring',    label: 'Env Monitoring',        module: 'sheq' },
  { code: 'SQ18', path: '/sheq/sq_ppe',               label: 'PPE Register',          module: 'sheq' },
  { code: 'SQ19', path: '/sheq/sq_resources',         label: 'Resource Consumption',  module: 'sheq' },
  { code: 'SQ20', path: '/sheq/sq_inspections',       label: 'Inspections',           module: 'sheq' },
  { code: 'SQ21', path: '/sheq/sq_templates',         label: 'Inspection Templates',  module: 'sheq' },
  { code: 'SQ22', path: '/sheq/sq_audits',            label: 'Audit Programme',       module: 'sheq' },
  { code: 'SQ23', path: '/sheq/sq_audit_findings',    label: 'Audit Findings',        module: 'sheq' },
  { code: 'SQ24', path: '/sheq/sq_calendar',          label: 'SHEQ Calendar',         module: 'sheq' },
  // Phase 4 — Training, Competency & Medical
  { code: 'SQ25', path: '/sheq/sq_training',            label: 'Training Matrix',           module: 'sheq' },
  { code: 'SQ26', path: '/sheq/sq_medical',             label: 'Medical Fitness',           module: 'sheq' },
  { code: 'SQ27', path: '/sheq/sq_toolbox',             label: 'Toolbox Talks',             module: 'sheq' },
  { code: 'SQ28', path: '/sheq/sq_emp_profile',         label: 'Employee SHEQ Profile',     module: 'sheq' },
  { code: 'SQ29', path: '/sheq/sq_inductions',          label: 'Induction Register',        module: 'sheq' },
  // Phase 6 — Compliance, Documents & Contractors
  { code: 'SQ30', path: '/sheq/sq_legal',               label: 'Legal Register',            module: 'sheq' },
  { code: 'SQ31', path: '/sheq/sq_doc_control',         label: 'Document Control',          module: 'sheq' },
  { code: 'SQ32', path: '/sheq/sq_contractor_compliance', label: 'Contractor Compliance',   module: 'sheq' },
  { code: 'SQ33', path: '/sheq/sq_emergency_plans',     label: 'Emergency Plans',           module: 'sheq' },
  { code: 'SQ34', path: '/sheq/sq_emergency_drills',    label: 'Emergency Drills',          module: 'sheq' },
  { code: 'SQ35', path: '/sheq/sq_mgmt_review',         label: 'Management Review',         module: 'sheq' },
  { code: 'SQ36', path: '/sheq/sq_analytics',           label: 'SHEQ Analytics',            module: 'sheq' },

  // ── Governance (GV) ──────────────────────────────────────────────────────
  { code: 'GV01', path: '/governance/gov_announcements',   label: 'Announcements',        module: 'governance' },
  { code: 'GV02', path: '/governance/gov_policies',        label: 'Policies & Compliance', module: 'governance' },

  // ── Bravura Connect (CN) ───────────────────────────────────────────────
  { code: 'CN01', path: '/connect/connect_chat',           label: 'Bravura Connect',      module: 'connect' },

  // ── Notifications (NT) ─────────────────────────────────────────────────
  { code: 'NT01', path: '/notifications/notification_center', label: 'Notification Center', module: 'notifications' },
  { code: 'NT02', path: '/notifications/approvals_inbox', label: 'Approvals Inbox', module: 'notifications' },
  { code: 'NT03', path: '/notifications/my_preferences', label: 'My Preferences', module: 'notifications' },
  { code: 'ES01', path: '/me/me_home',       label: 'My Workspace',  module: 'me' },
  { code: 'ES02', path: '/me/me_payslips',   label: 'My Payslips',   module: 'me' },
  { code: 'ES03', path: '/me/me_leave',      label: 'My Leave',      module: 'me' },
  { code: 'ES04', path: '/me/me_attendance', label: 'My Attendance', module: 'me' },
  { code: 'ES05', path: '/me/me_expenses',   label: 'My Expenses',   module: 'me' },
  { code: 'ES06', path: '/me/me_safety',     label: 'My Safety',     module: 'me' },
  { code: 'ES07', path: '/me/me_details',    label: 'My Details',    module: 'me' },
  { code: 'ES08', path: '/me/me_tax',        label: 'My Tax Certificate', module: 'me' },
  { code: 'ES09', path: '/me/me_documents',  label: 'My Documents & Policies', module: 'me' },
  { code: 'ES10', path: '/me/me_camp',       label: 'My Camp',       module: 'me' },
  { code: 'ES11', path: '/me/me_advances',   label: 'My Advances & Loans', module: 'me' },
  { code: 'ES12', path: '/me/me_team',       label: 'My Team',       module: 'me' },

  // ── DocVault (DS) ──────────────────────────────────────────────────────
  { code: 'DS01', path: '/docshare/ds_library',         label: 'Document Library',       module: 'docshare' },
  { code: 'DS02', path: '/docshare/ds_viewer',          label: 'Document Viewer',        module: 'docshare' },
  { code: 'DS03', path: '/docshare/ds_settings',        label: 'DocVault Settings',      module: 'docshare' },
  { code: 'DS04', path: '/docshare/ds_detail',          label: 'Document Detail',        module: 'docshare' },
  { code: 'DS05', path: '/docshare/ds_acknowledgements',label: 'My Acknowledgements',    module: 'docshare' },
  { code: 'DS06', path: '/docshare/ds_compliance',      label: 'Compliance Dashboard',   module: 'docshare' },
  { code: 'DS07', path: '/docshare/ds_reports',         label: 'Document Reports',       module: 'docshare' },

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
  MSG:  'CN01',   // bravura connect
  ANNOUNCE: 'GV01',
  DOCS: 'DS01',  // docshare library
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
