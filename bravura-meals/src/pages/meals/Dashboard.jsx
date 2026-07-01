import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, StatCard, StatusBadge, Icon, fmtDate, today } from '../../components/ui'
import { THEME } from '../../utils/permissions'

const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457','#00838F']

export default function Dashboard({ setPage }) {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const showCosts = can('meals.approve')

  const [todayData,    setTodayData]    = useState(null)
  const [monthData,    setMonthData]    = useState(null)
  const [recentSubs,   setRecentSubs]   = useState([])
  const [openFlags,    setOpenFlags]    = useState(0)
  const [coBreakdown,  setCoBreakdown]  = useState([])  // monthly by contractor
  const [coBilling,    setCoBilling]    = useState([])  // billing by contractor
  const [providers,    setProviders]    = useState([])  // active meal providers for this site
  const [loading,      setLoading]      = useState(true)

  // Re-fetched whenever the selected site changes — this entire page was
  // missed during both the original RBAC swap and the Meals site-filtering
  // sweep. None of its queries were ever scoped to a site, and the
  // employees query still checked the old capitalized 'Active' status
  // value — meaning the contractor breakdown below has likely been
  // matching zero employees, silently, since the status migration.
  useEffect(() => { if (currentSiteId) load() }, [currentSiteId])

  async function load() {
    setLoading(true)
    const td = today()
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`

    // Employees first — todayLogs and monthLogs depend on employeeIds.
    const { data: employees } = await supabase
      .from('employees').select('id,contractor_id').eq('status', 'active').eq('site_id', currentSiteId)
    const employeeIds = (employees || []).map(e => e.id)

    // All remaining queries are independent — run in parallel.
    const [
      todayLogsRes,
      monthLogsRes,
      subsRes,
      siteSubsRes,
      provsRes,
      contractorsRes,
    ] = await Promise.all([
      employeeIds.length > 0
        ? supabase.from('meal_logs').select('had_breakfast,had_lunch,had_supper').eq('date', td).in('employee_id', employeeIds)
        : Promise.resolve({ data: [] }),
      employeeIds.length > 0
        ? supabase.from('meal_logs').select('employee_id,had_breakfast,had_lunch,had_supper').gte('date', monthStart).lte('date', td).in('employee_id', employeeIds)
        : Promise.resolve({ data: [] }),
      supabase.from('daily_submissions').select('id,date,status').eq('site_id', currentSiteId).order('date',{ascending:false}).limit(7),
      supabase.from('daily_submissions').select('id').eq('site_id', currentSiteId),
      supabase.from('meal_providers').select('*').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
      supabase.from('contractors').select('*').order('name'),
    ])

    const todayLogs   = todayLogsRes.data  || []
    const monthLogsAll = monthLogsRes.data || []
    const subs        = subsRes.data       || []
    const siteSubs    = siteSubsRes.data   || []
    const provs       = provsRes.data      || []
    const contractors = contractorsRes.data

    let b=0,l=0,s=0
    todayLogs.forEach(m => { if(m.had_breakfast)b++; if(m.had_lunch)l++; if(m.had_supper)s++ })
    setTodayData({ b, l, s })

    let mb=0,ml=0,ms=0
    monthLogsAll.forEach(m => { if(m.had_breakfast)mb++; if(m.had_lunch)ml++; if(m.had_supper)ms++ })
    setMonthData({ b: mb, l: ml, s: ms })

    setRecentSubs(subs)
    setProviders(provs)

    const siteSubIds = siteSubs.map(s => s.id)
    let flagCount = 0
    if (siteSubIds.length > 0) {
      const { count } = await supabase.from('flags').select('id', { count: 'exact', head: true }).eq('status','open').in('submission_id', siteSubIds)
      flagCount = count || 0
    }
    setOpenFlags(flagCount)

    if (contractors && employees) {
      const empMap = {}
      employees.forEach(e => { empMap[e.id] = e.contractor_id })
      const coAgg = {}
      contractors.forEach(c => { coAgg[c.id] = { name: c.name, b:0, l:0, s:0 } })
      monthLogsAll.forEach(log => {
        const cid = empMap[log.employee_id]
        if (cid && coAgg[cid]) {
          if (log.had_breakfast) coAgg[cid].b++
          if (log.had_lunch)     coAgg[cid].l++
          if (log.had_supper)    coAgg[cid].s++
        }
      })
      setCoBreakdown(Object.values(coAgg).filter(c => c.b+c.l+c.s > 0))

      // Billing by contractor (only if user can see costs) — meal_prices
      // now filtered by site too, matching the fix already made to the
      // standalone Pricing page.
      if (showCosts) {
        const { data: priceRow } = await supabase.from('meal_prices').select('*').eq('site_id', currentSiteId).lte('effective_date',td).order('effective_date',{ascending:false}).limit(1)
        if (priceRow?.[0]) {
          const p = priceRow[0]
          setCoBilling(Object.values(coAgg).filter(c => c.b+c.l+c.s > 0).map(c => ({
            ...c,
            cost: c.b*p.breakfast_usd + c.l*p.lunch_usd + c.s*p.supper_usd,
          })))
        } else {
          setCoBilling([])
        }
      }
    } else {
      setCoBreakdown([])
      setCoBilling([])
    }

    setLoading(false)
  }

  if (loading || !todayData || !monthData) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
      <Icon name="progress_activity" size={24} style={{ color: THEME.primary, marginRight: '10px' }} />
      Loading dashboard…
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Site + provider context */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.primary }}>
          <Icon name="location_on" size={12} style={{ color: THEME.primary }} />
          {currentSite?.name || '—'}
        </span>
        {providers.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, background: THEME.statusWarningBg, color: THEME.statusWarningText }}>
            <Icon name="restaurant" size={12} style={{ color: THEME.statusWarningText }} />
            Catered by {providers.map(p => p.name).join(', ')}
          </span>
        )}
      </div>

      {/* Flag alert */}
      {openFlags > 0 && can('meals.approve') && (
        <div
          onClick={() => setPage('meals_flags')}
          style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            padding: '14px 18px', borderRadius: '10px',
            background: THEME.statusErrorBg, border: `1px solid ${THEME.statusErrorText}33`, cursor: 'pointer',
          }}
        >
          <Icon name="flag" size={22} style={{ color: THEME.error, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, color: THEME.error, fontSize: '14px' }}>
              {openFlags} open flag{openFlags > 1 ? 's' : ''} require your attention
            </div>
            <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px' }}>Tap to view and resolve</div>
          </div>
          <Icon name="chevron_right" size={20} style={{ color: THEME.error }} />
        </div>
      )}

      {/* Today */}
      <div>
        <div style={{ fontSize: '12px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '10px' }}>
          Today — {fmtDate(today())}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px' }}>
          <StatCard label="Breakfasts"   value={todayData.b}               color={THEME.breakfastClr} icon="wb_sunny" />
          <StatCard label="Lunches"      value={todayData.l}               color={THEME.lunchClr}     icon="light_mode" />
          <StatCard label="Suppers"      value={todayData.s}               color={THEME.supperClr}    icon="bedtime" />
          <StatCard label="Total Today"  value={todayData.b+todayData.l+todayData.s} color={THEME.primary} icon="groups" />
        </div>
      </div>

      {/* This month */}
      <div>
        <div style={{ fontSize: '12px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: '10px' }}>
          This Month
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px' }}>
          <StatCard label="Breakfasts"   value={monthData.b}               color={THEME.breakfastClr} icon="wb_sunny" />
          <StatCard label="Lunches"      value={monthData.l}               color={THEME.lunchClr}     icon="light_mode" />
          <StatCard label="Suppers"      value={monthData.s}               color={THEME.supperClr}    icon="bedtime" />
          <StatCard label="Month Total"  value={monthData.b+monthData.l+monthData.s} color={THEME.primary} icon="groups" />
        </div>
      </div>

      {/* Monthly by contractor + quick actions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

        {/* Contractor breakdown */}
        <Card elevated>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Icon name="business" size={18} style={{ color: THEME.primary }} />
            <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text }}>Monthly by Contractor</div>
          </div>
          {coBreakdown.length === 0 ? (
            <div style={{ color: THEME.textLow, fontSize: '13px', padding: '12px 0' }}>No meal data this month yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {coBreakdown.map((co, i) => {
                const tot = co.b + co.l + co.s
                const maxTot = Math.max(...coBreakdown.map(c => c.b+c.l+c.s), 1)
                const color = CO_COLORS[i % CO_COLORS.length]
                return (
                  <div key={co.name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{co.name}</div>
                      <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: THEME.textMed }}>
                        <span style={{ color: THEME.breakfastClr }}>{co.b}B</span>
                        <span style={{ color: THEME.lunchClr }}>{co.l}L</span>
                        <span style={{ color: THEME.supperClr }}>{co.s}S</span>
                        <span style={{ fontWeight: 700, color: THEME.text }}>{tot}</span>
                      </div>
                    </div>
                    <div style={{ height: '6px', background: THEME.outlineVar, borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: '3px',
                        width: `${(tot / maxTot) * 100}%`,
                        background: color,
                        transition: 'width .4s ease',
                      }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Billing by contractor (role-gated) + Quick actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {showCosts && coBilling.length > 0 && (
            <Card elevated>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <Icon name="receipt_long" size={18} style={{ color: THEME.info }} />
                <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text }}>Monthly Billing by Contractor</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {coBilling.sort((a,b) => b.cost - a.cost).map((co, i) => (
                  <div key={co.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: THEME.surfaceVar, borderRadius: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{co.name}</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.info }}>${co.cost.toFixed(2)}</div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: THEME.primary, borderRadius: '10px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#fff' }}>Total</div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: '#fff' }}>
                    ${coBilling.reduce((a,c) => a+c.cost, 0).toFixed(2)}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card elevated>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Icon name="bolt" size={18} style={{ color: THEME.primary }} />
              <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text }}>Quick Actions</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {can('meals.create')  && <ActionBtn icon="edit_note"    label="Enter today's meals"   onClick={() => setPage('meals_entry')} />}
              {can('meals.approve') && <ActionBtn icon="task_alt"     label="Review submissions"    onClick={() => setPage('meals_approvals')} />}
              {can('meals.edit')    && <ActionBtn icon="restaurant"   label="Confirm kitchen counts" onClick={() => setPage('meals_kitchen')} />}
              {can('meals.edit')    && <ActionBtn icon="sell"         label="Update meal prices"    onClick={() => setPage('meals_pricing')} />}
              {can('meals.view')    && <ActionBtn icon="today"        label="Daily report"          onClick={() => setPage('meals_daily')} />}
              {can('meals.approve') && <ActionBtn icon="receipt_long" label="View billing"          onClick={() => setPage('meals_billing')} />}
            </div>
          </Card>
        </div>
      </div>

      {/* Recent submissions */}
      <Card elevated>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
          <Icon name="history" size={18} style={{ color: THEME.primary }} />
          <div style={{ fontSize: '14px', fontWeight: 500, color: THEME.text }}>Recent Days</div>
        </div>
        {recentSubs.length === 0 ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>No submissions yet for {currentSite?.name || 'this site'}.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentSubs.map(sub => (
              <div key={sub.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 14px', borderRadius: '12px', background: THEME.surfaceVar,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon name="calendar_today" size={16} style={{ color: THEME.textLow }} />
                  <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{fmtDate(sub.date)}</span>
                </div>
                <StatusBadge status={sub.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function ActionBtn({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
        padding: '10px 14px', background: 'transparent',
        border: `1px solid ${THEME.outlineVar}`,
        borderRadius: '12px', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
        fontFamily: 'inherit', textAlign: 'left', color: THEME.text,
        transition: 'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = THEME.surfaceVar; e.currentTarget.style.borderColor = THEME.primary }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = THEME.outlineVar }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.primary }}>{icon}</span>
      {label}
    </button>
  )
}
