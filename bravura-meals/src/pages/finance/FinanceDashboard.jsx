import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'

const color = MODULE_COLORS.finance || '#1565C0'

export default function FinanceDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [accounts, setAccounts] = useState([])
  const [entries, setEntries] = useState([])
  const [lines, setLines] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [statementLines, setStatementLines] = useState([])
  const [loading, setLoading] = useState(true)

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [acctRes, entryRes, lineRes, bankRes, stmtRes] = await Promise.all([
      supabase.from('accounts').select('id, code, name, account_type, sub_type, balance').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('journal_entries').select('id, status, entry_date, created_at').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('journal_lines').select('account_id, debit, credit, journal_entries!inner(site_id, status, entry_date, is_archived)').eq('journal_entries.site_id', currentSiteId).eq('journal_entries.status', 'posted').eq('journal_entries.is_archived', false),
      supabase.from('bank_accounts').select('id, name, current_balance, currency, is_active').eq('site_id', currentSiteId).eq('is_active', true),
      supabase.from('bank_statement_lines').select('id, is_reconciled, bank_account_id').eq('site_id', currentSiteId),
    ])
    if (acctRes.error) showToast('Failed to load accounts', 'error')
    setAccounts(acctRes.data || [])
    setEntries(entryRes.data || [])
    setLines(lineRes.data || [])
    setBankAccounts(bankRes.data || [])
    setStatementLines(stmtRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const stats = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const monthEnd = now.toISOString().slice(0, 10)

    const monthLines = lines.filter(l => {
      const d = l.journal_entries?.entry_date
      return d >= monthStart && d <= monthEnd
    })

    const map = {}
    monthLines.forEach(l => {
      if (!map[l.account_id]) map[l.account_id] = { debit: 0, credit: 0 }
      map[l.account_id].debit += Number(l.debit || 0)
      map[l.account_id].credit += Number(l.credit || 0)
    })

    let monthRevenue = 0, monthExpenses = 0
    accounts.forEach(a => {
      const d = map[a.id]?.debit || 0
      const c = map[a.id]?.credit || 0
      if (a.account_type === 'Revenue') monthRevenue += (c - d)
      if (a.account_type === 'Expense') monthExpenses += (d - c)
    })

    const cashAccounts = accounts.filter(a => a.account_type === 'Asset' && ((a.sub_type || '').toLowerCase().includes('bank') || (a.sub_type || '').toLowerCase().includes('cash')))
    const cashPosition = cashAccounts.reduce((s, a) => s + Number(a.balance || 0), 0)

    const pendingApprovals = entries.filter(e => e.status === 'draft').length
    const unreconciledCount = statementLines.filter(s => !s.is_reconciled).length

    return { cashPosition, monthRevenue, monthExpenses, netPL: monthRevenue - monthExpenses, pendingApprovals, unreconciledCount }
  }, [accounts, entries, lines, statementLines])

  const fmt = v => {
    const neg = v < 0
    return `${neg ? '(' : ''}$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2 })}${neg ? ')' : ''}`
  }

  const Tile = ({ icon, label, value, valueColor, onClick }) => (
    <div onClick={onClick} style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, padding: '16px 20px', cursor: onClick ? 'pointer' : 'default', flex: '1 1 220px', minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 20, color: THEME.textMed }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: valueColor || THEME.text }}>{value}</div>
    </div>
  )

  const QuickLink = ({ icon, label, page }) => (
    <button onClick={() => setPage(page)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 10, cursor: 'pointer', width: '100%', textAlign: 'left', fontFamily: 'inherit', fontSize: 13, color: THEME.text }}>
      <span className="material-symbols-rounded" style={{ fontSize: 20, color }}>{icon}</span>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span className="material-symbols-rounded" style={{ fontSize: 16, color: THEME.textMed, marginLeft: 'auto' }}>chevron_right</span>
    </button>
  )

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Finance Dashboard</h1>
        <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{currentSite?.name || 'All Sites'} — {new Date().toLocaleDateString('en', { month: 'long', year: 'numeric' })}</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Tile icon="account_balance_wallet" label="Cash Position" value={fmt(stats.cashPosition)} valueColor={stats.cashPosition >= 0 ? THEME.success : THEME.error} />
            <Tile icon="trending_up" label="Monthly Revenue" value={fmt(stats.monthRevenue)} valueColor={THEME.success} />
            <Tile icon="trending_down" label="Monthly Expenses" value={fmt(stats.monthExpenses)} valueColor={THEME.error} />
            <Tile icon="balance" label="Net P&L" value={fmt(stats.netPL)} valueColor={stats.netPL >= 0 ? THEME.success : THEME.error} />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Tile icon="pending_actions" label="Draft Entries" value={stats.pendingApprovals} onClick={() => setPage('fi_journal_entries')} />
            <Tile icon="rule" label="Unreconciled Items" value={stats.unreconciledCount} onClick={() => setPage('fi_bank_accounts')} />
            <Tile icon="account_tree" label="GL Accounts" value={accounts.length} onClick={() => setPage('fi_chart_of_accounts')} />
            <Tile icon="account_balance" label="Bank Accounts" value={bankAccounts.length} onClick={() => setPage('fi_bank_accounts')} />
          </div>

          <h2 style={{ fontSize: 16, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>Quick Links</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            <QuickLink icon="account_balance" label="Chart of Accounts" page="fi_chart_of_accounts" />
            <QuickLink icon="receipt_long" label="Journal Entries" page="fi_journal_entries" />
            <QuickLink icon="account_balance_wallet" label="Bank Accounts" page="fi_bank_accounts" />
            <QuickLink icon="balance" label="Trial Balance" page="fi_trial_balance" />
            <QuickLink icon="trending_up" label="Profit & Loss" page="fi_profit_and_loss" />
            <QuickLink icon="account_tree" label="Balance Sheet" page="fi_balance_sheet" />
            <QuickLink icon="water_drop" label="Cash Flow" page="fi_cash_flow" />
            <QuickLink icon="category" label="Cost Centres" page="fi_cost_centres" />
            <QuickLink icon="bar_chart" label="Cost Centre Report" page="fi_cost_report" />
          </div>
        </>
      )}
    </div>
  )
}
