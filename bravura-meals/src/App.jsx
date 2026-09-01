import { lazy, Suspense } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { CampsiteProvider } from './contexts/CampsiteContext'
import { FuelProvider } from './contexts/FuelContext'
import { FleetProvider } from './contexts/FleetContext'
import { ProcurementProvider } from './contexts/ProcurementContext'
import { SiteProvider } from './contexts/SiteContext'
import { PermissionsProvider, usePermissions } from './contexts/PermissionsContext'
import { ThemeProvider } from './contexts/ThemeContext'
import LoginPage    from './auth/LoginPage'
import ForcePasswordResetModal from './auth/ForcePasswordResetModal'
import CommandPalette from './components/CommandPalette'
import HomeLauncher from './pages/HomeLauncher'
import ModuleLayout from './components/ModuleLayout'
import InstallBanner from './components/InstallBanner'
import { THEME, workforceNav, campsiteNav, mealsNav, adminNav, fuelNav, fleetNav, procurementNav, feedbackNav, contractorsNav, inventoryNav, projectsNav } from './utils/permissions'

// ── Workforce pages ───────────────────────────────────────────────────────────
const HRMedicalSurveillance = lazy(() => import('./pages/hr/MedicalSurveillance'))
const HRDocumentExpiry      = lazy(() => import('./pages/hr/DocumentExpiry'))
const PPETracking           = lazy(() => import('./pages/hr/PPETracking'))
const HRDashboard      = lazy(() => import('./pages/hr/HRDashboard'))
const HRAnalytics      = lazy(() => import('./pages/hr/HRAnalytics'))
const HRDepartments    = lazy(() => import('./pages/hr/Departments'))
const HRDesignations   = lazy(() => import('./pages/hr/Designations'))
const HRSettings       = lazy(() => import('./pages/hr/HRSettings'))
const HREmployeesList  = lazy(() => import('./pages/hr/EmployeesList'))
const HREmployeeForm   = lazy(() => import('./pages/hr/EmployeeForm'))
const HREmployeeDetail = lazy(() => import('./pages/hr/EmployeeDetail'))
const HRLeaveTypes     = lazy(() => import('./pages/hr/leave/LeaveTypes'))
const HRLeaveAllocations = lazy(() => import('./pages/hr/leave/LeaveAllocations'))
const HRLeaveRequests  = lazy(() => import('./pages/hr/leave/LeaveRequests'))
const HRLeaveCalendar  = lazy(() => import('./pages/hr/leave/LeaveCalendar'))
const HRLeaveBalances  = lazy(() => import('./pages/hr/leave/LeaveBalanceReport'))
const HROrgChart       = lazy(() => import('./pages/hr/OrgChart'))
const HRTransfers      = lazy(() => import('./pages/hr/Transfers'))
const HRShifts         = lazy(() => import('./pages/hr/attendance/ShiftManagement'))
const HRAttendance     = lazy(() => import('./pages/hr/attendance/AttendanceLog'))
const HRTraining       = lazy(() => import('./pages/hr/training/TrainingPrograms'))
const HRSkills         = lazy(() => import('./pages/hr/training/SkillsMatrix'))
const HRHeadcountReport  = lazy(() => import('./pages/hr/reports/HeadcountReport'))
const HRLeaveReport      = lazy(() => import('./pages/hr/reports/LeaveReport'))
const HRTurnoverReport   = lazy(() => import('./pages/hr/reports/TurnoverReport'))
const HRAttendanceReport = lazy(() => import('./pages/hr/reports/AttendanceReport'))
const HRSalaryGrades     = lazy(() => import('./pages/hr/payroll/SalaryGrades'))
const HRSalaryComponents = lazy(() => import('./pages/hr/payroll/SalaryComponents'))
const HRPayrollRun       = lazy(() => import('./pages/hr/payroll/PayrollRun'))
const HRSalarySlips      = lazy(() => import('./pages/hr/payroll/SalarySlip'))
const HRAppraisals       = lazy(() => import('./pages/hr/performance/Appraisals'))
const HRDisciplinary     = lazy(() => import('./pages/hr/disciplinary/DisciplinaryCases'))
const HRExitManagement   = lazy(() => import('./pages/hr/ExitManagement'))

// ── Campsite pages ────────────────────────────────────────────────────────────
const CampHeadcount       = lazy(() => import('./pages/campsite/CampHeadcount'))
const CampBlocks          = lazy(() => import('./pages/campsite/CampBlocks'))
const CampRooms           = lazy(() => import('./pages/campsite/CampRooms'))
const CampAssignments     = lazy(() => import('./pages/campsite/CampAssignments'))
const CampSupplies        = lazy(() => import('./pages/campsite/CampSupplies'))
const CampOccupancyReport = lazy(() => import('./pages/campsite/CampOccupancyReport'))
const CampFloorplan       = lazy(() => import('./pages/campsite/CampFloorplan'))
const StockTransfers      = lazy(() => import('./pages/campsite/StockTransfers'))

