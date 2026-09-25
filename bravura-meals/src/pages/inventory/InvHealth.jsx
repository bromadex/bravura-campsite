import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { useSiteScope, SiteScopeToggle } from '../../components/ProcShell'
import { FIN, finCard, finBtn2, finInput, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { exportCsv } from '../../utils/csv'
import { useAskContext } from '../../components/AskBravura'

// IN23 — Stock health (issue #59, I5): ageing, dead stock, ABC, shrinkage, usage and count accuracy from inv_report().
const iso = d => d.toISOString().slice(0, 10)
const n = v => Number(v || 0)
const q = v => n(v).toLocaleString('en-US', { maximumFractionDigits: 3 })
const $ = v => `$${money(v)}`

const REPORTS = {
  ageing: { label: 'Ageing', help: 'Stock on hand by how long ago the store last took it in.', dates: false,
    cols: [['description', 'Item'], ['store', 'Store'], ['on_hand', 'On hand', q], ['value', 'Value', $], ['last_in', 'Last in', d => d ? new Date(d).toLocaleDateString('en-GB') : '—'], ['bucket', 'Age']],
    total: 'value', groupBy: 'bucket' },
  dead: { label: 'Dead stock', help: 'Stock that has not gone out since the "from" date.', dates: 'from',
    cols: [['description', 'Item'], ['store', 'Store'], ['on_hand', 'On hand', q], ['value', 'Value', $], ['idle_days', 'Days idle']], total: 'value' },
  abc: { label: 'ABC', help: 'Items ranked by value issued: A = top 70% of value, B = next 20%, C = the rest.', dates: true,
    cols: [['abc', 'Class'], ['description', 'Item'], ['used_qty', 'Used', q], ['used_value', 'Used value', $], ['share_pct', 'Share %'], ['on_hand_value', 'On hand', $]],
    total: 'used_value', groupBy: 'abc' },
  shrinkage: { label: 'Shrinkage', help: 'Losses and gains that are not issues: counts, adjustments, damaged returns, short deliveries.', dates: true,
    cols: [['date', 'Date'], ['store', 'Store'], ['description', 'Item'], ['qty', 'Qty', q], ['value', 'Value', $], ['reason', 'Why'], ['by_whom', 'By']],
    total: 'value', groupBy: 'reason' },
  usage: { label: 'Usage', help: 'What was issued, to whom, net of returns.', dates: true,
    cols: [['used_by', 'Used by'], ['work_order', 'Work order'], ['description', 'Item'], ['qty', 'Qty', q], ['value', 'Value', $]], total: 'value', groupBy: 'used_by' },
  counts: { label: 'Counts', help: 'Posted counts and how close the books were.', dates: true,
    cols: [['reference', 'Count'], ['store', 'Store'], ['completed', 'Posted'], ['counted_value', 'Counted', $], ['variance_value', 'Difference', $], ['accuracy_pct', 'Accuracy %'], ['lines_off', 'Lines off']],
    total: 'variance_value' },
}

export default function InvHealth({ setPage }) {
  const { can } = usePermissions()
  const { scope, setScope, siteIds, multi, label } = useSiteScope()
  const [kind, setKind] = useState('ageing')
  const [from, setFrom] = useState(iso(new Date(Date.now() - 90 * 864e5)))
  const [to, setTo] = useState(iso(new Date()))
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const R = REPORTS[kind]

  const load = useCallback(async () => {
    if (!siteIds.length) return
    setLoading(true)
    const { data, error } = await supabase.rpc('inv_report', { p_kind: kind, p_site_ids: siteIds, p_from: from, p_to: to })
    setLoading(false)
    if (error) return showToast(friendlyError(error), 'red')
    if (data?.error) return showToast(data.error, 'red')
    setRows(data?.rows || [])
  }, [kind, siteIds, from, to])
  useEffect(() => { load() }, [load])

  const groups = useMemo(() => {
    if (!R.groupBy) return []
    const g = {}
    for (const r of rows) { const k = r[R.groupBy] || '—'; g[k] = (g[k] || 0) + n(r[R.total]) }
    return Object.entries(g).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  }, [rows, R])
  const total = rows.reduce((s, r) => s + n(r[R.total]), 0)
  useAskContext({ screen: `Stock health — ${R.label}`, sites: label, from, to, total: Math.round(total * 100) / 100, groups: Object.fromEntries(groups), rows: rows.slice(0, 40) })

  if (!can('inventory.view') && !can('procurement.view')) return <Denied />
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
  const td = { padding: '7px 10px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 13 }
  const numeric = c => c[2] === q || c[2] === $ || /pct|days|lines_off/.test(c[0])

  return (
    <FinShell module="Stores" homePage="inv_dashboard" setPage={setPage} title="Stock health" siteText={label}
      actions={<>
        <SiteScopeToggle scope={scope} setScope={setScope} multi={multi} />
        <button style={finBtn2} onClick={() => exportCsv(`stock_${kind}.csv`, R.cols.map(c => c[1]), rows.map(r => R.cols.map(c => r[c[0]] ?? '')))}>Export CSV</button>
      </>}
      tabs={Object.entries(REPORTS).map(([key, r]) => ({ key, label: r.label }))} tab={kind} onTab={setKind}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ fontSize: 13, color: FIN.muted, flex: '1 1 280px' }}>{R.help}</div>
        {R.dates && <label style={{ fontSize: 12, color: FIN.muted }}>{R.dates === 'from' ? 'Nothing out since' : 'From'}<br /><input id="health-from" type="date" value={from} onChange={e => setFrom(e.target.value)} style={finInput} /></label>}
        {R.dates === true && <label style={{ fontSize: 12, color: FIN.muted }}>To<br /><input id="health-to" type="date" value={to} onChange={e => setTo(e.target.value)} style={finInput} /></label>}
      </div>

      {groups.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          {groups.slice(0, 6).map(([k, v]) => (
            <div key={k} style={{ ...finCard, padding: '12px 14px' }}>
              <div style={{ fontSize: 12, color: FIN.muted, textTransform: kind === 'abc' ? 'none' : 'capitalize' }}>{kind === 'abc' ? `Class ${k}` : k}</div>
              <div style={{ fontSize: 20, fontFamily: FIN.serif, fontWeight: 600, color: v < 0 ? FIN.bad : FIN.ink }}>{$(v)}</div>
              <div style={{ fontSize: 12, color: FIN.faint }}>{rows.filter(r => (r[R.groupBy] || '—') === k).length} lines</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{R.cols.map(c => <th key={c[0]} style={{ ...th, textAlign: numeric(c) ? 'right' : 'left' }}>{c[1]}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={R.cols.length} style={{ ...td, textAlign: 'center', padding: 32, color: FIN.faint }}>Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={R.cols.length} style={{ ...td, textAlign: 'center', padding: 32, color: FIN.faint }}>Nothing to show for this period</td></tr>
              : rows.slice(0, 500).map((r, i) => (
                <tr key={i}>{R.cols.map(c => (
                  <td key={c[0]} style={{ ...td, textAlign: numeric(c) ? 'right' : 'left', color: c[0] === 'value' && n(r.value) < 0 ? FIN.bad : FIN.ink }}>
                    {c[0] === 'description' ? <>{r.description}<div style={{ fontSize: 11, color: FIN.faint }}>{r.item_code}</div></> : c[2] ? c[2](r[c[0]]) : (r[c[0]] ?? '—')}
                  </td>
                ))}</tr>
              ))}
          </tbody>
          {rows.length > 0 && <tfoot><tr><td colSpan={R.cols.length} style={{ ...td, fontWeight: 600, textAlign: 'right', borderBottom: 'none' }}>{rows.length} lines · total {$(total)}</td></tr></tfoot>}
        </table>
      </div>
    </FinShell>
  )
}
