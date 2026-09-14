import { useState, useEffect, useMemo } from 'react'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

export default function CostCentreReport({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [centres, setCentres] = useState([])
  const [lines, setLines] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(0, 1)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(new Date().toISOString().slice(0, 10))
  const [selectedCentre, setSelectedCentre] = useState('')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [ccRes, lineRes, acctRes] = await Promise.all([
      supabase.from('cost_centres').select('id, code, name, module').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
      supabase.from('journal_lines').select('account_id, debit, credit, cost_centre_id, journal_entries!inner(site_id, status, entry_date, is_archived)').eq('journal_entries.site_id', currentSiteId).eq('journal_entries.status', 'posted').eq('journal_entries.is_archived', false).not('cost_centre_id', 'is', null),
      supabase.from('accounts').select('id, code, name, account_type').eq('site_id', currentSiteId).eq('is_archived', false),
    ])
    if (ccRes.error) showToast('Failed to load cost centres', 'error')
    if (lineRes.error) showToast('Failed to load journal lines', 'error')
    setCentres(ccRes.data || [])
    setLines(lineRes.data || [])
    setAccounts(acctRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const report = useMemo(() => {
    const filtered = lines.filter(l => {
      const d = l.journal_entries?.entry_date
      if (dateFrom && d < dateFrom) return false
      if (dateTo && d > dateTo) return false
      if (selectedCentre && l.cost_centre_id !== selectedCentre) return false
      return true
    })

    const byCentre = {}
    filtered.forEach(l => {
      const ccId = l.cost_centre_id
      if (!byCentre[ccId]) byCentre[ccId] = {}
      if (!byCentre[ccId][l.account_id]) byCentre[ccId][l.account_id] = { debit: 0, credit: 0 }
      byCentre[ccId][l.account_id].debit += Number(l.debit || 0)
      byCentre[ccId][l.account_id].credit += Number(l.credit || 0)
    })

    const acctMap = {}
    accounts.forEach(a => { acctMap[a.id] = a })
    const ccMap = {}
    centres.forEach(c => { ccMap[c.id] = c })

    const summary = centres.map(c => {
      const accts = byCentre[c.id] || {}
      let totalDebit = 0, totalCredit = 0
      const rows = Object.entries(accts).map(([aid, totals]) => {
        totalDebit += totals.debit
        totalCredit += totals.credit
        return { account: acctMap[aid], ...totals }
      }).filter(r => r.account)

      return { centre: c, rows, totalDebit, totalCredit, netSpend: totalDebit - totalCredit }
    }).filter(s => s.rows.length > 0)

    const grandTotal = summary.reduce((s, c) => s + c.netSpend, 0)
    return { summary, grandTotal }
  }, [centres, lines, accounts, dateFrom, dateTo, selectedCentre])

  const fmt = v => {
    const neg = v < 0
    return `${neg ? '(' : ''}$${Math.abs(v).toLocaleString('en', { minimumFractionDigits: 2 })}${neg ? ')' : ''}`
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Cost Centre Report</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>Spending breakdown by cost centre</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setPage('fi_cost_centres')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>settings</span>Manage
          </button>
          <button onClick={() => {
            const rows = []
            report.summary.forEach(s => s.rows.forEach(r => rows.push({ CostCentre: s.centre.name, Account: r.account.name, Debit: r.debit, Credit: r.credit })))
            exportCsv(rows, 'cost_centre_report')
          }} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>Export
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed }}>Period:</label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
        <span style={{ color: THEME.textMed, fontSize: 13 }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
        <select value={selectedCentre} onChange={e => setSelectedCentre(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
          <option value="">All Cost Centres</option>
          {centres.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : report.summary.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', marginBottom: 12 }}>category</span>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No cost centre activity in this period</div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Tag journal lines with a cost centre to see data here</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {report.summary.map(s => (
            <div key={s.centre.id} style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
              <div style={{ padding: '12px 14px', borderBottom: `2px solid ${THEME.outline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: THEME.surfaceVar }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 700, color: THEME.text }}>{s.centre.code}</span>
                  <span style={{ fontSize: 14, color: THEME.text, marginLeft: 8 }}>{s.centre.name}</span>
                  {s.centre.module && <span style={{ fontSize: 11, color: THEME.textMed, marginLeft: 8, textTransform: 'uppercase' }}>{s.centre.module}</span>}
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: s.netSpend > 0 ? THEME.error : THEME.success }}>{fmt(s.netSpend)}</span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <tbody>
                  {s.rows.map(r => (
                    <tr key={r.account.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 14px', width: 80, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{r.account.code}</td>
                      <td style={{ padding: '8px 14px', color: THEME.text }}>{r.account.name}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 120 }}>{r.debit > 0 ? fmt(r.debit) : ''}</td>
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 120 }}>{r.credit > 0 ? fmt(r.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, padding: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: THEME.text }}>Grand Total Net Spend</span>
            <span style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: report.grandTotal > 0 ? THEME.error : THEME.success }}>{fmt(report.grandTotal)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
