import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'
import { parseTxnNotes } from './fuelDisplay'

const FUEL_CLR = MODULE_COLORS.fuel

// Fuel transactions are IMMUTABLE — no edit or delete after creation.
// A delivery that was entered incorrectly must be corrected via an adjustment.

const BLANK_FORM = {
  transaction_date: new Date().toISOString().slice(0, 10),
  tank_id:          '',
  litres:           '',
  unit_price:       '',
  total_cost:       '',
  supplier:         '',
  docket_number:    '',
  notes:            '',
}

export default function FuelReceipts() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, receipts, addTransaction, loading } = useFuel()

  const canDeliver = can('fuel.create')
  const canView    = can('fuel.view')

  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [search,   setSearch]   = useState('')

  if (!canView) return null

  function openAdd() {
    setForm({ ...BLANK_FORM, transaction_date: new Date().toISOString().slice(0, 10) })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.tank_id)  { showToast('Select a tank', 'red'); return }
    if (!form.litres || isNaN(form.litres) || Number(form.litres) <= 0) {
      showToast('Enter a valid quantity in litres', 'red'); return
    }
    setSaving(true)
    try {
      await addTransaction({
        transaction_type: 'delivery',
        transaction_date: form.transaction_date,
        tank_id:          form.tank_id,
        litres:           Number(form.litres),
        unit_price:       form.unit_price ? Number(form.unit_price) : null,
        total_cost:       form.total_cost ? Number(form.total_cost) : (form.unit_price && form.litres ? Number(form.unit_price) * Number(form.litres) : null),
        supplier:         form.supplier.trim()      || null,
        docket_number:    form.docket_number.trim() || null,
        notes:            form.notes.trim()         || null,
      })
      showToast('Delivery recorded', 'green')
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to record delivery', 'red')
    } finally {
      setSaving(false)
    }
  }

  const tankOf   = id => tanks.find(t => t.id === id)
  const tankName = id => tankOf(id)?.name || '—'

  const q = search.toLowerCase().trim()
  const filtered = receipts.filter(r => {
    if (dateFrom && r.transaction_date < dateFrom) return false
    if (dateTo   && r.transaction_date > dateTo)   return false
    if (q) {
      const hay = `${r.supplier || ''} ${r.notes || ''} ${r.docket_number || ''} ${tankName(r.tank_id)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  function exportCsv() {
    const headers = ['Date', 'Tank', 'Fuel Type', 'Quantity (L)', 'Amount (USD)', 'Supplier', 'Docket #', 'Notes']
    const lines = filtered.map(r => {
      const tank = tankOf(r.tank_id)
      return [
        r.transaction_date,
        tank?.name || '',
        tank?.fuel_types?.name || 'Diesel',
        Number(r.litres).toFixed(1),
        r.total_cost != null ? Number(r.total_cost).toFixed(2) : '',
        r.supplier || '',
        r.docket_number || '',
        r.notes || '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')
    })
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fuel-deliveries-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeTanks = tanks.filter(t => t.status === 'active' && !t.is_archived)

  // ── KPI strip ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const monthStart = new Date().toISOString().slice(0, 8) + '01'
    let totalL = 0, monthL = 0, monthCount = 0, last = null
    const suppliers = new Set()
    for (const r of receipts) {
      const l = Number(r.litres) || 0
      totalL += l
      if (r.supplier) suppliers.add(r.supplier.trim().toLowerCase())
      if (r.transaction_date >= monthStart) { monthL += l; monthCount++ }
      if (!last || r.transaction_date > last.transaction_date) last = r
    }
    return { totalL, monthL, monthCount, suppliers: suppliers.size, last }
  }, [receipts])

  if (loading) return null

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="Fuel Deliveries"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {filtered.length > 0 && (
              <button onClick={exportCsv} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
                background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <Icon name="download" size={15} style={{ color: FUEL_CLR }} /> Export
              </button>
            )}
            {canDeliver && <Button onClick={openAdd} icon="local_gas_station">Add Delivery</Button>}
          </div>
        }
      />

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <DeliveryKpi icon="water_drop"  label="Total delivered"  value={`${kpis.totalL.toLocaleString()} L`} color={THEME.success} sub={`${receipts.length} deliver${receipts.length === 1 ? 'y' : 'ies'}`} />
        <DeliveryKpi icon="bar_chart"   label="This month"       value={`${kpis.monthL.toLocaleString()} L`} color={FUEL_CLR} sub={kpis.monthCount ? `${kpis.monthCount} deliver${kpis.monthCount === 1 ? 'y' : 'ies'}` : 'None yet'} />
        <DeliveryKpi icon="event"       label="Last delivery"    value={kpis.last ? fmtDate(kpis.last.transaction_date) : '—'} color={THEME.info} sub={kpis.last?.supplier || null} small />
        <DeliveryKpi icon="storefront"  label="Suppliers"        value={kpis.suppliers || '—'} color="#5E35B1" />
      </div>

      {/* Search + date range filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Search</div>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Supplier, docket, notes…"
              style={{ ...filterInputStyle, paddingLeft: '32px', width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInputStyle} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInputStyle} />
        </div>
        {(dateFrom || dateTo || search) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setSearch('') }} style={clearBtnStyle}>Clear</button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow, alignSelf: 'flex-end', paddingBottom: '2px' }}>
          {filtered.length} delivery record{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        {receipts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="local_gas_station" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No fuel deliveries recorded yet.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="search_off" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No deliveries in this date range.</p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Tank</Th>
              <Th>Fuel Type</Th>
              <Th align="right">Quantity</Th>
              <Th align="right">Amount (USD)</Th>
              <Th>Supplier</Th>
              <Th>Docket</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {filtered.map((r, idx) => {
                const parsed = parseTxnNotes(r.notes)
                const tank = tankOf(r.tank_id)
                return (
                  <TRow key={r.id} last={idx === filtered.length - 1}>
                    <Td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.transaction_date)}</Td>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icon name="propane_tank" size={16} style={{ color: FUEL_CLR }} />
                        <span style={{ fontWeight: 500 }}>{tankName(r.tank_id)}</span>
                      </div>
                    </Td>
                    <Td>
                      <span style={{
                        padding: '2px 9px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
                        background: THEME.surfaceVar, color: THEME.textMed, letterSpacing: '.04em',
                        textTransform: 'uppercase',
                      }}>
                        {tank?.fuel_types?.name || 'Diesel'}
                      </span>
                    </Td>
                    <Td align="right" style={{ fontWeight: 700, color: THEME.success, whiteSpace: 'nowrap' }}>
                      +{Number(r.litres).toLocaleString(undefined, { maximumFractionDigits: 1 })} L
                    </Td>
                    <Td align="right" style={{ color: THEME.textMed, whiteSpace: 'nowrap' }}>
                      {r.total_cost != null ? `$${Number(r.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </Td>
                    <Td>
                      {r.supplier ? (
                        <span style={{
                          padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                          background: THEME.statusInfoBg, color: THEME.statusInfoText,
                        }}>
                          {r.supplier}
                        </span>
                      ) : <span style={{ color: THEME.textLow }}>—</span>}
                    </Td>
                    <Td style={{ color: THEME.textMed, fontFamily: 'monospace', fontSize: '12px' }}>
                      {r.docket_number || '—'}
                    </Td>
                    <Td style={{ maxWidth: '200px' }}>
                      {parsed.legacy ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '3px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
                          background: THEME.surfaceVar, color: THEME.textLow,
                        }}>
                          <Icon name="history" size={11} style={{ color: THEME.textLow }} />
                          Imported
                        </span>
                      ) : (
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: THEME.textMed }}>
                          {parsed.clean || '—'}
                        </span>
                      )}
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Record Delivery Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Record Fuel Delivery"
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record Delivery'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Delivery Date</SectionLabel>
            <input
              type="date" value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>Tank *</SectionLabel>
            <select value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={inputStyle}>
              <option value="">— Select tank —</option>
              {activeTanks.map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.fuel_types?.name || 'Diesel'})</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <SectionLabel>Quantity Received (Litres) *</SectionLabel>
          <input
            type="number" min="0.1" step="0.1"
            value={form.litres}
            onChange={e => set('litres', e.target.value)}
            placeholder="e.g. 5000"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Unit Price (per litre)</SectionLabel>
            <input
              type="number" min="0" step="0.01"
              value={form.unit_price}
              onChange={e => {
                set('unit_price', e.target.value)
                if (e.target.value && form.litres) set('total_cost', String((Number(e.target.value) * Number(form.litres)).toFixed(2)))
              }}
              placeholder="e.g. 1.85"
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>Total Cost (USD)</SectionLabel>
            <input
              type="number" min="0" step="0.01"
              value={form.total_cost}
              onChange={e => set('total_cost', e.target.value)}
              placeholder="Auto-calculated or enter"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Supplier</SectionLabel>
            <input value={form.supplier} onChange={e => set('supplier', e.target.value)} placeholder="e.g. NOIC" style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Delivery Docket / Reference</SectionLabel>
            <input value={form.docket_number} onChange={e => set('docket_number', e.target.value)} placeholder="e.g. DN-12345" style={inputStyle} />
          </div>
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Any additional notes…"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </Modal>
    </div>
  )
}

function DeliveryKpi({ icon, label, value, sub, color, small }) {
  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '12px', padding: '14px 16px',
      display: 'flex', gap: '12px', alignItems: 'flex-start',
      boxShadow: '0 1px 2px rgba(0,0,0,.03)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '10px', flexShrink: 0,
        background: color + '16',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={18} style={{ color }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '3px' }}>
          {label}
        </div>
        <div style={{
          fontSize: small ? '14px' : '20px', fontWeight: small ? 600 : 700,
          color: THEME.text, lineHeight: 1.15,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{sub}</div>}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}

const filterInputStyle = {
  padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', background: THEME.surface,
}

const clearBtnStyle = {
  background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
  padding: '9px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textMed,
  fontFamily: 'inherit', alignSelf: 'flex-end',
}
