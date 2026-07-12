import { useState, useEffect } from 'react'
import { supabase } from '../../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { useSite } from '../../../contexts/SiteContext'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../../components/ui'

const ACCENT = MODULE_COLORS.workforce
const EMPTY = { name: '', code: '', description: '', is_paid: true, max_days_per_year: '', carry_over_days: 0, requires_approval: true, advance_notice_days: 1 }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

export default function LeaveTypes() {
  const { currentSite } = useSite()
  const { can } = usePermissions()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const canEdit = can('hr.settings')

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('leave_types').select('*').order('name')
    if (error) { console.error(error); showToast('Failed to load leave types', 'red') }
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  function openAdd() { setEditing(null); setForm(EMPTY); setModal(true) }
  function openEdit(r) {
    setEditing(r)
    setForm({
      name: r.name, code: r.code, description: r.description || '',
      is_paid: r.is_paid, max_days_per_year: r.max_days_per_year ?? '',
      carry_over_days: r.carry_over_days ?? 0,
      requires_approval: r.requires_approval, advance_notice_days: r.advance_notice_days ?? 1,
    })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim() || !form.code.trim()) { showToast('Name and code are required', 'red'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(), code: form.code.trim().toUpperCase(),
      description: form.description.trim() || null,
      is_paid: !!form.is_paid,
      max_days_per_year: form.max_days_per_year === '' ? null : Number(form.max_days_per_year),
      carry_over_days: Number(form.carry_over_days) || 0,
      requires_approval: !!form.requires_approval,
      advance_notice_days: Number(form.advance_notice_days) || 0,
    }
    const q = editing
      ? supabase.from('leave_types').update(payload).eq('id', editing.id)
      : supabase.from('leave_types').insert(payload)
    const { error } = await q
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(editing ? 'Leave type updated' : 'Leave type added', 'green')
    setModal(false); load()
  }

  async function archiveType() {
    if (!editing) return
    if (!window.confirm(`Archive "${editing.name}"? It will stop appearing on new requests.`)) return
    const { error } = await supabase.from('leave_types').update({ is_active: false }).eq('id', editing.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Leave type archived', 'green'); setModal(false); load()
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  return (
    <div style={{ maxWidth: '960px' }}>
      <PageHeader title="Leave Types" site={currentSite}
        actions={canEdit && <Button icon="add" onClick={openAdd}>Add Leave Type</Button>} />
      {loading ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div> : (
        <TableWrap>
          <THead color={ACCENT}>
            <Th>Name</Th><Th>Code</Th><Th align="center">Paid</Th><Th align="center">Max Days/Yr</Th>
            <Th align="center">Carry Over</Th><Th align="center">Approval</Th><Th align="center">Status</Th>
          </THead>
          <tbody>
            {rows.map(r => (
              <TRow key={r.id} onClick={() => canEdit && openEdit(r)} style={{ cursor: canEdit ? 'pointer' : 'default', opacity: r.is_active ? 1 : .55 }}>
                <Td style={{ fontWeight: 600 }}>{r.name}</Td>
                <Td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.code}</Td>
                <Td align="center">{r.is_paid ? 'Paid' : 'Unpaid'}</Td>
                <Td align="center">{r.max_days_per_year ?? '∞'}</Td>
                <Td align="center">{r.carry_over_days}</Td>
                <Td align="center">{r.requires_approval ? 'Required' : '—'}</Td>
                <Td align="center">
                  <span style={{
                    padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                    background: r.is_active ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                    color: r.is_active ? THEME.statusSuccessText : THEME.statusNeutralText,
                  }}>{r.is_active ? 'Active' : 'Archived'}</span>
                </Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Leave Type' : 'Add Leave Type'}
        footer={
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <div>{editing?.is_active && <Button variant="danger" icon="archive" onClick={archiveType}>Archive</Button>}</div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button variant="outlined" onClick={() => setModal(false)}>Cancel</Button>
              <Button icon="save" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '14px' }}>
            <div><SectionLabel>Name *</SectionLabel><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><SectionLabel>Code *</SectionLabel><input style={{ ...inputStyle, textTransform: 'uppercase' }} value={form.code} onChange={e => set('code', e.target.value)} disabled={!!editing} /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
            <div><SectionLabel>Max Days / Year</SectionLabel><input style={inputStyle} type="number" min="0" value={form.max_days_per_year} onChange={e => set('max_days_per_year', e.target.value)} placeholder="blank = unlimited" /></div>
            <div><SectionLabel>Carry Over Days</SectionLabel><input style={inputStyle} type="number" min="0" value={form.carry_over_days} onChange={e => set('carry_over_days', e.target.value)} /></div>
            <div><SectionLabel>Notice (days)</SectionLabel><input style={inputStyle} type="number" min="0" value={form.advance_notice_days} onChange={e => set('advance_notice_days', e.target.value)} /></div>
          </div>
          <div style={{ display: 'flex', gap: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_paid} onChange={e => set('is_paid', e.target.checked)} /> Paid leave
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.requires_approval} onChange={e => set('requires_approval', e.target.checked)} /> Requires approval
            </label>
          </div>
          <div><SectionLabel>Description</SectionLabel><textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} /></div>
        </div>
      </Modal>
    </div>
  )
}
