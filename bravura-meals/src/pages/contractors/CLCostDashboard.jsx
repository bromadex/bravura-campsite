import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { showToast, Icon } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { DashCard, KpiCard, AreaChart, SectionTitle } from '../../components/dash'

const color = MODULE_COLORS.contractors

// Accent hexes for KPI chips (literal hexes so the accent+'18' tint pattern works)
const ACCENT = {
  green:  '#2E7D32',
  blue:   '#1E88E5',
  violet: '#7C4DFF',
  amber:  '#F59E0B',
}

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

  const share = part => totals.total > 0 ? (part / totals.total) * 100 : 0

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
            padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500,
            background: color + '18', color, border: 'none',
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Export CSV
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard icon="payments" label="Total Cost" value={fmtMoney(totals.total)} sub="All cost categories" accent={color} progress={totals.total > 0 ? 100 : 0} />
        <KpiCard icon="engineering" label="Labour" value={fmtMoney(totals.labour)} sub={`${share(totals.labour).toFixed(0)}% of total`} accent={ACCENT.blue} progress={share(totals.labour)} />
        <KpiCard icon="local_shipping" label="Vehicles" value={fmtMoney(totals.vehicle)} sub={`${share(totals.vehicle).toFixed(0)}% of total`} accent={ACCENT.violet} progress={share(totals.vehicle)} />
        <KpiCard icon="construction" label="Equipment" value={fmtMoney(totals.equipment)} sub={`${share(totals.equipment).toFixed(0)}% of total`} accent={ACCENT.green} progress={share(totals.equipment)} />
        <KpiCard icon="local_gas_station" label="Fuel" value={fmtMoney(totals.fuel)} sub={`${share(totals.fuel).toFixed(0)}% of total`} accent={ACCENT.amber} progress={share(totals.fuel)} />
      </div>

      {/* Top-contractor callout */}
      {topContractor && Number(topContractor.total_cost) > 0 && (
        <DashCard style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%', background: color + '18',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon name="trending_up" size={20} style={{ color }} />
          </div>
          <div style={{ fontSize: '13px', color: THEME.text }}>
            <b>{topContractor.contractor_name}</b> is costing the most this period at <b style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(topContractor.total_cost)}</b>
          </div>
        </DashCard>
      )}

      {/* Cost table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={32} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : rows.length === 0 ? (
        <DashCard style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <Icon name="payments" size={48} style={{ display: 'block', margin: '0 auto 12px', color: THEME.outline }} />
          <div style={{ fontSize: '14px' }}>No contractors registered for this site</div>
        </DashCard>
      ) : (
        <DashCard style={{ marginBottom: '16px' }}>
          <SectionTitle title="Cost by Contractor" subtitle={`${dateFrom} to ${dateTo}`} />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Contractor', 'Labour', 'Vehicles', 'Equipment', 'Fuel', 'Total Cost', 'Contract Value', 'Spent To Date'].map((h, i) => (
                    <th key={i} style={{ padding: '8px 12px', textAlign: i === 0 ? 'left' : 'right', fontWeight: 600, color: THEME.textLow, fontSize: '11px', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => {
                  const overBudget = Number(r.contract_value) > 0 && Number(r.spent_to_date) > Number(r.contract_value)
                  const rowBorder = idx < rows.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none'
                  return (
                    <tr key={r.contractor_id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, borderBottom: rowBorder }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>{r.contractor_name}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.labour_cost)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.vehicle_cost)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.equipment_cost)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.fuel_cost)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.total_cost)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.contract_value)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: overBudget ? THEME.statusErrorText : THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtMoney(r.spent_to_date)}
                        {overBudget && <span style={{ marginLeft: '4px', fontSize: '10px' }}>OVER</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DashCard>
      )}

      {/* Monthly Cost Trends */}
      <DashCard style={{ marginTop: '16px' }}>
        <SectionTitle title="Monthly Cost Trends" subtitle="Total contractor costs (USD) by month — last 6 months" />
        {monthlyLoading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
            <Icon name="progress_activity" size={24} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : (
          <AreaChart
            points={monthlyData.map(m => m.total)}
            labels={monthlyData.map(m => m.label)}
            color={color}
          />
        )}
      </DashCard>

      <div style={{ marginTop: '16px', fontSize: '11px', color: THEME.textLow }}>
        Meals and accommodation costs are not yet included — contractor employees and casual
        workers aren't linked to meal or room-assignment records today.
      </div>
    </div>
  )
}
