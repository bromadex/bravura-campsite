import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn2, finInput, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { useAskContext } from '../../components/AskBravura'
import { exportCsv } from '../../utils/csv'

// FL01 — Fleet dashboard "Yard control" (user 26 Sep: own look, not the finance layout). A dark control band with
// availability, the live yard count and alerts; then the yard itself — every machine a tile in its lane (Working ·
// Standby · Workshop · Down) with a fuel-burn meter against expected; then service due, costliest machines, fuel trend.
// Data: fleet_home(site). Tab "Cost per machine" = fleet_machine_costs.
const n = v => Number(v || 0)
const k = v => { const a = Math.abs(n(v)); return a >= 1e6 ? `$${(n(v) / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(n(v) / 1e3).toFixed(1)}k` : `$${n(v).toFixed(0)}` }
const Y = { night: '#0F1C1A', night2: '#16302B', line: 'rgba(255,255,255,.10)', text: '#E8F1EE', dim: '#9DB5AE',
  go: '#2FBF71', idle: '#8FA3A0', shop: '#F2A93B', down: '#E5484D', accent: '#5EEAD4' }
const LANES = [
  ['working', 'Working', Y.go, ['operational']],
  ['standby', 'Standby', Y.idle, ['standby']],
  ['shop', 'In workshop', Y.shop, ['maintenance', 'awaiting_parts']],
  ['down', 'Down', Y.down, ['grounded']],
]
const laneOf = s => LANES.find(l => l[3].includes(s)) || LANES[0]
const card = { background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: 18, padding: 18 }
const h3 = { margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '.01em', color: THEME.text }
const sub = { fontSize: 12, color: THEME.textMed, marginTop: 2 }

function Ring({ pct }) {
  const r = 52, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, n(pct)))
  const col = v >= 85 ? Y.go : v >= 70 ? Y.shop : Y.down
  return (
    <svg width="132" height="132" viewBox="0 0 132 132" role="img" aria-label={`Availability ${v}%`}>
      <circle cx="66" cy="66" r={r} fill="none" stroke={Y.line} strokeWidth="12" />
      <circle cx="66" cy="66" r={r} fill="none" stroke={col} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 66 66)" />
      <text x="66" y="66" textAnchor="middle" fontSize="30" fontWeight="800" fill={Y.text}>{pct != null ? `${Math.round(v)}%` : '—'}</text>
      <text x="66" y="86" textAnchor="middle" fontSize="11" fill={Y.dim} letterSpacing="1.5">AVAILABLE</text>
    </svg>
  )
}