// ── Meals pages ───────────────────────────────────────────────────────────────
const Dashboard      = lazy(() => import('./pages/meals/Dashboard'))
const DailyEntry     = lazy(() => import('./pages/meals/DailyEntry'))
const Approvals      = lazy(() => import('./pages/meals/Approvals'))
const KitchenConfirm = lazy(() => import('./pages/meals/KitchenConfirm'))
const Flags          = lazy(() => import('./pages/meals/Flags'))
const DailyReport    = lazy(() => import('./pages/meals/DailyReport'))
const RangeReport    = lazy(() => import('./pages/meals/RangeReport'))
const MonthlyReport  = lazy(() => import('./pages/meals/MonthlyReport'))
const Billing        = lazy(() => import('./pages/meals/Billing'))
const Pricing        = lazy(() => import('./pages/meals/Pricing'))
const MealProviders  = lazy(() => import('./pages/meals/MealProviders'))
const Settings       = lazy(() => import('./pages/meals/Settings'))
const MealForecasts  = lazy(() => import('./pages/meals/MealForecasts'))
const MealFinanceExport = lazy(() => import('./pages/meals/MealFinanceExport'))
const UserManagement     = lazy(() => import('./pages/admin/UserManagement'))
const AuditLogViewer     = lazy(() => import('./pages/admin/AuditLogViewer'))
const AdminDashboard     = lazy(() => import('./pages/admin/AdminDashboard'))
const RoleManagement     = lazy(() => import('./pages/admin/RoleManagement'))
const SiteManagement     = lazy(() => import('./pages/admin/SiteManagement'))
const PendingInvitations = lazy(() => import('./pages/admin/PendingInvitations'))
const SystemSettings     = lazy(() => import('./pages/admin/SystemSettings'))
const PermissionsCatalogue = lazy(() => import('./pages/admin/PermissionsCatalogue'))
const UserPreferences      = lazy(() => import('./pages/admin/UserPreferences'))

// ── Fleet pages ───────────────────────────────────────────────────────────────
const FleetDashboard      = lazy(() => import('./pages/fleet/FleetDashboard'))
const FleetDispatch       = lazy(() => import('./pages/fleet/FleetDispatch'))
const FleetTyres          = lazy(() => import('./pages/fleet/FleetTyres'))
const FleetContractors    = lazy(() => import('./pages/fleet/FleetContractors'))
const FleetAssets         = lazy(() => import('./pages/fleet/FleetAssets'))
const FleetVehicles       = lazy(() => import('./pages/fleet/FleetVehicles'))
const FleetHeavyEquipment = lazy(() => import('./pages/fleet/FleetHeavyEquipment'))
const FleetGenerators     = lazy(() => import('./pages/fleet/FleetGenerators'))
const FleetAssignments    = lazy(() => import('./pages/fleet/FleetAssignments'))
const FleetInspections    = lazy(() => import('./pages/fleet/FleetInspections'))
const FleetTrips          = lazy(() => import('./pages/fleet/FleetTrips'))
const FleetMaintenance    = lazy(() => import('./pages/fleet/FleetMaintenance'))
const FleetCompliance     = lazy(() => import('./pages/fleet/FleetCompliance'))
const FleetReports        = lazy(() => import('./pages/fleet/FleetReports'))
const FleetMeterReadings  = lazy(() => import('./pages/fleet/FleetMeterReadings'))
const FleetDrivers        = lazy(() => import('./pages/fleet/FleetDrivers'))
const FleetAccidents      = lazy(() => import('./pages/fleet/FleetAccidents'))
const FleetSettings       = lazy(() => import('./pages/fleet/FleetSettings'))

// ── Fuel pages ────────────────────────────────────────────────────────────────
const FuelDashboard = lazy(() => import('./pages/fuel/FuelDashboard'))
const FuelLedger    = lazy(() => import('./pages/fuel/FuelLedger'))
const FuelReceipts  = lazy(() => import('./pages/fuel/FuelReceipts'))
const FuelIssues    = lazy(() => import('./pages/fuel/FuelIssues'))
const DipReadings   = lazy(() => import('./pages/fuel/DipReadings'))
const FuelTanks     = lazy(() => import('./pages/fuel/FuelTanks'))
const FuelReports   = lazy(() => import('./pages/fuel/FuelReports'))
const FuelTypes     = lazy(() => import('./pages/fuel/FuelTypes'))
const FuelIssuance    = lazy(() => import('./pages/fuel/FuelIssuance'))
const FuelTransactions = lazy(() => import('./pages/fuel/FuelTransactions'))
const FuelSettings    = lazy(() => import('./pages/fuel/FuelSettings'))
const FuelRequestForm = lazy(() => import('./pages/fuel/FuelRequestForm'))
const FuelRequests    = lazy(() => import('./pages/fuel/FuelRequests'))
const TankDetail         = lazy(() => import('./pages/fuel/TankDetail'))
const Vehicles           = lazy(() => import('./pages/fuel/Vehicles'))
const Equipment          = lazy(() => import('./pages/fuel/Equipment'))
const Operators          = lazy(() => import('./pages/fuel/Operators'))
const BowserDispatches   = lazy(() => import('./pages/fuel/BowserDispatches'))
const Reconciliation     = lazy(() => import('./pages/fuel/Reconciliation'))
const ShiftReport        = lazy(() => import('./pages/fuel/ShiftReport'))
const DailyTransactionReport   = lazy(() => import('./pages/fuel/reports/DailyTransactionReport'))
const MonthlyConsumptionReport = lazy(() => import('./pages/fuel/reports/MonthlyConsumptionReport'))
const DeliveryReport           = lazy(() => import('./pages/fuel/reports/DeliveryReport'))
const VarianceReport           = lazy(() => import('./pages/fuel/reports/VarianceReport'))
const VehicleConsumption       = lazy(() => import('./pages/fuel/VehicleConsumption'))
const Forecasting              = lazy(() => import('./pages/fuel/Forecasting'))
const CostAllocation           = lazy(() => import('./pages/fuel/CostAllocation'))
const FinanceExport            = lazy(() => import('./pages/fuel/FinanceExport'))

