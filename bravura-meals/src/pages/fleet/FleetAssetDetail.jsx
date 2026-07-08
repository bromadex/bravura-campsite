import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { useFleet } from '../../contexts/FleetContext'

const CLR = MODULE_COLORS.fleet

const TABS = ['Overview', 'Fuel History', 'Maintenance', 'Inspections', 'Trips', 'Compliance']

function expiryStatus(dateStr) {
  if (!dateStr) return 'none'
  const diff = (new Date(dateStr) - new Date()) / 86400000
  if (diff < 0) return 'expired'
  if (diff <= 7) return 'critical'
  if (diff <= 30) return 'warning'
  return 'ok'
}

const EXPIRY_COLORS = {
  expired:  { bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
  critical: { bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
  warning:  { bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  ok:       { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  none:     { bg: THEME.surface,         text: THEME.textLow },
}

const STATUS_MAP = {
  operational:    { label: 'Operational',    bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText },
  maintenance:    { label: 'Maintenance',    bg: THEME.statusWarningBg,  text: THEME.statusWarningText },
  grounded:       { label: 'Grounded',       bg: THEME.statusErrorBg,    text: THEME.statusErrorText },
  awaiting_parts: { label: 'Awaiting Parts', bg: THEME.statusTertiaryBg, text: THEME.statusTertiaryText },
  decommissioned: { label: 'Decommissioned', bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
}

function Badge({ label, bg, color }) {
  return (
    <span style={{
      display: 'inline-block', fontSize: '11px', fontWeight: 600,
      padding: '2px 10px', borderRadius: '999px', background: bg, color,
    }}>{label}</span>
  )
}

function StatCard({ label, value, sub, icon }) {
  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: '10px',
      padding: '14px 16px', flex: '1 1 140px', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '16px', color: CLR }}>{icon}</span>
        <span style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

export default function FleetAssetDetail({ asset, onClose }) {
  const { currentSiteId } = useSite()
  const { inspections, workOrders, trips, compliance, assignments } = useFleet()
  const [tab, setTab] = useState(0)
  const [fuelTxns, setFuelTxns] = useState([])
  const [fuelLoading, setFuelLoading] = useState(false)

  useEffect(() => {
    if (!asset || !currentSiteId) return
    setFuelLoading(true)

    async function loadFuel() {
      // Try fleet_asset_id first, fall back to old FK columns
      let query = supabase
        .from('fuel_transactions')
        .select('id, transaction_date, transaction_type, litres, unit_price, total_cost, docket_number, fuel_tanks(name), fuel_types:fuel_tanks(fuel_types(name))')
        .eq('site_id', currentSiteId)
        .order('transaction_date', { ascending: false })
        .limit(200)

      if (asset.id) {
        // Try direct bridge column
        const { data: bridged } = await supabase
          .from('fuel_transactions')
          .select('id, transaction_date, transaction_type, litres, unit_price, total_cost, docket_number')
          .eq('site_id', currentSiteId)
          .eq('fleet_asset_id', asset.id)
          .order('transaction_date', { ascending: false })
          .limit(200)

        if (bridged && bridged.length > 0) {
          setFuelTxns(bridged)
          setFuelLoading(false)
          return
        }

        // Fallback: match through old FK columns
        const conditions = []
        if (asset.old_fuel_vehicle_id) {
          const { data } = await supabase
            .from('fuel_transactions')
            .select('id, transaction_date, transaction_type, litres, unit_price, total_cost, docket_number')
            .eq('site_id', currentSiteId)
            .eq('vehicle_id', asset.old_fuel_vehicle_id)
            .order('transaction_date', { ascending: false })
            .limit(200)
          setFuelTxns(data || [])
          setFuelLoading(false)
          return
        }
        if (asset.old_fuel_equipment_id) {
          const { data } = await supabase
            .from('fuel_transactions')
            .select('id, transaction_date, transaction_type, litres, unit_price, total_cost, docket_number')
            .eq('site_id', currentSiteId)
            .eq('equipment_id', asset.old_fuel_equipment_id)
            .order('transaction_date', { ascending: false })
            .limit(200)
          setFuelTxns(data || [])
          setFuelLoading(false)
          return
        }
      }
      setFuelTxns([])
      setFuelLoading(false)
    }
    loadFuel()
  }, [asset, currentSiteId])

  const assetInspections = useMemo(() =>
    inspections.filter(i => i.asset_id === asset?.id),
    [inspections, asset]
  )
  const assetWorkOrders = useMemo(() =>
    workOrders.filter(w => w.asset_id === asset?.id),
    [workOrders, asset]
  )
  const assetTrips = useMemo(() =>
    trips.filter(t => t.asset_id === asset?.id),
    [trips, asset]
  )
  const assetCompliance = useMemo(() =>
    compliance.filter(c => c.asset_id === asset?.id),
    [compliance, asset]
  )
  const assetAssignments = useMemo(() =>
    assignments.filter(a => a.asset_id === asset?.id),
    [assignments, asset]
  )

  // Fuel stats
  const fuelStats = useMemo(() => {
    if (!fuelTxns.length) return { total: 0, cost: 0, count: 0, avg: 0, lastDate: null }
    const issuances = fuelTxns.filter(t => t.transaction_type === 'issuance')
    const total = issuances.reduce((s, t) => s + Number(t.litres || 0), 0)
    const cost = issuances.reduce((s, t) => s + Number(t.total_cost || 0), 0)
    return {
      total: total.toFixed(0),
      cost: cost.toFixed(2),
      count: issuances.length,
      avg: issuances.length ? (total / issuances.length).toFixed(1) : 0,
      lastDate: issuances[0]?.transaction_date || null,
    }
  }, [fuelTxns])

  if (!asset) return null

  const st = STATUS_MAP[asset.status] || STATUS_MAP.operational
  const typeName = asset.fleet_asset_types?.name || 'Asset'

  const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 2000,
    display: 'flex', justifyContent: 'flex-end',
  }
  const panelStyle = {
    width: '680px', maxWidth: '100vw', height: '100vh', background: THEME.bg,
    overflowY: 'auto', boxShadow: '-4px 0 24px rgba(0,0,0,.15)',
    display: 'flex', flexDirection: 'column',
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 0', borderBottom: `1px solid ${THEME.outline}`,
          background: CLR + '08',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 600, textTransform: 'uppercase', marginBottom: '4px' }}>
                {typeName}
              </div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>
                {asset.asset_number}
              </div>
              <div style={{ fontSize: '13px', color: THEME.textLow, marginTop: '2px' }}>
                {asset.description || `${asset.make || ''} ${asset.model || ''}`.trim() || '—'}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Badge label={st.label} bg={st.bg} color={st.text} />
              <button onClick={onClose} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: '4px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px' }}>close</span>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0', marginTop: '8px' }}>
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setTab(i)} style={{
                background: 'none', border: 'none', borderBottom: `2px solid ${tab === i ? CLR : 'transparent'}`,
                padding: '8px 14px', fontSize: '12px', fontWeight: tab === i ? 700 : 500,
                color: tab === i ? CLR : THEME.textLow, cursor: 'pointer', fontFamily: 'inherit',
                transition: 'all .15s',
              }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
          {tab === 0 && <OverviewTab asset={asset} assignments={assetAssignments} />}
          {tab === 1 && <FuelTab txns={fuelTxns} stats={fuelStats} loading={fuelLoading} />}
          {tab === 2 && <MaintenanceTab workOrders={assetWorkOrders} />}
          {tab === 3 && <InspectionsTab inspections={assetInspections} />}
          {tab === 4 && <TripsTab trips={assetTrips} />}
          {tab === 5 && <ComplianceTab compliance={assetCompliance} asset={asset} />}
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ asset, assignments }) {
  const activeAssign = assignments.find(a => a.is_active)
  const rows = [
    ['Registration', asset.registration],
    ['Fleet Number', asset.fleet_number],
    ['Make / Model', `${asset.make || ''} ${asset.model || ''}`.trim()],
    ['Year', asset.year],
    ['VIN', asset.vin],
    ['Serial Number', asset.serial_number],
    ['Department', asset.departments?.name || asset.department_name],
    ['Cost Centre', asset.cost_center],
    ['Project', asset.assigned_project],
    ['Odometer', asset.current_odometer_km ? `${Number(asset.current_odometer_km).toLocaleString()} km` : null],
    ['Hours', asset.current_hours ? `${Number(asset.current_hours).toLocaleString()} hrs` : null],
    ['Tank Capacity', asset.tank_capacity_litres ? `${asset.tank_capacity_litres} L` : null],
    ['Tracker ID', asset.tracker_id],
  ].filter(r => r[1])

  return (
    <div>
      {activeAssign && (
        <div style={{
          background: CLR + '10', border: `1px solid ${CLR}30`, borderRadius: '8px',
          padding: '10px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '16px', color: CLR }}>person</span>
          <span style={{ fontSize: '12px', color: THEME.text }}>
            <strong>Assigned:</strong> {activeAssign.employees?.name || 'Operator'} — {activeAssign.assignment_type} ({activeAssign.shift || 'day'} shift)
          </span>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <tbody>
          {rows.map(([label, val]) => (
            <tr key={label} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
              <td style={{ padding: '8px 0', color: THEME.textLow, fontWeight: 600, width: '40%' }}>{label}</td>
              <td style={{ padding: '8px 0', color: THEME.text }}>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Expiry quick view */}
      <div style={{ marginTop: '20px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.text, marginBottom: '8px' }}>Expiry Dates</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            ['Licence', asset.licence_expiry],
            ['Insurance', asset.insurance_expiry],
            ['Roadworthy', asset.roadworthy_expiry],
          ].map(([label, date]) => {
            const es = expiryStatus(date)
            const ec = EXPIRY_COLORS[es]
            return (
              <div key={label} style={{
                background: ec.bg, color: ec.text, borderRadius: '8px',
                padding: '8px 12px', fontSize: '12px', fontWeight: 600, minWidth: '120px',
              }}>
                <div style={{ fontSize: '10px', opacity: .7, marginBottom: '2px' }}>{label}</div>
                {date || 'Not set'}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function FuelTab({ txns, stats, loading }) {
  if (loading) return <div style={{ color: THEME.textLow, fontSize: '13px', padding: '20px 0' }}>Loading fuel data…</div>

  return (
    <div>
      {/* Stats cards */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatCard icon="local_gas_station" label="Total Fuel" value={`${stats.total} L`} sub={`${stats.count} issuances`} />
        <StatCard icon="payments" label="Total Cost" value={`R ${Number(stats.cost).toLocaleString()}`} />
        <StatCard icon="speed" label="Avg per Fill" value={`${stats.avg} L`} />
        <StatCard icon="event" label="Last Refuel" value={stats.lastDate || '—'} />
      </div>

      {txns.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '40px 0', color: THEME.textLow, fontSize: '13px',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '40px', display: 'block', marginBottom: '8px', opacity: .4 }}>
            local_gas_station
          </span>
          No fuel transactions linked to this asset
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                {['Date', 'Type', 'Litres', 'Unit Price', 'Total', 'Docket'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 6px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {txns.map(t => (
                <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  <td style={{ padding: '7px 6px', color: THEME.text }}>{t.transaction_date}</td>
                  <td style={{ padding: '7px 6px' }}>
                    <Badge
                      label={t.transaction_type}
                      bg={t.transaction_type === 'issuance' ? THEME.statusSuccessBg : THEME.statusNeutralBg}
                      color={t.transaction_type === 'issuance' ? THEME.statusSuccessText : THEME.statusNeutralText}
                    />
                  </td>
                  <td style={{ padding: '7px 6px', color: THEME.text, fontWeight: 600 }}>{Number(t.litres).toFixed(1)}</td>
                  <td style={{ padding: '7px 6px', color: THEME.textLow }}>{t.unit_price ? `R ${Number(t.unit_price).toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '7px 6px', color: THEME.text }}>{t.total_cost ? `R ${Number(t.total_cost).toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '7px 6px', color: THEME.textLow }}>{t.docket_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function MaintenanceTab({ workOrders }) {
  const PRIORITY_CLR = {
    critical: { bg: THEME.statusErrorBg, text: THEME.statusErrorText },
    high:     { bg: '#FFF3E0',           text: '#E65100' },
    medium:   { bg: THEME.statusWarningBg, text: THEME.statusWarningText },
    low:      { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
  }
  const STATUS_CLR = {
    scheduled:          { bg: '#E3F2FD', text: '#1565C0' },
    in_progress:        { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
    waiting_for_parts:  { bg: THEME.statusWarningBg, text: THEME.statusWarningText },
    completed:          { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
    cancelled:          { bg: THEME.statusErrorBg, text: THEME.statusErrorText },
  }

  if (!workOrders.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: THEME.textLow, fontSize: '13px' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '40px', display: 'block', marginBottom: '8px', opacity: .4 }}>build</span>
      No work orders for this asset
    </div>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
            {['WO #', 'Fault', 'Priority', 'Status', 'Created'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 6px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workOrders.map(wo => {
            const pc = PRIORITY_CLR[wo.priority] || PRIORITY_CLR.medium
            const sc = STATUS_CLR[wo.status] || STATUS_CLR.scheduled
            return (
              <tr key={wo.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                <td style={{ padding: '7px 6px', fontWeight: 600, color: THEME.text }}>{wo.work_order_number}</td>
                <td style={{ padding: '7px 6px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.fault_description}</td>
                <td style={{ padding: '7px 6px' }}><Badge label={wo.priority} bg={pc.bg} color={pc.text} /></td>
                <td style={{ padding: '7px 6px' }}><Badge label={wo.status?.replace(/_/g, ' ')} bg={sc.bg} color={sc.text} /></td>
                <td style={{ padding: '7px 6px', color: THEME.textLow }}>{wo.created_at?.slice(0, 10)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function InspectionsTab({ inspections }) {
  const RESULT_CLR = {
    pass:        { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
    fail:        { bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
    conditional: { bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  }

  if (!inspections.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: THEME.textLow, fontSize: '13px' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '40px', display: 'block', marginBottom: '8px', opacity: .4 }}>checklist</span>
      No inspections for this asset
    </div>
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
            {['Date', 'Inspector', 'Result', 'Score', 'Next Due'].map(h => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 6px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {inspections.map(ins => {
            const rc = RESULT_CLR[ins.result] || RESULT_CLR.pass
            return (
              <tr key={ins.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                <td style={{ padding: '7px 6px', color: THEME.text }}>{ins.inspection_date}</td>
                <td style={{ padding: '7px 6px', color: THEME.text }}>{ins.employees?.name || '—'}</td>
                <td style={{ padding: '7px 6px' }}><Badge label={ins.result} bg={rc.bg} color={rc.text} /></td>
                <td style={{ padding: '7px 6px', color: THEME.text, fontWeight: 600 }}>{ins.overall_score ?? '—'}</td>
                <td style={{ padding: '7px 6px', color: THEME.textLow }}>{ins.next_due_date || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TripsTab({ trips }) {
  const STATUS_CLR = {
    completed:   { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
    in_progress: { bg: '#E3F2FD',             text: '#1565C0' },
    planned:     { bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
    cancelled:   { bg: THEME.statusErrorBg,    text: THEME.statusErrorText },
  }

  const totalKm = trips.reduce((s, t) => s + Number(t.distance_km || 0), 0)
  const totalFuel = trips.reduce((s, t) => s + Number(t.fuel_used_litres || 0), 0)

  if (!trips.length) return (
    <div style={{ textAlign: 'center', padding: '40px 0', color: THEME.textLow, fontSize: '13px' }}>
      <span className="material-symbols-rounded" style={{ fontSize: '40px', display: 'block', marginBottom: '8px', opacity: .4 }}>route</span>
      No trips logged for this asset
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <StatCard icon="route" label="Total Distance" value={`${totalKm.toLocaleString()} km`} sub={`${trips.length} trips`} />
        <StatCard icon="local_gas_station" label="Fuel Used" value={`${totalFuel.toFixed(0)} L`} />
        <StatCard icon="speed" label="Efficiency" value={totalFuel > 0 ? `${(totalKm / totalFuel).toFixed(1)} km/L` : '—'} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
              {['Date', 'Driver', 'Route', 'Distance', 'Status'].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 6px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trips.slice(0, 20).map(t => {
              const sc = STATUS_CLR[t.status] || STATUS_CLR.planned
              return (
                <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  <td style={{ padding: '7px 6px', color: THEME.text }}>{t.trip_date}</td>
                  <td style={{ padding: '7px 6px', color: THEME.text }}>{t.employees?.name || '—'}</td>
                  <td style={{ padding: '7px 6px', color: THEME.text }}>{[t.origin, t.destination].filter(Boolean).join(' → ') || '—'}</td>
                  <td style={{ padding: '7px 6px', fontWeight: 600, color: THEME.text }}>{t.distance_km ? `${t.distance_km} km` : '—'}</td>
                  <td style={{ padding: '7px 6px' }}><Badge label={t.status} bg={sc.bg} color={sc.text} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ComplianceTab({ compliance, asset }) {
  if (!compliance.length && !asset.licence_expiry && !asset.insurance_expiry && !asset.roadworthy_expiry) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: THEME.textLow, fontSize: '13px' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '40px', display: 'block', marginBottom: '8px', opacity: .4 }}>verified_user</span>
        No compliance records for this asset
      </div>
    )
  }

  return (
    <div>
      {/* Quick expiry from asset fields */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.text, marginBottom: '8px' }}>Quick Expiry Status</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[
            ['Licence', asset.licence_expiry],
            ['Insurance', asset.insurance_expiry],
            ['Roadworthy', asset.roadworthy_expiry],
          ].map(([label, date]) => {
            const es = expiryStatus(date)
            const ec = EXPIRY_COLORS[es]
            return (
              <div key={label} style={{
                background: ec.bg, color: ec.text, borderRadius: '8px',
                padding: '8px 12px', fontSize: '12px', fontWeight: 600, minWidth: '120px',
              }}>
                <div style={{ fontSize: '10px', opacity: .7, marginBottom: '2px' }}>{label}</div>
                {date || 'Not set'}
              </div>
            )
          })}
        </div>
      </div>

      {compliance.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                {['Type', 'Document #', 'Issue Date', 'Expiry', 'Authority'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '8px 6px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compliance.map(c => {
                const es = expiryStatus(c.expiry_date)
                const ec = EXPIRY_COLORS[es]
                return (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                    <td style={{ padding: '7px 6px', color: THEME.text }}>{c.compliance_type?.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '7px 6px', color: THEME.text, fontWeight: 600 }}>{c.document_number || '—'}</td>
                    <td style={{ padding: '7px 6px', color: THEME.textLow }}>{c.issue_date || '—'}</td>
                    <td style={{ padding: '7px 6px' }}>
                      <span style={{ background: ec.bg, color: ec.text, padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                        {c.expiry_date || '—'}
                      </span>
                    </td>
                    <td style={{ padding: '7px 6px', color: THEME.textLow }}>{c.issuing_authority || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
