import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../components/ui'
import { nextCode } from '../../utils/autoCode'
import QuickNav, { HR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const EMPTY_FORM = { name: '', code: '', department_id: '', grade: '', description: '' }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

export default function Designations({ setPage }) {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const [reloadKey, setReloadKey] = useState(0)
  const onRealtime = useCallback(() => setReloadKey(k => k + 1), [])
  useRealtimeSubscription('designations', { column: 'site_id', value: currentSiteId }, onRealtime)

  const [rows, setRows] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [desRes, depRes] = await Promise.all([
        supabase.from('designations')
          .select('*, department:departments(id, name)')
          .eq('site_id', currentSiteId)
          .order('name'),
        supabase.from('departments')
          .select('id, name')
          .or(`site_id.eq.${currentSiteId},site_id.is.null`)
          .order('name'),
      ])
      if (desRes.error) { console.error(desRes.error); showToast('Failed to load designations', 'red') }
      if (!cancelled) {
        setRows(desRes.data || [])
        setDepartments(depRes.data || [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId, reloadKey])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r =>
      (showArchived || !r.is_archived) &&
      (!q || r.name.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q))
    )
  }, [rows, search, showArchived])

  function openAdd() {
    setEditing(null)
    const code = nextCode(rows.map(r => r.code), { prefix: 'DES', pad: 2 })
    setForm({ ...EMPTY_FORM, code })
    setModalOpen(true)
  }
  function openEdit(r) {
    setEditing(r)
    setForm({
      name: r.name || '', code: r.code || '', department_id: r.department_id || '',
      grade: r.grade || '', description: r.description || '',
    })
    setModalOpen(true)
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name.trim()) { showToast('Name is required', 'red'); return }
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase() || null,
      department_id: form.department_id || null,
      grade: form.grade.trim() || null,
      description: form.description.trim() || null,
    }
    const q = editing
      ? supabase.from('designations').update(payload).eq('id', editing.id).eq('site_id', currentSiteId)
      : supabase.from('designations').insert({ ...payload, site_id: currentSiteId })
    const { error } = await q
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(editing ? 'Designation updated' : 'Designation added', 'green')
    setModalOpen(false)
    // refresh
    const { data } = await supabase.from('designations')
      .select('*, department:departments(id, name)')
      .eq('site_id', currentSiteId).order('name')
    setRows(data || [])
  }

  async function archive() {
    if (!editing) return
    if (!window.confirm(`Archive designation "${editing.name}"? It will be hidden from dropdowns.`)) return
    const { error } = await supabase.from('designations')
      .update({ is_archived: true, archived_at: new Date().toISOString() })
      .eq('id', editing.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Designation archived', 'green')
    setModalOpen(false)
    setRows(prev => prev.map(r => r.id === editing.id ? { ...r, is_archived: true } : r))
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  return (
    <div>
      <QuickNav pills={HR_PILLS} setPage={setPage} current="wf_designations" />
      <PageHeader
        title="Designations"
        site={currentSite}
        actions={can('hr.edit') && <Button icon="add" onClick={openAdd}>Add Designation</Button>}
      />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or code…"
          style={{ ...inputStyle, maxWidth: '280px' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMed, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
      ) : (
        <TableWrap>
          <THead color={ACCENT}>
            <Th>Name</Th><Th>Code</Th><Th>Department</Th><Th>Grade</Th><Th></Th>
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={5} style={{ padding: '32px', textAlign: 'center', color: THEME.textLow }}>No designations yet.</td></tr>
            ) : visible.map(r => (
              <TRow key={r.id} onClick={() => can('hr.edit') && openEdit(r)} style={{ cursor: can('hr.edit') ? 'pointer' : 'default', opacity: r.is_archived ? .55 : 1 }}>
                <Td style={{ fontWeight: 600 }}>{r.name}{r.is_archived && <span style={{ marginLeft: '8px', fontSize: '10px', color: THEME.textLow }}>ARCHIVED</span>}</Td>
                <Td style={{ fontFamily: 'monospace' }}>{r.code || '—'}</Td>
                <Td>{r.department?.name || '—'}</Td>
                <Td>{r.grade || '—'}</Td>
                <Td align="right">{can('hr.edit') && <Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} />}</Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Modal dirty={true} open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Designation' : 'Add Designation'}
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', width: '100%' }}>
            <div>
              {editing && !editing.is_archived && (
                <Button variant="danger" icon="archive" onClick={archive}>Archive</Button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <Button variant="outlined" onClick={() => setModalOpen(false)}>Cancel</Button>
              <Button icon="save" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Code</SectionLabel>
              <input style={{ ...inputStyle, textTransform: 'uppercase' }} value={form.code} onChange={e => set('code', e.target.value)} />
            </div>
            <div>
              <SectionLabel>Grade</SectionLabel>
              <input style={inputStyle} value={form.grade} onChange={e => set('grade', e.target.value)} placeholder="e.g. C3" />
            </div>
          </div>
          <div>
            <SectionLabel>Department</SectionLabel>
            <select style={inputStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Description</SectionLabel>
            <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
