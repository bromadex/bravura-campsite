import { Icon } from './ui'

export default function QuickNav({ pills, setPage, current }) {
  if (!setPage || !pills?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '18px' }}>
      {pills.map(p => {
        const active = current === p.id
        return (
          <button
            key={p.id}
            onClick={() => setPage(p.id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '6px 14px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
              background: active ? p.color : p.color + '14',
              color: active ? '#fff' : p.color,
              border: `1px solid ${active ? p.color : p.color + '40'}`,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all .15s',
            }}
          >
            <Icon name={p.icon} size={14} style={{ color: 'inherit' }} />
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

export const MEALS_PILLS = [
  { id: 'meals_dashboard', label: 'Dashboard',    icon: 'dashboard',       color: '#982329' },
  { id: 'meals_entry',     label: 'Meal Entry',   icon: 'edit_note',       color: '#C62828' },
  { id: 'meals_approvals', label: 'Approvals',    icon: 'task_alt',        color: '#2E7D32' },
  { id: 'meals_kitchen',   label: 'Kitchen',      icon: 'restaurant',      color: '#E65100' },
  { id: 'meals_forecasts', label: 'Forecast',     icon: 'insights',        color: '#6A1B9A' },
  { id: 'meals_flags',     label: 'Flags',        icon: 'flag',            color: '#D32F2F' },
  { id: 'meals_daily',     label: 'Reports',      icon: 'bar_chart',       color: '#1565C0' },
  { id: 'meals_billing',   label: 'Billing',      icon: 'receipt_long',    color: '#00838F' },
  { id: 'meals_providers', label: 'Providers',    icon: 'storefront',      color: '#5D4037' },
  { id: 'meals_settings',  label: 'Settings',     icon: 'settings',        color: '#546E7A' },
]

export const CAMPSITE_PILLS = [
  { id: 'camp_headcount',   label: 'Headcount',    icon: 'people_alt',     color: '#00897B' },
  { id: 'camp_floorplan',   label: 'Layout',       icon: 'view_in_ar',     color: '#1565C0' },
  { id: 'camp_assignments', label: 'Assignments',  icon: 'assignment_ind', color: '#2E7D32' },
  { id: 'camp_rooms',       label: 'Rooms',        icon: 'meeting_room',   color: '#6A1B9A' },
  { id: 'camp_blocks',      label: 'Blocks',       icon: 'domain',         color: '#5D4037' },
  { id: 'camp_supplies',    label: 'Supplies',     icon: 'inventory_2',    color: '#E65100' },
  { id: 'camp_transfers',   label: 'Transfers',    icon: 'swap_horiz',     color: '#0277BD' },
  { id: 'camp_occ_report',  label: 'Reports',      icon: 'analytics',      color: '#C62828' },
]

export const HR_PILLS = [
  { id: 'wf_dashboard',       label: 'Dashboard',   icon: 'dashboard',        color: '#E07B39' },
  { id: 'wf_employees',       label: 'Employees',   icon: 'badge',            color: '#1565C0' },
  { id: 'wf_leave_requests',  label: 'Leave',       icon: 'event_available',  color: '#2E7D32' },
  { id: 'wf_departments',     label: 'Departments', icon: 'domain',           color: '#6A1B9A' },
  { id: 'wf_org_chart',       label: 'Org Chart',   icon: 'account_tree',     color: '#00838F' },
  { id: 'wf_attendance',      label: 'Attendance',  icon: 'fact_check',       color: '#E65100' },
  { id: 'wf_training',        label: 'Training',    icon: 'school',           color: '#0277BD' },
  { id: 'wf_payroll',         label: 'Payroll',     icon: 'calculate',        color: '#4527A0' },
  { id: 'wf_appraisals',      label: 'Appraisals',  icon: 'star_rate',        color: '#D97706' },
  { id: 'wf_headcount_report', label: 'Reports',    icon: 'people',           color: '#C62828' },
  { id: 'wf_analytics',       label: 'Analytics',   icon: 'analytics',        color: '#7B1FA2' },
  { id: 'wf_settings',        label: 'Settings',    icon: 'settings',         color: '#546E7A' },
]

export const INVENTORY_PILLS = [
  { id: 'inv_dashboard',       label: 'Dashboard',     icon: 'dashboard',       color: '#B45309' },
  { id: 'inv_items',           label: 'Items',         icon: 'category',        color: '#1565C0' },
  { id: 'inv_warehouses',      label: 'Warehouses',    icon: 'warehouse',       color: '#5D4037' },
  { id: 'inv_balances',        label: 'Balances',      icon: 'inventory',       color: '#2E7D32' },
  { id: 'inv_grn',             label: 'Goods Received', icon: 'move_to_inbox',  color: '#00838F' },
  { id: 'inv_issues',          label: 'Issues',        icon: 'outbox',          color: '#E65100' },
  { id: 'inv_stock_take',      label: 'Stock Take',    icon: 'fact_check',      color: '#6A1B9A' },
  { id: 'inv_requisitions',    label: 'Requisitions',  icon: 'request_quote',   color: '#0277BD' },
  { id: 'inv_purchase_orders', label: 'POs',           icon: 'shopping_cart',   color: '#4527A0' },
  { id: 'inv_ledger',          label: 'Ledger',        icon: 'menu_book',       color: '#C62828' },
  { id: 'inv_reports',         label: 'Reports',       icon: 'bar_chart',       color: '#D32F2F' },
  { id: 'inv_settings',        label: 'Settings',      icon: 'settings',        color: '#546E7A' },
]

export const PROCUREMENT_PILLS = [
  { id: 'proc_dashboard',    label: 'Home',            icon: 'dashboard',      color: '#982329' },
  { id: 'proc_requisitions', label: 'Requests',        icon: 'assignment',     color: '#982329' },
  { id: 'proc_orders',       label: 'Purchase Orders', icon: 'shopping_cart',  color: '#1F4E8C' },
  { id: 'proc_grn',          label: 'Receiving',       icon: 'move_to_inbox',  color: '#2F7D4F' },
  { id: 'proc_invoices',     label: 'Bills',           icon: 'receipt_long',   color: '#2F7D4F' },
  { id: 'proc_suppliers',    label: 'Suppliers',       icon: 'business',       color: '#5B6661' },
  { id: 'proc_reports',      label: 'Reports',         icon: 'bar_chart',      color: '#5B6661' },
]

export const CONTRACTOR_PILLS = [
  { id: 'cl_dashboard',  label: 'Dashboard',   icon: 'dashboard',       color: '#0D7377' },
  { id: 'cl_contractors', label: 'Contractors', icon: 'business',        color: '#1565C0' },
  { id: 'cl_contracts',  label: 'Contracts',   icon: 'description',     color: '#6A1B9A' },
  { id: 'cl_employees',  label: 'Employees',   icon: 'badge',           color: '#2E7D32' },
  { id: 'cl_casuals',    label: 'Casuals',     icon: 'person',          color: '#E65100' },
  { id: 'cl_timesheets', label: 'Timesheets',  icon: 'schedule',        color: '#00838F' },
  { id: 'cl_vehicles',   label: 'Vehicles',    icon: 'local_shipping',  color: '#5D4037' },
  { id: 'cl_equipment',  label: 'Equipment',   icon: 'construction',    color: '#455A64' },
  { id: 'cl_equipment_usage', label: 'Usage Log', icon: 'timer',          color: '#37474F' },
  { id: 'cl_casual_payroll', label: 'Payroll', icon: 'payments',        color: '#AD1457' },
  { id: 'cl_cost_dashboard', label: 'Cost Dashboard', icon: 'analytics',  color: '#7C4DFF' },
  { id: 'cl_reports',    label: 'Reports',     icon: 'bar_chart',       color: '#C62828' },
  { id: 'cl_settings',   label: 'Settings',    icon: 'settings',        color: '#546E7A' },
]

export const CONCRETE_PILLS = [
  { id: 'co_dashboard',       label: 'Dashboard',     icon: 'dashboard',      color: '#EF6C00' },
  { id: 'co_mix_designs',     label: 'Mix Designs',   icon: 'science',        color: '#1565C0' },
  { id: 'co_batches',         label: 'Batches',       icon: 'factory',        color: '#2E7D32' },
  { id: 'co_cement',          label: 'Cement',        icon: 'inventory',      color: '#6A1B9A' },
  { id: 'co_aggregates',      label: 'Aggregates',    icon: 'layers',         color: '#00838F' },
  { id: 'co_cube_tests',      label: 'Cube Tests',    icon: 'verified',       color: '#C62828' },
  { id: 'co_project_costing', label: 'Project Costing', icon: 'request_quote', color: '#37474F' },
  { id: 'co_settings',        label: 'Settings',      icon: 'settings',       color: '#546E7A' },
]

export const SHEQ_PILLS = [
  { id: 'sq_dashboard',    label: 'Dashboard',      icon: 'dashboard',      color: '#D32F2F' },
  { id: 'sq_incidents',    label: 'Incidents',       icon: 'warning',        color: '#E65100' },
  { id: 'sq_hazards',      label: 'Hazards',         icon: 'report_problem', color: '#F57F17' },
  { id: 'sq_observations', label: 'Observations',    icon: 'visibility',     color: '#2E7D32' },
  { id: 'sq_capa',             label: 'CAPA',            icon: 'task_alt',       color: '#1565C0' },
  { id: 'sq_risk_register',   label: 'Risks',           icon: 'shield',         color: '#7B1FA2' },
  { id: 'sq_permits',         label: 'PTW',             icon: 'description',    color: '#00695C' },
  { id: 'sq_loto',            label: 'LOTO',            icon: 'lock',           color: '#37474F' },
  { id: 'sq_risk_matrix',     label: 'Risk Matrix',     icon: 'grid_on',        color: '#4527A0' },
  { id: 'sq_inspections',     label: 'Inspections',     icon: 'checklist',      color: '#00695C' },
  { id: 'sq_templates',       label: 'Templates',       icon: 'list_alt',       color: '#0D47A1' },
  { id: 'sq_audits',          label: 'Audits',          icon: 'verified',       color: '#4527A0' },
  { id: 'sq_audit_findings',  label: 'Findings',        icon: 'find_in_page',   color: '#AD1457' },
  { id: 'sq_calendar',        label: 'Calendar',        icon: 'calendar_month', color: '#00838F' },
  { id: 'sq_training',        label: 'Training',        icon: 'school',         color: '#1565C0' },
  { id: 'sq_medical',         label: 'Medical',         icon: 'medical_services', color: '#C62828' },
  { id: 'sq_toolbox',         label: 'Toolbox Talks',   icon: 'record_voice_over', color: '#00695C' },
  { id: 'sq_emp_profile',     label: 'SHEQ Profile',    icon: 'badge',          color: '#4527A0' },
  { id: 'sq_inductions',      label: 'Inductions',      icon: 'how_to_reg',     color: '#2E7D32' },
  { id: 'sq_environmental',   label: 'Environmental',   icon: 'eco',            color: '#2E7D32' },
  { id: 'sq_waste',           label: 'Waste',           icon: 'delete_sweep',   color: '#5D4037' },
  { id: 'sq_spills',          label: 'Spills',          icon: 'water_drop',     color: '#0277BD' },
  { id: 'sq_env_monitoring',  label: 'Monitoring',      icon: 'monitor_heart',  color: '#00838F' },
  { id: 'sq_ppe',             label: 'PPE',             icon: 'health_and_safety', color: '#E65100' },
  { id: 'sq_resources',       label: 'Resources',       icon: 'bolt',           color: '#F57F17' },
  { id: 'sq_legal',               label: 'Legal',           icon: 'gavel',          color: '#5D4037' },
  { id: 'sq_doc_control',         label: 'Documents',       icon: 'folder_managed', color: '#0D47A1' },
  { id: 'sq_contractor_compliance', label: 'Contractors',   icon: 'engineering',    color: '#E65100' },
  { id: 'sq_emergency_plans',     label: 'Emergency Plans', icon: 'emergency',      color: '#B71C1C' },
  { id: 'sq_emergency_drills',    label: 'Drills',          icon: 'fire_truck',     color: '#D32F2F' },
  { id: 'sq_mgmt_review',        label: 'Mgmt Review',    icon: 'supervisor_account', color: '#37474F' },
  { id: 'sq_analytics',          label: 'Analytics',      icon: 'analytics',      color: '#6A1B9A' },
  { id: 'sq_reports',         label: 'Reports',         icon: 'bar_chart',      color: '#6A1B9A' },
  { id: 'sq_settings',        label: 'Settings',        icon: 'settings',       color: '#546E7A' },
]

export const PROJECT_PILLS = [
  { id: 'pj_dashboard', label: 'Dashboard',      icon: 'dashboard',   color: '#1B5E20' },
  { id: 'pj_projects',  label: 'Projects',       icon: 'folder_open', color: '#2E7D32' },
  { id: 'pj_tasks',     label: 'Tasks',          icon: 'task_alt',    color: '#1565C0' },
  { id: 'pj_timeline',  label: 'Timeline',       icon: 'timeline',    color: '#6A1B9A' },
  { id: 'pj_documents', label: 'Documents',      icon: 'description', color: '#E65100' },
  { id: 'pj_costs',     label: 'Costs & EVM',    icon: 'payments',    color: '#AD1457' },
  { id: 'pj_changes',   label: 'Change Orders',  icon: 'swap_horiz',  color: '#00838F' },
]

export const ADMIN_PILLS = [
  { id: 'admin_dashboard',   label: 'Dashboard',    icon: 'dashboard',         color: '#5C6BC0' },
  { id: 'admin_users',       label: 'Users',        icon: 'manage_accounts',   color: '#1565C0' },
  { id: 'admin_roles',       label: 'Roles',        icon: 'shield_person',     color: '#2E7D32' },
  { id: 'admin_employee_links', label: 'Employee Links', icon: 'badge', color: '#00695C' },
  { id: 'admin_permissions', label: 'Permissions',  icon: 'verified_user',     color: '#00838F' },
  { id: 'admin_sites',       label: 'Sites',        icon: 'location_city',     color: '#E65100' },
  { id: 'admin_invitations', label: 'Invitations',  icon: 'mail',              color: '#6A1B9A' },
  { id: 'admin_approval_routes', label: 'Approval Routes', icon: 'alt_route', color: '#4527A0' },
  { id: 'admin_settings',    label: 'Settings',     icon: 'settings',          color: '#546E7A' },
  { id: 'admin_audit',       label: 'Audit Log',    icon: 'history',           color: '#C62828' },
]
