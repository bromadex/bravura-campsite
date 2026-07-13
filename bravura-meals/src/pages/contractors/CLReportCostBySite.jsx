import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.contractors

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const daysActive = (start, end) => { if (!start) return 0; const s = new Date(start); const e = end ? new Date(end) : new Date(); return Math.max(0, Math.round((e - s) / 86400000)) }

export default function CLReportCostBySite({ setPage }) {
  const { can } = usePermissions()
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
      ;(sitesRes.data || []).forEach(s => { siteMap[s.id] = { name: s.name, labour: 0, vehicle: 0, equipment: 0 } })

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

  const th = { padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }
  const td = { padding: '10px 12px', fontSize: '13px', color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}` }
  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }

  const kpiCard = (label, value, icon) => (
    <div style={{ flex: '1 1 160px', background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '14px', padding: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '16px', color }}>{icon}</span>
        </div>
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase' }}>{label}</div>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text }}>{value}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <button onClick={() => setPage?.('cl_reports')} style={{ background: 'none', border: 'none', color: color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px', padding: 0, fontFamily: 'inherit' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>arrow_back</span>
        Back to Reports
      </button>
      <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Cost by Site</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        {kpiCard('Sites with Activity', kpis.sites, 'location_on')}
        {kpiCard('Highest-Cost Site', kpis.highest, 'trending_up')}
        {kpiCard('Grand Total', fmtMoney(kpis.totalCost), 'payments')}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <button onClick={() => exportCsv('cost-by-site.csv',
          ['Site', 'Labour Cost', 'Vehicle Cost', 'Equipment Cost', 'Total'],
          rows.map(r => [r.name, r.labour.toFixed(2), r.vehicle.toFixed(2), r.equipment.toFixed(2), r.total.toFixed(2)])
        )} style={{ ...inp, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Export CSV
        </button>
      </div>

      <div style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
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
      </div>
    </div>
  )
}
