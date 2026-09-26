import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { useAskContext } from '../../components/AskBravura'
import { exportCsv } from '../../utils/csv'

// FL01 — Fleet dashboard (issue #66, A5) in the finance look. Top: what needs me today. Then headline figures,
// a board of every machine, service due and the costliest machines. Tab "Cost per machine": fleet_machine_costs.
const n = v => Number(v || 0)
const k = v => { const a = Math.abs(n(v)); return a >= 1e6 ? `$${(n(v) / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(n(v) / 1e3).toFixed(1)}k` : `$${n(v).toFixed(0)}` }
const STATUS = {
  operational: ['Working', FIN.good, FIN.goodTint], standby: ['Standby', FIN.muted, FIN.lineSoft],
  maintenance: ['In workshop', FIN.ochreText, FIN.ochreTint], awaiting_parts: ['Waiting parts', FIN.ochreText, FIN.ochreTint],
  grounded: ['Grounded', FIN.bad, FIN.maroonTint], decommissioned: ['Retired', FIN.faint, FIN.lineSoft],
}
const h3 = { margin: 0, fontFamily: FIN.serif, fontSize: 18, fontWeight: 600 }
const th = { textAlign: 'left', padding: '8px 8px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
const thr = { ...th, textAlign: 'right' }
const td = { padding: '8px 8px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 13, verticalAlign: 'top' }
const tdr = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

export default function FleetHome({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [tab, setTab] = useState('overview')
  const [d, setD] = useState(null)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.rpc('fleet_home', { p_site_id: currentSiteId })
    if (error) { showToast(friendlyError(error), 'red'); setD({}); return }
    setD(data)
  }, [currentSiteId])
  useEffect(() => { load() }, [load])

  useAskContext(d ? { screen: 'Fleet dashboard', needs_attention: d.chips, figures_30_days: d.figures, costliest_machines: d.top_cost, service_due: d.service_due }
    : { screen: 'Fleet dashboard' })

  if (!can('fleet.view')) return <Denied />
  const c = d?.chips || {}, f = d?.figures || {}
  const chips = [
    [c.down_now, 'machines down now', FIN.bad, 'fleet_maintenance'],
    [c.service_overdue, 'services overdue', FIN.bad, 'fleet_preventive'],
    [c.failed_prestarts, 'failed pre-starts this week', FIN.ochreText, 'fleet_prestart'],
    [c.open_faults, 'open faults', FIN.ochreText, 'fleet_prestart'],
    [c.papers_30, 'papers expire in 30 days', FIN.ochreText, 'fleet_compliance'],
    [c.contracts_due, 'contracts to renew', FIN.ochreText, 'fleet_contracts'],
    [c.open_jobs, 'open workshop jobs', FIN.blue, 'fleet_maintenance'],
    [c.service_soon, 'services due soon', FIN.blue, 'fleet_preventive'],
    [c.no_reading_7d, 'machines with no km/hours in 7 days', FIN.muted, 'fleet_meter_readings'],
  ].filter(x => n(x[0]) > 0)

  return (
    <FinShell module="Fleet" homePage="fleet_dashboard" setPage={setPage} title="Fleet"
      tabs={[{ key: 'overview', label: 'Overview' }, { key: 'costs', label: 'Cost per machine' }]} tab={tab} onTab={setTab}
      actions={<>
        {(can('fleet.create') || can('fleet.edit')) && <button style={finBtn2} onClick={() => setPage('fleet_prestart')}>Pre-start check</button>}
        {can('fleet.edit') && <button style={finBtn} onClick={() => setPage('fleet_maintenance')}>Workshop jobs</button>}
      </>}>
      {tab === 'costs' ? <MachineCosts siteId={currentSiteId} /> : !d ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chips.length === 0 ? <div style={{ ...finCard, padding: '10px 14px', color: FIN.good, fontSize: 14 }}>Nothing needs attention in the fleet.</div>
            : chips.map(([v, text, color, page]) => (
              <button key={text} onClick={() => setPage(page)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '10px 14px', borderRadius: 12,
                border: `1px solid ${FIN.line}`, background: FIN.card, cursor: 'pointer', font: 'inherit', color: FIN.ink }}>
                <strong style={{ fontSize: 20, fontFamily: FIN.serif, color }}>{v}</strong><span style={{ fontSize: 13 }}>{text}</span>
              </button>
            ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          <Kpi label="Availability" value={f.availability_30 != null ? `${f.availability_30}%` : '—'} sub="last 30 days, from status history" />
          <Kpi label="Used" value={f.utilisation_30 != null ? `${f.utilisation_30}%` : '—'} sub={`of ${f.machines || 0} machines fuelled or run in 30 days`} />
          <Kpi label="Fuel this month" value={`${n(f.fuel_month_litres).toLocaleString()} L`} sub={`$${money(f.fuel_month_cost)}`} />
          <Kpi label="Cost per hour" value={f.cost_per_hour_30 != null ? `$${money(f.cost_per_hour_30)}` : '—'}
            sub={f.cost_per_hour_30 != null ? `${n(f.hours_30).toLocaleString()} h run in 30 days` : 'needs hour-meter readings'} />
          <Kpi label="Running cost, 30 days" value={k(f.running_cost_30)} sub="fuel + parts + workshop bills" />
          <Kpi label="Fleet book value" value={k(f.book_value)} sub={`${f.capitalised || 0} of ${f.machines || 0} in Fixed Assets`} warn={n(f.capitalised) < n(f.machines)} />
        </div>

        <div style={finCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <h3 style={h3}>Every machine</h3>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
              {Object.entries(STATUS).filter(([s]) => s !== 'decommissioned').map(([s, [l, fg]]) => <span key={s} style={{ color: fg }}>● {l}</span>)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: FIN.muted, margin: '2px 0 10px' }}>Litres per hour (or per 100 km) over the last 30 days against what it should use. Click a machine to open the list.</div>
          <Board rows={d.board || []} onOpen={() => setPage('fleet_assets')} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
          <div style={finCard}>
            <h3 style={h3}>Service due</h3>
            <div style={{ fontSize: 12, color: FIN.muted, margin: '2px 0 8px' }}>By km, hours or days — whichever comes first</div>
            {(d.service_due || []).length === 0 ? <Empty text="Nothing due — or no service plans yet (PM & Downtime)" /> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={th}>Machine</th><th style={th}>Service</th><th style={thr}>Used</th><th style={th}>Job</th></tr></thead>
                <tbody>{d.service_due.map(s => (
                  <tr key={`${s.asset_id}${s.plan_id}`}>
                    <td style={td}>{s.asset_label}</td><td style={td}>{s.plan_name}</td>
                    <td style={{ ...tdr, color: s.state === 'overdue' ? FIN.bad : FIN.ochreText, fontWeight: 600 }}>{s.pct_used}%</td>
                    <td style={td}>{s.open_wo_number || <span style={{ color: FIN.faint }}>none</span>}</td>
                  </tr>))}</tbody></table>
            )}
          </div>
          <div style={finCard}>
            <h3 style={h3}>Costliest machines, 30 days</h3>
            <div style={{ fontSize: 12, color: FIN.muted, margin: '2px 0 10px' }}>Fuel + Stores parts + workshop bills</div>
            {(d.top_cost || []).length === 0 ? <Empty text="No costs in the last 30 days" /> : (() => {
              const max = Math.max(...d.top_cost.map(x => n(x.cost)), 1)
              return d.top_cost.map(x => (
                <div key={x.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 180px) 1fr auto', gap: 10, alignItems: 'center', margin: '6px 0', fontSize: 13 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.machine}>{x.machine}</span>
                  <div style={{ height: 10, background: FIN.lineSoft, borderRadius: 5 }}><div style={{ width: `${(n(x.cost) / max) * 100}%`, height: '100%', background: FIN.blue, borderRadius: 5 }} /></div>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>${money(x.cost)}{x.per_hour ? <span style={{ color: FIN.muted }}> · ${money(x.per_hour)}/h</span> : null}</span>
                </div>
              ))
            })()}
          </div>
          <div style={finCard}>
            <h3 style={h3}>Fuel, 6 months</h3>
            <div style={{ fontSize: 12, color: FIN.muted, margin: '2px 0 10px' }}>Litres issued to machines per month</div>
            <FuelTrend rows={d.fuel_trend || []} />
          </div>
        </div>
      </>}
    </FinShell>
  )
}

function Kpi({ label, value, sub, warn }) {
  return (
    <div style={{ ...finCard, padding: '14px 16px' }}>
      <div style={{ fontSize: 12, color: FIN.muted }}>{label}</div>
      <div style={{ fontFamily: FIN.serif, fontSize: 26, fontWeight: 600, color: warn ? FIN.ochreText : FIN.ink, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FIN.faint, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}
const Empty = ({ text }) => <div style={{ color: FIN.faint, fontSize: 13, padding: '8px 0' }}>{text}</div>

function Board({ rows, onOpen }) {
  if (!rows.length) return <Empty text="No machines at this site" />
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
      {rows.map(r => {
        const [label, fg, bg] = STATUS[r.status] || STATUS.operational
        const use = r.lph != null ? [r.lph, r.expected_lph, 'L/h'] : r.lp100 != null ? [r.lp100, r.expected_lp100, 'L/100km'] : null
        const over = use && use[1] && n(use[0]) > n(use[1]) * 1.15
        return (
          <button key={r.id} onClick={onOpen} title={r.machine} style={{ textAlign: 'left', border: `1px solid ${FIN.line}`, borderLeft: `4px solid ${fg}`, background: bg,
            borderRadius: 10, padding: '8px 10px', cursor: 'pointer', font: 'inherit', color: FIN.ink, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.machine}</div>
            <div style={{ fontSize: 11, color: FIN.muted }}>{r.type || '—'} · <span style={{ color: fg }}>{label}</span></div>
            <div style={{ fontSize: 11, marginTop: 2, color: over ? FIN.bad : FIN.faint }}>
              {use ? `${use[0]} ${use[2]}${use[1] ? ` (expect ${use[1]})` : ''}` : 'no readings'}
              {r.service === 'overdue' ? <span style={{ color: FIN.bad }}> · service overdue</span> : r.service === 'due_soon' ? <span style={{ color: FIN.ochreText }}> · service soon</span> : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function FuelTrend({ rows }) {
  if (!rows.length) return <Empty text="No fuel issued yet" />
  const max = Math.max(...rows.map(r => n(r.litres)), 1)
  const W = 300, H = 120, bw = W / rows.length
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Litres per month">
      <line x1="0" x2={W} y1={H} y2={H} stroke={FIN.line} />
      {rows.map((r, i) => {
        const h = (n(r.litres) / max) * (H - 18)
        return <g key={r.month}>
          <rect x={i * bw + bw * 0.2} y={H - h} width={bw * 0.6} height={h} rx="3" fill={i === rows.length - 1 ? FIN.maroon : FIN.blue} />
          <text x={i * bw + bw / 2} y={H - h - 4} textAnchor="middle" fontSize="9" fill={FIN.muted}>{n(r.litres).toLocaleString()}</text>
          <text x={i * bw + bw / 2} y={H + 13} textAnchor="middle" fontSize="10" fill={FIN.muted}>{r.month}</text>
        </g>
      })}
    </svg>
  )
}

function MachineCosts({ siteId }) {
  const today = new Date().toISOString().slice(0, 10)
  const [from, setFrom] = useState(new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10))
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!siteId) return
    setRows(null)
    supabase.rpc('fleet_machine_costs', { p_site_id: siteId, p_from: from, p_to: to }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'red')
      setRows(data || [])
    })
  }, [siteId, from, to])
  const shown = useMemo(() => (rows || []).filter(r => !q || `${r.machine} ${r.machine_type}`.toLowerCase().includes(q.toLowerCase())), [rows, q])
  const tot = shown.reduce((s, r) => ({ fuel: s.fuel + n(r.fuel_cost), parts: s.parts + n(r.parts_cost), bills: s.bills + n(r.bills_cost), run: s.run + n(r.running_cost), hrs: s.hrs + n(r.hours_run) }),
    { fuel: 0, parts: 0, bills: 0, run: 0, hrs: 0 })
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...finCard, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 14px' }}>
        <label htmlFor="mc-from" style={{ fontSize: 13, color: FIN.muted }}>From</label>
        <input id="mc-from" type="date" style={finInput} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
        <label htmlFor="mc-to" style={{ fontSize: 13, color: FIN.muted }}>to</label>
        <input id="mc-to" type="date" style={finInput} value={to} max={today} onChange={e => e.target.value && setTo(e.target.value)} />
        <input id="mc-q" aria-label="Find a machine" placeholder="Find a machine…" style={{ ...finInput, flex: '1 1 160px' }} value={q} onChange={e => setQ(e.target.value)} />
        {shown.length > 0 && <button style={{ ...finBtn2, minHeight: 40 }} onClick={() => exportCsv(`fleet_costs_${from}_${to}.csv`,
          ['Machine', 'Type', 'Status', 'Litres', 'Fuel $', 'Parts $', 'Workshop bills $', 'Running cost $', 'Hours', 'Km', '$ per hour', '$ per km', 'L/h', 'Expected L/h', 'L/100km', 'Expected L/100km', 'Purchase cost', 'Book value', 'Lifetime running $', 'Total cost of ownership $'],
          shown.map(r => [r.machine, r.machine_type, r.status, r.fuel_litres, r.fuel_cost, r.parts_cost, r.bills_cost, r.running_cost, r.hours_run, r.km_run, r.cost_per_hour, r.cost_per_km,
            r.litres_per_hour, r.expected_lph, r.litres_per_100km, r.expected_lp100, r.purchase_cost, r.book_value, r.lifetime_running, r.tco]))}>CSV</button>}
      </div>
      <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
        {!rows ? <div style={{ padding: 16, color: FIN.faint }}>Loading…</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead><tr>
              <th style={th}>Machine</th><th style={thr}>Fuel</th><th style={thr}>Parts</th><th style={thr}>Workshop</th><th style={thr}>Running cost</th>
              <th style={thr}>Hours / km</th><th style={thr}>$ per hour</th><th style={thr}>$ per km</th><th style={thr}>Fuel use</th><th style={thr}>Book value</th><th style={thr}>Cost of ownership</th>
            </tr></thead>
            <tbody>{shown.map(r => {
              const use = r.litres_per_hour != null ? [r.litres_per_hour, r.expected_lph, 'L/h'] : r.litres_per_100km != null ? [r.litres_per_100km, r.expected_lp100, 'L/100km'] : null
              const over = use && use[1] && n(use[0]) > n(use[1]) * 1.15
              return (
                <tr key={r.asset_id}>
                  <td style={td}>{r.machine}<div style={{ fontSize: 12, color: FIN.faint }}>{r.machine_type || '—'}</div></td>
                  <td style={tdr}>${money(r.fuel_cost)}<div style={{ fontSize: 12, color: FIN.faint }}>{n(r.fuel_litres).toLocaleString()} L</div></td>
                  <td style={tdr}>${money(r.parts_cost)}</td><td style={tdr}>${money(r.bills_cost)}</td>
                  <td style={{ ...tdr, fontWeight: 600 }}>${money(r.running_cost)}</td>
                  <td style={tdr}>{r.hours_run != null ? `${n(r.hours_run).toLocaleString()} h` : ''}{r.hours_run != null && r.km_run != null ? ' · ' : ''}{r.km_run != null ? `${n(r.km_run).toLocaleString()} km` : ''}{r.hours_run == null && r.km_run == null ? <span style={{ color: FIN.faint }}>no readings</span> : null}</td>
                  <td style={tdr}>{r.cost_per_hour != null ? `$${money(r.cost_per_hour)}` : '—'}</td>
                  <td style={tdr}>{r.cost_per_km != null ? `$${money(r.cost_per_km)}` : '—'}</td>
                  <td style={{ ...tdr, color: over ? FIN.bad : FIN.ink }}>{use ? `${use[0]} ${use[2]}` : '—'}{use?.[1] ? <div style={{ fontSize: 12, color: FIN.faint }}>expect {use[1]}</div> : null}</td>
                  <td style={tdr}>{r.book_value != null ? `$${money(r.book_value)}` : <span style={{ color: FIN.faint }}>not capitalised</span>}</td>
                  <td style={tdr}>{r.tco != null ? `$${money(r.tco)}` : <span style={{ color: FIN.faint }}>needs purchase cost</span>}</td>
                </tr>
              )
            })}
              <tr><td style={{ ...td, fontWeight: 700 }}>Total</td><td style={{ ...tdr, fontWeight: 700 }}>${money(tot.fuel)}</td><td style={{ ...tdr, fontWeight: 700 }}>${money(tot.parts)}</td>
                <td style={{ ...tdr, fontWeight: 700 }}>${money(tot.bills)}</td><td style={{ ...tdr, fontWeight: 700 }}>${money(tot.run)}</td>
                <td style={{ ...tdr, fontWeight: 700 }}>{tot.hrs ? `${tot.hrs.toLocaleString()} h` : ''}</td>
                <td style={{ ...tdr, fontWeight: 700 }}>{tot.hrs ? `$${money(tot.run / tot.hrs)}` : ''}</td><td style={td} colSpan={4} /></tr>
            </tbody>
          </table>
        )}
      </div>
      <div style={{ fontSize: 12, color: FIN.faint }}>
        Running cost = fuel issued + parts issued from Stores to the machine's jobs + workshop bills on POs linked to its jobs. Hours and km come from meter readings
        (fuel fills, pre-starts) — flagged readings are left out. Cost of ownership = purchase cost + all running costs to date − book value (what it is still worth).
      </div>
    </div>
  )
}
