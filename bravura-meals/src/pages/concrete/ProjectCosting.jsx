import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'

const color = '#37474F'

const inp = {
  padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}

function fmt(n, decimals = 1) {
  if (n == null || isNaN(n)) return '0'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtCurrency(n) {
  if (n == null || isNaN(n)) return '$0.00'
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function getDefaultDateRange() {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - 6)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function getLast6Months() {
  const months = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString(undefined, { month: 'short', year: '2-digit' }),
    })
  }
  return months
}

export default function ProjectCosting({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [batches, setBatches] = useState([])
  const [batchAggregates, setBatchAggregates] = useState([])
  const [avgCementCost, setAvgCementCost] = useState(0)
  const [avgAggCosts, setAvgAggCosts] = useState({})
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState(getDefaultDateRange)

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      // Fetch batches in date range
      const { data: batchData, error: batchErr } = await supabase
        .from('concrete_batches')
        .select('id, project_id, grade, quantity_m3, actual_cement_kg, status, created_at')
        .eq('site_id', currentSiteId)
        .eq('is_archived', false)
        .gte('created_at', dateRange.from + 'T00:00:00')
        .lte('created_at', dateRange.to + 'T23:59:59')
        .order('created_at', { ascending: false })
      if (batchErr) throw batchErr
      setBatches(batchData || [])

      // Fetch batch_aggregates for those batches
      const batchIds = (batchData || []).map(b => b.id)
      let aggData = []
      if (batchIds.length > 0) {
        const chunks = []
        for (let i = 0; i < batchIds.length; i += 200) {
          chunks.push(batchIds.slice(i, i + 200))
        }
        for (const chunk of chunks) {
          const { data, error } = await supabase
            .from('batch_aggregates')
            .select('batch_id, aggregate_type_id, actual_qty_kg')
            .in('batch_id', chunk)
          if (error) throw error
          aggData = aggData.concat(data || [])
        }
      }
      setBatchAggregates(aggData)

      // Average cement cost from deliveries
      const { data: cementDel } = await supabase
        .from('cement_deliveries')
        .select('quantity_kg, unit_cost')
        .eq('site_id', currentSiteId)
      if (cementDel && cementDel.length > 0) {
        const totalCost = cementDel.reduce((s, d) => s + (d.quantity_kg || 0) * (d.unit_cost || 0), 0)
        const totalKg = cementDel.reduce((s, d) => s + (d.quantity_kg || 0), 0)
        setAvgCementCost(totalKg > 0 ? totalCost / totalKg : 0)
      } else {
        setAvgCementCost(0)
      }

      // Average aggregate costs by type from deliveries
      const { data: aggDel } = await supabase
        .from('aggregate_deliveries')
        .select('aggregate_type_id, quantity_kg, unit_cost')
        .eq('site_id', currentSiteId)
      const costMap = {}
      if (aggDel) {
        const byType = {}
        aggDel.forEach(d => {
          if (!byType[d.aggregate_type_id]) byType[d.aggregate_type_id] = { cost: 0, kg: 0 }
          byType[d.aggregate_type_id].cost += (d.quantity_kg || 0) * (d.unit_cost || 0)
          byType[d.aggregate_type_id].kg += (d.quantity_kg || 0)
        })
        Object.entries(byType).forEach(([tid, v]) => {
          costMap[tid] = v.kg > 0 ? v.cost / v.kg : 0
        })
      }
      setAvgAggCosts(costMap)
    } catch (err) {
      showToast(err.message || 'Failed to load data', 'red')
    } finally {
      setLoading(false)
    }
  }, [currentSiteId, dateRange])

  useEffect(() => { fetchData() }, [fetchData])

  // Aggregate lookup: batch_id -> total agg cost
  const batchAggCostMap = useMemo(() => {
    const map = {}
    batchAggregates.forEach(a => {
      const cost = (a.actual_qty_kg || 0) * (avgAggCosts[a.aggregate_type_id] || 0)
      map[a.batch_id] = (map[a.batch_id] || 0) + cost
    })
    return map
  }, [batchAggregates, avgAggCosts])

  // Per-batch cost
  function batchCost(b) {
    const cementCost = (b.actual_cement_kg || 0) * avgCementCost
    const aggCost = batchAggCostMap[b.id] || 0
    return cementCost + aggCost
  }

  // Summary stats
  const summary = useMemo(() => {
    const totalM3 = batches.reduce((s, b) => s + (b.quantity_m3 || 0), 0)
    const totalBatches = batches.length
    const totalCost = batches.reduce((s, b) => s + batchCost(b), 0)
    const projects = new Set(batches.map(b => b.project_id).filter(Boolean))
    return {
      totalM3,
      totalBatches,
      avgCostPerM3: totalM3 > 0 ? totalCost / totalM3 : 0,
      projectCount: projects.size,
    }
  }, [batches, batchAggCostMap, avgCementCost])

  // Project breakdown
  const projectRows = useMemo(() => {
    const map = {}
    batches.forEach(b => {
      const pid = b.project_id || 'Unassigned'
      if (!map[pid]) map[pid] = { project_id: pid, m3: 0, count: 0, cement_kg: 0, cost: 0 }
      map[pid].m3 += b.quantity_m3 || 0
      map[pid].count += 1
      map[pid].cement_kg += b.actual_cement_kg || 0
      map[pid].cost += batchCost(b)
    })
    return Object.values(map).sort((a, b) => b.m3 - a.m3)
  }, [batches, batchAggCostMap, avgCementCost])

  // Grade breakdown
  const gradeRows = useMemo(() => {
    const map = {}
    batches.forEach(b => {
      const g = b.grade || 'Unknown'
      if (!map[g]) map[g] = { grade: g, m3: 0, count: 0, cement_kg: 0 }
      map[g].m3 += b.quantity_m3 || 0
      map[g].count += 1
      map[g].cement_kg += b.actual_cement_kg || 0
    })
    return Object.values(map).sort((a, b) => b.m3 - a.m3)
  }, [batches])

  // Monthly trend (last 6 months)
  const months = useMemo(() => getLast6Months(), [])
  const monthlyData = useMemo(() => {
    const map = {}
    months.forEach(m => { map[m.key] = 0 })
    batches.forEach(b => {
      const d = new Date(b.created_at)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (map[key] !== undefined) map[key] += b.quantity_m3 || 0
    })
    return months.map(m => ({ ...m, value: map[m.key] }))
  }, [batches, months])

  const maxMonthly = useMemo(() => Math.max(...monthlyData.map(m => m.value), 1), [monthlyData])

  // Permission gate
  if (!can('concrete.view')) {
    return (
      <div style={{ padding: '0' }}>
        <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_project_costing" />
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>lock</span>
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            You do not have permission to view project costing.
          </p>
        </div>
      </div>
    )
  }

  const thStyle = {
    padding: '10px 14px', textAlign: 'left', fontSize: '11px',
    fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase',
    letterSpacing: '0.5px', borderBottom: '1px solid ' + THEME.border,
    whiteSpace: 'nowrap',
  }

  const tdStyle = { padding: '10px 14px', color: THEME.text, fontVariantNumeric: 'tabular-nums' }

  const tableStyle = {
    width: '100%', borderCollapse: 'separate', borderSpacing: 0,
    fontSize: '13px', background: THEME.cardBg,
    border: '1px solid ' + THEME.border, borderRadius: '12px',
    overflow: 'hidden',
  }

  const cardStyle = {
    background: THEME.cardBg, border: '1px solid ' + THEME.border,
    borderRadius: '12px', padding: '16px 20px', flex: '1 1 200px', minWidth: '160px',
  }

  return (
    <div style={{ padding: '0' }}>
      <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_project_costing" />

      <div style={{ padding: '8px 16px 40px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '28px', color }}>request_quote</span>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: THEME.text }}>Project Costing</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 600 }}>From</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={e => setDateRange(r => ({ ...r, from: e.target.value }))}
              style={{ ...inp, width: '150px' }}
            />
            <label style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 600 }}>To</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={e => setDateRange(r => ({ ...r, to: e.target.value }))}
              style={{ ...inp, width: '150px' }}
            />
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '36px', color: THEME.textLow, animation: 'spin 1s linear infinite' }}>progress_activity</span>
            <p style={{ color: THEME.textLow, fontSize: '13px', marginTop: '8px' }}>Loading project costing data...</p>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
              <div style={cardStyle}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Total Concrete Produced
                </div>
                <div style={{ fontSize: '24px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(summary.totalM3)} <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed }}>m³</span>
                </div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Total Batches
                </div>
                <div style={{ fontSize: '24px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                  {summary.totalBatches}
                </div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Average Cost / m³
                </div>
                <div style={{ fontSize: '24px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtCurrency(summary.avgCostPerM3)}
                </div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                  Projects Served
                </div>
                <div style={{ fontSize: '24px', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
                  {summary.projectCount}
                </div>
              </div>
            </div>

            {/* Project Breakdown Table */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: THEME.text, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>folder</span>
                Project Breakdown
              </h3>
              {projectRows.length === 0 ? (
                <div style={{
                  background: THEME.cardBg, border: '1px solid ' + THEME.border,
                  borderRadius: '12px', padding: '32px', textAlign: 'center',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '36px', color: THEME.textLow }}>folder_off</span>
                  <p style={{ color: THEME.textMed, marginTop: '8px', fontSize: '13px' }}>No batch data in this date range.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={{ background: THEME.surface }}>
                        {['Project', 'Total m³', 'Batches', 'Cement Used (kg)', 'Estimated Cost'].map((h, i) => (
                          <th key={i} style={{ ...thStyle, textAlign: i >= 1 ? 'right' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {projectRows.map((r, idx) => (
                        <tr key={r.project_id} style={{ borderBottom: idx < projectRows.length - 1 ? '1px solid ' + THEME.border : 'none' }}>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{r.project_id}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(r.m3)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{r.count}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(r.cement_kg, 0)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(r.cost)}</td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      <tr style={{ background: color + '08', borderTop: '2px solid ' + THEME.border }}>
                        <td style={{ ...tdStyle, fontWeight: 700 }}>Total</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{fmt(summary.totalM3)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{summary.totalBatches}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{fmt(projectRows.reduce((s, r) => s + r.cement_kg, 0), 0)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{fmtCurrency(projectRows.reduce((s, r) => s + r.cost, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Grade Breakdown Table */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: THEME.text, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>category</span>
                Grade Breakdown
              </h3>
              {gradeRows.length === 0 ? (
                <div style={{
                  background: THEME.cardBg, border: '1px solid ' + THEME.border,
                  borderRadius: '12px', padding: '32px', textAlign: 'center',
                }}>
                  <p style={{ color: THEME.textMed, fontSize: '13px' }}>No data.</p>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr style={{ background: THEME.surface }}>
                        {['Grade', 'Total m³', 'Batches', 'Avg Cement / m³ (kg)'].map((h, i) => (
                          <th key={i} style={{ ...thStyle, textAlign: i >= 1 ? 'right' : 'left' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gradeRows.map((r, idx) => (
                        <tr key={r.grade} style={{ borderBottom: idx < gradeRows.length - 1 ? '1px solid ' + THEME.border : 'none' }}>
                          <td style={{ ...tdStyle, fontWeight: 600 }}>{r.grade}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(r.m3)}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{r.count}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{r.m3 > 0 ? fmt(r.cement_kg / r.m3) : '0.0'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Monthly Production Trend */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 700, color: THEME.text, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>bar_chart</span>
                Monthly Production (Last 6 Months)
              </h3>
              <div style={{
                background: THEME.cardBg, border: '1px solid ' + THEME.border,
                borderRadius: '12px', padding: '20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '160px' }}>
                  {monthlyData.map(m => {
                    const pct = maxMonthly > 0 ? (m.value / maxMonthly) * 100 : 0
                    return (
                      <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.text, marginBottom: '4px', fontVariantNumeric: 'tabular-nums' }}>
                          {m.value > 0 ? fmt(m.value, 0) : ''}
                        </div>
                        <div style={{
                          width: '100%', maxWidth: '48px',
                          height: `${Math.max(pct, 2)}%`,
                          background: m.value > 0 ? color : THEME.outlineVar,
                          borderRadius: '6px 6px 0 0',
                          transition: 'height 0.3s ease',
                          minHeight: '4px',
                        }} />
                        <div style={{ fontSize: '10px', color: THEME.textMed, marginTop: '6px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {m.label}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
