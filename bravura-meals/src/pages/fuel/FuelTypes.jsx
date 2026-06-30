import { useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const SWATCHES = [
  '#FF8C00', '#1A6B52', '#D97706', '#0EA5E9',
  '#9333EA', '#DC2626', '#0891B2', '#65A30D',
  '#475569', '#F59E0B',
]

const BLANK_FORM = {
  name:    '',
  code:    '',
  colour:  SWATCHES[0],
  density: '',
}

export default function FuelTypes() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { fuelTypes, addFuelType, updateFuelType, deactivateFuelType } = useFuel()

  const canEdit = can('fuel.edit')

  const [modal,    setModal]    = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [removing, setRemoving] = useState(null)

  function openAdd() {
    setEditItem(null)
    setForm(BLANK_FORM)
    setModal(true)
  }

  function openEdit(ft) {
    setEditItem(ft)
    setForm({
      name:    ft.name,
      code:    ft.code,
      colour:  ft.colour || SWATCHES[0],
      density: ft.density != null ? String(ft.density) : '',
    })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.name.trim()) { showToast('Enter a fuel name', 'red'); return }
    if (!form.code.trim()) { showToast('Enter a fuel code (e.g. DIESEL)', 'red'); return }
    setSaving(true)
    try {
      const data = {
        name:    form.name.trim(),
        code:    form.code.trim().toUpperCase(),
        colour:  form.colour,
        density: form.density ? Number(form.density) : null,
      }
      if (editItem) {
        await updateFuelType(editItem.id, data)
        showToast('Fuel type updated', 'green')
      } else {
        await addFuelType(data)
        showToast('Fuel type added', 'green')
      }
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmRemove() {
    try {
      await deactivateFuelType(removing.id)
      showToast('Fuel type deactivated', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to deactivate', 'red')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div style={{ padding: '20px', maxWidth: '900px' }}>
      <PageHeader
        title="Fuel Types"
        site={currentSite}
        actions={canEdit && <Button onClick={openAdd} icon="add">Add Fuel Type</Button>}
      />

      <div style={{
        padding: '12px 16px', borderRadius: '12px', marginBottom: '16px',
        background: THEME.statusInfoBg, color: THEME.statusInfoText, fontSize: '12px',
      }}>
        Fuel types are shared across all sites. Adding a type makes it available
        everywhere — only do so when introducing a genuinely new fuel.
      </div>

      <Card style={{ padding: 0 }}>
        {fuelTypes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="oil_barrel" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No fuel types configured.</p>
          </div>
        ) : (
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Code</Th>
              <Th>Name</Th>
              <Th>Colour</Th>
              <Th align="right">Density (kg/L)</Th>
              {canEdit && <Th />}
            </THead>
            <tbody>
              {fuelTypes.map((ft, idx) => (
                <TRow
                  key={ft.id}
                  last={idx === fuelTypes.length - 1}
                  onClick={canEdit ? () => openEdit(ft) : undefined}
                >
                  <Td>
                    <span style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: THEME.textMed }}>
                      {ft.code}
                    </span>
                  </Td>
                  <Td><span style={{ fontWeight: 500 }}>{ft.name}</span></Td>
                  <Td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        display: 'inline-block', width: '20px', height: '20px',
                        borderRadius: '6px', background: ft.colour || THEME.outline,
                        border: `1px solid ${THEME.outline}`,
                      }} />
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: THEME.textMed }}>
                        {ft.colour || '—'}
                      </span>
                    </span>
                  </Td>
                  <Td align="right" style={{ color: THEME.textMed }}>
                    {ft.density != null ? Number(ft.density).toFixed(4) : '—'}
                  </Td>
                  {canEdit && (
                    <Td>
                      <button
                        onClick={e => { e.stopPropagation(); setRemoving(ft) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', opacity: .6 }}
                        title="Deactivate fuel type"
                      >
                        <Icon name="archive" size={16} style={{ color: THEME.error }} />
                      </button>
                    </Td>
                  )}
                </TRow>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Fuel Type' : 'Add Fuel Type'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update' : 'Add'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Petrol Unleaded" style={inputStyle} autoFocus />
          </div>
          <div>
            <SectionLabel>Code *</SectionLabel>
            <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. PETROL_95" style={inputStyle} />
          </div>
        </div>

        <div>
          <SectionLabel>Colour</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
            {SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => set('colour', c)}
                style={{
                  width: '32px', height: '32px', borderRadius: '8px', background: c,
                  border: form.colour === c ? `3px solid ${THEME.text}` : `1px solid ${THEME.outline}`,
                  cursor: 'pointer', padding: 0,
                }}
                title={c}
              />
            ))}
            <input
              type="color"
              value={form.colour}
              onChange={e => set('colour', e.target.value)}
              style={{ width: '32px', height: '32px', padding: 0, border: `1px solid ${THEME.outline}`, borderRadius: '8px', cursor: 'pointer' }}
              title="Custom colour"
            />
          </div>
        </div>

        <div>
          <SectionLabel>Density (kg per litre, optional)</SectionLabel>
          <input
            type="number" min="0" step="0.0001"
            value={form.density}
            onChange={e => set('density', e.target.value)}
            placeholder="e.g. 0.832 for diesel"
            style={inputStyle}
          />
        </div>
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title="Deactivate Fuel Type"
        message={removing
          ? `Deactivate "${removing.name}"? It will be hidden from new tank dropdowns but existing tanks keep their assignment. Historical data is preserved.`
          : ''}
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
