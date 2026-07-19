import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { DashCard, KpiCard, DonutGauge, SectionTitle } from '../../components/dash'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.contractors

function firstOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function today() { return new Date().toISOString().slice(0, 10) }
function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CLReportTimesheets({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('casual_timesheets', { column: 'site_id', value: currentSiteId })
  const [dateFrom, setDateFrom] = useState(firstOfMonth())
  const [dateTo, setDateTo] = useState(today())
  const [rows, setRows] = useState([])
  const [contractors, setContractors] = useState([])
  const [filterContractor, setFilterContractor] = useState('')
  const [filterApproved, setFilterApproved] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('contractors').select('id,name').eq('is_archived', false).or(`site_id.eq.${currentSiteId},site_id.is.null`).order('name')
      .then(({ data }) => setContractors(data || [rt]))
  }, [])

  useEffect(() => {
    if (!currentSiteId) return
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('casual_timesheets')
        .select('id, date, casual_worker_id, contractor_id, clock_in, clock_out, hours_worked, overtime_hours, total_cost, approved')
        .eq('site_id', currentSiteId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
      if (error) { showToast(error.message, 'red'); setLoading(false); return }

      const workerIds = [...new Set((data || []).map(r => r.casual_worker_id).filter(Boolean))]
      let wMap = {}
      if (workerIds.length) {
        const { data: workers } = await supabase.from('casual_workers').select('id,name').in('id', workerIds)
        ;(workers || []).forEach(w => { wMap[w.id] = w.name })
      }
      const cMap = {}
      ;(contractors || []).forEach(c => { cMap[c.id] = c.name })

      setRows((data || []).map(r => ({
        ...r,
        workerName: wMap[r.casual_worker_id] || '-',
        contractorName: cMap[r.contractor_id] || '-',
      })))
      setLoading(false)
    })()
  }, [currentSiteId, dateFrom, dateTo, contractors])

  const filtered = useMemo(() => rows.filter(r =>
    (!filterContractor || r.contractor_id === filterContractor) &&
    (filterApproved === '' || (filterApproved === 'yes' ? r.approved : !r.approved))
  ), [rows, filterContractor, filterApproved])

  const kpis = useMemo(() => {
    const total = filtered.length
    const hours = filtered.reduce((s, r) => s + Number(r.hours_worked || 0), 0)
    const approved = filtered.filter(r => r.approved).length
    const cost = filtered.reduce((s, r) => s + Number(r.total_cost || 0), 0)
    return { total, hours, approved, approvedPct: total ? ((approved / total) * 100).toFixed(0) : 0, cost }
  }, [filtered])

  if (!can('contractors.view')) return null

  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const th = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textLow, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }
  const td = { padding: '10px 12px', fontSize: '13px', color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}` }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <button onClick={() => setPage?.('cl_reports')} style={{ background: 'none', border: 'none', color: color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px', padding: 0, fontFamily: 'inherit' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>arrow_back</span>
        Back to Reports
      </button>
      <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Timesheet Report</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <KpiCard label="Total Entries" value={kpis.total} icon="list_alt" accent={color} />
        <KpiCard label="Total Hours" value={kpis.hours.toFixed(1)} icon="schedule" accent={color} />
        <KpiCard label="Approved %" value={kpis.approvedPct + '%'} icon="verified" accent={THEME.success} progress={Number(kpis.approvedPct)} sub={`${kpis.approved} of ${kpis.total} approved`} />
        <KpiCard label="Total Cost" value={fmtMoney(kpis.cost)} icon="payments" accent={color} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
        <span style={{ color: THEME.textMed, fontSize: '13px' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
        <select value={filterContractor} onChange={e => setFilterContractor(e.target.value)} style={inp}>
          <option value="">All Contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterApproved} onChange={e => setFilterApproved(e.target.value)} style={inp}>
          <option value="">All Status</option>
          <option value="yes">Approved</option>
          <option value="no">Pending</option>
        </select>
        <button onClick={() => exportCsv(`timesheets_${dateFrom}_to_${dateTo}.csv`,
          ['Date', 'Worker', 'Contractor', 'Clock In', 'Clock Out', 'Hours', 'Overtime', 'Cost', 'Approved'],
          filtered.map(r => [r.date, r.workerName, r.contractorName, r.clock_in || '', r.clock_out || '', r.hours_worked, r.overtime_hours, r.total_cost, r.approved ? 'Yes' : 'No'])
        )} style={{ ...inp, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Export CSV
        </button>
      </div>

      {kpis.total > 0 && (
        <DashCard style={{ marginBottom: '16px' }}>
          <SectionTitle title="Approval Status" subtitle={`${dateFrom} to ${dateTo}`} />
          <DonutGauge
            pct={Number(kpis.approvedPct)}
            color={color}
            label="approved"
            legend={[[color, `Approved ${kpis.approved}`], [THEME.surfaceVar, `Pending ${kpis.total - kpis.approved}`]]}
          />
        </DashCard>
      )}

      <DashCard style={{ padding: '12px 16px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Date</th><th style={th}>Worker</th><th style={th}>Contractor</th>
              <th style={th}>Clock In</th><th style={th}>Clock Out</th>
              <th style={{ ...th, textAlign: 'right' }}>Hours</th><th style={{ ...th, textAlign: 'right' }}>Overtime</th>
              <th style={{ ...th, textAlign: 'right' }}>Cost</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>No data found</td></tr>
              ) : filtered.map((r, i) => (
                <tr key={r.id || i}>
                  <td style={td}>{r.date}</td><td style={td}>{r.workerName}</td><td style={td}>{r.contractorName}</td>
                  <td style={td}>{r.clock_in || '-'}</td><td style={td}>{r.clock_out || '-'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{Number(r.hours_worked || 0).toFixed(1)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{Number(r.overtime_hours || 0).toFixed(1)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.total_cost)}</td>
                  <td style={td}>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                      background: r.approved ? THEME.statusGreenBg || '#e6f4ea' : THEME.statusNeutralBg,
                      color: r.approved ? THEME.statusGreenText || '#1e7e34' : THEME.statusNeutralText,
                      textTransform: 'uppercase',
                    }}>{r.approved ? 'Approved' : 'Pending'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  )
}
