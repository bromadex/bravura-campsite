import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { Card, Icon, PageHeader, Button, showToast, fmtDate } from '../../components/ui'
import { DashCard, KpiCard, AreaChart, DonutGauge, ActivityRow, SectionTitle, ProgressRow } from '../../components/dash'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const CLR = {
  green:  '#2E7D32',
  blue:   '#1565C0',
  amber:  '#F59E0B',
  red:    '#D32F2F',
  purple: '#6A1B9A',
  orange: '#E65100',
}

const severityColor = s => {
  switch (s) {
    case 'critical':  return CLR.red
    case 'major':     return CLR.orange
    case 'moderate':  return CLR.amber
    case 'minor':     return CLR.green
    default:          return THEME.textLow
  }
}

const severityIcon = s => {
  switch (s) {
    case 'critical':  return 'error'
    case 'major':     return 'warning'
    case 'moderate':  return 'info'
    case 'minor':     return 'check_circle'
    default:          return 'circle'
  }
}

const statusColor = s => {
  switch (s) {
    case 'reported':              return CLR.amber
    case 'under_investigation':   return CLR.blue
    case 'root_cause_identified': return CLR.purple
    case 'corrective_action':     return CLR.orange
    case 'verification':          return '#00838F'
    case 'closed':                return CLR.green
    default:                      return THEME.textLow
  }
}

