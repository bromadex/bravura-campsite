import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from '../contexts/SiteContext'
import { Card, Button, StatCard, showToast, fmtDate, today, MONTHS } from '../components/ui'
import { THEME } from '../utils/permissions'

export default function Billing() {
  const { currentSiteId } = useSite()
  const [tab,       setTab]       = useState('daily')
  const [dailyDate, setDailyDate] = useState(today())
  const [rangeStart,setRangeStart]= useState(() => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01` })
  const [rangeEnd,  setRangeEnd]  = useState(today())
  const [month,     setMonth]     = useState(new Date().getMonth())
  const [year,      setYear]      = useState(new Date().getFullYear())
  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(false)

  // Auto-load on tab/date/site change
  useEffect(() => { if (currentSiteId) loadBilling() }, [tab, dailyDate, rangeStart, rangeEnd, month, year, currentSiteId])

  async function loadBilling() {
    setLoading(true)
    setData(null)
    try {
      let start, end
      if (tab === 'daily') {
        start = dailyDate; end = dailyDate
      } else if (tab === 'range') {
        start = rangeStart; end = rangeEnd
      } else {
        const pad = n => String(n).padStart(2,'0')
        start = `${year}-${pad(month+1)}-01`
        end   = `${year}-${pad(month+1)}-31`
      }

      // daily_billing view has no site_id — query daily_submissions directly
      // scoped to the current site, then join meal_logs for counts.
      const [subsRes, pricesRes] = await Promise.all([
        supabase
          .from('daily_submissions')
          .select('id, date, status, meal_logs(had_breakfast, had_lunch, had_supper)')
          .eq('site_id', currentSiteId)
          .gte('date', start)
          .lte('date', end)
          .order('date', { ascending: false }),
        supabase
          .from('meal_prices')
          .select('effective_date, breakfast_usd, lunch_usd, supper_usd')
          .eq('site_id', currentSiteId)
          .lte('effective_date', end)
          .order('effective_date', { ascending: false }),
      ])

      if (subsRes.error) throw subsRes.error
      if (pricesRes.error) throw pricesRes.error

      const priceRows = pricesRes.data || []

      function priceFor(date) {
        const p = priceRows.find(r => r.effective_date <= date)
        return p || { breakfast_usd: 0, lunch_usd: 0, supper_usd: 0 }
      }

      const rows = (subsRes.data || []).map(sub => {
        const logs = sub.meal_logs || []
        const b = logs.filter(l => l.had_breakfast).length
        const l = logs.filter(l => l.had_lunch).length
        const s = logs.filter(l => l.had_supper).length
        const p = priceFor(sub.date)
        const cost = b * Number(p.breakfast_usd) + l * Number(p.lunch_usd) + s * Number(p.supper_usd)
        return {
          date: sub.date,
          status: sub.status,
          breakfast_count: b,
          lunch_count: l,
          supper_count: s,
          total_meals: b + l + s,
          breakfast_usd: p.breakfast_usd,
          lunch_usd: p.lunch_usd,
          supper_usd: p.supper_usd,
          total_cost_usd: cost.toFixed(2),
        }
      })

      const totals = rows.reduce((acc, row) => ({
        b:    acc.b    + row.breakfast_count,
        l:    acc.l    + row.lunch_count,
        s:    acc.s    + row.supper_count,
        cost: acc.cost + parseFloat(row.total_cost_usd),
      }), { b: 0, l: 0, s: 0, cost: 0 })

      setData({ rows, totals, start, end })
    } catch (err) {
      showToast('Error loading billing: ' + err.message, 'red')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 20px', fontSize: '17px', fontWeight: 700 }}>Billing</h2>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: '2px solid #dde2ea' }}>
        {[
          { id: 'daily',   label: 'Daily' },
          { id: 'range',   label: 'Date Range' },
          { id: 'monthly', label: 'Monthly' },
        ].map(t => (
          <div
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
              color: tab === t.id ? '#2F5496' : '#4a5568',
              borderBottom: `2px solid ${tab === t.id ? '#2F5496' : 'transparent'}`,
              marginBottom: '-2px', borderRadius: '8px 8px 0 0',
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Filter controls */}
      <Card style={{ marginBottom: '20px', padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {tab === 'daily' && (
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Date</label>
              <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)}
                style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }} />
            </div>
          )}
          {tab === 'range' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</label>
                <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>To</label>
                <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }} />
              </div>
            </>
          )}
          {tab === 'monthly' && (
            <>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Month</label>
                <select value={month} onChange={e => setMonth(parseInt(e.target.value))}
                  style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}>
                  {MONTHS.map((m,i) => <option key={i} value={i}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Year</label>
                <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} min="2020" max="2099"
                  style={{ width: '100px', padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }} />
              </div>
            </>
          )}
          <Button onClick={loadBilling} variant="primary">Refresh</Button>
          <Button onClick={() => window.print()} variant="ghost">🖨️ Print</Button>
        </div>
      </Card>

      {loading ? (
        <div style={{ color: THEME.textMed, padding: '40px', textAlign: 'center' }}>Calculating…</div>
      ) : !data ? null : (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
            <StatCard label="Breakfasts" value={data.totals.b} color="#C55A11" />
            <StatCard label="Lunches"    value={data.totals.l} color="#00897B" />
            <StatCard label="Suppers"    value={data.totals.s} color="#5E35B1" />
            <StatCard label="Total Meals" value={data.totals.b+data.totals.l+data.totals.s} color="#C00000" />
            <StatCard label="Total Cost"  value={`$${data.totals.cost.toFixed(2)}`} color={THEME.primary}
              sub={tab !== 'daily' ? `${data.rows.length} day(s)` : ''} />
          </div>

          {/* Per-day table (range / monthly) */}
          {tab !== 'daily' && data.rows.length > 1 && (
            <Card style={{ marginBottom: '20px' }}>
              <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textMed, marginBottom: '12px' }}>
                Daily Breakdown
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ background: THEME.primary, color: THEME.onPrimary }}>
                      <th style={{ padding: '8px 12px', textAlign: 'left' }}>Date</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Status</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Breakfast</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Lunch</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Supper</th>
                      <th style={{ padding: '8px 12px', textAlign: 'center' }}>Total Meals</th>
                      <th style={{ padding: '8px 12px', textAlign: 'right' }}>Cost (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(row => (
                      <tr key={row.date} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 600 }}>{fmtDate(row.date)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <span style={{
                            padding: '1px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                            background: row.status === 'approved' ? '#E2EFDA' : '#FFF2CC',
                            color: row.status === 'approved' ? '#375623' : '#7B5800',
                          }}>
                            {row.status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>{row.breakfast_count}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>{row.lunch_count}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>{row.supper_count}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700 }}>{row.total_meals}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: THEME.primary }}>
                          ${parseFloat(row.total_cost_usd || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                    {/* Grand total row */}
                    <tr style={{ background: THEME.primary, color: THEME.onPrimary, fontWeight: 700 }}>
                      <td colSpan={2} style={{ padding: '10px 12px' }}>Grand Total</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{data.totals.b}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{data.totals.l}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{data.totals.s}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{data.totals.b+data.totals.l+data.totals.s}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: '16px' }}>
                        ${data.totals.cost.toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Single day detail */}
          {tab === 'daily' && data.rows.length > 0 && (
            <Card>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
                {[
                  { label: 'Breakfast', count: data.rows[0].breakfast_count, price: data.rows[0].breakfast_usd, c: THEME.breakfastClr },
                  { label: 'Lunch',     count: data.rows[0].lunch_count,     price: data.rows[0].lunch_usd,     c: THEME.lunchClr },
                  { label: 'Supper',    count: data.rows[0].supper_count,    price: data.rows[0].supper_usd,    c: THEME.supperClr },
                ].map(x => (
                  <div key={x.label} style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: x.c }}>{x.count}</div>
                    <div style={{ fontSize: '12px', color: THEME.textMed }}>{x.label}</div>
                    <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>@ ${Number(x.price).toFixed(2)} each</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.primary, marginTop: '6px' }}>
                      = ${(x.count * x.price).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: 'right', marginTop: '16px', fontSize: '20px', fontWeight: 700, color: THEME.primary }}>
                Total: ${parseFloat(data.rows[0]?.total_cost_usd || 0).toFixed(2)}
              </div>
            </Card>
          )}

          {data.rows.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>
              No billing data found for the selected period.
            </div>
          )}
        </>
      )}
    </div>
  )
}