// ── Contract & Contractor Management ─────────────────────────────────────────
const CLDashboard           = lazy(() => import('./pages/contractors/CLDashboard'))
const CLCompanies           = lazy(() => import('./pages/contractors/CLCompanies'))
const CLContracts           = lazy(() => import('./pages/contractors/CLContracts'))
const CLCasualWorkers       = lazy(() => import('./pages/contractors/CLCasualWorkers'))
const CLContractorEmployees = lazy(() => import('./pages/contractors/CLContractorEmployees'))
const CLTimesheets          = lazy(() => import('./pages/contractors/CLTimesheets'))
const CLHiredVehicles       = lazy(() => import('./pages/contractors/CLHiredVehicles'))
const CLHiredEquipment      = lazy(() => import('./pages/contractors/CLHiredEquipment'))
const CLEquipmentUsage      = lazy(() => import('./pages/contractors/CLEquipmentUsage'))
const CLCostDashboard       = lazy(() => import('./pages/contractors/CLCostDashboard'))
const CLReports             = lazy(() => import('./pages/contractors/CLReports'))
const CLReportCasualLabour  = lazy(() => import('./pages/contractors/CLReportCasualLabour'))
const CLReportTimesheets    = lazy(() => import('./pages/contractors/CLReportTimesheets'))
const CLReportVehicles      = lazy(() => import('./pages/contractors/CLReportVehicles'))
const CLReportEquipment     = lazy(() => import('./pages/contractors/CLReportEquipment'))
const CLReportCostBySite    = lazy(() => import('./pages/contractors/CLReportCostBySite'))
const CLSettings            = lazy(() => import('./pages/contractors/CLSettings'))
const CLCasualPayroll       = lazy(() => import('./pages/contractors/CLCasualPayroll'))

// ── Inventory ─────────────────────────────────────────────────────────────────
const InvDashboard   = lazy(() => import('./pages/inventory/InvDashboard'))
const InvItems       = lazy(() => import('./pages/inventory/InvItems'))
const InvCategories  = lazy(() => import('./pages/inventory/InvCategories'))
const InvWarehouses  = lazy(() => import('./pages/inventory/InvWarehouses'))
const InvBalances    = lazy(() => import('./pages/inventory/InvBalances'))
const InvGrn         = lazy(() => import('./pages/inventory/InvGrn'))
const InvIssues      = lazy(() => import('./pages/inventory/InvIssues'))
const InvSiteMoves   = lazy(() => import('./pages/inventory/InvSiteMoves'))
const InvAdjustments = lazy(() => import('./pages/inventory/InvAdjustments'))
const InvLedger      = lazy(() => import('./pages/inventory/InvLedger'))
const InvReports     = lazy(() => import('./pages/inventory/InvReports'))
const InvSettings    = lazy(() => import('./pages/inventory/InvSettings'))
const InvStockTake   = lazy(() => import('./pages/inventory/InvStockTake'))
const InvRequisitions = lazy(() => import('./pages/inventory/InvRequisitions'))
const InvPurchaseOrders = lazy(() => import('./pages/inventory/InvPurchaseOrders'))

// ── Procurement ───────────────────────────────────────────────────────────────
const ProcDashboard = lazy(() => import('./pages/procurement/ProcDashboard'))
const ProcSuppliers = lazy(() => import('./pages/procurement/Suppliers'))
const ProcRFQ = lazy(() => import('./pages/procurement/ProcRFQ'))
const ProcOrders = lazy(() => import('./pages/procurement/ProcOrders'))
const ProcTracking = lazy(() => import('./pages/procurement/ProcTracking'))
const ProcReports = lazy(() => import('./pages/procurement/ProcReports'))

// ── Projects ─────────────────────────────────────────────────────────────────
const PJDashboard = lazy(() => import('./pages/projects/PJDashboard'))
const PJList      = lazy(() => import('./pages/projects/PJList'))
const PJDetail    = lazy(() => import('./pages/projects/PJDetail'))
const PJTasks     = lazy(() => import('./pages/projects/PJTasks'))
const PJTimeline  = lazy(() => import('./pages/projects/PJTimeline'))
const PJAreas     = lazy(() => import('./pages/projects/PJAreas'))
const PJDocuments = lazy(() => import('./pages/projects/PJDocuments'))
const PJTransmittals = lazy(() => import('./pages/projects/PJTransmittals'))
const PJCosts    = lazy(() => import('./pages/projects/PJCosts'))
const PJChanges  = lazy(() => import('./pages/projects/PJChanges'))

// ── Feedback ──────────────────────────────────────────────────────────────────
const FeedbackBoard            = lazy(() => import('./pages/feedback/FeedbackBoard'))
const QuickStartGuide          = lazy(() => import('./pages/feedback/QuickStartGuide'))

const PageLoader = (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: '100%', color: THEME.textLow, fontSize: '13px',
  }}>
    <span className="material-symbols-rounded" style={{ fontSize: '24px', animation: 'spin 1s linear infinite' }}>
      progress_activity
    </span>
  </div>
)

function ContractorsMoved() {
  return (
    <div style={{ maxWidth: '480px', margin: '60px auto', textAlign: 'center' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '40px', color: THEME.textLow }}>handshake</span>
      <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text, marginTop: '12px' }}>
        Contractor management moved
      </div>
      <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '6px' }}>
        Contractor companies, contracts, casual workers and contractor
        employees now live in the Contract &amp; Contractor Management module.
      </div>
      <a href="/contractors/cl_companies" style={{
        display: 'inline-block', marginTop: '18px', padding: '9px 20px',
        borderRadius: '10px', fontSize: '13px', fontWeight: 600,
        background: '#0D7377', color: '#fff', textDecoration: 'none',
      }}>
        Go to Contractors module
      </a>
    </div>
  )
}

