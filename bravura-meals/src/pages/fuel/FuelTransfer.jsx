import { useState, useMemo, useCallback } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../hooks/usePermissions'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Card, Icon, Button, showToast, TableWrap, THead, Th, TRow, Td, fmtDate } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

export default function FuelTransfer() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, transactions, tankBalance, addTransaction, refresh } = useFuel()

  const activeTanks = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])

  const [fromTankId, setFromTankId] = useState('')
  const [toTankId, setToTankId]     = useState('')
  const [litres, setLitres]         = useState('')
  const [notes, setNotes]           = useState('')
  const [docket, setDocket]         = useState('')
  const [saving, setSaving]         = useState(false)

  const fromTank = activeTanks.find(t => t.id === fromTankId)
  const toTank   = activeTanks.find(t => t.id === toTankId)

  const destTanks = useMemo(() => {
    if (!fromTank) return activeTanks
    return activeTanks.filter(t => t.id !== fromTankId && t.fuel_type_id === fromTank.fuel_type_id)
  }, [activeTanks, fromTankId, fromTank])

  const fromBalance = fromTank ? tankBalance(fromTank.id) : 0
  const toBalance   = toTank   ? tankBalance(toTank.id)   : 0
  const litresNum   = Number(litres) || 0

  const canSubmit = fromTankId && toTankId && litresNum > 0 && litresNum <= fromBalance && !saving

  const handleTransfer = useCallback(async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      const outRow = await addTransaction({
        tank_id: fromTankId,
        transaction_type: 'transfer_out',
        litres: litresNum,
        docket_number: docket || null,
        notes: notes ? `Transfer to ${toTank.name}. ${notes}` : `Transfer to ${toTank.name}`,
      })

      await addTransaction({
        tank_id: toTankId,
        transaction_type: 'transfer_in',
        litres: litresNum,
        original_transaction_id: outRow.id,
        docket_number: docket || null,
        notes: notes ? `Transfer from ${fromTank.name}. ${notes}` : `Transfer from ${fromTank.name}`,
      })

      showToast(`Transferred ${litresNum.toLocaleString()} L from ${fromTank.name} to ${toTank.name}`, 'green')
      setLitres('')
      setNotes('')
      setDocket('')
      setFromTankId('')
      setToTankId('')
      await refresh()
    } catch (err) {
      showToast(err.message || 'Transfer failed', 'red')
    } finally {
      setSaving(false)
    }
  }, [canSubmit, fromTankId, toTankId, litresNum, docket, notes, fromTank, toTank, addTransaction, refresh])

  const recentTransfers = useMemo(() =>
    transactions
      .filter(t => t.transaction_type === 'transfer_out')
      .slice(0, 20),
  [transactions])

  if (!can('fuel.create')) return (
    <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>
      <Icon name="lock" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      Access denied — requires fuel create permission.
    </div>
  )

  const inp = { padding: '10px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '4px' }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <PageHeader
        title="Tank Transfer"
        site={currentSite}
      >
        <div style={{ fontSize: '12px', color: THEME.textMed }}>
          Move fuel between tanks — e.g. from a main storage tank into 210L drums or bowsers.
        </div>
      </PageHeader>

      <Card style={{ padding: '24px', marginBottom: '24px' }}>
        {/* Source → Destination visual */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', alignItems: 'start', marginBottom: '24px' }}>
          {/* Source tank */}
          <div>
            <div style={lbl}>Source Tank</div>
            <select
              value={fromTankId}
              onChange={e => { setFromTankId(e.target.value); setToTankId('') }}
              style={{ ...inp, cursor: 'pointer' }}
            >
              <option value="">Select source tank…</option>
              {activeTanks.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.fuel_types?.name || 'Fuel'} ({Math.round(tankBalance(t.id)).toLocaleString()} L)
                </option>
              ))}
            </select>
            {fromTank && (
              <TankPreview tank={fromTank} balance={fromBalance} delta={-litresNum} color={THEME.warning} />
            )}
          </div>

          {/* Arrow */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '28px' }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: FUEL_CLR + '14', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="arrow_forward" size={22} style={{ color: FUEL_CLR }} />
            </div>
          </div>

          {/* Destination tank */}
          <div>
            <div style={lbl}>Destination Tank</div>
            <select
              value={toTankId}
              onChange={e => setToTankId(e.target.value)}
              style={{ ...inp, cursor: 'pointer' }}
              disabled={!fromTankId}
            >
              <option value="">Select destination tank…</option>
              {destTanks.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} — {t.fuel_types?.name || 'Fuel'} ({Math.round(tankBalance(t.id)).toLocaleString()} L)
                </option>
              ))}
            </select>
            {toTank && (
              <TankPreview tank={toTank} balance={toBalance} delta={litresNum} color={THEME.success} />
            )}
          </div>
        </div>

        {fromTankId && toTankId && fromTank?.fuel_type_id !== toTank?.fuel_type_id && (
          <Card style={{ borderColor: THEME.error + '55', background: THEME.statusErrorBg, marginBottom: '16px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: THEME.statusErrorText, fontWeight: 600 }}>
              <Icon name="warning" size={16} style={{ color: THEME.error }} />
              Fuel type mismatch — source and destination tanks use different fuel types.
            </div>
          </Card>
        )}

        {/* Transfer details */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
          <div>
            <div style={lbl}>Volume (Litres)</div>
            <input
              type="number"
              min="0"
              step="0.1"
              value={litres}
              onChange={e => setLitres(e.target.value)}
              placeholder="Enter litres"
              style={inp}
            />
            {litresNum > 0 && litresNum > fromBalance && (
              <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px', fontWeight: 600 }}>
                Exceeds available balance ({Math.round(fromBalance).toLocaleString()} L)
              </div>
            )}
          </div>
          <div>
            <div style={lbl}>Docket / Reference (optional)</div>
            <input
              type="text"
              value={docket}
              onChange={e => setDocket(e.target.value)}
              placeholder="e.g. TRF-001"
              style={inp}
            />
          </div>
          <div>
            <div style={lbl}>Notes (optional)</div>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Reason for transfer"
              style={inp}
            />
          </div>
        </div>

        {/* Summary + submit */}
        {canSubmit && (
          <Card style={{ background: FUEL_CLR + '08', borderColor: FUEL_CLR + '30', padding: '14px 18px', marginBottom: '18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px', color: THEME.text }}>
              <Icon name="swap_horiz" size={20} style={{ color: FUEL_CLR }} />
              <span>
                Transfer <strong style={{ color: FUEL_CLR }}>{litresNum.toLocaleString()} L</strong> of{' '}
                <strong>{fromTank?.fuel_types?.name || 'fuel'}</strong> from{' '}
                <strong>{fromTank?.name}</strong> to <strong>{toTank?.name}</strong>
              </span>
            </div>
          </Card>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="filled"
            icon="swap_horiz"
            onClick={handleTransfer}
            disabled={!canSubmit}
            style={{ background: FUEL_CLR, borderColor: FUEL_CLR }}
          >
            {saving ? 'Transferring…' : 'Confirm Transfer'}
          </Button>
        </div>
      </Card>

      {/* Recent transfers history */}
      {recentTransfers.length > 0 && (
        <Card style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="history" size={18} style={{ color: FUEL_CLR }} />
            <span style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Recent Transfers</span>
            <span style={{ fontSize: '11px', color: THEME.textLow, marginLeft: '4px' }}>Last 20</span>
          </div>
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>From Tank</Th>
              <Th>To Tank</Th>
              <Th align="right">Volume (L)</Th>
              <Th>Docket</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {recentTransfers.map((tx, idx) => {
                const linkedIn = transactions.find(t => t.original_transaction_id === tx.id && t.transaction_type === 'transfer_in')
                const srcTank = tanks.find(t => t.id === tx.tank_id)
                const dstTank = linkedIn ? tanks.find(t => t.id === linkedIn.tank_id) : null
                return (
                  <TRow key={tx.id} last={idx === recentTransfers.length - 1}>
                    <Td style={{ whiteSpace: 'nowrap', color: THEME.textMed }}>{fmtDate(tx.transaction_date)}</Td>
                    <Td style={{ fontWeight: 600, color: THEME.text }}>{srcTank?.name || '—'}</Td>
                    <Td style={{ fontWeight: 600, color: THEME.text }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Icon name="arrow_forward" size={14} style={{ color: FUEL_CLR }} />
                        {dstTank?.name || '—'}
                      </span>
                    </Td>
                    <Td align="right" style={{ fontWeight: 700, color: FUEL_CLR }}>{Number(tx.litres).toLocaleString(undefined, { maximumFractionDigits: 1 })}</Td>
                    <Td style={{ color: THEME.textMed }}>{tx.docket_number || '—'}</Td>
                    <Td style={{ color: THEME.textLow, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tx.notes || '—'}
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </div>
  )
}

function TankPreview({ tank, balance, delta, color }) {
  const cap = Number(tank.capacity_litres) || 0
  const currentPct = cap ? Math.min(100, Math.max(0, (balance / cap) * 100)) : null
  const afterBalance = Math.max(0, balance + delta)
  const afterPct = cap ? Math.min(100, Math.max(0, (afterBalance / cap) * 100)) : null
  const actualDelta = delta !== 0 ? delta : null

  return (
    <div style={{
      marginTop: '10px', padding: '12px 14px', borderRadius: '10px',
      background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.text }}>{tank.fuel_types?.name || 'Fuel'}</span>
        <span style={{ fontSize: '11px', color: THEME.textLow }}>{tank.tank_type || 'Tank'}</span>
      </div>

      {/* Level bar */}
      {currentPct !== null && (
        <div style={{ height: '8px', borderRadius: '4px', background: THEME.outlineVar, marginBottom: '6px', position: 'relative', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, left: 0,
            width: `${currentPct}%`, background: THEME.textLow + '40', borderRadius: '4px',
          }} />
          {afterPct !== null && actualDelta && (
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 0,
              width: `${afterPct}%`, background: color, borderRadius: '4px',
              transition: 'width .3s',
            }} />
          )}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
        <span style={{ color: THEME.textLow }}>
          Now: {Math.round(balance).toLocaleString()} L
        </span>
        {actualDelta !== 0 && actualDelta != null && (
          <span style={{ color, fontWeight: 700 }}>
            After: {Math.round(afterBalance).toLocaleString()} L ({delta > 0 ? '+' : ''}{Math.round(delta).toLocaleString()})
          </span>
        )}
      </div>
    </div>
  )
}
