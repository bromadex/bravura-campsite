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
  { id: 'proc_dashboard', label: 'Dashboard',  icon: 'dashboard',      color: '#7C3AED' },
  { id: 'proc_suppliers', label: 'Suppliers',   icon: 'business',       color: '#1565C0' },
  { id: 'proc_rfqs',      label: 'RFQs',        icon: 'request_quote',  color: '#00838F' },
  { id: 'proc_orders',    label: 'Orders',      icon: 'shopping_cart',  color: '#2E7D32' },
  { id: 'proc_tracking',  label: 'Tracking',    icon: 'local_shipping', color: '#E65100' },
  { id: 'proc_reports',   label: 'Reports',     icon: 'bar_chart',      color: '#C62828' },
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
  { id: 'cl_reports',    label: 'Reports',     icon: 'bar_chart',       color: '#C62828' },
  { id: 'cl_settings',   label: 'Settings',    icon: 'settings',        color: '#546E7A' },
]

export const ADMIN_PILLS = [
  { id: 'admin_dashboard',   label: 'Dashboard',    icon: 'dashboard',         color: '#5C6BC0' },
  { id: 'admin_users',       label: 'Users',        icon: 'manage_accounts',   color: '#1565C0' },
  { id: 'admin_roles',       label: 'Roles',        icon: 'shield_person',     color: '#2E7D32' },
  { id: 'admin_permissions', label: 'Permissions',  icon: 'verified_user',     color: '#00838F' },
  { id: 'admin_sites',       label: 'Sites',        icon: 'location_city',     color: '#E65100' },
  { id: 'admin_invitations', label: 'Invitations',  icon: 'mail',              color: '#6A1B9A' },
  { id: 'admin_settings',    label: 'Settings',     icon: 'settings',          color: '#546E7A' },
  { id: 'admin_audit',       label: 'Audit Log',    icon: 'history',           color: '#C62828' },
]
