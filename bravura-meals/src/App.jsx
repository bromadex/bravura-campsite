import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { CampsiteProvider } from './contexts/CampsiteContext'
import LoginPage    from './auth/LoginPage'
import HomeLauncher from './pages/HomeLauncher'
import MealsPinGate from './auth/MealsPinGate'
import ModuleLayout from './components/ModuleLayout'
import { THEME, workforceNav, campsiteNav, mealsNav, moduleAccess } from './utils/permissions'

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

// ── Module configs ────────────────────────────────────────────────────────────
const MODULE_META = {
  workforce: { label: 'Workforce Management',  icon: 'badge',           navFn: workforceNav },
  campsite:  { label: 'Campsite Management',   icon: 'holiday_village', navFn: campsiteNav  },
  meals:     { label: 'Meal Management',       icon: 'restaurant',      navFn: mealsNav     },
}

// ── Route resolvers ───────────────────────────────────────────────────────────
function getWorkforcePage(page, role) {
  const AM = ['super_admin','approver','meal_officer']
  switch (page) {
    case 'wf_employees':   return AM.includes(role) ? <Employees />    : null
    case 'wf_contractors': return AM.includes(role) ? <Contractors />  : null
    case 'wf_leave':       return AM.includes(role) ? <WorkforceLeave /> : null
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

// ── Default page per module ───────────────────────────────────────────────────
const DEFAULT_PAGE = {
  workforce: 'wf_employees',
  campsite:  'camp_headcount',
  meals:     'meals_dashboard',
}

// ── App shell ─────────────────────────────────────────────────────────────────
function AppContent() {
  const { user, profile, loading } = useAuth()

  // null = home launcher, string = active module id
  const [activeModule,   setActiveModule]   = useState(null)
  const [mealsUnlocked,  setMealsUnlocked]  = useState(false)
  const [currentPage,    setCurrentPage]    = useState(null)

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
      <span className="material-symbols-rounded filled" style={{ fontSize: '44px', color: THEME.activeBar }}>diamond</span>
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
  if (activeModule === 'workforce') content = getWorkforcePage(currentPage, role)
  if (activeModule === 'campsite')  content = getCampsitePage(currentPage, role, setPage)
  if (activeModule === 'meals')     content = getMealsPage(currentPage, role, setPage)

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
      <AppContent />
    </AuthProvider>
  )
}
