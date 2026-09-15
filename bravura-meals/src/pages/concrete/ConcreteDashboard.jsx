import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Icon, PageHeader, Button, showToast, fmtDate } from '../../components/ui'
import { DashCard, KpiCard, AreaChart, DonutGauge, ActivityRow, SectionTitle, ProgressRow } from '../../components/dash'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.concrete || '#EF6C00'

const CLR = {
  green:  '#2E7D32',
  blue:   '#1565C0',
  amber:  '#F59E0B',
  red:    '#D32F2F',
  purple: '#6A1B9A',
}

const statusColor = s => {
  switch (s) {
    case 'mixing':     return CLR.amber
    case 'dispatched': return CLR.blue
    case 'delivered':  return CLR.green
    case 'rejected':   return CLR.red
    default:           return THEME.textLow
  }
}

const statusIcon = s => {
  switch (s) {
    case 'mixing':     return 'hourglass_top'
    case 'dispatched': return 'local_shipping'
    case 'delivered':  return 'check_circle'
    case 'rejected':   return 'cancel'
    default:           return 'circle'
  }
}

export default function ConcreteDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const [loading, setLoading] = useState(true)
  const [batches, setBatches] = useState([])
  const [cementDeliveries, setCementDeliveries] = useState([])
  const [cubeTests, setCubeTests] = useState([])
  const [mixDesigns, setMixDesigns] = useState([])
  const [recentBatches, setRecentBatches] = useState([])

  useEffect(() => {
    if (currentSiteId && can('concrete.view')) fetchAll()
  }, [currentSiteId])

  async function fetchAll() {
    setLoading(true)
    try {
      const [batchRes, cementRes, cubeRes, mixRes, recentRes] = await Promise.all([
        supabase
          .from('concrete_batches')
          .select('id, status, quantity_m3, actual_cement_kg, grade, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('cement_deliveries')
          .select('id, quantity_kg, delivery_date')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('cube_tests')
          .select('id, status, result_28day_mpa, target_strength_mpa')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('mix_designs')
          .select('id, is_active')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false),
        supabase
          .from('concrete_batches')
          .select('id, batch_number, grade, quantity_m3, status, created_at')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('created_at', { ascending: false })
          .limit(10),
      ])

      if (batchRes.error) throw batchRes.error
      if (cementRes.error) throw cementRes.error
      if (cubeRes.error) throw cubeRes.error
      if (mixRes.error) throw mixRes.error
      if (recentRes.error) throw recentRes.error

      setBatches(batchRes.data || [])
      setCementDeliveries(cementRes.data || [])
      setCubeTests(cubeRes.data || [])
      setMixDesigns(mixRes.data || [])
      setRecentBatches(recentRes.data || [])
    } catch (err) {
      console.error('ConcreteDashboard fetch failed:', err)
      showToast('Failed to load concrete dashboard', 'red')
    }
    setLoading(false)
  }

  // KPI computations
  const kpis = useMemo(() => {
    const now = new Date()
    const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    const todayProduction = batches
      .filter(b => (b.created_at || '').slice(0, 10) === todayIso)
      .reduce((sum, b) => sum + (b.quantity_m3 || 0), 0)

    const monthProduction = batches
      .filter(b => (b.created_at || '').slice(0, 10) >= monthStart)
      .reduce((sum, b) => sum + (b.quantity_m3 || 0), 0)

    const activeMixes = mixDesigns.filter(m => m.is_active).length

    const totalCementReceived = cementDeliveries.reduce((s, d) => s + (d.quantity_kg || 0), 0)
    const totalCementUsed = batches.reduce((s, b) => s + (b.actual_cement_kg || 0), 0)
    const cementStock = totalCementReceived - totalCementUsed

    const testedCubes = cubeTests.filter(t => t.status === 'completed' || t.status === 'passed' || t.status === 'failed')
    const passedCubes = testedCubes.filter(t =>
      t.status === 'passed' || (t.result_28day_mpa != null && t.target_strength_mpa != null && t.result_28day_mpa >= t.target_strength_mpa)
    )
    const passRate = testedCubes.length > 0 ? (passedCubes.length / testedCubes.length) * 100 : null

    return { todayProduction, monthProduction, activeMixes, cementStock, passRate, testedCount: testedCubes.length }
  }, [batches, cementDeliveries, cubeTests, mixDesigns])

  // Monthly production trend (last 12 months)
  const productionSeries = useMemo(() => {
    const now = new Date()
    const points = []
    const labels = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const vol = batches
        .filter(b => (b.created_at || '').slice(0, 7) === monthKey)
        .reduce((s, b) => s + (b.quantity_m3 || 0), 0)
      points.push(Math.round(vol * 10) / 10)
      labels.push(d.toLocaleDateString(undefined, { month: 'short' }))
    }
    return { points, labels }
  }, [batches])

  // Batch status breakdown
  const statusBreakdown = useMemo(() => {
    const counts = {}
    batches.forEach(b => {
      const s = b.status || 'unknown'
      counts[s] = (counts[s] || 0) + 1
    })
    return counts
  }, [batches])

  const statusTotal = Object.values(statusBreakdown).reduce((a, b) => a + b, 0)
  const deliveredPct = statusTotal > 0 ? ((statusBreakdown.delivered || 0) / statusTotal) * 100 : null

  // Production by grade
  const gradeBreakdown = useMemo(() => {
    const byGrade = {}
    batches.forEach(b => {
      const g = b.grade || 'Unknown'
      byGrade[g] = (byGrade[g] || 0) + (b.quantity_m3 || 0)
    })
    return Object.entries(byGrade)
      .map(([name, vol]) => ({ name, vol: Math.round(vol * 10) / 10 }))
      .sort((a, b) => b.vol - a.vol)
      .slice(0, 8)
  }, [batches])

  const maxGradeVol = gradeBreakdown.length > 0 ? gradeBreakdown[0].vol : 1

  // Cube test alerts
  const pendingCubes = cubeTests.filter(t => t.status === 'pending' || t.status === 'curing').length
  const recentFailures = cubeTests.filter(t =>
    t.status === 'failed' || (t.result_28day_mpa != null && t.target_strength_mpa != null && t.result_28day_mpa < t.target_strength_mpa)
  ).length

  if (!can('concrete.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view the Concrete dashboard.
        </div>
      </Card>
    )
  }

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="Batch Plant Dashboard"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Button variant="outlined" icon="science" onClick={() => setPage('co_mix_designs')}>Mix Designs</Button>
            {can('concrete.create') && (
              <Button icon="add_circle" onClick={() => setPage('co_batches')} style={{ background: ACCENT, border: `1px solid ${ACCENT}` }}>
                New Batch
              </Button>
            )}
          </div>
        }
      />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard
          label="Today's Production"
          value={loading ? '...' : `${kpis.todayProduction.toFixed(1)} m³`}
          sub="batched today"
          icon="today"
          accent={ACCENT}
          progress={kpis.monthProduction > 0 ? (kpis.todayProduction / kpis.monthProduction) * 100 : 0}
        />
        <KpiCard
          label="This Month"
          value={loading ? '...' : `${kpis.monthProduction.toFixed(1)} m³`}
          sub="total this month"
          icon="calendar_month"
          accent={CLR.blue}
          progress={100}
          onClick={() => setPage('co_batches')}
        />
        <KpiCard
          label="Active Mix Designs"
          value={loading ? '...' : kpis.activeMixes}
          sub={`of ${mixDesigns.length} total`}
          icon="science"
          accent={CLR.purple}
          progress={mixDesigns.length > 0 ? (kpis.activeMixes / mixDesigns.length) * 100 : 0}
          onClick={() => setPage('co_mix_designs')}
        />
        <KpiCard
          label="Cement Stock"
          value={loading ? '...' : `${Math.round(kpis.cementStock).toLocaleString()} kg`}
          sub="received minus used"
          icon="inventory"
          accent={kpis.cementStock < 0 ? CLR.red : CLR.green}
          progress={kpis.cementStock > 0 ? 100 : 0}
          onClick={() => setPage('co_cement')}
        />
        <KpiCard
          label="Cube Test Pass Rate"
          value={loading ? '...' : kpis.passRate !== null ? `${kpis.passRate.toFixed(0)}%` : 'N/A'}
          sub={kpis.testedCount > 0 ? `${kpis.testedCount} tested` : 'no tests yet'}
          icon="verified"
          accent={kpis.passRate !== null && kpis.passRate >= 90 ? CLR.green : kpis.passRate !== null ? CLR.amber : THEME.textLow}
          progress={kpis.passRate ?? 0}
          onClick={() => setPage('co_cube_tests')}
        />
      </div>

      {/* Production trend + Status donut */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(220px, 1fr)', gap: '16px', marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Monthly Production" subtitle="Concrete volume (m³) -- last 12 months" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px', padding: '20px 0' }}>Loading...</div>
          ) : (
            <AreaChart points={productionSeries.points} labels={productionSeries.labels} color={ACCENT} />
          )}
        </DashCard>
        <DashCard>
          <SectionTitle title="Batch Status" subtitle="All-time status breakdown" />
          <DonutGauge
            pct={deliveredPct}
            color={CLR.green}
            label="delivered"
            legend={[
              [CLR.green,  `Delivered ${statusBreakdown.delivered || 0}`],
              [CLR.blue,   `Dispatched ${statusBreakdown.dispatched || 0}`],
              [CLR.amber,  `Mixing ${statusBreakdown.mixing || 0}`],
              [CLR.red,    `Rejected ${statusBreakdown.rejected || 0}`],
            ]}
          />
        </DashCard>
      </div>

      {/* Production by grade */}
      {gradeBreakdown.length > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <DashCard>
            <SectionTitle title="Production by Grade" subtitle="Top grades by volume (m³)" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {gradeBreakdown.map(g => (
                <ProgressRow
                  key={g.name}
                  label={g.name}
                  value={`${g.vol} m³`}
                  pct={maxGradeVol > 0 ? (g.vol / maxGradeVol) * 100 : 0}
                  color={ACCENT}
                />
              ))}
            </div>
          </DashCard>
        </div>
      )}

      {/* Cube test alerts */}
      {(pendingCubes > 0 || recentFailures > 0) && (
        <div style={{ marginBottom: '16px' }}>
          <DashCard>
            <SectionTitle title="Cube Test Alerts" subtitle="Pending tests and recent failures" />
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', padding: '8px 0' }}>
              {pendingCubes > 0 && (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px',
                    borderRadius: '10px', background: CLR.amber + '18', cursor: 'pointer',
                  }}
                  onClick={() => setPage('co_cube_tests')}
                >
                  <Icon name="hourglass_top" size={20} style={{ color: CLR.amber }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>
                    {pendingCubes} pending / curing
                  </span>
                </div>
              )}
              {recentFailures > 0 && (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px',
                    borderRadius: '10px', background: CLR.red + '18', cursor: 'pointer',
                  }}
                  onClick={() => setPage('co_cube_tests')}
                >
                  <Icon name="warning" size={20} style={{ color: CLR.red }} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>
                    {recentFailures} failed
                  </span>
                </div>
              )}
            </div>
          </DashCard>
        </div>
      )}

      {/* Recent batches */}
      <div style={{ marginBottom: '16px' }}>
        <DashCard>
          <SectionTitle title="Recent Batches" subtitle="Last 10 batches produced" />
          {loading ? (
            <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading...</div>
          ) : recentBatches.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '30px 0', color: THEME.textLow, fontSize: '13px' }}>
              No batches recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {recentBatches.map((b, i) => (
                <ActivityRow
                  key={b.id}
                  icon={statusIcon(b.status)}
                  iconColor={statusColor(b.status)}
                  title={b.batch_number || `Batch #${b.id.slice(0, 8)}`}
                  sub={`${b.grade || 'No grade'} -- ${b.quantity_m3 ?? 0} m³ -- ${(b.status || 'unknown').replaceAll('_', ' ')}`}
                  right={fmtDate((b.created_at || '').slice(0, 10))}
                  rightColor={THEME.textMed}
                  isLast={i === recentBatches.length - 1}
                />
              ))}
            </div>
          )}
        </DashCard>
      </div>
    </div>
  )
}
