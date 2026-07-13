import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { PageHeader, TableWrap, THead, Th, TRow, Td, Button, Icon, showToast } from '../../../components/ui'
import Denied from '../../../components/Denied'

const ACCENT = MODULE_COLORS.workforce

const STATUS_META = {
  planned:   { label: 'Planned',   bg: THEME.statusInfoBg,     text: THEME.statusInfoText },
  ongoing:   { label: 'Ongoing',   bg: THEME.statusWarningBg,  text: THEME.statusWarningText },
  completed: { label: 'Completed', bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText },
  cancelled: { label: 'Cancelled', bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
}

const ENROLL_STATUS = {
  enrolled:  { label: 'Enrolled',  bg: THEME.statusInfoBg,    text: THEME.statusInfoText },
  completed: { label: 'Completed', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  failed:    { label: 'Failed',    bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
}

function Badge({ status, meta }) {
  const m = meta[status] || { label: status, bg: THEME.statusNeutralBg, text: THEME.statusNeutralText }
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600, background: m.bg, color: m.text, whiteSpace: 'nowrap',
    }}>{m.label}</span>
  )
}

const inputStyle = {
  padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
  fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: THEME.surface, color: THEME.text,
}

const labelStyle = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px' }

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}

const modalStyle = {
  background: THEME.surface, borderRadius: '14px', padding: '24px', width: '480px',
  maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: THEME.shadow3,
}

const EMPTY_FORM = { title: '', description: '', trainer: '', start_date: '', end_date: '', max_participants: '', status: 'planned' }

