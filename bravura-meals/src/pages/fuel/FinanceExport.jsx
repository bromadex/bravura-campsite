import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, TableWrap, THead, Th, TRow, Td, Card, Button, showToast } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const fmtMoney = n => n == null ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function exportCsv(filename, headers, rows) {
  const lines = [
    headers.join(','),
    ...rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// A journal line is one leg of a journal entry (debit XOR credit populated).
function buildJournalLines({ deliveries, allocations, mappings, siteName }) {
  const lines = []
  const stockAcct  = mappings.fuel_stock       || { account_code: '', account_name: '' }
  const expAcct    = mappings.fuel_expense     || { account_code: '', account_name: '' }
  const payAcct    = mappings.accounts_payable || { account_code: '', account_name: '' }

  // Deliveries: Dr Fuel Stock, Cr Accounts Payable
  for (const d of deliveries) {
    const total = Number(d.litres || 0) * Number(d.unit_price || 0)
    if (total <= 0) continue
    const desc = `Fuel delivery ${d.transaction_number || d.id?.slice(0, 8)} — ${d.fuel_type_name || 'fuel'}`
    lines.push({
      date:        d.transaction_date,
      account_code: stockAcct.account_code,
      account_name: stockAcct.account_name || 'Fuel Stock',
      description: desc,
      debit:       total,
      credit:      null,
      site:        siteName,
      department:  '',
    })
    lines.push({
      date:        d.transaction_date,
      account_code: payAcct.account_code,
      account_name: payAcct.account_name || 'Accounts Payable',
      description: desc,
      debit:       null,
      credit:      total,
      site:        siteName,
      department:  '',
    })
  }

  // Period-close expense allocation: Dr Fuel Expense (by dept), Cr Fuel Stock
  const totalExp = allocations.reduce((s, a) => s + (a.total || 0), 0)
  for (const a of allocations) {
    if (!a.total) continue
    const desc = `Fuel consumed — ${a.department_name || 'unallocated'}`
    lines.push({
      date:        a.period_end,
      account_code: expAcct.account_code,
      account_name: expAcct.account_name || 'Fuel Expense',
      description: desc,
      debit:       a.total,
      credit:      null,
      site:        siteName,
      department:  a.department_name || '',
    })
  }
  if (totalExp > 0 && allocations.length) {
    lines.push({
      date:        allocations[0].period_end,
      account_code: stockAcct.account_code,
      account_name: stockAcct.account_name || 'Fuel Stock',
      description: 'Period-close fuel expense allocation',
      debit:       null,
      credit:      totalExp,
      site:        siteName,
      department:  '',
    })
  }

  return lines
}

export default function FinanceExport() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  if (!can('fuel.reports.export') && !can('fuel.edit')) return (
    <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>
      <Icon name="lock" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      Access denied — requires fuel reports export permission.
    </div>
  )

  const today = new Date().toISOString().slice(0, 10)
  const firstOfMonth = today.slice(0, 8) + '01'

  const [from, setFrom]           = useState(firstOfMonth)
  const [to, setTo]               = useState(today)
  const [loading, setLoading]     = useState(false)
  const [deliveries, setDeliveries] = useState([])
  const [allocations, setAllocations] = useState([])
  const [mappings, setMappings]   = useState({})
  const [mappingsLoaded, setMappingsLoaded] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('fuel_finance_mapping')
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

    const [dRes, aRes] = await Promise.all([
      supabase
        .from('fuel_transactions')
        .select('id, transaction_number, transaction_date, litres, unit_price, fuel_types(name)')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
        .eq('transaction_type', 'delivery')
        .gte('transaction_date', from)
        .lte('transaction_date', to)
        .order('transaction_date', { ascending: true }),
      supabase
        .from('fuel_transactions')
        .select('id, transaction_date, litres, unit_price, fleet_asset:fleet_assets(department_id, departments(name))')
        .eq('site_id', currentSiteId)
        .eq('is_deleted', false)
        .eq('transaction_type', 'issuance')
        .gte('transaction_date', from)
        .lte('transaction_date', to),
    ])

    const deliveries = (dRes.data || []).map(d => ({
      ...d,
      fuel_type_name: d.fuel_types?.name,
    }))

    // Group issuances by department
    const byDept = new Map()
    for (const t of (aRes.data || [])) {
      const deptName = t.fleet_asset?.departments?.name || 'Unallocated'
      const deptId = t.fleet_asset?.department_id || null
      const cost = Number(t.litres || 0) * Number(t.unit_price || 0)
      if (!byDept.has(deptId)) byDept.set(deptId, { department_id: deptId, department_name: deptName, litres: 0, total: 0, period_end: to })
      const row = byDept.get(deptId)
      row.litres += Number(t.litres || 0)
      row.total += cost
    }

    setDeliveries(deliveries)
    setAllocations([...byDept.values()].sort((a, b) => b.total - a.total))
    setLoading(false)
  }, [currentSiteId, from, to])

  const journal = useMemo(
    () => buildJournalLines({ deliveries, allocations, mappings, siteName: currentSite?.name || '' }),
    [deliveries, allocations, mappings, currentSite?.name],
  )

  const totals = useMemo(() => ({
    debit:  journal.reduce((s, l) => s + (l.debit  || 0), 0),
    credit: journal.reduce((s, l) => s + (l.credit || 0), 0),
  }), [journal])

  const balanced = Math.abs(totals.debit - totals.credit) < 0.005

  const missingCodes = mappingsLoaded
    ? ['fuel_stock', 'fuel_expense', 'accounts_payable'].filter(t => !mappings[t]?.account_code)
    : []

  function doExport() {
    if (!journal.length) return
    exportCsv(
      `fuel-journal-${from}-to-${to}.csv`,
      ['Date', 'Account Code', 'Account Name', 'Description', 'Debit', 'Credit', 'Site', 'Department'],
      journal.map(l => [
        l.date, l.account_code || '', l.account_name || '', l.description,
        l.debit != null ? l.debit.toFixed(2) : '',
        l.credit != null ? l.credit.toFixed(2) : '',
        l.site, l.department,
      ]),
    )
    showToast(`Exported ${journal.length} journal lines`, 'green')
  }

  const inp = { padding: '8px 12px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit', height: '36px' }

  return (
    <div style={{ maxWidth: '1150px', margin: '0 auto' }}>
      <PageHeader
        title="Finance Export"
        site={currentSite}
        actions={
          <Button variant="filled" icon="download" onClick={doExport} disabled={!journal.length || !balanced}>
            Export Journal CSV
          </Button>
        }
      >
        <div style={{ fontSize: '12px', color: THEME.textMed }}>
          Journal entries for fuel deliveries and period-close consumption, ready for import into the Finance / Accounting module.
        </div>
      </PageHeader>

      {/* Warnings */}
      {mappingsLoaded && missingCodes.length > 0 && (
        <Card style={{ borderColor: THEME.warning + '55', background: THEME.statusWarningBg, marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
            <Icon name="warning" size={18} style={{ color: THEME.warning, flexShrink: 0, marginTop: '1px' }} />
            <div style={{ fontSize: '13px', color: THEME.statusWarningText }}>
              <div style={{ fontWeight: 700 }}>Account codes are missing</div>
              <div style={{ marginTop: '2px' }}>
                Configure {missingCodes.join(', ')} in <b>Fuel Settings → Finance Account Mapping</b> so exported lines have valid GL codes.
              </div>
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
          <Button variant="filled" icon="playlist_add_check" onClick={run} disabled={loading} style={{ background: FUEL_CLR, borderColor: FUEL_CLR }}>
            {loading ? 'Building…' : 'Build Preview'}
          </Button>
        </div>
      </Card>

      {/* KPI summary */}
      {journal.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '18px' }}>
          <MiniStat label="Journal Lines" value={journal.length} />
          <MiniStat label="Deliveries" value={deliveries.length} />
          <MiniStat label="Total Debit"  value={fmtMoney(totals.debit)}  color={FUEL_CLR} />
          <MiniStat label="Total Credit" value={fmtMoney(totals.credit)} color={balanced ? FUEL_CLR : THEME.error} sub={balanced ? 'Balanced' : 'Out of balance'} />
        </div>
      )}

      {/* Journal preview */}
      {journal.length > 0 && (
        <TableWrap style={{ marginBottom: '20px' }}>
          <THead>
            <Th>Date</Th>
            <Th>Account</Th>
            <Th>Description</Th>
            <Th align="right">Debit</Th>
            <Th align="right">Credit</Th>
            <Th>Department</Th>
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
                <Td align="right" style={{ color: l.debit  ? FUEL_CLR    : THEME.textLow, fontWeight: l.debit  ? 600 : 400 }}>{l.debit  != null ? fmtMoney(l.debit)  : '—'}</Td>
                <Td align="right" style={{ color: l.credit ? THEME.info  : THEME.textLow, fontWeight: l.credit ? 600 : 400 }}>{l.credit != null ? fmtMoney(l.credit) : '—'}</Td>
                <Td style={{ color: THEME.textMed }}>{l.department || '—'}</Td>
              </TRow>
            ))}
            <tr style={{ background: THEME.surfaceVar, borderTop: `2px solid ${THEME.outlineVar}` }}>
              <td colSpan={3} style={{ padding: '10px 14px', fontWeight: 700, color: THEME.text }}>Totals</td>
              <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: FUEL_CLR }}>{fmtMoney(totals.debit)}</td>
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
            Pick a period and click <b>Build Preview</b> to generate journal entries.
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
