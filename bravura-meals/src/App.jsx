import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { CampsiteProvider } from './contexts/CampsiteContext'
import { SiteProvider } from './contexts/SiteContext'
import { PermissionsProvider, usePermissions } from './contexts/PermissionsContext'
import LoginPage    from './auth/LoginPage'
import HomeLauncher from './pages/HomeLauncher'
import ModuleLayout from './components/ModuleLayout'
import { THEME, workforceNav, campsiteNav, mealsNav, adminNav, moduleAccess } from './utils/permissions'

// ── Workforce pages ───────────────────────────────────────────────────────────
import Employees    from './pages/Employees'
import Contractors  from './pages/Contractors'
import WorkforceLeave   from './pages/workforce/WorkforceLeave'
import WorkforceReports from './pages/workforce/WorkforceReports'

// ── Campsite pages ────────────────────────────────────────────────────────────
import {
  CampHeadcount, CampBlocks, CampRooms,
  CampAssignments, CampSupplies, CampOccupancyReport,
  CampFloorplan, StockTransfers,
} from './pages/campsite'

// ── Meals pages ───────────────────────────────────────────────────────────────
import Dashboard      from './pages/Dashboard'
import DailyEntry     from './pages/DailyEntry'
import Approvals      from './pages/Approvals'
import KitchenConfirm from './pages/KitchenConfirm'
import Flags          from './pages/Flags'
import DailyReport    from './pages/DailyReport'
import RangeReport    from './pages/RangeReport'
import MonthlyReport  from './pages/MonthlyReport'
import Billing        from './pages/Billing'
import Pricing        from './pages/Pricing'
import MealProviders  from './pages/MealProviders'
import Settings       from './pages/Settings'
import UserManagement from './pages/admin/UserManagement'
import AuditLogViewer from './pages/admin/AuditLogViewer'

// ── Module configs ────────────────────────────────────────────────────────────
const MODULE_META = {
  workforce: { label: 'Workforce Management',  icon: 'badge',           navFn: workforceNav },
  campsite:  { label: 'Campsite Management',   icon: 'holiday_village', navFn: campsiteNav  },
  meals:     { label: 'Meal Management',       icon: 'restaurant',      navFn: mealsNav     },
  admin:     { label: 'Administration',        icon: 'admin_panel_settings', navFn: adminNav },
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

// ── Default page per module ───────────────────────────────────────────────────
const DEFAULT_PAGE = {
  workforce: 'wf_employees',
  campsite:  'camp_headcount',
  meals:     'meals_dashboard',
  admin:     'admin_users',
}

// ── App shell ─────────────────────────────────────────────────────────────────
function AppContent() {
  const { user, profile, loading } = useAuth()

  // null = home launcher, string = active module id
  const [activeModule,   setActiveModule]   = useState(null)
  const [currentPage,    setCurrentPage]    = useState(null)
  const { can } = usePermissions()

  function enterModule(moduleId) {
    setActiveModule(moduleId)
    setCurrentPage(DEFAULT_PAGE[moduleId])
  }

  function goHome() {
    setActiveModule(null)
    setCurrentPage(null)
  }

  function setPage(page) {
    setCurrentPage(page)
  }

  // ── Loading ──
  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: THEME.sidebar, color: '#fff',
      fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
      flexDirection: 'column', gap: '14px',
    }}>
      <div style={{
        background: 'rgba(255,255,255,.92)', borderRadius: '20px',
        padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <img src="/logo/bravura-logo.png" alt="Bravura" style={{ height: '44px', width: 'auto' }} />
      </div>
      <span style={{ color: 'rgba(255,255,255,.55)', fontSize: '14px', letterSpacing: '.06em' }}>BRAVURA</span>
    </div>
  )

  // ── Not authenticated ──
  if (!user || !profile) return <LoginPage />

  const role = profile.role

  // ── Home launcher ──
  if (!activeModule) {
    return <HomeLauncher onEnterModule={enterModule} />
  }

  // Meals PIN gate removed — every page inside Meals now has its own real
  // RBAC permission check (see getMealsPage), which is what actually gates
  // access correctly per the approved direction: "Access to Meals... should
  // be controlled through the RBAC and Site Access model only." The PIN was
  // never doing anything those checks don't already do, and its default
  // (anyone with no PIN set could enter with '0000') was weaker than no gate
  // at all once real permissions existed underneath it.

  // ── Resolve page content ──
  const meta   = MODULE_META[activeModule]
  const navFn  = meta.navFn
  const navItems = navFn(role, can)

  let content = null
  if (activeModule === 'workforce') content = getWorkforcePage(currentPage, role, can)
  if (activeModule === 'campsite')  content = getCampsitePage(currentPage, role, setPage, can)
  if (activeModule === 'meals')     content = getMealsPage(currentPage, role, setPage, can)
  if (activeModule === 'admin')     content = getAdminPage(currentPage, can)

  const AccessDenied = (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <span className="material-symbols-rounded" style={{ fontSize: '56px', color: THEME.outline, display: 'block', marginBottom: '14px' }}>lock</span>
      <p style={{ fontSize: '15px' }}>You don't have access to this section.</p>
    </div>
  )

  // Campsite wraps in CampsiteProvider
  if (activeModule === 'campsite' || activeModule === 'workforce') {
    return (
      <CampsiteProvider>
        <ModuleLayout
          moduleId={activeModule}
          moduleLabel={meta.label}
          moduleIcon={meta.icon}
          navItems={navItems}
          page={currentPage}
          setPage={setPage}
          onHome={goHome}
        >
          {content || AccessDenied}
        </ModuleLayout>
      </CampsiteProvider>
    )
  }

  return (
    <ModuleLayout
      moduleId={activeModule}
      moduleLabel={meta.label}
      moduleIcon={meta.icon}
      navItems={navItems}
      page={currentPage}
      setPage={setPage}
      onHome={goHome}
    >
      {content || AccessDenied}
    </ModuleLayout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <SiteProvider>
        <PermissionsProvider>
          <AppContent />
        </PermissionsProvider>
      </SiteProvider>
    </AuthProvider>
  )
}
