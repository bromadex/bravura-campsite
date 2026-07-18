import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../../components/ui'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const EMPTY_FORM = { name: '', code: '', component_type: 'allowance', is_percentage: false, amount: '', percentage: '', is_taxable: true }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

const selectStyle = { ...inputStyle, background: THEME.surface }

const toggleRow = { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }

const toggleLabel = { fontSize: '14px', color: THEME.text, cursor: 'pointer', userSelect: 'none' }

export default function SalaryComponents() {
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('salary_components', { column: 'site_id', value: currentSiteId })

  const [components, setComponents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const fetchComponents = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('salary_components').select('*').order('name')
      if (error) throw error
      setComponents(data || [])
    } catch (err) {
      console.error(err)
      showToast('Failed to load salary components', 'red')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchComponents() }, [fetchComponents, rt])

  // ── Gate (after all hooks) ────────────────────────────────────────────────
  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const canEdit = can('hr.edit')

  const q = search.trim().toLowerCase()
  const visible = components.filter(c => {
    if (filterType !== 'all' && c.component_type !== filterType) return false
    if (q && !(c.name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q))) return false
    return true
  })

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModal(true)
  }

  function openEdit(comp) {
    if (!canEdit) return
    setEditing(comp)
    setForm({
      name: comp.name || '',
      code: comp.code || '',
      component_type: comp.component_type || 'allowance',
      is_percentage: !!comp.is_percentage,
      amount: comp.amount ?? '',
      percentage: comp.percentage ?? '',
      is_taxable: comp.is_taxable !== false,
    })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { showToast('Please enter a component name', 'red'); return }
    if (!form.code.trim()) { showToast('Please enter a component code', 'red'); return }
    if (form.is_percentage) {
      if (!form.percentage || Number(form.percentage) <= 0) { showToast('Please enter a valid percentage', 'red'); return }
    } else {
      if (!form.amount || Number(form.amount) <= 0) { showToast('Please enter a valid amount', 'red'); return }
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        component_type: form.component_type,
        is_percentage: form.is_percentage,
        amount: form.is_percentage ? null : Number(form.amount),
        percentage: form.is_percentage ? Number(form.percentage) : null,
        is_taxable: form.is_taxable,
      }
      if (editing) {
        const { error } = await supabase.from('salary_components').update(payload).eq('id', editing.id)
        if (error) throw error
        showToast('Component updated', 'green')
      } else {
        const { error } = await supabase.from('salary_components').insert(payload)
        if (error) throw error
        showToast('Component added', 'green')
      }
      setModal(false)
      fetchComponents()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(comp, e) {
    e.stopPropagation()
    if (!canEdit) return
    try {
      const { error } = await supabase.from('salary_components')
        .update({ is_active: !comp.is_active })
        .eq('id', comp.id)
      if (error) throw error
      showToast(comp.is_active ? 'Component deactivated' : 'Component activated', 'green')
      fetchComponents()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    }
  }

  function fmt(n) {
    return n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
  }

  const typeBadge = (type) => {
    const isAllow = type === 'allowance'
    return (
      <span style={{
        padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
        background: isAllow ? THEME.statusSuccessBg : THEME.statusErrorBg,
        color: isAllow ? THEME.statusSuccessText : THEME.statusErrorText,
      }}>
        {isAllow ? 'Allowance' : 'Deduction'}
      </span>
    )
  }

  return (
    <div>
      <PageHeader
        title="Salary Components"
        actions={canEdit && <Button onClick={openAdd} variant="filled" icon="add">Add Component</Button>}
      >
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Allowances and deductions applied during payroll processing. These are global (not site-specific).</div>
      </PageHeader>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input
          type="text" value={search} placeholder="Search name or code..."
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, width: '260px' }}
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...selectStyle, width: '160px' }}>
          <option value="all">All Types</option>
          <option value="allowance">Allowances</option>
          <option value="deduction">Deductions</option>
        </select>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: ACCENT }} />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
            <Icon name="receipt_long" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
            No salary components found.
          </div>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th>Type</Th>
            <Th align="right">Amount / %</Th>
            <Th>Taxable</Th>
            <Th>Active</Th>
            <Th></Th>
          </THead>
          {visible.map((c, i) => (
            <TRow key={c.id} last={i === visible.length - 1} onClick={() => openEdit(c)}>
              <Td>
                <span style={{ fontWeight: 600, color: THEME.text, opacity: c.is_active === false ? 0.5 : 1 }}>{c.name}</span>
              </Td>
              <Td>{c.code || '—'}</Td>
              <Td>{typeBadge(c.component_type)}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {c.is_percentage ? `${fmt(c.percentage)}%` : `$${fmt(c.amount)}`}
              </Td>
              <Td>{c.is_taxable ? 'Yes' : 'No'}</Td>
              <Td>
                <span style={{
                  padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                  background: c.is_active !== false ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                  color: c.is_active !== false ? THEME.statusSuccessText : THEME.statusNeutralText,
                }}>
                  {c.is_active !== false ? 'Active' : 'Inactive'}
                </span>
              </Td>
              <Td>
                {canEdit && (
                  <Button onClick={(e) => toggleActive(c, e)} variant="text" size="sm">
                    {c.is_active !== false ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </Td>
            </TRow>
          ))}
        </TableWrap>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add Salary Component'}
        footer={<>
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          <Button onClick={save} variant="filled" disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save changes' : 'Add Component'}
          </Button>
        </>}
      >
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Name *</SectionLabel>
          <input
            type="text" value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Housing Allowance"
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Code *</SectionLabel>
            <input
              type="text" value={form.code} maxLength={20}
              onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="e.g. HOUSING"
              style={{ ...inputStyle, textTransform: 'uppercase' }}
            />
          </div>
          <div>
            <SectionLabel>Type *</SectionLabel>
            <select
              value={form.component_type}
              onChange={e => setForm(f => ({ ...f, component_type: e.target.value }))}
              style={selectStyle}
            >
              <option value="allowance">Allowance</option>
              <option value="deduction">Deduction</option>
            </select>
          </div>
        </div>

        <div style={toggleRow}>
          <input type="checkbox" id="isPct" checked={form.is_percentage} onChange={e => setForm(f => ({ ...f, is_percentage: e.target.checked }))} />
          <label htmlFor="isPct" style={toggleLabel}>Calculate as percentage of basic salary</label>
        </div>

        <div style={{ marginBottom: '14px' }}>
          {form.is_percentage ? (
            <div>
              <SectionLabel>Percentage *</SectionLabel>
              <input
                type="number" value={form.percentage} min="0" max="100" step="0.01"
                onChange={e => setForm(f => ({ ...f, percentage: e.target.value }))}
                placeholder="e.g. 25"
                style={inputStyle}
              />
            </div>
          ) : (
            <div>
              <SectionLabel>Amount *</SectionLabel>
              <input
                type="number" value={form.amount} min="0" step="0.01"
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                style={inputStyle}
              />
            </div>
          )}
        </div>

        <div style={toggleRow}>
          <input type="checkbox" id="isTax" checked={form.is_taxable} onChange={e => setForm(f => ({ ...f, is_taxable: e.target.checked }))} />
          <label htmlFor="isTax" style={toggleLabel}>Taxable</label>
        </div>
      </Modal>
    </div>
  )
}
