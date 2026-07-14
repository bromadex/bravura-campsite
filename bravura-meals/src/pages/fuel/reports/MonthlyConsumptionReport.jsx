import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../hooks/usePermissions'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { DashCard, KpiCard, SectionTitle, ProgressRow } from '../../../components/dash'

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

function Section({ title, children }) {
  return (
    <DashCard style={{ marginBottom: '20px', padding: '20px 22px 8px' }}>
      <SectionTitle title={title} />
      <div style={{ overflowX: 'auto' }}>{children}</div>
    </DashCard>
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
        .select('*, tank:fuel_tanks(name, fuel_types(name)), fleet_asset:fleet_assets(fleet_number, registration, asset_number, description, department_name)')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
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
    for (const t of all.filter(t => t.transaction_type === 'issuance' && t.fleet_asset_id)) {
      const a = t.fleet_asset
      const label = a ? `${a.fleet_number || a.asset_number || ''}${a.registration ? ` (${a.registration})` : ''}`.trim() || a.description || t.fleet_asset_id : t.fleet_asset_id
      if (!byVehicle[label]) byVehicle[label] = { litres: 0, dept: a?.department_name || '—' }
      byVehicle[label].litres += Number(t.litres)
    }

    // By department
    const byDept = {}
    for (const t of all.filter(t => t.transaction_type === 'issuance')) {
      const dept = t.fleet_asset?.department_name || 'Unassigned'
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            <KpiCard icon="output" label="Total Issued" value={fmt(data.totalIssued) + ' L'} accent={THEME.warning}
              progress={data.totalIssued + data.totalDelivered > 0 ? (data.totalIssued / (data.totalIssued + data.totalDelivered)) * 100 : 0}
              sub="Share of month's volume" />
            <KpiCard icon="local_gas_station" label="Total Delivered" value={fmt(data.totalDelivered) + ' L'} accent={THEME.success}
              progress={data.totalIssued + data.totalDelivered > 0 ? (data.totalDelivered / (data.totalIssued + data.totalDelivered)) * 100 : 0}
              sub="Share of month's volume" />
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
              <thead><tr>
                <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${THEME.outlineVar}` }}>Vehicle</th>
                <th style={{ padding: '8px 16px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${THEME.outlineVar}` }}>Department</th>
                <th style={{ padding: '8px 16px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${THEME.outlineVar}` }}>Litres</th>
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
          <DashCard style={{ marginBottom: '20px' }}>
            <SectionTitle title="Current Tank Levels" subtitle="Fill level against capacity" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {data.tanks.map(t => {
                const pct = t.capacity_litres ? Math.min(100, (Number(t.current_level_litres) / Number(t.capacity_litres)) * 100) : null
                const pc = pct == null ? THEME.textMed : pct < 20 ? THEME.error : pct < 40 ? THEME.warning : THEME.success
                return (
                  <div key={t.id}>
                    <ProgressRow
                      label={t.name}
                      value={pct != null ? pct.toFixed(0) + '%' : '—'}
                      pct={pct ?? 0}
                      color={pc}
                    />
                    <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px', marginLeft: '120px' }}>
                      {t.fuel_types?.name || '—'} · {fmt(t.current_level_litres)} L{t.capacity_litres ? ` of ${fmt(t.capacity_litres)} L` : ''}
                    </div>
                  </div>
                )
              })}
              {data.tanks.length === 0 && <div style={{ padding: '12px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No active tanks</div>}
            </div>
          </DashCard>
        </>
      )}
    </div>
  )
}
