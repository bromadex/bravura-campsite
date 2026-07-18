import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, PageHeader, Button, showToast } from '../../components/ui'
import { DashCard, KpiCard, DonutGauge, SectionTitle } from '../../components/dash'
import QuickNav, { HR_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const DAY = 24 * 60 * 60 * 1000

function statusOf(rec) {
  if (!rec) return 'none'
  if (!rec.next_exam_date) return 'valid'
  const days = Math.floor((new Date(rec.next_exam_date) - new Date()) / DAY)
  if (days < 0) return 'expired'
  if (days <= 30) return 'expiring'
  return 'valid'
}

const STATUS_META = {
  valid:    { label: 'Valid',       color: THEME.success },
  expiring: { label: 'Expiring',    color: THEME.warning },
  expired:  { label: 'Expired',     color: THEME.error },
  none:     { label: 'No Record',   color: THEME.textLow },
}

export default function MedicalSurveillance({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('medical_records', { column: 'site_id', value: currentSiteId })

  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState([])
  const [records, setRecords] = useState([])
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [empRes, medRes] = await Promise.all([
        supabase.from('employees')
          .select('id, name, employee_number, status, is_archived, department:departments!employees_department_id_fkey(id, name)')
          .eq('site_id', currentSiteId),
        supabase.from('medical_records')
          .select('id, employee_id, exam_type, exam_date, result, next_exam_date, restrictions')
          .eq('site_id', currentSiteId)
          .order('exam_date', { ascending: false }),
      ])
      if (empRes.error) throw empRes.error
      if (medRes.error) throw medRes.error
      setEmployees((empRes.data || []).filter(e => !e.is_archived && e.status !== 'terminated'))
      setRecords(medRes.data || [])
    } catch (err) {
      console.error('MedicalSurveillance fetch:', err)
      showToast('Failed to load medical surveillance data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetch()
  }, [currentSiteId, fetch, rt])

  // Latest medical record per employee (records already sorted by exam_date desc)
  const rows = useMemo(() => {
    const latest = {}
    records.forEach(r => { if (!latest[r.employee_id]) latest[r.employee_id] = r })
    return employees.map(e => {
      const rec = latest[e.id] || null
      return { emp: e, rec, status: statusOf(rec) }
    })
  }, [employees, records])

  const departments = useMemo(() => {
    const names = new Set(employees.map(e => e.department?.name).filter(Boolean))
    return [...names].sort()
  }, [employees])

  const kpis = useMemo(() => ({
    valid: rows.filter(r => r.status === 'valid').length,
    expiring: rows.filter(r => r.status === 'expiring').length,
    expired: rows.filter(r => r.status === 'expired').length,
    none: rows.filter(r => r.status === 'none').length,
  }), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(({ emp, status }) => {
      if (deptFilter && (emp.department?.name || 'Unassigned') !== deptFilter) return false
      if (statusFilter && status !== statusFilter) return false
      if (q && !(emp.name || '').toLowerCase().includes(q) && !(emp.employee_number || '').toLowerCase().includes(q)) return false
      return true
    }).sort((a, b) => {
      const order = { expired: 0, expiring: 1, valid: 2, none: 3 }
      return order[a.status] - order[b.status] || (a.emp.name || '').localeCompare(b.emp.name || '')
    })
  }, [rows, deptFilter, statusFilter, search])

  const examined = filtered.filter(r => r.rec)
  const neverExamined = filtered.filter(r => !r.rec)

  const handleExport = useCallback(() => {
    const headers = ['Employee #', 'Name', 'Department', 'Exam Type', 'Exam Date', 'Result', 'Next Exam Due', 'Status']
    const rowsOut = filtered.map(({ emp, rec, status }) => [
      emp.employee_number || '', emp.name || '', emp.department?.name || '',
      rec?.exam_type || '', rec?.exam_date || '', rec?.result || '',
      rec?.next_exam_date || '', STATUS_META[status].label,
    ])
    exportCsv(`medical_surveillance_${new Date().toISOString().slice(0, 10)}.csv`, headers, rowsOut)
  }, [filtered])

  if (!can('hr.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view medical surveillance.
        </div>
      </Card>
    )
  }

  const selectStyle = { padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px' }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
  const td = { padding: '8px 10px', color: THEME.text }

  const totalRows = rows.length
  const validPct = totalRows > 0 ? (kpis.valid / totalRows) * 100 : null

  return (
    <div>
      <PageHeader title="Medical Surveillance" site={currentSite} />

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input placeholder="Search name or number..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...selectStyle, minWidth: '200px' }} />
        <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} style={selectStyle}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">All statuses</option>
          <option value="valid">Valid</option>
          <option value="expiring">Expiring (30 days)</option>
          <option value="expired">Expired</option>
          <option value="none">Never examined</option>
        </select>
        <Button icon="download" onClick={handleExport} style={{ marginLeft: 'auto' }}>Export CSV</Button>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <KpiCard label="Valid Medical" value={kpis.valid} icon="verified" accent={THEME.success}
              progress={validPct} sub={validPct !== null ? `${validPct.toFixed(0)}% of workforce` : undefined} />
            <KpiCard label="Expiring in 30 Days" value={kpis.expiring} icon="schedule" accent={THEME.warning}
              progress={totalRows > 0 ? (kpis.expiring / totalRows) * 100 : undefined} />
            <KpiCard label="Expired" value={kpis.expired} icon="error" accent={THEME.error}
              progress={totalRows > 0 ? (kpis.expired / totalRows) * 100 : undefined} />
            <KpiCard label="Never Examined" value={kpis.none} icon="person_search" accent={ACCENT}
              progress={totalRows > 0 ? (kpis.none / totalRows) * 100 : undefined} />
          </div>

          {/* Compliance gauge */}
          <DashCard style={{ marginBottom: '18px' }}>
            <SectionTitle title="Medical Compliance" subtitle="Share of active employees with a valid medical" />
            <DonutGauge
              pct={validPct}
              color={THEME.success}
              label="valid"
              legend={[
                [THEME.success, `Valid ${kpis.valid}`],
                [THEME.warning, `Expiring ${kpis.expiring}`],
                [THEME.error, `Expired ${kpis.expired}`],
                [THEME.textLow, `No record ${kpis.none}`],
              ]}
            />
          </DashCard>

          {/* Fitness-to-work register */}
          <DashCard style={{ marginBottom: '18px' }}>
            <SectionTitle title={`Fitness to Work (${examined.length})`} />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    {['Employee #', 'Name', 'Department', 'Exam Type', 'Exam Date', 'Result', 'Next Exam Due', 'Status'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {examined.length === 0 && (
                    <tr><td colSpan={8} style={{ ...td, color: THEME.textMed, textAlign: 'center', padding: '20px' }}>No records match the filters.</td></tr>
                  )}
                  {examined.map(({ emp, rec, status }) => {
                    const meta = STATUS_META[status]
                    return (
                      <tr key={emp.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={td}>{emp.employee_number || '-'}</td>
                        <td style={td}>{emp.name}</td>
                        <td style={td}>{emp.department?.name || '-'}</td>
                        <td style={td}>{rec.exam_type || '-'}</td>
                        <td style={td}>{rec.exam_date}</td>
                        <td style={{ ...td, color: rec.result === 'Unfit' ? THEME.error : THEME.text }}>{rec.result || '-'}</td>
                        <td style={{ ...td, color: meta.color }}>{rec.next_exam_date || '-'}</td>
                        <td style={td}>
                          <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 600, color: meta.color, background: meta.color + '18' }}>
                            {meta.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </DashCard>

          {/* Never examined */}
          {(!statusFilter || statusFilter === 'none') && (
            <DashCard>
              <SectionTitle title={`Never Examined (${neverExamined.length})`} />
              {neverExamined.length === 0 ? (
                <div style={{ color: THEME.textMed, fontSize: '13px' }}>All active employees have a medical record on file.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
      <QuickNav pills={HR_PILLS} setPage={setPage} current="wf_medicals" />
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr>
                        {['Employee #', 'Name', 'Department'].map(h => <th key={h} style={th}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {neverExamined.map(({ emp }) => (
                        <tr key={emp.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                          <td style={td}>{emp.employee_number || '-'}</td>
                          <td style={td}>{emp.name}</td>
                          <td style={{ ...td, color: THEME.textMed }}>{emp.department?.name || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DashCard>
          )}
        </>
      )}
    </div>
  )
}
