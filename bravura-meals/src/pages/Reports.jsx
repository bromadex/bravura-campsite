import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, StatCard, SortTh, useSortState, sortRows, Icon, Button, fmtDate, today, MONTHS } from '../components/ui'
import { can, THEME } from '../utils/permissions'

// ── Contractor colour pool ────────────────────────────────────────────────────
const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457']
function coColor(contractors, id) {
  const idx = contractors.findIndex(c => c.id === id)
  return CO_COLORS[idx >= 0 ? idx % CO_COLORS.length : 0]
}

// ── Print header — shown only when printing ───────────────────────────────────
function PrintHeader({ title, subtitle }) {
  return (
    <div className="print-only" style={{ display: 'none', marginBottom: '16px' }}>
      <div style={{ borderBottom: `3px solid ${THEME.primary}`, paddingBottom: '10px', marginBottom: '12px' }}>
        <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.primary }}>
          Bravura Zimbabwe Ltd — Kamativi Mine Site
        </div>
        <div style={{ fontSize: '13px', color: '#555', marginTop: '2px' }}>Meal Management System</div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div style={{ fontSize: '16px', fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: '12px', color: '#555' }}>
          {subtitle} &nbsp;|&nbsp; Printed: {new Date().toLocaleString('en-GB')}
        </div>
      </div>
    </div>
  )
}

