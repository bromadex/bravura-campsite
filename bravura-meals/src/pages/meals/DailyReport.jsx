import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { Button, fmtDate, today, PageHeader } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle, DonutGauge } from '../../components/dash'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { useSite } from '../../contexts/SiteContext'
import { PrintHeader, ReportTable } from './reports/_shared'

export default function DailyReport() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const showCosts = can('meals.approve')

  const [date,        setDate]        = useState(today())
  const isSaturday = new Date(date + 'T00:00:00').getDay() === 6
  const supperLabelPlural = isSaturday ? 'Special Meals' : 'Suppers'
  const supperColor = isSaturday ? '#8E24AA' : THEME.supperClr
  const supperIcon = isSaturday ? 'celebration' : 'bedtime'
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [logs,        setLogs]        = useState([])
  const [prices,      setPrices]      = useState(null)
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').eq('status','active').eq('site_id', currentSiteId).order('name')
      .then(({ data }) => setEmployees(data || []))
    supabase.from('contractors').select('*').then(({ data }) => setContractors(data || []))
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) load() }, [date, employees, currentSiteId])
  useAutoRefresh(() => { if (currentSiteId) load() })

  async function load() {
    setLoading(true)
    const employeeIds = employees.map(e => e.id)
    const dow = new Date(date + 'T00:00:00').getDay()
    const [logsRes, pricesRes, overrideRes] = await Promise.all([
      employeeIds.length > 0
        ? supabase.from('meal_logs').select('*').eq('date', date).in('employee_id', employeeIds)
        : Promise.resolve({ data: [] }),
      showCosts
        ? supabase.from('meal_prices').select('*').eq('site_id', currentSiteId).lte('effective_date', date).order('effective_date', { ascending: false }).limit(1)
        : { data: [] },
      // Day-of-week override (e.g. Saturday special supper) so the Day Cost
      // stat agrees with Billing / Finance Export.
      showCosts
        ? supabase.from('meal_price_overrides').select('meal_type, price_usd').eq('site_id', currentSiteId).eq('day_of_week', dow).eq('is_active', true).lte('effective_date', date).order('effective_date', { ascending: false })
        : { data: [] },
    ])
    setLogs(logsRes.data || [])
    if (pricesRes.data?.[0]) {
      const p = pricesRes.data[0]
      const next = { b: p.breakfast_usd, l: p.lunch_usd, s: p.supper_usd }
      for (const ov of overrideRes.data || []) {
        if (ov.meal_type === 'breakfast') { next.b = ov.price_usd; break }
      }
      for (const ov of overrideRes.data || []) {
        if (ov.meal_type === 'lunch') { next.l = ov.price_usd; break }
      }
      for (const ov of overrideRes.data || []) {
        if (ov.meal_type === 'supper') { next.s = ov.price_usd; break }
      }
      setPrices(next)
    }
    setLoading(false)
  }

  const logMap = {}
  logs.forEach(l => { logMap[l.employee_id] = l })

  const rows = employees.map(emp => {
    const log = logMap[emp.id] || {}
    return {
      employee_id:   emp.id,
      name:          emp.name,
      contractor_id: emp.contractor_id,
      contractor:    emp.contractor,
      b: log.had_breakfast ? 1 : 0,
      l: log.had_lunch     ? 1 : 0,
      s: log.had_supper    ? 1 : 0,
    }
  })

  const totB = rows.reduce((a,r) => a+r.b, 0)
  const totL = rows.reduce((a,r) => a+r.l, 0)
  const totS = rows.reduce((a,r) => a+r.s, 0)

  return (
    <div className="print-page">
      <PrintHeader title="Daily Meal Report" subtitle={`Date: ${fmtDate(date)}`} site={currentSite} />

      <PageHeader
        title="Daily Report"
        site={currentSite}
        actions={<>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }} />
          <Button onClick={() => window.print()} variant="tonal" icon="print">Print</Button>
        </>}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard label="Breakfasts" value={totB} accent={THEME.breakfastClr} icon="wb_sunny"
          progress={totB+totL+totS > 0 ? totB/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label="Lunches" value={totL} accent={THEME.lunchClr} icon="light_mode"
          progress={totB+totL+totS > 0 ? totL/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label={supperLabelPlural} value={totS} accent={supperColor} icon={supperIcon}
          progress={totB+totL+totS > 0 ? totS/(totB+totL+totS)*100 : 0} sub="Share of meals served" />
        <KpiCard label="Total Meals" value={totB+totL+totS} accent={MODULE_COLORS.meals} icon="groups"
          sub={`${rows.filter(r => r.b+r.l+r.s > 0).length} of ${rows.length} employees ate`} />
        {showCosts && prices && (
          <KpiCard label="Day Cost" value={`$${(totB*prices.b + totL*prices.l + totS*prices.s).toFixed(2)}`} accent={THEME.info} icon="payments" />
        )}
      </div>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <DashCard style={{ flex: '1 1 560px', minWidth: 0, padding: '20px 22px 8px' }}>
          <SectionTitle title="Meals by Employee" subtitle={fmtDate(date)} />
          {loading
            ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
            : <ReportTable rows={rows} showCosts={showCosts} prices={prices} contractors={contractors} />
          }
        </DashCard>
        <div className="no-print" style={{ flex: '0 0 220px' }}>
          <DashCard>
            <SectionTitle title="Participation" subtitle="Employees with a meal logged" />
            <DonutGauge
              pct={rows.length > 0 ? rows.filter(r => r.b+r.l+r.s > 0).length / rows.length * 100 : null}
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
