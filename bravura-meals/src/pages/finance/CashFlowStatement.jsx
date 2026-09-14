import { useState, useEffect, useMemo } from 'react'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const OPERATING_TYPES = ['Revenue', 'Expense']
const INVESTING_SUBTYPES = ['Fixed Asset', 'Long Term Investment', 'Investment']
const FINANCING_SUBTYPES = ['Long Term Liability', 'Loan', 'Equity', 'Retained Earnings', 'Share Capital']

export default function CashFlowStatement({ setPage }) {
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
      supabase.from('accounts').select('id, code, name, account_type, sub_type').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
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

    const getNet = (a) => {
      const d = map[a.id]?.debit || 0
      const c = map[a.id]?.credit || 0
      if (a.account_type === 'Asset' || a.account_type === 'Expense') return d - c
      return c - d
    }

    const operating = []
    const investing = []
    const financing = []

    accounts.forEach(a => {
      const net = getNet(a)
      if (Math.abs(net) < 0.005) return

      const sub = (a.sub_type || '').toLowerCase()
      if (INVESTING_SUBTYPES.some(s => sub.includes(s.toLowerCase()))) {
        investing.push({ ...a, amount: -net })
      } else if (FINANCING_SUBTYPES.some(s => sub.includes(s.toLowerCase()))) {
        financing.push({ ...a, amount: net })
      } else if (OPERATING_TYPES.includes(a.account_type)) {
        operating.push({ ...a, amount: a.account_type === 'Revenue' ? net : -net })
      } else if (a.account_type === 'Asset' && sub !== 'bank' && sub !== 'cash') {
        operating.push({ ...a, amount: -net })
      } else if (a.account_type === 'Liability' && !FINANCING_SUBTYPES.some(s => sub.includes(s.toLowerCase()))) {
        operating.push({ ...a, amount: net })
      }
    })

    const totalOp = operating.reduce((s, r) => s + r.amount, 0)
    const totalInv = investing.reduce((s, r) => s + r.amount, 0)
    const totalFin = financing.reduce((s, r) => s + r.amount, 0)
    const netChange = totalOp + totalInv + totalFin

    return { operating, investing, financing, totalOp, totalInv, totalFin, netChange }
  }, [accounts, lines, dateFrom, dateTo])

  const fmt = v => {
    const neg = v < 0
    return `${neg ? '(' : ''}$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2 })}${neg ? ')' : ''}`
  }

  const Section = ({ title, rows, total, totalLabel, color }) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: THEME.text, padding: '10px 14px', borderBottom: `2px solid ${THEME.outline}`, background: THEME.surfaceVar }}>
        <span className="material-symbols-rounded" style={{ fontSize: 18, verticalAlign: 'middle', marginRight: 6, color }}>{title === 'Operating Activities' ? 'settings' : title === 'Investing Activities' ? 'trending_up' : 'account_balance'}</span>
        {title}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
              <td style={{ padding: '8px 14px', width: 80, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{r.code}</td>
              <td style={{ padding: '8px 14px', color: THEME.text }}>{r.name}</td>
              <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 140, color: r.amount < 0 ? THEME.error : THEME.text }}>{fmt(r.amount)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={3} style={{ padding: '8px 14px', color: THEME.textMed, fontStyle: 'italic' }}>No activity</td></tr>
          )}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: `2px solid ${THEME.outline}`, fontWeight: 700 }}>
            <td colSpan={2} style={{ padding: '10px 14px', textAlign: 'right' }}>{totalLabel}</td>
            <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: total < 0 ? THEME.error : THEME.success }}>{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Cash Flow Statement</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>Indirect Method</div>
        </div>
        <button onClick={() => exportCsv([...report.operating, ...report.investing, ...report.financing].map(r => ({ Code: r.code, Name: r.name, Section: OPERATING_TYPES.includes(r.account_type) ? 'Operating' : 'Other', Amount: r.amount })), 'cash_flow')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
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
          <Section title="Operating Activities" rows={report.operating} total={report.totalOp} totalLabel="Net Cash from Operations" color={THEME.success} />
          <Section title="Investing Activities" rows={report.investing} total={report.totalInv} totalLabel="Net Cash from Investing" color={THEME.info} />
          <Section title="Financing Activities" rows={report.financing} total={report.totalFin} totalLabel="Net Cash from Financing" color={THEME.warning} />

          <div style={{ padding: '14px', borderTop: `3px solid ${THEME.outline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: THEME.text }}>Net Change in Cash</span>
            <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: report.netChange >= 0 ? THEME.success : THEME.error }}>{fmt(report.netChange)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
