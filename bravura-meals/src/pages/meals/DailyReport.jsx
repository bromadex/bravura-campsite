import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { StatCard, Button, fmtDate, today, PageHeader } from '../../components/ui'
import { THEME } from '../../utils/permissions'
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Breakfasts" value={totB} color={THEME.breakfastClr} icon="wb_sunny" />
        <StatCard label="Lunches"    value={totL} color={THEME.lunchClr}     icon="light_mode" />
        <StatCard label={supperLabelPlural} value={totS} color={supperColor} icon={supperIcon} />
        <StatCard label="Total"      value={totB+totL+totS} color={THEME.primary} icon="groups" />
        {showCosts && prices && (
          <StatCard label="Day Cost" value={`$${(totB*prices.b + totL*prices.l + totS*prices.s).toFixed(2)}`} color={THEME.info} icon="payments" />
        )}
      </div>

      <div style={{ borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, overflow: 'visible', background: THEME.surface }}>
        {loading
          ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
          : <ReportTable rows={rows} showCosts={showCosts} prices={prices} contractors={contractors} />
        }
      </div>
    </div>
  )
}
