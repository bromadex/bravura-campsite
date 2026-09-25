import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, PageHeader, showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { exportCsv } from '../../utils/csv'

const FI = MODULE_COLORS.finance
const usd = n => (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const field = { minHeight: '40px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit', fontSize: '14px' }

export default function DimensionReport() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const y = new Date().getFullYear()
  const [dim, setDim] = useState('cost_centre')
  const [from, setFrom] = useState(`${y}-01-01`)
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [expensesOnly, setExpensesOnly] = useState(true)
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)

  useEffect(() => {
    if (!currentSiteId) return
    setRows(null)
    supabase.rpc('fi_dimension_report', { p_site_id: currentSiteId, p_from: from, p_to: to, p_dimension: dim }).then(({ data, error }) => {
      if (error) showToast(error.message, 'red')
      setRows(data || [])
    })
  }, [currentSiteId, from, to, dim])

  const groups = useMemo(() => {
    const g = {}
    for (const r of (rows || []).filter(r => !expensesOnly || r.account_type === 'Expense')) {
      const k = r.dim_id || 'none'
      g[k] = g[k] || { id: k, code: r.dim_code, name: r.dim_name || (dim === 'project' ? 'No project' : 'No cost centre'), total: 0, lines: [] }
      g[k].total += Number(r.net); g[k].lines.push(r)
    }
    return Object.values(g).sort((a, b) => (a.id === 'none') - (b.id === 'none') || b.total - a.total)
  }, [rows, expensesOnly, dim])
  const grand = groups.reduce((s, g) => s + g.total, 0)
  const max = Math.max(1, ...groups.map(g => Math.abs(g.total)))

  if (!can('finance.view')) return <Denied />

  return (
    <div style={{ maxWidth: '960px' }}>
      <PageHeader title="Costs by Cost Centre & Project" actions={groups.length > 0 && (
        <Button variant="outlined" icon="download" onClick={() => exportCsv(`costs_by_${dim}_${from}_${to}.csv`,
          [dim === 'project' ? 'Project' : 'Cost centre', 'Account code', 'Account', 'Type', 'Debit', 'Credit', 'Net'],
          groups.flatMap(g => g.lines.map(l => [g.name, l.account_code, l.account_name, l.account_type, l.debit, l.credit, l.net])))}>CSV</Button>
      )} />

      <Card style={{ padding: '12px 14px', marginBottom: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div role="tablist" style={{ display: 'flex', gap: '6px' }}>
          {[['cost_centre', 'By cost centre'], ['project', 'By project']].map(([k, t]) => (
            <button key={k} role="tab" aria-selected={dim === k} onClick={() => { setDim(k); setOpen(null) }} style={{ ...field, cursor: 'pointer', fontWeight: 600,
              background: dim === k ? FI : THEME.surface, color: dim === k ? '#fff' : THEME.textMed, border: `1px solid ${dim === k ? FI : THEME.outline}` }}>{t}</button>
          ))}
        </div>
        <label htmlFor="dr-from" style={{ fontSize: '13px', color: THEME.textMed }}>From</label>
        <input id="dr-from" type="date" style={field} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
        <label htmlFor="dr-to" style={{ fontSize: '13px', color: THEME.textMed }}>to</label>
        <input id="dr-to" type="date" style={field} value={to} onChange={e => e.target.value && setTo(e.target.value)} />
        <label htmlFor="dr-exp" style={{ fontSize: '13px', color: THEME.textMed, display: 'flex', gap: '6px', alignItems: 'center', marginLeft: 'auto' }}>
          <input id="dr-exp" type="checkbox" checked={expensesOnly} onChange={e => setExpensesOnly(e.target.checked)} /> Expense accounts only
        </label>
      </Card>

      {!rows ? <Card style={{ padding: '20px', color: THEME.textLow }}>Loading…</Card> : groups.length === 0 ? (
        <Card style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
          Nothing posted in this period. Tag purchase orders, work orders, fleet and fixed assets with a cost centre and project — their ledger postings carry the tags automatically.
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: THEME.surfaceVar, fontSize: '13px', color: THEME.textMed }}>
            <span>{groups.length} {dim === 'project' ? 'project' : 'cost centre'}{groups.length > 1 ? 's' : ''}</span>
            <span>Total <b style={{ color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{usd(grand)}</b></span>
          </div>
          {groups.map(g => (
            <div key={g.id} style={{ borderTop: `1px solid ${THEME.outlineVar}` }}>
              <button onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id} style={{ width: '100%', display: 'grid',
                gridTemplateColumns: 'minmax(160px, 1.2fr) 2fr auto', gap: '12px', alignItems: 'center', padding: '10px 14px', background: 'none',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: THEME.text }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: g.id === 'none' ? THEME.textMed : THEME.text }}>{g.code ? `${g.code} · ` : ''}{g.name}</span>
                <span style={{ height: '8px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${Math.abs(g.total) / max * 100}%`, background: g.id === 'none' ? THEME.outline : FI }} />
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, minWidth: '110px', textAlign: 'right' }}>{usd(g.total)}</span>
              </button>
              {open === g.id && (
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', marginBottom: '8px' }}>
                  <tbody>{g.lines.map(l => (
                    <tr key={l.account_id} style={{ color: THEME.textMed }}>
                      <td style={{ padding: '4px 14px 4px 28px' }}>{l.account_code} {l.account_name}</td>
                      <td style={{ padding: '4px 14px', fontSize: '11px' }}>{l.account_type}</td>
                      <td style={{ padding: '4px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{usd(l.net)}</td>
                    </tr>))}</tbody>
                </table>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
