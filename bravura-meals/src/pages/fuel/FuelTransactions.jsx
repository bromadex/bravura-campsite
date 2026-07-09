import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, fmtDate, showToast } from '../../components/ui'
import FuelQuickNav from './FuelQuickNav'

const FUEL_CLR = MODULE_COLORS.fuel

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
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
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

// ── Quick date helpers ───────────────────────────────────────────────────────

function isoDate(d) { return d.toISOString().slice(0, 10) }
function startOfWeek(d) {
  const r = new Date(d); r.setDate(r.getDate() - r.getDay() + 1); return r
}
function quickRange(key) {
  const now = new Date()
  const today = isoDate(now)
  const yest  = new Date(now); yest.setDate(yest.getDate() - 1)
  const sow   = startOfWeek(now)
  const som   = new Date(now.getFullYear(), now.getMonth(), 1)
  const lmStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const lmEnd   = new Date(now.getFullYear(), now.getMonth(), 0)
  switch (key) {
    case 'today':     return [today, today]
    case 'yesterday': return [isoDate(yest), isoDate(yest)]
    case 'week':      return [isoDate(sow), today]
    case 'month':     return [isoDate(som), today]
    case 'last_month': return [isoDate(lmStart), isoDate(lmEnd)]
    default: return ['', '']
  }
}

const QUICK_FILTERS = [
  { key: 'today',      label: 'Today' },
  { key: 'yesterday',  label: 'Yesterday' },
  { key: 'week',       label: 'This Week' },
  { key: 'month',      label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
]

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ tx, tanks, operators, pumps, canEdit, onClose, onEdit }) {
  if (!tx) return null
  const tank     = tanks.find(t => t.id === tx.tank_id)
  const operator = operators.find(o => o.id === tx.operator_id)
  const pump     = pumps.find(p => p.id === tx.pump_id)

  const assetLabel = tx.fleet_asset
    ? `${tx.fleet_asset.fleet_number || tx.fleet_asset.asset_number}${tx.fleet_asset.registration ? ' (' + tx.fleet_asset.registration + ')' : tx.fleet_asset.serial_number ? ' (' + tx.fleet_asset.serial_number + ')' : ''}`
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
    tx.updated_at && ['Last Edited', new Date(tx.updated_at).toLocaleString()],
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

        {canEdit && (
          <button onClick={() => onEdit(tx)} style={{
            marginTop: '20px', width: '100%', padding: '10px', borderRadius: '10px',
            background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '13px', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}>
            <Icon name="edit" size={15} style={{ color: '#fff' }} /> Edit Transaction
          </button>
        )}
      </div>
    </div>
  )
}

// ── Edit Transaction Modal ──────────────────────────────────────────────────

const editInputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}

function EditField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {children}
    </div>
  )
}

