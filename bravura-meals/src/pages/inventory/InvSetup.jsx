import { useState, lazy, Suspense } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN } from '../../utils/financeTheme'

// IN12 — Stores settings (user, 25 Sep): the set-up screens live here as tabs instead of in the sidebar.
const InvSettings   = lazy(() => import('./InvSettings'))
const InvWarehouses = lazy(() => import('./InvWarehouses'))
const InvBins       = lazy(() => import('./InvBins'))
const InvKits       = lazy(() => import('./InvKits'))
const InvCategories = lazy(() => import('./InvCategories'))
const InvImport     = lazy(() => import('./InvImport'))

const TABS = [
  ['general', 'General', InvSettings], ['stores', 'Stores', InvWarehouses], ['bins', 'Bins & labels', InvBins],
  ['kits', 'Kits', InvKits], ['categories', 'Categories & units', InvCategories], ['import', 'Import items', InvImport],
]

export default function InvSetup({ setPage, initialTab = 'general' }) {
  const { can } = usePermissions()
  const [tab, setTab] = useState(TABS.some(t => t[0] === initialTab) ? initialTab : 'general')
  if (!can('inventory.view')) return <Denied />
  const Comp = TABS.find(t => t[0] === tab)[2]
  return (
    <FinShell module="Stores" homePage="inv_dashboard" setPage={setPage} title="Settings"
      tabs={TABS.map(([key, label]) => ({ key, label }))} tab={tab} onTab={setTab}>
      <Suspense fallback={<div style={{ color: FIN.faint }}>Loading…</div>}><Comp setPage={setPage} /></Suspense>
    </FinShell>
  )
}
