import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, PageHeader, showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.procurement
const usd = n => n == null || Number(n) === 0 ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const pct = n => n == null ? '—' : `${Number(n).toFixed(0)}%`
const field = { minHeight: '40px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit', fontSize: '14px' }
const th = { padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }

function scoreColor(s) {
  if (s == null) return THEME.textLow
  return s >= 90 ? THEME.statusSuccessText : s >= 75 ? THEME.statusWarningText : THEME.error
}

export default function ProcSupplierPerformance() {
  const { currentSiteId } = useSite()
  const [tab, setTab] = useState('aging')
  const [aging, setAging] = useState(null)
  const [cards, setCards] = useState(null)
  const y = new Date().getFullYear()
  const [from, setFrom] = useState(`${y}-01-01`)
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))

  useEffect(() => {
    if (!currentSiteId) return
    supabase.rpc('proc_supplier_aging', { p_site_id: currentSiteId }).then(({ data, error }) => { if (error) showToast(error.message, 'red'); setAging(data || []) })
  }, [currentSiteId])
  useEffect(() => {
    if (!currentSiteId) return
    setCards(null)
    supabase.rpc('proc_supplier_scorecard', { p_site_id: currentSiteId, p_from: from, p_to: to }).then(({ data, error }) => { if (error) showToast(error.message, 'red'); setCards(data || []) })
  }, [currentSiteId, from, to])

  const sum = k => (aging || []).reduce((s, r) => s + Number(r[k] || 0), 0)
  const BUCKETS = [['not_due', 'Not yet due'], ['d1_30', '1–30 days'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90_plus', '90+ days']]

  return (
    <div>
      <PageHeader title="Supplier Performance" />
      <div role="tablist" style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {[['aging', 'What we owe (aging)'], ['cards', 'Scorecards']].map(([k, t]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{ ...field, cursor: 'pointer', fontWeight: 600,
            background: tab === k ? ACCENT : THEME.surface, color: tab === k ? '#fff' : THEME.textMed, border: `1px solid ${tab === k ? ACCENT : THEME.outline}` }}>{t}</button>
        ))}
      </div>

      {tab === 'aging' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px', marginBottom: '12px' }}>
            {BUCKETS.map(([k, t]) => (
              <Card key={k} style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{t}</div>
                <div style={{ fontSize: '18px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: k === 'd90_plus' && sum(k) > 0 ? THEME.error : THEME.text }}>{usd(sum(k)) === '—' ? '$0' : usd(sum(k))}</div>
              </Card>
            ))}
          </div>
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            {!aging ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : aging.length === 0 ? (
              <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No unpaid supplier invoices.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '760px' }}>
                <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed }}>
                  <th style={{ ...th, textAlign: 'left' }}>Supplier</th><th style={th}>Invoices</th>
                  {BUCKETS.map(([k, t]) => <th key={k} style={th}>{t}</th>)}<th style={th}>Total</th></tr></thead>
                <tbody>{aging.map(r => (
                  <tr key={r.supplier_id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                    <td style={{ ...td, textAlign: 'left' }}>{r.supplier_name}</td><td style={td}>{r.invoices}</td>
                    {BUCKETS.map(([k]) => <td key={k} style={{ ...td, color: k === 'd90_plus' && Number(r[k]) > 0 ? THEME.error : THEME.text }}>{usd(r[k])}</td>)}
                    <td style={{ ...td, fontWeight: 700 }}>{usd(r.total)}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {tab === 'cards' && (
        <>
          <Card style={{ padding: '12px 14px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="sc-from" style={{ fontSize: '13px', color: THEME.textMed }}>Orders from</label>
            <input id="sc-from" type="date" style={field} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
            <label htmlFor="sc-to" style={{ fontSize: '13px', color: THEME.textMed }}>to</label>
            <input id="sc-to" type="date" style={field} value={to} onChange={e => e.target.value && setTo(e.target.value)} />
            {cards?.length > 0 && <Button variant="outlined" icon="download" style={{ marginLeft: 'auto' }} onClick={() => exportCsv(`supplier_scorecards_${from}_${to}.csv`,
              ['Supplier', 'Orders', 'Spend', 'Deliveries', 'On time %', 'Quality %', 'Avg lead days', 'Quotes', 'Won', 'Score'],
              cards.map(c => [c.supplier_name, c.orders, c.spend, c.deliveries, c.on_time_pct, c.quality_pct, c.avg_lead_days, c.quotes, c.quotes_won, c.score]))}>CSV</Button>}
          </Card>
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            {!cards ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : cards.length === 0 ? (
              <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No orders or quotes in this period.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '820px' }}>
                <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed }}>
                  <th style={{ ...th, textAlign: 'left' }}>Supplier</th><th style={th}>Score</th><th style={th}>Orders</th><th style={th}>Spend</th>
                  <th style={th}>On time</th><th style={th}>Quality</th><th style={th}>Avg lead</th><th style={th}>Quotes won</th></tr></thead>
                <tbody>{cards.map(c => (
                  <tr key={c.supplier_id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                    <td style={{ ...td, textAlign: 'left' }}>{c.supplier_name}</td>
                    <td style={{ ...td, fontWeight: 700, color: scoreColor(c.score) }}>{c.score ?? '—'}</td>
                    <td style={td}>{c.orders}</td><td style={td}>{usd(c.spend)}</td>
                    <td style={td}>{pct(c.on_time_pct)}</td><td style={td}>{pct(c.quality_pct)}</td>
                    <td style={td}>{c.avg_lead_days != null ? `${Number(c.avg_lead_days).toFixed(1)} d` : '—'}</td>
                    <td style={td}>{c.quotes ? `${c.quotes_won}/${c.quotes}` : '—'}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </Card>
          <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '8px' }}>
            On time = goods received on or before the order's expected date. Quality = share of received quantity not rejected at the GRN. Score = average of the two.
          </div>
        </>
      )}
    </div>
  )
}