// ── Module configs ────────────────────────────────────────────────────────────
const MODULE_META = {
  workforce: { label: 'HR Management',         icon: 'badge',            navFn: workforceNav },
  campsite:  { label: 'Campsite Management',   icon: 'holiday_village',  navFn: campsiteNav  },
  meals:     { label: 'Meal Management',       icon: 'restaurant',       navFn: mealsNav     },
  admin:     { label: 'Administration',        icon: 'admin_panel_settings', navFn: adminNav },
  fuel:      { label: 'Fuel Management',       icon: 'local_gas_station',    navFn: fuelNav  },
  fleet:       { label: 'Fleet Management',      icon: 'directions_car',   navFn: fleetNav        },
  contractors: { label: 'Contract & Contractor Management', icon: 'handshake', navFn: contractorsNav },
  inventory:   { label: 'Inventory Management',  icon: 'inventory_2',      navFn: inventoryNav    },
  procurement: { label: 'Procurement',           icon: 'storefront',       navFn: procurementNav  },
  projects:    { label: 'Project Management',    icon: 'engineering',      navFn: projectsNav     },
  feedback:    { label: 'Feedback',              icon: 'forum',            navFn: feedbackNav     },
}

// ── Route resolvers ───────────────────────────────────────────────────────────
function getWorkforcePage(page, role, can, setPage) {
  // Param-carrying pages encode their target as 'wf_employee_detail:<uuid>'.
  const [base, param] = (page || '').split(':')
  switch (base) {
    case 'wf_dashboard':       return can('hr.view') || can('employees.view') ? <HRDashboard setPage={setPage} /> : null
    case 'wf_analytics':       return can('hr.view') ? <HRAnalytics setPage={setPage} /> : null
    case 'wf_departments':     return can('hr.view') ? <HRDepartments setPage={setPage} /> : null
    case 'wf_designations':    return can('hr.view') ? <HRDesignations setPage={setPage} /> : null
    case 'wf_settings':        return can('hr.view') ? <HRSettings setPage={setPage} /> : null
    case 'wf_employee_form':   return can('hr.create') || can('hr.edit')
      ? <HREmployeeForm setPage={setPage} employeeId={param || null} /> : null
    case 'wf_employee_detail': return can('hr.view')
      ? <HREmployeeDetail setPage={setPage} employeeId={param} /> : null
    case 'wf_leave_types':       return can('hr.view') ? <HRLeaveTypes setPage={setPage} /> : null
    case 'wf_leave_allocations': return can('hr.view') ? <HRLeaveAllocations setPage={setPage} /> : null
    case 'wf_leave_requests':    return can('hr.view') ? <HRLeaveRequests setPage={setPage} /> : null
    case 'wf_leave_calendar':    return can('hr.view') ? <HRLeaveCalendar setPage={setPage} /> : null
    case 'wf_leave_balances':    return can('hr.view') ? <HRLeaveBalances setPage={setPage} /> : null
    case 'wf_org_chart':         return can('hr.view') ? <HROrgChart setPage={setPage} /> : null
    case 'wf_transfers':         return can('hr.view') ? <HRTransfers setPage={setPage} /> : null
    case 'wf_shifts':            return can('hr.view') ? <HRShifts setPage={setPage} /> : null
    case 'wf_attendance':        return can('hr.view') ? <HRAttendance setPage={setPage} /> : null
    case 'wf_training':          return can('hr.view') ? <HRTraining setPage={setPage} /> : null
    case 'wf_skills':            return can('hr.view') ? <HRSkills setPage={setPage} /> : null
    case 'wf_headcount_report':  return can('hr.view') ? <HRHeadcountReport setPage={setPage} /> : null
    case 'wf_leave_report':      return can('hr.view') ? <HRLeaveReport setPage={setPage} /> : null
    case 'wf_turnover_report':   return can('hr.view') ? <HRTurnoverReport setPage={setPage} /> : null
    case 'wf_attendance_report': return can('hr.view') ? <HRAttendanceReport setPage={setPage} /> : null
    // Payroll and disciplinary hold the most sensitive HR data — gated on
    // hr.edit, not plain hr.view (audit finding: view-only HR users should
    // not see salaries or case files).
    case 'wf_salary_grades':     return can('hr.edit') ? <HRSalaryGrades setPage={setPage} /> : null
    case 'wf_salary_components': return can('hr.edit') ? <HRSalaryComponents setPage={setPage} /> : null
    case 'wf_payroll':           return can('hr.edit') ? <HRPayrollRun setPage={setPage} /> : null
    case 'wf_salary_slips':      return can('hr.edit') ? <HRSalarySlips setPage={setPage} /> : null
    case 'wf_appraisals':        return can('hr.view') ? <HRAppraisals setPage={setPage} /> : null
    case 'wf_disciplinary':      return can('hr.edit') ? <HRDisciplinary setPage={setPage} /> : null
    case 'wf_exit':              return can('hr.view') ? <HRExitManagement setPage={setPage} /> : null
    case 'wf_medicals':          return can('hr.view') ? <HRMedicalSurveillance setPage={setPage} /> : null
    case 'wf_document_expiry':   return can('hr.view') ? <HRDocumentExpiry setPage={setPage} /> : null
    case 'wf_ppe':               return can('hr.view') ? <PPETracking setPage={setPage} /> : null
    // Employee list: the Phase 1 HR list supersedes the original page but
    // keeps the same id — bookmarks and the HR01 T-code keep working.
    // (Legacy workforce/Employees.jsx fallback removed with the old
    // employees.* permission family — hr.* is the single HR namespace.)
    case 'wf_employees':
      return can('hr.view') ? <HREmployeesList setPage={setPage} /> : null
    // Contractor company management moved to the dedicated Contractors (CL)
    // module — this id is kept (not deleted) because HR02 in txnCodes.js is
    // append-only and old bookmarks/command-palette hits must still resolve.
    case 'wf_contractors':
      return can('contractors.view') ? <ContractorsMoved /> : null
    // Legacy wf_leave / wf_reports pages removed — the hr/leave and
    // hr/reports suites supersede them. Old ids fall through to the
    // dashboard rather than silently rendering the wrong page.
    default:               return can('hr.view') ? <HRDashboard setPage={setPage} /> : null
  }
}

