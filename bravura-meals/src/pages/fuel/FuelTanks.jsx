import { useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const FUEL_TYPES = ['Diesel', 'Petrol', 'HFO', 'Paraffin', 'Other']

const BLANK_FORM = {
  name: '', designation: '', capacity_litres: '',
  fuel_type: 'Diesel', is_active: true,
}

export default function FuelTanks() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, addTank, updateTank, deleteTank, loading } = useFuel()

  const canManage = can('fuel.delete')

  const [modal,    setModal]    = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(null)

  function openAdd() { setEditItem(null); setForm(BLANK_FORM); setModal(true) }

  function openEdit(tank) {
    setEditItem(tank)
    setForm({
      name:            tank.name,
      designation:     tank.designation || '',
      capacity_litres: tank.capacity_litres != null ? String(tank.capacity_litres) : '',
      fuel_type:       tank.fuel_type,
      is_active:       tank.is_active,
    })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.name.trim()) { showToast('Enter a tank name', 'red'); return }
    setSaving(true)
    try {
      const data = {
        name:            form.name.trim(),
        designation:     form.designation.trim() || null,
        capacity_litres: form.capacity_litres ? Number(form.capacity_litres) : null,
        fuel_type:       form.fuel_type,
        is_active:       form.is_active,
      }
      if (editItem) await updateTank(editItem.id, data)
      else          await addTank(data)
      showToast(editItem ? 'Tank updated' : 'Tank added', 'green')
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    try {
      await deleteTank(deleting.id)
      showToast('Tank deleted', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'red')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '900px' }}>
      <PageHeader
        title="Fuel Tanks"
        site={currentSite}
        actions={canManage && (
          <Button onClick={openAdd} icon="add">Add Tank</Button>
        )}
      />

      <Card style={{ padding: 0 }}>
        {tanks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="propane_tank" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No tanks configured. Add your first tank to start tracking fuel.</p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Name</Th>
              <Th>Designation</Th>
              <Th>Fuel Type</Th>
              <Th align="right">Capacity (L)</Th>
              <Th>Status</Th>
              {canManage && <Th />}
            </THead>
            <tbody>
              {tanks.map((tank, idx) => (
                <TRow key={tank.id} last={idx === tanks.length - 1} onClick={canManage ? () => openEdit(tank) : undefined}>
                  <Td><span style={{ fontWeight: 500 }}>{tank.name}</span></Td>
                  <Td style={{ color: THEME.textMed }}>{tank.designation || '—'}</Td>
                  <Td>
                    <span style={{
                      padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                      background: THEME.surfaceVar, color: THEME.primary,
                    }}>
                      {tank.fuel_type}
                    </span>
                  </Td>
                  <Td align="right" style={{ fontWeight: 500 }}>
                    {tank.capacity_litres != null ? Number(tank.capacity_litres).toLocaleString() : '—'}
                  </Td>
                  <Td>
                    <span style={{
                      padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                      background: tank.is_active ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                      color:      tank.is_active ? THEME.statusSuccessText : THEME.statusNeutralText,
                    }}>
                      {tank.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </Td>
                  {canManage && (
                    <Td>
                      <button
                        onClick={e => { e.stopPropagation(); setDeleting(tank) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: THEME.error, opacity: .7 }}
                        title="Delete tank"
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

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Tank' : 'Add Tank'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : (editItem ? 'Update' : 'Add Tank')}</Button>
          </>
        }
      >
        <div>
          <SectionLabel>Tank Name *</SectionLabel>
          <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Main Diesel Tank" style={inputStyle} autoFocus />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Designation / Short Code</SectionLabel>
            <input value={form.designation} onChange={e => set('designation', e.target.value)} placeholder="e.g. T-001" style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Fuel Type</SectionLabel>
            <select value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)} style={inputStyle}>
              {FUEL_TYPES.map(ft => <option key={ft} value={ft}>{ft}</option>)}
            </select>
          </div>
        </div>

        <div>
          <SectionLabel>Capacity (Litres)</SectionLabel>
          <input
            type="number" min="0" step="1"
            value={form.capacity_litres}
            onChange={e => set('capacity_litres', e.target.value)}
            placeholder="e.g. 10000"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="checkbox" id="tank-active" checked={form.is_active}
            onChange={e => set('is_active', e.target.checked)}
            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
          />
          <label htmlFor="tank-active" style={{ fontSize: '14px', color: THEME.text, cursor: 'pointer' }}>
            Active (appears in tank selection dropdowns)
          </label>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete Tank"
        message={deleting ? `Delete "${deleting.name}"? All associated receipts, issues, and dip readings will lose their tank reference.` : ''}
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