function Spark({ rows }) {
  if (!rows?.length) return <div style={{ ...sub }}>No fuel issued yet</div>
  const W = 320, H = 90, max = Math.max(1, ...rows.map(r => n(r.litres)))
  const pts = rows.map((r, i) => [rows.length === 1 ? W / 2 : (i / (rows.length - 1)) * (W - 20) + 10, H - 10 - (n(r.litres) / max) * (H - 30)])
  const line = pts.map(p => p.join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Fuel litres per month">
      <polygon points={`${pts[0][0]},${H - 10} ${line} ${pts[pts.length - 1][0]},${H - 10}`} fill={MODULE_COLORS.fleet} opacity=".12" />
      <polyline points={line} fill="none" stroke={MODULE_COLORS.fleet} strokeWidth="2.5" strokeLinejoin="round" />
      {pts.map((p, i) => <g key={i}><circle cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 5 : 3} fill={MODULE_COLORS.fleet} />
        <text x={p[0]} y={H + 12} textAnchor="middle" fontSize="10" fill={THEME.textMed}>{rows[i].month}</text>
        {i === pts.length - 1 && <text x={p[0]} y={p[1] - 9} textAnchor="end" fontSize="11" fontWeight="700" fill={THEME.text}>{n(rows[i].litres).toLocaleString()} L</text>}</g>)}
    </svg>
  )
}

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

  const board = d?.board || []
  const counts = useMemo(() => Object.fromEntries(LANES.map(l => [l[0], board.filter(r => laneOf(r.status)[0] === l[0]).length])), [board])
  if (!can('fleet.view')) return <Denied />
  const c = d?.chips || {}, f = d?.figures || {}
  const alerts = [
    [c.down_now, 'down now', Y.down, 'fleet_maintenance'], [c.service_overdue, 'services overdue', Y.down, 'fleet_preventive'],
    [c.failed_prestarts, 'failed pre-starts', Y.shop, 'fleet_prestart'], [c.open_faults, 'open faults', Y.shop, 'fleet_prestart'],
    [c.papers_30, 'papers expiring', Y.shop, 'fleet_compliance'], [c.contracts_due, 'contracts to renew', Y.shop, 'fleet_contracts'],
    [c.open_jobs, 'open jobs', Y.accent, 'fleet_maintenance'], [c.service_soon, 'services soon', Y.accent, 'fleet_preventive'],
    [c.no_reading_7d, 'no km/hours in 7 d', Y.dim, 'fleet_meter_readings'],
  ].filter(x => n(x[0]) > 0)
  const total = board.filter(r => r.status !== 'decommissioned').length || 1

  const Tabs = (
    <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,.06)', padding: 4, borderRadius: 12, border: `1px solid ${Y.line}` }}>
      {[['overview', 'Overview'], ['costs', 'Cost per machine']].map(([key, l]) => (
        <button key={key} onClick={() => setTab(key)} style={{ border: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700, padding: '7px 14px', borderRadius: 9,
          background: tab === key ? Y.accent : 'transparent', color: tab === key ? Y.night : Y.text }}>{l}</button>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: 16, fontFamily: 'inherit' }}>
      {/* control band */}
      <div style={{ background: `radial-gradient(120% 140% at 0% 0%, ${Y.night2} 0%, ${Y.night} 60%)`, color: Y.text, borderRadius: 22, padding: 20,
        border: `1px solid ${Y.night2}`, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: '.18em', color: Y.accent, fontWeight: 700 }}>FLEET · YARD CONTROL</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 2 }}>{total} machines on site</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {Tabs}
            {(can('fleet.create') || can('fleet.edit')) && <button onClick={() => setPage('fleet_prestart')} style={{ border: `1px solid ${Y.line}`, background: 'transparent', color: Y.text,
              borderRadius: 11, padding: '8px 14px', font: 'inherit', fontWeight: 700, cursor: 'pointer' }}>Pre-start</button>}
            {can('fleet.edit') && <button onClick={() => setPage('fleet_maintenance')} style={{ border: 'none', background: Y.accent, color: Y.night,
              borderRadius: 11, padding: '8px 14px', font: 'inherit', fontWeight: 800, cursor: 'pointer' }}>Workshop jobs</button>}
          </div>
        </div>
        {tab === 'overview' && d && (
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 20, alignItems: 'center' }} className="yard-top">
            <Ring pct={f.availability_30} />
            <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
              <div style={{ display: 'flex', height: 14, borderRadius: 8, overflow: 'hidden', background: Y.line }} aria-label="Machines by status">
                {LANES.map(l => counts[l[0]] ? <div key={l[0]} title={`${l[1]}: ${counts[l[0]]}`} style={{ width: `${(counts[l[0]] / total) * 100}%`, background: l[2] }} /> : null)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                {LANES.map(l => (
                  <button key={l[0]} onClick={() => setPage('fleet_assets')} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: Y.text,
                    background: 'transparent', border: `1px solid ${Y.line}`, borderRadius: 12, padding: '8px 12px' }}>
                    <div style={{ fontSize: 26, fontWeight: 800, color: l[2], lineHeight: 1.1 }}>{counts[l[0]]}</div>
                    <div style={{ fontSize: 12, color: Y.dim }}>{l[1]}</div>
                  </button>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, fontSize: 12, color: Y.dim }}>
                <div><b style={{ color: Y.text, fontSize: 16 }}>{f.utilisation_30 != null ? `${f.utilisation_30}%` : '—'}</b><br />used in 30 days</div>
                <div><b style={{ color: Y.text, fontSize: 16 }}>{n(f.fuel_month_litres).toLocaleString()} L</b><br />fuel this month · ${money(f.fuel_month_cost)}</div>
                <div><b style={{ color: Y.text, fontSize: 16 }}>{f.cost_per_hour_30 != null ? `$${money(f.cost_per_hour_30)}/h` : '—'}</b><br />running cost per hour</div>
                <div><b style={{ color: Y.text, fontSize: 16 }}>{k(f.running_cost_30)}</b><br />running cost, 30 days</div>
                <div><b style={{ color: Y.text, fontSize: 16 }}>{k(f.book_value)}</b><br />book value · {f.capitalised || 0}/{f.machines || 0} capitalised</div>
              </div>
            </div>
          </div>
        )}
        {tab === 'overview' && d && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {alerts.length === 0 ? <span style={{ fontSize: 13, color: Y.go }}>● All clear — nothing needs attention</span>
              : alerts.map(([v, t, col, page]) => (
                <button key={t} onClick={() => setPage(page)} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer', font: 'inherit',
                  background: 'rgba(255,255,255,.05)', border: `1px solid ${Y.line}`, color: Y.text, borderRadius: 999, padding: '6px 12px 6px 6px', fontSize: 13 }}>
                  <span style={{ minWidth: 24, height: 24, borderRadius: 999, background: col, color: Y.night, fontWeight: 800, display: 'inline-grid', placeItems: 'center', padding: '0 6px' }}>{v}</span>{t}
                </button>
              ))}
          </div>
        )}
      </div>

      {tab === 'costs' ? <div style={card}><MachineCosts siteId={currentSiteId} /></div> : !d ? <div style={{ ...card, color: THEME.textMed }}>Loading…</div> : <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          <div style={card}>
            <h3 style={h3}>Service countdown</h3><div style={sub}>Share of the service interval used — km, hours or days, whichever is first</div>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              {(d.service_due || []).length === 0 ? <div style={sub}>Nothing due — or no service plans yet.</div> : d.service_due.map(s => {
                const p = n(s.pct_used), col = s.state === 'overdue' ? Y.down : Y.shop
                return (
                  <div key={`${s.asset_id}${s.plan_id}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, gap: 8 }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.asset_label} <span style={{ color: THEME.textMed, fontWeight: 400 }}>· {s.plan_name}</span></span>
                      <b style={{ color: col }}>{p}%</b>
                    </div>
                    <div style={{ height: 8, background: THEME.surfaceVar, borderRadius: 4, marginTop: 4 }}><div style={{ width: `${Math.min(100, p)}%`, height: '100%', borderRadius: 4, background: col }} /></div>
                    <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 2 }}>{s.open_wo_number ? `Job ${s.open_wo_number} open` : 'No job raised yet'}</div>
                  </div>
                )
              })}
            </div>
          </div>
          <div style={card}>
            <h3 style={h3}>Where the money goes</h3><div style={sub}>Costliest machines, 30 days — fuel + parts + workshop bills</div>
            <div style={{ marginTop: 12 }}>
              {(d.top_cost || []).length === 0 ? <div style={sub}>No costs in the last 30 days.</div> : (() => {
                const max = Math.max(...d.top_cost.map(x => n(x.cost)), 1)
                return d.top_cost.map((x, i) => (
                  <div key={x.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 10, alignItems: 'center', margin: '8px 0', fontSize: 13 }}>
                    <span style={{ fontWeight: 800, color: i < 3 ? MODULE_COLORS.fleet : THEME.textLow }}>{i + 1}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={x.machine}>{x.machine}</div>
                      <div style={{ height: 6, background: THEME.surfaceVar, borderRadius: 3, marginTop: 3 }}><div style={{ width: `${(n(x.cost) / max) * 100}%`, height: '100%', background: MODULE_COLORS.fleet, borderRadius: 3 }} /></div>
                    </div>
                    <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}><b>${money(x.cost)}</b>{x.per_hour ? <div style={{ fontSize: 11, color: THEME.textMed }}>${money(x.per_hour)}/h</div> : null}</span>
                  </div>
                ))
              })()}
            </div>
          </div>
          <div style={card}>
            <h3 style={h3}>Fuel burn</h3><div style={sub}>Litres issued to machines, last 6 months</div>
            <div style={{ marginTop: 10 }}><Spark rows={d.fuel_trend || []} /></div>
          </div>
        </div>
      </>}
      <style>{`@media (max-width: 640px) { .yard-top { grid-template-columns: 1fr !important; justify-items: center; } }`}</style>
    </div>
  )
}

const th = { textAlign: 'left', padding: '8px 8px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
const thr = { ...th, textAlign: 'right' }
const td = { padding: '8px 8px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 13, verticalAlign: 'top' }
const tdr = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

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
