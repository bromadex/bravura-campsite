import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard, KpiCard, DonutGauge, ProgressRow, ActivityRow, SectionTitle } from '../../components/dash'
import FleetQuickNav from './FleetQuickNav'
import FleetAssetDetail from './FleetAssetDetail'

const color = MODULE_COLORS.fleet

// Accent hexes for KPI chips (literal hexes so the accent+'18' tint pattern works)
const ACCENT = {
  green:  '#2E7D32',
  blue:   '#0277BD',
  orange: '#E65100',
  red:    '#E53935',
  amber:  '#D97706',
  teal:   '#00897B',
}

/* ── Section = DashCard + SectionTitle (local convenience) ────────────── */
function Section({ title, sub, action, children, style }) {
  return (
    <DashCard style={style}>
      <SectionTitle title={title} subtitle={sub} action={action} />
      {children}
    </DashCard>
  )
}

function HealthCard({ score, grade, gradeColor, components }) {
  return (
    <Section title="Fleet Health Score" sub="Availability, PM, assignments, compliance" style={{ height: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
        <div style={{ flexShrink: 0, position: 'relative' }}>
          <DonutGauge pct={score} color={gradeColor} size={130} label={`Grade ${grade}`} />
        </div>
        <div style={{ flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {components.map(comp => (
            <ProgressRow
              key={comp.label}
              label={comp.label}
              value={`${comp.value.toFixed(1)}/25`}
              pct={(comp.value / 25) * 100}
              color={gradeColor}
            />
          ))}
        </div>
      </div>
    </Section>
  )
}

function expiryStatus(dateStr) {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(dateStr)
  const diff = Math.ceil((exp - today) / 86400000)
  if (diff < 0) return { level: 'expired', label: 'Expired', color: '#E53935', days: diff }
  if (diff <= 7) return { level: 'critical', label: 'Critical', color: '#D84315', days: diff }
  if (diff <= 30) return { level: 'warning', label: 'Warning', color: '#D97706', days: diff }
  return null
}

export default function FleetDashboard({ setPage }) {
  const {
    assets, assetTypes, assetsByStatus, activeAssignments, expiringCompliance,
    workOrders, inspections, trips, loading,
  } = useFleet()

  const { currentSiteId } = useSite()
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState(null)
  const [detailAsset, setDetailAsset] = useState(null)
  const [overConsumers, setOverConsumers] = useState([])
  const OVER_PCT_THRESHOLD = 20  // configurable later via fleet_settings

  const openWorkOrders = useMemo(() =>
    workOrders.filter(w => w.status === 'open' || w.status === 'in_progress'),
    [workOrders]
  )

  // Top over-consuming vehicles this month — computed from fuel_transactions
  // odometer readings vs the vehicle's expected_consumption_lpkm. Same math
  // as the Vehicle Consumption page but only surfaces the worst offenders.
  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
      const { data: txns } = await supabase
        .from('fuel_transactions')
        .select('fleet_asset_id, litres, odometer_km, transaction_date, fleet_asset:fleet_assets(fleet_number, registration, asset_number, expected_consumption_lpkm)')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
        .eq('transaction_type', 'issuance')
        .gte('transaction_date', monthStart)
        .not('odometer_km', 'is', null)
        .order('transaction_date', { ascending: true })

      const map = {}
      for (const t of txns || []) {
        const key = t.fleet_asset_id
        if (!key || !t.fleet_asset?.expected_consumption_lpkm) continue
        if (!map[key]) map[key] = {
          id: key,
          label: t.fleet_asset.registration || t.fleet_asset.fleet_number || t.fleet_asset.asset_number,
          expected: Number(t.fleet_asset.expected_consumption_lpkm) * 100,   // L/100km
          litres: 0, firstOdo: null, lastOdo: null,
        }
        const r = map[key]
        r.litres += Number(t.litres)
        const odo = Number(t.odometer_km)
        if (r.firstOdo == null) r.firstOdo = odo
        r.lastOdo = odo
      }
      const results = Object.values(map)
        .map(r => {
          const km = r.lastOdo != null && r.firstOdo != null && r.lastOdo > r.firstOdo ? r.lastOdo - r.firstOdo : 0
          const actual = km > 0 ? (r.litres / km) * 100 : null
          const overPct = actual && r.expected ? ((actual - r.expected) / r.expected) * 100 : null
          return { ...r, km, actual, overPct }
        })
        .filter(r => r.overPct != null && r.overPct > OVER_PCT_THRESHOLD)
        .sort((a, b) => b.overPct - a.overPct)
        .slice(0, 5)
      if (!cancelled) setOverConsumers(results)
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId])

  const recentInspections = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const c = cutoff.toISOString().slice(0, 10)
    return inspections.filter(i => i.inspection_date && i.inspection_date >= c)
  }, [inspections])

  const healthData = useMemo(() => {
    const total = assets.length || 1
    const operational = assetsByStatus.operational || 0
    const overdueWo = workOrders.filter(w => (w.status === 'open' || w.status === 'in_progress') && w.priority === 'critical').length
    const assigned = activeAssignments.length
    const expiring = expiringCompliance.length

    const availability = 25 * operational / total
    const pmCompliance = Math.max(0, 25 * (1 - overdueWo / total))
    const assignmentScore = 25 * Math.min(assigned, total) / total
    const complianceScore = Math.max(0, 25 * (1 - expiring / total))

    const score = Math.round(availability + pmCompliance + assignmentScore + complianceScore)
    let grade, gradeColor
    if (score >= 85) { grade = 'A'; gradeColor = '#2E7D32' }
    else if (score >= 70) { grade = 'B'; gradeColor = '#0277BD' }
    else if (score >= 55) { grade = 'C'; gradeColor = '#E65100' }
    else { grade = 'D'; gradeColor = '#E53935' }

    return {
      score, grade, gradeColor,
      components: [
        { label: 'Availability', value: availability },
        { label: 'PM Compliance', value: pmCompliance },
        { label: 'Assignments', value: assignmentScore },
        { label: 'Compliance', value: complianceScore },
      ],
    }
  }, [assets, assetsByStatus, workOrders, activeAssignments, expiringCompliance])

  const complianceAlerts = useMemo(() => {
    const alerts = []
    const fields = [
      { key: 'licence_expiry', label: 'Licence' },
      { key: 'insurance_expiry', label: 'Insurance' },
      { key: 'roadworthy_expiry', label: 'Roadworthy' },
    ]
    assets.forEach(a => {
      fields.forEach(f => {
        const status = expiryStatus(a[f.key])
        if (status) {
          alerts.push({
            asset_number: a.asset_number,
            description: a.description,
            docType: f.label,
            expiry: a[f.key],
            ...status,
          })
        }
      })
    })
    alerts.sort((a, b) => a.days - b.days)
    return alerts
  }, [assets])

  const sortedWorkOrders = useMemo(() => {
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
    return openWorkOrders.slice().sort((a, b) =>
      (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
    )
  }, [openWorkOrders])

  const recentTrips = useMemo(() => trips.slice(0, 10), [trips])

  const filteredAssets = useMemo(() => {
    if (!statusFilter) return null
    return assets.filter(a => a.status === statusFilter)
  }, [assets, statusFilter])

  const statuses = [
    { key: 'operational', label: 'Operational', color: '#2E7D32' },
    { key: 'maintenance', label: 'Maintenance', color: '#E65100' },
    { key: 'grounded', label: 'Grounded', color: '#E53935' },
    { key: 'awaiting_parts', label: 'Awaiting Parts', color: '#D97706' },
    { key: 'decommissioned', label: 'Decommissioned', color: '#78909C' },
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <Icon name="progress_activity" size={32} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  const totalAssets = assets.length
  const operationalCount = assetsByStatus.operational || 0
  const availability = totalAssets ? Math.round((operationalCount / totalAssets) * 100) : 0
  const criticalWo = sortedWorkOrders.filter(w => w.priority === 'critical').length

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_dashboard" />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard
          icon="inventory_2" label="Total Fleet" value={totalAssets}
          sub={`${assetTypes.length} asset types`} accent={color}
          progress={100} onClick={() => setPage('fleet_assets')}
        />
        <KpiCard
          icon="check_circle" label="Operational" value={operationalCount}
          sub={`${availability}% availability`} accent={ACCENT.green}
          progress={availability} onClick={() => setPage('fleet_assets')}
        />
        <KpiCard
          icon="build" label="In Maintenance" value={assetsByStatus.maintenance || 0}
          sub="Active service" accent={ACCENT.orange}
          progress={totalAssets ? ((assetsByStatus.maintenance || 0) / totalAssets) * 100 : 0}
          onClick={() => setPage('fleet_maintenance')}
        />
        <KpiCard
          icon="block" label="Grounded" value={assetsByStatus.grounded || 0}
          sub="Out of service" accent={ACCENT.red}
          progress={totalAssets ? ((assetsByStatus.grounded || 0) / totalAssets) * 100 : 0}
          onClick={() => setPage('fleet_assets')}
        />
        <KpiCard
          icon="assignment_ind" label="Active Assignments" value={activeAssignments.length}
          sub="Currently assigned" accent={ACCENT.teal}
          progress={totalAssets ? Math.min(100, (activeAssignments.length / totalAssets) * 100) : 0}
          onClick={() => setPage('fleet_assignments')}
        />
        <KpiCard
          icon="engineering" label="Open Work Orders" value={openWorkOrders.length}
          sub={`${criticalWo} critical`} accent={ACCENT.blue}
          progress={openWorkOrders.length ? (criticalWo / openWorkOrders.length) * 100 : 0}
          onClick={() => setPage('fleet_maintenance')}
        />
        <KpiCard
          icon="warning" label="Expiring Compliance" value={expiringCompliance.length}
          sub="Within 30 days" accent={expiringCompliance.length > 0 ? ACCENT.amber : color}
          progress={totalAssets ? Math.min(100, (expiringCompliance.length / totalAssets) * 100) : 0}
          onClick={() => setPage('fleet_compliance')}
        />
        <KpiCard
          icon="checklist" label="Inspections (30d)" value={recentInspections.length}
          sub="Last 30 days" accent={color}
          progress={inspections.length ? (recentInspections.length / inspections.length) * 100 : 0}
          onClick={() => setPage('fleet_inspections')}
        />
      </div>

      {/* Fuel efficiency alert — top vehicles consuming above expected this month */}
      {overConsumers.length > 0 && (
        <DashCard style={{ marginBottom: '16px' }}>
          <SectionTitle
            title={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  width: '28px', height: '28px', borderRadius: '50%', background: '#C6282818',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name="trending_up" size={16} style={{ color: '#C62828' }} />
                </span>
                Top Over-Consuming Vehicles This Month
              </span>
            }
            subtitle={`Consuming more than ${OVER_PCT_THRESHOLD}% above their expected L/100km`}
            action={
              <button onClick={() => navigate('/fuel/fuel_vehicle_consumption')}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '12px', fontWeight: 500, color: '#C62828', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' }}>
                View all <Icon name="chevron_right" size={14} style={{ color: '#C62828' }} />
              </button>
            }
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            {overConsumers.map(v => (
              <div key={v.id} style={{ background: '#C6282808', borderRadius: '12px', padding: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.text, marginBottom: '4px' }}>
                  {v.label}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#C62828', fontVariantNumeric: 'tabular-nums' }}>
                  +{Math.round(v.overPct)}%
                </div>
                <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '3px' }}>
                  {v.actual?.toFixed(1)} vs {v.expected.toFixed(1)} L/100km · {v.km.toLocaleString()} km
                </div>
              </div>
            ))}
          </div>
        </DashCard>
      )}

      {/* Availability gauge + health + status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(280px, 1.6fr)', gap: '16px', marginBottom: '16px' }}>
        <Section title="Fleet Availability" sub="Operational vs total fleet" style={{ height: '100%', boxSizing: 'border-box' }}>
          <DonutGauge
            pct={totalAssets ? (operationalCount / totalAssets) * 100 : null}
            color={ACCENT.green}
            label={`${operationalCount} of ${totalAssets}`}
            legend={[[ACCENT.green, 'Operational'], [THEME.surfaceVar, 'Other']]}
          />
        </Section>
        <HealthCard {...healthData} />
      </div>

      <Section
        title="Fleet Status" sub="Tap a status to list its assets"
        style={{ marginBottom: '16px' }}
      >
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          {statuses.map(s => {
            const count = assetsByStatus[s.key] || 0
            const active = statusFilter === s.key
            return (
              <div key={s.key} onClick={() => setStatusFilter(active ? null : s.key)} style={{
                flex: '1 1 100px', minWidth: '90px', padding: '14px 12px', borderRadius: '12px',
                borderLeft: `4px solid ${s.color}`, cursor: 'pointer',
                background: active ? s.color + '18' : THEME.surfaceVar,
                transition: 'background .15s',
              }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed, marginTop: '4px' }}>{s.label}</div>
              </div>
            )
          })}
        </div>
        {filteredAssets && (
          <div style={{ marginTop: '14px', maxHeight: '160px', overflowY: 'auto' }}>
            {filteredAssets.length === 0 ? (
              <div style={{ fontSize: '12px', color: THEME.textLow, padding: '8px' }}>No assets with this status</div>
            ) : filteredAssets.map((a, i) => (
              <div key={a.id} onClick={() => setDetailAsset(a)} style={{ cursor: 'pointer' }}>
                <ActivityRow
                  icon="directions_car" iconColor={statuses.find(s => s.key === statusFilter)?.color || color}
                  title={a.asset_number} sub={a.description}
                  isLast={i === filteredAssets.length - 1}
                />
              </div>
            ))}
          </div>
        )}
      </Section>

      {complianceAlerts.length > 0 && (
        <Section title="Compliance Alerts" sub="Documents expired or expiring soon" style={{ marginBottom: '16px' }}>
          <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
            {complianceAlerts.map((a, i) => (
              <ActivityRow
                key={i}
                icon="warning" iconColor={a.color}
                title={`${a.asset_number} — ${a.description || ''}`}
                sub={`${a.docType} · expires ${a.expiry}`}
                right={a.days < 0 ? `${Math.abs(a.days)}d overdue` : `${a.days}d left`}
                rightColor={a.color}
                isLast={i === complianceAlerts.length - 1}
              />
            ))}
          </div>
        </Section>
      )}

      {sortedWorkOrders.length > 0 && (
        <Section title="Maintenance Alerts" sub="Open and in-progress work orders" style={{ marginBottom: '16px' }}>
          {sortedWorkOrders.slice(0, 8).map((wo, i, arr) => {
            const pColors = { critical: '#E53935', high: '#E65100', medium: '#D97706', low: '#0277BD' }
            const pc = pColors[wo.priority] || THEME.textMed
            return (
              <ActivityRow
                key={wo.id}
                icon="build" iconColor={pc}
                title={`${wo.fleet_assets?.asset_number || 'Unknown'} — ${wo.fleet_assets?.description || ''}`}
                sub={`${wo.fault_description || wo.description || 'No description'} · ${wo.status}${wo.created_at ? ` · ${new Date(wo.created_at).toLocaleDateString()}` : ''}`}
                right={(wo.priority || 'medium').toUpperCase()}
                rightColor={pc}
                isLast={i === Math.min(arr.length, 8) - 1}
              />
            )
          })}
        </Section>
      )}

      {recentTrips.length > 0 && (
        <Section title="Recent Activity" sub="Latest trip logs" style={{ marginBottom: '16px' }}>
          {recentTrips.map((t, i) => {
            const dist = (t.end_km && t.start_km) ? `${(t.end_km - t.start_km).toFixed(0)} km` : '—'
            return (
              <ActivityRow
                key={t.id || i}
                icon="route" iconColor={color}
                title={t.fleet_assets?.asset_number || '—'}
                sub={`${t.trip_date || ''} · ${t.employees?.name || '—'}${t.purpose ? ` · ${t.purpose}` : ''}`}
                right={dist}
                isLast={i === recentTrips.length - 1}
              />
            )
          })}
        </Section>
      )}

      <Section title="Quick Actions" sub="Jump to a fleet module">
        {[
          { page: 'fleet_vehicles', icon: 'directions_car', label: 'Vehicles', desc: 'Vehicle registry with compliance tracking' },
          { page: 'fleet_equipment', icon: 'construction', label: 'Heavy Equipment', desc: 'Excavators, loaders, graders, drills and more' },
          { page: 'fleet_generators', icon: 'bolt', label: 'Generators', desc: 'Generator registry with run hours tracking' },
          { page: 'fleet_assets', icon: 'inventory_2', label: 'All Assets', desc: 'Unified view of all fleet assets' },
          { page: 'fleet_assignments', icon: 'assignment_ind', label: 'Assignments', desc: 'Assign assets to operators and projects' },
          { page: 'fleet_inspections', icon: 'checklist', label: 'Inspections', desc: 'Pre-trip and periodic inspection checklists' },
          { page: 'fleet_trips', icon: 'route', label: 'Trip Logs', desc: 'Mileage, operating hours and trip tracking' },
          { page: 'fleet_maintenance', icon: 'build', label: 'Maintenance', desc: 'Work orders, service schedules and history' },
          { page: 'fleet_compliance', icon: 'verified_user', label: 'Compliance', desc: 'Licence, insurance and COF expiry tracking' },
          { page: 'fleet_reports', icon: 'bar_chart', label: 'Reports', desc: 'Fleet analytics and reporting' },
        ].map((item, i, arr) => (
          <div key={item.page} onClick={() => setPage(item.page)} style={{ cursor: 'pointer' }}>
            <ActivityRow
              icon={item.icon} iconColor={color}
              title={item.label} sub={item.desc}
              right={<Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} />}
              isLast={i === arr.length - 1}
            />
          </div>
        ))}
      </Section>

      {detailAsset && <FleetAssetDetail asset={detailAsset} onClose={() => setDetailAsset(null)} />}
    </div>
  )
}
