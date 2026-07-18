import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { DashCard, KpiCard, ProgressRow, SectionTitle } from '../../components/dash'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.contractors

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const daysActive = (start, end) => { if (!start) return 0; const s = new Date(start); const e = end ? new Date(end) : new Date(); return Math.max(0, Math.round((e - s) / 86400000)) }

export default function CLReportCostBySite({ setPage }) {
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('casual_timesheets', { column: 'site_id', value: currentSiteId })
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [sitesRes, tsRes, vehRes, eqRes] = await Promise.all([
        supabase.from('sites').select('id, name'),
        supabase.from('casual_timesheets').select('site_id, total_cost'),
        supabase.from('hired_vehicles').select('site_id, daily_rate, start_date, end_date, is_archived').eq('is_archived', false),
        supabase.from('hired_equipment').select('site_id, daily_rate, start_date, end_date, is_archived').eq('is_archived', false),
      ])
      if (sitesRes.error) { showToast(sitesRes.error.message, 'red'); setLoading(false); return }

      const siteMap = {}
      ;(sitesRes.data || [rt]).forEach(s => { siteMap[s.id] = { name: s.name, labour: 0, vehicle: 0, equipment: 0 } })

      ;(tsRes.data || []).forEach(t => {
        if (siteMap[t.site_id]) siteMap[t.site_id].labour += Number(t.total_cost || 0)
      })
      ;(vehRes.data || []).forEach(v => {
        if (siteMap[v.site_id]) siteMap[v.site_id].vehicle += daysActive(v.start_date, v.end_date) * Number(v.daily_rate || 0)
      })
      ;(eqRes.data || []).forEach(e => {
        if (siteMap[e.site_id]) siteMap[e.site_id].equipment += daysActive(e.start_date, e.end_date) * Number(e.daily_rate || 0)
      })

      const result = Object.values(siteMap)
        .map(s => ({ ...s, total: s.labour + s.vehicle + s.equipment }))
        .filter(s => s.total > 0)
        .sort((a, b) => b.total - a.total)
      setRows(result)
      setLoading(false)
    })()
  }, [])

  const kpis = useMemo(() => {
    const highest = rows[0]
    return {
      sites: rows.length,
      highest: highest ? highest.name : '-',
      totalCost: rows.reduce((s, r) => s + r.total, 0),
    }
  }, [rows])

  if (!can('contractors.view')) return null

  const th = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textLow, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }
  const td = { padding: '10px 12px', fontSize: '13px', color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}` }
  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }

  const maxTotal = Math.max(...rows.map(r => r.total), 1)

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <button onClick={() => setPage?.('cl_reports')} style={{ background: 'none', border: 'none', color: color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px', padding: 0, fontFamily: 'inherit' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>arrow_back</span>
        Back to Reports
      </button>
      <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Cost by Site</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <KpiCard label="Sites with Activity" value={kpis.sites} icon="location_on" accent={color} />
        <KpiCard label="Highest-Cost Site" value={kpis.highest} icon="trending_up" accent={color} />
        <KpiCard label="Grand Total" value={fmtMoney(kpis.totalCost)} icon="payments" accent={color} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <button onClick={() => exportCsv('cost-by-site.csv',
          ['Site', 'Labour Cost', 'Vehicle Cost', 'Equipment Cost', 'Total'],
          rows.map(r => [r.name, r.labour.toFixed(2), r.vehicle.toFixed(2), r.equipment.toFixed(2), r.total.toFixed(2)])
        )} style={{ ...inp, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Export CSV
        </button>
      </div>

      {rows.length > 0 && (
        <DashCard style={{ marginBottom: '16px' }}>
          <SectionTitle title="Cost Distribution" subtitle="Total contractor cost per site" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {rows.map((r, i) => (
              <ProgressRow key={i} label={r.name} value={fmtMoney(r.total)} pct={(r.total / maxTotal) * 100} color={color} />
            ))}
          </div>
        </DashCard>
      )}

      <DashCard style={{ padding: '12px 16px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Site</th>
              <th style={{ ...th, textAlign: 'right' }}>Labour Cost</th>
              <th style={{ ...th, textAlign: 'right' }}>Vehicle Cost</th>
              <th style={{ ...th, textAlign: 'right' }}>Equipment Cost</th>
              <th style={{ ...th, textAlign: 'right' }}>Total</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>No data found</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(r.labour)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(r.vehicle)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(r.equipment)}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  )
}
