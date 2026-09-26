import { useState, lazy, Suspense } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN } from '../../utils/financeTheme'

// FL18 — Fleet settings (issue #66, A5): set-up screens live here as tabs instead of in the sidebar (as in Stores).
const FleetSettings = lazy(() => import('./FleetSettings'))
const FleetDrivers  = lazy(() => import('./FleetDrivers'))
const FleetTyres    = lazy(() => import('./FleetTyres'))

const TABS = [['general', 'General', FleetSettings], ['drivers', 'Drivers & licences', FleetDrivers], ['tyres', 'Tyres', FleetTyres]]

export default function FleetSetup({ setPage, initialTab = 'general' }) {
  const { can } = usePermissions()
  const [tab, setTab] = useState(TABS.some(t => t[0] === initialTab) ? initialTab : 'general')
  if (!can('fleet.view')) return <Denied />
  const Comp = TABS.find(t => t[0] === tab)[2]
  return (
    <FinShell module="Fleet" homePage="fleet_dashboard" setPage={setPage} title="Settings"
      tabs={TABS.map(([key, label]) => ({ key, label }))} tab={tab} onTab={setTab}>
      <Suspense fallback={<div style={{ color: FIN.faint }}>Loading…</div>}><Comp setPage={setPage} /></Suspense>
    </FinShell>
  )
}
