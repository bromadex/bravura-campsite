import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { CampsiteProvider } from './contexts/CampsiteContext'
import LoginPage from './auth/LoginPage'
import Layout from './components/Layout'
import { THEME } from './utils/permissions'

// ── Meals pages ───────────────────────────────────────────────────────────────
import Dashboard     from './pages/Dashboard'
import DailyEntry    from './pages/DailyEntry'
import Approvals     from './pages/Approvals'
import KitchenConfirm from './pages/KitchenConfirm'
import DailyReport   from './pages/DailyReport'
import RangeReport   from './pages/RangeReport'
import MonthlyReport from './pages/MonthlyReport'
import Billing       from './pages/Billing'
import Employees     from './pages/Employees'
import Contractors   from './pages/Contractors'
import Pricing       from './pages/Pricing'
import Flags         from './pages/Flags'
import Settings      from './pages/Settings'

// ── Campsite pages ────────────────────────────────────────────────────────────
import { CampHeadcount, CampBlocks, CampRooms, CampAssignments, CampSupplies } from './pages/campsite'

// ─── Route → component + access check ────────────────────────────────────────
function getPageContent(page, role, setPage) {
  const A = ['super_admin','approver']
  const AM = ['super_admin','approver','meal_officer']
  const MA = ['super_admin','meal_officer']

  switch (page) {
    // Meals
    case 'dashboard':        return <Dashboard setPage={setPage} />
    case 'entry':            return MA.includes(role)                                        ? <DailyEntry />     : null
    case 'approvals':        return A.includes(role)                                         ? <Approvals />      : null
    case 'kitchen':          return ['super_admin','kitchen'].includes(role)                  ? <KitchenConfirm /> : null
    case 'daily':            return !['kitchen'].includes(role)                               ? <DailyReport />    : null
    case 'range':            return !['kitchen'].includes(role)                               ? <RangeReport />    : null
    case 'monthly':          return !['kitchen'].includes(role)                               ? <MonthlyReport />  : null
    case 'billing':          return ['super_admin','approver','kitchen_owner'].includes(role) ? <Billing />        : null
    case 'employees':        return AM.includes(role)                                         ? <Employees />      : null
    case 'contractors':      return AM.includes(role)                                         ? <Contractors />    : null
    case 'pricing':          return ['super_admin','kitchen_owner'].includes(role)            ? <Pricing />        : null
    case 'flags':            return <Flags />
    case 'settings':         return role === 'super_admin'                                    ? <Settings />       : null
    // Campsite — all roles that can view campsite
    case 'camp_headcount':   return <CampHeadcount />
    case 'camp_assignments': return <CampAssignments />
    case 'camp_rooms':       return <CampRooms />
    case 'camp_blocks':      return AM.includes(role)                                         ? <CampBlocks />     : null
    case 'camp_supplies':    return <CampSupplies />
    default:                 return <Dashboard setPage={setPage} />
  }
}

function AppContent() {
  const { user, profile, loading } = useAuth()
  const [page, setPage] = useState('dashboard')

  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: THEME.sidebar, color: '#fff', fontSize: '15px',
      fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif",
      flexDirection: 'column', gap: '14px',
    }}>
      <span className="material-symbols-rounded filled" style={{ fontSize: '40px', color: THEME.activeBar }}>restaurant</span>
      <span style={{ color: 'rgba(255,255,255,.6)' }}>Loading…</span>
    </div>
  )

  if (!user || !profile) return <LoginPage />

  const content = getPageContent(page, profile.role, setPage)

  return (
    <CampsiteProvider>
      <Layout page={page} setPage={setPage}>
        {content || (
          <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
            <span className="material-symbols-rounded" style={{ fontSize: '56px', color: THEME.outline, display: 'block', marginBottom: '14px' }}>lock</span>
            <p style={{ fontSize: '15px' }}>You don't have access to this section.</p>
          </div>
        )}
      </Layout>
    </CampsiteProvider>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
