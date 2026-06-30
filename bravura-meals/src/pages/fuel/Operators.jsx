import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Modal, ConfirmModal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'

const FUEL_CLR = MODULE_COLORS.fuel

const BLANK_FORM = {
  employee_id:    '',
  licence_number: '',
  licence_expiry: '',
}

// Operators is gated by fuel.view to enter; mutations require fuel.edit
// (the prompt's "fuel.settings.edit" collapses into fuel.edit because the
// permissions table enforces UNIQUE(module, action) — only View/Create/
// Edit/Approve are allowed action values).

export default function Operators() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const {
    operators, employees, addOperator, updateOperator,
    deactivateOperator, reactivateOperator, loading,
  } = useFuel()

  const canView = can('fuel.view')
  const canEdit = can('fuel.edit')

  const [modal,      setModal]      = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [form,       setForm]       = useState(BLANK_FORM)
  const [saving,     setSaving]     = useState(false)
  const [removing,   setRemoving]   = useState(null)
  const [empQuery,   setEmpQuery]   = useState('')
  const [query,      setQuery]      = useState('')
  const [filterStat, setFilterStat] = useState('active')   // 'active' | 'inactive' | 'all'
  const [filterExp,  setFilterExp]  = useState('all')      // 'all' | 'expiring' | 'expired'

  if (!canView) return null

  function openAdd() {
    setEditItem(null)
    setForm(BLANK_FORM)
    setEmpQuery('')
    setModal(true)
  }
  function openEdit(op) {
    setEditItem(op)
    setForm({
      employee_id:    op.employee_id,
      licence_number: op.licence_number || '',
      licence_expiry: op.licence_expiry || '',
    })
    setEmpQuery(op.employees?.name || '')
    setModal(true)
  }
  function set(field, value) { setForm(prev => ({ ...prev, [field]: value })) }

  async function save() {
    if (!form.employee_id) { showToast('Select an employee', 'red'); return }
    setSaving(true)
    try {
      const data = {
        employee_id:    form.employee_id,
        licence_number: form.licence_number.trim() || null,
        licence_expiry: form.licence_expiry || null,
      }
      if (editItem) { await updateOperator(editItem.id, data); showToast('Operator updated', 'green') }
      else           { await addOperator({ ...data, is_active: true }); showToast('Operator added', 'green') }
      setModal(false)
    } catch (err) {
      const msg = err.message?.includes('duplicate') || err.code === '23505'
        ? 'This employee is already registered as an operator.'
        : err.message || 'Failed to save'
      showToast(msg, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function confirmRemove() {
    try {
      await deactivateOperator(removing.id)
      showToast('Operator deactivated', 'green')
    } catch (err) {
      showToast(err.message || 'Failed', 'red')
    } finally {
      setRemoving(null)
    }
  }

  async function reactivate(op) {
    try {
      await reactivateOperator(op.id)
      showToast('Operator reactivated', 'green')
    } catch (err) {
      showToast(err.message || 'Failed', 'red')
    }
  }

  // Employees not already operators (for the add dropdown). On edit, the
  // current operator's employee stays selectable.
  const availableEmployees = useMemo(() => {
    const taken = new Set(operators
      .filter(o => o.is_active && o.id !== editItem?.id)
      .map(o => o.employee_id))
    const q = empQuery.trim().toLowerCase()
    return employees
      .filter(e => !taken.has(e.id))
      .filter(e => !q || e.name.toLowerCase().includes(q))
      .slice(0, 30)
  }, [employees, operators, editItem, empQuery])

  const today = new Date()
  const in30  = new Date()
  in30.setDate(in30.getDate() + 30)
  const todayStr = today.toISOString().slice(0, 10)
  const in30Str  = in30.toISOString().slice(0, 10)

  function licenceState(op) {
    if (!op.licence_expiry) return 'none'
    if (op.licence_expiry < todayStr) return 'expired'
    if (op.licence_expiry <= in30Str) return 'expiring'
    return 'valid'
  }

  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase()
    return operators.filter(op => {
      if (filterStat === 'active'   && !op.is_active) return false
      if (filterStat === 'inactive' &&  op.is_active) return false
      const ls = licenceState(op)
      if (filterExp === 'expiring' && ls !== 'expiring') return false
      if (filterExp === 'expired'  && ls !== 'expired')  return false
      if (q) {
        const name = op.employees?.name || ''
        const lic  = op.licence_number || ''
        if (!`${name} ${lic}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [operators, query, filterStat, filterExp, todayStr, in30Str])

  const counts = useMemo(() => ({
    expiring: operators.filter(op => op.is_active && licenceState(op) === 'expiring').length,
    expired:  operators.filter(op => op.is_active && licenceState(op) === 'expired').length,
  }), [operators, todayStr, in30Str])

  if (loading) return null

  return (
    <div style={{ padding: '20px', maxWidth: '1200px' }}>
      <PageHeader
        title="Fuel Operators"
        site={currentSite}
        actions={canEdit && <Button onClick={openAdd} icon="person_add">Add Operator</Button>}
      />

      {/* Expiry alert banner */}
      {(counts.expired > 0 || counts.expiring > 0) && (
        <div style={{
          padding: '10px 14px', borderRadius: '12px', marginBottom: '16px',
          background: counts.expired > 0 ? THEME.statusErrorBg : THEME.statusWarningBg,
          color:      counts.expired > 0 ? THEME.statusErrorText : THEME.statusWarningText,
          fontSize: '13px', display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <Icon name="warning" size={16} />
          <span>
            {counts.expired > 0 && <strong>{counts.expired} expired</strong>}
            {counts.expired > 0 && counts.expiring > 0 && ' · '}
            {counts.expiring > 0 && <strong>{counts.expiring} expiring within 30 days</strong>}
          </span>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px',
          border: `1px solid ${THEME.outline}`, borderRadius: '10px',
          padding: '0 10px', background: THEME.surface, flex: '0 0 240px' }}>
          <Icon name="search" size={16} style={{ color: THEME.textLow }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Name or licence #"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', padding: '8px 4px', fontSize: '13px', color: THEME.text, fontFamily: 'inherit' }}
          />
        </div>
        <FilterSelect label="Status" value={filterStat} onChange={setFilterStat}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="all">All</option>
        </FilterSelect>
        <FilterSelect label="Licence" value={filterExp} onChange={setFilterExp}>
          <option value="all">All</option>
          <option value="expiring">Expiring ≤ 30 days</option>
          <option value="expired">Expired</option>
        </FilterSelect>
        {(filterStat !== 'active' || filterExp !== 'all' || query) && (
          <button
            onClick={() => { setFilterStat('active'); setFilterExp('all'); setQuery('') }}
            style={{ background: 'none', border: 'none', color: FUEL_CLR, fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit' }}
          >Reset</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
          {displayed.length} of {operators.length}
        </span>
      </div>

      <Card style={{ padding: 0 }}>
        {displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="badge" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: '0 0 16px' }}>
              {operators.length === 0
                ? 'No fuel operators registered yet.'
                : 'No operators match the current filters.'}
            </p>
            {canEdit && operators.length === 0 && <Button onClick={openAdd} icon="person_add">Add First Operator</Button>}
          </div>
        ) : (
          <TableWrap>
            <THead color={FUEL_CLR}>
              <Th>Employee Name</Th>
              <Th>Group / Contractor</Th>
              <Th>Licence Number</Th>
              <Th>Licence Expiry</Th>
              <Th>Status</Th>
              {canEdit && <Th />}
            </THead>
            <tbody>
              {displayed.map((op, idx) => {
                const ls = licenceState(op)
                const expiryColor =
                  ls === 'expired'  ? THEME.error :
                  ls === 'expiring' ? THEME.warning :
                                      THEME.text
                const rowBg =
                  !op.is_active     ? null :
                  ls === 'expired'  ? THEME.statusErrorBg + '60' :
                  ls === 'expiring' ? THEME.statusWarningBg + '60' :
                                      null
                const empName  = op.employees?.name || '— removed employee —'
                const groupNm  = op.employees?.contractor?.name || '—'
                return (
                  <TRow
                    key={op.id}
                    last={idx === displayed.length - 1}
                    onClick={canEdit ? () => openEdit(op) : undefined}
                    style={rowBg ? { background: rowBg } : undefined}
                  >
                    <Td>
                      <span style={{ fontWeight: 500 }}>{empName}</span>
                    </Td>
                    <Td style={{ color: THEME.textMed }}>{groupNm}</Td>
                    <Td style={{ fontFamily: 'monospace', fontSize: '12px', color: THEME.textMed }}>
                      {op.licence_number || '—'}
                    </Td>
                    <Td style={{ fontWeight: ls === 'valid' || ls === 'none' ? 400 : 600, color: expiryColor }}>
                      {op.licence_expiry ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {fmtDate(op.licence_expiry)}
                          {ls === 'expired'  && <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '20px', background: THEME.statusErrorBg, color: THEME.statusErrorText }}>EXPIRED</span>}
                          {ls === 'expiring' && <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '20px', background: THEME.statusWarningBg, color: THEME.statusWarningText }}>SOON</span>}
                        </span>
                      ) : '—'}
                    </Td>
                    <Td>
                      <span style={{
                        padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500,
                        background: op.is_active ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                        color:      op.is_active ? THEME.statusSuccessText : THEME.statusNeutralText,
                      }}>
                        {op.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </Td>
                    {canEdit && (
                      <Td>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={e => { e.stopPropagation(); openEdit(op) }}
                            style={iconBtn} title="Edit">
                            <Icon name="edit" size={15} style={{ color: THEME.textMed }} />
                          </button>
                          {op.is_active ? (
                            <button onClick={e => { e.stopPropagation(); setRemoving(op) }}
                              style={iconBtn} title="Deactivate">
                              <Icon name="person_remove" size={15} style={{ color: THEME.error }} />
                            </button>
                          ) : (
                            <button onClick={e => { e.stopPropagation(); reactivate(op) }}
                              style={iconBtn} title="Reactivate">
                              <Icon name="person_add" size={15} style={{ color: THEME.success }} />
                            </button>
                          )}
                        </div>
                      </Td>
                    )}
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editItem ? 'Edit Operator' : 'Add Operator'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : editItem ? 'Update' : 'Add Operator'}</Button>
          </>
        }
      >
        <div>
          <SectionLabel>Employee *</SectionLabel>
          {editItem ? (
            <div style={{ ...inputStyle, background: THEME.surfaceVar, color: THEME.textMed, cursor: 'not-allowed' }}>
              {editItem.employees?.name || '—'}
            </div>
          ) : (
            <>
              <input
                value={empQuery}
                onChange={e => { setEmpQuery(e.target.value); set('employee_id', '') }}
                placeholder="Type to search active employees…"
                style={inputStyle}
                autoFocus
              />
              {empQuery.trim() && !form.employee_id && (
                <div style={{
                  border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px',
                  marginTop: '-8px', marginBottom: '14px', maxHeight: '220px', overflowY: 'auto',
                  background: THEME.surface,
                }}>
                  {availableEmployees.length === 0 ? (
                    <div style={{ padding: '14px', color: THEME.textLow, fontSize: '12px', textAlign: 'center' }}>
                      No matching active employees.
                    </div>
                  ) : availableEmployees.map(emp => (
                    <button
                      key={emp.id}
                      onClick={() => { set('employee_id', emp.id); setEmpQuery(emp.name) }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', border: 'none', background: 'transparent',
                        cursor: 'pointer', fontSize: '13px', color: THEME.text, fontFamily: 'inherit',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ fontWeight: 500 }}>{emp.name}</div>
                      {emp.contractor && (
                        <div style={{ fontSize: '11px', color: THEME.textLow }}>{emp.contractor.name}</div>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {form.employee_id && (
                <div style={{ marginTop: '-8px', marginBottom: '14px', fontSize: '11px', color: THEME.success }}>
                  <Icon name="check_circle" size={12} style={{ verticalAlign: 'middle' }} /> Employee selected
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Licence Number</SectionLabel>
            <input
              value={form.licence_number}
              onChange={e => set('licence_number', e.target.value)}
              placeholder="optional"
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>Licence Expiry</SectionLabel>
            <input
              type="date"
              value={form.licence_expiry}
              onChange={e => set('licence_expiry', e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        {form.licence_expiry && form.licence_expiry < todayStr && (
          <div style={{
            padding: '8px 12px', borderRadius: '10px', fontSize: '12px',
            background: THEME.statusErrorBg, color: THEME.statusErrorText, marginBottom: '8px',
          }}>
            This licence is already expired.
          </div>
        )}
        {form.licence_expiry && form.licence_expiry >= todayStr && form.licence_expiry <= in30Str && (
          <div style={{
            padding: '8px 12px', borderRadius: '10px', fontSize: '12px',
            background: THEME.statusWarningBg, color: THEME.statusWarningText, marginBottom: '8px',
          }}>
            This licence will expire within 30 days.
          </div>
        )}
      </Modal>

      <ConfirmModal
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        title="Deactivate Operator"
        message={removing
          ? `Deactivate "${removing.employees?.name || 'this operator'}"? They will no longer appear in issuance dropdowns. Historical records are preserved.`
          : ''}
      />
    </div>
  )
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed }}>
      <span>{label}:</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{
          padding: '6px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
          fontSize: '12px', color: THEME.text, background: THEME.surface,
          fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
        }}>
        {children}
      </select>
    </label>
  )
}

const iconBtn = { background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px' }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}