function getCampsitePage(page, role, setPage, can) {
  switch (page) {
    case 'camp_headcount':   return <CampHeadcount setPage={setPage} />
    case 'camp_floorplan':   return <CampFloorplan setPage={setPage} />
    case 'camp_assignments': return <CampAssignments setPage={setPage} />
    case 'camp_rooms':       return <CampRooms setPage={setPage} />
    case 'camp_blocks':      return can('accommodation.create') ? <CampBlocks setPage={setPage} /> : null
    case 'camp_supplies':    return <CampSupplies setPage={setPage} />
    case 'camp_transfers':   return <StockTransfers setPage={setPage} />
    case 'camp_occ_report':  return <CampOccupancyReport setPage={setPage} />
    default:                 return <CampHeadcount setPage={setPage} />
  }
}

function getMealsPage(page, role, setPage, can) {
  switch (page) {
    case 'meals_dashboard': return <Dashboard setPage={setPage} />
    case 'meals_forecasts':      return can('meals.create')  ? <MealForecasts setPage={setPage} />     : null
    case 'meals_finance_export': return can('meals.approve') ? <MealFinanceExport setPage={setPage} /> : null
    case 'meals_entry':     return can('meals.create') ? <DailyEntry setPage={setPage} />     : null
    case 'meals_approvals': return can('meals.approve') ? <Approvals setPage={setPage} />      : null
    case 'meals_kitchen':   return can('meals.edit') ? <KitchenConfirm setPage={setPage} /> : null
    case 'meals_flags':     return can('meals.view') ? <Flags setPage={setPage} /> : null
    // meals.view: old gate was "everyone except kitchen" (a deny-list).
    // Kitchen Staff DOES hold meals.view under the approved matrix, so this
    // is a deliberate, harmless broadening — they can now see read-only
    // meal-count reports they couldn't before. Not a narrowing for anyone.
    case 'meals_daily':     return can('meals.view') ? <DailyReport setPage={setPage} />   : null
    case 'meals_range':     return can('meals.view') ? <RangeReport setPage={setPage} />   : null
    case 'meals_monthly':   return can('meals.view') ? <MonthlyReport setPage={setPage} /> : null
    // meals.approve: System Admin only today — Camp Supervisor and Pricing
    // Officer could see Billing under the old list; under the matrix,
    // financial visibility sits with Finance Officer/Admin. Same pattern.
    case 'meals_billing':   return can('meals.approve') ? <Billing setPage={setPage} />  : null
    // meals.edit: System Admin + Pricing Officer — exact match to old list.
    case 'meals_providers': return can('meals.edit') ? <MealProviders setPage={setPage} /> : null
    case 'meals_pricing':   return can('meals.edit') ? <Pricing setPage={setPage} />  : null
    // meals.delete: used here as a proxy for "most trusted tier" since
    // there's no dedicated settings permission yet — matches the old
    // super_admin-only gate exactly (only System/Group Admin hold Delete).
    case 'meals_settings':  return can('meals.delete') ? <Settings setPage={setPage} /> : null
    default:                return <Dashboard setPage={setPage} />
  }
}

// New code — gated by real RBAC from the start, same as Employees.view was.
function getAdminPage(page, can, setPage) {
  switch (page) {
    case 'admin_dashboard':   return can('users.view') ? <AdminDashboard setPage={setPage} /> : null
    case 'admin_users':       return can('users.view') ? <UserManagement setPage={setPage} /> : null
    case 'admin_roles':       return can('users.view') ? <RoleManagement setPage={setPage} /> : null
    case 'admin_sites':       return can('users.view') ? <SiteManagement setPage={setPage} /> : null
    case 'admin_invitations': return can('users.view') ? <PendingInvitations setPage={setPage} /> : null
    case 'admin_settings':    return can('users.view') ? <SystemSettings setPage={setPage} /> : null
    case 'admin_permissions': return can('users.view') ? <PermissionsCatalogue setPage={setPage} /> : null
    case 'admin_audit':       return can('users.view') ? <AuditLogViewer setPage={setPage} /> : null
    case 'admin_preferences': return <UserPreferences setPage={setPage} />
    default:                  return can('users.view') ? <AdminDashboard setPage={setPage} /> : null
  }
}

