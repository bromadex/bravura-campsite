import { useState, useEffect } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import Denied from '../../components/Denied'
import FinShell from '../../components/FinShell'
import FixedAssets from './FixedAssets'
import AssetDepreciation from './AssetDepreciation'
import AssetVerification from './AssetVerification'

// FI28 — Fixed assets hub (was three pages: register FI16, depreciation FI17, counts FI18).
const TABS = [
  { key: 'register', label: 'Asset register', hint: 'Plant, vehicles, buildings and equipment at cost and book value' },
  { key: 'depreciation', label: 'Depreciation', hint: 'Monthly run that posts depreciation to the ledger' },
  { key: 'counts', label: 'Asset counts', hint: 'Physical verification — found, missing, moved' },
]

export default function FinanceAssets({ setPage, initialTab = 'register' }) {
  const { can } = usePermissions()
  const [tab, setTab] = useState(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  if (!can('assets.view') && !can('finance.view')) return <Denied />
  const t = TABS.find(x => x.key === tab) || TABS[0]
  return (
    <FinShell title="Fixed assets" subtitle={t.hint} tabs={TABS} tab={tab} onTab={setTab} setPage={setPage}>
      {tab === 'register' && <FixedAssets setPage={setPage} />}
      {tab === 'depreciation' && <AssetDepreciation setPage={setPage} />}
      {tab === 'counts' && <AssetVerification setPage={setPage} />}
    </FinShell>
  )
}
