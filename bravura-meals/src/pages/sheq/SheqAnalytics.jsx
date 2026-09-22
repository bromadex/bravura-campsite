import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const CLR = {
  green:  '#2E7D32',
  amber:  '#F59E0B',
  red:    '#D32F2F',
  blue:   '#1565C0',
  orange: '#E65100',
  purple: '#6A1B9A',
}

const TABS = [
  { key: 'overview',    label: 'Overview',              icon: 'dashboard' },
  { key: 'fleet',       label: 'Fleet Integration',     icon: 'local_shipping' },
  { key: 'hr',          label: 'HR Integration',        icon: 'people' },
  { key: 'contractor',  label: 'Contractor Compliance', icon: 'engineering' },
  { key: 'projects',    label: 'Project Risks',         icon: 'account_tree' },
]

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}

function fmt(n) {
  if (n == null) return '--'
  return typeof n === 'number' ? n.toLocaleString() : String(n)
}

function fmtCurrency(n) {
  if (n == null) return '--'
  return '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(n) {
  if (n == null) return '--'
  return Number(n).toFixed(1) + '%'
}

function pctColor(pct) {
  if (pct == null) return THEME.textMed
  if (pct >= 90) return CLR.green
  if (pct >= 70) return CLR.amber
  return CLR.red
}

