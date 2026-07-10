import { useMemo, useState, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'

const color = MODULE_COLORS.fleet

const STATUS_COLORS = {
  operational:    { bg: THEME.statusSuccessBg,   text: THEME.statusSuccessText, bar: '#22c55e' },
  maintenance:    { bg: THEME.statusWarningBg,   text: THEME.statusWarningText, bar: '#f59e0b' },
  grounded:       { bg: THEME.statusErrorBg,     text: THEME.statusErrorText,   bar: '#ef4444' },
  awaiting_parts: { bg: THEME.statusTertiaryBg,  text: THEME.statusTertiaryText, bar: '#8b5cf6' },
  decommissioned: { bg: THEME.statusNeutralBg,   text: THEME.statusNeutralText, bar: '#9ca3af' },
}

const REPORT_DEFS = [
  { key: 'utilisation',   icon: 'bar_chart',     title: 'Fleet Utilisation',   desc: 'Asset utilisation by assignment status' },
  { key: 'cost',          icon: 'payments',      title: 'Cost Analysis',       desc: 'Maintenance costs per work order' },
  { key: 'downtime',      icon: 'timer_off',     title: 'Downtime Report',     desc: 'Assets not in operational status' },
  { key: 'trips',         icon: 'route',         title: 'Trip Summary',        desc: 'Distance aggregates by asset' },
  { key: 'maintenance',   icon: 'build',         title: 'Maintenance Summary', desc: 'Work orders by status and priority' },
  { key: 'compliance',    icon: 'verified_user', title: 'Compliance Status',   desc: 'Expiry tracking with color coding' },
  { key: 'inspections',   icon: 'fact_check',    title: 'Inspection Summary',  desc: 'Pass/fail rates by month' },
  { key: 'assignments',   icon: 'history',       title: 'Assignment History',  desc: 'Operator assignments over time' },
]

function downloadCsv(filename, headers, rows) {
  const bom = '﻿'
  const escape = v => {
    const s = String(v == null ? '' : v)
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = bom + [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function DataTable({ headers, rows, maxHeight }) {
  return (
    <div style={{ overflowX: 'auto', maxHeight: maxHeight || '400px', overflowY: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{
                padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: THEME.text,
                borderBottom: `2px solid ${THEME.outline}`, whiteSpace: 'nowrap',
                position: 'sticky', top: 0, background: THEME.surface, zIndex: 1,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={headers.length} style={{ padding: '20px', textAlign: 'center', color: THEME.textLow }}>No data available</td></tr>
          ) : rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : `${THEME.outline}22` }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{ padding: '7px 12px', color: THEME.text, borderBottom: `1px solid ${THEME.outline}44`, whiteSpace: 'nowrap' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SummaryBadge({ label, value, badgeColor }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px',
      borderRadius: '8px', background: badgeColor || `${color}14`, fontSize: '13px', fontWeight: 600,
      color: THEME.text, marginRight: '8px', marginBottom: '6px',
    }}>
      <span style={{ color: THEME.textLow, fontWeight: 400 }}>{label}:</span> {value}
    </span>
  )
}

export default function FleetReports({ setPage }) {
  const { can } = usePermissions()
  const {
    assets, assignments, inspections, workOrders, trips, compliance,
    vehicles, heavyEquipment, generators, assetsByStatus,
    activeAssignments, expiringCompliance, loading,
  } = useFleet()

  const [expanded, setExpanded] = useState({})

  const toggle = useCallback((key) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const summary = useMemo(() => {
    const allAssets = assets || []
    const totalAssets = allAssets.length
    const vCount = (vehicles || []).length
    const eCount = (heavyEquipment || []).length
    const gCount = (generators || []).length
    const activeCount = (activeAssignments || []).length
    const utilisationRate = totalAssets > 0 ? Math.round((activeCount / totalAssets) * 100) : 0
    const allCompliance = compliance || []
    const validCompliance = allCompliance.filter(c => c.expiry_date && new Date(c.expiry_date) > new Date()).length
    const complianceRate = allCompliance.length > 0 ? Math.round((validCompliance / allCompliance.length) * 100) : 0
    const allInspections = inspections || []
    const passed = allInspections.filter(i => i.overall_result === 'pass' || i.status === 'passed').length
    const inspectionRate = allInspections.length > 0 ? Math.round((passed / allInspections.length) * 100) : 0
    return { totalAssets, vCount, eCount, gCount, utilisationRate, complianceRate, inspectionRate }
  }, [assets, vehicles, heavyEquipment, generators, activeAssignments, compliance, inspections])

  const statusDistribution = useMemo(() => {
    const dist = {}
    ;(assets || []).forEach(a => { const s = a.status || 'operational'; dist[s] = (dist[s] || 0) + 1 })
    return dist
  }, [assets])

  const totalForBar = useMemo(() => Object.values(statusDistribution).reduce((a, b) => a + b, 0), [statusDistribution])

  // ---- Report data computations ----

  const assetMap = useMemo(() => {
    const m = {}
    ;(assets || []).forEach(a => { m[a.id] = a })
    return m
  }, [assets])

  const utilisationData = useMemo(() => {
    const allAssets = assets || []
    const allAssignments = activeAssignments || []
    const assignMap = {}
    allAssignments.forEach(a => { assignMap[a.asset_id] = a })
    const rows = allAssets.map(a => {
      const asgn = assignMap[a.id]
      return [
        a.asset_number || a.id,
        a.description || a.name || '-',
        asgn ? (asgn.employee_name || asgn.assigned_to || 'Assigned') : 'Unassigned',
        asgn ? (asgn.assignment_type || asgn.type || '-') : '-',
      ]
    })
    const assignedCount = Object.keys(assignMap).filter(id => allAssets.some(a => a.id === id)).length
    const pct = allAssets.length > 0 ? Math.round((assignedCount / allAssets.length) * 100) : 0
    return { headers: ['Asset #', 'Description', 'Current Assignment', 'Type'], rows, assignedCount, total: allAssets.length, pct }
  }, [assets, activeAssignments])

  const costData = useMemo(() => {
    const wos = (workOrders || []).map(wo => {
      const cost = (Number(wo.labour_cost) || 0) + (Number(wo.parts_cost) || 0) + (Number(wo.other_cost) || 0)
      const a = assetMap[wo.asset_id]
      return { ...wo, totalCost: cost, assetLabel: a ? (a.asset_number || a.name || wo.asset_id) : (wo.asset_id || '-') }
    }).sort((a, b) => b.totalCost - a.totalCost)
    const totalSpend = wos.reduce((s, w) => s + w.totalCost, 0)
    const avg = wos.length > 0 ? (totalSpend / wos.length) : 0
    const rows = wos.map(w => [
      w.wo_number || w.id || '-',
      w.assetLabel,
      w.priority || '-',
      `$${w.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    ])
    return {
      headers: ['WO #', 'Asset', 'Priority', 'Total Cost'], rows,
      totalSpend: totalSpend.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      avg: avg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    }
  }, [workOrders, assetMap])

  const downtimeData = useMemo(() => {
    const now = new Date()
    const down = (assets || []).filter(a => a.status && a.status !== 'operational')
    const rows = down.map(a => {
      const changeDate = a.status_changed_at || a.updated_at || a.created_at
      const days = changeDate ? Math.max(0, Math.floor((now - new Date(changeDate)) / 86400000)) : '-'
      return [a.asset_number || a.id, a.description || a.name || '-', (a.status || '').replace(/_/g, ' '), days]
    })
    const byStat = {}
    down.forEach(a => { const s = a.status || 'unknown'; byStat[s] = (byStat[s] || 0) + 1 })
    return { headers: ['Asset #', 'Description', 'Status', 'Days in Status'], rows, byStat }
  }, [assets])

  const tripData = useMemo(() => {
    const byAsset = {}
    ;(trips || []).forEach(t => {
      const id = t.asset_id
      if (!byAsset[id]) byAsset[id] = { count: 0, totalDist: 0 }
      byAsset[id].count++
      byAsset[id].totalDist += Number(t.distance_km) || 0
    })
    const rows = Object.entries(byAsset).map(([id, d]) => {
      const a = assetMap[id]
      return {
        label: a ? (a.asset_number || a.name || id) : id,
        count: d.count,
        totalDist: d.totalDist,
        avg: d.count > 0 ? d.totalDist / d.count : 0,
      }
    }).sort((a, b) => b.totalDist - a.totalDist)
    return {
      headers: ['Asset #', 'Total Trips', 'Total Distance (km)', 'Avg Distance (km)'],
      rows: rows.map(r => [r.label, r.count, r.totalDist.toFixed(1), r.avg.toFixed(1)]),
    }
  }, [trips, assetMap])

  const maintenanceData = useMemo(() => {
    const statuses = ['open', 'in_progress', 'completed', 'cancelled']
    const priorities = ['low', 'medium', 'high', 'critical']
    const matrix = {}
    statuses.forEach(s => { matrix[s] = {}; priorities.forEach(p => { matrix[s][p] = 0 }) })
    ;(workOrders || []).forEach(wo => {
      const s = (wo.status || 'open').toLowerCase()
      const p = (wo.priority || 'medium').toLowerCase()
      if (matrix[s]) { matrix[s][p] = (matrix[s][p] || 0) + 1 }
    })
    return { statuses, priorities, matrix }
  }, [workOrders])

  const complianceData = useMemo(() => {
    const now = new Date()
    const sevenDays = new Date(now.getTime() + 7 * 86400000)
    const thirtyDays = new Date(now.getTime() + 30 * 86400000)
    let expired = 0, critical = 0, warning = 0, valid = 0
    const rows = (compliance || []).map(c => {
      const a = assetMap[c.asset_id]
      const expiry = c.expiry_date ? new Date(c.expiry_date) : null
      let status = 'No expiry'
      let statusColor = THEME.textLow
      if (expiry) {
        if (expiry < now) { status = 'Expired'; statusColor = '#ef4444'; expired++ }
        else if (expiry < sevenDays) { status = 'Critical'; statusColor = '#f59e0b'; critical++ }
        else if (expiry < thirtyDays) { status = 'Warning'; statusColor = '#eab308'; warning++ }
        else { status = 'Valid'; statusColor = '#22c55e'; valid++ }
      }
      return {
        row: [
          a ? (a.asset_number || a.name || c.asset_id) : (c.asset_id || '-'),
          c.compliance_type || c.type || '-',
          c.expiry_date || '-',
          <span key={c.id} style={{ color: statusColor, fontWeight: 600 }}>{status}</span>,
        ],
        raw: [
          a ? (a.asset_number || a.name || c.asset_id) : (c.asset_id || '-'),
          c.compliance_type || c.type || '-',
          c.expiry_date || '-',
          status,
        ],
      }
    })
    return {
      headers: ['Asset', 'Compliance Type', 'Expiry Date', 'Status'],
      rows: rows.map(r => r.row), rawRows: rows.map(r => r.raw),
      expired, critical, warning, valid,
    }
  }, [compliance, assetMap])

  const inspectionData = useMemo(() => {
    const now = new Date()
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('default', { month: 'short', year: 'numeric' }) })
    }
    const buckets = {}
    months.forEach(m => { buckets[m.key] = { pass: 0, fail: 0, conditional: 0 } })
    ;(inspections || []).forEach(ins => {
      const d = ins.inspection_date || ins.created_at
      if (!d) return
      const dt = new Date(d)
      const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
      if (!buckets[k]) return
      const r = (ins.overall_result || ins.status || '').toLowerCase()
      if (r === 'pass' || r === 'passed') buckets[k].pass++
      else if (r === 'unsafe' || r === 'failed') buckets[k].fail++
      else buckets[k].conditional++
    })
    const allIns = inspections || []
    const totalPass = allIns.filter(i => (i.overall_result || i.status || '').toLowerCase().startsWith('pass')).length
    const passRate = allIns.length > 0 ? Math.round((totalPass / allIns.length) * 100) : 0
    return { months, buckets, passRate, total: allIns.length }
  }, [inspections])

  const assignmentData = useMemo(() => {
    const sorted = [...(assignments || [])].sort((a, b) => {
      const da = a.start_date || a.created_at || ''
      const db = b.start_date || b.created_at || ''
      return db.localeCompare(da)
    })
    const rows = sorted.map(a => {
      const asset = assetMap[a.asset_id]
      return [
        asset ? (asset.asset_number || asset.name || a.asset_id) : (a.asset_id || '-'),
        a.employee_name || a.assigned_to || '-',
        a.assignment_type || a.type || '-',
        a.start_date || a.created_at || '-',
        a.end_date || '-',
        a.status || '-',
      ]
    })
    return { headers: ['Asset', 'Employee', 'Type', 'Assigned Date', 'End Date', 'Status'], rows }
  }, [assignments, assetMap])

  // ---- CSV export handlers ----
  const exportCsv = useCallback((filename, headers, rows) => downloadCsv(filename, headers, rows), [])

  // ---- Render report content ----
  function renderReportContent(key) {
    switch (key) {
      case 'utilisation':
        return (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap' }}>
              <SummaryBadge label="Assigned" value={utilisationData.assignedCount} />
              <SummaryBadge label="Total" value={utilisationData.total} />
              <SummaryBadge label="Rate" value={`${utilisationData.pct}%`} />
            </div>
            <DataTable headers={utilisationData.headers} rows={utilisationData.rows} />
            <ExportButton onClick={() => exportCsv('fleet_utilisation.csv', utilisationData.headers, utilisationData.rows)} />
          </div>
        )
      case 'cost':
        return (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap' }}>
              <SummaryBadge label="Total Spend" value={`$${costData.totalSpend}`} />
              <SummaryBadge label="Avg per WO" value={`$${costData.avg}`} />
            </div>
            <DataTable headers={costData.headers} rows={costData.rows} />
            <ExportButton onClick={() => exportCsv('cost_analysis.csv', costData.headers, costData.rows)} />
          </div>
        )
      case 'downtime':
        return (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap' }}>
              {Object.entries(downtimeData.byStat).map(([s, c]) => (
                <SummaryBadge key={s} label={s.replace(/_/g, ' ')} value={c} />
              ))}
              {Object.keys(downtimeData.byStat).length === 0 && <SummaryBadge label="Non-operational" value="0" />}
            </div>
            <DataTable headers={downtimeData.headers} rows={downtimeData.rows} />
            <ExportButton onClick={() => exportCsv('downtime_report.csv', downtimeData.headers, downtimeData.rows)} />
          </div>
        )
      case 'trips':
        return (
          <div>
            <DataTable headers={tripData.headers} rows={tripData.rows} />
            <ExportButton onClick={() => exportCsv('trip_summary.csv', tripData.headers, tripData.rows)} />
          </div>
        )
      case 'maintenance': {
        const { statuses, priorities, matrix } = maintenanceData
        return (
          <div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: THEME.text, borderBottom: `2px solid ${THEME.outline}` }}>Status / Priority</th>
                    {priorities.map(p => (
                      <th key={p} style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: THEME.text, borderBottom: `2px solid ${THEME.outline}`, textTransform: 'capitalize' }}>{p}</th>
                    ))}
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: THEME.text, borderBottom: `2px solid ${THEME.outline}` }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {statuses.map((s, ri) => {
                    const rowTotal = priorities.reduce((sum, p) => sum + (matrix[s]?.[p] || 0), 0)
                    return (
                      <tr key={s} style={{ background: ri % 2 === 0 ? 'transparent' : `${THEME.outline}22` }}>
                        <td style={{ padding: '7px 12px', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}44`, textTransform: 'capitalize' }}>{s.replace(/_/g, ' ')}</td>
                        {priorities.map(p => (
                          <td key={p} style={{ padding: '7px 12px', textAlign: 'center', color: THEME.text, borderBottom: `1px solid ${THEME.outline}44` }}>{matrix[s]?.[p] || 0}</td>
                        ))}
                        <td style={{ padding: '7px 12px', textAlign: 'center', fontWeight: 700, color: THEME.text, borderBottom: `1px solid ${THEME.outline}44` }}>{rowTotal}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <ExportButton onClick={() => {
              const h = ['Status', ...priorities, 'Total']
              const r = statuses.map(s => [s, ...priorities.map(p => matrix[s]?.[p] || 0), priorities.reduce((sum, p) => sum + (matrix[s]?.[p] || 0), 0)])
              exportCsv('maintenance_summary.csv', h, r)
            }} />
          </div>
        )
      }
      case 'compliance':
        return (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap' }}>
              <SummaryBadge label="Expired" value={complianceData.expired} badgeColor="#ef444420" />
              <SummaryBadge label="Critical (<7d)" value={complianceData.critical} badgeColor="#f59e0b20" />
              <SummaryBadge label="Warning (<30d)" value={complianceData.warning} badgeColor="#eab30820" />
              <SummaryBadge label="Valid" value={complianceData.valid} badgeColor="#22c55e20" />
            </div>
            <DataTable headers={complianceData.headers} rows={complianceData.rows} />
            <ExportButton onClick={() => exportCsv('compliance_status.csv', complianceData.headers, complianceData.rawRows)} />
          </div>
        )
      case 'inspections': {
        const { months, buckets, passRate, total } = inspectionData
        return (
          <div>
            <div style={{ marginBottom: '12px', display: 'flex', flexWrap: 'wrap' }}>
              <SummaryBadge label="Overall Pass Rate" value={`${passRate}%`} />
              <SummaryBadge label="Total Inspections" value={total} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, color: THEME.text, borderBottom: `2px solid ${THEME.outline}` }}>Month</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#22c55e', borderBottom: `2px solid ${THEME.outline}` }}>Pass</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#ef4444', borderBottom: `2px solid ${THEME.outline}` }}>Fail</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700, color: '#f59e0b', borderBottom: `2px solid ${THEME.outline}` }}>Conditional</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((m, ri) => (
                    <tr key={m.key} style={{ background: ri % 2 === 0 ? 'transparent' : `${THEME.outline}22` }}>
                      <td style={{ padding: '7px 12px', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}44` }}>{m.label}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'center', color: THEME.text, borderBottom: `1px solid ${THEME.outline}44` }}>{buckets[m.key].pass}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'center', color: THEME.text, borderBottom: `1px solid ${THEME.outline}44` }}>{buckets[m.key].fail}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'center', color: THEME.text, borderBottom: `1px solid ${THEME.outline}44` }}>{buckets[m.key].conditional}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ExportButton onClick={() => {
              const h = ['Month', 'Pass', 'Fail', 'Conditional']
              const r = months.map(m => [m.label, buckets[m.key].pass, buckets[m.key].fail, buckets[m.key].conditional])
              exportCsv('inspection_summary.csv', h, r)
            }} />
          </div>
        )
      }
      case 'assignments':
        return (
          <div>
            <DataTable headers={assignmentData.headers} rows={assignmentData.rows} />
            <ExportButton onClick={() => exportCsv('assignment_history.csv', assignmentData.headers, assignmentData.rows)} />
          </div>
        )
      default:
        return null
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '40px', color, animation: 'spin 1s linear infinite' }}>progress_activity</span>
        <p style={{ marginTop: '12px' }}>Loading fleet reports...</p>
      </div>
    )
  }

  const cardBase = {
    background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outline}`,
    padding: '20px', display: 'flex', flexDirection: 'column',
  }

  return (
    <div style={{ padding: '0' }}>
      <FleetQuickNav setPage={setPage} current="fleet_reports" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{
          width: '40px', height: '40px', borderRadius: '12px', background: `${color}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>analytics</span>
        </div>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, margin: 0 }}>Fleet Reports</h2>
          <p style={{ fontSize: '13px', color: THEME.textLow, margin: 0 }}>Summary analytics and report hub</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '28px' }}>
        {[
          {
            icon: 'directions_car', label: 'Total Fleet Size', value: summary.totalAssets,
            sub: `${summary.vCount} vehicles, ${summary.eCount} equipment, ${summary.gCount} generators`,
          },
          {
            icon: 'speed', label: 'Utilisation Rate', value: `${summary.utilisationRate}%`,
            sub: `${(activeAssignments || []).length} active of ${(assets || []).length} assets`,
          },
          {
            icon: 'verified_user', label: 'Compliance Rate', value: `${summary.complianceRate}%`,
            sub: `${(compliance || []).length} total compliance records`,
          },
          {
            icon: 'fact_check', label: 'Inspection Pass Rate', value: `${summary.inspectionRate}%`,
            sub: `${(inspections || []).length} total inspections`,
          },
        ].map((card, i) => (
          <div key={i} style={{ ...cardBase }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px', background: `${color}14`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>{card.icon}</span>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.textLow }}>{card.label}</span>
            </div>
            <div style={{ fontSize: '28px', fontWeight: 700, color: THEME.text, marginBottom: '4px' }}>{card.value}</div>
            <div style={{ fontSize: '12px', color: THEME.textLow }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Asset Status Distribution */}
      <h3 style={{ fontSize: '16px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Asset Status Distribution</h3>
      <div style={{ ...cardBase, marginBottom: '28px' }}>
        <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', height: '32px', marginBottom: '16px', background: THEME.background }}>
          {Object.entries(statusDistribution).map(([status, count]) => {
            const pct = totalForBar > 0 ? (count / totalForBar) * 100 : 0
            if (pct === 0) return null
            const sc = STATUS_COLORS[status] || STATUS_COLORS.operational
            return (
              <div key={status} title={`${status}: ${count}`} style={{
                width: `${pct}%`, background: sc.bar, minWidth: pct > 0 ? '4px' : 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: '11px', fontWeight: 700, transition: 'width 0.3s',
              }}>
                {pct >= 8 ? `${Math.round(pct)}%` : ''}
              </div>
            )
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {Object.entries(statusDistribution).map(([status, count]) => {
            const sc = STATUS_COLORS[status] || STATUS_COLORS.operational
            const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            return (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: sc.bar }} />
                <span style={{ color: THEME.text, fontWeight: 600 }}>{label}</span>
                <span style={{ color: THEME.textLow }}>{count}</span>
              </div>
            )
          })}
        </div>
        {totalForBar === 0 && (
          <p style={{ color: THEME.textLow, fontSize: '13px', textAlign: 'center', margin: '12px 0 0' }}>No asset data available</p>
        )}
      </div>

      {/* Expandable Report Sections */}
      <h3 style={{ fontSize: '16px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Reports</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
        {REPORT_DEFS.map(r => {
          const isOpen = !!expanded[r.key]
          return (
            <div key={r.key} style={{
              background: THEME.surface, borderRadius: '12px', border: `1px solid ${isOpen ? color : THEME.outline}`,
              overflow: 'hidden', transition: 'border-color 0.2s',
            }}>
              <div
                onClick={() => toggle(r.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px',
                  cursor: 'pointer', userSelect: 'none',
                }}
                onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = `${color}08` }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px', background: `${color}14`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>{r.icon}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: THEME.text }}>{r.title}</div>
                  <div style={{ fontSize: '12px', color: THEME.textLow }}>{r.desc}</div>
                </div>
                <span className="material-symbols-rounded" style={{
                  fontSize: '22px', color: THEME.textLow, transition: 'transform 0.2s',
                  transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                }}>expand_more</span>
              </div>
              {isOpen && (
                <div style={{ padding: '0 20px 20px 20px', borderTop: `1px solid ${THEME.outline}44` }}>
                  <div style={{ paddingTop: '16px' }}>
                    {renderReportContent(r.key)}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: '12px', padding: '6px 16px', borderRadius: '8px',
        background: `${MODULE_COLORS.fleet}14`, color: MODULE_COLORS.fleet,
        border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
        display: 'inline-flex', alignItems: 'center', gap: '6px',
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>download</span>
      CSV Export
    </button>
  )
}
