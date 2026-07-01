import { lazy, Suspense } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { CampsiteProvider } from './contexts/CampsiteContext'
import { FuelProvider } from './contexts/FuelContext'
import { SiteProvider } from './contexts/SiteContext'
import { PermissionsProvider, usePermissions } from './contexts/PermissionsContext'
import { ThemeProvider } from './contexts/ThemeContext'
import LoginPage    from './auth/LoginPage'
import HomeLauncher from './pages/HomeLauncher'
import ModuleLayout from './components/ModuleLayout'
import InstallBanner from './components/InstallBanner'
import { THEME, workforceNav, campsiteNav, mealsNav, adminNav, fuelNav, fleetNav, feedbackNav } from './utils/permissions'

// ── Workforce pages ───────────────────────────────────────────────────────────
const Employees       = lazy(() => import('./pages/workforce/Employees'))
const Contractors     = lazy(() => import('./pages/workforce/Contractors'))
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
const FleetDashboard = lazy(() => import('./pages/fleet/FleetDashboard'))

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
const CostAllocation           = lazy(() => import('./pages/fuel/CostAllocation'))
const FinanceExport            = lazy(() => import('./pages/fuel/FinanceExport'))

// ── Feedback ──────────────────────────────────────────────────────────────────
const FeedbackBoard            = lazy(() => import('./pages/feedback/FeedbackBoard'))

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

// ── Module configs ────────────────────────────────────────────────────────────
const MODULE_META = {
  workforce: { label: 'HR Management',         icon: 'badge',            navFn: workforceNav },
  campsite:  { label: 'Campsite Management',   icon: 'holiday_village',  navFn: campsiteNav  },
  meals:     { label: 'Meal Management',       icon: 'restaurant',       navFn: mealsNav     },
  admin:     { label: 'Administration',        icon: 'admin_panel_settings', navFn: adminNav },
  fuel:      { label: 'Fuel Management',       icon: 'local_gas_station',    navFn: fuelNav  },
  fleet:     { label: 'Fleet Management',      icon: 'directions_car',   navFn: fleetNav     },
  feedback:  { label: 'Feedback',              icon: 'forum',            navFn: feedbackNav  },
}

// ── Route resolvers ───────────────────────────────────────────────────────────
function getWorkforcePage(page, role, can) {
  switch (page) {
    // All three swapped to real RBAC per the approved matrix — each verified
    // against the current 5-account mapping before changing.
    case 'wf_employees':   return can('employees.view') ? <Employees />     : null
    // contractors.view: granted to Admin, Camp Supervisor, Meal Officer —
    // exactly matches old behaviour, zero access change.
    case 'wf_contractors': return can('contractors.view') ? <Contractors /> : null
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
    case 'fuel_cost_allocation':   return can('fuel.view') ? <CostAllocation />                       : null
    case 'fuel_finance_export':    return can('fuel.edit') ? <FinanceExport />                        : null
    case 'fuel_reports':   return can('fuel.view')     ? <FuelReports />                     : null
    case 'fuel_tanks':     return can('fuel.view')   ? <FuelTanks />                       : null
    case 'fuel_types':     return can('fuel.edit')   ? <FuelTypes />                          : null
    case 'fuel_settings':     return can('fuel.edit')   ? <FuelSettings />                           : null
    case 'fuel_request_form':  return can('fuel.view')   ? <FuelRequestForm setPage={setPage} />  : null
    case 'fuel_requests_list': return can('fuel.view')   ? <FuelRequests setPage={setPage} />      : null
    default:               return can('fuel.view')   ? <FuelDashboard setPage={setPage} />  : null
  }
}

function getFleetPage(page, setPage) {
  switch (page) {
    case 'fleet_dashboard': return <FleetDashboard setPage={setPage} />
    case 'fleet_vehicles':  return <Vehicles />
    case 'fleet_equipment': return <Equipment />
    case 'fleet_operators': return <Operators />
    default:                return <FleetDashboard setPage={setPage} />
  }
}

function getFeedbackPage(page) {
  switch (page) {
    case 'feedback_board': return <FeedbackBoard />
    default:               return <FeedbackBoard />
  }
}

// ── Default page per module ───────────────────────────────────────────────────
const DEFAULT_PAGE = {
  workforce: 'wf_employees',
  campsite:  'camp_headcount',
  meals:     'meals_dashboard',
  admin:     'admin_users',
  fuel:      'fuel_dashboard',
  fleet:     'fleet_dashboard',
  feedback:  'feedback_board',
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
  if (moduleId === 'workforce') content = getWorkforcePage(currentPage, role, can)
  if (moduleId === 'campsite')  content = getCampsitePage(currentPage, role, setPage, can)
  if (moduleId === 'meals')     content = getMealsPage(currentPage, role, setPage, can)
  if (moduleId === 'admin')     content = getAdminPage(currentPage, can)
  if (moduleId === 'fuel')      content = getFuelPage(currentPage, setPage, can)
  if (moduleId === 'fleet')     content = getFleetPage(currentPage, setPage)
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
  if (moduleId === 'fuel' || moduleId === 'fleet') {
    return <FuelProvider>{body}</FuelProvider>
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
  if (!user || !profile) return <LoginPage />

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
