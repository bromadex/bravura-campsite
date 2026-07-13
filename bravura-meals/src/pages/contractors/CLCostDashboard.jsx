import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.contractors

function firstOfMonth() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function today() {
  return new Date().toISOString().slice(0, 10)
}
function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function CLCostDashboard() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [dateFrom, setDateFrom] = useState(firstOfMonth())
  const [dateTo, setDateTo] = useState(today())
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [monthlyData, setMonthlyData] = useState([])
  const [monthlyLoading, setMonthlyLoading] = useState(true)

  async function fetchSummary() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase.rpc('rpc_contractor_cost_summary', {
      p_site_id: currentSiteId,
      p_date_from: dateFrom,
      p_date_to: dateTo,
    })
    if (error) showToast(error.message, 'red')
    else setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchSummary() }, [currentSiteId, dateFrom, dateTo])

  useEffect(() => {
    if (!currentSiteId) return
    async function fetchMonthly() {
      setMonthlyLoading(true)
      const now = new Date()
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const isoFrom = sixMonthsAgo.toISOString().slice(0, 10)
      const isoTo = today()

      // Fetch casual timesheets for last 6 months
      const { data: timesheets } = await supabase
        .from('casual_timesheets')
        .select('date, total_cost')
        .eq('site_id', currentSiteId)
        .gte('date', isoFrom)
        .lte('date', isoTo)

      // Fetch hired vehicles active in last 6 months
      const { data: vehicles } = await supabase
        .from('hired_vehicles')
        .select('daily_rate, start_date, end_date')
        .eq('site_id', currentSiteId)
        .lte('start_date', isoTo)
        .or(`end_date.gte.${isoFrom},end_date.is.null`)

      // Fetch hired equipment active in last 6 months
      const { data: equipment } = await supabase
        .from('hired_equipment')
        .select('daily_rate, start_date, end_date')
        .eq('site_id', currentSiteId)
        .lte('start_date', isoTo)
        .or(`end_date.gte.${isoFrom},end_date.is.null`)

      // Build month buckets
      const months = []
      for (let i = 0; i < 6; i++) {
        const d = new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth() + i, 1)
        months.push({
          key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
          label: d.toLocaleString('default', { month: 'short' }),
          year: d.getFullYear(),
          month: d.getMonth(),
          total: 0,
        })
      }

      // Sum timesheet costs by month
      ;(timesheets || []).forEach(t => {
        const d = new Date(t.date)
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
        const bucket = months.find(m => m.key === key)
        if (bucket) bucket.total += Number(t.total_cost || 0)
      })

      // Estimate hired vehicle/equipment costs per month (daily_rate * days in that month overlap)
      const addHiredCosts = (items) => {
        ;(items || []).forEach(item => {
          const rate = Number(item.daily_rate || 0)
          if (!rate) return
          const start = new Date(item.start_date)
          const end = item.end_date ? new Date(item.end_date) : new Date(isoTo)
          months.forEach(m => {
            const mStart = new Date(m.year, m.month, 1)
            const mEnd = new Date(m.year, m.month + 1, 0) // last day of month
            const overlapStart = start > mStart ? start : mStart
            const overlapEnd = end < mEnd ? end : mEnd
            const days = Math.max(0, Math.floor((overlapEnd - overlapStart) / 86400000) + 1)
            m.total += rate * days
          })
        })
      }
      addHiredCosts(vehicles)
      addHiredCosts(equipment)

      setMonthlyData(months)
      setMonthlyLoading(false)
    }
    fetchMonthly()
  }, [currentSiteId])

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    labour: acc.labour + Number(r.labour_cost),
    vehicle: acc.vehicle + Number(r.vehicle_cost),
    equipment: acc.equipment + Number(r.equipment_cost),
    fuel: acc.fuel + Number(r.fuel_cost),
    total: acc.total + Number(r.total_cost),
  }), { labour: 0, vehicle: 0, equipment: 0, fuel: 0, total: 0 }), [rows])

  const topContractor = rows[0]

  if (!can('contractors.view')) return null

  const kpiCard = (label, value, icon) => (
    <div style={{ flex: '1 1 160px', background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '14px', padding: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '18px', color }}>{icon}</span>
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase' }}>{label}</div>
      </div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text }}>{value}</div>
    </div>
  )

  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit',
  }

  function handleExport() {
    exportCsv(`contractor-costs_${dateFrom}_to_${dateTo}.csv`,
      ['Contractor', 'Labour', 'Vehicles', 'Equipment', 'Fuel', 'Total Cost', 'Contract Value', 'Spent To Date'],
      rows.map(r => [
        r.contractor_name, r.labour_cost, r.vehicle_cost, r.equipment_cost, r.fuel_cost,
        r.total_cost, r.contract_value, r.spent_to_date,
      ]))
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Cost Dashboard</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>Who's costing us the most — labour, hired vehicles/equipment, and fuel by contractor</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
          <span style={{ color: THEME.textLow, fontSize: '12px' }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
          <button onClick={handleExport} style={{
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
            background: THEME.surfaceVar, color: THEME.text, border: `1px solid ${THEME.outlineVar}`,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Export CSV
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        {kpiCard('Total Cost', fmtMoney(totals.total), 'payments')}
        {kpiCard('Labour', fmtMoney(totals.labour), 'engineering')}
        {kpiCard('Vehicles', fmtMoney(totals.vehicle), 'local_shipping')}
        {kpiCard('Equipment', fmtMoney(totals.equipment), 'construction')}
        {kpiCard('Fuel', fmtMoney(totals.fuel), 'local_gas_station')}
      </div>

      {topContractor && Number(topContractor.total_cost) > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px',
          background: color + '12', border: `1px solid ${color}40`, borderRadius: '12px', padding: '12px 16px',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>trending_up</span>
          <div style={{ fontSize: '13px', color: THEME.text }}>
            <b>{topContractor.contractor_name}</b> is costing the most this period at <b>{fmtMoney(topContractor.total_cost)}</b>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>payments</span>
          <div style={{ fontSize: '14px' }}>No contractors registered for this site</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Contractor', 'Labour', 'Vehicles', 'Equipment', 'Fuel', 'Total Cost', 'Contract Value', 'Spent To Date'].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const overBudget = Number(r.contract_value) > 0 && Number(r.spent_to_date) > Number(r.contract_value)
                return (
                  <tr key={r.contractor_id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>{r.contractor_name}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed }}>{fmtMoney(r.labour_cost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed }}>{fmtMoney(r.vehicle_cost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed }}>{fmtMoney(r.equipment_cost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed }}>{fmtMoney(r.fuel_cost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: THEME.text }}>{fmtMoney(r.total_cost)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed }}>{fmtMoney(r.contract_value)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: overBudget ? THEME.statusErrorText : THEME.textMed }}>
                      {fmtMoney(r.spent_to_date)}
                      {overBudget && <span style={{ marginLeft: '4px', fontSize: '10px' }}>OVER</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Monthly Cost Trends Bar Chart */}
      <div style={{ marginTop: '24px', background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '14px', padding: '20px' }}>
        <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>Monthly Cost Trends</div>
        <div style={{ fontSize: '11px', color: THEME.textMed, marginBottom: '16px' }}>Total contractor costs by month (last 6 months)</div>
        {monthlyLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
            <span className="material-symbols-rounded" style={{ fontSize: '24px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
          </div>
        ) : (() => {
          const maxVal = Math.max(...monthlyData.map(m => m.total), 1)
          const chartW = 600
          const chartH = 220
          const padL = 70
          const padR = 20
          const padT = 30
          const padB = 30
          const barAreaW = chartW - padL - padR
          const barAreaH = chartH - padT - padB
          const barW = Math.min(50, (barAreaW / monthlyData.length) * 0.6)
          const gap = barAreaW / monthlyData.length
          const gridLines = 4
          return (
            <div style={{ overflowX: 'auto' }}>
              <svg width={chartW} height={chartH} style={{ display: 'block', margin: '0 auto', maxWidth: '100%' }}>
                {/* Grid lines */}
                {Array.from({ length: gridLines + 1 }).map((_, i) => {
                  const y = padT + (barAreaH / gridLines) * i
                  const val = maxVal - (maxVal / gridLines) * i
                  return (
                    <g key={i}>
                      <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke={THEME.outlineVar} strokeWidth="1" />
                      <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill={THEME.textLow}>{fmtMoney(val)}</text>
                    </g>
                  )
                })}
                {/* Bars */}
                {monthlyData.map((m, i) => {
                  const barH = maxVal > 0 ? (m.total / maxVal) * barAreaH : 0
                  const x = padL + gap * i + (gap - barW) / 2
                  const y = padT + barAreaH - barH
                  return (
                    <g key={m.key}>
                      <rect x={x} y={y} width={barW} height={barH} rx="4" fill={color} opacity="0.85" />
                      {m.total > 0 && (
                        <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="10" fontWeight="600" fill={THEME.text}>
                          {fmtMoney(m.total)}
                        </text>
                      )}
                      <text x={x + barW / 2} y={padT + barAreaH + 16} textAnchor="middle" fontSize="11" fill={THEME.textMed}>{m.label}</text>
                    </g>
                  )
                })}
              </svg>
            </div>
          )
        })()}
      </div>

      <div style={{ marginTop: '16px', fontSize: '11px', color: THEME.textLow }}>
        Meals and accommodation costs are not yet included — contractor employees and casual
        workers aren't linked to meal or room-assignment records today.
      </div>
    </div>
  )
}
