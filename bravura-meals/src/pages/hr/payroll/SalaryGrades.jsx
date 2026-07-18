import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../../components/ui'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const EMPTY_FORM = { name: '', code: '', basic_salary: '' }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

export default function SalaryGrades() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('salary_grades', { column: 'site_id', value: currentSiteId })

  const [grades, setGrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const fetchGrades = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data, error } = await supabase.from('salary_grades').select('*')
        .eq('site_id', currentSiteId)
        .order('name')
      if (error) throw error
      setGrades(data || [])
    } catch (err) {
      console.error(err)
      showToast('Failed to load salary grades', 'red')
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  useEffect(() => { fetchGrades() }, [fetchGrades, rt])

  // ── Gate (after all hooks) ────────────────────────────────────────────────
  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const canEdit = can('hr.edit')

  const q = search.trim().toLowerCase()
  const visible = grades.filter(g => {
    if (!showArchived && g.is_archived) return false
    if (q && !(g.name?.toLowerCase().includes(q) || g.code?.toLowerCase().includes(q))) return false
    return true
  })

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModal(true)
  }

  function openEdit(grade) {
    if (!canEdit) return
    setEditing(grade)
    setForm({ name: grade.name || '', code: grade.code || '', basic_salary: grade.basic_salary ?? '' })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { showToast('Please enter a grade name', 'red'); return }
    if (!form.basic_salary || Number(form.basic_salary) <= 0) { showToast('Please enter a valid basic salary', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase() || null,
        basic_salary: Number(form.basic_salary),
      }
      if (editing) {
        const { error } = await supabase.from('salary_grades').update(payload).eq('id', editing.id)
        if (error) throw error
        showToast('Salary grade updated', 'green')
      } else {
        const { error } = await supabase.from('salary_grades').insert({ ...payload, site_id: currentSiteId })
        if (error) throw error
        showToast('Salary grade added', 'green')
      }
      setModal(false)
      fetchGrades()
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
      const { error } = await supabase.from('salary_grades')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('id', editing.id)
      if (error) throw error
      showToast('Salary grade archived', 'green')
      setModal(false)
      fetchGrades()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  function fmt(n) {
    return n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'
  }

  return (
    <div>
      <PageHeader
        title="Salary Grades"
        site={currentSite?.name}
        actions={canEdit && <Button onClick={openAdd} variant="filled" icon="add">Add Grade</Button>}
      >
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Define salary grades and their base pay for this site.</div>
      </PageHeader>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input
          type="text" value={search} placeholder="Search name or code..."
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
            <Icon name="school" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
            No salary grades found.
          </div>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <Th>Name</Th>
            <Th>Code</Th>
            <Th align="right">Basic Salary</Th>
            <Th></Th>
          </THead>
          {visible.map((g, i) => (
            <TRow key={g.id} last={i === visible.length - 1} onClick={() => openEdit(g)}>
              <Td>
                <span style={{ fontWeight: 600, color: THEME.text, opacity: g.is_archived ? 0.5 : 1 }}>{g.name}</span>
                {g.is_archived && <span style={{ marginLeft: '8px', fontSize: '11px', color: THEME.textLow }}>(archived)</span>}
              </Td>
              <Td>{g.code || '—'}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(g.basic_salary)}</Td>
              <Td></Td>
            </TRow>
          ))}
        </TableWrap>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add Salary Grade'}
        footer={<>
          {editing && canEdit && (
            <Button onClick={archive} variant="text" disabled={saving} style={{ color: THEME.error, marginRight: 'auto' }} icon="archive">Archive</Button>
          )}
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          <Button onClick={save} variant="filled" disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save changes' : 'Add Grade'}
          </Button>
        </>}
      >
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Name *</SectionLabel>
          <input
            type="text" value={form.name} autoFocus
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Grade A"
            style={inputStyle}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Code</SectionLabel>
            <input
              type="text" value={form.code} maxLength={10}
              onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="e.g. GA"
              style={{ ...inputStyle, textTransform: 'uppercase' }}
            />
          </div>
          <div>
            <SectionLabel>Basic Salary *</SectionLabel>
            <input
              type="number" value={form.basic_salary} min="0" step="0.01"
              onChange={e => setForm(f => ({ ...f, basic_salary: e.target.value }))}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
