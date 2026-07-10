import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../hooks/usePermissions'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, Card, Button, TableWrap, THead, Th, TRow, Td, showToast } from '../../components/ui'

const CLR = MODULE_COLORS.meals

const fmtMoney = n => n == null ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function firstOfMonth(dISO) { return dISO.slice(0, 8) + '01' }
function todayISO() { return new Date().toISOString().slice(0, 10) }

function exportCsv(filename, headers, rows) {
  const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

function buildJournalLines({ perContractor, mappings, siteName, periodEnd }) {
  const lines = []
  const expAcct = mappings.meal_expense     || { account_code: '', account_name: 'Meal Expense' }
  const payAcct = mappings.accounts_payable || { account_code: '', account_name: 'Accounts Payable' }

  let grandTotal = 0
  for (const c of perContractor) {
    if (!c.total) continue
    lines.push({
      date:         periodEnd,
      account_code: expAcct.account_code,
      account_name: expAcct.account_name || 'Meal Expense',
      description:  `Meal expense — ${c.name}`,
      debit:        c.total,
      credit:       null,
      site:         siteName,
      contractor:   c.name,
    })
    grandTotal += c.total
  }
  if (grandTotal > 0) {
    lines.push({
      date:         periodEnd,
      account_code: payAcct.account_code,
      account_name: payAcct.account_name || 'Accounts Payable',
      description:  'Meal expense — supplier payable',
      debit:        null,
      credit:       grandTotal,
      site:         siteName,
      contractor:   '',
    })
  }
  return lines
}

export default function MealFinanceExport() {
  const { can } = usePermissions()
  const { currentSite, currentSiteId } = useSite()

  const [from, setFrom] = useState(firstOfMonth(todayISO()))
  const [to,   setTo]   = useState(todayISO())
  const [loading, setLoading] = useState(false)
  const [perContractor, setPerContractor] = useState([])
  const [prices, setPrices] = useState(null)
  const [mappings, setMappings] = useState({})
  const [mappingsLoaded, setMappingsLoaded] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('meals_finance_mapping')
      .select('mapping_type, account_code, account_name')
      .eq('site_id', currentSiteId)
      .then(({ data }) => {
        const m = {}
        for (const r of (data || [])) m[r.mapping_type] = r
        setMappings(m)
        setMappingsLoaded(true)
      })
  }, [currentSiteId])

  const run = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)

    const [{ data: employees }, { data: contractors }, { data: priceRow }] = await Promise.all([
      supabase.from('employees').select('id, contractor_id').eq('site_id', currentSiteId).eq('status', 'active'),
      supabase.from('contractors').select('id, name'),
      supabase.from('meal_prices').select('*').eq('site_id', currentSiteId).lte('effective_date', to).order('effective_date', { ascending: false }).limit(1),
    ])
    const price = priceRow?.[0] || null
    setPrices(price)
    const empIds = (employees || []).map(e => e.id)
    const empToCo = {}
    for (const e of (employees || [])) empToCo[e.id] = e.contractor_id

    let logs = []
    if (empIds.length > 0) {
      const { data } = await supabase
        .from('meal_logs')
        .select('employee_id, had_breakfast, had_lunch, had_supper, date')
        .in('employee_id', empIds)
        .gte('date', from).lte('date', to)
      logs = data || []
    }

    // Fetch day-of-week overrides (e.g. Saturday supper special)
    const { data: overrideRows } = await supabase
      .from('meal_price_overrides')
      .select('effective_date, day_of_week, meal_type, price_usd')
      .eq('site_id', currentSiteId)
      .eq('is_active', true)
      .lte('effective_date', to)
      .order('effective_date', { ascending: false })

    function priceFor(dateStr, mealType) {
      const dow = new Date(dateStr + 'T00:00:00').getDay()
      const ov = (overrideRows || []).find(o =>
        o.day_of_week === dow && o.meal_type === mealType && o.effective_date <= dateStr
      )
      if (ov) return Number(ov.price_usd)
      return Number(price?.[`${mealType}_usd`] || 0)
    }

    const byCo = new Map()
    for (const c of (contractors || [])) {
      byCo.set(c.id, { id: c.id, name: c.name, b: 0, l: 0, s: 0, total: 0 })
    }
    for (const log of logs) {
      const cid = empToCo[log.employee_id]
      const row = byCo.get(cid)
      if (!row) continue
      if (log.had_breakfast) { row.b++; row.total += priceFor(log.date, 'breakfast') }
      if (log.had_lunch)     { row.l++; row.total += priceFor(log.date, 'lunch') }
      if (log.had_supper)    { row.s++; row.total += priceFor(log.date, 'supper') }
    }
    const arr = [...byCo.values()].filter(r => (r.b + r.l + r.s) > 0).sort((a, b) => b.total - a.total)
    setPerContractor(arr)
    setLoading(false)
  }, [currentSiteId, from, to])

  const journal = useMemo(
    () => buildJournalLines({ perContractor, mappings, siteName: currentSite?.name || '', periodEnd: to }),
    [perContractor, mappings, currentSite?.name, to],
  )

  const totals = useMemo(() => ({
    debit:  journal.reduce((s, l) => s + (l.debit  || 0), 0),
    credit: journal.reduce((s, l) => s + (l.credit || 0), 0),
  }), [journal])

  const balanced = Math.abs(totals.debit - totals.credit) < 0.005
  const missingCodes = mappingsLoaded
    ? ['meal_expense', 'accounts_payable'].filter(t => !mappings[t]?.account_code)
    : []

  function doExport() {
    if (!journal.length) return
    exportCsv(
      `meal-journal-${from}-to-${to}.csv`,
      ['Date', 'Account Code', 'Account Name', 'Description', 'Debit', 'Credit', 'Site', 'Contractor'],
      journal.map(l => [
        l.date, l.account_code || '', l.account_name || '', l.description,
        l.debit  != null ? l.debit.toFixed(2)  : '',
        l.credit != null ? l.credit.toFixed(2) : '',
        l.site, l.contractor,
      ]),
    )
    showToast(`Exported ${journal.length} journal lines`, 'green')
  }

  const inp = { padding: '8px 12px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit', height: '36px' }

  // Permission gate lives AFTER every hook so the hook count is stable
  // across renders (early-returning before hooks crashes React when the
  // permission changes mid-session).
  if (!can('meals.approve')) return (
    <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>
      <Icon name="lock" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      Access denied — requires meals approve permission.
    </div>
  )

  return (
    <div style={{ maxWidth: '1150px', margin: '0 auto' }}>
      <PageHeader
        title="Meal Finance Export"
        site={currentSite}
        actions={
          <Button variant="filled" icon="download" onClick={doExport} disabled={!journal.length || !balanced} style={{ background: CLR, borderColor: CLR }}>
            Export Journal CSV
          </Button>
        }
      >
        <div style={{ fontSize: '12px', color: THEME.textMed }}>
          Journal entries aggregating consumed meals by contractor for the period. Debit line per contractor, one credit line total to Accounts Payable — ready for Finance import.
        </div>
      </PageHeader>

      {mappingsLoaded && missingCodes.length > 0 && (
        <Card style={{ borderColor: THEME.warning + '55', background: THEME.statusWarningBg, marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <Icon name="warning" size={18} style={{ color: THEME.warning, flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '13px', color: THEME.statusWarningText }}>
              <div style={{ fontWeight: 700 }}>Account codes are missing</div>
              <div style={{ marginTop: '2px' }}>
                Configure {missingCodes.join(', ')} in <b>Meals → Meal Providers / Settings → Finance Account Mapping</b> before exporting.
              </div>
            </div>
          </div>
        </Card>
      )}

      {!prices && perContractor.length > 0 && (
        <Card style={{ borderColor: THEME.error + '55', background: THEME.statusErrorBg, marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <Icon name="error" size={18} style={{ color: THEME.error, flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '13px', color: THEME.statusErrorText }}>
              No meal prices configured for this site. Set prices in Pricing Management before exporting.
            </div>
          </div>
        </Card>
      )}

      {/* Controls */}
      <Card style={{ marginBottom: '18px', padding: '14px 18px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>Period from</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inp} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em' }}>Period to</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={inp} />
          </div>
          <Button variant="filled" icon="playlist_add_check" onClick={run} disabled={loading} style={{ background: CLR, borderColor: CLR }}>
            {loading ? 'Building…' : 'Build Preview'}
          </Button>
        </div>
      </Card>

      {journal.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '18px' }}>
          <MiniStat label="Journal Lines" value={journal.length} />
          <MiniStat label="Contractors"   value={perContractor.length} />
          <MiniStat label="Total Debit"   value={fmtMoney(totals.debit)}  color={CLR} />
          <MiniStat label="Total Credit"  value={fmtMoney(totals.credit)} color={balanced ? CLR : THEME.error} sub={balanced ? 'Balanced' : 'Out of balance'} />
        </div>
      )}

      {journal.length > 0 && (
        <TableWrap style={{ marginBottom: '20px' }}>
          <THead>
            <Th>Date</Th>
            <Th>Account</Th>
            <Th>Description</Th>
            <Th align="right">Debit</Th>
            <Th align="right">Credit</Th>
            <Th>Contractor</Th>
          </THead>
          <tbody>
            {journal.map((l, i) => (
              <TRow key={i} last={i === journal.length - 1}>
                <Td style={{ whiteSpace: 'nowrap', color: THEME.textMed }}>{l.date}</Td>
                <Td>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{l.account_code || <span style={{ color: THEME.error }}>—</span>}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow }}>{l.account_name}</div>
                </Td>
                <Td style={{ color: THEME.textMed }}>{l.description}</Td>
                <Td align="right" style={{ color: l.debit  ? CLR         : THEME.textLow, fontWeight: l.debit  ? 600 : 400 }}>{l.debit  != null ? fmtMoney(l.debit)  : '—'}</Td>
                <Td align="right" style={{ color: l.credit ? THEME.info  : THEME.textLow, fontWeight: l.credit ? 600 : 400 }}>{l.credit != null ? fmtMoney(l.credit) : '—'}</Td>
                <Td style={{ color: THEME.textMed }}>{l.contractor || '—'}</Td>
              </TRow>
            ))}
            <tr style={{ background: THEME.surfaceVar, borderTop: `2px solid ${THEME.outlineVar}` }}>
              <td colSpan={3} style={{ padding: '10px 14px', fontWeight: 700, color: THEME.text }}>Totals</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: CLR }}>{fmtMoney(totals.debit)}</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: THEME.info }}>{fmtMoney(totals.credit)}</td>
              <td style={{ padding: '10px 14px' }} />
            </tr>
          </tbody>
        </TableWrap>
      )}

      {journal.length === 0 && !loading && (
        <Card style={{ textAlign: 'center', padding: '40px' }}>
          <Icon name="receipt_long" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: '13px', color: THEME.textMed }}>
            Pick a period and click <b>Build Preview</b> to generate meal journal entries.
          </div>
        </Card>
      )}
    </div>
  )
}

function MiniStat({ label, value, color, sub }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 600, color: color || THEME.text, marginTop: '4px', letterSpacing: '-.01em' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: color || THEME.textLow, marginTop: '2px', fontWeight: 500 }}>{sub}</div>}
    </Card>
  )
}
