import { useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const BLANK_FORM = {
  reading_date: new Date().toISOString().slice(0, 10),
  tank_id: '',
  reading_litres: '',
  notes: '',
}

export default function DipReadings() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, dipReadings, tankBalance, addDipReading, loading } = useFuel()

  const canCreate = can('fuel.record_dip')

  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [tankFilter, setTankFilter] = useState('all')

  function openAdd() {
    setForm({ ...BLANK_FORM, reading_date: new Date().toISOString().slice(0, 10) })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.tank_id) { showToast('Select a tank', 'red'); return }
    if (!form.reading_litres || isNaN(form.reading_litres) || Number(form.reading_litres) < 0) {
      showToast('Enter a valid reading', 'red'); return
    }
    setSaving(true)
    try {
      await addDipReading({
        tank_id:        form.tank_id,
        reading_date:   form.reading_date,
        reading_litres: Number(form.reading_litres),
        notes:          form.notes.trim() || null,
      })
      showToast('Dip reading recorded', 'green')
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  const tankName = id => tanks.find(t => t.id === id)?.name || '—'
  const filtered = tankFilter === 'all' ? dipReadings : dipReadings.filter(d => d.tank_id === tankFilter)

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1100px' }}>
      <PageHeader
        title="Dip Stick Readings"
        site={currentSite}
        actions={canCreate && (
          <Button onClick={openAdd} icon="straighten">Record Dip</Button>
        )}
      />

      {/* Tank filter */}
      {tanks.length > 1 && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <button
            onClick={() => setTankFilter('all')}
            style={chipStyle(tankFilter === 'all')}
          >
            All Tanks
          </button>
          {tanks.filter(t => t.status === 'active' && !t.is_archived).map(t => (
            <button key={t.id} onClick={() => setTankFilter(t.id)} style={chipStyle(tankFilter === t.id)}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* Per-tank summary */}
      {tanks.filter(t => t.is_active).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
          {tanks.filter(t => t.is_active).map(tank => {
            const calc  = tankBalance(tank.id)
            const latest = dipReadings.filter(d => d.tank_id === tank.id).sort((a,b) => b.reading_date.localeCompare(a.reading_date))[0]
            const variance = latest ? calc - Number(latest.reading_litres) : null
            return (
              <div key={tank.id} style={{
                background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
                borderRadius: '14px', padding: '14px', boxShadow: THEME.shadow1,
              }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>{tank.name}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                  <span>Calculated:</span><span style={{ fontWeight: 600, color: THEME.text }}>{calc.toFixed(1)} L</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                  <span>Last Dip:</span><span style={{ fontWeight: 600, color: THEME.text }}>{latest ? `${Number(latest.reading_litres).toFixed(1)} L` : '—'}</span>
                </div>
                {variance !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '6px' }}>
                    <span style={{ color: THEME.textMed }}>Variance:</span>
                    <span style={{ fontWeight: 600, color: Math.abs(variance) > 10 ? THEME.error : THEME.success }}>
                      {variance > 0 ? '+' : ''}{variance.toFixed(1)} L
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Card style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="straighten" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No dip readings recorded yet.</p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Tank</Th>
              <Th align="right">Dip Reading (L)</Th>
              <Th align="right">Calculated Balance (L)</Th>
              <Th align="right">Variance (L)</Th>
              <Th>Recorded By</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {filtered.map((d, idx) => {
                const calc = tankBalance(d.tank_id)
                const variance = calc - Number(d.reading_litres)
                return (
                  <TRow key={d.id} last={idx === filtered.length - 1}>
                    <Td>{fmtDate(d.reading_date)}</Td>
                    <Td><span style={{ fontWeight: 500 }}>{tankName(d.tank_id)}</span></Td>
                    <Td align="right" style={{ fontWeight: 600 }}>{Number(d.reading_litres).toFixed(1)}</Td>
                    <Td align="right" style={{ color: THEME.textMed }}>{calc.toFixed(1)}</Td>
                    <Td align="right">
                      <span style={{
                        fontWeight: 600,
                        color: Math.abs(variance) > 10 ? THEME.error : Math.abs(variance) > 0 ? THEME.warning : THEME.success,
                      }}>
                        {variance > 0 ? '+' : ''}{variance.toFixed(1)}
                      </span>
                    </Td>
                    <Td style={{ color: THEME.textMed }}>{d.recorded_by_name || '—'}</Td>
                    <Td style={{ color: THEME.textMed }}>{d.notes || '—'}</Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Add Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Record Dip Reading"
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Reading'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Date</SectionLabel>
            <input type="date" value={form.reading_date} onChange={e => set('reading_date', e.target.value)} style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Tank *</SectionLabel>
            <select value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={inputStyle}>
              <option value="">— Select tank —</option>
              {tanks.filter(t => t.status === 'active' && !t.is_archived).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <SectionLabel>Dip Reading (Litres) *</SectionLabel>
          <input
            type="number" min="0" step="0.1"
            value={form.reading_litres}
            onChange={e => set('reading_litres', e.target.value)}
            placeholder="Actual litres measured by dip stick"
            style={inputStyle}
          />
          {form.tank_id && form.reading_litres && !isNaN(form.reading_litres) && (
            <div style={{
              padding: '8px 12px', borderRadius: '10px', fontSize: '12px',
              background: THEME.surfaceVar, color: THEME.textMed, marginTop: '-8px', marginBottom: '14px',
            }}>
              Calculated balance: <strong>{tankBalance(form.tank_id).toFixed(1)} L</strong>
              {' '} · Variance: <strong style={{ color: Math.abs(tankBalance(form.tank_id) - Number(form.reading_litres)) > 10 ? THEME.error : THEME.success }}>
                {(tankBalance(form.tank_id) - Number(form.reading_litres)).toFixed(1)} L
              </strong>
            </div>
          )}
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={form.notes} onChange={e => set('notes', e.target.value)}
            placeholder="e.g. Tank gauge was sticky, reading taken manually"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </Modal>

    </div>
  )
}

function chipStyle(active) {
  return {
    padding: '5px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
    cursor: 'pointer', fontFamily: 'inherit',
    border: `1px solid ${active ? THEME.primary : THEME.outline}`,
    background: active ? THEME.surfaceVar : 'transparent',
    color: active ? THEME.primary : THEME.textMed,
  }
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}
