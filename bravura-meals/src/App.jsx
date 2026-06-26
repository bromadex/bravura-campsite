import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { CampsiteProvider } from './contexts/CampsiteContext'
import { SiteProvider } from './contexts/SiteContext'
import { PermissionsProvider, usePermissions } from './contexts/PermissionsContext'
import LoginPage    from './auth/LoginPage'
import HomeLauncher from './pages/HomeLauncher'
import MealsPinGate from './auth/MealsPinGate'
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
  CampFloorplan,
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
import Settings       from './pages/Settings'
import UserManagement from './pages/admin/UserManagement'

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

function getCampsitePage(page, role, setPage) {
  const AM = ['super_admin','approver','meal_officer']
  switch (page) {
    case 'camp_headcount':   return <CampHeadcount />
    case 'camp_floorplan':   return <CampFloorplan />
    case 'camp_assignments': return <CampAssignments />
    case 'camp_rooms':       return <CampRooms />
    case 'camp_blocks':      return AM.includes(role) ? <CampBlocks /> : null
    case 'camp_supplies':    return <CampSupplies />
    case 'camp_occ_report':  return <CampOccupancyReport />
    default:                 return <CampHeadcount />
  }
}

function getMealsPage(page, role, setPage) {
  const A  = ['super_admin','approver']
  const AM = ['super_admin','approver','meal_officer']
  const MA = ['super_admin','meal_officer']
  switch (page) {
    case 'meals_dashboard': return <Dashboard setPage={setPage} />
    case 'meals_entry':     return MA.includes(role) ? <DailyEntry />     : null
    case 'meals_approvals': return A.includes(role)  ? <Approvals />      : null
    case 'meals_kitchen':   return ['super_admin','kitchen'].includes(role) ? <KitchenConfirm /> : null
    case 'meals_flags':     return <Flags />
    case 'meals_daily':     return !['kitchen'].includes(role) ? <DailyReport />   : null
    case 'meals_range':     return !['kitchen'].includes(role) ? <RangeReport />   : null
    case 'meals_monthly':   return !['kitchen'].includes(role) ? <MonthlyReport /> : null
    case 'meals_billing':   return ['super_admin','approver','kitchen_owner'].includes(role) ? <Billing />  : null
    case 'meals_pricing':   return ['super_admin','kitchen_owner'].includes(role)            ? <Pricing />  : null
    case 'meals_settings':  return role === 'super_admin' ? <Settings /> : null
    default:                return <Dashboard setPage={setPage} />
  }
}

// New code — gated by real RBAC from the start, same as Employees.view was.
function getAdminPage(page, can) {
  switch (page) {
    case 'admin_users': return can('users.view') ? <UserManagement /> : null
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
  const [mealsUnlocked,  setMealsUnlocked]  = useState(false)
  const [currentPage,    setCurrentPage]    = useState(null)
  const { can } = usePermissions()

  function enterModule(moduleId) {
    setActiveModule(moduleId)
    setCurrentPage(DEFAULT_PAGE[moduleId])
  }

  function goHome() {
    setActiveModule(null)
    setCurrentPage(null)
    // Lock meals again when going home
    setMealsUnlocked(false)
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

  // ── Meals PIN gate ──
  if (activeModule === 'meals' && !mealsUnlocked) {
    return (
      <MealsPinGate
        profile={profile}
        onUnlock={() => setMealsUnlocked(true)}
        onBack={goHome}
      />
    )
  }

  // ── Resolve page content ──
  const meta   = MODULE_META[activeModule]
  const navFn  = meta.navFn
  const navItems = navFn(role)

  let content = null
  if (activeModule === 'workforce') content = getWorkforcePage(currentPage, role, can)
  if (activeModule === 'campsite')  content = getCampsitePage(currentPage, role, setPage)
  if (activeModule === 'meals')     content = getMealsPage(currentPage, role, setPage)
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
