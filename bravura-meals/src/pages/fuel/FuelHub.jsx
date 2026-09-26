import { useState, lazy, Suspense } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN } from '../../utils/financeTheme'

// Fuel hubs (issue #73): screens that did the same job are tabs of one page instead of separate menu items.
//  history — Issues (edit / query) · All movements (deliveries, issues, transfers)
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
}
export const HUBS = {
  history: { title: 'Transactions', tabs: [['issues', 'Issues'], ['transactions', 'All movements']] },
  reports: { title: 'Reports', tabs: [['summary', 'Summary'], ['machines', 'Per machine'], ['allocation', 'Cost allocation'], ['forecast', 'Forecast'],
                                     ['daily', 'Daily'], ['monthly', 'Monthly'], ['deliveries', 'Deliveries']] },
}

export default function FuelHub({ hub, initialTab, setPage }) {
  const { can } = usePermissions()
  const h = HUBS[hub]
  const [tab, setTab] = useState(h.tabs.some(t => t[0] === initialTab) ? initialTab : h.tabs[0][0])
  if (!can('fuel.view')) return <Denied />
  const Comp = PAGES[tab]
  return (
    <FinShell module="Fuel" homePage="fuel_dashboard" setPage={setPage} title={h.title}
      tabs={h.tabs.map(([key, label]) => ({ key, label }))} tab={tab} onTab={setTab}>
      <Suspense fallback={<div style={{ color: FIN.faint }}>Loading…</div>}><Comp key={tab} setPage={setPage} /></Suspense>
    </FinShell>
  )
}