export default function SheqDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('sheq_incidents', { column: 'site_id', value: currentSiteId })

  const [loading, setLoading] = useState(true)
  const [incidents, setIncidents] = useState([])
  const [hazards, setHazards] = useState([])
  const [capas, setCapas] = useState([])
  const [observations, setObservations] = useState([])
  const [recentIncidents, setRecentIncidents] = useState([])
  const [fleetSummary, setFleetSummary] = useState([])
  const [contractorScores, setContractorScores] = useState([])
  const [costData, setCostData] = useState({ totalEstimated: 0, totalActual: 0, byCategory: [] })

  useEffect(() => {
    if (currentSiteId && can('sheq.view')) fetchAll()
  }, [currentSiteId, rt])

  async function fetchAll() {
    setLoading(true)
    try {
      const [incRes, hazRes, capaRes, obsRes, recentRes, fleetRes, contrRes] = await Promise.all([
        supabase
          .from('sheq_incidents')
          .select('id, incident_number, incident_date, incident_type, severity, status, description, created_at, estimated_cost, actual_cost, cost_category, days_lost, fleet_asset_id')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('sheq_hazard_reports')
          .select('id, status, category, priority, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('sheq_capa')
          .select('id, status, priority, due_date, action_type, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('sheq_observations')
          .select('id, observation_type, observation_date, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('sheq_incidents')
          .select('id, incident_number, incident_date, incident_type, severity, status, description, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('incident_date', { ascending: false })
          .limit(10),
        supabase
          .from('sheq_fleet_incident_summary')
          .select('*')
          .eq('site_id', currentSiteId),
        supabase
          .from('sheq_contractor_scores')
          .select('*')
          .eq('site_id', currentSiteId),
      ])

      if (incRes.error) throw incRes.error
      if (hazRes.error) throw hazRes.error
      if (capaRes.error) throw capaRes.error
      if (obsRes.error) throw obsRes.error
      if (recentRes.error) throw recentRes.error

      setIncidents(incRes.data || [])
      setHazards(hazRes.data || [])
      setCapas(capaRes.data || [])
      setObservations(obsRes.data || [])
      setRecentIncidents(recentRes.data || [])
      setFleetSummary(fleetRes.data || [])
      setContractorScores(contrRes.data || [])

      // Compute cost data from incidents
      const allInc = incRes.data || []
      const totalEstimated = allInc.reduce((s, i) => s + (Number(i.estimated_cost) || 0), 0)
      const totalActual = allInc.reduce((s, i) => s + (Number(i.actual_cost) || 0), 0)
      const totalDaysLost = allInc.reduce((s, i) => s + (Number(i.days_lost) || 0), 0)
      const catMap = {}
      allInc.forEach(i => {
        if (i.cost_category) {
          if (!catMap[i.cost_category]) catMap[i.cost_category] = { estimated: 0, actual: 0, count: 0 }
          catMap[i.cost_category].estimated += Number(i.estimated_cost) || 0
          catMap[i.cost_category].actual += Number(i.actual_cost) || 0
          catMap[i.cost_category].count++
        }
      })
      const byCategory = Object.entries(catMap).map(([k, v]) => ({ category: k, ...v })).sort((a, b) => b.actual - a.actual)
      setCostData({ totalEstimated, totalActual, totalDaysLost, byCategory })
    } catch (err) {
      console.error('SheqDashboard fetch failed:', err)
      showToast('Failed to load SHEQ dashboard', 'red')
    }
    setLoading(false)
  }

  // KPI computations
  const kpis = useMemo(() => {
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const openIncidents = incidents.filter(i => i.status !== 'closed').length

    const nearMisses = incidents.filter(i =>
      i.incident_type === 'near_miss' &&
      (i.incident_date || '').slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    ).length

    const openCapas = capas.filter(c => c.status !== 'closed').length

    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const overdueCapas = capas.filter(c =>
      c.status !== 'closed' && c.due_date && c.due_date < todayIso
    ).length

    // Days without LTI: find most recent lost_time_injury incident
    const ltiIncidents = incidents
      .filter(i => i.incident_type === 'lost_time_injury')
      .sort((a, b) => (b.incident_date || '').localeCompare(a.incident_date || ''))
    let daysWithoutLti = null
    if (ltiIncidents.length > 0 && ltiIncidents[0].incident_date) {
      const lastLti = new Date(ltiIncidents[0].incident_date)
      daysWithoutLti = Math.floor((now - lastLti) / (1000 * 60 * 60 * 24))
    }

    const monthObservations = observations.filter(o =>
      (o.observation_date || '').slice(0, 7) === `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    ).length

    return { openIncidents, nearMisses, openCapas, overdueCapas, daysWithoutLti, monthObservations }
  }, [incidents, capas, observations])

  // Severity distribution for donut
  const severityBreakdown = useMemo(() => {
    const counts = {}
    incidents.forEach(i => {
      const s = i.severity || 'unknown'
      counts[s] = (counts[s] || 0) + 1
    })
    return counts
  }, [incidents])

  const severityTotal = Object.values(severityBreakdown).reduce((a, b) => a + b, 0)
  const criticalPct = severityTotal > 0
    ? (((severityBreakdown.critical || 0) + (severityBreakdown.major || 0)) / severityTotal) * 100
    : null

  // Monthly incident trend (last 6 months)
  const incidentSeries = useMemo(() => {
    const now = new Date()
    const points = []
    const labels = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const count = incidents.filter(inc =>
        (inc.incident_date || '').slice(0, 7) === monthKey
      ).length
      points.push(count)
      labels.push(d.toLocaleDateString(undefined, { month: 'short' }))
    }
    return { points, labels }
  }, [incidents])

  // CAPA status breakdown
  const capaBreakdown = useMemo(() => {
    const counts = { open: 0, in_progress: 0, verification: 0, closed: 0, overdue: 0 }
    capas.forEach(c => {
      const s = c.status || 'open'
      if (counts[s] !== undefined) counts[s]++
      else counts.open++
    })
    return counts
  }, [capas])

  const capaTotal = Object.values(capaBreakdown).reduce((a, b) => a + b, 0)

  if (!can('sheq.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view the SHEQ dashboard.
        </div>
      </Card>
    )
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="SHEQ Dashboard"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {can('sheq.create') && (
              <>
                <Button variant="outlined" icon="warning" onClick={() => setPage('sq_incidents')}>Report Incident</Button>
                <Button variant="outlined" icon="report_problem" onClick={() => setPage('sq_hazards')}>Report Hazard</Button>
                <Button icon="visibility" onClick={() => setPage('sq_observations')} style={{ background: ACCENT, border: `1px solid ${ACCENT}` }}>
                  Log Observation
                </Button>
              </>
            )}
          </div>
        }
      />

      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_dashboard" />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard
          label="Open Incidents"
          value={loading ? '...' : kpis.openIncidents}
          sub="active incidents"
          icon="warning"
          accent={kpis.openIncidents > 0 ? CLR.red : CLR.green}
          progress={incidents.length > 0 ? (kpis.openIncidents / incidents.length) * 100 : 0}
          onClick={() => setPage('sq_incidents')}
        />
        <KpiCard
          label="Near Misses"
          value={loading ? '...' : kpis.nearMisses}
          sub="this month"
          icon="report_problem"
          accent={CLR.amber}
          progress={kpis.nearMisses > 0 ? Math.min(kpis.nearMisses * 10, 100) : 0}
          onClick={() => setPage('sq_incidents')}
        />
        <KpiCard
          label="Open CAPAs"
          value={loading ? '...' : kpis.openCapas}
          sub="pending actions"
          icon="task_alt"
          accent={CLR.blue}
          progress={capaTotal > 0 ? (kpis.openCapas / capaTotal) * 100 : 0}
          onClick={() => setPage('sq_capa')}
        />
        <KpiCard
          label="Overdue CAPAs"
          value={loading ? '...' : kpis.overdueCapas}
          sub="past due date"
          icon="schedule"
          accent={kpis.overdueCapas > 0 ? CLR.red : CLR.green}
          progress={kpis.openCapas > 0 ? (kpis.overdueCapas / kpis.openCapas) * 100 : 0}
          onClick={() => setPage('sq_capa')}
        />
        <KpiCard
          label="Days Without LTI"
          value={loading ? '...' : kpis.daysWithoutLti !== null ? kpis.daysWithoutLti : 'N/A'}
          sub={kpis.daysWithoutLti !== null ? 'since last LTI' : 'no LTI recorded'}
          icon="verified_user"
          accent={kpis.daysWithoutLti !== null && kpis.daysWithoutLti >= 30 ? CLR.green : CLR.amber}
          progress={kpis.daysWithoutLti !== null ? Math.min(kpis.daysWithoutLti / 365 * 100, 100) : 100}
        />
        <KpiCard
          label="Observations"
          value={loading ? '...' : kpis.monthObservations}
          sub="this month"
          icon="visibility"
          accent={CLR.green}
          progress={kpis.monthObservations > 0 ? Math.min(kpis.monthObservations * 5, 100) : 0}
          onClick={() => setPage('sq_observations')}
        />
      </div>

      {/* Incident trend + Severity donut */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(220px, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Incident Trend" subtitle="Incidents per month -- last 6 months" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px', padding: '20px 0' }}>Loading...</div>
          ) : (
            <AreaChart points={incidentSeries.points} labels={incidentSeries.labels} color={ACCENT} />
          )}
        </DashCard>
        <DashCard>
          <SectionTitle title="Severity Distribution" subtitle="All incidents by severity" />
          <DonutGauge
            pct={criticalPct}
            color={CLR.red}
            label="critical + major"
            legend={[
              [CLR.red,    `Critical ${severityBreakdown.critical || 0}`],
              [CLR.orange, `Major ${severityBreakdown.major || 0}`],
              [CLR.amber,  `Moderate ${severityBreakdown.moderate || 0}`],
              [CLR.green,  `Minor ${severityBreakdown.minor || 0}`],
            ]}
          />
        </DashCard>
      </div>

      {/* CAPA status breakdown */}
      <div style={{ marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="CAPA Status Breakdown" subtitle="Corrective & Preventive Actions" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[
              { key: 'open', label: 'Open', color: CLR.amber },
              { key: 'in_progress', label: 'In Progress', color: CLR.blue },
              { key: 'verification', label: 'Verification', color: CLR.purple },
              { key: 'overdue', label: 'Overdue', color: CLR.red },
              { key: 'closed', label: 'Closed', color: CLR.green },
            ].map(row => (
              <ProgressRow
                key={row.key}
                label={row.label}
                value={capaBreakdown[row.key] || 0}
                pct={capaTotal > 0 ? ((capaBreakdown[row.key] || 0) / capaTotal) * 100 : 0}
                color={row.color}
              />
            ))}
          </div>
        </DashCard>
      </div>

      {/* Cost Impact + Recent Incidents side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: '16px', marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Cost Impact" subtitle="Financial impact of incidents" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                {[
                  { label: 'Estimated', value: `$${costData.totalEstimated.toLocaleString()}`, color: CLR.amber },
                  { label: 'Actual', value: `$${costData.totalActual.toLocaleString()}`, color: CLR.red },
                  { label: 'Days Lost', value: costData.totalDaysLost || 0, color: CLR.purple },
                ].map(c => (
                  <div key={c.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: c.color }}>{c.value}</div>
                    <div style={{ fontSize: '11px', color: THEME.textLow }}>{c.label}</div>
                  </div>
                ))}
              </div>
              {costData.byCategory.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '2px' }}>By Category</div>
                  {costData.byCategory.map(c => (
                    <div key={c.category} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px', padding: '4px 0', borderBottom: `1px solid ${THEME.border}` }}>
                      <span style={{ color: THEME.text }}>{(c.category || '').replaceAll('_', ' ')}</span>
                      <span style={{ color: THEME.textMed, fontWeight: 600 }}>${c.actual.toLocaleString()} ({c.count})</span>
                    </div>
                  ))}
                </div>
              )}
              {costData.byCategory.length === 0 && (
                <div style={{ textAlign: 'center', color: THEME.textLow, fontSize: '12px', padding: '10px 0' }}>No cost data recorded yet</div>
              )}
            </div>
          )}
        </DashCard>

        <DashCard>
          <SectionTitle title="Recent Incidents" subtitle="Last 10 reported incidents" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading...</div>
          ) : recentIncidents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.textLow, fontSize: '13px' }}>
              No incidents recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recentIncidents.map((inc, i) => (
                <ActivityRow
                  key={inc.id}
                  icon={severityIcon(inc.severity)}
                  iconColor={severityColor(inc.severity)}
                  title={inc.incident_number || `INC-${inc.id.slice(0, 8)}`}
                  sub={`${(inc.incident_type || 'unknown').replaceAll('_', ' ')} -- ${(inc.severity || 'unknown')} -- ${(inc.status || 'unknown').replaceAll('_', ' ')}`}
                  right={fmtDate((inc.incident_date || '').slice(0, 10))}
                  rightColor={statusColor(inc.status)}
                  isLast={i === recentIncidents.length - 1}
                />
              ))}
            </div>
          )}
        </DashCard>
      </div>

      {/* Cross-Module: Fleet Incidents + Contractor Scores */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Fleet Incident Summary" subtitle="Incidents involving fleet assets" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading...</div>
          ) : fleetSummary.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: THEME.textLow, fontSize: '12px' }}>No fleet-related incidents</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {fleetSummary.slice(0, 8).map((f, i) => (
                <div key={f.asset_id || i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 0', borderBottom: i < fleetSummary.length - 1 ? `1px solid ${THEME.border}` : 'none',
                }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{f.asset_number || 'Unknown'}</div>
                    <div style={{ fontSize: '11px', color: THEME.textLow }}>{f.description || ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: CLR.red }}>{f.incident_count}</div>
                    <div style={{ fontSize: '10px', color: THEME.textLow }}>
                      ${(Number(f.total_actual_cost) || 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DashCard>

        <DashCard>
          <SectionTitle title="Contractor SHEQ Scores" subtitle="Compliance scores by contractor" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading...</div>
          ) : contractorScores.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: THEME.textLow, fontSize: '12px' }}>No contractor compliance data</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {contractorScores.slice(0, 8).map((c, i) => {
                const score = Number(c.compliance_score) || 0
                const scoreColor = score >= 80 ? CLR.green : score >= 60 ? CLR.amber : CLR.red
                return (
                  <div key={c.contractor_id || i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 0', borderBottom: i < contractorScores.length - 1 ? `1px solid ${THEME.border}` : 'none',
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{c.company_name || 'Unknown'}</div>
                      <div style={{ fontSize: '11px', color: THEME.textLow }}>
                        {c.total_incidents || 0} incidents · {c.open_findings || 0} open findings
                      </div>
                    </div>
                    <div style={{
                      fontSize: '14px', fontWeight: 700, color: scoreColor,
                      background: `${scoreColor}18`, borderRadius: '8px', padding: '3px 10px',
                    }}>
                      {score.toFixed(0)}%
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </DashCard>
      </div>
    </div>
  )
}
