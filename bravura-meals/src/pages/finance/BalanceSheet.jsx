import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.finance || '#1565C0'

export default function BalanceSheet({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [accounts, setAccounts] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10))

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [acctRes, lineRes] = await Promise.all([
      supabase.from('accounts').select('id, code, name, account_type, sub_type, balance').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
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
      if (asOf && d > asOf) return false
      return true
    })

    const map = {}
    filtered.forEach(l => {
      if (!map[l.account_id]) map[l.account_id] = { debit: 0, credit: 0 }
      map[l.account_id].debit += Number(l.debit || 0)
      map[l.account_id].credit += Number(l.credit || 0)
    })

    const calc = (type) => accounts.filter(a => a.account_type === type).map(a => {
      const d = map[a.id]?.debit || 0
      const c = map[a.id]?.credit || 0
      const balance = (type === 'Asset' || type === 'Expense') ? (d - c) : (c - d)
      return { ...a, balance: balance }
    }).filter(r => Math.abs(r.balance) > 0.005)

    const assets = calc('Asset')
    const liabilities = calc('Liability')
    const equity = calc('Equity')

    const revenueLines = accounts.filter(a => a.account_type === 'Revenue').reduce((s, a) => {
      const d = map[a.id]?.debit || 0; const c = map[a.id]?.credit || 0
      return s + (c - d)
    }, 0)
    const expenseLines = accounts.filter(a => a.account_type === 'Expense').reduce((s, a) => {
      const d = map[a.id]?.debit || 0; const c = map[a.id]?.credit || 0
      return s + (d - c)
    }, 0)
    const retainedEarnings = revenueLines - expenseLines

    const totalAssets = assets.reduce((s, r) => s + r.balance, 0)
    const totalLiabilities = liabilities.reduce((s, r) => s + r.balance, 0)
    const totalEquity = equity.reduce((s, r) => s + r.balance, 0) + retainedEarnings

    return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, retainedEarnings, isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.005 }
  }, [accounts, lines, asOf])

  const fmt = v => {
    const neg = v < 0
    return `${neg ? '(' : ''}$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2 })}${neg ? ')' : ''}`
  }

  const Section = ({ title, rows, total, totalLabel, extra }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: THEME.text, padding: '10px 14px', borderBottom: `2px solid ${THEME.outline}`, background: THEME.surfaceVar }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
              <td style={{ padding: '8px 14px', width: 80, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{r.code}</td>
              <td style={{ padding: '8px 14px', color: THEME.text }}>{r.name}</td>
              <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 140 }}>{fmt(r.balance)}</td>
            </tr>
          ))}
          {extra}
          {rows.length === 0 && !extra && (
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
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Balance Sheet</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>Statement of Financial Position</div>
        </div>
        <button onClick={() => exportCsv([...report.assets, ...report.liabilities, ...report.equity].map(r => ({ Code: r.code, Name: r.name, Type: r.account_type, Balance: r.balance })), 'balance_sheet')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>Export
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed }}>As of:</label>
        <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
        {!report.isBalanced && (report.assets.length > 0 || report.liabilities.length > 0 || report.equity.length > 0) && (
          <span style={{ fontSize: 12, fontWeight: 600, color: '#C62828', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>warning</span>
            Out of balance by {fmt(report.totalAssets - (report.totalLiabilities + report.totalEquity))}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
          <Section title="Assets" rows={report.assets} total={report.totalAssets} totalLabel="Total Assets" />
          <Section title="Liabilities" rows={report.liabilities} total={report.totalLiabilities} totalLabel="Total Liabilities" />
          <Section
            title="Equity"
            rows={report.equity}
            total={report.totalEquity}
            totalLabel="Total Equity"
            extra={Math.abs(report.retainedEarnings) > 0.005 ? (
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <td style={{ padding: '8px 14px', width: 80, fontWeight: 600, color: THEME.textMed }}></td>
                <td style={{ padding: '8px 14px', color: THEME.text, fontStyle: 'italic' }}>Retained Earnings (Current Period)</td>
                <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 140 }}>{fmt(report.retainedEarnings)}</td>
              </tr>
            ) : null}
          />

          <div style={{ padding: '14px', borderTop: `3px solid ${THEME.outline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: THEME.text }}>Liabilities + Equity</span>
            <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmt(report.totalLiabilities + report.totalEquity)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
