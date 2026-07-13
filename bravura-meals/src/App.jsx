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
import { THEME, workforceNav, campsiteNav, mealsNav, adminNav, fuelNav, fleetNav, procurementNav, feedbackNav, contractorsNav } from './utils/permissions'

// ── Workforce pages ───────────────────────────────────────────────────────────
const Employees       = lazy(() => import('./pages/workforce/Employees'))
const HRDashboard      = lazy(() => import('./pages/hr/HRDashboard'))
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
const WorkforceLeave  = lazy(() => import('./pages/workforce/WorkforceLeave'))
const WorkforceReports= lazy(() => import('./pages/workforce/WorkforceReports'))

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
const UserManagement = lazy(() => import('./pages/admin/UserManagement'))
const AuditLogViewer = lazy(() => import('./pages/admin/AuditLogViewer'))

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
const CLCostDashboard       = lazy(() => import('./pages/contractors/CLCostDashboard'))
const CLReports             = lazy(() => import('./pages/contractors/CLReports'))
const CLSettings            = lazy(() => import('./pages/contractors/CLSettings'))

// ── Procurement ───────────────────────────────────────────────────────────────
const ProcSuppliers = lazy(() => import('./pages/procurement/Suppliers'))

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
  procurement: { label: 'Procurement',           icon: 'storefront',       navFn: procurementNav  },
  feedback:    { label: 'Feedback',              icon: 'forum',            navFn: feedbackNav     },
}

// ── Route resolvers ───────────────────────────────────────────────────────────
function getWorkforcePage(page, role, can, setPage) {
  // Param-carrying pages encode their target as 'wf_employee_detail:<uuid>'.
  const [base, param] = (page || '').split(':')
  switch (base) {
    case 'wf_dashboard':       return can('hr.view') || can('employees.view') ? <HRDashboard setPage={setPage} /> : null
    case 'wf_departments':     return can('hr.view') ? <HRDepartments /> : null
    case 'wf_designations':    return can('hr.view') ? <HRDesignations /> : null
    case 'wf_settings':        return can('hr.view') ? <HRSettings /> : null
    case 'wf_employee_form':   return can('hr.create') || can('hr.edit')
      ? <HREmployeeForm setPage={setPage} employeeId={param || null} /> : null
    case 'wf_employee_detail': return can('hr.view')
      ? <HREmployeeDetail setPage={setPage} employeeId={param} /> : null
    case 'wf_leave_types':       return can('hr.view') ? <HRLeaveTypes /> : null
    case 'wf_leave_allocations': return can('hr.view') ? <HRLeaveAllocations /> : null
    case 'wf_leave_requests':    return can('hr.view') ? <HRLeaveRequests /> : null
    case 'wf_leave_calendar':    return can('hr.view') ? <HRLeaveCalendar /> : null
    case 'wf_leave_balances':    return can('hr.view') ? <HRLeaveBalances /> : null
    case 'wf_org_chart':         return can('hr.view') ? <HROrgChart /> : null
    case 'wf_transfers':         return can('hr.view') ? <HRTransfers /> : null
    case 'wf_shifts':            return can('hr.view') ? <HRShifts /> : null
    case 'wf_attendance':        return can('hr.view') ? <HRAttendance /> : null
    case 'wf_training':          return can('hr.view') ? <HRTraining /> : null
    case 'wf_skills':            return can('hr.view') ? <HRSkills /> : null
    case 'wf_headcount_report':  return can('hr.view') ? <HRHeadcountReport /> : null
    case 'wf_leave_report':      return can('hr.view') ? <HRLeaveReport /> : null
    case 'wf_turnover_report':   return can('hr.view') ? <HRTurnoverReport /> : null
    case 'wf_attendance_report': return can('hr.view') ? <HRAttendanceReport /> : null
    case 'wf_salary_grades':     return can('hr.view') ? <HRSalaryGrades /> : null
    case 'wf_salary_components': return can('hr.view') ? <HRSalaryComponents /> : null
    case 'wf_payroll':           return can('hr.view') ? <HRPayrollRun /> : null
    case 'wf_salary_slips':      return can('hr.view') ? <HRSalarySlips /> : null
    case 'wf_appraisals':        return can('hr.view') ? <HRAppraisals /> : null
    case 'wf_disciplinary':      return can('hr.view') ? <HRDisciplinary /> : null
    case 'wf_exit':              return can('hr.view') ? <HRExitManagement /> : null
    // Employee list: the Phase 1 HR list supersedes the original page but
    // keeps the same id — bookmarks and the HR01 T-code keep working.
    case 'wf_employees':
      return can('hr.view') ? <HREmployeesList setPage={setPage} />
        : can('employees.view') ? <Employees /> : null
    // Contractor company management moved to the dedicated Contractors (CL)
    // module — this id is kept (not deleted) because HR02 in txnCodes.js is
    // append-only and old bookmarks/command-palette hits must still resolve.
    case 'wf_contractors':
      return can('contractors.view') ? <ContractorsMoved /> : null
    // employees.edit: Leave Management edits an employee's status directly,
    // so it's gated the same way the Employees Delete button is — HR
    // Officer / Admin only under the approved matrix. Narrower than the old
    // gate for Camp Supervisor/Meal Officer, but matches the same "tighten
    // now, broaden later when those roles are actually assigned" principle
    // already agreed for Employees, and has no practical effect today since
    // only the Admin account is active.
    case 'wf_leave':        return can('employees.edit') ? <WorkforceLeave /> : null
    case 'wf_reports':     return <WorkforceReports />
    default:               return <WorkforceReports />
  }
}

