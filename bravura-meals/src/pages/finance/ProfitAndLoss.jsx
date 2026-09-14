import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.finance || '#1565C0'

export default function ProfitAndLoss({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [accounts, setAccounts] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(0, 1)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10))

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [acctRes, lineRes] = await Promise.all([
      supabase.from('accounts').select('id, code, name, account_type, sub_type').eq('site_id', currentSiteId).eq('is_archived', false).in('account_type', ['Revenue', 'Expense']).order('code'),
      supabase.from('journal_lines').select('account_id, debit, credit, journal_entries!inner(site_id, status, entry_date, is_archived)').eq('journal_entries.site_id', currentSiteId).eq('journal_entries.status', 'posted').eq('journal_entries.is_archived', false),
    ])
    if (acctRes.error) showToast('Failed to load accounts', 'error')
    if (lineRes.error) showToast('Failed to load journal lines', 'error')
    setAccounts(acctRes.data || [])
    setLines(lineRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const report = useMemo(() => {
    const filtered = lines.filter(l => {
      const d = l.journal_entries?.entry_date
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      return true
    })

    const map = {}
    filtered.forEach(l => {
      if (!map[l.account_id]) map[l.account_id] = { debit: 0, credit: 0 }
      map[l.account_id].debit += Number(l.debit || 0)
      map[l.account_id].credit += Number(l.credit || 0)
    })

    const revenueAccounts = accounts.filter(a => a.account_type === 'Revenue').map(a => {
      const net = (map[a.id]?.credit || 0) - (map[a.id]?.debit || 0)
      return { ...a, amount: net }
    }).filter(r => Math.abs(r.amount) > 0.005)

    const expenseAccounts = accounts.filter(a => a.account_type === 'Expense').map(a => {
      const net = (map[a.id]?.debit || 0) - (map[a.id]?.credit || 0)
      return { ...a, amount: net }
    }).filter(r => Math.abs(r.amount) > 0.005)

    const totalRevenue = revenueAccounts.reduce((s, r) => s + r.amount, 0)
    const totalExpenses = expenseAccounts.reduce((s, r) => s + r.amount, 0)
    const netIncome = totalRevenue - totalExpenses

    return { revenueAccounts, expenseAccounts, totalRevenue, totalExpenses, netIncome }
  }, [accounts, lines, dateFrom, dateTo])

  const fmt = v => {
    const neg = v < 0
    return `${neg ? '(' : ''}$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2 })}${neg ? ')' : ''}`
  }

  const Section = ({ title, rows, total, totalLabel }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: THEME.text, padding: '10px 14px', borderBottom: `2px solid ${THEME.outline}`, background: THEME.surfaceVar }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
              <td style={{ padding: '8px 14px', width: 80, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{r.code}</td>
              <td style={{ padding: '8px 14px', color: THEME.text }}>{r.name}</td>
              <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 140 }}>{fmt(r.amount)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={3} style={{ padding: '8px 14px', color: THEME.textMed, fontStyle: 'italic' }}>No activity</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${THEME.outline}`, fontWeight: 700 }}>
            <td colSpan={2} style={{ padding: '10px 14px', textAlign: 'right' }}>{totalLabel}</td>
            <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Profit & Loss</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>Income Statement</div>
        </div>
        <button onClick={() => exportCsv([...report.revenueAccounts, ...report.expenseAccounts].map(r => ({ Code: r.code, Name: r.name, Type: r.account_type, Amount: r.amount })), 'profit_and_loss')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>Export
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed }}>Period:</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
        <span style={{ color: THEME.textMed, fontSize: 13 }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
          <Section title="Revenue" rows={report.revenueAccounts} total={report.totalRevenue} totalLabel="Total Revenue" />
          <Section title="Expenses" rows={report.expenseAccounts} total={report.totalExpenses} totalLabel="Total Expenses" />

          <div style={{ padding: '14px', borderTop: `3px solid ${THEME.outline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: THEME.text }}>Net Income</span>
            <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: report.netIncome >= 0 ? THEME.success : THEME.error }}>{fmt(report.netIncome)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
