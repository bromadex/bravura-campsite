import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Icon, PageHeader, Button, showToast, fmtDate, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
import { DashCard, KpiCard, AreaChart, SectionTitle, ProgressRow } from '../../components/dash'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const CLR = {
  green:  '#2E7D32',
  blue:   '#1565C0',
  amber:  '#F59E0B',
  red:    '#D32F2F',
  purple: '#6A1B9A',
  orange: '#E65100',
  teal:   '#00838F',
}

const DEFAULT_MAN_HOURS = 200000

function monthsBetween(from, to) {
  const months = []
  const d = new Date(from.getFullYear(), from.getMonth(), 1)
  while (d <= to) {
    months.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
    })
    d.setMonth(d.getMonth() + 1)
  }
  return months
}

export default function SheqReports({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const now = new Date()
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [dateTo, setDateTo] = useState(() => {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })

  const [loading, setLoading] = useState(true)
  const [incidents, setIncidents] = useState([])
  const [hazards, setHazards] = useState([])
  const [capas, setCapas] = useState([])
  const [observations, setObservations] = useState([])
  const [manHoursMonthly, setManHoursMonthly] = useState(DEFAULT_MAN_HOURS)

  useEffect(() => {
    if (currentSiteId && can('sheq.view')) fetchAll()
  }, [currentSiteId, dateFrom, dateTo])

  async function fetchAll() {
    setLoading(true)
    try {
      const [incRes, hazRes, capaRes, obsRes, settingsRes] = await Promise.all([
        supabase
          .from('sheq_incidents')
          .select('id, incident_number, incident_date, incident_type, severity, status, description, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .gte('incident_date', dateFrom)
          .lte('incident_date', dateTo),
        supabase
          .from('sheq_hazard_reports')
          .select('id, report_date, category, status, priority, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .gte('report_date', dateFrom)
          .lte('report_date', dateTo),
        supabase
          .from('sheq_capa')
          .select('id, capa_number, status, priority, action_type, due_date, completed_date, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .gte('created_at', dateFrom),
        supabase
          .from('sheq_observations')
          .select('id, observation_date, observation_type, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .gte('observation_date', dateFrom)
          .lte('observation_date', dateTo),
        supabase
          .from('sheq_settings')
          .select('key, value')
          .eq('site_id', currentSiteId)
          .eq('key', 'man_hours_monthly')
          .maybeSingle(),
      ])

      if (incRes.error) throw incRes.error
      if (hazRes.error) throw hazRes.error
      if (capaRes.error) throw capaRes.error
      if (obsRes.error) throw obsRes.error

      setIncidents(incRes.data || [])
      setHazards(hazRes.data || [])
      setCapas(capaRes.data || [])
      setObservations(obsRes.data || [])

      if (settingsRes.data?.value) {
        const parsed = parseFloat(settingsRes.data.value)
        if (!isNaN(parsed) && parsed > 0) setManHoursMonthly(parsed)
      }
    } catch (err) {
      console.error('SheqReports fetch failed:', err)
      showToast('Failed to load SHEQ reports', 'red')
    }
    setLoading(false)
  }

  const months = useMemo(() => monthsBetween(new Date(dateFrom), new Date(dateTo)), [dateFrom, dateTo])
  const totalMonths = months.length || 1
  const totalManHours = manHoursMonthly * totalMonths

  // KPI calculations
  const kpis = useMemo(() => {
    const recordableTypes = ['lost_time_injury', 'medical_treatment', 'restricted_work', 'fatality']
    const recordable = incidents.filter(i => recordableTypes.includes(i.incident_type)).length
    const lti = incidents.filter(i => i.incident_type === 'lost_time_injury').length
    const nearMisses = incidents.filter(i => i.incident_type === 'near_miss').length
    const totalIncidents = incidents.filter(i => i.incident_type !== 'near_miss').length

    const trir = totalManHours > 0 ? (recordable * 200000) / totalManHours : 0
    const ltifr = totalManHours > 0 ? (lti * 1000000) / totalManHours : 0
    const nearMissRatio = totalIncidents > 0 ? `${nearMisses}:${totalIncidents}` : 'N/A'

    const closedCapas = capas.filter(c => c.status === 'closed')
    const capaClosureRate = capas.length > 0 ? (closedCapas.length / capas.length) * 100 : 0

    const avgClosureDays = closedCapas.length > 0
      ? closedCapas.reduce((sum, c) => {
          if (c.completed_date && c.created_at) {
            const days = (new Date(c.completed_date) - new Date(c.created_at)) / (1000 * 60 * 60 * 24)
            return sum + Math.max(0, days)
          }
          return sum
        }, 0) / closedCapas.length
      : 0

    return { trir, ltifr, nearMissRatio, capaClosureRate, avgClosureDays, recordable, lti, nearMisses }
  }, [incidents, capas, totalManHours])

  // Incident trend by month, stacked by type
  const incidentTrend = useMemo(() => {
    const types = [...new Set(incidents.map(i => i.incident_type || 'other'))]
    const byMonth = {}
    months.forEach(m => { byMonth[m.key] = {} })
    incidents.forEach(i => {
      const mk = (i.incident_date || '').slice(0, 7)
      if (byMonth[mk]) {
        const t = i.incident_type || 'other'
        byMonth[mk][t] = (byMonth[mk][t] || 0) + 1
      }
    })
    // For AreaChart, sum all types per month
    const points = months.map(m =>
      Object.values(byMonth[m.key] || {}).reduce((a, b) => a + b, 0)
    )
    const labels = months.map(m => m.label)
    return { points, labels, byMonth, types }
  }, [incidents, months])

  // Severity distribution table
  const severityTable = useMemo(() => {
    const counts = {}
    incidents.forEach(i => {
      const s = i.severity || 'unknown'
      counts[s] = (counts[s] || 0) + 1
    })
    return Object.entries(counts)
      .map(([severity, count]) => ({ severity, count, pct: incidents.length > 0 ? (count / incidents.length * 100).toFixed(1) : '0.0' }))
      .sort((a, b) => b.count - a.count)
  }, [incidents])

  // Top incident categories (by type)
  const categoryTable = useMemo(() => {
    const counts = {}
    incidents.forEach(i => {
      const t = (i.incident_type || 'other').replaceAll('_', ' ')
      counts[t] = (counts[t] || 0) + 1
    })
    return Object.entries(counts)
      .map(([category, count]) => ({ category, count, pct: incidents.length > 0 ? (count / incidents.length * 100).toFixed(1) : '0.0' }))
      .sort((a, b) => b.count - a.count)
  }, [incidents])

  // Hazard categories
  const hazardCategories = useMemo(() => {
    const counts = {}
    hazards.forEach(h => {
      const c = h.category || 'uncategorized'
      counts[c] = (counts[c] || 0) + 1
    })
    return Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
  }, [hazards])

  const maxHazardCount = hazardCategories.length > 0 ? hazardCategories[0].count : 1

  // Observation trends
  const observationTrend = useMemo(() => {
    const positive = {}
    const unsafe = {}
    months.forEach(m => { positive[m.key] = 0; unsafe[m.key] = 0 })
    observations.forEach(o => {
      const mk = (o.observation_date || '').slice(0, 7)
      if (o.observation_type === 'positive') {
        if (positive[mk] !== undefined) positive[mk]++
      } else {
        if (unsafe[mk] !== undefined) unsafe[mk]++
      }
    })
    return { positive, unsafe }
  }, [observations, months])

  // CSV export
  function handleExport() {
    const headers = ['Date', 'Incident #', 'Type', 'Severity', 'Status', 'Description']
    const rows = incidents.map(i => [
      i.incident_date || '',
      i.incident_number || '',
      (i.incident_type || '').replaceAll('_', ' '),
      i.severity || '',
      (i.status || '').replaceAll('_', ' '),
      i.description || '',
    ])
    exportCsv(`sheq-incidents-${dateFrom}-to-${dateTo}.csv`, headers, rows)
    showToast('CSV exported', 'green')
  }

  if (!can('sheq.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view SHEQ reports.
        </div>
      </Card>
    )
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="SHEQ Reports"
        site={currentSite}
        actions={
          <Button variant="outlined" icon="download" onClick={handleExport} disabled={loading || incidents.length === 0}>
            Export CSV
          </Button>
        }
      />

      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_reports" />

      {/* Date range filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>From</label>
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{
            padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
            fontSize: '13px', fontFamily: 'inherit', background: THEME.surface, color: THEME.text,
          }}
        />
        <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>To</label>
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{
            padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
            fontSize: '13px', fontFamily: 'inherit', background: THEME.surface, color: THEME.text,
          }}
        />
        <span style={{ fontSize: '11px', color: THEME.textLow }}>
          Man-hours/month: {manHoursMonthly.toLocaleString()}
        </span>
      </div>

      {/* KPI summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard
          label="TRIR"
          value={loading ? '...' : kpis.trir.toFixed(2)}
          sub={`${kpis.recordable} recordable / ${(totalManHours / 1000).toFixed(0)}k hrs`}
          icon="analytics"
          accent={kpis.trir > 5 ? CLR.red : kpis.trir > 2 ? CLR.amber : CLR.green}
          progress={Math.min(kpis.trir * 10, 100)}
        />
        <KpiCard
          label="LTIFR"
          value={loading ? '...' : kpis.ltifr.toFixed(2)}
          sub={`${kpis.lti} LTIs / ${(totalManHours / 1000).toFixed(0)}k hrs`}
          icon="personal_injury"
          accent={kpis.ltifr > 2 ? CLR.red : kpis.ltifr > 0.5 ? CLR.amber : CLR.green}
          progress={Math.min(kpis.ltifr * 20, 100)}
        />
        <KpiCard
          label="Near-miss Ratio"
          value={loading ? '...' : kpis.nearMissRatio}
          sub="near-misses : incidents"
          icon="report_problem"
          accent={CLR.amber}
          progress={50}
        />
        <KpiCard
          label="CAPA Closure Rate"
          value={loading ? '...' : `${kpis.capaClosureRate.toFixed(0)}%`}
          sub={`${capas.filter(c => c.status === 'closed').length} of ${capas.length} closed`}
          icon="task_alt"
          accent={kpis.capaClosureRate >= 80 ? CLR.green : kpis.capaClosureRate >= 50 ? CLR.amber : CLR.red}
          progress={kpis.capaClosureRate}
        />
        <KpiCard
          label="Avg CAPA Closure"
          value={loading ? '...' : kpis.avgClosureDays > 0 ? `${kpis.avgClosureDays.toFixed(0)} days` : 'N/A'}
          sub="average days to close"
          icon="schedule"
          accent={kpis.avgClosureDays > 30 ? CLR.red : kpis.avgClosureDays > 14 ? CLR.amber : CLR.green}
          progress={kpis.avgClosureDays > 0 ? Math.min((30 / kpis.avgClosureDays) * 100, 100) : 0}
        />
      </div>

      {/* Incident trend chart */}
      <div style={{ marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Incident Trend" subtitle={`Incidents by month (${dateFrom} to ${dateTo})`} />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px', padding: '20px 0' }}>Loading...</div>
          ) : (
            <AreaChart points={incidentTrend.points} labels={incidentTrend.labels} color={ACCENT} />
          )}
        </DashCard>
      </div>

      {/* Severity distribution + Top categories side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Severity Distribution" subtitle="Incidents by severity level" />
          {severityTable.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: THEME.textLow, fontSize: '13px' }}>No data</div>
          ) : (
            <TableWrap>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <THead>
                  <tr><Th>Severity</Th><Th align="right">Count</Th><Th align="right">%</Th></tr>
                </THead>
                <tbody>
                  {severityTable.map(row => (
                    <TRow key={row.severity}>
                      <Td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: row.severity === 'critical' ? CLR.red : row.severity === 'major' ? CLR.orange : row.severity === 'moderate' ? CLR.amber : CLR.green, display: 'inline-block' }} />
                          {row.severity}
                        </span>
                      </Td>
                      <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.count}</Td>
                      <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.pct}%</Td>
                    </TRow>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </DashCard>

        <DashCard>
          <SectionTitle title="Top Incident Categories" subtitle="Incidents by type" />
          {categoryTable.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: THEME.textLow, fontSize: '13px' }}>No data</div>
          ) : (
            <TableWrap>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <THead>
                  <tr><Th>Category</Th><Th align="right">Count</Th><Th align="right">%</Th></tr>
                </THead>
                <tbody>
                  {categoryTable.map(row => (
                    <TRow key={row.category}>
                      <Td>{row.category}</Td>
                      <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.count}</Td>
                      <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{row.pct}%</Td>
                    </TRow>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </DashCard>
      </div>

      {/* Hazard categories breakdown */}
      <div style={{ marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Hazard Report Categories" subtitle="Hazards by category" />
          {hazardCategories.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: THEME.textLow, fontSize: '13px' }}>No hazard data</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {hazardCategories.map(h => (
                <ProgressRow
                  key={h.category}
                  label={h.category}
                  value={h.count}
                  pct={maxHazardCount > 0 ? (h.count / maxHazardCount) * 100 : 0}
                  color={CLR.orange}
                />
              ))}
            </div>
          )}
        </DashCard>
      </div>

      {/* Safety observation trends */}
      <div style={{ marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Safety Observation Trends" subtitle="Positive vs unsafe observations by month" />
          {months.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: THEME.textLow, fontSize: '13px' }}>No data</div>
          ) : (
            <TableWrap>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <THead>
                  <tr>
                    <Th>Month</Th>
                    <Th align="right">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: CLR.green, display: 'inline-block' }} />
                        Positive
                      </span>
                    </Th>
                    <Th align="right">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: CLR.red, display: 'inline-block' }} />
                        Unsafe
                      </span>
                    </Th>
                    <Th align="right">Total</Th>
                  </tr>
                </THead>
                <tbody>
                  {months.map(m => {
                    const pos = observationTrend.positive[m.key] || 0
                    const uns = observationTrend.unsafe[m.key] || 0
                    return (
                      <TRow key={m.key}>
                        <Td>{m.label}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: CLR.green, fontWeight: 600 }}>{pos}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: CLR.red, fontWeight: 600 }}>{uns}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{pos + uns}</Td>
                      </TRow>
                    )
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </DashCard>
      </div>
    </div>
  )
}
