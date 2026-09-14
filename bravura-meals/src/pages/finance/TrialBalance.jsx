import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.finance || '#1565C0'

export default function TrialBalance({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [accounts, setAccounts] = useState([])
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10))

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

    const rows = accounts.map(a => ({
      ...a,
      periodDebit: map[a.id]?.debit || 0,
      periodCredit: map[a.id]?.credit || 0,
    })).filter(r => r.periodDebit > 0 || r.periodCredit > 0 || Number(r.balance) !== 0)

    const totalDebit = rows.reduce((s, r) => s + r.periodDebit, 0)
    const totalCredit = rows.reduce((s, r) => s + r.periodCredit, 0)

    return { rows, totalDebit, totalCredit, isBalanced: Math.abs(totalDebit - totalCredit) < 0.005 }
  }, [accounts, lines, dateFrom, dateTo])

  const fmt = v => `$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2 })}`

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Trial Balance</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{report.rows.length} accounts with activity</div>
        </div>
        <button onClick={() => exportCsv(report.rows.map(r => ({ Code: r.code, Name: r.name, Type: r.account_type, Debit: r.periodDebit, Credit: r.periodCredit, Balance: r.balance })), 'trial_balance')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>Export
        </button>
      </div>

      {/* Date filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed }}>Period:</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
        <span style={{ color: THEME.textMed, fontSize: 13 }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
        {!report.isBalanced && report.rows.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 600, color: '#C62828', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>warning</span>
            Out of balance by {fmt(report.totalDebit - report.totalCredit)}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : report.rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', marginBottom: 12 }}>balance</span>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No posted journal entries in this period</div>
        </div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Account</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Type</th>
                  <th style={{ textAlign: 'right', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Debit</th>
                  <th style={{ textAlign: 'right', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Credit</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => setPage('fi_journal_entries')}>
                    <td style={{ padding: '10px 14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{r.code}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{r.name}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed, fontSize: 12 }}>{r.account_type}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.periodDebit > 0 ? fmt(r.periodDebit) : ''}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.periodCredit > 0 ? fmt(r.periodCredit) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${THEME.outline}`, fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '10px 14px', textAlign: 'right' }}>Totals</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(report.totalDebit)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(report.totalCredit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