function getFuelPage(page, setPage, can) {
  switch (page) {
    case 'fuel_dashboard': return can('fuel.view')   ? <FuelDashboard setPage={setPage} /> : null
    case 'fuel_ledger':    return can('fuel.view')   ? <FuelTransactions setPage={setPage} /> : null
    case 'fuel_receipts':  return can('fuel.create') ? <FuelReceipts setPage={setPage} />   : null
    case 'fuel_issues':    return can('fuel.view')         ? <FuelIssues setPage={setPage} />                    : null
    case 'fuel_issuance':     return can('fuel.create') ? <FuelIssuance setPage={setPage} />     : null
    case 'fuel_transactions': return can('fuel.view')   ? <FuelTransactions setPage={setPage} /> : null
    case 'fuel_dips':          return can('fuel.create') ? <DipReadings setPage={setPage} />          : null
    case 'fuel_bowsers':       return can('fuel.view')   ? <BowserDispatches setPage={setPage} />     : null
    case 'fuel_reconciliation':return can('fuel.create') ? <Reconciliation setPage={setPage} />       : null
    case 'fuel_shift_report':  return can('fuel.view')   ? <ShiftReport setPage={setPage} />          : null
    case 'fuel_report_daily':  return can('fuel.view')   ? <DailyTransactionReport setPage={setPage} /> : null
    case 'fuel_report_monthly':return can('fuel.view')   ? <MonthlyConsumptionReport setPage={setPage} /> : null
    case 'fuel_report_deliveries': return can('fuel.view') ? <DeliveryReport setPage={setPage} />     : null
    case 'fuel_report_variance':   return can('fuel.view') ? <VarianceReport setPage={setPage} />     : null
    case 'fuel_vehicle_consumption': return can('fuel.view') ? <VehicleConsumption setPage={setPage} /> : null
    case 'fuel_forecasting':   return can('fuel.view')     ? <Forecasting setPage={setPage} />        : null
    case 'fuel_cost_allocation':   return can('fuel.view') ? <CostAllocation setPage={setPage} />      : null
    case 'fuel_finance_export':    return can('fuel.edit') ? <FinanceExport setPage={setPage} />      : null
    case 'fuel_reports':   return can('fuel.view')     ? <FuelReports setPage={setPage} />   : null
    case 'fuel_tanks':     return can('fuel.view')   ? <FuelTanks setPage={setPage} />     : null
    case 'fuel_types':     return can('fuel.edit')   ? <FuelTypes setPage={setPage} />         : null
    case 'fuel_settings':     return can('fuel.edit')   ? <FuelSettings setPage={setPage} />         : null
    case 'fuel_request_form':  return can('fuel.view')   ? <FuelRequestForm setPage={setPage} />  : null
    case 'fuel_requests_list': return can('fuel.view')   ? <FuelRequests setPage={setPage} />      : null
    default:               return can('fuel.view')   ? <FuelDashboard setPage={setPage} />  : null
  }
}

function getFleetPage(page, setPage) {
  switch (page) {
    case 'fleet_dashboard':   return <FleetDashboard setPage={setPage} />
    case 'fleet_dispatch':    return <FleetDispatch setPage={setPage} />
    case 'fleet_assets':      return <FleetAssets setPage={setPage} />
    case 'fleet_vehicles':    return <FleetVehicles setPage={setPage} />
    case 'fleet_equipment':   return <FleetHeavyEquipment setPage={setPage} />
    case 'fleet_generators':  return <FleetGenerators setPage={setPage} />
    case 'fleet_assignments': return <FleetAssignments setPage={setPage} />
    case 'fleet_inspections': return <FleetInspections setPage={setPage} />
    case 'fleet_trips':       return <FleetTrips setPage={setPage} />
    case 'fleet_maintenance': return <FleetMaintenance setPage={setPage} />
    case 'fleet_compliance':  return <FleetCompliance setPage={setPage} />
    case 'fleet_reports':     return <FleetReports setPage={setPage} />
    case 'fleet_meter_readings': return <FleetMeterReadings setPage={setPage} />
    case 'fleet_drivers':     return <FleetDrivers setPage={setPage} />
    case 'fleet_accidents':   return <FleetAccidents setPage={setPage} />
    case 'fleet_tyres':       return <FleetTyres setPage={setPage} />
    case 'fleet_contractors': return <FleetContractors setPage={setPage} />
    case 'fleet_settings':    return <FleetSettings setPage={setPage} />
    default:                  return <FleetDashboard setPage={setPage} />
  }
}

function getContractorsPage(page, can, setPage) {
  switch (page) {
    case 'cl_dashboard':            return can('contractors.view') ? <CLDashboard setPage={setPage} /> : null
    case 'cl_companies':            return can('contractors.view') ? <CLCompanies setPage={setPage} /> : null
    case 'cl_contracts':            return can('contractors.view') ? <CLContracts setPage={setPage} /> : null
    case 'cl_casual_workers':       return can('contractors.view') ? <CLCasualWorkers setPage={setPage} /> : null
    case 'cl_contractor_employees': return can('contractors.view') ? <CLContractorEmployees setPage={setPage} /> : null
    case 'cl_timesheets':           return can('contractors.view') ? <CLTimesheets setPage={setPage} /> : null
    case 'cl_hired_vehicles':       return can('contractors.view') ? <CLHiredVehicles setPage={setPage} /> : null
    case 'cl_hired_equipment':      return can('contractors.view') ? <CLHiredEquipment setPage={setPage} /> : null
    case 'cl_equipment_usage':     return can('contractors.view') ? <CLEquipmentUsage setPage={setPage} /> : null
    case 'cl_cost_dashboard':       return can('contractors.view') ? <CLCostDashboard setPage={setPage} /> : null
    case 'cl_reports':              return can('contractors.view') ? <CLReports setPage={setPage} /> : null
    case 'cl_report_casual_labour': return can('contractors.view') ? <CLReportCasualLabour setPage={setPage} /> : null
    case 'cl_report_timesheets':    return can('contractors.view') ? <CLReportTimesheets setPage={setPage} /> : null
    case 'cl_report_vehicles':      return can('contractors.view') ? <CLReportVehicles setPage={setPage} /> : null
    case 'cl_report_equipment':     return can('contractors.view') ? <CLReportEquipment setPage={setPage} /> : null
    case 'cl_report_cost_by_site':  return can('contractors.view') ? <CLReportCostBySite setPage={setPage} /> : null
    case 'cl_casual_payroll':        return can('contractors.view') ? <CLCasualPayroll setPage={setPage} /> : null
    case 'cl_settings':             return can('contractors.edit') ? <CLSettings setPage={setPage} /> : null
    default:                        return can('contractors.view') ? <CLDashboard setPage={setPage} /> : null
  }
}

