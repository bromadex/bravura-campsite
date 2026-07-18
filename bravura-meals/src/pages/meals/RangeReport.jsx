import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { Button, fmtDate, today, showToast, PageHeader } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle, DonutGauge } from '../../components/dash'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { PrintHeader, ReportTable } from './reports/_shared'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

export default function RangeReport({ setPage }) {
  const { currentSiteId, currentSite } = useSite()
  useRealtimeSubscription('meal_logs', { column: 'site_id', value: currentSiteId }, load)
  const now = new Date()
  const [start,       setStart]       = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`)
  const [end,         setEnd]         = useState(today())
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [summary,     setSummary]     = useState({})
  const [loading,     setLoading]     = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').eq('status','active').eq('site_id', currentSiteId).order('name')
      .then(({ data }) => setEmployees(data || []))
    supabase.from('contractors').select('*').then(({ data }) => setContractors(data || []))
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) load() }, [start, end, employees, currentSiteId])
  useAutoRefresh(() => { if (currentSiteId) load() })

  async function load() {
    if (!start || !end) return
    setLoading(true)
    const employeeIds = employees.map(e => e.id)
    let logs = [], error = null
    if (employeeIds.length > 0) {
      const res = await supabase.from('meal_logs').select('*').gte('date', start).lte('date', end).in('employee_id', employeeIds)
      logs = res.data || []
      error = res.error
    }
    if (error) {
      console.error('RangeReport load error:', error)
      showToast('Failed to load range report: ' + error.message, 'red')
    }
    const agg = {}
    logs?.forEach(log => {
      if (!agg[log.employee_id]) agg[log.employee_id] = { b: 0, l: 0, s: 0 }
      if (log.had_breakfast) agg[log.employee_id].b++
      if (log.had_lunch)     agg[log.employee_id].l++
      if (log.had_supper)    agg[log.employee_id].s++
    })
    setSummary(agg)
    setLoading(false)
  }

  const rows = employees.map(emp => {
    const a = summary[emp.id] || { b: 0, l: 0, s: 0 }
    return { employee_id: emp.id, name: emp.name, contractor_id: emp.contractor_id, contractor: emp.contractor, ...a, total: a.b+a.l+a.s }
  })
  const totB = rows.reduce((a,r) => a+r.b, 0)
  const totL = rows.reduce((a,r) => a+r.l, 0)
  const totS = rows.reduce((a,r) => a+r.s, 0)

  return (
    <div className="print-page">
      <PrintHeader title="Date Range Meal Report" subtitle={`Period: ${fmtDate(start)} — ${fmtDate(end)}`} site={currentSite} />

      <PageHeader
        title="Range Report"
        site={currentSite}
        actions={<>
          {[['From', start, setStart], ['To', end, setEnd]].map(([label, val, setter]) => (
            <div key={label}>
              <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px' }}>{label}</div>
              <input type="date" value={val} onChange={e => setter(e.target.value)}
                style={{ padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }} />
            </div>
          ))}
          <Button onClick={() => window.print()} variant="tonal" icon="print">Print</Button>
        </>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard label="Total Breakfasts" value={totB} accent={THEME.breakfastClr} icon="wb_sunny"
          progress={totB+totL+totS > 0 ? totB/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label="Total Lunches" value={totL} accent={THEME.lunchClr} icon="light_mode"
          progress={totB+totL+totS > 0 ? totL/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label="Total Suppers" value={totS} accent={THEME.supperClr} icon="bedtime"
          progress={totB+totL+totS > 0 ? totS/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label="Grand Total" value={totB+totL+totS} accent={MODULE_COLORS.meals} icon="groups"
          sub={`${rows.filter(r => r.total > 0).length} of ${rows.length} employees ate`} />
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <DashCard style={{ flex: '1 1 560px', minWidth: 0, padding: '20px 22px 8px' }}>
          <SectionTitle title="Meals by Employee" subtitle={`${fmtDate(start)} — ${fmtDate(end)}`} />
          {loading
            ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
            : <ReportTable rows={rows} isRange contractors={contractors} />
          }
        </DashCard>
        <div className="no-print" style={{ flex: '0 0 220px' }}>
          <DashCard>
            <SectionTitle title="Participation" subtitle="Employees with a meal in period" />
            <DonutGauge
              pct={rows.length > 0 ? rows.filter(r => r.total > 0).length / rows.length * 100 : null}
              color={MODULE_COLORS.meals}
              size={130}
              label="of employees"
            />
          </DashCard>
        </div>
      </div>
    </div>
  )
}
