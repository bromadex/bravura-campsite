import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { Button, MONTHS, showToast, PageHeader } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle, DonutGauge } from '../../components/dash'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { PrintHeader, ReportTable } from './reports/_shared'

export default function MonthlyReport() {
  const { currentSiteId, currentSite } = useSite()
  const [month,       setMonth]       = useState(new Date().getMonth())
  const [year,        setYear]        = useState(new Date().getFullYear())
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

  useEffect(() => { if (currentSiteId) load() }, [month, year, employees, currentSiteId])
  useAutoRefresh(() => { if (currentSiteId) load() })

  async function load() {
    setLoading(true)
    const pad = n => String(n).padStart(2,'0')
    const prefix = `${year}-${pad(month+1)}`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const employeeIds = employees.map(e => e.id)
    let logs = [], error = null
    if (employeeIds.length > 0) {
      const res = await supabase.from('meal_logs').select('*')
        .gte('date', `${prefix}-01`)
        .lte('date', `${prefix}-${pad(lastDay)}`)
        .in('employee_id', employeeIds)
      logs = res.data || []
      error = res.error
    }
    if (error) {
      console.error('MonthlyReport load error:', error)
      showToast('Failed to load monthly report: ' + error.message, 'red')
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
    const a = summary[emp.id] || { b:0, l:0, s:0 }
    return { employee_id: emp.id, name: emp.name, contractor_id: emp.contractor_id, contractor: emp.contractor, ...a, total: a.b+a.l+a.s }
  })
  const totB = rows.reduce((a,r) => a+r.b, 0)
  const totL = rows.reduce((a,r) => a+r.l, 0)
  const totS = rows.reduce((a,r) => a+r.s, 0)

  return (
    <div className="print-page">
      <PrintHeader title="Monthly Meal Report" subtitle={`${MONTHS[month]} ${year}`} site={currentSite} />

      <PageHeader
        title="Monthly Report"
        site={currentSite}
        actions={<>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px' }}>Month</div>
            <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
              style={{ padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
              {MONTHS.map((m,i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px' }}>Year</div>
            <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} min="2020" max="2099"
              style={{ width: '90px', padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <Button onClick={() => window.print()} variant="tonal" icon="print">Print</Button>
        </>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard label="Breakfasts" value={totB} accent={THEME.breakfastClr} icon="wb_sunny"
          progress={totB+totL+totS > 0 ? totB/(totB+totL+totS)*100 : 0} sub={`${MONTHS[month]} ${year}`} />
        <KpiCard label="Lunches" value={totL} accent={THEME.lunchClr} icon="light_mode"
          progress={totB+totL+totS > 0 ? totL/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label="Suppers" value={totS} accent={THEME.supperClr} icon="bedtime"
          progress={totB+totL+totS > 0 ? totS/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label="Grand Total" value={totB+totL+totS} accent={MODULE_COLORS.meals} icon="groups"
          sub={`${rows.filter(r => r.total > 0).length} of ${rows.length} employees ate`} />
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <DashCard style={{ flex: '1 1 560px', minWidth: 0, padding: '20px 22px 8px' }}>
          <SectionTitle title="Meals by Employee" subtitle={`${MONTHS[month]} ${year}`} />
          {loading
            ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
            : <ReportTable rows={rows} isRange contractors={contractors} />
          }
        </DashCard>
        <div className="no-print" style={{ flex: '0 0 220px' }}>
          <DashCard>
            <SectionTitle title="Participation" subtitle="Employees with a meal this month" />
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