function getCampsitePage(page, role, setPage, can) {
  switch (page) {
    case 'camp_headcount':   return <CampHeadcount />
    case 'camp_floorplan':   return <CampFloorplan />
    case 'camp_assignments': return <CampAssignments />
    case 'camp_rooms':       return <CampRooms />
    // accommodation.create: System Admin + Camp Supervisor have it, Meal
    // Officer does not under the approved matrix (no Accommodation grant at
    // all) — narrower than the old AM list for Meal Officer specifically.
    // Same "tighten now, broaden later" principle already agreed for
    // Employees/Leave; zero practical effect today since only Admin is active.
    case 'camp_blocks':      return can('accommodation.create') ? <CampBlocks /> : null
    case 'camp_supplies':    return <CampSupplies />
    case 'camp_transfers':   return <StockTransfers />
    case 'camp_occ_report':  return <CampOccupancyReport />
    default:                 return <CampHeadcount />
  }
}

function getMealsPage(page, role, setPage, can) {
  switch (page) {
    case 'meals_dashboard': return <Dashboard setPage={setPage} />
    case 'meals_forecasts':      return can('meals.create')  ? <MealForecasts />     : null
    case 'meals_finance_export': return can('meals.approve') ? <MealFinanceExport /> : null
    // meals.create: System Admin + Meal Officer — exact match to old MA list.
    case 'meals_entry':     return can('meals.create') ? <DailyEntry />     : null
    // meals.approve: System Admin only under current grants — Camp
    // Supervisor (old 'approver') has zero Meals permissions in the approved
    // matrix. Same tighten-now pattern as everywhere else in this swap.
    case 'meals_approvals': return can('meals.approve') ? <Approvals />      : null
    // meals.edit: System Admin + Kitchen Staff — exact match to old list.
    case 'meals_kitchen':   return can('meals.edit') ? <KitchenConfirm /> : null
    // meals.view: previously had NO page-level gate at all — only the nav
    // item was conditionally hidden. This closes that gap rather than
    // narrowing anything that was actually reachable through normal use.
    case 'meals_flags':     return can('meals.view') ? <Flags /> : null
    // meals.view: old gate was "everyone except kitchen" (a deny-list).
    // Kitchen Staff DOES hold meals.view under the approved matrix, so this
    // is a deliberate, harmless broadening — they can now see read-only
    // meal-count reports they couldn't before. Not a narrowing for anyone.
    case 'meals_daily':     return can('meals.view') ? <DailyReport />   : null
    case 'meals_range':     return can('meals.view') ? <RangeReport />   : null
    case 'meals_monthly':   return can('meals.view') ? <MonthlyReport /> : null
    // meals.approve: System Admin only today — Camp Supervisor and Pricing
    // Officer could see Billing under the old list; under the matrix,
    // financial visibility sits with Finance Officer/Admin. Same pattern.
    case 'meals_billing':   return can('meals.approve') ? <Billing />  : null
    // meals.edit: System Admin + Pricing Officer — exact match to old list.
    case 'meals_providers': return can('meals.edit') ? <MealProviders /> : null
    case 'meals_pricing':   return can('meals.edit') ? <Pricing />  : null
    // meals.delete: used here as a proxy for "most trusted tier" since
    // there's no dedicated settings permission yet — matches the old
    // super_admin-only gate exactly (only System/Group Admin hold Delete).
    case 'meals_settings':  return can('meals.delete') ? <Settings /> : null
    default:                return <Dashboard setPage={setPage} />
  }
}

// New code — gated by real RBAC from the start, same as Employees.view was.
function getAdminPage(page, can) {
  switch (page) {
    case 'admin_users': return can('users.view') ? <UserManagement /> : null
    // Reusing users.view as the trust-tier gate here too — there's no
    // dedicated audit permission yet, and "who can see user accounts" is
    // the same trust level as "who can see the system's full change
    // history." Same proxy pattern already used for Meals Settings.
    case 'admin_audit':  return can('users.view') ? <AuditLogViewer /> : null
    default:             return can('users.view') ? <UserManagement /> : null
  }
}