function EditTransactionModal({ tx, tanks, vehicles, equipment, operators, pumps, fleetAssets, onClose, onSave }) {
  const [form, setForm] = useState({
    transaction_date: tx.transaction_date || '',
    tank_id:          tx.tank_id || '',
    litres:           tx.litres != null ? String(tx.litres) : '',
    fleet_asset_id:   tx.fleet_asset_id || '',
    operator_id:      tx.operator_id || '',
    pump_id:          tx.pump_id || '',
    meter_start:      tx.meter_start != null ? String(tx.meter_start) : '',
    meter_end:        tx.meter_end != null ? String(tx.meter_end) : '',
    unit_price:       tx.unit_price != null ? String(tx.unit_price) : '',
    total_cost:       tx.total_cost != null ? String(tx.total_cost) : '',
    supplier:         tx.supplier || '',
    docket_number:    tx.docket_number || '',
    notes:            tx.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [editReason, setEditReason] = useState('')

  function set(k, v) {
    setForm(prev => {
      const next = { ...prev, [k]: v }
      if ((k === 'unit_price' || k === 'litres') && next.unit_price && next.litres) {
        next.total_cost = (Number(next.unit_price) * Number(next.litres)).toFixed(2)
      }
      // fleet_asset_id is a single field — no mutual exclusion needed
      return next
    })
  }

  async function handleSave() {
    if (!form.litres || isNaN(form.litres) || Number(form.litres) <= 0) {
      showToast('Enter valid litres', 'red'); return
    }
    if (!editReason.trim()) {
      showToast('Please provide a reason for this edit', 'red'); return
    }
    setSaving(true)
    try {
      const payload = {
        transaction_date: form.transaction_date,
        tank_id:          form.tank_id || null,
        litres:           Number(form.litres),
        fleet_asset_id:   form.fleet_asset_id || null,
        operator_id:      form.operator_id || null,
        pump_id:          form.pump_id || null,
        meter_start:      form.meter_start ? Number(form.meter_start) : null,
        meter_end:        form.meter_end ? Number(form.meter_end) : null,
        unit_price:       form.unit_price ? Number(form.unit_price) : null,
        total_cost:       form.total_cost ? Number(form.total_cost) : null,
        supplier:         form.supplier.trim() || null,
        docket_number:    form.docket_number.trim() || null,
        notes:            form.notes.trim() || null,
        edit_reason:      editReason.trim(),
      }
      await onSave(tx.id, payload)
      showToast('Transaction updated — tank balance recalculated', 'green')
      onClose()
    } catch (err) {
      showToast(err.message || 'Failed to update', 'red')
    } finally {
      setSaving(false)
    }
  }

  const isIssuance = tx.transaction_type === 'issuance'
  const isDelivery = tx.transaction_type === 'delivery'
  const activeTanks = tanks.filter(t => t.status === 'active' && !t.is_archived)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: THEME.surface, borderRadius: '14px', width: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: THEME.surface, zIndex: 1, borderRadius: '14px 14px 0 0' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Edit Transaction</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px', fontFamily: 'monospace' }}>{tx.transaction_number}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed, padding: '4px' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ padding: '10px 14px', borderRadius: '10px', background: THEME.statusWarningBg, border: `1px solid ${THEME.warning}33`, fontSize: '12px', color: THEME.statusWarningText, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="info" size={14} style={{ color: 'inherit', flexShrink: 0 }} />
            Editing this transaction will create an audit log entry and recalculate the affected tank balance.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <EditField label="Date">
              <input type="date" value={form.transaction_date} onChange={e => set('transaction_date', e.target.value)} style={editInputStyle} />
            </EditField>
            <EditField label="Tank">
              <select value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={editInputStyle}>
                <option value="">— Select —</option>
                {activeTanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </EditField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <EditField label="Litres">
              <input type="number" step="0.001" value={form.litres} onChange={e => set('litres', e.target.value)} style={editInputStyle} />
            </EditField>
            <EditField label="Docket / Reference">
              <input type="text" value={form.docket_number} onChange={e => set('docket_number', e.target.value)} style={editInputStyle} />
            </EditField>
          </div>

          {isIssuance && (
            <>
              <EditField label="Asset">
                <select value={form.fleet_asset_id} onChange={e => set('fleet_asset_id', e.target.value)} style={editInputStyle}>
                  <option value="">— None —</option>
                  <optgroup label="Vehicles">
                    {vehicles.filter(v => !v.is_archived).map(v => <option key={v.id} value={v.id}>{v.fleet_number || v.asset_number}{v.registration ? ' · ' + v.registration : ''}</option>)}
                  </optgroup>
                  <optgroup label="Equipment">
                    {equipment.filter(e => !e.is_archived).map(eq => <option key={eq.id} value={eq.id}>{eq.description || eq.asset_number}{eq.serial_number ? ' · ' + eq.serial_number : ''}</option>)}
                  </optgroup>
                </select>
              </EditField>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <EditField label="Operator">
                  <select value={form.operator_id} onChange={e => set('operator_id', e.target.value)} style={editInputStyle}>
                    <option value="">— None —</option>
                    {operators.filter(o => o.is_active).map(o => <option key={o.id} value={o.id}>{o.employees?.name || o.id}</option>)}
                  </select>
                </EditField>
                <EditField label="Pump">
                  <select value={form.pump_id} onChange={e => set('pump_id', e.target.value)} style={editInputStyle}>
                    <option value="">— None —</option>
                    {pumps.filter(p => !p.is_archived).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </EditField>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <EditField label="Meter Start">
                  <input type="number" step="0.1" value={form.meter_start} onChange={e => set('meter_start', e.target.value)} style={editInputStyle} />
                </EditField>
                <EditField label="Meter End">
                  <input type="number" step="0.1" value={form.meter_end} onChange={e => set('meter_end', e.target.value)} style={editInputStyle} />
                </EditField>
              </div>
            </>
          )}

          {isDelivery && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <EditField label="Supplier">
                <input type="text" value={form.supplier} onChange={e => set('supplier', e.target.value)} style={editInputStyle} />
              </EditField>
              <EditField label="Unit Price">
                <input type="number" step="0.0001" value={form.unit_price} onChange={e => set('unit_price', e.target.value)} style={editInputStyle} />
              </EditField>
            </div>
          )}

          {(isDelivery || tx.total_cost) && (
            <EditField label="Total Cost">
              <input type="number" step="0.01" value={form.total_cost} onChange={e => set('total_cost', e.target.value)} style={editInputStyle} />
            </EditField>
          )}

          <EditField label="Notes">
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} style={{ ...editInputStyle, resize: 'vertical' }} />
          </EditField>

          <EditField label="Reason for edit *">
            <textarea
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              placeholder="Explain why this transaction is being modified…"
              rows={2}
              style={{ ...editInputStyle, resize: 'vertical', borderColor: !editReason.trim() ? THEME.error : THEME.outline }}
            />
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>
              This reason will be recorded in the audit trail.
            </div>
          </EditField>
        </div>

        <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', position: 'sticky', bottom: 0, background: THEME.surface, borderRadius: '0 0 14px 14px' }}>
          <button onClick={onClose} style={{ padding: '9px 18px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.textMed, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 500 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ padding: '9px 18px', borderRadius: '8px', border: 'none', background: FUEL_CLR, color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="save" size={14} style={{ color: '#fff' }} /> {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CSV export ───────────────────────────────────────────────────────────────

function exportCsv(rows, tanks, operators) {
  const headers = ['Docket No', 'Transaction #', 'Date', 'Type', 'Tank', 'Fuel Type', 'Asset', 'Operator', 'Litres', 'Unit Price', 'Total Cost', 'Supplier', 'Notes']
  const lines = rows.map(tx => {
    const tank = tanks.find(t => t.id === tx.tank_id)
    const op   = operators.find(o => o.id === tx.operator_id)
    const asset = tx.fleet_asset
      ? (tx.fleet_asset.fleet_number || tx.fleet_asset.asset_number) + (tx.fleet_asset.registration ? ' ' + tx.fleet_asset.registration : '')
      : tx.asset_description || ''
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
      tx.supplier || '',
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

function printTable(filtered, tanks, operators, siteName) {
  const w = window.open('', '_blank', 'width=1000,height=700')
  if (!w) return
  const rows = filtered.map((tx, i) => {
    const tank = tanks.find(t => t.id === tx.tank_id)
    const op = operators.find(o => o.id === tx.operator_id)
    const asset = tx.fleet_asset
      ? (tx.fleet_asset.fleet_number || tx.fleet_asset.asset_number) + (tx.fleet_asset.registration ? ' · ' + tx.fleet_asset.registration : '')
      : tx.supplier || '—'
    return `<tr>
      <td>${i + 1}</td><td>${tx.transaction_date}</td><td>${tx.transaction_type}</td>
      <td>${tank?.name || '—'}</td><td>${tank?.fuel_types?.name || '—'}</td>
      <td>${asset}</td><td>${op?.employees?.name || '—'}</td>
      <td style="text-align:right">${Number(tx.litres).toFixed(1)}</td>
      <td style="text-align:right">${tx.total_cost ? '$' + Number(tx.total_cost).toFixed(2) : '—'}</td>
    </tr>`
  }).join('')
  w.document.write(`<html><head><title>Transactions</title><style>body{font:11pt monospace;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}</style></head><body>
    <h2>Fuel Transactions — ${siteName || ''}</h2><p>${filtered.length} records · Printed ${new Date().toLocaleString()}</p>
    <table><thead><tr><th>#</th><th>Date</th><th>Type</th><th>Tank</th><th>Fuel</th><th>Asset/Supplier</th><th>Operator</th><th>Litres</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table></body></html>`)
  w.document.close()
  setTimeout(() => w.print(), 300)
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function FuelTransactions({ setPage }) {
  const { can }        = usePermissions()
  const { currentSite } = useSite()
  const { tanks, operators, pumps, vehicles, equipment, fleetAssets, transactions, fuelTypes, loading, updateTransaction } = useFuel()

  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [tankId,      setTankId]      = useState('')
  const [txType,      setTxType]      = useState('')
  const [fuelTypeId,  setFuelTypeId]  = useState('')
  const [vehicleId,   setVehicleId]   = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [operatorId,  setOperatorId]  = useState('')
  const [suppFilter,  setSuppFilter]  = useState('')
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState(null)
  const [quickKey,    setQuickKey]    = useState('')
  const [editing,     setEditing]     = useState(null)

  if (!can('fuel.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const activeTanks     = tanks.filter(t => t.status === 'active' && !t.is_archived)
  const activeVehicles  = vehicles.filter(v => v.status !== 'archived' && !v.is_archived)
  const activeEquipment = equipment.filter(e => !e.is_archived)
  const activeOperators = operators.filter(o => o.is_active)

  const suppliers = useMemo(() => {
    const set = new Set()
    for (const t of transactions) if (t.supplier) set.add(t.supplier.trim())
    return [...set].sort()
  }, [transactions])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return transactions.filter(tx => {
      if (dateFrom && tx.transaction_date < dateFrom) return false
      if (dateTo   && tx.transaction_date > dateTo)   return false
      if (tankId   && tx.tank_id !== tankId)           return false
      if (txType   && tx.transaction_type !== txType)  return false
      if (vehicleId   && tx.fleet_asset_id !== vehicleId)     return false
      if (equipmentId && tx.fleet_asset_id !== equipmentId) return false
      if (operatorId  && tx.operator_id !== operatorId)   return false
      if (suppFilter  && (tx.supplier || '').trim() !== suppFilter) return false
      if (fuelTypeId) {
        const tank = tanks.find(t => t.id === tx.tank_id)
        if (!tank || tank.fuel_type_id !== fuelTypeId) return false
      }
      if (q) {
        const hay = [
          tx.docket_number, tx.transaction_number,
          tx.fleet_asset?.fleet_number, tx.fleet_asset?.asset_number,
          tx.fleet_asset?.registration, tx.fleet_asset?.description,
          tx.supplier, tx.notes,
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [transactions, dateFrom, dateTo, tankId, txType, fuelTypeId, vehicleId, equipmentId, operatorId, suppFilter, search, tanks])

  const summary = useMemo(() => {
    let deliveries = 0, issuances = 0, cost = 0, delCount = 0, issCount = 0
    const dates = new Set()
    for (const t of filtered) {
      const l = Number(t.litres) || 0
      if (t.transaction_type === 'delivery')  { deliveries += l; delCount++ }
      if (t.transaction_type === 'issuance')  { issuances += l; issCount++ }
      cost += Number(t.total_cost || 0)
      if (t.transaction_type === 'issuance') dates.add(t.transaction_date)
    }
    const avgDaily = dates.size > 0 ? issuances / dates.size : 0
    return { deliveries, issuances, cost, delCount, issCount, avgDaily, total: filtered.length }
  }, [filtered])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
      <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  )

  function applyQuick(key) {
    if (quickKey === key) { setQuickKey(''); setDateFrom(''); setDateTo(''); return }
    setQuickKey(key)
    const [from, to] = quickRange(key)
    setDateFrom(from); setDateTo(to)
  }

  function clearFilters() {
    setDateFrom(''); setDateTo(''); setTankId(''); setTxType(''); setFuelTypeId('')
    setVehicleId(''); setEquipmentId(''); setOperatorId(''); setSuppFilter('')
    setSearch(''); setQuickKey('')
  }

  const hasFilters = dateFrom || dateTo || tankId || txType || fuelTypeId || vehicleId || equipmentId || operatorId || suppFilter || search

  return (
    <div style={{ maxWidth: '1200px' }}>
      <FuelQuickNav setPage={setPage} current="fuel_transactions" />
      <PageHeader
        title="Transactions"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {filtered.length > 0 && (
              <>
                <button onClick={() => exportCsv(filtered, tanks, operators)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Icon name="download" size={15} style={{ color: FUEL_CLR }} /> Export
                </button>
                <button onClick={() => printTable(filtered, tanks, operators, currentSite?.name)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: THEME.surfaceVar, color: THEME.textMed, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Icon name="print" size={15} style={{ color: THEME.textMed }} /> Print
                </button>
              </>
            )}
            {can('fuel.create') && (
              <button onClick={() => setPage('fuel_issuance')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: FUEL_CLR, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                <Icon name="output" size={15} style={{ color: '#fff' }} /> New Issuance
              </button>
            )}
          </div>
        }
      />

      {/* ── Dashboard Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        <SummaryCard icon="receipt_long"   label="Total Litres"       value={`${(summary.deliveries + summary.issuances).toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} color={FUEL_CLR} sub={`${summary.total} transactions`} />
        <SummaryCard icon="payments"       label="Total Cost"         value={summary.cost > 0 ? `$${summary.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'} color={THEME.info} />
        <SummaryCard icon="arrow_downward" label="Total Deliveries"   value={`${summary.deliveries.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} color={THEME.success} sub={`${summary.delCount} deliver${summary.delCount !== 1 ? 'ies' : 'y'}`} />
        <SummaryCard icon="output"         label="Total Issuances"    value={`${summary.issuances.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} color={THEME.warning} sub={`${summary.issCount} issuance${summary.issCount !== 1 ? 's' : ''}`} />
        <SummaryCard icon="speed"          label="Avg Daily Usage"    value={summary.avgDaily > 0 ? `${summary.avgDaily.toFixed(0)} L/day` : '—'} color="#5E35B1" />
      </div>

      {/* ── Quick Filters ── */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {QUICK_FILTERS.map(qf => (
          <button key={qf.key} onClick={() => applyQuick(qf.key)} style={{
            padding: '6px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
            border: quickKey === qf.key ? `2px solid ${FUEL_CLR}` : `1px solid ${THEME.outlineVar}`,
            background: quickKey === qf.key ? FUEL_CLR + '14' : 'transparent',
            color: quickKey === qf.key ? FUEL_CLR : THEME.textMed,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            {qf.label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div style={{
        display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end',
        marginBottom: '16px', padding: '14px 16px', background: THEME.surface,
        borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
      }}>
        <FilterField label="Search" flex="2 1 200px">
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Docket, fleet #, tx #, notes…" style={{ ...selStyle, paddingLeft: '32px', width: '100%', boxSizing: 'border-box' }} />
          </div>
        </FilterField>
        <FilterField label="From" flex="1 1 130px">
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setQuickKey('') }} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} />
        </FilterField>
        <FilterField label="To" flex="1 1 130px">
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setQuickKey('') }} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }} />
        </FilterField>
        <FilterField label="Type" flex="1 1 130px">
          <select value={txType} onChange={e => setTxType(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">All types</option>
            <option value="issuance">Issuance</option>
            <option value="delivery">Delivery</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </FilterField>
        <FilterField label="Tank" flex="1 1 140px">
          <select value={tankId} onChange={e => setTankId(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">All tanks</option>
            {activeTanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </FilterField>
        {fuelTypes.length > 1 && (
          <FilterField label="Fuel Type" flex="1 1 130px">
            <select value={fuelTypeId} onChange={e => setFuelTypeId(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
              <option value="">All fuel types</option>
              {fuelTypes.map(ft => <option key={ft.id} value={ft.id}>{ft.name}</option>)}
            </select>
          </FilterField>
        )}
        <FilterField label="Vehicle" flex="1 1 150px">
          <select value={vehicleId} onChange={e => setVehicleId(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">All vehicles</option>
            {activeVehicles.map(v => <option key={v.id} value={v.id}>{v.fleet_number}{v.registration ? ' · ' + v.registration : ''}</option>)}
          </select>
        </FilterField>
        <FilterField label="Equipment" flex="1 1 150px">
          <select value={equipmentId} onChange={e => setEquipmentId(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">All equipment</option>
            {activeEquipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name}</option>)}
          </select>
        </FilterField>
        <FilterField label="Operator" flex="1 1 150px">
          <select value={operatorId} onChange={e => setOperatorId(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
            <option value="">All operators</option>
            {activeOperators.map(op => <option key={op.id} value={op.id}>{op.employees?.name || op.id}</option>)}
          </select>
        </FilterField>
        {suppliers.length > 0 && (
          <FilterField label="Supplier" flex="1 1 150px">
            <select value={suppFilter} onChange={e => setSuppFilter(e.target.value)} style={{ ...selStyle, width: '100%', boxSizing: 'border-box' }}>
              <option value="">All suppliers</option>
              {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </FilterField>
        )}
        {hasFilters && (
          <button onClick={clearFilters} style={{ alignSelf: 'flex-end', background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '8px', padding: '8px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textMed, fontFamily: 'inherit' }}>
            Clear
          </button>
        )}
      </div>

      <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '8px', textAlign: 'right' }}>
        {filtered.length} of {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
      </div>

      {/* ── Table ── */}
      <div style={{ background: THEME.surface, borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
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
                const asset    = tx.fleet_asset
                  ? `${tx.fleet_asset.fleet_number || tx.fleet_asset.asset_number}${tx.fleet_asset.registration ? ' · ' + tx.fleet_asset.registration : ''}`
                  : tx.supplier || tx.asset_description || '—'

                return (
                  <TRow key={tx.id} last={idx === filtered.length - 1} onClick={() => setSelected(tx)} style={{ cursor: 'pointer' }}>
                    <Td>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: FUEL_CLR, fontWeight: 600 }}>
                        {tx.docket_number || tx.transaction_number}
                      </span>
                      {tx.updated_at && (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '2px', marginLeft: '6px',
                          padding: '1px 6px', borderRadius: '10px', fontSize: '9px', fontWeight: 600,
                          background: THEME.statusWarningBg, color: THEME.statusWarningText,
                        }}>
                          <Icon name="edit_note" size={9} style={{ color: THEME.statusWarningText }} /> Edited
                        </span>
                      )}
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

      <DetailPanel tx={selected} tanks={tanks} operators={operators} pumps={pumps} canEdit={can('fuel.edit')} onClose={() => setSelected(null)} onEdit={(tx) => { setSelected(null); setEditing(tx) }} />

      {editing && (
        <EditTransactionModal
          tx={editing}
          tanks={tanks}
          vehicles={vehicles}
          equipment={equipment}
          operators={operators}
          pumps={pumps}
          fleetAssets={fleetAssets}
          onClose={() => setEditing(null)}
          onSave={updateTransaction}
        />
      )}
    </div>
  )
}

function SummaryCard({ icon, label, value, color, sub }) {
  return (
    <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 2px rgba(0,0,0,.03)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <Icon name={icon} size={15} style={{ color, opacity: .8 }} />
        <span style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '3px' }}>{sub}</div>}
    </div>
  )
}

function FilterField({ label, flex, children }) {
  return (
    <div style={{ flex }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {children}
    </div>
  )
}
