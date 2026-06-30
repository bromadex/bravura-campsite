import { useState } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

// Fuel transactions are IMMUTABLE — no edit or delete is permitted.
// If a correction is needed, record a new 'adjustment' transaction.

const ASSET_TYPES = ['vehicle', 'equipment', 'other']

const BLANK_FORM = {
  transaction_date: new Date().toISOString().slice(0, 10),
  tank_id:          '',
  litres:           '',
  asset_type:       'vehicle',
  vehicle_id:       '',
  equipment_id:     '',
  asset_description:'',
  docket_number:    '',
  notes:            '',
}

export default function FuelIssues() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, issues, addTransaction, loading } = useFuel()

  const canIssue = can('fuel.create')
  const canView  = can('fuel.view')

  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [filter,   setFilter]   = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  if (!canView) return null

  function openAdd() {
    setForm({ ...BLANK_FORM, transaction_date: new Date().toISOString().slice(0, 10) })
    setModal(true)
  }

  function set(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value }
      // Clear sub-fields when asset type changes
      if (field === 'asset_type') {
        next.vehicle_id        = ''
        next.equipment_id      = ''
        next.asset_description = ''
      }
      return next
    })
  }

  async function save() {
    if (!form.tank_id) { showToast('Select a tank', 'red'); return }
    if (!form.litres || isNaN(form.litres) || Number(form.litres) <= 0) {
      showToast('Enter a valid quantity in litres', 'red'); return
    }
    if (form.asset_type === 'other' && !form.asset_description.trim()) {
      showToast('Enter a description for the fuel recipient', 'red'); return
    }

    const tank = tanks.find(t => t.id === form.tank_id)
    if (tank && Number(form.litres) > Number(tank.current_level_litres)) {
      showToast(`Insufficient stock — tank has only ${Number(tank.current_level_litres).toFixed(1)} L`, 'red')
      return
    }

    setSaving(true)
    try {
      await addTransaction({
        transaction_type:  'issuance',
        transaction_date:  form.transaction_date,
        tank_id:           form.tank_id,
        litres:            Number(form.litres),
        vehicle_id:        form.asset_type === 'vehicle'   ? form.vehicle_id   || null : null,
        equipment_id:      form.asset_type === 'equipment' ? form.equipment_id || null : null,
        asset_description: form.asset_type === 'other'     ? form.asset_description.trim() : null,
        docket_number:     form.docket_number.trim() || null,
        notes:             form.notes.trim() || null,
      })
      showToast('Fuel issuance recorded', 'green')
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to record issuance', 'red')
    } finally {
      setSaving(false)
    }
  }

  const tankName = id => tanks.find(t => t.id === id)?.name || '—'

  const filtered = issues.filter(i => {
    if (filter !== 'all' && i.asset_type !== filter) return false
    if (dateFrom && i.transaction_date < dateFrom) return false
    if (dateTo   && i.transaction_date > dateTo)   return false
    return true
  })

  const activeTanks = tanks.filter(t => t.status === 'active' && !t.is_archived)

  if (loading) return null

  return (
    <div style={{ maxWidth: '1200px' }}>
      <PageHeader
        title="Fuel Issuances"
        site={currentSite}
        actions={canIssue && (
          <Button onClick={openAdd} icon="output">Record Issuance</Button>
        )}
      />

      {/* Note about immutability */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '10px 14px', borderRadius: '10px', marginBottom: '16px',
        background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
        fontSize: '12px', color: THEME.textMed,
      }}>
        <Icon name="lock" size={14} style={{ color: THEME.textMed, flexShrink: 0 }} />
        Fuel issuance records are locked after creation. If a correction is needed, record an adjustment transaction.
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {['all', ...ASSET_TYPES].map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              padding: '5px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${filter === type ? THEME.primary : THEME.outline}`,
              background: filter === type ? THEME.surfaceVar : 'transparent',
              color: filter === type ? THEME.primary : THEME.textMed,
            }}
          >
            {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            <span style={{ marginLeft: '4px', opacity: .6 }}>
              ({type === 'all' ? issues.length : issues.filter(i => i.asset_type === type).length})
            </span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
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
      </div>

      <Card style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="output" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>
              {issues.length === 0 ? 'No fuel issuances recorded yet.' : 'No records match the current filters.'}
            </p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Docket</Th>
              <Th>Tank</Th>
              <Th>Recipient</Th>
              <Th>Type</Th>
              <Th align="right">Litres</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {filtered.map((issue, idx) => (
                <TRow key={issue.id} last={idx === filtered.length - 1}>
                  <Td>{fmtDate(issue.transaction_date)}</Td>
                  <Td style={{ color: THEME.textMed, fontFamily: 'monospace', fontSize: '12px' }}>
                    {issue.docket_number || '—'}
                  </Td>
                  <Td><span style={{ fontWeight: 500 }}>{tankName(issue.tank_id)}</span></Td>
                  <Td>
                    <span style={{ fontWeight: 500 }}>{issue.asset_name}</span>
                    {issue.asset_reg && (
                      <span style={{ marginLeft: '6px', fontSize: '11px', color: THEME.textMed }}>
                        ({issue.asset_reg})
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span style={{
                      padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500,
                      background: THEME.surfaceVar, color: THEME.textMed, textTransform: 'capitalize',
                    }}>
                      {issue.asset_type}
                    </span>
                  </Td>
                  <Td align="right" style={{ fontWeight: 600, color: THEME.warning }}>
                    {Number(issue.litres).toFixed(1)}
                  </Td>
                  <Td style={{ color: THEME.textMed, maxWidth: '160px' }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {issue.notes || '—'}
                    </span>
                  </Td>
                </TRow>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Record Issuance Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Record Fuel Issuance"
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record Issuance'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Date</SectionLabel>
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
                <option key={t.id} value={t.id}>
                  {t.name} ({Number(t.current_level_litres).toFixed(0)} L available)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <SectionLabel>Litres Issued *</SectionLabel>
          <input
            type="number" min="0.1" step="0.1"
            value={form.litres}
            onChange={e => set('litres', e.target.value)}
            placeholder="e.g. 80"
            style={inputStyle}
          />
        </div>

        <div>
          <SectionLabel>Recipient Type *</SectionLabel>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            {ASSET_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => set('asset_type', type)}
                style={{
                  flex: 1, padding: '9px', borderRadius: '10px', fontSize: '13px', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                  border: `1.5px solid ${form.asset_type === type ? THEME.primary : THEME.outline}`,
                  background: form.asset_type === type ? THEME.surfaceVar : 'transparent',
                  color: form.asset_type === type ? THEME.primary : THEME.textMed,
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {form.asset_type === 'other' && (
          <div>
            <SectionLabel>Recipient Description *</SectionLabel>
            <input
              value={form.asset_description}
              onChange={e => set('asset_description', e.target.value)}
              placeholder="e.g. Site Generator #2, Welding equipment"
              style={inputStyle}
            />
          </div>
        )}

        {form.asset_type === 'vehicle' && (
          <div style={{ padding: '12px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '14px', fontSize: '13px', color: THEME.textMed }}>
            <Icon name="info" size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Vehicle registry coming soon. Use "Other" and enter the fleet number or registration for now.
          </div>
        )}

        {form.asset_type === 'equipment' && (
          <div style={{ padding: '12px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '14px', fontSize: '13px', color: THEME.textMed }}>
            <Icon name="info" size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Equipment registry coming soon. Use "Other" and enter the equipment number for now.
          </div>
        )}

        <div>
          <SectionLabel>Docket / Reference Number</SectionLabel>
          <input
            value={form.docket_number}
            onChange={e => set('docket_number', e.target.value)}
            placeholder="e.g. DOC-001"
            style={inputStyle}
          />
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Purpose, destination, driver name…"
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
