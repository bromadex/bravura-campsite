import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import Denied from '../../components/Denied'
import ProcShell, { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn2, finInput, money } from '../../utils/financeTheme'
import { exportCsv } from '../../utils/csv'

// PR06 — Procurement reports (issue #57). One screen, one picker; every report exports to CSV.
const REPORTS = [
  ['not_ordered', 'Requested, not ordered', 'Request lines still waiting for a purchase order'],
  ['not_received', 'Ordered, not received', 'Order lines still to arrive, with due dates and days late'],
  ['tracker', 'Procurement tracker', 'Request → order → received → billed → paid, per PO'],
  ['item_history', 'Purchase history per item', 'How often, how much, lowest / highest / last price'],
  ['by_supplier', 'Spend by supplier', 'Ordered and received value per supplier'],
  ['by_site', 'Spend by site', 'Ordered and received value per site'],
  ['by_category', 'Spend by category', 'Ordered value per stock category (services separately)'],
  ['on_time', 'Supplier delivery performance', 'On-time %, average days late, confirmation rate'],
]
const iso = d => d.toISOString().slice(0, 10)

export default function ProcReports({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const sc = useSiteScope()
  const [kind, setKind] = useState('not_received')
  const [from, setFrom] = useState(() => iso(new Date(new Date().getFullYear(), 0, 1)))
  const [to, setTo] = useState(() => iso(new Date()))
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!sc.siteIds.length) return
    let live = true
    setData(null); setErr(null)
    supabase.rpc('proc_report', { p_kind: kind, p_site_ids: sc.siteIds, p_from: from, p_to: to }).then(({ data, error }) => {
      if (!live) return
      if (error) setErr(error.message); else setData(data)
    })
    return () => { live = false }
  }, [kind, from, to, sc.siteIds])

  if (!can('procurement.view')) return <Denied />
  const meta = REPORTS.find(r => r[0] === kind)
  const isMoney = c => /\$/.test(c)
  const cell = (v, col) => v == null ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : isMoney(col) && !isNaN(v) ? `$${money(v)}` : String(v)

  return (
    <ProcShell title="Procurement reports" subtitle={meta[2]} setPage={setPage} siteText={sc.label}
      actions={<>
        <SiteScopeToggle {...sc} siteName={sc.sites.find(s => s.id === currentSiteId)?.name} />
        <button style={finBtn2} disabled={!data?.rows?.length} onClick={() => exportCsv(`${kind}_${from}_${to}.csv`, data.columns, data.rows)}>Export CSV</button>
      </>}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {REPORTS.map(([k, label]) => (
          <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} style={{ minHeight: 34, padding: '0 12px', borderRadius: 17, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            ...(kind === k ? { border: 'none', background: FIN.maroon, color: '#fff' } : { border: `1px solid ${FIN.field}`, background: '#fff', color: FIN.ink }) }}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'end' }}>
        <label style={{ fontSize: 12, color: FIN.muted }}>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...finInput, display: 'block', marginTop: 4 }} /></label>
        <label style={{ fontSize: 12, color: FIN.muted }}>To<input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...finInput, display: 'block', marginTop: 4 }} /></label>
      </div>
      {err && <div role="alert" style={{ ...finCard, color: FIN.bad }}>{err}</div>}
      {!data && !err ? <div style={{ ...finCard, color: FIN.faint }}>Loading…</div> : data && (data.rows.length === 0 ? (
        <div style={{ ...finCard, color: FIN.muted }}>Nothing for this period.</div>
      ) : (
        <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
            <thead><tr>{data.columns.map((c, i) => <th key={c} style={{ padding: '10px 12px', textAlign: i === 0 ? 'left' : 'right', color: FIN.muted, fontSize: 12, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>
            <tbody>{data.rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${FIN.lineSoft}` }}>
                {r.map((v, j) => <td key={j} style={{ padding: '8px 12px', textAlign: j === 0 ? 'left' : 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: j === 0 ? 'normal' : 'nowrap' }}>{cell(v, data.columns[j])}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
    </ProcShell>
  )
}