function getFuelPage(page, setPage, can) {
  switch (page) {
    case 'fuel_dashboard': return can('fuel.view')   ? <FuelDashboard setPage={setPage} /> : null
    case 'fuel_ledger':    return can('fuel.view')   ? <FuelTransactions setPage={setPage} /> : null
    case 'fuel_receipts':  return can('fuel.create') ? <FuelReceipts />                    : null
    case 'fuel_issues':    return can('fuel.view')         ? <FuelIssues setPage={setPage} />                    : null
    case 'fuel_issuance':     return can('fuel.create') ? <FuelIssuance setPage={setPage} />     : null
    case 'fuel_transactions': return can('fuel.view')   ? <FuelTransactions setPage={setPage} /> : null
    case 'fuel_dips':          return can('fuel.create') ? <DipReadings />                           : null
    case 'fuel_bowsers':       return can('fuel.view')   ? <BowserDispatches />                      : null
    case 'fuel_reconciliation':return can('fuel.create') ? <Reconciliation />                         : null
    case 'fuel_shift_report':  return can('fuel.view')   ? <ShiftReport />                            : null
    case 'fuel_report_daily':  return can('fuel.view')   ? <DailyTransactionReport />                 : null
    case 'fuel_report_monthly':return can('fuel.view')   ? <MonthlyConsumptionReport />               : null
    case 'fuel_report_deliveries': return can('fuel.view') ? <DeliveryReport />                       : null
    case 'fuel_report_variance':   return can('fuel.view') ? <VarianceReport />                       : null
    case 'fuel_vehicle_consumption': return can('fuel.view') ? <VehicleConsumption />                 : null
    case 'fuel_forecasting':   return can('fuel.view')     ? <Forecasting setPage={setPage} />        : null
    case 'fuel_cost_allocation':   return can('fuel.view') ? <CostAllocation />                       : null
    case 'fuel_finance_export':    return can('fuel.edit') ? <FinanceExport />                        : null
    case 'fuel_reports':   return can('fuel.view')     ? <FuelReports setPage={setPage} />   : null
    case 'fuel_tanks':     return can('fuel.view')   ? <FuelTanks setPage={setPage} />     : null
    case 'fuel_types':     return can('fuel.edit')   ? <FuelTypes />                          : null
    case 'fuel_settings':     return can('fuel.edit')   ? <FuelSettings />                           : null
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

function getContractorsPage(page, can) {
  switch (page) {
    case 'cl_dashboard':            return can('contractors.view') ? <CLDashboard /> : null
    case 'cl_companies':            return can('contractors.view') ? <CLCompanies /> : null
    case 'cl_contracts':            return can('contractors.view') ? <CLContracts /> : null
    case 'cl_casual_workers':       return can('contractors.view') ? <CLCasualWorkers /> : null
    case 'cl_contractor_employees': return can('contractors.view') ? <CLContractorEmployees /> : null
    case 'cl_timesheets':           return can('contractors.view') ? <CLTimesheets /> : null
    case 'cl_hired_vehicles':       return can('contractors.view') ? <CLHiredVehicles /> : null
    case 'cl_hired_equipment':      return can('contractors.view') ? <CLHiredEquipment /> : null
    case 'cl_cost_dashboard':       return can('contractors.view') ? <CLCostDashboard /> : null
    case 'cl_reports':              return can('contractors.view') ? <CLReports /> : null
    case 'cl_settings':             return can('contractors.edit') ? <CLSettings /> : null
    default:                        return can('contractors.view') ? <CLDashboard /> : null
  }
}

function getProcurementPage(page, can) {
  switch (page) {
    case 'proc_suppliers': return can('procurement.view') ? <ProcSuppliers /> : null
    default:               return can('procurement.view') ? <ProcSuppliers /> : null
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
  procurement: 'proc_suppliers',
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
  const { can } = usePermissions()
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
  if (moduleId === 'admin')     content = getAdminPage(currentPage, can)
  if (moduleId === 'fuel')      content = getFuelPage(currentPage, setPage, can)
  if (moduleId === 'fleet')     content = getFleetPage(currentPage, setPage)
  if (moduleId === 'contractors') content = getContractorsPage(currentPage, can)
  if (moduleId === 'procurement') content = getProcurementPage(currentPage, can)
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
          {content || AccessDenied}
        </Suspense>
      </ErrorBoundary>
    </ModuleLayout>
  )

  // Campsite wraps in CampsiteProvider — Workforce too, since
  // WorkforceLeave reads from useCampsite() for its leave-recording
  // functions. Unchanged from before, just keyed off the URL now instead
  // of state.
  if (moduleId === 'campsite' || moduleId === 'workforce') {
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
  const { can } = usePermissions()
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
            {can('fuel.view') ? children : (
              <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
                <span className="material-symbols-rounded" style={{ fontSize: '56px', color: THEME.outline, display: 'block', marginBottom: '14px' }}>lock</span>
                <p style={{ fontSize: '15px' }}>You don't have access to this section.</p>
              </div>
            )}
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