export default function TrainingPrograms() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [programs, setPrograms] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [enrollments, setEnrollments] = useState([])
  const [enrollLoading, setEnrollLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [employees, setEmployees] = useState([])
  const [selectedEmps, setSelectedEmps] = useState([])
  const [showEnrollModal, setShowEnrollModal] = useState(false)
  const [enrollSaving, setEnrollSaving] = useState(false)
  const [editEnroll, setEditEnroll] = useState(null)
  const [enrollForm, setEnrollForm] = useState({ status: 'enrolled', score: '' })

  if (!can('hr.view')) return <Denied />

  const canEdit = can('hr.edit')
  const canCreate = can('hr.create')

  const loadPrograms = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('training_programs')
      .select('*, training_enrollments(count)')
      .eq('site_id', currentSiteId)
      .order('start_date', { ascending: false })
    if (error) { showToast('Failed to load programs', 'red'); console.error(error) }
    setPrograms(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { loadPrograms() }, [loadPrograms])

  const loadEnrollments = useCallback(async (programId) => {
    setEnrollLoading(true)
    const { data, error } = await supabase
      .from('training_enrollments')
      .select('*, employee:employees(id, name, employee_number)')
      .eq('training_program_id', programId)
      .eq('site_id', currentSiteId)
      .order('created_at')
    if (error) { showToast('Failed to load enrollments', 'red'); console.error(error) }
    setEnrollments(data || [])
    setEnrollLoading(false)
  }, [currentSiteId])

  const loadEmployees = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase
      .from('employees')
      .select('id, name, employee_number')
      .eq('site_id', currentSiteId)
      .eq('status', 'active')
      .order('name')
    if (error) { showToast('Failed to load employees', 'red'); console.error(error) }
    setEmployees(data || [])
  }, [currentSiteId])

  const handleExpand = useCallback((id) => {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    loadEnrollments(id)
  }, [expandedId, loadEnrollments])

  const openAdd = () => { setEditId(null); setForm(EMPTY_FORM); setShowModal(true) }
  const openEdit = (p) => {
    setEditId(p.id)
    setForm({ title: p.title, description: p.description || '', trainer: p.trainer || '', start_date: p.start_date || '', end_date: p.end_date || '', max_participants: p.max_participants || '', status: p.status })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!form.title.trim()) { showToast('Title is required', 'red'); return }
    setSaving(true)
    const payload = { ...form, max_participants: form.max_participants ? Number(form.max_participants) : null, site_id: currentSiteId }
    let err
    if (editId) {
      const { error } = await supabase.from('training_programs').update(payload).eq('id', editId).eq('site_id', currentSiteId)
      err = error
    } else {
      const { error } = await supabase.from('training_programs').insert(payload)
      err = error
    }
    setSaving(false)
    if (err) { showToast('Save failed: ' + err.message, 'red'); return }
    showToast(editId ? 'Program updated' : 'Program created', 'green')
    setShowModal(false)
    loadPrograms()
  }

  const openEnrollModal = () => { loadEmployees(); setSelectedEmps([]); setShowEnrollModal(true) }

  const handleEnroll = async () => {
    if (!selectedEmps.length) { showToast('Select at least one employee', 'red'); return }
    setEnrollSaving(true)
    const rows = selectedEmps.map(eid => ({ training_program_id: expandedId, employee_id: eid, site_id: currentSiteId, status: 'enrolled' }))
    const { error } = await supabase.from('training_enrollments').upsert(rows, { onConflict: 'training_program_id,employee_id' })
    setEnrollSaving(false)
    if (error) { showToast('Enroll failed: ' + error.message, 'red'); return }
    showToast(`${selectedEmps.length} enrolled`, 'green')
    setShowEnrollModal(false)
    loadEnrollments(expandedId)
    loadPrograms()
  }

  const handleUpdateEnroll = async () => {
    if (!editEnroll) return
    setSaving(true)
    const { error } = await supabase
      .from('training_enrollments')
      .update({ status: enrollForm.status, score: enrollForm.score ? Number(enrollForm.score) : null, completion_date: enrollForm.status === 'completed' ? new Date().toISOString().slice(0, 10) : null })
      .eq('id', editEnroll.id)
      .eq('site_id', currentSiteId)
    setSaving(false)
    if (error) { showToast('Update failed: ' + error.message, 'red'); return }
    showToast('Enrollment updated', 'green')
    setEditEnroll(null)
    loadEnrollments(expandedId)
  }

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return programs
    return programs.filter(p => p.status === statusFilter)
  }, [programs, statusFilter])

  const enrolledIds = useMemo(() => new Set(enrollments.map(e => e.employee_id)), [enrollments])
  const availableEmps = useMemo(() => employees.filter(e => !enrolledIds.has(e.id)), [employees, enrolledIds])

  return (
    <div>
      <PageHeader title="Training Programs" site={currentSite?.name} actions={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select style={{ ...inputStyle, minWidth: '140px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {canCreate && <Button icon="add" onClick={openAdd} style={{ background: ACCENT, color: '#fff' }}>New Program</Button>}
        </div>
      } />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>No training programs found.</div>
      ) : (
        <TableWrap>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead><tr>
              <Th>Title</Th><Th>Trainer</Th><Th>Start</Th><Th>End</Th><Th align="center">Enrolled</Th><Th>Status</Th>
              {canEdit && <Th align="center">Actions</Th>}
            </tr></THead>
            <tbody>
              {filtered.map((p, i) => {
                const count = p.training_enrollments?.[0]?.count || 0
                const isExpanded = expandedId === p.id
                return (
                  <tr key={p.id}>
                    <td colSpan={canEdit ? 7 : 6} style={{ padding: 0 }}>
                      <TRow onClick={() => handleExpand(p.id)} last={i === filtered.length - 1 && !isExpanded} style={{ cursor: 'pointer' }}>
                        <Td><span style={{ fontWeight: 500 }}>{p.title}</span></Td>
                        <Td>{p.trainer || '—'}</Td>
                        <Td>{p.start_date || '—'}</Td>
                        <Td>{p.end_date || '—'}</Td>
                        <Td align="center">{count}{p.max_participants ? `/${p.max_participants}` : ''}</Td>
                        <Td><Badge status={p.status} meta={STATUS_META} /></Td>
                        {canEdit && <Td align="center"><Button variant="ghost" icon="edit" onClick={e => { e.stopPropagation(); openEdit(p) }} /></Td>}
                      </TRow>
                      {isExpanded && (
                        <div style={{ padding: '12px 16px', background: THEME.surfaceVar, borderTop: `1px solid ${THEME.outlineVar}` }}>
                          {p.description && <p style={{ fontSize: '13px', color: THEME.textMed, margin: '0 0 12px' }}>{p.description}</p>}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>Enrollments ({enrollments.length})</span>
                            {canEdit && <Button icon="person_add" onClick={openEnrollModal} style={{ background: ACCENT, color: '#fff' }}>Enroll</Button>}
                          </div>
                          {enrollLoading ? <div style={{ color: THEME.textMed, fontSize: '13px' }}>Loading...</div> : enrollments.length === 0 ? (
                            <div style={{ color: THEME.textMed, fontSize: '13px' }}>No enrollments yet.</div>
                          ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                              <thead><tr>
                                <th style={{ textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, padding: '6px 8px' }}>Employee</th>
                                <th style={{ textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, padding: '6px 8px' }}>Status</th>
                                <th style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: THEME.textMed, padding: '6px 8px' }}>Score</th>
                                {canEdit && <th style={{ textAlign: 'center', fontSize: '11px', fontWeight: 600, color: THEME.textMed, padding: '6px 8px' }}>Action</th>}
                              </tr></thead>
                              <tbody>
                                {enrollments.map(en => (
                                  <tr key={en.id} style={{ borderTop: `1px solid ${THEME.outlineVar}` }}>
                                    <td style={{ padding: '6px 8px', fontSize: '13px', color: THEME.text }}>{en.employee?.name || '—'}</td>
                                    <td style={{ padding: '6px 8px' }}><Badge status={en.status} meta={ENROLL_STATUS} /></td>
                                    <td style={{ padding: '6px 8px', fontSize: '13px', color: THEME.text, textAlign: 'center' }}>{en.score ?? '—'}</td>
                                    {canEdit && (
                                      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                        <Button variant="ghost" icon="edit" onClick={() => { setEditEnroll(en); setEnrollForm({ status: en.status, score: en.score ?? '' }) }} />
                                      </td>
                                    )}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      {/* Program Add/Edit Modal */}
      {showModal && (
        <div style={overlayStyle} onClick={() => setShowModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 500, color: THEME.text }}>{editId ? 'Edit Program' : 'New Training Program'}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><div style={labelStyle}>Title *</div><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
              <div><div style={labelStyle}>Description</div><textarea style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', minHeight: '60px', resize: 'vertical' }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><div style={labelStyle}>Trainer</div><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={form.trainer} onChange={e => setForm(f => ({ ...f, trainer: e.target.value }))} /></div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div><div style={labelStyle}>Start Date</div><input type="date" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} /></div>
                <div><div style={labelStyle}>End Date</div><input type="date" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div><div style={labelStyle}>Max Participants</div><input type="number" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={form.max_participants} onChange={e => setForm(f => ({ ...f, max_participants: e.target.value }))} /></div>
                <div><div style={labelStyle}>Status</div>
                  <select style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} style={{ background: ACCENT, color: '#fff' }}>{saving ? 'Saving...' : 'Save'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Enroll Modal */}
      {showEnrollModal && (
        <div style={overlayStyle} onClick={() => setShowEnrollModal(false)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 500, color: THEME.text }}>Enroll Employees</h3>
            {availableEmps.length === 0 ? (
              <div style={{ color: THEME.textMed, fontSize: '13px', padding: '12px 0' }}>All employees are already enrolled.</div>
            ) : (
              <div style={{ maxHeight: '300px', overflow: 'auto', border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px' }}>
                {availableEmps.map(emp => (
                  <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px', color: THEME.text }}>
                    <input type="checkbox" checked={selectedEmps.includes(emp.id)} onChange={e => {
                      setSelectedEmps(prev => e.target.checked ? [...prev, emp.id] : prev.filter(id => id !== emp.id))
                    }} />
                    {emp.name} {emp.employee_number ? `(${emp.employee_number})` : ''}
                  </label>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <span style={{ fontSize: '12px', color: THEME.textMed }}>{selectedEmps.length} selected</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="ghost" onClick={() => setShowEnrollModal(false)}>Cancel</Button>
                <Button onClick={handleEnroll} disabled={enrollSaving || !selectedEmps.length} style={{ background: ACCENT, color: '#fff' }}>{enrollSaving ? 'Enrolling...' : 'Enroll'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Enrollment Modal */}
      {editEnroll && (
        <div style={overlayStyle} onClick={() => setEditEnroll(null)}>
          <div style={{ ...modalStyle, width: '340px' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 500, color: THEME.text }}>Update Enrollment</h3>
            <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '12px' }}>{editEnroll.employee?.name}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><div style={labelStyle}>Status</div>
                <select style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={enrollForm.status} onChange={e => setEnrollForm(f => ({ ...f, status: e.target.value }))}>
                  {Object.entries(ENROLL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div><div style={labelStyle}>Score</div><input type="number" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={enrollForm.score} onChange={e => setEnrollForm(f => ({ ...f, score: e.target.value }))} placeholder="Optional" /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
              <Button variant="ghost" onClick={() => setEditEnroll(null)}>Cancel</Button>
              <Button onClick={handleUpdateEnroll} disabled={saving} style={{ background: ACCENT, color: '#fff' }}>{saving ? 'Saving...' : 'Update'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
