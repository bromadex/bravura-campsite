import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthContext'
import LoginPage from './auth/LoginPage'
import Layout from './components/Layout'

// Pages
import Dashboard from './pages/Dashboard'
import DailyEntry from './pages/DailyEntry'
import Approvals from './pages/Approvals'
import KitchenConfirm from './pages/KitchenConfirm'
import DailyReport from './pages/DailyReport'
import RangeReport from './pages/RangeReport'
import MonthlyReport from './pages/MonthlyReport'
import Billing from './pages/Billing'
import Employees from './pages/Employees'
import Pricing from './pages/Pricing'
import Flags from './pages/Flags'
import Settings from './pages/Settings'

function AppContent() {
  const { user, profile, loading } = useAuth()
  const [page, setPage] = useState('dashboard')

  if (loading) return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#1F3864', color: '#fff', fontSize: '16px', fontFamily: "'Segoe UI', Arial, sans-serif",
    }}>
      Loading…
    </div>
  )

  if (!user || !profile) return <LoginPage />

  const role = profile.role

  // Guard page access based on role
  function getPage() {
    switch (page) {
      case 'dashboard':  return <Dashboard setPage={setPage} />
      case 'entry':      return ['super_admin','meal_officer'].includes(role) ? <DailyEntry /> : null
      case 'approvals':  return ['super_admin','approver'].includes(role) ? <Approvals /> : null
      case 'kitchen':    return ['super_admin','kitchen'].includes(role) ? <KitchenConfirm /> : null
      case 'daily':      return !['kitchen'].includes(role) ? <DailyReport /> : null
      case 'range':      return !['kitchen'].includes(role) ? <RangeReport /> : null
      case 'monthly':    return !['kitchen'].includes(role) ? <MonthlyReport /> : null
      case 'billing':    return ['super_admin','approver','kitchen_owner'].includes(role) ? <Billing /> : null
      case 'employees':  return ['super_admin','meal_officer'].includes(role) ? <Employees /> : null
      case 'pricing':    return ['super_admin','kitchen_owner'].includes(role) ? <Pricing /> : null
      case 'flags':      return <Flags />
      case 'settings':   return role === 'super_admin' ? <Settings /> : null
      default:           return <Dashboard setPage={setPage} />
    }
  }

  const content = getPage()

  return (
    <Layout page={page} setPage={setPage}>
      {content || (
        <div style={{ textAlign: 'center', padding: '80px 24px', color: '#888' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
          <p>You don't have access to this section.</p>
        </div>
      )}
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}
