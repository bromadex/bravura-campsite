import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { DashCard, KpiCard, ProgressRow, SectionTitle } from '../../components/dash'
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

export default function CLReportCasualLabour({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('casual_timesheets', { column: 'site_id', value: currentSiteId })
  const [dateFrom, setDateFrom] = useState(firstOfMonth())
  const [dateTo, setDateTo] = useState(today())
  const [rows, setRows] = useState([])
  const [contractors, setContractors] = useState([])
  const [filterContractor, setFilterContractor] = useState('')
  const [filterWorker, setFilterWorker] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('contractors').select('id,name').eq('is_archived', false).order('name')
      .then(({ data }) => setContractors(data || [rt]))
  }, [])

  useEffect(() => {
    if (!currentSiteId) return
    setLoading(true)
    ;(async () => {
      const { data: timesheets, error } = await supabase
        .from('casual_timesheets')
        .select('casual_worker_id, hours_worked, overtime_hours, total_cost, date')
        .eq('site_id', currentSiteId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
      if (error) { showToast(error.message, 'red'); setLoading(false); return }

      const { data: workers, error: e2 } = await supabase
        .from('casual_workers')
        .select('id, name, contractor_id')
        .eq('site_id', currentSiteId)
        .eq('is_archived', false)
      if (e2) { showToast(e2.message, 'red'); setLoading(false); return }

      const wMap = {}
      ;(workers || []).forEach(w => { wMap[w.id] = w })
      const cMap = {}
      ;(contractors || []).forEach(c => { cMap[c.id] = c.name })

      const agg = {}
      ;(timesheets || []).forEach(t => {
        const w = wMap[t.casual_worker_id]
        if (!w) return
        if (!agg[w.id]) agg[w.id] = { name: w.name, contractor: cMap[w.contractor_id] || '-', hours: 0, overtime: 0, days: new Set(), cost: 0 }
        agg[w.id].hours += Number(t.hours_worked || 0)
        agg[w.id].overtime += Number(t.overtime_hours || 0)
        agg[w.id].days.add(t.date)
        agg[w.id].cost += Number(t.total_cost || 0)
      })
      setRows(Object.values(agg).map(r => ({ ...r, days: r.days.size })))
      setLoading(false)
    })()
  }, [currentSiteId, dateFrom, dateTo, contractors])

  const filtered = useMemo(() => rows.filter(r =>
    (!filterContractor || r.contractor === filterContractor) &&
    (!filterWorker || r.name.toLowerCase().includes(filterWorker.toLowerCase()))
  ), [rows, filterContractor, filterWorker])

  const kpis = useMemo(() => ({
    workers: filtered.length,
    hours: filtered.reduce((s, r) => s + r.hours, 0),
    cost: filtered.reduce((s, r) => s + r.cost, 0),
    avg: filtered.length ? filtered.reduce((s, r) => s + r.cost, 0) / filtered.length : 0,
  }), [filtered])

  const topWorkers = useMemo(() =>
    [...filtered].sort((a, b) => b.cost - a.cost).slice(0, 6)
  , [filtered])

  if (!can('contractors.view')) return null

  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const th = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textLow, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }
  const td = { padding: '10px 12px', fontSize: '13px', color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}` }

  const maxCost = Math.max(...topWorkers.map(w => w.cost), 1)

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <button onClick={() => setPage?.('cl_reports')} style={{ background: 'none', border: 'none', color: color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px', padding: 0, fontFamily: 'inherit' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>arrow_back</span>
        Back to Reports
      </button>
      <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Casual Labour Report</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <KpiCard label="Total Workers" value={kpis.workers} icon="engineering" accent={color} />
        <KpiCard label="Total Hours" value={kpis.hours.toFixed(1)} icon="schedule" accent={color} />
        <KpiCard label="Total Cost" value={fmtMoney(kpis.cost)} icon="payments" accent={color} />
        <KpiCard label="Avg Cost/Worker" value={fmtMoney(kpis.avg)} icon="analytics" accent={color} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
        <span style={{ color: THEME.textMed, fontSize: '13px' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
        <select value={filterContractor} onChange={e => setFilterContractor(e.target.value)} style={inp}>
          <option value="">All Contractors</option>
          {contractors.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        <input placeholder="Search worker..." value={filterWorker} onChange={e => setFilterWorker(e.target.value)} style={{ ...inp, width: '160px' }} />
        <button onClick={() => exportCsv(`casual-labour_${dateFrom}_to_${dateTo}.csv`,
          ['Worker', 'Contractor', 'Hours', 'Overtime Hrs', 'Days Worked', 'Total Cost'],
          filtered.map(r => [r.name, r.contractor, r.hours.toFixed(1), r.overtime.toFixed(1), r.days, r.cost.toFixed(2)])
        )} style={{ ...inp, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Export CSV
        </button>
      </div>

      {topWorkers.length > 0 && (
        <DashCard style={{ marginBottom: '16px' }}>
          <SectionTitle title="Top Workers by Cost" subtitle={`${dateFrom} to ${dateTo}`} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {topWorkers.map((w, i) => (
              <ProgressRow key={i} label={w.name} value={fmtMoney(w.cost)} pct={(w.cost / maxCost) * 100} color={color} />
            ))}
          </div>
        </DashCard>
      )}

      <DashCard style={{ padding: '12px 16px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Worker</th><th style={th}>Contractor</th><th style={{ ...th, textAlign: 'right' }}>Hours</th>
              <th style={{ ...th, textAlign: 'right' }}>Overtime Hrs</th><th style={{ ...th, textAlign: 'right' }}>Days Worked</th>
              <th style={{ ...th, textAlign: 'right' }}>Total Cost</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>No data found</td></tr>
              ) : filtered.map((r, i) => (
                <tr key={i}>
                  <td style={td}>{r.name}</td><td style={td}>{r.contractor}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.hours.toFixed(1)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.overtime.toFixed(1)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.days}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  )
}
