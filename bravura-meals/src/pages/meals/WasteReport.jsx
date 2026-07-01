import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../hooks/usePermissions'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, Card, Button, TableWrap, THead, Th, TRow, Td, showToast } from '../../components/ui'

const CLR = MODULE_COLORS.meals

const PERIODS = [
  { key: 'b', label: 'Breakfast', icon: 'wb_sunny' },
  { key: 'l', label: 'Lunch',     icon: 'light_mode' },
  { key: 's', label: 'Supper',    icon: 'bedtime' },
]

function firstOfMonth(dISO) {
  return dISO.slice(0, 8) + '01'
}
function todayISO() { return new Date().toISOString().slice(0, 10) }
function fmt(n, dec = 0) { return n == null ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) }

function exportCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function WasteReport() {
  const { can }     = usePermissions()
  const { currentSite, currentSiteId } = useSite()

  const [from, setFrom] = useState(firstOfMonth(todayISO()))
  const [to,   setTo]   = useState(todayISO())
  const [rows, setRows] = useState([])
  const [prices, setPrices] = useState(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data: subs }, { data: priceRow }] = await Promise.all([
      supabase.from('daily_submissions')
        .select('date, kitchen_count_b, kitchen_count_l, kitchen_count_s, prepared_b, prepared_l, prepared_s')
        .eq('site_id', currentSiteId)
        .gte('date', from).lte('date', to)
        .not('prepared_b', 'is', null)
        .order('date', { ascending: false }),
      supabase.from('meal_prices')
        .select('*')
        .eq('site_id', currentSiteId)
        .lte('effective_date', to)
        .order('effective_date', { ascending: false })
        .limit(1),
    ])
    setPrices(priceRow?.[0] || null)
    setRows(subs || [])
    setLoading(false)
  }, [currentSiteId, from, to])

  useEffect(() => { load() }, [load])

  const totals = useMemo(() => {
    let prep = { b: 0, l: 0, s: 0 }, served = { b: 0, l: 0, s: 0 }, waste = { b: 0, l: 0, s: 0 }
    let costWaste = 0
    for (const r of rows) {
      for (const k of ['b','l','s']) {
        const p = r[`prepared_${k}`] || 0
        const c = r[`kitchen_count_${k}`] || 0
        const w = Math.max(0, p - c)
        prep[k]   += p
        served[k] += c
        waste[k]  += w
      }
    }
    if (prices) {
      costWaste = waste.b * (prices.breakfast_usd || 0) + waste.l * (prices.lunch_usd || 0) + waste.s * (prices.supper_usd || 0)
    }
    const totalPrep = prep.b + prep.l + prep.s
    const totalWaste = waste.b + waste.l + waste.s
    return { prep, served, waste, costWaste, totalPrep, totalWaste, pct: totalPrep > 0 ? (totalWaste / totalPrep) * 100 : 0 }
  }, [rows, prices])

  function doExport() {
    if (!rows.length) return
    exportCsv(
      `meal-waste-${from}-to-${to}.csv`,
      ['Date', 'Breakfast Prepared', 'Breakfast Served', 'Breakfast Waste',
              'Lunch Prepared',     'Lunch Served',     'Lunch Waste',
              'Supper Prepared',    'Supper Served',    'Supper Waste',
              'Total Waste'],
      rows.map(r => {
        const cells = []
        cells.push(r.date)
        let tw = 0
        for (const k of ['b','l','s']) {
          const p = r[`prepared_${k}`] ?? 0
          const c = r[`kitchen_count_${k}`] ?? 0
          const w = Math.max(0, p - c)
          cells.push(p, c, w)
          tw += w
        }
        cells.push(tw)
        return cells
      }),
    )
    showToast(`Exported ${rows.length} days`, 'green')
  }

  const inp = { padding: '8px 12px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit', height: '36px' }

  return (
    <div style={{ maxWidth: '1150px', margin: '0 auto' }}>
      <PageHeader
        title="Waste Report"
        site={currentSite}
        actions={can('meals.view') && rows.length > 0 && (
          <Button icon="download" variant="outlined" onClick={doExport}>Export CSV</Button>
        )}
      >
        <div style={{ fontSize: '12px', color: THEME.textMed }}>
          Portions prepared minus portions served, per day and per meal. Only days where kitchen recorded portions prepared are included.
        </div>
      </PageHeader>

      {/* Controls */}
      <Card style={{ marginBottom: '16px', padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
          </div>
          <Button icon="refresh" variant="filled" onClick={load} disabled={loading} style={{ background: CLR, borderColor: CLR }}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </Card>

      {/* KPI summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <MiniStat label="Prepared"  value={totals.totalPrep}  color={THEME.text} />
        <MiniStat label="Served"    value={totals.prep.b + totals.prep.l + totals.prep.s - totals.totalWaste} color={THEME.success} />
        <MiniStat label="Waste"     value={totals.totalWaste} color={totals.pct > 15 ? THEME.error : THEME.warning} />
        <MiniStat label="Waste %"   value={fmt(totals.pct, 1) + '%'} color={totals.pct > 15 ? THEME.error : totals.pct > 5 ? THEME.warning : THEME.success} />
        {can('meals.approve') && prices && (
          <MiniStat label="Cost of waste" value={'$' + fmt(totals.costWaste, 2)} color={THEME.error} sub="using latest meal prices" />
        )}
      </div>

      {/* Per-period breakdown */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '18px' }}>
        {PERIODS.map(p => {
          const prep = totals.prep[p.key]
          const served = totals.served[p.key]
          const waste = totals.waste[p.key]
          const pct = prep > 0 ? (waste / prep) * 100 : 0
          const barColor = pct > 15 ? THEME.error : pct > 5 ? THEME.warning : THEME.success
          return (
            <Card key={p.key}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                <Icon name={p.icon} size={16} style={{ color: CLR }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{p.label}</span>
                <span style={{ marginLeft: 'auto', fontSize: '13px', fontWeight: 700, color: barColor }}>{fmt(pct, 1)}%</span>
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: THEME.textMed, marginBottom: '10px' }}>
                <span>Prepared <b style={{ color: THEME.text }}>{prep}</b></span>
                <span>Served <b style={{ color: THEME.text }}>{served}</b></span>
                <span>Waste <b style={{ color: barColor }}>{waste}</b></span>
              </div>
              <div style={{ height: '6px', borderRadius: '3px', background: THEME.outlineVar, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: barColor, transition: 'width .2s' }} />
              </div>
            </Card>
          )
        })}
      </div>

      {/* Detail table */}
      {rows.length === 0 && !loading ? (
        <Card style={{ textAlign: 'center', padding: '40px' }}>
          <Icon name="delete_sweep" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: '13px', color: THEME.textMed }}>No days with prepared-portion data in this range. Kitchen must record what was prepared at confirmation time.</div>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <Th>Date</Th>
            {PERIODS.flatMap(p => [
              <Th key={p.key + '_p'} align="right">{p.label.slice(0,1)} Prep</Th>,
              <Th key={p.key + '_s'} align="right">{p.label.slice(0,1)} Serve</Th>,
              <Th key={p.key + '_w'} align="right">{p.label.slice(0,1)} Waste</Th>,
            ])}
            <Th align="right">Total Waste</Th>
          </THead>
          <tbody>
            {rows.map((r, i) => {
              let totalWaste = 0
              return (
                <TRow key={r.date} last={i === rows.length - 1}>
                  <Td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.date}</Td>
                  {PERIODS.map(p => {
                    const prep = r[`prepared_${p.key}`] ?? 0
                    const served = r[`kitchen_count_${p.key}`] ?? 0
                    const w = Math.max(0, prep - served)
                    totalWaste += w
                    return [
                      <Td key={p.key + '_p'} align="right" style={{ color: THEME.textMed }}>{prep}</Td>,
                      <Td key={p.key + '_s'} align="right" style={{ color: THEME.textMed }}>{served}</Td>,
                      <Td key={p.key + '_w'} align="right" style={{ fontWeight: 600, color: w > 0 ? THEME.error : THEME.success }}>{w || '—'}</Td>,
                    ]
                  })}
                  <Td align="right" style={{ fontWeight: 700, color: totalWaste > 0 ? THEME.error : THEME.success }}>{totalWaste || '—'}</Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}
    </div>
  )
}

function MiniStat({ label, value, color, sub }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 600, color: color || THEME.text, marginTop: '4px', letterSpacing: '-.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{sub}</div>}
    </Card>
  )
}
