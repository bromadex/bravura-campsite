import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { StatCard, Button, fmtDate, today, showToast, PageHeader } from '../../components/ui'
import { THEME } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { useAutoRefresh } from '../../hooks/useAutoRefresh'
import { PrintHeader, ReportTable } from './reports/_shared'

export default function RangeReport() {
  const { currentSiteId, currentSite } = useSite()
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Total Breakfasts" value={totB} color={THEME.breakfastClr} icon="wb_sunny" />
        <StatCard label="Total Lunches"    value={totL} color={THEME.lunchClr}     icon="light_mode" />
        <StatCard label="Total Suppers"    value={totS} color={THEME.supperClr}    icon="bedtime" />
        <StatCard label="Grand Total"      value={totB+totL+totS} color={THEME.primary} icon="groups" />
      </div>

      <div style={{ borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, overflow: 'visible', background: THEME.surface }}>
        {loading
          ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
          : <ReportTable rows={rows} isRange contractors={contractors} />
        }
      </div>
    </div>
  )
}
