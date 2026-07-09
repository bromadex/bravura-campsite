import { useState, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'

const COLOR = MODULE_COLORS.fuel

const Icon = ({ name, size = 18, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', color: 'inherit', ...style }}>{name}</span>
)

const btn = (extra = {}) => ({
  border: 'none', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 600, fontSize: '13px', padding: '8px 16px',
  display: 'inline-flex', alignItems: 'center', gap: '6px', ...extra,
})

const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'
const fmtCost = n => n != null ? '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

function exportCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Pastel swatch for each department row
const DEPT_COLORS = ['#D97706', '#1A6B52', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#6366F1']

export default function CostAllocation() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  if (!can('fuel.view')) return (
    <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>
      <Icon name="lock" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      Access denied
    </div>
  )

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(firstOfMonth)
  const [to, setTo]     = useState(today)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)

    // Parallel: issuances + last delivery unit price per fuel type + departments
    const [{ data: txns }, { data: deliveries }, { data: depts }] = await Promise.all([
      supabase.from('fuel_transactions')
        .select('litres, unit_price, fleet_asset_id, fleet_asset:fleet_assets(department_id, fuel_types(name, id))')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
        .eq('transaction_type', 'issuance')
        .gte('transaction_date', from)
        .lte('transaction_date', to),
      supabase.from('fuel_transactions')
        .select('unit_price, fuel_types(name, id)')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
        .eq('transaction_type', 'delivery')
        .not('unit_price', 'is', null)
        .order('transaction_date', { ascending: false }),
      supabase.from('departments')
        .select('id, name')
        .eq('site_id', currentSiteId),
    ])

    // Build department name lookup
    const deptMap = {}
    for (const d of (depts || [])) deptMap[d.id] = d.name

    // Build latest unit_price per fuel type from deliveries
    const unitPrice = {}
    for (const d of (deliveries || [])) {
      const ftId = d.fuel_types?.id
      if (ftId && !unitPrice[ftId]) unitPrice[ftId] = { price: Number(d.unit_price), name: d.fuel_types.name }
    }

    // Group issuances: dept → fuelType → { litres, cost }
    const deptData = {}
    for (const t of (txns || [])) {
      const deptId = t.fleet_asset?.department_id || null
      const deptKey = deptId || '__unassigned__'
      const deptLabel = deptId ? (deptMap[deptId] || deptId) : 'Unassigned'
      const fuelTypeId = t.fleet_asset?.fuel_types?.id
      const fuelTypeName = t.fleet_asset?.fuel_types?.name || 'Unknown'

      if (!deptData[deptKey]) deptData[deptKey] = { label: deptLabel, fuelTypes: {}, totalLitres: 0, totalCost: 0 }
      if (!deptData[deptKey].fuelTypes[fuelTypeName]) deptData[deptKey].fuelTypes[fuelTypeName] = { litres: 0, cost: 0 }

      const litres = Number(t.litres)
      // Use transaction's own unit_price if present, else last known delivery price for this fuel type
      const price = t.unit_price != null ? Number(t.unit_price) : (fuelTypeId ? unitPrice[fuelTypeId]?.price ?? null : null)
      const cost = price != null ? litres * price : null

      deptData[deptKey].fuelTypes[fuelTypeName].litres += litres
      if (cost != null) deptData[deptKey].fuelTypes[fuelTypeName].cost += cost
      deptData[deptKey].totalLitres += litres
      if (cost != null) deptData[deptKey].totalCost += cost
    }

    const rows = Object.values(deptData).sort((a, b) => b.totalLitres - a.totalLitres)
    const grandLitres = rows.reduce((s, r) => s + r.totalLitres, 0)
    const grandCost   = rows.reduce((s, r) => s + r.totalCost, 0)
    setData({ rows, grandLitres, grandCost, unitPrice })
    setLoading(false)
  }, [currentSiteId, from, to])

  const doExport = () => {
    if (!data) return
    const headers = ['Department', 'Fuel Type', 'Litres', 'Unit Price', 'Allocated Cost']
    const csvRows = []
    for (const dept of data.rows) {
      for (const [ft, v] of Object.entries(dept.fuelTypes)) {
        const priceEntry = Object.values(data.unitPrice).find(p => p.name === ft)
        csvRows.push([dept.label, ft, v.litres.toFixed(1), priceEntry?.price?.toFixed(4) ?? '', v.cost > 0 ? v.cost.toFixed(2) : ''])
      }
    }
    exportCsv(`cost-allocation-${from}-to-${to}.csv`, headers, csvRows)
  }

  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Department Cost Allocation</h2>
        <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>
          Internal fuel cost allocation by department — based on last known delivery rate
        </p>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '24px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={selStyle} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={selStyle} />
        </div>
        <button onClick={run} disabled={loading} style={{ ...btn({ background: COLOR, color: '#fff', opacity: loading ? 0.6 : 1 }) }}>
          <Icon name="calculate" size={15} /> {loading ? 'Loading…' : 'Calculate'}
        </button>
        {data && can('fuel.edit') && (
          <button onClick={doExport} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        )}
      </div>

      {data && (
        <>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
            <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '14px 20px', boxShadow: THEME.shadow1 }}>
              <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>Total Volume Allocated</div>
              <div style={{ fontSize: '26px', fontWeight: 700, color: THEME.warning }}>{fmt(data.grandLitres)} L</div>
            </div>
            <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '14px 20px', boxShadow: THEME.shadow1 }}>
              <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>Total Allocated Cost</div>
              <div style={{ fontSize: '26px', fontWeight: 700, color: COLOR }}>{fmtCost(data.grandCost)}</div>
              {Object.values(data.unitPrice).length > 0 && (
                <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
                  Based on last delivery: {Object.values(data.unitPrice).map(p => `${p.name} @ ${fmtCost(p.price)}/L`).join(' · ')}
                </div>
              )}
            </div>
          </div>

          {/* Price note if any dept has no price */}
          {Object.values(data.unitPrice).length === 0 && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 14px', background: THEME.statusWarningBg, border: `1px solid ${THEME.warning}30`, borderRadius: '10px', marginBottom: '16px', fontSize: '13px', color: THEME.statusWarningText }}>
              <Icon name="info" size={15} />
              No delivery records with unit price found — cost calculation unavailable. Record a delivery with a unit price to enable cost allocation.
            </div>
          )}

          {/* Department breakdown */}
          {data.rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, color: THEME.textMed }}>
              No issuances with department assignment in this period.
            </div>
          ) : (
            data.rows.map((dept, di) => {
              const deptColor = DEPT_COLORS[di % DEPT_COLORS.length]
              const ftEntries = Object.entries(dept.fuelTypes).sort(([, a], [, b]) => b.litres - a.litres)
              return (
                <div key={dept.label} style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, marginBottom: '16px', overflow: 'hidden', boxShadow: THEME.shadow1 }}>
                  {/* Department header */}
                  <div style={{ padding: '12px 18px', background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: deptColor, display: 'inline-block', flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, fontSize: '14px', color: THEME.text }}>{dept.label}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '20px', fontSize: '12px' }}>
                      <span style={{ color: THEME.warning, fontWeight: 600 }}>{fmt(dept.totalLitres)} L</span>
                      {dept.totalCost > 0 && <span style={{ color: COLOR, fontWeight: 700 }}>{fmtCost(dept.totalCost)}</span>}
                      {data.grandLitres > 0 && <span style={{ color: THEME.textLow }}>{((dept.totalLitres / data.grandLitres) * 100).toFixed(1)}% of total</span>}
                    </div>
                  </div>

                  {/* Volume bar */}
                  {data.grandLitres > 0 && (
                    <div style={{ padding: '8px 18px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <div style={{ height: '4px', borderRadius: '4px', background: THEME.outlineVar }}>
                        <div style={{ height: '100%', borderRadius: '4px', width: `${(dept.totalLitres / data.grandLitres) * 100}%`, background: deptColor, transition: 'width .4s' }} />
                      </div>
                    </div>
                  )}

                  {/* Fuel type breakdown */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <th style={{ padding: '8px 18px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Fuel Type</th>
                        <th style={{ padding: '8px 18px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Litres</th>
                        <th style={{ padding: '8px 18px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Unit Rate</th>
                        <th style={{ padding: '8px 18px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Allocated Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ftEntries.map(([ft, v]) => {
                        const priceEntry = Object.values(data.unitPrice).find(p => p.name === ft)
                        return (
                          <tr key={ft} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                            <td style={{ padding: '10px 18px', color: THEME.text }}>{ft}</td>
                            <td style={{ padding: '10px 18px', textAlign: 'right', fontWeight: 600, color: THEME.warning }}>{fmt(v.litres)} L</td>
                            <td style={{ padding: '10px 18px', textAlign: 'right', color: THEME.textMed }}>
                              {priceEntry ? fmtCost(priceEntry.price) + '/L' : '—'}
                            </td>
                            <td style={{ padding: '10px 18px', textAlign: 'right', fontWeight: v.cost > 0 ? 700 : 400, color: v.cost > 0 ? COLOR : THEME.textLow }}>
                              {v.cost > 0 ? fmtCost(v.cost) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
