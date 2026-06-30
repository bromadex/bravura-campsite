import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import {
  PageHeader, Card, Icon, fmtDate, MONTHS,
  TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

export default function FuelReports() {
  const { currentSite } = useSite()
  const { tanks, receipts, issues, dipReadings, tankBalance, latestDip, loading } = useFuel()

  const now = new Date()
  const [tab,      setTab]      = useState('monthly')
  const [repYear,  setRepYear]  = useState(now.getFullYear())
  const [repMonth, setRepMonth] = useState(now.getMonth())

  // ── Monthly usage report ──────────────────────────────────────────────────────
  const monthlyRows = useMemo(() => {
    const month = `${repYear}-${String(repMonth + 1).padStart(2, '0')}`
    return tanks.map(tank => {
      const monthReceipts = receipts.filter(r => r.tank_id === tank.id && r.transaction_date?.startsWith(month))
      const monthIssues   = issues.filter(i => i.tank_id === tank.id && i.transaction_date?.startsWith(month))
      const received = monthReceipts.reduce((s, r) => s + Number(r.litres), 0)
      const issued   = monthIssues.reduce((s, i) => s + Number(i.litres), 0)
      const net      = received - issued
      const currentBalance = tankBalance(tank.id)
      return { tank, received, issued, net, txnCount: monthReceipts.length + monthIssues.length, currentBalance }
    })
  }, [tanks, receipts, issues, repYear, repMonth, tankBalance])

  const monthTotals = useMemo(() => ({
    received:       monthlyRows.reduce((s, r) => s + r.received, 0),
    issued:         monthlyRows.reduce((s, r) => s + r.issued, 0),
    net:            monthlyRows.reduce((s, r) => s + r.net, 0),
    txnCount:       monthlyRows.reduce((s, r) => s + r.txnCount, 0),
    currentBalance: monthlyRows.reduce((s, r) => s + r.currentBalance, 0),
  }), [monthlyRows])

  // ── Variance / dip report ─────────────────────────────────────────────────────
  const varianceRows = useMemo(() => {
    return tanks.filter(t => t.status === 'active' && !t.is_archived).map(tank => {
      const calc    = tankBalance(tank.id)
      const dip     = latestDip(tank.id)
      const actual  = dip ? Number(dip.reading_litres) : null
      const variance = actual !== null ? calc - actual : null
      const pct      = tank.capacity_litres ? (calc / Number(tank.capacity_litres)) * 100 : null
      return { tank, calc, dip, actual, variance, pct }
    })
  }, [tanks, tankBalance, latestDip])

  // ── Asset usage summary ───────────────────────────────────────────────────────
  const assetRows = useMemo(() => {
    const map = new Map()
    issues.forEach(i => {
      const key = `${i.asset_type}::${i.asset_name}::${i.asset_reg || ''}`
      if (!map.has(key)) map.set(key, { asset_type: i.asset_type, asset_name: i.asset_name, asset_reg: i.asset_reg, total: 0, count: 0, last: null })
      const row = map.get(key)
      row.total += Number(i.litres)
      row.count += 1
      if (!row.last || i.transaction_date > row.last) row.last = i.transaction_date
    })
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [issues])

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1100px' }}>
      <PageHeader title="Fuel Reports" site={currentSite} />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: THEME.surfaceVar, borderRadius: '12px', padding: '4px', width: 'fit-content' }}>
        {[
          { id: 'monthly',  label: 'Monthly Usage',   icon: 'bar_chart' },
          { id: 'variance', label: 'Variance (Dip)',  icon: 'compare_arrows' },
          { id: 'assets',   label: 'Asset Usage',     icon: 'directions_car' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '7px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 500,
              border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s',
              background: tab === t.id ? THEME.surface : 'transparent',
              color:      tab === t.id ? THEME.primary : THEME.textMed,
              boxShadow:  tab === t.id ? THEME.shadow1 : 'none',
            }}
          >
            <Icon name={t.icon} size={15} style={{ color: 'inherit' }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Monthly Usage ── */}
      {tab === 'monthly' && (
        <>
          {/* Month picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <select value={repMonth} onChange={e => setRepMonth(Number(e.target.value))} style={selectStyle}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
            <select value={repYear} onChange={e => setRepYear(Number(e.target.value))} style={{ ...selectStyle, width: '100px' }}>
              {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div style={{ fontWeight: 600, color: THEME.text, marginBottom: '12px', fontSize: '15px' }}>
            {MONTHS[repMonth]} {repYear}
          </div>

          <Card style={{ padding: 0 }}>
            <TableWrap>
              <THead>
                <Th>Tank</Th>
                <Th>Fuel Type</Th>
                <Th align="right">Received (L)</Th>
                <Th align="right">Issued (L)</Th>
                <Th align="right">Net (L)</Th>
                <Th align="right">Current Balance (L)</Th>
              </THead>
              <tbody>
                {monthlyRows.map((row, idx) => (
                  <TRow key={row.tank.id} last={idx === monthlyRows.length - 1}>
                    <Td><span style={{ fontWeight: 500 }}>{row.tank.name}</span></Td>
                    <Td style={{ color: THEME.textMed }}>{row.tank.fuel_types?.name || 'Diesel'}</Td>
                    <Td align="right" style={{ color: row.received > 0 ? THEME.success : THEME.textMed, fontWeight: row.received > 0 ? 600 : 400 }}>
                      {row.received > 0 ? `+${row.received.toFixed(1)}` : '—'}
                    </Td>
                    <Td align="right" style={{ color: row.issued > 0 ? THEME.warning : THEME.textMed, fontWeight: row.issued > 0 ? 600 : 400 }}>
                      {row.issued > 0 ? row.issued.toFixed(1) : '—'}
                    </Td>
                    <Td align="right" style={{ fontWeight: 600, color: row.net >= 0 ? THEME.text : THEME.error }}>
                      {row.net >= 0 ? '+' : ''}{row.net.toFixed(1)}
                    </Td>
                    <Td align="right" style={{ fontWeight: 600 }}>{row.currentBalance.toFixed(1)}</Td>
                  </TRow>
                ))}
                {/* Totals row */}
                <tr style={{ background: THEME.primary + '10', borderTop: `2px solid ${THEME.primary}30` }}>
                  <td colSpan={2} style={{ padding: '11px 14px', fontWeight: 700, color: THEME.text, fontSize: '13px' }}>TOTAL</td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: THEME.success }}>
                    {monthTotals.received > 0 ? `+${monthTotals.received.toFixed(1)}` : '—'}
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: THEME.warning }}>
                    {monthTotals.issued > 0 ? monthTotals.issued.toFixed(1) : '—'}
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: monthTotals.net >= 0 ? THEME.text : THEME.error }}>
                    {monthTotals.net >= 0 ? '+' : ''}{monthTotals.net.toFixed(1)}
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: THEME.text }}>
                    {monthTotals.currentBalance.toFixed(1)}
                  </td>
                </tr>
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}

      {/* ── Variance / Dip ── */}
      {tab === 'variance' && (
        <Card style={{ padding: 0 }}>
          <TableWrap>
            <THead>
              <Th>Tank</Th>
              <Th align="right">Calculated Balance (L)</Th>
              <Th align="right">Last Dip Reading (L)</Th>
              <Th>Dip Date</Th>
              <Th align="right">Variance (L)</Th>
              <Th align="right">Level %</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {varianceRows.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>No active tanks.</td></tr>
              ) : (
                varianceRows.map((row, idx) => {
                  const varianceAbs = row.variance !== null ? Math.abs(row.variance) : null
                  const status = row.actual === null ? 'No dip recorded'
                    : varianceAbs > 50 ? 'High variance — investigate'
                    : varianceAbs > 10 ? 'Moderate variance'
                    : 'Within tolerance'
                  const statusColor = row.actual === null ? THEME.statusNeutralText
                    : varianceAbs > 50 ? THEME.statusErrorText
                    : varianceAbs > 10 ? THEME.statusWarningText
                    : THEME.statusSuccessText
                  const statusBg = row.actual === null ? THEME.statusNeutralBg
                    : varianceAbs > 50 ? THEME.statusErrorBg
                    : varianceAbs > 10 ? THEME.statusWarningBg
                    : THEME.statusSuccessBg
                  return (
                    <TRow key={row.tank.id} last={idx === varianceRows.length - 1}>
                      <Td><span style={{ fontWeight: 500 }}>{row.tank.name}</span></Td>
                      <Td align="right" style={{ fontWeight: 600 }}>{row.calc.toFixed(1)}</Td>
                      <Td align="right">{row.actual !== null ? row.actual.toFixed(1) : '—'}</Td>
                      <Td style={{ color: THEME.textMed }}>{row.dip ? fmtDate(row.dip.reading_date) : '—'}</Td>
                      <Td align="right">
                        {row.variance !== null ? (
                          <span style={{ fontWeight: 600, color: varianceAbs > 10 ? THEME.error : THEME.success }}>
                            {row.variance > 0 ? '+' : ''}{row.variance.toFixed(1)}
                          </span>
                        ) : '—'}
                      </Td>
                      <Td align="right">
                        {row.pct !== null ? `${Math.min(100, Math.max(0, row.pct)).toFixed(0)}%` : '—'}
                      </Td>
                      <Td>
                        <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: statusBg, color: statusColor }}>
                          {status}
                        </span>
                      </Td>
                    </TRow>
                  )
                })
              )}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* ── Asset Usage ── */}
      {tab === 'assets' && (
        <Card style={{ padding: 0 }}>
          <TableWrap>
            <THead>
              <Th>Asset</Th>
              <Th>Type</Th>
              <Th>Reg / Designation</Th>
              <Th align="right">Total Issued (L)</Th>
              <Th align="right">Transactions</Th>
              <Th>Last Issue</Th>
            </THead>
            <tbody>
              {assetRows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>No fuel issues recorded.</td></tr>
              ) : (
                assetRows.map((row, idx) => (
                  <TRow key={idx} last={idx === assetRows.length - 1}>
                    <Td><span style={{ fontWeight: 500 }}>{row.asset_name}</span></Td>
                    <Td>
                      <span style={{
                        padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500,
                        background: THEME.surfaceVar, color: THEME.textMed, textTransform: 'capitalize',
                      }}>
                        {row.asset_type}
                      </span>
                    </Td>
                    <Td style={{ color: THEME.textMed }}>{row.asset_reg || '—'}</Td>
                    <Td align="right" style={{ fontWeight: 600, color: THEME.warning }}>{row.total.toFixed(1)}</Td>
                    <Td align="right" style={{ color: THEME.textMed }}>{row.count}</Td>
                    <Td style={{ color: THEME.textMed }}>{row.last ? fmtDate(row.last) : '—'}</Td>
                  </TRow>
                ))
              )}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </div>
  )
}

const selectStyle = {
  padding: '8px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
  fontSize: '13px', color: THEME.text, background: THEME.surface,
  fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
}