// ── Shared sortable report table ──────────────────────────────────────────────
function ReportTable({ rows, showCosts = false, prices = null, isRange = false, contractors = [] }) {
  const [sortState, onSort] = useSortState('name', 'asc')

  const sorted = useMemo(() => {
    const mapped = rows.map(r => ({
      ...r,
      contractorName: contractors.find(c => c.id === r.contractor_id)?.name || r.contractor?.name || '—',
    }))
    return sortRows(mapped, sortState.key, sortState.dir)
  }, [rows, sortState, contractors])

  let totB = 0, totL = 0, totS = 0
  sorted.forEach(r => { totB += r.b||0; totL += r.l||0; totS += r.s||0 })
  const grandTotal = totB + totL + totS

  const hStyle = { background: THEME.primary }
  const chkCell = (v, color) => v
    ? <Icon name="check_circle" size={18} filled style={{ color }} />
    : <span style={{ color: THEME.outlineVar, fontSize: '14px' }}>—</span>

  return (
    // NO overflow:hidden here — that's what was killing multi-page print
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: THEME.primary, color: '#fff' }}>
            <th style={{ ...hStyle, padding: '12px 10px', width: '40px', textAlign: 'center', fontWeight: 500, fontSize: '11px', color: 'rgba(255,255,255,.6)' }}>#</th>
            <SortTh label="Employee"   sortKey="name"           sortState={sortState} onSort={onSort} style={hStyle} />
            <SortTh label="Contractor" sortKey="contractorName" sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
            <SortTh label="Breakfasts" sortKey="b"              sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center', background: THEME.breakfastClr }} />
            <SortTh label="Lunches"    sortKey="l"              sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center', background: THEME.lunchClr }} />
            <SortTh label="Suppers"    sortKey="s"              sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center', background: THEME.supperClr }} />
            <SortTh label="Total"      sortKey="total"          sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
            {showCosts && prices && (
              <th style={{ ...hStyle, padding: '12px 14px', textAlign: 'right', fontWeight: 500, fontSize: '12px' }}>Cost (USD)</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const tot   = (r.b||0) + (r.l||0) + (r.s||0)
            const isAny = tot > 0
            const color = coColor(contractors, r.contractor_id)
            return (
              <tr
                key={r.employee_id || r.id || i}
                style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: isAny ? '#fff' : '#FAFAFA' }}
                onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                onMouseLeave={e => e.currentTarget.style.background = isAny ? '#fff' : '#FAFAFA'}
              >
                <td style={{ padding: '9px 10px', textAlign: 'center', color: THEME.textLow, fontSize: '11px' }}>{i+1}</td>
                <td style={{ padding: '9px 14px', fontWeight: isAny ? 500 : 400, color: isAny ? THEME.text : THEME.textLow }}>
                  {r.name}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {r.contractorName !== '—' ? (
                    <span style={{
                      background: color + '18', color, padding: '3px 10px',
                      borderRadius: '8px', fontSize: '11px', fontWeight: 500,
                    }}>
                      {r.contractorName}
                    </span>
                  ) : <span style={{ color: THEME.textLow }}>—</span>}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {isRange
                    ? <span style={{ fontWeight: 600, color: r.b ? THEME.breakfastClr : THEME.textLow }}>{r.b || '—'}</span>
                    : chkCell(r.b, THEME.breakfastClr)
                  }
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {isRange
                    ? <span style={{ fontWeight: 600, color: r.l ? THEME.lunchClr : THEME.textLow }}>{r.l || '—'}</span>
                    : chkCell(r.l, THEME.lunchClr)
                  }
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center' }}>
                  {isRange
                    ? <span style={{ fontWeight: 600, color: r.s ? THEME.supperClr : THEME.textLow }}>{r.s || '—'}</span>
                    : chkCell(r.s, THEME.supperClr)
                  }
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'center', fontWeight: 700, color: isAny ? THEME.primary : THEME.textLow }}>
                  {tot || '—'}
                </td>
                {showCosts && prices && (
                  <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: isAny ? 600 : 400, color: isAny ? THEME.text : THEME.textLow }}>
                    {isAny ? `$${((r.b||0)*prices.b + (r.l||0)*prices.l + (r.s||0)*prices.s).toFixed(2)}` : '—'}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr style={{ background: THEME.primary, color: '#fff', fontWeight: 600 }}>
            <td colSpan={3} style={{ padding: '12px 14px', fontSize: '13px' }}>Grand Total</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>{totB}</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>{totL}</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>{totS}</td>
            <td style={{ padding: '12px', textAlign: 'center', fontSize: '16px', fontWeight: 700 }}>{grandTotal}</td>
            {showCosts && prices && (
              <td style={{ padding: '12px 14px', textAlign: 'right', fontSize: '14px' }}>
                ${(totB*prices.b + totL*prices.l + totS*prices.s).toFixed(2)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Daily Report ──────────────────────────────────────────────────────────────
export function DailyReport() {
  const { profile } = useAuth()
  const showCosts = can.seeCosts(profile?.role)
  const [date,        setDate]        = useState(today())
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [logs,        setLogs]        = useState([])
  const [prices,      setPrices]      = useState(null)
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').eq('status','active').order('name')
      .then(({ data }) => setEmployees(data || []))
    supabase.from('contractors').select('*').then(({ data }) => setContractors(data || []))
  }, [])

  useEffect(() => { load() }, [date])

  async function load() {
    setLoading(true)
    const [logsRes, pricesRes] = await Promise.all([
      supabase.from('meal_logs').select('*').eq('date', date),
      showCosts
        ? supabase.from('meal_prices').select('*').lte('effective_date', date).order('effective_date', { ascending: false }).limit(1)
        : { data: [] },
    ])
    setLogs(logsRes.data || [])
    if (pricesRes.data?.[0]) {
      const p = pricesRes.data[0]
      setPrices({ b: p.breakfast_usd, l: p.lunch_usd, s: p.supper_usd })
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
      <PrintHeader
        title="Daily Meal Report"
        subtitle={`Date: ${fmtDate(date)}`}
      />

      {/* Screen-only controls */}
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>Daily Report</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            style={{ padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }} />
          <Button onClick={() => window.print()} variant="tonal" icon="print">Print</Button>
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Breakfasts" value={totB} color={THEME.breakfastClr} icon="wb_sunny" />
        <StatCard label="Lunches"    value={totL} color={THEME.lunchClr}     icon="light_mode" />
        <StatCard label="Suppers"    value={totS} color={THEME.supperClr}    icon="bedtime" />
        <StatCard label="Total"      value={totB+totL+totS} color={THEME.primary} icon="groups" />
        {showCosts && prices && (
          <StatCard label="Day Cost" value={`$${(totB*prices.b + totL*prices.l + totS*prices.s).toFixed(2)}`} color={THEME.info} icon="payments" />
        )}
      </div>

      {/* Table — no overflow:hidden wrapper */}
      <div style={{ borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`, overflow: 'visible', background: '#fff' }}>
        {loading
          ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
          : <ReportTable rows={rows} showCosts={showCosts} prices={prices} contractors={contractors} />
        }
      </div>
    </div>
  )
}

// ── Range Report ──────────────────────────────────────────────────────────────
export function RangeReport() {
  const now = new Date()
  const [start,       setStart]       = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`)
  const [end,         setEnd]         = useState(today())
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [summary,     setSummary]     = useState({})
  const [loading,     setLoading]     = useState(false)

  useEffect(() => {
    supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').eq('status','active').order('name')
      .then(({ data }) => setEmployees(data || []))
    supabase.from('contractors').select('*').then(({ data }) => setContractors(data || []))
  }, [])

  useEffect(() => { load() }, [start, end])

  async function load() {
    if (!start || !end) return
    setLoading(true)
    const { data: logs } = await supabase.from('meal_logs').select('*').gte('date', start).lte('date', end)
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
      <PrintHeader
        title="Date Range Meal Report"
        subtitle={`Period: ${fmtDate(start)} — ${fmtDate(end)}`}
      />

      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>Range Report</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {[['From', start, setStart], ['To', end, setEnd]].map(([label, val, setter]) => (
            <div key={label}>
              <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textMed, marginBottom: '4px' }}>{label}</div>
              <input type="date" value={val} onChange={e => setter(e.target.value)}
                style={{ padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }} />
            </div>
          ))}
          <Button onClick={() => window.print()} variant="tonal" icon="print">Print</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Total Breakfasts" value={totB} color={THEME.breakfastClr} icon="wb_sunny" />
        <StatCard label="Total Lunches"    value={totL} color={THEME.lunchClr}     icon="light_mode" />
        <StatCard label="Total Suppers"    value={totS} color={THEME.supperClr}    icon="bedtime" />
        <StatCard label="Grand Total"      value={totB+totL+totS} color={THEME.primary} icon="groups" />
      </div>

      <div style={{ borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`, overflow: 'visible', background: '#fff' }}>
        {loading
          ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
          : <ReportTable rows={rows} isRange contractors={contractors} />
        }
      </div>
    </div>
  )
}

// ── Monthly Report ────────────────────────────────────────────────────────────
export function MonthlyReport() {
  const [month,       setMonth]       = useState(new Date().getMonth())
  const [year,        setYear]        = useState(new Date().getFullYear())
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [summary,     setSummary]     = useState({})
  const [loading,     setLoading]     = useState(false)

  useEffect(() => {
    supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').eq('status','active').order('name')
      .then(({ data }) => setEmployees(data || []))
    supabase.from('contractors').select('*').then(({ data }) => setContractors(data || []))
  }, [])

  useEffect(() => { load() }, [month, year])

  async function load() {
    setLoading(true)
    const pad = n => String(n).padStart(2,'0')
    const prefix = `${year}-${pad(month+1)}`
    const { data: logs } = await supabase.from('meal_logs').select('*').gte('date',`${prefix}-01`).lte('date',`${prefix}-31`)
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
      <PrintHeader
        title="Monthly Meal Report"
        subtitle={`${MONTHS[month]} ${year}`}
      />

      <div className="no-print" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>Monthly Report</h2>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
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
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Breakfasts"  value={totB} color={THEME.breakfastClr} icon="wb_sunny" sub={`${MONTHS[month]} ${year}`} />
        <StatCard label="Lunches"     value={totL} color={THEME.lunchClr}     icon="light_mode" />
        <StatCard label="Suppers"     value={totS} color={THEME.supperClr}    icon="bedtime" />
        <StatCard label="Grand Total" value={totB+totL+totS} color={THEME.primary} icon="groups" />
      </div>

      <div style={{ borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`, overflow: 'visible', background: '#fff' }}>
        {loading
          ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
          : <ReportTable rows={rows} isRange contractors={contractors} />
        }
      </div>
    </div>
  )
}
