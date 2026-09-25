import { useState, useEffect } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import Denied from '../../components/Denied'
import FinShell from '../../components/FinShell'
import ChartOfAccounts from './ChartOfAccounts'
import JournalEntries from './JournalEntries'
import CostCentres from './CostCentres'
import PostingRules from './PostingRules'

// FI26 — Ledger hub: the books in one place (was four separate pages: Chart of Accounts FI01,
// Journal Entries FI02, Cost Centres FI10, Posting Rules FI13 — those codes now open a tab here).
const TABS = [
  { key: 'accounts', label: 'Chart of accounts', hint: 'Every account the books use, with balances' },
  { key: 'journals', label: 'Journal entries', hint: 'Everything posted — automatic and manual' },
  { key: 'rules', label: 'Posting rules', hint: 'Which accounts each ERP event posts to, and what is waiting' },
  { key: 'centres', label: 'Cost centres', hint: 'Where costs are tagged: departments, areas, activities' },
]

export default function FinanceLedger({ setPage, initialTab = 'accounts' }) {
  const { can } = usePermissions()
  const [tab, setTab] = useState(initialTab)
  useEffect(() => { setTab(initialTab) }, [initialTab])
  if (!can('finance.view')) return <Denied />
  const t = TABS.find(x => x.key === tab) || TABS[0]
  return (
    <FinShell title="Ledger" subtitle={t.hint} tabs={TABS} tab={tab} onTab={setTab} setPage={setPage}>
      {tab === 'accounts' && <ChartOfAccounts setPage={setPage} />}
      {tab === 'journals' && <JournalEntries setPage={setPage} />}
      {tab === 'rules' && <PostingRules setPage={setPage} />}
      {tab === 'centres' && <CostCentres setPage={setPage} />}
    </FinShell>
  )
}
