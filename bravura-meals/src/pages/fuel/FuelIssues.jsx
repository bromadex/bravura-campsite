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

const ASSET_TYPES = ['vehicle', 'generator', 'machine', 'other']

const BLANK_FORM = {
  issue_date: new Date().toISOString().slice(0, 10),
  tank_id: '',
  quantity_litres: '',
  asset_type: 'vehicle',
  asset_name: '',
  asset_reg: '',
  purpose: '',
  approved_by: '',
  received_by: '',
  notes: '',
}

export default function FuelIssues() {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, issues, profiles, addIssue, updateIssue, deleteIssue, loading } = useFuel()

  const canCreate = can('fuel.create')
  const canDelete = can('fuel.delete')

  const [modal,    setModal]    = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [filter,   setFilter]   = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  function openAdd() {
    setEditing(null)
    setForm({ ...BLANK_FORM, issue_date: new Date().toISOString().slice(0, 10) })
    setModal(true)
  }

  function openEdit(issue) {
    setEditing(issue)
    setForm({
      issue_date:   issue.issue_date,
      tank_id:      issue.tank_id,
      quantity_litres: String(issue.quantity_litres),
      asset_type:   issue.asset_type,
      asset_name:   issue.asset_name,
      asset_reg:    issue.asset_reg || '',
      purpose:      issue.purpose || '',
      approved_by:  issue.approved_by || '',
      received_by:  issue.received_by || '',
      notes:        issue.notes || '',
    })
    setModal(true)
  }

  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.tank_id)     { showToast('Select a tank', 'red'); return }
    if (!form.quantity_litres || isNaN(form.quantity_litres) || Number(form.quantity_litres) <= 0) {
      showToast('Enter a valid quantity', 'red'); return
    }
    if (!form.asset_name.trim()) { showToast('Enter asset name', 'red'); return }

    const approver = profiles.find(p => p.id === form.approved_by)
    setSaving(true)
    try {
      const payload = {
        tank_id:          form.tank_id,
        issue_date:       form.issue_date,
        quantity_litres:  Number(form.quantity_litres),
        asset_type:       form.asset_type,
        asset_name:       form.asset_name.trim(),
        asset_reg:        form.asset_reg.trim() || null,
        purpose:          form.purpose.trim() || null,
        approved_by:      form.approved_by || null,
        approved_by_name: approver?.full_name || null,
        received_by:      form.received_by.trim() || null,
        notes:            form.notes.trim() || null,
      }
      if (editing) {
        await updateIssue(editing.id, payload)
        showToast('Issue updated', 'green')
      } else {
        await addIssue({ ...payload, issued_by: profile?.id, issued_by_name: profile?.full_name || null })
        showToast('Fuel issue recorded', 'green')
      }
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    try {
      await deleteIssue(deleting.id)
      showToast('Record deleted', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'red')
    } finally {
      setDeleting(null)
    }
  }

  const tankName = id => tanks.find(t => t.id === id)?.name || '—'

  const filtered = issues.filter(i => {
    if (filter !== 'all' && i.asset_type !== filter) return false
    if (dateFrom && i.issue_date < dateFrom) return false
    if (dateTo   && i.issue_date > dateTo)   return false
    return true
  })

  if (loading) return null

  return (
    <div style={{ maxWidth: '1200px' }}>
      <PageHeader
        title="Fuel Issues"
        site={currentSite}
        actions={canCreate && (
          <Button onClick={openAdd} icon="output">Record Issue</Button>
        )}
      />

      {/* Filters row */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Asset type chips */}
        {['all', ...ASSET_TYPES].map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              padding: '5px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit', border: `1px solid ${filter === type ? THEME.primary : THEME.outline}`,
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
        {/* Spacer */}
        <div style={{ flex: 1 }} />
        {/* Date range */}
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
            <p style={{ fontSize: '14px', margin: 0 }}>{issues.length === 0 ? 'No fuel issues recorded yet.' : 'No issues match the current filters.'}</p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Tank</Th>
              <Th>Asset</Th>
              <Th>Reg / Designation</Th>
              <Th align="right">Qty (L)</Th>
              <Th>Issued By</Th>
              <Th>Approved By</Th>
              <Th>Received By</Th>
              <Th>Purpose</Th>
              {(canCreate || canDelete) && <Th />}
            </THead>
            <tbody>
              {filtered.map((issue, idx) => (
                <TRow key={issue.id} last={idx === filtered.length - 1}>
                  <Td>{fmtDate(issue.issue_date)}</Td>
                  <Td><span style={{ fontWeight: 500 }}>{tankName(issue.tank_id)}</span></Td>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 500,
                        background: THEME.surfaceVar, color: THEME.textMed,
                        textTransform: 'capitalize',
                      }}>
                        {issue.asset_type}
                      </span>
                      <span style={{ fontWeight: 500 }}>{issue.asset_name}</span>
                    </div>
                  </Td>
                  <Td style={{ color: THEME.textMed }}>{issue.asset_reg || '—'}</Td>
                  <Td align="right" style={{ fontWeight: 600, color: THEME.warning }}>
                    {Number(issue.quantity_litres).toFixed(1)}
                  </Td>
                  <Td style={{ color: THEME.textMed }}>{issue.issued_by_name || '—'}</Td>
                  <Td style={{ color: THEME.textMed }}>{issue.approved_by_name || '—'}</Td>
                  <Td style={{ color: THEME.textMed }}>{issue.received_by || '—'}</Td>
                  <Td style={{ color: THEME.textMed, maxWidth: '160px' }}>
                    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {issue.purpose || '—'}
                    </span>
                  </Td>
                  {(canCreate || canDelete) && (
                    <Td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canCreate && (
                          <button onClick={() => openEdit(issue)} style={iconBtnStyle} title="Edit">
                            <Icon name="edit" size={15} style={{ color: THEME.primary }} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => setDeleting(issue)} style={iconBtnStyle} title="Delete">
                            <Icon name="delete" size={15} style={{ color: THEME.error }} />
                          </button>
                        )}
                      </div>
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
        title={editing ? 'Edit Fuel Issue' : 'Record Fuel Issue'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Issue'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Date</SectionLabel>
            <input type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} style={inputStyle} />
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
          <SectionLabel>Quantity Issued (Litres) *</SectionLabel>
          <input
            type="number" min="0.1" step="0.1"
            value={form.quantity_litres}
            onChange={e => set('quantity_litres', e.target.value)}
            placeholder="e.g. 80"
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Asset Type *</SectionLabel>
            <select value={form.asset_type} onChange={e => set('asset_type', e.target.value)} style={inputStyle}>
              {ASSET_TYPES.map(t => (
                <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <SectionLabel>Asset Name *</SectionLabel>
            <input
              value={form.asset_name} onChange={e => set('asset_name', e.target.value)}
              placeholder={form.asset_type === 'vehicle' ? 'e.g. Toyota Hilux' : form.asset_type === 'generator' ? 'e.g. Gen Set 1' : 'e.g. Loader A'}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>{form.asset_type === 'vehicle' ? 'Reg Number' : 'Designation / Serial'}</SectionLabel>
            <input
              value={form.asset_reg} onChange={e => set('asset_reg', e.target.value)}
              placeholder={form.asset_type === 'vehicle' ? 'e.g. ABC 1234' : 'e.g. GEN-001'}
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>Purpose / Work Description</SectionLabel>
            <input value={form.purpose} onChange={e => set('purpose', e.target.value)} placeholder="e.g. Site patrol" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Approved By</SectionLabel>
            <select value={form.approved_by} onChange={e => set('approved_by', e.target.value)} style={inputStyle}>
              <option value="">— Select approver —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <SectionLabel>Received By (name)</SectionLabel>
            <input value={form.received_by} onChange={e => set('received_by', e.target.value)} placeholder="Driver / operator name" style={inputStyle} />
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
        title="Delete Issue Record"
        message={deleting ? `Delete the ${Number(deleting.quantity_litres).toFixed(1)} L issue to ${deleting.asset_name} on ${fmtDate(deleting.issue_date)}?` : ''}
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

const filterInputStyle = {
  padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', background: THEME.surface,
}

const iconBtnStyle = {
  background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
  borderRadius: '6px', display: 'flex', alignItems: 'center',
}

const clearBtnStyle = {
  background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
  padding: '9px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textMed,
  fontFamily: 'inherit', alignSelf: 'flex-end',
}
