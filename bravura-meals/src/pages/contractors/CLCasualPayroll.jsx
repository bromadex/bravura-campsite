import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, PageHeader, Button, TableWrap, THead, Th, TRow, Td, showToast, StatCard } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import QuickNav, { CONTRACTOR_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.contractors
const fmt = n => n == null ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function firstOfMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function CLCasualPayroll({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('casual_timesheets', { column: 'site_id', value: currentSiteId })

  const [fromDate, setFromDate] = useState(firstOfMonth)
  const [toDate, setToDate] = useState(todayStr)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState(null) // null = not yet calculated

  if (!can('contractors.view')) return null

  async function calculate() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('casual_timesheets')
      .select('id, casual_worker_id, date, hours_worked, overtime_hours, normal_cost, overtime_cost, total_cost, casual_worker:casual_workers(id, name, trade, rate_type, rate, overtime_rate, bank_name, bank_account, contractor:contractors(id, name))')
      .eq('site_id', currentSiteId)
      .eq('status', 'approved')
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('date', { ascending: true })

    setLoading(false)
    if (error) { showToast('Error loading timesheets: ' + error.message, 'error'); return }

    // Aggregate by casual_worker_id
    const map = {}
    for (const ts of (data || [])) {
      const wid = ts.casual_worker_id
      if (!map[wid]) {
        const w = ts.casual_worker || {}
        map[wid] = {
          casual_worker_id: wid,
          name: w.name || '—',
          contractor: w.contractor?.name || '—',
          trade: w.trade || '—',
          rate_type: w.rate_type || '—',
          rate: w.rate,
          overtime_rate: w.overtime_rate,
          bank_name: w.bank_name || '',
          bank_account: w.bank_account || '',
          days: 0,
          hours: 0,
          overtime_hours: 0,
          normal_cost: 0,
          overtime_cost: 0,
          total_cost: 0,
        }
      }
      const r = map[wid]
      r.days += 1
      r.hours += Number(ts.hours_worked || 0)
      r.overtime_hours += Number(ts.overtime_hours || 0)
      r.normal_cost += Number(ts.normal_cost || 0)
      r.overtime_cost += Number(ts.overtime_cost || 0)
      r.total_cost += Number(ts.total_cost || 0)
    }

    setRows(Object.values(map).sort((a, b) => a.name.localeCompare(b.name)))
  }

  const summary = useMemo(() => {
    if (!rows || rows.length === 0) return { workers: 0, total: 0, avg: 0 }
    const total = rows.reduce((s, r) => s + r.total_cost, 0)
    return { workers: rows.length, total, avg: total / rows.length }
  }, [rows])

  function handleExport() {
    if (!rows || rows.length === 0) { showToast('No data to export', 'error'); return }
    const headers = ['Worker', 'Contractor', 'Trade', 'Rate Type', 'Rate', 'OT Rate', 'Days', 'Hours', 'OT Hours', 'Normal Cost', 'OT Cost', 'Total Cost', 'Bank', 'Account']
    const csvRows = rows.map(r => [
      r.name, r.contractor, r.trade, r.rate_type, r.rate, r.overtime_rate,
      r.days, r.hours.toFixed(1), r.overtime_hours.toFixed(1),
      r.normal_cost.toFixed(2), r.overtime_cost.toFixed(2), r.total_cost.toFixed(2),
      r.bank_name, r.bank_account,
    ])
    const site = currentSite?.name || 'site'
    exportCsv(`casual_payroll_${site}_${fromDate}_${toDate}.csv`, headers, csvRows)
    showToast('Payroll CSV exported')
  }

  return (
    <div>
      <QuickNav pills={CONTRACTOR_PILLS} setPage={setPage} current="cl_casual_payroll" />
      <PageHeader title="Casual Worker Payroll" site={currentSite} actions={
        rows && rows.length > 0 ? <Button icon="download" onClick={handleExport} style={{ background: ACCENT, borderColor: ACCENT }}>Export Payroll CSV</Button> : null
      } />

      {/* Period selector */}
      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.06em' }}>From</div>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, fontFamily: 'inherit', fontSize: '13px', background: THEME.surface, color: THEME.text }} />
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.06em' }}>To</div>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, fontFamily: 'inherit', fontSize: '13px', background: THEME.surface, color: THEME.text }} />
          </div>
          <Button icon="calculate" onClick={calculate} disabled={loading} style={{ background: ACCENT, borderColor: ACCENT }}>
            {loading ? 'Calculating...' : 'Calculate'}
          </Button>
        </div>
      </Card>

      {/* Summary cards */}
      {rows && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <StatCard label="Total Workers" value={summary.workers} icon="people" color={ACCENT} />
          <StatCard label="Total Cost" value={`$${fmt(summary.total)}`} icon="payments" color="#2E7D32" />
          <StatCard label="Avg Cost / Worker" value={`$${fmt(summary.avg)}`} icon="analytics" color="#1565C0" />
        </div>
      )}

      {/* Results table */}
      {rows === null ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '32px 0', color: THEME.textLow, fontSize: '13px' }}>
            <Icon name="calculate" size={32} style={{ color: THEME.textLow, marginBottom: '8px', display: 'block' }} />
            Select a period and click Calculate to generate the payroll summary.
          </div>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '32px 0', color: THEME.textLow, fontSize: '13px' }}>
            No approved timesheets found for the selected period.
          </div>
        </Card>
      ) : (
        <TableWrap>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead>
              <tr>
                <Th>Worker</Th>
                <Th>Contractor</Th>
                <Th>Trade</Th>
                <Th align="right">Days</Th>
                <Th align="right">Hours</Th>
                <Th align="right">OT Hours</Th>
                <Th align="right">Normal Cost</Th>
                <Th align="right">OT Cost</Th>
                <Th align="right">Total Cost</Th>
                <Th>Bank</Th>
                <Th>Account</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((r, i) => (
                <TRow key={r.casual_worker_id} last={i === rows.length - 1}>
                  <Td style={{ fontWeight: 600 }}>{r.name}</Td>
                  <Td>{r.contractor}</Td>
                  <Td>{r.trade}</Td>
                  <Td align="right">{r.days}</Td>
                  <Td align="right">{r.hours.toFixed(1)}</Td>
                  <Td align="right">{r.overtime_hours.toFixed(1)}</Td>
                  <Td align="right">{fmt(r.normal_cost)}</Td>
                  <Td align="right">{fmt(r.overtime_cost)}</Td>
                  <Td align="right" style={{ fontWeight: 600, color: ACCENT }}>{fmt(r.total_cost)}</Td>
                  <Td>{r.bank_name || '—'}</Td>
                  <Td>{r.bank_account || '—'}</Td>
                </TRow>
              ))}
              {/* Totals row */}
              <tr>
                <Td style={{ fontWeight: 700, borderTop: `2px solid ${THEME.outline}` }} colSpan={3}>TOTAL</Td>
                <Td align="right" style={{ fontWeight: 700, borderTop: `2px solid ${THEME.outline}` }}>{rows.reduce((s, r) => s + r.days, 0)}</Td>
                <Td align="right" style={{ fontWeight: 700, borderTop: `2px solid ${THEME.outline}` }}>{rows.reduce((s, r) => s + r.hours, 0).toFixed(1)}</Td>
                <Td align="right" style={{ fontWeight: 700, borderTop: `2px solid ${THEME.outline}` }}>{rows.reduce((s, r) => s + r.overtime_hours, 0).toFixed(1)}</Td>
                <Td align="right" style={{ fontWeight: 700, borderTop: `2px solid ${THEME.outline}` }}>{fmt(rows.reduce((s, r) => s + r.normal_cost, 0))}</Td>
                <Td align="right" style={{ fontWeight: 700, borderTop: `2px solid ${THEME.outline}` }}>{fmt(rows.reduce((s, r) => s + r.overtime_cost, 0))}</Td>
                <Td align="right" style={{ fontWeight: 700, borderTop: `2px solid ${THEME.outline}`, color: ACCENT }}>{fmt(summary.total)}</Td>
                <Td style={{ borderTop: `2px solid ${THEME.outline}` }} colSpan={2}></Td>
              </tr>
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  )
}
