import { useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

// Fuel transactions are IMMUTABLE — no edit or delete after creation.
// A delivery that was entered incorrectly must be corrected via an adjustment.

const BLANK_FORM = {
  transaction_date: new Date().toISOString().slice(0, 10),
  tank_id:          '',
  litres:           '',
  supplier:         '',
  docket_number:    '',
  notes:            '',
}

export default function FuelReceipts() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, receipts, addTransaction, loading } = useFuel()

  const canDeliver = can('fuel.receive_delivery')
  const canView    = can('fuel.view_dashboard')

  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

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

  const tankName = id => tanks.find(t => t.id === id)?.name || '—'

  const filtered = receipts.filter(r => {
    if (dateFrom && r.transaction_date < dateFrom) return false
    if (dateTo   && r.transaction_date > dateTo)   return false
    return true
  })

  const activeTanks = tanks.filter(t => t.status === 'active' && !t.is_archived)

  if (loading) return null

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="Fuel Deliveries"
        site={currentSite}
        actions={canDeliver && (
          <Button onClick={openAdd} icon="local_gas_station">Record Delivery</Button>
        )}
      />

      {/* Immutability note */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 14px', borderRadius: '10px', marginBottom: '16px',
        background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
        fontSize: '12px', color: THEME.textMed,
      }}>
        <Icon name="lock" size={14} style={{ color: THEME.textMed, flexShrink: 0 }} />
        Delivery records are locked after creation. Record an adjustment if a correction is needed.
      </div>

      {/* Date range filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInputStyle} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInputStyle} />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo('') }} style={clearBtnStyle}>Clear</button>
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
              <Th>Docket</Th>
              <Th>Tank</Th>
              <Th align="right">Quantity (L)</Th>
              <Th>Supplier</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {filtered.map((r, idx) => (
                <TRow key={r.id} last={idx === filtered.length - 1}>
                  <Td>{fmtDate(r.transaction_date)}</Td>
                  <Td style={{ color: THEME.textMed, fontFamily: 'monospace', fontSize: '12px' }}>
                    {r.docket_number || '—'}
                  </Td>
                  <Td><span style={{ fontWeight: 500 }}>{tankName(r.tank_id)}</span></Td>
                  <Td align="right" style={{ fontWeight: 600, color: THEME.success }}>
                    +{Number(r.litres).toFixed(1)}
                  </Td>
                  <Td style={{ color: THEME.textMed }}>{r.supplier || '—'}</Td>
                  <Td style={{ color: THEME.textMed, maxWidth: '200px' }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.notes || '—'}
                    </span>
                  </Td>
                </TRow>
              ))}
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