function KpiTile({ label, value, icon, color, sub }) {
  return (
    <div style={{
      flex: '1 1 160px', minWidth: '160px', background: THEME.surface,
      borderRadius: '12px', padding: '16px 18px',
      boxShadow: THEME.shadow1, display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Icon name={icon} size={20} style={{ color: color || ACCENT }} />
        <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em' }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: '26px', fontWeight: 700, color: color || THEME.text, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow }}>{sub}</div>}
    </div>
  )
}

function DataTable({ columns, rows, emptyMsg }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
        {emptyMsg || 'No data available'}
      </div>
    )
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{
                textAlign: c.align || 'left', padding: '10px 12px',
                borderBottom: `2px solid ${THEME.outline}`, fontSize: '11px',
                fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase',
                letterSpacing: '.04em', whiteSpace: 'nowrap',
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : THEME.surfaceVar }}>
              {columns.map(c => (
                <td key={c.key} style={{
                  padding: '9px 12px', borderBottom: `1px solid ${THEME.outlineVar}`,
                  textAlign: c.align || 'left', whiteSpace: 'nowrap',
                  color: c.colorFn ? c.colorFn(row) : THEME.text,
                  fontWeight: c.bold ? 600 : 400,
                }}>
                  {c.render ? c.render(row) : (row[c.key] ?? '--')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function SheqAnalytics({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)

  // Overview data
  const [incidents, setIncidents] = useState([])
  const [capas, setCapas] = useState([])
  const [permits, setPermits] = useState([])
  const [training, setTraining] = useState([])

  // Fleet integration
  const [fleetIncidents, setFleetIncidents] = useState([])

  // HR integration
  const [hrSummary, setHrSummary] = useState([])

  // Contractor compliance
  const [contractorScores, setContractorScores] = useState([])

  // Project risks
  const [projectRisks, setProjectRisks] = useState([])

  useEffect(() => {
    if (currentSiteId && can('sheq.view')) fetchData()
  }, [currentSiteId, tab])

  async function fetchData() {
    setLoading(true)
    try {
      if (tab === 'overview') await fetchOverview()
      else if (tab === 'fleet') await fetchFleet()
      else if (tab === 'hr') await fetchHr()
      else if (tab === 'contractor') await fetchContractor()
      else if (tab === 'projects') await fetchProjects()
    } catch (err) {
      console.error('SheqAnalytics fetch error:', err)
      showToast('Failed to load analytics data', 'red')
    }
    setLoading(false)
  }

  async function fetchOverview() {
    const [incRes, capaRes, permitRes, trainRes] = await Promise.all([
      supabase.from('sheq_incidents')
        .select('id, status, severity, actual_cost, days_lost, incident_date')
        .eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('sheq_capa')
        .select('id, status, due_date')
        .eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('sheq_permits')
        .select('id, status')
        .eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('sheq_training_matrix')
        .select('id, status')
        .eq('site_id', currentSiteId).eq('is_archived', false),
    ])
    if (incRes.error) throw incRes.error
    if (capaRes.error) throw capaRes.error
    if (permitRes.error) throw permitRes.error
    if (trainRes.error) throw trainRes.error
    setIncidents(incRes.data || [])
    setCapas(capaRes.data || [])
    setPermits(permitRes.data || [])
    setTraining(trainRes.data || [])
  }

  async function fetchFleet() {
    const { data, error } = await supabase.from('sheq_incidents')
      .select('id, severity, actual_cost, days_lost, fleet_asset_id, fleet_asset:fleet_assets(id, asset_number, description)')
      .eq('site_id', currentSiteId).eq('is_archived', false)
      .not('fleet_asset_id', 'is', null)
    if (error) throw error
    setFleetIncidents(data || [])
  }

  async function fetchHr() {
    const { data, error } = await supabase.from('sheq_employee_summary')
      .select('*')
      .eq('site_id', currentSiteId)
    if (error) throw error
    setHrSummary(data || [])
  }

  async function fetchContractor() {
    const { data, error } = await supabase.from('sheq_contractor_scores')
      .select('*')
      .eq('site_id', currentSiteId)
    if (error) throw error
    setContractorScores(data || [])
  }

  async function fetchProjects() {
    const { data, error } = await supabase.from('sheq_project_risk_summary')
      .select('*')
      .eq('site_id', currentSiteId)
    if (error) throw error
    setProjectRisks(data || [])
  }

  // ── Overview KPI computations ──
  const kpis = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)

    const totalIncidents = incidents.length
    const incidentsThisMonth = incidents.filter(i => i.incident_date >= monthStart).length
    const openIncidents = incidents.filter(i => i.status !== 'closed').length

    const totalCapas = capas.length
    const today = now.toISOString().slice(0, 10)
    const overdueCapas = capas.filter(c => c.status !== 'closed' && c.due_date && c.due_date < today).length

    const activePermits = permits.filter(p => p.status === 'active').length

    const totalTraining = training.length
    const validTraining = training.filter(t => t.status === 'valid' || t.status === 'current').length
    const trainingPct = totalTraining > 0 ? (validTraining / totalTraining) * 100 : 0

    const totalCost = incidents.reduce((s, i) => s + (Number(i.actual_cost) || 0), 0)
    const totalDaysLost = incidents.reduce((s, i) => s + (Number(i.days_lost) || 0), 0)

    return {
      totalIncidents, incidentsThisMonth, openIncidents,
      totalCapas, overdueCapas, activePermits,
      trainingPct, totalTraining, validTraining,
      totalCost, totalDaysLost,
    }
  }, [incidents, capas, permits, training])

  // ── Fleet grouped data ──
  const fleetRows = useMemo(() => {
    const map = {}
    for (const inc of fleetIncidents) {
      const aid = inc.fleet_asset_id
      if (!map[aid]) {
        const asset = inc.fleet_asset || {}
        map[aid] = {
          asset_number: asset.asset_number || '--',
          description: asset.description || '--',
          count: 0,
          critical: 0, major: 0, moderate: 0, minor: 0,
          cost: 0, days_lost: 0,
        }
      }
      map[aid].count++
      const sev = inc.severity || 'minor'
      if (map[aid][sev] !== undefined) map[aid][sev]++
      map[aid].cost += Number(inc.actual_cost) || 0
      map[aid].days_lost += Number(inc.days_lost) || 0
    }
    return Object.values(map).sort((a, b) => b.count - a.count)
  }, [fleetIncidents])

  // ── Permission gate ──
  if (!can('sheq.view')) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <Icon name="lock" size={48} style={{ color: THEME.textLow, marginBottom: '12px' }} />
        <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>Access Denied</div>
        <div style={{ fontSize: '13px', color: THEME.textMed }}>You do not have permission to view SHEQ Analytics.</div>
      </div>
    )
  }

  // ── Export helpers ──
  function exportOverview() {
    exportCsv('sheq_overview_kpis.csv',
      ['Metric', 'Value'],
      [
        ['Total Incidents', kpis.totalIncidents],
        ['Incidents This Month', kpis.incidentsThisMonth],
        ['Open Incidents', kpis.openIncidents],
        ['Total CAPAs', kpis.totalCapas],
        ['Overdue CAPAs', kpis.overdueCapas],
        ['Active Permits', kpis.activePermits],
        ['Training Compliance %', kpis.trainingPct.toFixed(1)],
        ['Total Incident Cost', kpis.totalCost.toFixed(2)],
        ['Days Lost', kpis.totalDaysLost],
      ],
    )
  }

  function exportFleet() {
    exportCsv('sheq_fleet_integration.csv',
      ['Asset Number', 'Description', 'Incidents', 'Critical', 'Major', 'Moderate', 'Minor', 'Total Cost', 'Days Lost'],
      fleetRows.map(r => [r.asset_number, r.description, r.count, r.critical, r.major, r.moderate, r.minor, r.cost.toFixed(2), r.days_lost]),
    )
  }

  function exportHr() {
    exportCsv('sheq_hr_integration.csv',
      ['Employee', 'Position', 'Training Count', 'Expired Training', 'Medical Status', 'Risk Rating'],
      hrSummary.map(r => [r.employee_name, r.position, r.training_count, r.expired_training, r.medical_status, r.risk_rating]),
    )
  }

  function exportContractors() {
    exportCsv('sheq_contractor_compliance.csv',
      ['Contractor', 'Assessments', 'Compliant', 'Non-Compliant', 'Compliance %', 'Avg Score'],
      contractorScores.map(r => [r.contractor_name, r.assessments, r.compliant, r.non_compliant, r.compliance_pct != null ? Number(r.compliance_pct).toFixed(1) : '', r.avg_score != null ? Number(r.avg_score).toFixed(1) : '']),
    )
  }

  function exportProjects() {
    exportCsv('sheq_project_risks.csv',
      ['Project', 'Total Risks', 'High Risks', 'Open Risks', 'Incidents', 'Cost'],
      projectRisks.map(r => [r.project_name, r.total_risks, r.high_risks, r.open_risks, r.incidents, r.cost != null ? Number(r.cost).toFixed(2) : '']),
    )
  }

  // ── Tab content renderers ──
  function renderOverview() {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button size="sm" variant="ghost" onClick={exportOverview}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px' }}>
          <KpiTile label="Total Incidents" value={fmt(kpis.totalIncidents)} icon="report_problem" color={CLR.red} />
          <KpiTile label="This Month" value={fmt(kpis.incidentsThisMonth)} icon="calendar_month" color={CLR.orange} />
          <KpiTile label="Open Incidents" value={fmt(kpis.openIncidents)} icon="pending" color={CLR.amber} />
          <KpiTile label="Total CAPAs" value={fmt(kpis.totalCapas)} icon="task_alt" color={CLR.blue} />
          <KpiTile label="Overdue CAPAs" value={fmt(kpis.overdueCapas)} icon="event_busy" color={kpis.overdueCapas > 0 ? CLR.red : CLR.green} />
          <KpiTile label="Active Permits" value={fmt(kpis.activePermits)} icon="badge" color={CLR.purple} />
          <KpiTile label="Training Compliance" value={fmtPct(kpis.trainingPct)} icon="school" color={pctColor(kpis.trainingPct)} sub={`${kpis.validTraining} / ${kpis.totalTraining} valid`} />
          <KpiTile label="Total Incident Cost" value={fmtCurrency(kpis.totalCost)} icon="attach_money" color={CLR.red} />
          <KpiTile label="Days Lost" value={fmt(kpis.totalDaysLost)} icon="event_busy" color={CLR.orange} />
        </div>
      </div>
    )
  }

  function renderFleet() {
    const columns = [
      { key: 'asset_number', label: 'Asset Number', bold: true },
      { key: 'description', label: 'Description' },
      { key: 'count', label: 'Incidents', align: 'center' },
      { key: 'critical', label: 'Critical', align: 'center', colorFn: r => r.critical > 0 ? CLR.red : THEME.textLow },
      { key: 'major', label: 'Major', align: 'center', colorFn: r => r.major > 0 ? CLR.orange : THEME.textLow },
      { key: 'moderate', label: 'Moderate', align: 'center', colorFn: r => r.moderate > 0 ? CLR.amber : THEME.textLow },
      { key: 'minor', label: 'Minor', align: 'center', colorFn: r => r.minor > 0 ? CLR.green : THEME.textLow },
      { key: 'cost', label: 'Total Cost', align: 'right', render: r => fmtCurrency(r.cost) },
      { key: 'days_lost', label: 'Days Lost', align: 'center' },
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>
            {fleetRows.length} fleet asset{fleetRows.length !== 1 ? 's' : ''} with SHEQ incidents
          </div>
          <Button size="sm" variant="ghost" onClick={exportFleet}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        </div>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <DataTable columns={columns} rows={fleetRows} emptyMsg="No fleet-related incidents found" />
        </Card>
      </div>
    )
  }

  function renderHr() {
    const columns = [
      { key: 'employee_name', label: 'Employee', bold: true },
      { key: 'position', label: 'Position' },
      { key: 'training_count', label: 'Training Count', align: 'center' },
      {
        key: 'expired_training', label: 'Expired Training', align: 'center',
        colorFn: r => (r.expired_training || 0) > 0 ? CLR.red : CLR.green,
      },
      { key: 'medical_status', label: 'Medical Status', render: r => {
        const s = r.medical_status || '--'
        const color = s === 'fit' ? CLR.green : s === 'unfit' ? CLR.red : CLR.amber
        return <span style={{ color, fontWeight: 600, textTransform: 'capitalize' }}>{s}</span>
      }},
      { key: 'risk_rating', label: 'Risk Rating', render: r => {
        const rating = r.risk_rating || '--'
        const color = rating === 'high' ? CLR.red : rating === 'medium' ? CLR.amber : CLR.green
        return <span style={{ color, fontWeight: 600, textTransform: 'capitalize' }}>{rating}</span>
      }},
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>
            {hrSummary.length} employee{hrSummary.length !== 1 ? 's' : ''} with SHEQ profiles
          </div>
          <Button size="sm" variant="ghost" onClick={exportHr}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        </div>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <DataTable columns={columns} rows={hrSummary} emptyMsg="No employee SHEQ profiles found" />
        </Card>
      </div>
    )
  }

  function renderContractor() {
    const columns = [
      { key: 'contractor_name', label: 'Contractor', bold: true },
      { key: 'assessments', label: 'Assessments', align: 'center' },
      { key: 'compliant', label: 'Compliant', align: 'center', colorFn: () => CLR.green },
      { key: 'non_compliant', label: 'Non-Compliant', align: 'center', colorFn: r => (r.non_compliant || 0) > 0 ? CLR.red : THEME.textLow },
      {
        key: 'compliance_pct', label: 'Compliance %', align: 'center',
        render: r => <span style={{ color: pctColor(r.compliance_pct), fontWeight: 600 }}>{fmtPct(r.compliance_pct)}</span>,
      },
      {
        key: 'avg_score', label: 'Avg Score', align: 'center',
        render: r => r.avg_score != null ? Number(r.avg_score).toFixed(1) : '--',
      },
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>
            {contractorScores.length} contractor{contractorScores.length !== 1 ? 's' : ''} assessed
          </div>
          <Button size="sm" variant="ghost" onClick={exportContractors}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        </div>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <DataTable columns={columns} rows={contractorScores} emptyMsg="No contractor compliance scores found" />
        </Card>
      </div>
    )
  }

  function renderProjects() {
    const columns = [
      { key: 'project_name', label: 'Project', bold: true },
      { key: 'total_risks', label: 'Total Risks', align: 'center' },
      { key: 'high_risks', label: 'High Risks', align: 'center', colorFn: r => (r.high_risks || 0) > 0 ? CLR.red : THEME.textLow },
      { key: 'open_risks', label: 'Open Risks', align: 'center', colorFn: r => (r.open_risks || 0) > 0 ? CLR.amber : CLR.green },
      { key: 'incidents', label: 'Incidents', align: 'center' },
      { key: 'cost', label: 'Cost', align: 'right', render: r => fmtCurrency(r.cost) },
    ]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>
            {projectRisks.length} project{projectRisks.length !== 1 ? 's' : ''} with risk data
          </div>
          <Button size="sm" variant="ghost" onClick={exportProjects}>
            <Icon name="download" size={14} /> Export CSV
          </Button>
        </div>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <DataTable columns={columns} rows={projectRisks} emptyMsg="No project risk data found" />
        </Card>
      </div>
    )
  }

  const tabRenderers = { overview: renderOverview, fleet: renderFleet, hr: renderHr, contractor: renderContractor, projects: renderProjects }

  return (
    <div style={{ padding: '0 0 32px' }}>
      <QuickNav pills={SHEQ_PILLS} />
      <PageHeader
        title="SHEQ Analytics"
        subtitle="Cross-module integration dashboard"
        icon="analytics"
        accentColor={ACCENT}
      />

      {/* Tab pills */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '0 0 18px',
      }}>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '7px 16px', borderRadius: '20px', fontSize: '13px',
              fontWeight: active ? 700 : 500, fontFamily: 'inherit',
              border: active ? `2px solid ${ACCENT}` : `1px solid ${THEME.outline}`,
              background: active ? ACCENT : THEME.surface,
              color: active ? '#fff' : THEME.text,
              cursor: 'pointer', transition: 'all .15s',
            }}>
              <Icon name={t.icon} size={15} style={{ color: active ? '#fff' : THEME.textMed }} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Loading */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textMed, fontSize: '13px' }}>
          <Icon name="hourglass_empty" size={28} style={{ color: THEME.textLow, marginBottom: '8px', display: 'block', margin: '0 auto 8px' }} />
          Loading analytics...
        </div>
      ) : (
        tabRenderers[tab]()
      )}
    </div>
  )
}
