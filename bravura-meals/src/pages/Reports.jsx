// ── Daily Report ─────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, StatCard, fmtDate, today, MONTHS } from '../components/ui'
import { can } from '../utils/permissions'

function ReportTable({ logs, employees, showCosts = false, prices = null }) {
  // Build a map empId -> meals for quick lookup
  const logMap = {}
  logs.forEach(log => { logMap[log.employee_id] = log })

  let totalB = 0, totalL = 0, totalS = 0

  const rows = employees.map((emp, i) => {
    const log = logMap[emp.id] || {}
    const b = log.had_breakfast ? 1 : 0
    const l = log.had_lunch     ? 1 : 0
    const s = log.had_supper    ? 1 : 0
    totalB += b; totalL += l; totalS += s
    const tot = b + l + s
    const isAny = tot > 0

    const chk = (v, color) => v
      ? <span style={{ color, fontWeight: 700, fontSize: '18px' }}>✓</span>
      : <span style={{ color: '#ddd' }}>—</span>

    return (
      <tr key={emp.id} style={{ borderBottom: '1px solid #eee', background: '#fff' }}>
        <td style={{ padding: '8px 10px', color: '#888', textAlign: 'center', fontSize: '12px' }}>{i+1}</td>
        <td style={{ padding: '8px 10px', fontWeight: isAny ? 600 : 400, color: isAny ? '#1a1a2e' : '#aaa' }}>{emp.name}</td>
        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
          <span style={{ background: emp.group_name === 'Manhattan' ? '#E0F2F1' : '#D6E4F0', color: emp.group_name === 'Manhattan' ? '#00897B' : '#1F3864', padding: '1px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
            {emp.group_name === 'Manhattan' ? 'MTN' : 'MAIN'}
          </span>
        </td>
        <td style={{ padding: '8px 10px', textAlign: 'center' }}>{chk(log.had_breakfast, '#C55A11')}</td>
        <td style={{ padding: '8px 10px', textAlign: 'center' }}>{chk(log.had_lunch,     '#00897B')}</td>
        <td style={{ padding: '8px 10px', textAlign: 'center' }}>{chk(log.had_supper,    '#5E35B1')}</td>
        <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700, color: isAny ? '#2F5496' : '#aaa' }}>{tot || '—'}</td>
        {showCosts && prices && (
          <td style={{ padding: '8px 10px', textAlign: 'right', color: '#1F3864', fontWeight: isAny ? 700 : 400 }}>
            {isAny ? `$${(b*prices.b + l*prices.l + s*prices.s).toFixed(2)}` : '—'}
          </td>
        )}
      </tr>
    )
  })

  const grandTotal = totalB + totalL + totalS

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#1F3864', color: '#fff' }}>
            <th style={{ padding: '10px 10px', width: '36px' }}>#</th>
            <th style={{ padding: '10px 10px', textAlign: 'left' }}>Employee</th>
            <th style={{ padding: '10px 10px', textAlign: 'center', width: '60px' }}>Group</th>
            <th style={{ padding: '10px 10px', textAlign: 'center', width: '80px', background: '#7e4a1a' }}>🌅 B'fast</th>
            <th style={{ padding: '10px 10px', textAlign: 'center', width: '80px', background: '#0f6e56' }}>☀️ Lunch</th>
            <th style={{ padding: '10px 10px', textAlign: 'center', width: '80px', background: '#3c3489' }}>🌙 Supper</th>
            <th style={{ padding: '10px 10px', textAlign: 'center', width: '60px' }}>Total</th>
            {showCosts && <th style={{ padding: '10px 10px', textAlign: 'right' }}>Cost (USD)</th>}
          </tr>
        </thead>
        <tbody>
          {rows}
          <tr style={{ background: '#1F3864', color: '#fff', fontWeight: 700 }}>
            <td colSpan={3} style={{ padding: '10px 12px' }}>Grand Total</td>
            <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalB}</td>
            <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalL}</td>
            <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalS}</td>
            <td style={{ padding: '10px 12px', textAlign: 'center' }}>{grandTotal}</td>
            {showCosts && prices && (
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                ${(totalB*prices.b + totalL*prices.l + totalS*prices.s).toFixed(2)}
              </td>
            )}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────────

