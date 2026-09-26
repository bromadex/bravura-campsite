import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { useAskContext } from '../../components/AskBravura'
import { exportCsv } from '../../utils/csv'

// FU01 — Fuel dashboard (issue #73, F5) in the finance look, from fuel_home(site): what needs attention, tanks with days of
// cover and reorder point, month figures, 30-day trend, top users with L/h against expected, and the month's charge-out
// by department / cost centre / project (taken from each machine).
const n = v => Number(v || 0)
const L = v => `${Math.round(n(v)).toLocaleString()} L`
const h3 = { margin: '0 0 10px', fontFamily: FIN.serif, fontSize: 18, fontWeight: 600 }
const th = { textAlign: 'left', padding: '8px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
const thr = { ...th, textAlign: 'right' }
const td = { padding: '8px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 13, verticalAlign: 'top' }
const tdr = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

function Kpi({ label, value, sub, tone }) {
  return (
    <div style={{ ...finCard, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: FIN.muted, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontFamily: FIN.serif, fontSize: 26, fontWeight: 600, color: tone || FIN.ink, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FIN.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Trend({ rows }) {
  if (!rows?.length) return null
  const max = Math.max(1, ...rows.map(r => n(r.litres)))
  const W = 600, H = 120, bw = W / rows.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} style={{ width: '100%', height: 150 }} role="img" aria-label="Litres issued per day, last 30 days">
      <line x1="0" y1={H} x2={W} y2={H} stroke={FIN.line} />
      {rows.map((r, i) => {
        const h = (n(r.litres) / max) * (H - 8)
        return <rect key={r.day} x={i * bw + 2} y={H - h} width={bw - 4} height={h} rx="2" fill={i === rows.length - 1 ? FIN.maroon : FIN.blue} opacity={n(r.litres) ? 0.85 : 0.2}>
          <title>{r.day}: {L(r.litres)}</title></rect>
      })}
      <text x="0" y={H + 14} fontSize="11" fill={FIN.muted}>{rows[0].day.slice(5)}</text>
      <text x={W} y={H + 14} fontSize="11" fill={FIN.muted} textAnchor="end">today</text>
      <text x="2" y="10" fontSize="11" fill={FIN.muted}>{L(max)}</text>
    </svg>
  )
}

export default function FuelHome({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [d, setD] = useState(null)
  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.rpc('fuel_home', { p_site: currentSiteId })
    if (error) { showToast(friendlyError(error), 'red'); setD({}); return }
    setD(data)
  }, [currentSiteId])
  useEffect(() => { load() }, [load])

  useAskContext(d ? { screen: 'Fuel dashboard', needs_attention: d.chips, figures: d.figures, stock: d.stock, tanks: d.tanks, top_users: d.top_users, charge_out: d.charge_out }
    : { screen: 'Fuel dashboard' })

  if (!can('fuel.view') && !can('fuel.create')) return <Denied />
  const c = d?.chips || {}, f = d?.figures || {}, s = d?.stock || {}
  const chips = [
    [c.tanks_to_reorder, 'tanks to reorder', FIN.bad, 'fuel_tanks'],
    [c.gaps_to_explain, 'dip gaps to explain or sign off', FIN.bad, 'fuel_reconciliation'],
    [c.no_dip_2d, 'tanks not dipped since yesterday', FIN.ochreText, 'fuel_dips'],
    [c.allowances_80, 'allowances at 80%+', FIN.ochreText, 'fuel_allowances'],
    [c.open_shifts, 'pump shifts left open', FIN.ochreText, 'fuel_reconciliation'],
    [c.recharges, 'hired-plant fills to charge back', FIN.blue, 'fuel_allowances'],
    [c.fills_no_meter_7d, 'fills without km/hours this week', FIN.muted, 'fuel_issues'],
    [c.machines_no_dept, 'machines with no department or cost centre', FIN.muted, 'fleet_assets'],
  ].filter(x => n(x[0]) > 0)
  const change = f.last_month_litres ? Math.round(100 * (n(f.month_litres) / n(f.last_month_litres) - 1)) : null

  return (
    <FinShell module="Fuel" homePage="fuel_dashboard" setPage={setPage} title="Fuel"
      actions={<>
        {can('fuel.create') && <button style={finBtn2} onClick={() => setPage('fuel_dips')}>Record dip</button>}
        {can('fuel.create') && <button style={finBtn} onClick={() => setPage('fuel_pump')}>Issue fuel</button>}
      </>}>
      {!d ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chips.length === 0 ? <div style={{ ...finCard, padding: '10px 14px', color: FIN.good, fontSize: 14 }}>Nothing needs attention.</div>
            : chips.map(([v, text, color, page]) => (
              <button key={text} onClick={() => setPage(page)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '10px 14px', borderRadius: 12,
                border: `1px solid ${FIN.line}`, background: FIN.card, cursor: 'pointer', font: 'inherit', color: FIN.ink }}>
                <strong style={{ fontSize: 20, fontFamily: FIN.serif, color }}>{v}</strong><span style={{ fontSize: 13 }}>{text}</span>
              </button>
            ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Kpi label="In the tanks" value={L(s.litres)} sub={`$${money(s.value)} at $${n(s.cost_per_litre).toFixed(2)}/L`} />
          <Kpi label="Issued this month" value={L(f.month_litres)} sub={`$${money(f.month_cost)}${change != null ? ` · ${change > 0 ? '+' : ''}${change}% vs last month (${L(f.last_month_litres)})` : ''}`} />
          <Kpi label="Last 30 days" value={L(f.litres_30)} sub={`${n(f.fills_30)} fills · ${n(f.machines_30)} machines`} />
          <Kpi label="Dip gaps, 30 days" value={`${n(s.gap_30d) > 0 ? '+' : ''}${L(s.gap_30d)}`}
            sub={n(s.issued_30d) ? `${(100 * n(s.gap_30d) / n(s.issued_30d)).toFixed(1)}% of issues` : ''} tone={Math.abs(n(s.gap_30d)) > 240 ? FIN.bad : FIN.ink} />
          <Kpi label="Last price" value={d.last_price ? `$${n(d.last_price).toFixed(2)}/L` : '—'} sub="latest delivery" />
        </div>

        <div style={finCard}>
          <h3 style={h3}>Tanks</h3>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Tank</th><th style={thr}>Level</th><th style={th}>Full</th><th style={thr}>Use / day</th><th style={thr}>Days of cover</th>
              <th style={thr}>Dip gaps 30 d</th><th style={th}>Reorder</th></tr></thead>
            <tbody>{(d.tanks || []).map(t => (
              <tr key={t.tank_id}>
                <td style={td}>{t.tank}<div style={{ fontSize: 11, color: FIN.faint }}>{t.method === 'dipstick' ? `dipped ${t.last_dip_date || '—'}` : 'running total'}</div></td>
                <td style={tdr}>{L(t.book_level)}<div style={{ fontSize: 11, color: FIN.faint }}>of {L(t.capacity)}</div></td>
                <td style={{ ...td, minWidth: 120 }}>
                  <div style={{ height: 8, background: FIN.lineSoft, borderRadius: 4 }}><div style={{ width: `${Math.min(100, n(t.pct_full))}%`, height: '100%', borderRadius: 4, background: t.reorder ? FIN.bad : FIN.blue }} /></div>
                  <div style={{ fontSize: 11, color: FIN.faint }}>{n(t.pct_full)}%</div></td>
                <td style={tdr}>{L(t.use_per_day)}</td>
                <td style={{ ...tdr, color: t.reorder ? FIN.bad : FIN.ink, fontWeight: t.reorder ? 700 : 400 }}>{t.days_cover ?? '—'}</td>
                <td style={{ ...tdr, color: Math.abs(n(t.gap_30d)) > n(t.tolerance) ? FIN.bad : FIN.ink }}>{t.gap_30d == null ? '—' : `${n(t.gap_30d) > 0 ? '+' : ''}${L(t.gap_30d)}`}</td>
                <td style={td}>{t.reorder ? <span style={{ color: FIN.bad }}>Order about {L(t.order_litres)}</span> : <span style={{ color: FIN.faint }}>below {d.reorder_days} days</span>}
                  {t.reorder && can('procurement.create') && <button onClick={() => setPage('proc_orders')} style={{ ...finBtn2, marginLeft: 8, padding: '4px 10px', fontSize: 12 }}>Order</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
          <div style={finCard}><h3 style={h3}>Litres issued per day</h3><Trend rows={d.trend} /></div>
          <div style={finCard}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={h3}>Charged out this month</h3>
              <button style={{ ...finBtn2, padding: '4px 10px', fontSize: 12 }} onClick={() => exportCsv('fuel-charge-out.csv',
                ['Department', 'Cost centre', 'Project', 'Litres', 'Cost'], (d.charge_out || []).map(r => [r.department, r.cost_centre, r.project, r.litres, r.cost]))}>CSV</button>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Department</th><th style={th}>Cost centre</th><th style={thr}>Litres</th><th style={thr}>Cost</th></tr></thead>
              <tbody>{(d.charge_out || []).map((r, i) => (
                <tr key={i}><td style={{ ...td, color: r.department === 'No department' ? FIN.bad : FIN.ink }}>{r.department}{r.project !== '—' && <div style={{ fontSize: 11, color: FIN.faint }}>{r.project}</div>}</td>
                  <td style={td}>{r.cost_centre}</td><td style={tdr}>{L(r.litres)}</td><td style={tdr}>${money(r.cost)}</td></tr>
              ))}</tbody>
            </table>
            {(d.charge_out || []).some(r => r.department === 'No department') &&
              <div style={{ fontSize: 12, color: FIN.muted, marginTop: 8 }}>Give each machine a department and cost centre in Fleet → Machines; its fills follow it.</div>}
          </div>
        </div>

        <div style={finCard}>
          <h3 style={h3}>Top users, last 30 days</h3>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Machine</th><th style={thr}>Litres</th><th style={thr}>Cost</th><th style={thr}>Hours / km</th><th style={thr}>Use</th><th style={thr}>Expected</th></tr></thead>
            <tbody>{(d.top_users || []).map((r, i) => {
              const lph = r.litres_per_hour, exp = r.expected_lph, per100 = r.litres_per_100km, exp100 = r.expected_lp100
              const actual = lph != null ? `${n(lph).toFixed(1)} L/h` : per100 != null ? `${n(per100).toFixed(1)} L/100km` : '—'
              const expected = lph != null ? (exp ? `${n(exp).toFixed(1)} L/h` : '—') : per100 != null ? (exp100 ? `${n(exp100).toFixed(1)} L/100km` : '—') : '—'
              const over = (lph != null && exp && n(lph) > n(exp) * 1.15) || (per100 != null && exp100 && n(per100) > n(exp100) * 1.15)
              return (
                <tr key={i}><td style={td}>{r.machine}</td><td style={tdr}>{L(r.fuel_litres)}</td><td style={tdr}>${money(r.fuel_cost)}</td>
                  <td style={tdr}>{r.hours_run != null ? `${n(r.hours_run).toFixed(0)} h` : r.km_run != null ? `${n(r.km_run).toFixed(0)} km` : '—'}</td>
                  <td style={{ ...tdr, color: over ? FIN.bad : FIN.ink }}>{actual}</td><td style={tdr}>{expected}</td></tr>
              )
            })}</tbody>
          </table></div>
          <div style={{ fontSize: 12, color: FIN.faint, marginTop: 6 }}>Use needs km/hours at fills. Red = more than 15% over the machine's expected consumption.</div>
        </div>
      </>}
    </FinShell>
  )
}
