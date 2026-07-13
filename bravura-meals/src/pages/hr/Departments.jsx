import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../components/ui'
import { nextCode } from '../../utils/autoCode'

const ACCENT = MODULE_COLORS.workforce
const EMPTY_FORM = { name: '', code: '', parent_department_id: '', department_head_id: '', description: '' }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

export default function Departments() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [departments, setDepartments] = useState([])
  const [designations, setDesignations] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (currentSiteId) fetchAll()
  }, [currentSiteId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchAll() {
    setLoading(true)
    try {
      const [deptRes, desigRes, empRes] = await Promise.all([
        supabase.from('departments').select('*')
          .or('site_id.eq.' + currentSiteId + ',site_id.is.null')
          .order('name'),
        supabase.from('designations').select('id, department_id, is_archived')
          .eq('site_id', currentSiteId),
        supabase.from('employees').select('id, name')
          .eq('site_id', currentSiteId)
          .eq('status', 'active')
          .order('name'),
      ])
      if (deptRes.error) throw deptRes.error
      if (desigRes.error) throw desigRes.error
      if (empRes.error) throw empRes.error
      setDepartments(deptRes.data || [])
      setDesignations(desigRes.data || [])
      setEmployees(empRes.data || [])
    } catch (err) {
      console.error(err)
      showToast('Failed to load departments', 'red')
    } finally {
      setLoading(false)
    }
  }

  // ── Gate (after all hooks) ────────────────────────────────────────────────
  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const canEdit = can('hr.edit')

  const deptById = {}
  departments.forEach(d => { deptById[d.id] = d })
  const empById = {}
  employees.forEach(e => { empById[e.id] = e })
  const desigCounts = {}
  designations.forEach(dg => {
    if (dg.is_archived) return
    desigCounts[dg.department_id] = (desigCounts[dg.department_id] || 0) + 1
  })

  const q = search.trim().toLowerCase()
  const visible = departments.filter(d => {
    if (!showArchived && d.is_archived) return false
    if (q && !(d.name?.toLowerCase().includes(q) || d.code?.toLowerCase().includes(q))) return false
    return true
  })

  function openAdd() {
    setEditing(null)
    const code = nextCode(departments.map(d => d.code), { prefix: 'DEP', pad: 2 })
    setForm({ ...EMPTY_FORM, code })
    setModal(true)
  }

  function openEdit(dept) {
    if (!canEdit) return
    if (!dept.site_id) { showToast('Global departments are read-only', 'red'); return }
    setEditing(dept)
    setForm({
      name: dept.name || '',
      code: dept.code || '',
      parent_department_id: dept.parent_department_id || '',
      department_head_id: dept.department_head_id || '',
      description: dept.description || '',
    })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { showToast('Please enter a department name', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase() || null,
        parent_department_id: form.parent_department_id || null,
        department_head_id: form.department_head_id || null,
        description: form.description.trim() || null,
      }
      if (editing) {
        const { error } = await supabase.from('departments').update(payload).eq('id', editing.id)
        if (error) throw error
        showToast('Department updated', 'green')
      } else {
        const { error } = await supabase.from('departments').insert({ ...payload, site_id: currentSiteId })
        if (error) throw error
        showToast('Department added', 'green')
      }
      setModal(false)
      fetchAll()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    if (!editing) return
    if (!window.confirm(`Archive "${editing.name}"? It will be hidden from lists but its history is kept.`)) return
    setSaving(true)
    try {
      const { error } = await supabase.from('departments')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('id', editing.id)
      if (error) throw error
      showToast('Department archived', 'green')
      setModal(false)
      fetchAll()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Departments"
        site={currentSite?.name}
        actions={canEdit && <Button onClick={openAdd} variant="filled" icon="add">Add Department</Button>}
      >
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Organisational departments for this site. Global (legacy) departments are shown read-only.</div>
      </PageHeader>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input
          type="text" value={search} placeholder="Search name or code…"
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, width: '260px' }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMed, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Show archived
        </label>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: ACCENT }} />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
            <Icon name="corporate_fare" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
            No departments found.
          </div>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th>Parent Department</Th>
            <Th>Department Head</Th>
            <Th align="right">Designations</Th>
            <Th></Th>
          </THead>
          {visible.map((d, i) => (
            <TRow key={d.id} last={i === visible.length - 1} onClick={() => openEdit(d)}>
              <Td>
                <span style={{ fontWeight: 600, color: THEME.text, opacity: d.is_archived ? 0.5 : 1 }}>{d.name}</span>
                {d.is_archived && <span style={{ marginLeft: '8px', fontSize: '11px', color: THEME.textLow }}>(archived)</span>}
              </Td>
              <Td>{d.code || '—'}</Td>
              <Td>{d.parent_department_id ? (deptById[d.parent_department_id]?.name || '—') : '—'}</Td>
              <Td>{d.department_head_id ? (empById[d.department_head_id]?.name || '—') : '—'}</Td>
              <Td align="right">{desigCounts[d.id] || 0}</Td>
              <Td>
                {!d.site_id && (
                  <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed }}>Global</span>
                )}
              </Td>
            </TRow>
          ))}
        </TableWrap>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add Department'}
        footer={<>
          {editing && (
            <Button onClick={archive} variant="text" disabled={saving} style={{ color: THEME.error, marginRight: 'auto' }} icon="archive">Archive</Button>
          )}
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          <Button onClick={save} variant="filled" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add Department'}
          </Button>
        </>}
      >
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Name *</SectionLabel>
          <input
            type="text" value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Maintenance"
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Code</SectionLabel>
            <input
              type="text" value={form.code} maxLength={10}
              onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="e.g. MAINT"
              style={{ ...inputStyle, textTransform: 'uppercase' }}
            />
          </div>
          <div>
            <SectionLabel>Parent Department</SectionLabel>
            <select
              value={form.parent_department_id}
              onChange={e => setForm(f => ({ ...f, parent_department_id: e.target.value }))}
              style={inputStyle}
            >
              <option value="">— None —</option>
              {departments
                .filter(d => !d.is_archived && (!editing || d.id !== editing.id))
                .map(d => <option key={d.id} value={d.id}>{d.name}{!d.site_id ? ' (Global)' : ''}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Department Head</SectionLabel>
          <select
            value={form.department_head_id}
            onChange={e => setForm(f => ({ ...f, department_head_id: e.target.value }))}
            style={inputStyle}
          >
            <option value="">— None —</option>
            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </div>
        <div>
          <SectionLabel>Description</SectionLabel>
          <textarea
            value={form.description} rows={3}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </Modal>
    </div>
  )
}
