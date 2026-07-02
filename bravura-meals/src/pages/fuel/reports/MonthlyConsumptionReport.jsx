import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../hooks/usePermissions'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'

const COLOR = MODULE_COLORS.fuel

const Icon = ({ name, size = 18, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', color: 'inherit', ...style }}>{name}</span>
)

const btn = (extra = {}) => ({
  border: 'none', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 600, fontSize: '13px', padding: '8px 16px',
  display: 'inline-flex', alignItems: 'center', gap: '6px',
  ...extra,
})

const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'

function exportCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function Section({ title, children }) {
  return (
    <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, marginBottom: '20px', overflow: 'hidden', boxShadow: THEME.shadow1 }}>
      <div style={{ padding: '12px 18px', background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '12px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em' }}>{title}</div>
      {children}
    </div>
  )
}

export default function MonthlyConsumptionReport() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    const start = month + '-01'
    const end = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 0).toISOString().slice(0, 10)

    const [{ data: txns, error: txErr }, { data: tanks, error: tankErr }] = await Promise.all([
      supabase.from('fuel_transactions')
        .select('*, tank:fuel_tanks(name, fuel_types(name)), vehicle:fuel_vehicles(fleet_number, registration, department_name), equipment:fuel_equipment(name)')
        .eq('site_id', currentSiteId)
        .gte('transaction_date', start)
        .lte('transaction_date', end),
      supabase.from('fuel_tanks')
        .select('id, name, current_level_litres, capacity_litres, fuel_types(name)')
        .eq('site_id', currentSiteId)
        .eq('status', 'active')
        .eq('is_archived', false),
    ])

    if (txErr) console.error('MonthlyConsumptionReport txns query failed:', txErr)
    if (tankErr) console.error('MonthlyConsumptionReport tanks query failed:', tankErr)

    const all = txns || []

    // By fuel type
    const byFuelType = {}
    for (const t of all.filter(t => t.transaction_type === 'issuance')) {
      const k = t.tank?.fuel_types?.name || 'Diesel'
      byFuelType[k] = (byFuelType[k] || 0) + Number(t.litres)
    }

    // By vehicle
    const byVehicle = {}
    for (const t of all.filter(t => t.transaction_type === 'issuance' && t.vehicle_id)) {
      const label = t.vehicle ? `${t.vehicle.fleet_number}${t.vehicle.registration ? ` (${t.vehicle.registration})` : ''}` : t.vehicle_id
      if (!byVehicle[label]) byVehicle[label] = { litres: 0, dept: t.vehicle?.department_name || '—' }
      byVehicle[label].litres += Number(t.litres)
    }

    // By department
    const byDept = {}
    for (const t of all.filter(t => t.transaction_type === 'issuance')) {
      const dept = t.vehicle?.department_name || 'Unassigned'
      byDept[dept] = (byDept[dept] || 0) + Number(t.litres)
    }

    // By tank (deliveries)
    const byTankDelivery = {}
    for (const t of all.filter(t => t.transaction_type === 'delivery')) {
      const k = t.tank?.name || t.tank_id
      byTankDelivery[k] = (byTankDelivery[k] || 0) + Number(t.litres)
    }

    setData({ byFuelType, byVehicle, byDept, byTankDelivery, tanks: tanks || [], totalIssued: all.filter(t => t.transaction_type === 'issuance').reduce((s, t) => s + Number(t.litres), 0), totalDelivered: all.filter(t => t.transaction_type === 'delivery').reduce((s, t) => s + Number(t.litres), 0) })
    setLoading(false)
  }, [currentSiteId, month])

  useEffect(() => { run() }, [run])

  const doExport = () => {
    if (!data) return
    const headers = ['Category', 'Name', 'Litres']
    const rows = [
      ...Object.entries(data.byFuelType).map(([k, v]) => ['Fuel Type', k, v]),
      ...Object.entries(data.byVehicle).map(([k, v]) => ['Vehicle', k, v.litres]),
      ...Object.entries(data.byDept).map(([k, v]) => ['Department', k, v]),
    ]
    exportCsv(`monthly-consumption-${month}.csv`, headers, rows)
  }

  const selStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit' }

  const TableRow = ({ label, sub, value, bold }) => (
    <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
      <td style={{ padding: '10px 16px', color: bold ? THEME.text : THEME.textMed, fontWeight: bold ? 700 : 400 }}>
        {label}
        {sub && <div style={{ fontSize: '11px', color: THEME.textLow }}>{sub}</div>}
      </td>
      <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: bold ? 700 : 600, color: bold ? COLOR : THEME.text }}>
        {typeof value === 'number' ? fmt(value) + ' L' : value}
      </td>
    </tr>
  )

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Monthly Consumption Report</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>Fuel issued and delivered, broken down by fuel type, vehicle, and department</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '24px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={selStyle} />
        </div>
        {loading && <span style={{ fontSize: '12px', color: THEME.textLow, paddingBottom: '10px' }}>Loading…</span>}
        {data && can('fuel.edit') && (
          <button onClick={doExport} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="download" size={15} /> Export CSV
          </button>
        )}
      </div>

      {data && (
        <>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '20px' }}>
            {[
              { label: 'Total Issued', value: fmt(data.totalIssued) + ' L', color: THEME.warning },
              { label: 'Total Delivered', value: fmt(data.totalDelivered) + ' L', color: THEME.success },
            ].map(k => (
              <div key={k.label} style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '14px 20px', boxShadow: THEME.shadow1 }}>
                <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>{k.label}</div>
                <div style={{ fontSize: '26px', fontWeight: 700, color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* By fuel type */}
          <Section title="Issued by Fuel Type">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {Object.entries(data.byFuelType).sort(([, a], [, b]) => b - a).map(([k, v]) => <TableRow key={k} label={k} value={v} />)}
                {Object.keys(data.byFuelType).length === 0 && <tr><td colSpan={2} style={{ padding: '24px', textAlign: 'center', color: THEME.textLow }}>No issuances this month</td></tr>}
              </tbody>
            </table>
          </Section>

          {/* By vehicle */}
          <Section title="Vehicle Consumption">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Vehicle</th>
                <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Department</th>
                <th style={{ padding: '8px 16px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Litres</th>
              </tr></thead>
              <tbody>
                {Object.entries(data.byVehicle).sort(([, a], [, b]) => b.litres - a.litres).map(([k, v]) => (
                  <tr key={k} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '10px 16px', color: THEME.text }}>{k}</td>
                    <td style={{ padding: '10px 16px', color: THEME.textMed }}>{v.dept}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: THEME.text }}>{fmt(v.litres)} L</td>
                  </tr>
                ))}
                {Object.keys(data.byVehicle).length === 0 && <tr><td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: THEME.textLow }}>No vehicle issuances</td></tr>}
              </tbody>
            </table>
          </Section>

          {/* By department */}
          <Section title="Issued by Department">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {Object.entries(data.byDept).sort(([, a], [, b]) => b - a).map(([k, v]) => <TableRow key={k} label={k} value={v} />)}
                {Object.keys(data.byDept).length === 0 && <tr><td colSpan={2} style={{ padding: '24px', textAlign: 'center', color: THEME.textLow }}>No issuances</td></tr>}
              </tbody>
            </table>
          </Section>

          {/* Deliveries by tank */}
          <Section title="Delivered by Tank">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <tbody>
                {Object.entries(data.byTankDelivery).sort(([, a], [, b]) => b - a).map(([k, v]) => <TableRow key={k} label={k} value={v} />)}
                {Object.keys(data.byTankDelivery).length === 0 && <tr><td colSpan={2} style={{ padding: '24px', textAlign: 'center', color: THEME.textLow }}>No deliveries this month</td></tr>}
              </tbody>
            </table>
          </Section>

          {/* Tank levels */}
          <Section title="Current Tank Levels">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                {['Tank', 'Fuel Type', 'Current Level', 'Capacity', '%'].map(h => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: h === '%' || h === 'Current Level' || h === 'Capacity' ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.tanks.map(t => {
                  const pct = t.capacity_litres ? Math.min(100, (Number(t.current_level_litres) / Number(t.capacity_litres)) * 100) : null
                  const pc = pct == null ? THEME.textMed : pct < 20 ? THEME.error : pct < 40 ? THEME.warning : THEME.success
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '10px 16px', color: THEME.text, fontWeight: 500 }}>{t.name}</td>
                      <td style={{ padding: '10px 16px', color: THEME.textMed }}>{t.fuel_types?.name || '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: THEME.text, fontWeight: 600 }}>{fmt(t.current_level_litres)} L</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: THEME.textMed }}>{t.capacity_litres ? fmt(t.capacity_litres) + ' L' : '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: pc, fontWeight: 700 }}>{pct != null ? pct.toFixed(0) + '%' : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </div>
  )
}
