import { useMemo, useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import FleetQuickNav from './FleetQuickNav'
import FleetAssetDetail from './FleetAssetDetail'

const color = MODULE_COLORS.fleet

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 600, color: THEME.textLow,
      letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px',
    }}>{children}</div>
  )
}

function KpiTile({ icon, label, value, sub, accent }) {
  const c = accent || color
  return (
    <div style={{
      background: THEME.surface, borderRadius: '14px', padding: '16px',
      border: `1px solid ${THEME.outlineVar}`, flex: '1 1 200px', minWidth: '180px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%',
          background: c + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '18px', color: c }}>{icon}</span>
        </div>
        <div style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: THEME.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '6px' }}>{sub}</div>}
    </div>
  )
}

function HealthDonut({ score, grade, gradeColor, components }) {
  const radius = 48
  const stroke = 10
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div style={{
      background: THEME.surface, borderRadius: '14px', padding: '24px',
      border: `1px solid ${THEME.outlineVar}`, minWidth: '260px',
    }}>
      <SectionLabel>Fleet Health Score</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', width: '120px', height: '120px', flexShrink: 0 }}>
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r={radius} fill="none" stroke={THEME.outlineVar} strokeWidth={stroke} />
            <circle cx="60" cy="60" r={radius} fill="none" stroke={gradeColor} strokeWidth={stroke}
              strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
              transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
          </svg>
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontSize: '28px', fontWeight: 700, color: THEME.text, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: gradeColor, marginTop: '2px' }}>{grade}</div>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: '140px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {components.map(comp => (
            <div key={comp.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: THEME.textMed, marginBottom: '3px' }}>
                <span>{comp.label}</span>
                <span>{comp.value.toFixed(1)} / 25</span>
              </div>
              <div style={{ height: '6px', borderRadius: '3px', background: THEME.outlineVar }}>
                <div style={{
                  height: '100%', borderRadius: '3px', background: gradeColor,
                  width: `${(comp.value / 25) * 100}%`, transition: 'width 0.6s ease',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const availability = assets.length ? Math.round(((assetsByStatus.operational || 0) / assets.length) * 100) : 0

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_dashboard" />

      <SectionLabel>Key Performance Indicators</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
        <KpiTile icon="inventory_2" label="Total Fleet" value={assets.length} sub={`${assetTypes.length} types`} />
        <KpiTile icon="check_circle" label="Operational" value={assetsByStatus.operational || 0} sub={`${availability}% availability`} />
        <KpiTile icon="build" label="In Maintenance" value={assetsByStatus.maintenance || 0} accent="#E65100" sub="Active service" />
        <KpiTile icon="block" label="Grounded" value={assetsByStatus.grounded || 0} accent="#E53935" sub="Out of service" />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
        <KpiTile icon="assignment_ind" label="Active Assignments" value={activeAssignments.length} accent="#2E7D32" sub="Currently assigned" />
        <KpiTile icon="engineering" label="Open Work Orders" value={openWorkOrders.length} accent="#0277BD" sub={`${sortedWorkOrders.filter(w => w.priority === 'critical').length} critical`} />
        <KpiTile icon="warning" label="Expiring Compliance" value={expiringCompliance.length} accent={expiringCompliance.length > 0 ? '#E65100' : color} sub="Within 30 days" />
        <KpiTile icon="checklist" label="Inspections (30d)" value={recentInspections.length} sub="Last 30 days" />
      </div>

      {/* Fuel efficiency alert — top vehicles consuming above expected this month */}
      {overConsumers.length > 0 && (
        <div style={{
          background: THEME.surface, borderRadius: '14px', padding: '20px',
          border: `1px solid #C6282833`, borderLeft: `4px solid #C62828`,
          marginBottom: '20px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '22px', color: '#C62828' }}>trending_up</span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.text }}>
                  Top Over-Consuming Vehicles This Month
                </div>
                <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
                  Consuming more than {OVER_PCT_THRESHOLD}% above their expected L/100km
                </div>
              </div>
            </div>
            <button
              onClick={() => setPage('fuel_vehicle_consumption')}
              style={{
                background: 'transparent', border: `1px solid ${THEME.outlineVar}`,
                borderRadius: '8px', padding: '6px 14px', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600, color: THEME.textMed, fontFamily: 'inherit',
              }}
            >
              View all →
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
            {overConsumers.map(v => (
              <div key={v.id} style={{
                background: '#C6282808', borderRadius: '10px', padding: '12px',
                border: `1px solid #C6282822`,
              }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.text, marginBottom: '4px' }}>
                  {v.label}
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#C62828' }}>
                  +{Math.round(v.overPct)}%
                </div>
                <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '3px' }}>
                  {v.actual?.toFixed(1)} vs {v.expected.toFixed(1)} L/100km · {v.km.toLocaleString()} km
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <HealthDonut {...healthData} />
        </div>
        <div style={{ flex: '1 1 400px' }}>
          <div style={{
            background: THEME.surface, borderRadius: '14px', padding: '24px',
            border: `1px solid ${THEME.outlineVar}`, height: '100%', boxSizing: 'border-box',
          }}>
            <SectionLabel>Fleet Status</SectionLabel>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {statuses.map(s => {
                const count = assetsByStatus[s.key] || 0
                const active = statusFilter === s.key
                return (
                  <div key={s.key} onClick={() => setStatusFilter(active ? null : s.key)} style={{
                    flex: '1 1 100px', minWidth: '90px', padding: '14px 12px', borderRadius: '10px',
                    borderLeft: `4px solid ${s.color}`, cursor: 'pointer',
                    background: active ? s.color + '18' : THEME.surfaceVar,
                    transition: 'background .15s',
                  }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text }}>{count}</div>
                    <div style={{ fontSize: '11px', color: THEME.textMed, marginTop: '4px' }}>{s.label}</div>
                  </div>
                )
              })}
            </div>
            {filteredAssets && (
              <div style={{ marginTop: '14px', maxHeight: '140px', overflowY: 'auto' }}>
                {filteredAssets.length === 0 ? (
                  <div style={{ fontSize: '12px', color: THEME.textLow, padding: '8px' }}>No assets with this status</div>
                ) : filteredAssets.map(a => (
                  <div key={a.id} onClick={() => setDetailAsset(a)} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '6px 8px', fontSize: '12px', borderBottom: `1px solid ${THEME.outlineVar}`,
                    cursor: 'pointer',
                  }}>
                    <span style={{ fontWeight: 600, color: THEME.text }}>{a.asset_number}</span>
                    <span style={{ color: THEME.textMed }}>{a.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {complianceAlerts.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <SectionLabel>Compliance Alerts</SectionLabel>
          <div style={{
            background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 100px 100px 80px',
              padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: THEME.textLow,
              textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${THEME.outlineVar}`,
            }}>
              <div>Asset</div><div>Description</div><div>Document</div><div>Expiry</div><div>Status</div>
            </div>
            <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
              {complianceAlerts.map((a, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 100px 100px 80px',
                  padding: '10px 16px', fontSize: '12px', alignItems: 'center',
                  borderBottom: i < complianceAlerts.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                }}>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{a.asset_number}</div>
                  <div style={{ color: THEME.textMed }}>{a.description}</div>
                  <div style={{ color: THEME.textMed }}>{a.docType}</div>
                  <div style={{ color: THEME.textMed }}>{a.expiry}</div>
                  <div style={{
                    display: 'inline-flex', padding: '2px 8px', borderRadius: '999px',
                    fontSize: '10px', fontWeight: 700, background: a.color + '18', color: a.color,
                  }}>
                    {a.days < 0 ? `${Math.abs(a.days)}d overdue` : `${a.days}d left`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {sortedWorkOrders.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <SectionLabel>Maintenance Alerts</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedWorkOrders.slice(0, 8).map(wo => {
              const pColors = { critical: '#E53935', high: '#E65100', medium: '#D97706', low: '#0277BD' }
              const pc = pColors[wo.priority] || THEME.textMed
              return (
                <div key={wo.id} style={{
                  background: THEME.surface, borderRadius: '10px', padding: '14px 16px',
                  border: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '20px', color: pc }}>build</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>
                      {wo.fleet_assets?.asset_number || 'Unknown'} - {wo.fleet_assets?.description || ''}
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{wo.fault_description || wo.description || 'No description'}</div>
                  </div>
                  <div style={{
                    padding: '2px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700,
                    background: pc + '18', color: pc, textTransform: 'uppercase',
                  }}>{wo.priority || 'medium'}</div>
                  <div style={{
                    padding: '2px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 600,
                    background: THEME.surfaceVar, color: THEME.textMed, textTransform: 'uppercase',
                  }}>{wo.status}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, whiteSpace: 'nowrap' }}>
                    {wo.created_at ? new Date(wo.created_at).toLocaleDateString() : ''}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {recentTrips.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <SectionLabel>Recent Activity</SectionLabel>
          <div style={{
            background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '90px 1fr 1fr 80px 1fr',
              padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: THEME.textLow,
              textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${THEME.outlineVar}`,
            }}>
              <div>Date</div><div>Asset</div><div>Operator</div><div>Distance</div><div>Purpose</div>
            </div>
            {recentTrips.map((t, i) => {
              const dist = (t.end_km && t.start_km) ? `${(t.end_km - t.start_km).toFixed(0)} km` : '-'
              return (
                <div key={t.id || i} style={{
                  display: 'grid', gridTemplateColumns: '90px 1fr 1fr 80px 1fr',
                  padding: '10px 16px', fontSize: '12px', alignItems: 'center',
                  borderBottom: i < recentTrips.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                }}>
                  <div style={{ color: THEME.textMed }}>{t.trip_date || ''}</div>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{t.fleet_assets?.asset_number || '-'}</div>
                  <div style={{ color: THEME.textMed }}>{t.employees?.name || '-'}</div>
                  <div style={{ color: THEME.textMed }}>{dist}</div>
                  <div style={{ color: THEME.textMed }}>{t.purpose || '-'}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <SectionLabel>Quick Actions</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
        ].map(item => (
          <div key={item.page} onClick={() => setPage(item.page)} style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            background: THEME.surface, borderRadius: '14px', padding: '14px 20px',
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer',
            transition: 'box-shadow .15s',
          }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
          >
            <div style={{
              width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
              background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>{item.icon}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text }}>{item.label}</div>
              <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{item.desc}</div>
            </div>
            <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.textLow }}>chevron_right</span>
          </div>
        ))}
      </div>

      {detailAsset && <FleetAssetDetail asset={detailAsset} onClose={() => setDetailAsset(null)} />}
    </div>
  )
}
