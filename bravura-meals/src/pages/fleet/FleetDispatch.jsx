import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../hooks/usePermissions'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { useFleet } from '../../contexts/FleetContext'
import FleetQuickNav from './FleetQuickNav'

const color = MODULE_COLORS.fleet

const STATUS_COLORS = {
  operational: '#2E7D32',
  on_trip: '#1565C0',
  maintenance: '#F9A825',
  grounded: '#C62828',
}

const STATUS_ORDER = ['on_trip', 'operational', 'maintenance', 'grounded']

function formatTime(dateStr) {
  if (!dateStr) return '--'
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function elapsedSince(dateStr) {
  if (!dateStr) return '--'
  const ms = Date.now() - new Date(dateStr).getTime()
  if (ms < 0) return '0m'
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function StatusDot({ status, size = 10 }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: STATUS_COLORS[status] || THEME.textLow, flexShrink: 0,
    }} />
  )
}

function SectionLabel({ children, style }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 600, color: THEME.textLow,
      letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px',
      ...style,
    }}>{children}</div>
  )
}

export default function FleetDispatch({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const {
    assets, employees, assignments, activeAssignments, trips,
    inspections, workOrders, compliance, expiringCompliance,
    loading, fetchAll,
  } = useFleet()

  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [selectedAsset, setSelectedAsset] = useState(null)
  const [showDispatchModal, setShowDispatchModal] = useState(false)

  // Auto-refresh every 60s
  const doRefresh = useCallback(() => {
    fetchAll()
    setLastRefresh(new Date())
  }, [fetchAll])

  useEffect(() => {
    const id = setInterval(doRefresh, 60000)
    return () => clearInterval(id)
  }, [doRefresh])

  // Today's date string
  const today = new Date().toISOString().slice(0, 10)

  // Active trips today (no end time)
  const activeTrips = useMemo(() =>
    trips.filter(t => t.trip_date === today && !t.end_time),
    [trips, today]
  )

  // Assets on active trips
  const assetsOnTrip = useMemo(() =>
    new Set(activeTrips.map(t => t.asset_id)),
    [activeTrips]
  )

  // Active assignment map: asset_id -> assignment
  const assignmentMap = useMemo(() => {
    const m = {}
    activeAssignments.forEach(a => { m[a.asset_id] = a })
    return m
  }, [activeAssignments])

  // Latest inspection per asset
  const latestInspection = useMemo(() => {
    const m = {}
    inspections.forEach(i => {
      if (!m[i.asset_id]) m[i.asset_id] = i
    })
    return m
  }, [inspections])

  // Trip map: asset_id -> active trip
  const tripMap = useMemo(() => {
    const m = {}
    activeTrips.forEach(t => { m[t.asset_id] = t })
    return m
  }, [activeTrips])

  // Status counts
  const statusCounts = useMemo(() => {
    const c = { operational: 0, on_trip: 0, maintenance: 0, grounded: 0 }
    assets.forEach(a => {
      if (assetsOnTrip.has(a.id)) c.on_trip++
      else if (c[a.status] !== undefined) c[a.status]++
      else c.operational++
    })
    return c
  }, [assets, assetsOnTrip])

  // Sorted assets
  const sortedAssets = useMemo(() => {
    return [...assets].sort((a, b) => {
      const aStatus = assetsOnTrip.has(a.id) ? 'on_trip' : a.status
      const bStatus = assetsOnTrip.has(b.id) ? 'on_trip' : b.status
      const ai = STATUS_ORDER.indexOf(aStatus)
      const bi = STATUS_ORDER.indexOf(bStatus)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  }, [assets, assetsOnTrip])

  // Alerts
  const alerts = useMemo(() => {
    const list = []
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoff7 = sevenDaysAgo.toISOString().slice(0, 10)

    assets.forEach(a => {
      const insp = latestInspection[a.id]
      if (!insp || (insp.inspection_date && insp.inspection_date < cutoff7)) {
        list.push({ type: 'inspection', asset: a, message: `${a.asset_number} — overdue inspection` })
      }
    })

    const in14 = new Date()
    in14.setDate(in14.getDate() + 14)
    const cutoff14 = in14.toISOString().slice(0, 10)
    ;(compliance || []).forEach(c => {
      if (c.expiry_date && c.expiry_date <= cutoff14 && c.status !== 'expired') {
        list.push({ type: 'compliance', asset: c.fleet_assets, message: `${c.fleet_assets?.asset_number || '?'} — ${c.document_type || 'compliance'} expiring ${c.expiry_date}` })
      }
    })

    workOrders.filter(w => w.status === 'open').forEach(w => {
      list.push({ type: 'service', asset: w.fleet_assets, message: `${w.fleet_assets?.asset_number || '?'} — open work order: ${w.title || w.description || 'service due'}` })
    })

    return list
  }, [assets, latestInspection, compliance, workOrders])

  if (loading) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: THEME.textMed }}>
        <FleetQuickNav setPage={setPage} current="fleet_dispatch" />
        Loading dispatch board...
      </div>
    )
  }

  return (
    <div style={{ padding: '0 0 40px' }}>
      <FleetQuickNav setPage={setPage} current="fleet_dispatch" />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: THEME.text }}>
            <span className="material-symbols-rounded" style={{ fontSize: '24px', verticalAlign: 'middle', marginRight: '8px', color }}>hub</span>
            Fleet Dispatch
          </h2>
          <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '4px' }}>
            Last refreshed: {lastRefresh.toLocaleTimeString()}
            <button onClick={doRefresh} style={{
              marginLeft: '10px', background: 'none', border: `1px solid ${THEME.outlineVar}`,
              borderRadius: '6px', padding: '2px 10px', fontSize: '11px', color: THEME.textMed,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '3px' }}>refresh</span>
              Refresh
            </button>
          </div>
        </div>
        {can('create_fleet_trips') && (
          <button onClick={() => setShowDispatchModal(true)} style={{
            background: color, color: '#fff', border: 'none', borderRadius: '10px',
            padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>send</span>
            Quick Dispatch
          </button>
        )}
      </div>

      {/* Status Summary Strip */}
      <div style={{
        display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px',
        background: THEME.surface, borderRadius: '12px', padding: '14px 20px',
        border: `1px solid ${THEME.outlineVar}`,
      }}>
        {[
          { key: 'operational', label: 'Operational' },
          { key: 'on_trip', label: 'On Trip' },
          { key: 'maintenance', label: 'Maintenance' },
          { key: 'grounded', label: 'Grounded' },
        ].map(s => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '120px' }}>
            <StatusDot status={s.key} size={12} />
            <span style={{ fontSize: '13px', color: THEME.textMed, fontWeight: 500 }}>{s.label}</span>
            <span style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{statusCounts[s.key] || 0}</span>
          </div>
        ))}
      </div>

      {/* Main layout: grid + sidebar */}
      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* Asset Grid */}
        <div style={{ flex: '1 1 600px', minWidth: 0 }}>
          <SectionLabel>Asset Grid ({sortedAssets.length})</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
            {sortedAssets.map(asset => {
              const effectiveStatus = assetsOnTrip.has(asset.id) ? 'on_trip' : asset.status
              const asgn = assignmentMap[asset.id]
              const trip = tripMap[asset.id]
              const insp = latestInspection[asset.id]
              const isSelected = selectedAsset === asset.id

              return (
                <div key={asset.id} onClick={() => setSelectedAsset(isSelected ? null : asset.id)} style={{
                  background: THEME.surface, borderRadius: '12px', padding: '14px',
                  border: `1.5px solid ${isSelected ? color : THEME.outlineVar}`,
                  cursor: 'pointer', transition: 'border-color .15s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <StatusDot status={effectiveStatus} />
                    <span style={{ fontSize: '14px', fontWeight: 700, color: THEME.text }}>{asset.asset_number}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {asset.description || '--'}
                  </div>
                  {asgn && (
                    <div style={{ fontSize: '11px', color: THEME.textLow }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '3px' }}>person</span>
                      {asgn.employees?.name || 'Assigned'}
                    </div>
                  )}
                  {trip && (
                    <div style={{ fontSize: '11px', color: STATUS_COLORS.on_trip, marginTop: '2px' }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '3px' }}>route</span>
                      {trip.destination || 'On trip'} — {elapsedSince(trip.start_time || trip.created_at)}
                    </div>
                  )}
                  {insp && (
                    <div style={{
                      display: 'inline-block', marginTop: '6px', fontSize: '10px', fontWeight: 600,
                      padding: '2px 8px', borderRadius: '999px',
                      background: insp.result === 'pass' ? '#2E7D3218' : insp.result === 'fail' ? '#C6282818' : '#F9A82518',
                      color: insp.result === 'pass' ? '#2E7D32' : insp.result === 'fail' ? '#C62828' : '#F9A825',
                    }}>
                      {insp.result || 'inspected'}
                    </div>
                  )}

                  {/* Quick actions */}
                  {isSelected && (
                    <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                      {!trip && effectiveStatus === 'operational' && can('create_fleet_trips') && (
                        <ActionBtn icon="play_arrow" label="Start Trip" onClick={(e) => { e.stopPropagation(); setShowDispatchModal(true) }} />
                      )}
                      {trip && can('create_fleet_trips') && (
                        <ActionBtn icon="stop" label="End Trip" onClick={async (e) => {
                          e.stopPropagation()
                          await supabase.from('fleet_trips').update({ end_time: new Date().toISOString() }).eq('id', trip.id).eq('site_id', currentSiteId)
                          doRefresh()
                        }} />
                      )}
                      {can('create_fleet_work_orders') && (
                        <ActionBtn icon="report" label="Report Issue" onClick={(e) => { e.stopPropagation(); setPage('fleet_maintenance') }} />
                      )}
                      {can('create_fleet_meter_readings') && (
                        <ActionBtn icon="speed" label="Log Meter" onClick={(e) => { e.stopPropagation(); setPage('fleet_meter_readings') }} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ flex: '0 0 320px', minWidth: '280px' }}>
          {/* Active Trips Panel */}
          <SectionLabel>Active Trips ({activeTrips.length})</SectionLabel>
          <div style={{
            background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`,
            marginBottom: '20px', maxHeight: '360px', overflowY: 'auto',
          }}>
            {activeTrips.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No active trips</div>
            ) : activeTrips.map(t => (
              <div key={t.id} style={{ padding: '12px 14px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: THEME.text }}>{t.fleet_assets?.asset_number || '?'}</span>
                  <span style={{ fontSize: '11px', color: STATUS_COLORS.on_trip, fontWeight: 600 }}>{elapsedSince(t.start_time || t.created_at)}</span>
                </div>
                <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: '3px' }}>person</span>
                  {t.employees?.name || '--'}
                </div>
                <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
                  {t.departure || '--'} → {t.destination || '--'} | Start: {t.start_km || '--'} km
                </div>
              </div>
            ))}
          </div>

          {/* Alerts */}
          <SectionLabel>Alerts ({alerts.length})</SectionLabel>
          <div style={{
            background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`,
            maxHeight: '300px', overflowY: 'auto',
          }}>
            {alerts.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No alerts</div>
            ) : alerts.slice(0, 20).map((a, i) => (
              <div key={i} style={{ padding: '10px 14px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="material-symbols-rounded" style={{
                  fontSize: '16px',
                  color: a.type === 'inspection' ? '#F9A825' : a.type === 'compliance' ? '#C62828' : '#1565C0',
                }}>
                  {a.type === 'inspection' ? 'schedule' : a.type === 'compliance' ? 'gpp_bad' : 'build'}
                </span>
                <span style={{ fontSize: '12px', color: THEME.textMed }}>{a.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Dispatch Modal */}
      {showDispatchModal && (
        <DispatchModal
          assets={assets}
          employees={employees}
          activeAssignments={activeAssignments}
          assetsOnTrip={assetsOnTrip}
          currentSiteId={currentSiteId}
          onClose={() => setShowDispatchModal(false)}
          onDone={() => { setShowDispatchModal(false); doRefresh() }}
        />
      )}
    </div>
  )
}

function ActionBtn({ icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: THEME.surfaceVar, border: 'none', borderRadius: '6px',
      padding: '4px 8px', fontSize: '11px', color: THEME.textMed,
      cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '3px',
    }}>
      <span className="material-symbols-rounded" style={{ fontSize: '13px' }}>{icon}</span>
      {label}
    </button>
  )
}

function DispatchModal({ assets, employees, activeAssignments, assetsOnTrip, currentSiteId, onClose, onDone }) {
  const [assetId, setAssetId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [destination, setDestination] = useState('')
  const [purpose, setPurpose] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Only operational + unassigned assets
  const assignedIds = new Set(activeAssignments.map(a => a.asset_id))
  const availableAssets = assets.filter(a =>
    a.status === 'operational' && !assignedIds.has(a.id) && !assetsOnTrip.has(a.id)
  )

  const handleSubmit = async () => {
    if (!assetId || !driverId || !destination) {
      setError('Asset, driver, and destination are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const now = new Date().toISOString()
      const todayStr = now.slice(0, 10)

      // Create temporary assignment
      await supabase.from('fleet_assignments').insert([{
        site_id: currentSiteId,
        asset_id: assetId,
        employee_id: driverId,
        assignment_type: 'temporary',
        status: 'active',
        assigned_date: todayStr,
      }])

      // Create trip
      await supabase.from('fleet_trips').insert([{
        site_id: currentSiteId,
        asset_id: assetId,
        employee_id: driverId,
        trip_date: todayStr,
        start_time: now,
        destination,
        purpose,
      }])

      onDone()
    } catch (err) {
      setError(err.message || 'Failed to dispatch')
    } finally {
      setSaving(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '8px', fontSize: '14px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.bg, color: THEME.text,
    fontFamily: 'inherit', boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: THEME.surface, borderRadius: '16px', padding: '28px', width: '100%',
        maxWidth: '440px', boxShadow: THEME.shadow3,
      }}>
        <h3 style={{ margin: '0 0 20px', fontSize: '18px', fontWeight: 700, color: THEME.text }}>
          <span className="material-symbols-rounded" style={{ fontSize: '20px', verticalAlign: 'middle', marginRight: '8px', color }}>send</span>
          Quick Dispatch
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Asset</label>
            <select value={assetId} onChange={e => setAssetId(e.target.value)} style={inputStyle}>
              <option value="">Select available asset...</option>
              {availableAssets.map(a => (
                <option key={a.id} value={a.id}>{a.asset_number} — {a.description || ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Driver</label>
            <select value={driverId} onChange={e => setDriverId(e.target.value)} style={inputStyle}>
              <option value="">Select driver...</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Destination</label>
            <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="Where to..." style={inputStyle} />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Purpose</label>
            <input value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="Trip purpose..." style={inputStyle} />
          </div>
        </div>

        {error && <div style={{ marginTop: '12px', fontSize: '13px', color: THEME.error }}>{error}</div>}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={onClose} style={{
            background: 'none', border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px',
            padding: '8px 18px', fontSize: '13px', color: THEME.textMed, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={saving} style={{
            background: color, color: '#fff', border: 'none', borderRadius: '8px',
            padding: '8px 20px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Dispatching...' : 'Dispatch'}</button>
        </div>
      </div>
    </div>
  )
}
