// ── Dashboard ────────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, StatCard, StatusBadge, fmtDate, today } from '../components/ui'
import { can } from '../utils/permissions'

export default function Dashboard({ setPage }) {
  const { profile } = useAuth()
  const role = profile?.role
  const [todayData,   setTodayData]   = useState(null)
  const [monthData,   setMonthData]   = useState(null)
  const [recentSubs,  setRecentSubs]  = useState([])
  const [openFlags,   setOpenFlags]   = useState(0)
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    async function load() {
      const td = today()
      const now = new Date()
      const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`

      // Today's meal totals
      const { data: todayLogs } = await supabase
        .from('meal_logs')
        .select('had_breakfast,had_lunch,had_supper')
        .eq('date', td)
      let b=0,l=0,s=0
      todayLogs?.forEach(m => { if(m.had_breakfast)b++; if(m.had_lunch)l++; if(m.had_supper)s++ })
      setTodayData({ b, l, s })

      // Month totals
      const { data: monthLogs } = await supabase
        .from('meal_logs')
        .select('had_breakfast,had_lunch,had_supper')
        .gte('date', monthStart)
        .lte('date', td)
      let mb=0,ml=0,ms=0
      monthLogs?.forEach(m => { if(m.had_breakfast)mb++; if(m.had_lunch)ml++; if(m.had_supper)ms++ })
      setMonthData({ b: mb, l: ml, s: ms })

      // Recent submissions
      const { data: subs } = await supabase
        .from('daily_submissions')
        .select('date,status')
        .order('date', { ascending: false })
        .limit(7)
      setRecentSubs(subs || [])

      // Open flags
      const { count } = await supabase
        .from('flags')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
      setOpenFlags(count || 0)

      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div style={{ color: '#888', padding: '40px', textAlign: 'center' }}>Loading dashboard…</div>

  return (
    <div>
      {/* Alert if open flags */}
      {openFlags > 0 && can.resolveFlag(role) && (
        <div
          onClick={() => setPage('flags')}
          style={{
            background: '#FFE0E0', border: '1px solid #f5b8b8', borderRadius: '10px',
            padding: '12px 16px', marginBottom: '20px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '10px',
          }}
        >
          <span style={{ fontSize: '20px' }}>🚩</span>
          <div>
            <strong style={{ color: '#C00000' }}>{openFlags} open flag{openFlags > 1 ? 's' : ''} require your attention.</strong>
            <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>Click to view and resolve.</div>
          </div>
        </div>
      )}

      {/* Today stats */}
      <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: '10px' }}>
        Today — {fmtDate(today())}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '24px' }}>
        <StatCard label="Breakfasts"  value={todayData.b} color="#C55A11" />
        <StatCard label="Lunches"     value={todayData.l} color="#00897B" />
        <StatCard label="Suppers"     value={todayData.s} color="#5E35B1" />
        <StatCard label="Total today" value={todayData.b+todayData.l+todayData.s} color="#C00000" />
      </div>

      {/* Month stats */}
      <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: '10px' }}>
        This Month
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '24px' }}>
        <StatCard label="Month B'fasts" value={monthData.b} color="#C55A11" />
        <StatCard label="Month Lunches" value={monthData.l} color="#00897B" />
        <StatCard label="Month Suppers" value={monthData.s} color="#5E35B1" />
        <StatCard label="Month Total"   value={monthData.b+monthData.l+monthData.s} color="#C00000" />
      </div>

      {/* Recent submissions */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: '12px' }}>
            Recent Days
          </div>
          {recentSubs.length === 0 ? (
            <div style={{ color: '#888', fontSize: '13px' }}>No submissions yet.</div>
          ) : (
            recentSubs.map(sub => (
              <div
                key={sub.date}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #eee' }}
              >
                <span style={{ fontSize: '13px' }}>{fmtDate(sub.date)}</span>
                <StatusBadge status={sub.status} />
              </div>
            ))
          )}
        </Card>

        <Card>
          <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: '#888', marginBottom: '12px' }}>
            Quick Actions
          </div>
          {can.enterMeals(role) && (
            <ActionBtn icon="✏️" label="Enter today's meals" onClick={() => setPage('entry')} />
          )}
          {can.approveDay(role) && (
            <ActionBtn icon="✅" label="Review submissions" onClick={() => setPage('approvals')} />
          )}
          {can.confirmCounts(role) && (
            <ActionBtn icon="🍽️" label="Confirm kitchen counts" onClick={() => setPage('kitchen')} />
          )}
          {can.setPrices(role) && (
            <ActionBtn icon="💲" label="Update meal prices" onClick={() => setPage('pricing')} />
          )}
          {can.seeReports(role) && (
            <ActionBtn icon="📊" label="View daily report" onClick={() => setPage('daily')} />
          )}
          {can.seeCosts(role) && (
            <ActionBtn icon="💰" label="View billing" onClick={() => setPage('billing')} />
          )}
        </Card>
      </div>
    </div>
  )
}

function ActionBtn({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '9px 12px', background: '#f4f6f9', border: '1px solid #dde2ea',
        borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
        fontFamily: 'inherit', marginBottom: '8px', textAlign: 'left',
        transition: 'all .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = '#D6E4F0'; e.currentTarget.style.borderColor = '#2F5496' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#f4f6f9'; e.currentTarget.style.borderColor = '#dde2ea' }}
    >
      <span style={{ fontSize: '18px' }}>{icon}</span>
      {label}
    </button>
  )
}
