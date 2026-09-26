import { useState, lazy, Suspense } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN } from '../../utils/financeTheme'

// Fuel hubs (issue #73): screens that did the same job are tabs of one page instead of separate menu items.
//  history — Issues (edit / query) · All movements (deliveries, issues, transfers)
//  issue   — At the pump (phone) · Office / batch (paper slips, many rows)
//  dips    — Dipstick log · Gaps & sign-off · Pump shifts · Month-end
//  requests — Requests · New request
//  reports — Summary · Per machine · Cost allocation · Forecast · Daily · Monthly · Deliveries
const PAGES = {
  issues:       lazy(() => import('./FuelIssues')),
  transactions: lazy(() => import('./FuelTransactions')),
  summary:      lazy(() => import('./FuelReports')),
  machines:     lazy(() => import('./VehicleConsumption')),
  allocation:   lazy(() => import('./CostAllocation')),
  forecast:     lazy(() => import('./Forecasting')),
  daily:        lazy(() => import('./reports/DailyTransactionReport')),
  monthly:      lazy(() => import('./reports/MonthlyConsumptionReport')),
  deliveries:   lazy(() => import('./reports/DeliveryReport')),
  pump:         lazy(() => import('./FuelPump')),
  office:       lazy(() => import('./FuelIssuance')),
  import:       lazy(() => import('./FuelImport')),
  diplog:       lazy(() => import('./DipReadings')),
  gaps:         lazy(() => import('./Reconciliation').then(m => ({ default: withSite(m.DipsTab) }))),
  shifts:       lazy(() => import('./Reconciliation').then(m => ({ default: withSite(m.ShiftsTab) }))),
  monthend:     lazy(() => import('./Reconciliation').then(m => ({ default: withSite(m.MonthTab) }))),
  requests:     lazy(() => import('./FuelRequests')),
  newrequest:   lazy(() => import('./FuelRequestForm')),
}
// the reconciliation tabs take siteId + can instead of reading them
function withSite(Comp) {
  return function SiteTab() {
    const { can } = usePermissions()
    const { currentSite } = useSite()
    return currentSite?.id ? <Comp siteId={currentSite.id} can={can} /> : null
  }
}
export const HUBS = {
  issue:    { title: 'Issue fuel', perm: 'fuel.create', tabs: [['pump', 'At the pump'], ['office', 'Office / batch'], ['import', 'Import from Excel']] },
  dips:     { title: 'Dips', perm: 'fuel.create', tabs: [['diplog', 'Dipstick log'], ['gaps', 'Gaps & sign-off'], ['shifts', 'Pump shifts'], ['monthend', 'Month-end']] },
  requests: { title: 'Fuel requests', tabs: [['requests', 'Requests'], ['newrequest', 'New request']] },
  history: { title: 'Transactions', tabs: [['issues', 'Issues'], ['transactions', 'All movements']] },
  reports: { title: 'Reports', tabs: [['summary', 'Summary'], ['machines', 'Per machine'], ['allocation', 'Cost allocation'], ['forecast', 'Forecast'],
                                     ['daily', 'Daily'], ['monthly', 'Monthly'], ['deliveries', 'Deliveries']] },
}

export default function FuelHub({ hub, initialTab, setPage }) {
  const { can } = usePermissions()
  const h = HUBS[hub]
  const [tab, setTab] = useState(h.tabs.some(t => t[0] === initialTab) ? initialTab : h.tabs[0][0])
  if (!can(h.perm || 'fuel.view') && !can('fuel.view')) return <Denied />
  const Comp = PAGES[tab]
  return (
    <FinShell module="Fuel" homePage="fuel_dashboard" setPage={setPage} title={h.title}
      tabs={h.tabs.map(([key, label]) => ({ key, label }))} tab={tab} onTab={setTab}>
      <Suspense fallback={<div style={{ color: FIN.faint }}>Loading…</div>}><Comp key={tab} setPage={setPage} /></Suspense>
    </FinShell>
  )
}
