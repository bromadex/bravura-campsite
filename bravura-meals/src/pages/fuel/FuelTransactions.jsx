import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, fmtDate } from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel
const today    = new Date().toISOString().slice(0, 10)

const TYPE_META = {
  delivery:   { label: 'Delivery',   bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  icon: 'arrow_downward' },
  issuance:   { label: 'Issuance',   bg: THEME.statusWarningBg,  text: THEME.statusWarningText,  icon: 'output' },
  adjustment: { label: 'Adjustment', bg: THEME.statusInfoBg,     text: THEME.statusInfoText,     icon: 'sync_alt' },
}

function TypeBadge({ type }) {
  const m = TYPE_META[type] || { label: type, bg: THEME.surfaceVar, text: THEME.textMed, icon: 'receipt' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
      background: m.bg, color: m.text,
    }}>
      <Icon name={m.icon} size={11} style={{ color: 'inherit' }} />
      {m.label}
    </span>
  )
}

const selStyle = {
  padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
  fontSize: '13px', color: THEME.text, background: THEME.surface,
  fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function DetailPanel({ tx, tanks, operators, pumps, onClose }) {
  if (!tx) return null
  const tank     = tanks.find(t => t.id === tx.tank_id)
  const operator = operators.find(o => o.id === tx.operator_id)
  const pump     = pumps.find(p => p.id === tx.pump_id)

  const assetLabel = tx.fuel_vehicles?.fleet_number
    ? `${tx.fuel_vehicles.fleet_number}${tx.fuel_vehicles.registration ? ' (' + tx.fuel_vehicles.registration + ')' : ''}`
    : tx.fuel_equipment?.name
    ? `${tx.fuel_equipment.name}${tx.fuel_equipment.equipment_number ? ' (' + tx.fuel_equipment.equipment_number + ')' : ''}`
    : tx.asset_description || '—'

  const rows = [
    ['Transaction #', tx.transaction_number, true],
    ['Docket',        tx.docket_number || '—'],
    ['Type',          tx.transaction_type],
    ['Date',          fmtDate(tx.transaction_date)],
    ['Tank',          tank?.name || tx.tank_id],
    ['Fuel Type',     tank?.fuel_types?.name || '—'],
    pump && ['Pump',  pump.name],
    tx.transaction_type === 'issuance' && ['Asset', assetLabel],
    operator && ['Operator', operator.employees?.name || operator.id],
    ['Litres',        `${Number(tx.litres).toLocaleString(undefined, { minimumFractionDigits: 1 })} L`],
    tx.unit_price  && ['Unit Price', `$${Number(tx.unit_price).toFixed(4)}/L`],
    tx.total_cost  && ['Total Cost', `$${Number(tx.total_cost).toFixed(2)}`],
    tx.tank_level_before != null && ['Level Before', `${Number(tx.tank_level_before).toFixed(1)} L`],
    tx.meter_start != null && ['Meter Start', Number(tx.meter_start).toLocaleString(undefined, { minimumFractionDigits: 1 })],
    tx.meter_end   != null && ['Meter End',   Number(tx.meter_end).toLocaleString(undefined, { minimumFractionDigits: 1 })],
    tx.supplier    && ['Supplier', tx.supplier],
    tx.notes       && ['Notes', tx.notes],
    tx.approved_by_profile?.full_name && ['Approved By', tx.approved_by_profile.full_name],
  ].filter(Boolean)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div
        style={{
          width: '380px', height: '100vh', background: THEME.surface,
          borderLeft: `1px solid ${THEME.outlineVar}`, overflowY: 'auto',
          padding: '24px', boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Transaction Detail</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px', fontFamily: 'monospace' }}>{tx.transaction_number}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: THEME.textLow }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <TypeBadge type={tx.transaction_type} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {rows.map(([k, v, mono]) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px', gap: '12px' }}>
              <span style={{ color: THEME.textMed, flexShrink: 0 }}>{k}</span>
              <span style={{ fontWeight: 500, color: THEME.text, textAlign: 'right', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{v}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '20px', padding: '12px 14px', borderRadius: '10px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`, fontSize: '12px', color: THEME.textMed, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="lock" size={13} style={{ color: THEME.textMed, flexShrink: 0 }} />
          Transactions are immutable — to correct this record, post an adjustment.
        </div>
      </div>
    </div>
  )
}

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(rows, tanks, operators) {
  const headers = ['Docket No', 'Transaction #', 'Date', 'Type', 'Tank', 'Fuel Type', 'Asset', 'Operator', 'Litres', 'Unit Price', 'Total Cost', 'Notes']
  const lines = rows.map(tx => {
    const tank = tanks.find(t => t.id === tx.tank_id)
    const op   = operators.find(o => o.id === tx.operator_id)
    const asset = tx.fuel_vehicles?.fleet_number
      ? tx.fuel_vehicles.fleet_number + (tx.fuel_vehicles.registration ? ' ' + tx.fuel_vehicles.registration : '')
      : tx.fuel_equipment?.name || tx.asset_description || ''
    return [
      tx.docket_number || '',
      tx.transaction_number,
      tx.transaction_date,
      tx.transaction_type,
      tank?.name || '',
      tank?.fuel_types?.name || '',
      asset,
      op?.employees?.name || '',
      Number(tx.litres).toFixed(3),
      tx.unit_price ? Number(tx.unit_price).toFixed(4) : '',
      tx.total_cost ? Number(tx.total_cost).toFixed(2) : '',
      tx.notes || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`)
  })
  const csv = [headers.join(','), ...lines.map(l => l.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `fuel-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function FuelTransactions({ setPage }) {
  const { can }        = usePermissions()
  const { currentSite } = useSite()
  const { tanks, operators, pumps, transactions, fuelTypes, loading } = useFuel()

  const [dateFrom,  setDateFrom]  = useState(today)
  const [dateTo,    setDateTo]    = useState(today)
  const [tankId,    setTankId]    = useState('')
  const [txType,    setTxType]    = useState('')
  const [fuelTypeId,setFuelTypeId]= useState('')
  const [search,    setSearch]    = useState('')
  const [selected,  setSelected]  = useState(null)

  if (!can('fuel.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const activeTanks = tanks.filter(t => t.status === 'active' && !t.is_archived)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return transactions.filter(tx => {
      if (dateFrom && tx.transaction_date < dateFrom) return false
      if (dateTo   && tx.transaction_date > dateTo)   return false
      if (tankId   && tx.tank_id !== tankId)           return false
      if (txType   && tx.transaction_type !== txType)  return false
      if (fuelTypeId) {
        const tank = tanks.find(t => t.id === tx.tank_id)
        if (!tank || tank.fuel_type_id !== fuelTypeId) return false
      }
      if (q) {
        const docket = (tx.docket_number || '').toLowerCase()
        const fleet  = (tx.fuel_vehicles?.fleet_number || '').toLowerCase()
        const txNum  = (tx.transaction_number || '').toLowerCase()
        if (!docket.includes(q) && !fleet.includes(q) && !txNum.includes(q)) return false
      }
      return true
    })
  }, [transactions, dateFrom, dateTo, tankId, txType, fuelTypeId, search, tanks])

  // Summary totals for filtered set
  const summary = useMemo(() => ({
    deliveries: filtered.filter(t => t.transaction_type === 'delivery').reduce((s, t) => s + Number(t.litres), 0),
    issuances:  filtered.filter(t => t.transaction_type === 'issuance').reduce((s, t) => s + Number(t.litres), 0),
    cost:       filtered.reduce((s, t) => s + Number(t.total_cost || 0), 0),
  }), [filtered])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
      <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )

  function clearFilters() {
    setDateFrom(today); setDateTo(today); setTankId(''); setTxType(''); setFuelTypeId(''); setSearch('')
  }

  const hasFilters = dateFrom !== today || dateTo !== today || tankId || txType || fuelTypeId || search

  return (
    <div style={{ maxWidth: '1200px' }}>
      <PageHeader
        title="Fuel Transactions"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {can('fuel.approve') && filtered.length > 0 && (
              <button
                onClick={() => exportCsv(filtered, tanks, operators)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 500,
                  background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer',
                }}
              >
                <Icon name="download" size={15} style={{ color: FUEL_CLR }} /> Export CSV
              </button>
            )}
            {can('fuel.create') && (
              <button
                onClick={() => setPage('fuel_issuance')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: '20px', fontSize: '13px', fontWeight: 500,
                  background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer',
                }}
              >
                <Icon name="output" size={15} style={{ color: '#fff' }} /> New Issuance
              </button>
            )}
          </div>
        }
      />

      {/* Filters */}
      <div style={{
        display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end',
        marginBottom: '16px', padding: '14px 16px', background: THEME.surface,
        borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
      }}>
        {/* Search */}
        <div style={{ flex: '2 1 200px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Search</div>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Docket #, fleet #, tx #…"
              style={{ ...selStyle, paddingLeft: '32px', width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        </div>

        {/* Date from */}
        <div style={{ flex: '1 1 130px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} />
        </div>

        {/* Date to */}
        <div style={{ flex: '1 1 130px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} />
        </div>

        {/* Tank */}
        <div style={{ flex: '1 1 150px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Tank</div>
          <select value={tankId} onChange={e => setTankId(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">All tanks</option>
            {activeTanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {/* Type */}
        <div style={{ flex: '1 1 140px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Type</div>
          <select value={txType} onChange={e => setTxType(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">All types</option>
            <option value="issuance">Issuance</option>
            <option value="delivery">Delivery</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </div>

        {/* Fuel type */}
        {fuelTypes.length > 1 && (
          <div style={{ flex: '1 1 140px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Fuel Type</div>
            <select value={fuelTypeId} onChange={e => setFuelTypeId(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
              <option value="">All fuel types</option>
              {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
            </select>
          </div>
        )}

        {hasFilters && (
          <button onClick={clearFilters} style={{ alignSelf: 'flex-end', background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textMed, fontFamily: 'inherit' }}>
            Clear
          </button>
        )}
      </div>

      {/* Summary totals */}
      {filtered.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          {[
            { label: `${filtered.length} Transactions`, value: null, icon: 'receipt_long', color: FUEL_CLR },
            { label: 'Total Delivered', value: `${summary.deliveries.toFixed(1)} L`, icon: 'arrow_downward', color: THEME.success },
            { label: 'Total Issued',    value: `${summary.issuances.toFixed(1)} L`,  icon: 'output',         color: THEME.warning },
            summary.cost > 0 && { label: 'Total Cost', value: `$${summary.cost.toFixed(2)}`, icon: 'attach_money', color: THEME.textMed },
          ].filter(Boolean).map((s, i) => (
            <div key={i} style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', padding: '12px 14px', boxShadow: THEME.shadow1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <Icon name={s.icon} size={14} style={{ color: s.color, opacity: .8 }} />
                <span style={{ fontSize: '10px', fontWeight: 500, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</span>
              </div>
              {s.value && <div style={{ fontSize: '20px', fontWeight: 600, color: s.color, lineHeight: 1 }}>{s.value}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ background: THEME.surface, borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="receipt_long" size={40} style={{ display: 'block', margin: '0 auto 12px', color: THEME.outline }} />
            <div style={{ fontSize: '14px' }}>
              {transactions.length === 0
                ? 'No transactions recorded yet.'
                : 'No transactions match the current filters.'}
            </div>
          </div>
        ) : (
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Docket</Th>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Tank</Th>
              <Th>Fuel Type</Th>
              <Th>Asset / Supplier</Th>
              <Th>Operator</Th>
              <Th align="right">Litres</Th>
              <Th align="right">Cost</Th>
            </THead>
            <tbody>
              {filtered.map((tx, idx) => {
                const tank     = tanks.find(t => t.id === tx.tank_id)
                const operator = operators.find(o => o.id === tx.operator_id)
                const asset    = tx.fuel_vehicles?.fleet_number
                  ? `${tx.fuel_vehicles.fleet_number}${tx.fuel_vehicles.registration ? ' · ' + tx.fuel_vehicles.registration : ''}`
                  : tx.fuel_equipment?.name
                  ? `${tx.fuel_equipment.name}`
                  : tx.supplier || tx.asset_description || '—'
                const isLast = idx === filtered.length - 1

                return (
                  <TRow
                    key={tx.id}
                    last={isLast}
                    onClick={() => setSelected(tx)}
                    style={{ cursor: 'pointer' }}
                  >
                    <Td>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: FUEL_CLR, fontWeight: 600 }}>
                        {tx.docket_number || tx.transaction_number}
                      </span>
                    </Td>
                    <Td>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: THEME.text }}>{fmtDate(tx.transaction_date)}</div>
                      <div style={{ fontSize: '10px', color: THEME.textLow }}>{new Date(tx.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                    </Td>
                    <Td><TypeBadge type={tx.transaction_type} /></Td>
                    <Td style={{ fontWeight: 500, color: THEME.text }}>{tank?.name || '—'}</Td>
                    <Td style={{ color: THEME.textMed }}>{tank?.fuel_types?.name || '—'}</Td>
                    <Td style={{ color: THEME.text }}>{asset}</Td>
                    <Td style={{ color: THEME.textMed }}>{operator?.employees?.name || '—'}</Td>
                    <Td align="right">
                      <span style={{ fontWeight: 700, color: tx.transaction_type === 'delivery' ? THEME.success : THEME.warning }}>
                        {tx.transaction_type === 'delivery' ? '+' : tx.transaction_type === 'issuance' ? '−' : ''}
                        {Number(tx.litres).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                      </span>
                    </Td>
                    <Td align="right" style={{ color: THEME.textMed, fontSize: '12px' }}>
                      {tx.total_cost ? `$${Number(tx.total_cost).toFixed(2)}` : '—'}
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </div>

      {/* Detail slide-over */}
      <DetailPanel
        tx={selected}
        tanks={tanks}
        operators={operators}
        pumps={pumps}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
