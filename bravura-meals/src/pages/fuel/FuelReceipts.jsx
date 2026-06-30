import { useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { useAuth } from '../../auth/AuthContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const BLANK_FORM = {
  receipt_date: new Date().toISOString().slice(0, 10),
  tank_id: '',
  quantity_litres: '',
  supplier: '',
  delivery_note_ref: '',
  notes: '',
}

export default function FuelReceipts() {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, receipts, addReceipt, deleteReceipt, loading } = useFuel()

  const canCreate = can('fuel.create')
  const canDelete = can('fuel.delete')

  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(null)

  function openAdd() {
    setForm({ ...BLANK_FORM, receipt_date: new Date().toISOString().slice(0, 10) })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.tank_id)        { showToast('Select a tank', 'red'); return }
    if (!form.quantity_litres || isNaN(form.quantity_litres) || Number(form.quantity_litres) <= 0) {
      showToast('Enter a valid quantity', 'red'); return
    }
    setSaving(true)
    try {
      await addReceipt({
        tank_id:           form.tank_id,
        receipt_date:      form.receipt_date,
        quantity_litres:   Number(form.quantity_litres),
        supplier:          form.supplier.trim() || null,
        delivery_note_ref: form.delivery_note_ref.trim() || null,
        notes:             form.notes.trim() || null,
        recorded_by:       profile?.id,
        recorded_by_name:  profile?.full_name || null,
      })
      showToast('Receipt recorded', 'green')
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    try {
      await deleteReceipt(deleting.id)
      showToast('Receipt deleted', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'red')
    } finally {
      setDeleting(null)
    }
  }

  const tankName = id => tanks.find(t => t.id === id)?.name || '—'

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1100px' }}>
      <PageHeader
        title="Fuel Receipts"
        site={currentSite}
        actions={canCreate && (
          <Button onClick={openAdd} icon="add">Record Receipt</Button>
        )}
      />

      <Card style={{ padding: 0 }}>
        {receipts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="local_gas_station" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No fuel receipts recorded yet.</p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Tank</Th>
              <Th align="right">Quantity (L)</Th>
              <Th>Supplier</Th>
              <Th>Delivery Note</Th>
              <Th>Recorded By</Th>
              <Th>Notes</Th>
              {canDelete && <Th />}
            </THead>
            <tbody>
              {receipts.map((r, idx) => (
                <TRow key={r.id} last={idx === receipts.length - 1}>
                  <Td>{fmtDate(r.receipt_date)}</Td>
                  <Td><span style={{ fontWeight: 500 }}>{tankName(r.tank_id)}</span></Td>
                  <Td align="right" style={{ fontWeight: 600, color: THEME.success }}>
                    +{Number(r.quantity_litres).toFixed(1)}
                  </Td>
                  <Td style={{ color: THEME.textMed }}>{r.supplier || '—'}</Td>
                  <Td style={{ color: THEME.textMed }}>{r.delivery_note_ref || '—'}</Td>
                  <Td style={{ color: THEME.textMed }}>{r.recorded_by_name || '—'}</Td>
                  <Td style={{ color: THEME.textMed, maxWidth: '180px' }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.notes || '—'}
                    </span>
                  </Td>
                  {canDelete && (
                    <Td>
                      <button
                        onClick={() => setDeleting(r)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: THEME.error, opacity: .7 }}
                        title="Delete receipt"
                      >
                        <Icon name="delete" size={16} style={{ color: 'inherit' }} />
                      </button>
                    </Td>
                  )}
                </TRow>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Add Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Record Fuel Receipt"
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Receipt'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Date</SectionLabel>
            <input
              type="date" value={form.receipt_date}
              onChange={e => set('receipt_date', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>Tank *</SectionLabel>
            <select value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={inputStyle}>
              <option value="">— Select tank —</option>
              {tanks.filter(t => t.is_active).map(t => (
                <option key={t.id} value={t.id}>{t.name} ({t.fuel_type})</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <SectionLabel>Quantity Received (Litres) *</SectionLabel>
          <input
            type="number" min="0.1" step="0.1"
            value={form.quantity_litres}
            onChange={e => set('quantity_litres', e.target.value)}
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
            <SectionLabel>Delivery Note / Reference</SectionLabel>
            <input value={form.delivery_note_ref} onChange={e => set('delivery_note_ref', e.target.value)} placeholder="DN-12345" style={inputStyle} />
          </div>
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="Any additional notes…"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete Receipt"
        message={deleting ? `Delete the ${Number(deleting.quantity_litres).toFixed(1)} L receipt from ${fmtDate(deleting.receipt_date)}? This will affect the calculated tank balance.` : ''}
      />
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}