function getProcurementPage(page, can, setPage) {
  switch (page) {
    case 'proc_dashboard': return can('procurement.view') ? <ProcDashboard setPage={setPage} /> : null
    case 'proc_suppliers': return can('procurement.view') ? <ProcSuppliers setPage={setPage} /> : null
    case 'proc_rfqs':      return can('procurement.view') ? <ProcRFQ setPage={setPage} /> : null
    case 'proc_orders':    return can('procurement.view') ? <ProcOrders setPage={setPage} /> : null
    case 'proc_tracking':  return can('procurement.view') ? <ProcTracking setPage={setPage} /> : null
    case 'proc_reports':   return can('procurement.view') ? <ProcReports setPage={setPage} /> : null
    default:               return can('procurement.view') ? <ProcDashboard setPage={setPage} /> : null
  }
}

function getInventoryPage(page, can, setPage) {
  if (!can('inventory.view')) return null
  switch (page) {
    case 'inv_dashboard':   return <InvDashboard setPage={setPage} />
    case 'inv_items':       return <InvItems setPage={setPage} />
    case 'inv_categories':  return <InvCategories setPage={setPage} />
    case 'inv_warehouses':  return <InvWarehouses setPage={setPage} />
    case 'inv_balances':    return <InvBalances setPage={setPage} />
    case 'inv_grn':         return <InvGrn setPage={setPage} />
    case 'inv_issues':      return <InvIssues setPage={setPage} />
    case 'inv_site_moves':  return <InvSiteMoves setPage={setPage} />
    case 'inv_adjustments': return <InvAdjustments setPage={setPage} />
    case 'inv_ledger':      return <InvLedger setPage={setPage} />
    case 'inv_reports':     return <InvReports setPage={setPage} />
    case 'inv_settings':    return <InvSettings setPage={setPage} />
    case 'inv_stock_take':  return <InvStockTake setPage={setPage} />
    case 'inv_requisitions': return <InvRequisitions setPage={setPage} />
    case 'inv_purchase_orders': return <InvPurchaseOrders setPage={setPage} />
    default:                return <InvDashboard setPage={setPage} />
  }
}

function getProjectsPage(page, can, setPage) {
  if (!can('projects.view')) return null
  if (page && page.startsWith('pj_detail_')) {
    const rest = page.replace('pj_detail_', '')
    const [projectId, initialTab, initialTaskId] = rest.split(':')
    return <PJDetail setPage={setPage} projectId={projectId} initialTab={initialTab || undefined} initialTaskId={initialTaskId || undefined} />
  }
  switch (page) {
    case 'pj_dashboard': return <PJDashboard setPage={setPage} />
    case 'pj_projects':  return <PJList setPage={setPage} />
    case 'pj_areas':     return <PJAreas setPage={setPage} />
    case 'pj_documents': return <PJDocuments setPage={setPage} />
    case 'pj_transmittals': return <PJTransmittals setPage={setPage} />
    case 'pj_tasks':     return <PJTasks setPage={setPage} />
    case 'pj_timeline':  return <PJTimeline setPage={setPage} />
    case 'pj_costs':     return <PJCosts setPage={setPage} />
    case 'pj_changes':   return <PJChanges setPage={setPage} />
    default:             return <PJDashboard setPage={setPage} />
  }
}

function getFeedbackPage(page) {
  switch (page) {
    case 'feedback_board': return <FeedbackBoard />
    case 'feedback_help':  return <QuickStartGuide />
    default:               return <FeedbackBoard />
  }
}

// ── Default page per module ───────────────────────────────────────────────────
const DEFAULT_PAGE = {
  workforce: 'wf_dashboard',
  campsite:  'camp_headcount',
  meals:     'meals_dashboard',
  admin:     'admin_users',
  fuel:      'fuel_dashboard',
  fleet:       'fleet_dashboard',
  contractors: 'cl_dashboard',
  inventory:   'inv_dashboard',
  procurement: 'proc_dashboard',
  projects:    'pj_dashboard',
  feedback:    'feedback_board',
}

