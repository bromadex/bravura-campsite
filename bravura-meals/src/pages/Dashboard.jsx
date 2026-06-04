import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, StatCard, StatusBadge, Icon, fmtDate, today } from '../components/ui'
import { can, THEME } from '../utils/permissions'

const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457','#00838F']

export default function Dashboard({ setPage }) {
  const { profile } = useAuth()
  const role = profile?.role
  const showCosts = can.seeCosts(role)

  const [todayData,    setTodayData]    = useState(null)
  const [monthData,    setMonthData]    = useState(null)
  const [recentSubs,   setRecentSubs]   = useState([])
  const [openFlags,    setOpenFlags]    = useState(0)
  const [coBreakdown,  setCoBreakdown]  = useState([])  // monthly by contractor
  const [coBilling,    setCoBilling]    = useState([])  // billing by contractor
  const [loading,      setLoading]      = useState(true)

  useEffect(() => {
    async function load() {
      const td = today()
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`

      // Today's totals
      const { data: todayLogs } = await supabase
        .from('meal_logs').select('had_breakfast,had_lunch,had_supper').eq('date', td)
      let b=0,l=0,s=0
      todayLogs?.forEach(m => { if(m.had_breakfast)b++; if(m.had_lunch)l++; if(m.had_supper)s++ })
      setTodayData({ b, l, s })

      // Month totals
      const { data: monthLogs } = await supabase
        .from('meal_logs').select('had_breakfast,had_lunch,had_supper').gte('date', monthStart).lte('date', td)
      let mb=0,ml=0,ms=0
      monthLogs?.forEach(m => { if(m.had_breakfast)mb++; if(m.had_lunch)ml++; if(m.had_supper)ms++ })
      setMonthData({ b: mb, l: ml, s: ms })

      // Recent submissions
      const { data: subs } = await supabase
        .from('daily_submissions').select('date,status').order('date',{ascending:false}).limit(7)
      setRecentSubs(subs || [])

      // Open flags
      const { count } = await supabase.from('flags').select('id',{count:'exact',head:true}).eq('status','open')
      setOpenFlags(count || 0)

      // Monthly consumption by contractor
      const { data: contractors } = await supabase.from('contractors').select('*').order('name')
      const { data: employees }   = await supabase.from('employees').select('id,contractor_id').eq('status','Active')
      const { data: monthLogsAll } = await supabase
        .from('meal_logs').select('employee_id,had_breakfast,had_lunch,had_supper').gte('date',monthStart).lte('date',td)

      if (contractors && employees && monthLogsAll) {
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

        // Billing by contractor (only if user can see costs)
        if (showCosts) {
          const { data: priceRow } = await supabase.from('meal_prices').select('*').lte('effective_date',td).order('effective_date',{ascending:false}).limit(1)
          if (priceRow?.[0]) {
            const p = priceRow[0]
            setCoBilling(Object.values(coAgg).filter(c => c.b+c.l+c.s > 0).map(c => ({
              ...c,
              cost: c.b*p.breakfast_usd + c.l*p.lunch_usd + c.s*p.supper_usd,
            })))
          }
        }
      }

      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
      <Icon name="progress_activity" size={24} style={{ color: THEME.primary, marginRight: '10px' }} />
      Loading dashboard…
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* Flag alert */}
      {openFlags > 0 && can.resolveFlag(role) && (
        <div
          onClick={() => setPage('flags')}
          style={{
            display: 'flex', alignItems: 'center', gap: '14px',
            padding: '14px 18px', borderRadius: '16px',
            background: '#FDECEA', border: `1px solid #F5C6C4`, cursor: 'pointer',
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
                    {/* Progress bar */}
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
              {can.enterMeals(role)     && <ActionBtn icon="edit_note"    label="Enter today's meals"   onClick={() => setPage('entry')} />}
              {can.approveDay(role)     && <ActionBtn icon="task_alt"     label="Review submissions"    onClick={() => setPage('approvals')} />}
              {can.confirmCounts(role)  && <ActionBtn icon="restaurant"   label="Confirm kitchen counts" onClick={() => setPage('kitchen')} />}
              {can.setPrices(role)      && <ActionBtn icon="sell"         label="Update meal prices"    onClick={() => setPage('pricing')} />}
              {can.seeReports(role)     && <ActionBtn icon="today"        label="Daily report"          onClick={() => setPage('daily')} />}
              {can.seeCosts(role)       && <ActionBtn icon="receipt_long" label="View billing"          onClick={() => setPage('billing')} />}
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
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>No submissions yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {recentSubs.map(sub => (
              <div key={sub.date} style={{
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