export function DailyReport() {
  const { profile } = useAuth()
  const showCosts = can.seeCosts(profile?.role)
  const [date,      setDate]      = useState(today())
  const [employees, setEmployees] = useState([])
  const [logs,      setLogs]      = useState([])
  const [prices,    setPrices]    = useState(null)
  const [loading,   setLoading]   = useState(true)

  useEffect(() => {
    supabase.from('employees').select('*').eq('status','Active').order('group_name').order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  useEffect(() => { load() }, [date])

  async function load() {
    setLoading(true)
    const [logsRes, pricesRes] = await Promise.all([
      supabase.from('meal_logs').select('*').eq('date', date),
      showCosts
        ? supabase.from('meal_prices').select('*').lte('effective_date', date).order('effective_date', { ascending: false }).limit(1)
        : Promise.resolve({ data: [] }),
    ])
    setLogs(logsRes.data || [])
    if (pricesRes.data?.[0]) {
      const p = pricesRes.data[0]
      setPrices({ b: p.breakfast_usd, l: p.lunch_usd, s: p.supper_usd })
    }
    setLoading(false)
  }

  const b = logs.filter(l => l.had_breakfast).length
  const l = logs.filter(l => l.had_lunch).length
  const s = logs.filter(l => l.had_supper).length

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>Daily Report</h2>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }} />
        <button onClick={() => window.print()} style={{ padding: '7px 14px', background: '#2F5496', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit' }}>
          🖨️ Print
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Breakfasts" value={b} color="#C55A11" />
        <StatCard label="Lunches"    value={l} color="#00897B" />
        <StatCard label="Suppers"    value={s} color="#5E35B1" />
        <StatCard label="Total"      value={b+l+s} color="#C00000" />
        {showCosts && prices && (
          <StatCard label="Total Cost" value={`$${(b*prices.b + l*prices.l + s*prices.s).toFixed(2)}`} color="#1F3864" />
        )}
      </div>
      <Card>
        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Loading…</div> : (
          <ReportTable logs={logs} employees={employees} showCosts={showCosts} prices={prices} />
        )}
      </Card>
    </div>
  )
}