// ── Module shell — resolves :moduleId/:pageId from the URL ────────────────────
// ModuleLayout and HomeLauncher are completely unchanged by this migration —
// both only ever consumed setPage/onHome/onEnterModule as opaque callbacks,
// never caring how navigation actually happens underneath. Confirmed by
// checking both files directly before touching anything here.
function ModuleShell() {
  const { moduleId, pageId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { can, loading: permsLoading } = usePermissions()
  const role = profile.role

  const meta = MODULE_META[moduleId]
  if (!meta) return <Navigate to="/" replace />

  const currentPage = pageId
  function setPage(page) { navigate(`/${moduleId}/${page}`) }
  function goHome() { navigate('/') }

  const navFn = meta.navFn
  const navItems = navFn(role, can)

  let content = null
  if (moduleId === 'workforce') content = getWorkforcePage(currentPage, role, can, setPage)
  if (moduleId === 'campsite')  content = getCampsitePage(currentPage, role, setPage, can)
  if (moduleId === 'meals')     content = getMealsPage(currentPage, role, setPage, can)
  if (moduleId === 'admin')     content = getAdminPage(currentPage, can, setPage)
  if (moduleId === 'fuel')      content = getFuelPage(currentPage, setPage, can)
  if (moduleId === 'fleet')     content = getFleetPage(currentPage, setPage)
  if (moduleId === 'contractors') content = getContractorsPage(currentPage, can, setPage)
  if (moduleId === 'inventory')   content = getInventoryPage(currentPage, can, setPage)
  if (moduleId === 'procurement') content = getProcurementPage(currentPage, can, setPage)
  if (moduleId === 'projects')  content = getProjectsPage(currentPage, can, setPage)
  if (moduleId === 'feedback')  content = getFeedbackPage(currentPage)

  const AccessDenied = (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <span className="material-symbols-rounded" style={{ fontSize: '56px', color: THEME.outline, display: 'block', marginBottom: '14px' }}>lock</span>
      <p style={{ fontSize: '15px' }}>You don't have access to this section.</p>
    </div>
  )

  const body = (
    <ModuleLayout
      moduleId={moduleId}
      moduleLabel={meta.label}
      moduleIcon={meta.icon}
      navItems={navItems}
      page={currentPage}
      setPage={setPage}
      onHome={goHome}
    >
      <ErrorBoundary level="page">
        <Suspense fallback={PageLoader}>
          {content || (permsLoading ? PageLoader : AccessDenied)}
        </Suspense>
      </ErrorBoundary>
    </ModuleLayout>
  )

  if (moduleId === 'campsite') {
    return <CampsiteProvider>{body}</CampsiteProvider>
  }
  if (moduleId === 'fuel') {
    return <FuelProvider>{body}</FuelProvider>
  }
  if (moduleId === 'fleet') {
    return <FleetProvider>{body}</FleetProvider>
  }
  if (moduleId === 'procurement') {
    return <ProcurementProvider>{body}</ProcurementProvider>
  }
  return body
}

// Shell for fuel sub-routes that aren't top-level pages (e.g. /fuel/tanks/:id).
// Mirrors ModuleShell's wrapping (FuelProvider + ModuleLayout) but lets the
// child element render directly instead of going through getFuelPage.
function FuelDetailShell({ page, children }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { can, loading: permsLoading } = usePermissions()
  const meta = MODULE_META.fuel
  const navItems = meta.navFn(profile.role, can)

  function setPage(p) { navigate(`/fuel/${p}`) }
  function goHome() { navigate('/') }

  return (
    <FuelProvider>
      <ModuleLayout
        moduleId="fuel"
        moduleLabel={meta.label}
        moduleIcon={meta.icon}
        navItems={navItems}
        page={page}
        setPage={setPage}
        onHome={goHome}
      >
        <ErrorBoundary level="page">
          <Suspense fallback={PageLoader}>
            {can('fuel.view') ? children : (permsLoading ? PageLoader : (
              <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
                <span className="material-symbols-rounded" style={{ fontSize: '56px', color: THEME.outline, display: 'block', marginBottom: '14px' }}>lock</span>
                <p style={{ fontSize: '15px' }}>You don't have access to this section.</p>
              </div>
            ))}
          </Suspense>
        </ErrorBoundary>
      </ModuleLayout>
    </FuelProvider>
  )
}

// A bare module URL (e.g. /workforce, with no page segment) redirects to
// that module's default page, rather than falling through to the
// catch-all and bouncing all the way back to the home launcher.
function ModuleDefaultRedirect() {
  const { moduleId } = useParams()
  const target = DEFAULT_PAGE[moduleId]
  if (!target) return <Navigate to="/" replace />
  return <Navigate to={`/${moduleId}/${target}`} replace />
}

function HomeLauncherPage() {
  const navigate = useNavigate()
  function enterModule(moduleId) { navigate(`/${moduleId}/${DEFAULT_PAGE[moduleId]}`) }
  return <HomeLauncher onEnterModule={enterModule} />
}

// ── App shell ─────────────────────────────────────────────────────────────────
function AppContent() {
  const { user, profile, loading } = useAuth()

  // ── Loading ──
  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: THEME.sidebar, color: '#fff',
      fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
      flexDirection: 'column', gap: '14px',
    }}>
      <div style={{
        background: 'rgba(255,255,255,.92)', borderRadius: '6px',
        padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <img src="/logo/bravura-logo.png" alt="Bravura" style={{ height: '44px', width: 'auto' }} />
      </div>
      <span style={{ color: 'rgba(255,255,255,.55)', fontSize: '14px', letterSpacing: '.06em' }}>BRAVURA</span>
    </div>
  )

  // ── Not authenticated ──
  // Whatever URL was being visited stays in the address bar — once login
  // succeeds, the very same URL now matches a real route and renders
  // straight back to where the person was, with no extra logic needed.
  // That's a direct, free benefit of routing properly instead of a
  // dead-end nobody could plan for before.
  if (!user || !profile) return <><LoginPage /><InstallBanner /></>

  return (
    <>
      <Routes>
        <Route path="/" element={<HomeLauncherPage />} />
        <Route path="/fuel/tanks/:tankId" element={<FuelDetailShell page="fuel_tank_detail"><TankDetail /></FuelDetailShell>} />
        <Route path="/:moduleId" element={<ModuleDefaultRedirect />} />
        <Route path="/:moduleId/:pageId" element={<ModuleShell />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <InstallBanner />
      <CommandPalette />
      {profile.force_password_reset && <ForcePasswordResetModal />}
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <BrowserRouter>
          <AuthProvider>
            <SiteProvider>
              <PermissionsProvider>
                <AppContent />
              </PermissionsProvider>
            </SiteProvider>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
