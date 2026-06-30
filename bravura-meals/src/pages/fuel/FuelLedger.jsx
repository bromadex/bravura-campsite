import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, fmtDate, TableWrap, THead, Th, TRow, Td } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

export default function FuelLedger() {
  const { currentSite } = useSite()
  const { tanks, receipts, issues, loading } = useFuel()

  const activeTanks = tanks.filter(t => t.is_active)

  const [tankId,    setTankId]    = useState('')
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')

  // Build the combined ledger for the selected tank
  const { rows, summary } = useMemo(() => {
    if (!tankId) return { rows: [], summary: null }

    // Combine receipts + issues into a single timeline
    const allTxns = [
      ...receipts
        .filter(r => r.tank_id === tankId)
        .map(r => ({
          id:          r.id,
          date:        r.receipt_date,
          type:        'receipt',
          description: [r.supplier, r.delivery_note_ref].filter(Boolean).join(' · ') || 'Fuel delivery',
          inQty:       Number(r.quantity_litres),
          outQty:      0,
          meta:        r.recorded_by_name || null,
        })),
      ...issues
        .filter(i => i.tank_id === tankId)
        .map(i => ({
          id:          i.id,
          date:        i.issue_date,
          type:        'issue',
          description: `${i.asset_name}${i.asset_reg ? ` (${i.asset_reg})` : ''}${i.purpose ? ` — ${i.purpose}` : ''}`,
          inQty:       0,
          outQty:      Number(i.quantity_litres),
          meta:        [i.approved_by_name && `Approved: ${i.approved_by_name}`, i.received_by && `Rcvd: ${i.received_by}`].filter(Boolean).join(' · ') || null,
        })),
    ]

    // Sort chronologically (oldest first) for running balance
    allTxns.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'receipt' ? -1 : 1))

    // Compute running balance
    let balance = 0
    const withBalance = allTxns.map(txn => {
      balance += txn.inQty - txn.outQty
      return { ...txn, balance }
    })

    // Apply date filters
    const filtered = withBalance.filter(r => {
      if (dateFrom && r.date < dateFrom) return false
      if (dateTo   && r.date > dateTo)   return false
      return true
    })

    // Summary
    const totalIn  = filtered.reduce((s, r) => s + r.inQty, 0)
    const totalOut = filtered.reduce((s, r) => s + r.outQty, 0)
    const opening  = filtered.length > 0 ? (filtered[0].balance - filtered[0].inQty + filtered[0].outQty) : 0
    const closing  = filtered.length > 0 ? filtered[filtered.length - 1].balance : opening

    // Show newest first in the table (reverse for display)
    return {
      rows: [...filtered].reverse(),
      summary: { totalIn, totalOut, opening, closing },
    }
  }, [tankId, receipts, issues, dateFrom, dateTo])

  const selectedTank = tanks.find(t => t.id === tankId)

  if (loading) return null

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader title="Fuel Ledger" site={currentSite} />

      {/* Controls row */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
        marginBottom: '20px',
      }}>
        {/* Tank selector */}
        <div style={{ flex: '1 1 200px', minWidth: '180px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Tank</div>
          <select
            value={tankId}
            onChange={e => setTankId(e.target.value)}
            style={selectStyle}
          >
            <option value="">— Select a tank —</option>
            {activeTanks.map(t => (
              <option key={t.id} value={t.id}>{t.name} ({t.fuel_type})</option>
            ))}
          </select>
        </div>

        {/* Date from */}
        <div style={{ flex: '1 1 140px', minWidth: '130px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={selectStyle} />
        </div>

        {/* Date to */}
        <div style={{ flex: '1 1 140px', minWidth: '130px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={selectStyle} />
        </div>

        {(dateFrom || dateTo) && (
          <div style={{ alignSelf: 'flex-end', paddingBottom: '1px' }}>
            <button
              onClick={() => { setDateFrom(''); setDateTo('') }}
              style={{ background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '8px', padding: '9px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textMed, fontFamily: 'inherit' }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* No tank selected */}
      {!tankId && (
        <div style={{
          textAlign: 'center', padding: '80px 24px',
          background: THEME.surface, borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`,
          color: THEME.textLow,
        }}>
          <Icon name="receipt_long" size={44} style={{ display: 'block', margin: '0 auto 12px', color: THEME.outline }} />
          <div style={{ fontSize: '15px', fontWeight: 500, color: THEME.text, marginBottom: '6px' }}>Select a tank to view its ledger</div>
          <div style={{ fontSize: '13px' }}>The ledger shows every fuel movement with a running balance, like a bank statement.</div>
        </div>
      )}

      {/* Summary cards */}
      {tankId && summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          {[
            { label: 'Opening Balance', value: summary.opening.toFixed(0), unit: 'L', color: THEME.textMed, icon: 'arrow_forward' },
            { label: 'Total Received',  value: summary.totalIn.toFixed(0),  unit: 'L', color: THEME.success, icon: 'arrow_downward' },
            { label: 'Total Issued',    value: summary.totalOut.toFixed(0), unit: 'L', color: THEME.warning, icon: 'arrow_upward' },
            { label: 'Closing Balance', value: summary.closing.toFixed(0),  unit: 'L', color: FUEL_CLR,      icon: 'account_balance' },
          ].map(s => (
            <div key={s.label} style={{
              background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
              borderRadius: '14px', padding: '12px 14px', boxShadow: THEME.shadow1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div style={{ fontSize: '10px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</div>
                <Icon name={s.icon} size={14} style={{ color: s.color, opacity: .7 }} />
              </div>
              <div style={{ fontSize: '22px', fontWeight: 600, color: s.color, lineHeight: 1 }}>
                {s.value}<span style={{ fontSize: '11px', fontWeight: 400, marginLeft: '3px', color: THEME.textLow }}>{s.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ledger table */}
      {tankId && (
        <div style={{
          background: THEME.surface, borderRadius: '16px',
          border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden',
        }}>
          {rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
              <Icon name="receipt_long" size={36} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
              <div style={{ fontSize: '14px' }}>No transactions{dateFrom || dateTo ? ' in this date range' : ' recorded yet'}.</div>
            </div>
          ) : (
            <TableWrap>
              <THead color={FUEL_CLR}>
                <Th>Date</Th>
                <Th>Type</Th>
                <Th>Description</Th>
                <Th align="right">In (L)</Th>
                <Th align="right">Out (L)</Th>
                <Th align="right">Balance (L)</Th>
                <Th>Details</Th>
              </THead>
              <tbody>
                {rows.map((row, idx) => {
                  const isReceipt = row.type === 'receipt'
                  const isLast = idx === rows.length - 1
                  const isLow = selectedTank?.capacity_litres
                    ? (row.balance / Number(selectedTank.capacity_litres)) * 100 <= 20
                    : false
                  return (
                    <TRow key={row.id} last={isLast}>
                      <Td>
                        <span style={{ fontSize: '12px', fontWeight: 500, color: THEME.text }}>{fmtDate(row.date)}</span>
                      </Td>
                      <Td>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '5px',
                          padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                          background: isReceipt ? THEME.statusSuccessBg : THEME.statusWarningBg,
                          color:      isReceipt ? THEME.statusSuccessText : THEME.statusWarningText,
                        }}>
                          <Icon name={isReceipt ? 'arrow_downward' : 'arrow_upward'} size={11} style={{ color: 'inherit' }} />
                          {isReceipt ? 'Receipt' : 'Issue'}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ fontSize: '13px', color: THEME.text }}>{row.description}</span>
                      </Td>
                      <Td align="right">
                        {isReceipt ? (
                          <span style={{ fontWeight: 700, color: THEME.success }}>+{row.inQty.toFixed(1)}</span>
                        ) : (
                          <span style={{ color: THEME.textLow }}>—</span>
                        )}
                      </Td>
                      <Td align="right">
                        {!isReceipt ? (
                          <span style={{ fontWeight: 700, color: THEME.warning }}>{row.outQty.toFixed(1)}</span>
                        ) : (
                          <span style={{ color: THEME.textLow }}>—</span>
                        )}
                      </Td>
                      <Td align="right">
                        <span style={{
                          fontWeight: 700, fontSize: '13px',
                          color: isLow ? THEME.error : THEME.text,
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                        }}>
                          {isLow && <Icon name="warning" size={12} style={{ color: THEME.error }} />}
                          {row.balance.toFixed(1)}
                        </span>
                      </Td>
                      <Td>
                        <span style={{ fontSize: '11px', color: THEME.textLow }}>{row.meta || '—'}</span>
                      </Td>
                    </TRow>
                  )
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      )}
    </div>
  )
}

const selectStyle = {
  width: '100%', padding: '9px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '13px', color: THEME.text,
  background: THEME.surface, fontFamily: 'inherit', outline: 'none',
  cursor: 'pointer',
}