export function RangeReport() {
  const { profile } = useAuth()
  const showCosts = can.seeCosts(profile?.role)
  const now = new Date()
  const [start,     setStart]     = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`)
  const [end,       setEnd]       = useState(today())
  const [employees, setEmployees] = useState([])
  const [summary,   setSummary]   = useState([])
  const [loading,   setLoading]   = useState(false)

  useEffect(() => {
    supabase.from('employees').select('*').eq('status','Active').order('group_name').order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  useEffect(() => { load() }, [start, end])

  async function load() {
    if (!start || !end) return
    setLoading(true)
    const { data: logs } = await supabase
      .from('meal_logs').select('*').gte('date', start).lte('date', end)
    // Aggregate per employee
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

  let totalB = 0, totalL = 0, totalS = 0
  employees.forEach(e => { const a = summary[e.id] || {}; totalB += a.b||0; totalL += a.l||0; totalS += a.s||0 })

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, alignSelf: 'center' }}>Range Report</h2>
        {[['From', start, setStart], ['To', end, setEnd]].map(([label, val, setter]) => (
          <div key={label}>
            <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>
            <input type="date" value={val} onChange={e => setter(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }} />
          </div>
        ))}
        <button onClick={() => window.print()} style={{ padding: '7px 14px', background: '#2F5496', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit' }}>
          🖨️ Print
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Total B'fasts" value={totalB} color="#C55A11" />
        <StatCard label="Total Lunches" value={totalL} color="#00897B" />
        <StatCard label="Total Suppers" value={totalS} color="#5E35B1" />
        <StatCard label="Grand Total"   value={totalB+totalL+totalS} color="#C00000" />
      </div>
      <Card>
        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Loading…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#1F3864', color: '#fff' }}>
                  <th style={{ padding: '10px 12px', width: '36px' }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Employee</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Group</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', background: '#7e4a1a' }}>Breakfasts</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', background: '#0f6e56' }}>Lunches</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', background: '#3c3489' }}>Suppers</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => {
                  const a = summary[emp.id] || { b: 0, l: 0, s: 0 }
                  const tot = a.b + a.l + a.s
                  return (
                    <tr key={emp.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px 12px', color: '#888', textAlign: 'center' }}>{i+1}</td>
                      <td style={{ padding: '8px 12px', fontWeight: tot ? 600 : 400, color: tot ? '#1a1a2e' : '#aaa' }}>{emp.name}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ background: emp.group_name === 'Manhattan' ? '#E0F2F1' : '#D6E4F0', color: emp.group_name === 'Manhattan' ? '#00897B' : '#1F3864', padding: '1px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
                          {emp.group_name === 'Manhattan' ? 'MTN' : 'MAIN'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: a.b ? '#C55A11' : '#aaa', fontWeight: 700 }}>{a.b || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: a.l ? '#00897B' : '#aaa', fontWeight: 700 }}>{a.l || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: a.s ? '#5E35B1' : '#aaa', fontWeight: 700 }}>{a.s || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: tot ? '#2F5496' : '#aaa', fontWeight: 700 }}>{tot || '—'}</td>
                    </tr>
                  )
                })}
                <tr style={{ background: '#1F3864', color: '#fff', fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '10px 12px' }}>Grand Total</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalB}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalL}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalS}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalB+totalL+totalS}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

export function MonthlyReport() {
  const [month,     setMonth]     = useState(new Date().getMonth())
  const [year,      setYear]      = useState(new Date().getFullYear())
  const [employees, setEmployees] = useState([])
  const [summary,   setSummary]   = useState({})
  const [loading,   setLoading]   = useState(false)

  useEffect(() => {
    supabase.from('employees').select('*').eq('status','Active').order('group_name').order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  useEffect(() => { load() }, [month, year])

  async function load() {
    setLoading(true)
    const pad = n => String(n).padStart(2,'0')
    const prefix = `${year}-${pad(month+1)}`
    const { data: logs } = await supabase
      .from('meal_logs').select('*').gte('date', `${prefix}-01`).lte('date', `${prefix}-31`)
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

  let totalB = 0, totalL = 0, totalS = 0
  employees.forEach(e => { const a = summary[e.id] || {}; totalB += a.b||0; totalL += a.l||0; totalS += a.s||0 })

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, alignSelf: 'center' }}>Monthly Report</h2>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Month</label>
          <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
            style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}>
            {MONTHS.map((m,i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#4a5568', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Year</label>
          <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} min="2020" max="2099"
            style={{ width: '100px', padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }} />
        </div>
        <button onClick={() => window.print()} style={{ padding: '7px 14px', background: '#2F5496', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit' }}>
          🖨️ Print
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Total B'fasts" value={totalB} color="#C55A11" sub={`${MONTHS[month]} ${year}`} />
        <StatCard label="Total Lunches" value={totalL} color="#00897B" />
        <StatCard label="Total Suppers" value={totalS} color="#5E35B1" />
        <StatCard label="Grand Total"   value={totalB+totalL+totalS} color="#C00000" />
      </div>
      <Card>
        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#888' }}>Loading…</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#1F3864', color: '#fff' }}>
                  <th style={{ padding: '10px 12px', width: '36px' }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Employee</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Group</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', background: '#7e4a1a' }}>Breakfasts</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', background: '#0f6e56' }}>Lunches</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', background: '#3c3489' }}>Suppers</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((emp, i) => {
                  const a = summary[emp.id] || { b: 0, l: 0, s: 0 }
                  const tot = a.b + a.l + a.s
                  return (
                    <tr key={emp.id} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '8px 12px', color: '#888', textAlign: 'center' }}>{i+1}</td>
                      <td style={{ padding: '8px 12px', fontWeight: tot ? 600 : 400, color: tot ? '#1a1a2e' : '#aaa' }}>{emp.name}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <span style={{ background: emp.group_name === 'Manhattan' ? '#E0F2F1' : '#D6E4F0', color: emp.group_name === 'Manhattan' ? '#00897B' : '#1F3864', padding: '1px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
                          {emp.group_name === 'Manhattan' ? 'MTN' : 'MAIN'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: a.b ? '#C55A11' : '#aaa', fontWeight: 700 }}>{a.b || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: a.l ? '#00897B' : '#aaa', fontWeight: 700 }}>{a.l || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: a.s ? '#5E35B1' : '#aaa', fontWeight: 700 }}>{a.s || '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', color: tot ? '#2F5496' : '#aaa', fontWeight: 700 }}>{tot || '—'}</td>
                    </tr>
                  )
                })}
                <tr style={{ background: '#1F3864', color: '#fff', fontWeight: 700 }}>
                  <td colSpan={3} style={{ padding: '10px 12px' }}>Grand Total — {MONTHS[month]} {year}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalB}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalL}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalS}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'center' }}>{totalB+totalL+totalS}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
