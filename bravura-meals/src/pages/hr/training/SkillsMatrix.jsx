import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { PageHeader, Button, Icon, showToast } from '../../../components/ui'
import Denied from '../../../components/Denied'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce

const PROF_LEVELS = ['Beginner', 'Intermediate', 'Expert']
const PROF_COLORS = {
  Expert:       { bg: '#4caf50', text: '#fff' },
  Intermediate: { bg: '#ff9800', text: '#fff' },
  Beginner:     { bg: '#9e9e9e', text: '#fff' },
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
  background: THEME.surface, borderRadius: '14px', padding: '24px', width: '380px',
  maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto', boxShadow: THEME.shadow3,
}

export default function SkillsMatrix() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('employee_skills', { column: 'site_id', value: currentSiteId })

  const [employees, setEmployees] = useState([])
  const [skills, setSkills] = useState([])
  const [empSkills, setEmpSkills] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [editCell, setEditCell] = useState(null) // { employeeId, skillId, existing }
  const [cellForm, setCellForm] = useState({ proficiency_level: 'Beginner', acquired_date: '', certified_by: '', notes: '' })
  const [saving, setSaving] = useState(false)

  if (!can('hr.view')) return <Denied />

  const canEdit = can('hr.edit')

  const loadData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [empRes, skillRes, deptRes] = await Promise.all([
      supabase.from('employees').select('id, name, employee_number, department_id, department:departments!employees_department_id_fkey(id, name)').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('skills').select('*').eq('is_active', true).order('category').order('name'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId).order('name'),
    ])
    if (empRes.error) { showToast('Failed to load employees', 'red'); console.error(empRes.error) }
    if (skillRes.error) { showToast('Failed to load skills', 'red'); console.error(skillRes.error) }
    if (deptRes.error) { showToast('Failed to load departments', 'red'); console.error(deptRes.error) }

    const emps = empRes.data || []
    setEmployees(emps)
    setSkills(skillRes.data || [])
    setDepartments(deptRes.data || [])

    // Load employee_skills for these employees
    if (emps.length) {
      const empIds = emps.map(e => e.id)
      const { data, error } = await supabase.from('employee_skills').select('*').in('employee_id', empIds)
      if (error) { showToast('Failed to load skills data', 'red'); console.error(error) }
      setEmpSkills(data || [])
    } else {
      setEmpSkills([])
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { loadData() }, [loadData, rt])

  const filteredEmps = useMemo(() => {
    if (deptFilter === 'all') return employees
    return employees.filter(e => String(e.department_id) === deptFilter)
  }, [employees, deptFilter])

  // Build a lookup: `${employeeId}_${skillId}` -> employee_skills row
  const skillMap = useMemo(() => {
    const m = new Map()
    empSkills.forEach(es => m.set(`${es.employee_id}_${es.skill_id}`, es))
    return m
  }, [empSkills])

  const openCell = (emp, skill) => {
    if (!canEdit) return
    const existing = skillMap.get(`${emp.id}_${skill.id}`) || null
    setEditCell({ employeeId: emp.id, skillId: skill.id, employeeName: emp.name, skillName: skill.name, existing })
    setCellForm(existing
      ? { proficiency_level: existing.proficiency_level, acquired_date: existing.acquired_date || '', certified_by: existing.certified_by || '', notes: existing.notes || '' }
      : { proficiency_level: 'Beginner', acquired_date: '', certified_by: '', notes: '' })
  }

  const handleSaveCell = async () => {
    if (!editCell) return
    setSaving(true)
    const payload = {
      employee_id: editCell.employeeId,
      skill_id: editCell.skillId,
      proficiency_level: cellForm.proficiency_level,
      acquired_date: cellForm.acquired_date || null,
      certified_by: cellForm.certified_by || null,
      notes: cellForm.notes || null,
    }
    let err
    if (editCell.existing) {
      const { error } = await supabase.from('employee_skills').update(payload).eq('id', editCell.existing.id)
      err = error
    } else {
      const { error } = await supabase.from('employee_skills').upsert(payload, { onConflict: 'employee_id,skill_id' })
      err = error
    }
    setSaving(false)
    if (err) { showToast('Save failed: ' + err.message, 'red'); return }
    showToast('Skill updated', 'green')
    setEditCell(null)
    loadData()
  }

  const handleRemoveCell = async () => {
    if (!editCell?.existing) return
    setSaving(true)
    const { error } = await supabase.from('employee_skills').delete().eq('id', editCell.existing.id)
    setSaving(false)
    if (error) { showToast('Remove failed: ' + error.message, 'red'); return }
    showToast('Skill removed', 'green')
    setEditCell(null)
    loadData()
  }

  const handleExport = () => {
    const headers = ['Employee', ...skills.map(s => s.name)]
    const rows = filteredEmps.map(emp => [
      emp.name,
      ...skills.map(s => {
        const es = skillMap.get(`${emp.id}_${s.id}`)
        return es ? es.proficiency_level : ''
      }),
    ])
    exportCsv('skills_matrix.csv', headers, rows)
  }

  const thStyle = {
    padding: '8px 6px', fontSize: '11px', fontWeight: 600, color: THEME.textMed,
    borderBottom: `2px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap', textAlign: 'center',
    position: 'sticky', top: 0, background: THEME.surface, zIndex: 1,
  }

  return (
    <div>
      <PageHeader title="Skills Matrix" site={currentSite?.name} actions={
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select style={{ ...inputStyle, minWidth: '160px' }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
          </select>
          <Button icon="download" onClick={handleExport} style={{ background: ACCENT, color: '#fff' }}>Export CSV</Button>
        </div>
      } />

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</div>
      ) : skills.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>No skills defined yet.</div>
      ) : filteredEmps.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>No employees found.</div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'auto', maxHeight: '70vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: `${200 + skills.length * 90}px` }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: 'left', position: 'sticky', left: 0, background: THEME.surface, zIndex: 2, minWidth: '180px' }}>Employee</th>
                {skills.map(s => <th key={s.id} style={thStyle} title={s.category ? `${s.category}: ${s.name}` : s.name}>{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {filteredEmps.map((emp, ri) => (
                <tr key={emp.id} style={{ borderBottom: ri < filteredEmps.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none' }}>
                  <td style={{
                    padding: '8px 10px', fontSize: '13px', fontWeight: 500, color: THEME.text,
                    position: 'sticky', left: 0, background: THEME.surface, zIndex: 1, whiteSpace: 'nowrap',
                  }}>
                    {emp.name}
                  </td>
                  {skills.map(s => {
                    const es = skillMap.get(`${emp.id}_${s.id}`)
                    const prof = es?.proficiency_level
                    const colors = prof ? PROF_COLORS[prof] : null
                    return (
                      <td key={s.id}
                        onClick={() => openCell(emp, s)}
                        style={{
                          padding: '4px', textAlign: 'center', cursor: canEdit ? 'pointer' : 'default',
                          transition: 'background .15s',
                        }}
                        title={prof ? `${prof} — click to edit` : canEdit ? 'Click to add' : ''}
                      >
                        {prof && (
                          <span style={{
                            display: 'inline-block', padding: '3px 10px', borderRadius: '999px',
                            fontSize: '11px', fontWeight: 600, background: colors.bg, color: colors.text,
                          }}>
                            {prof.charAt(0)}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginTop: '12px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {PROF_LEVELS.map(l => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '50%', background: PROF_COLORS[l].bg, display: 'inline-block' }} />
            {l}
          </span>
        ))}
      </div>

      {/* Edit Cell Modal */}
      {editCell && (
        <div style={overlayStyle} onClick={() => setEditCell(null)}>
          <div style={modalStyle} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px', fontSize: '18px', fontWeight: 500, color: THEME.text }}>Skill Assignment</h3>
            <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '16px' }}>{editCell.employeeName} — {editCell.skillName}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div><div style={labelStyle}>Proficiency</div>
                <select style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={cellForm.proficiency_level} onChange={e => setCellForm(f => ({ ...f, proficiency_level: e.target.value }))}>
                  {PROF_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div><div style={labelStyle}>Acquired Date</div><input type="date" style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={cellForm.acquired_date} onChange={e => setCellForm(f => ({ ...f, acquired_date: e.target.value }))} /></div>
              <div><div style={labelStyle}>Certified By</div><input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} value={cellForm.certified_by} onChange={e => setCellForm(f => ({ ...f, certified_by: e.target.value }))} /></div>
              <div><div style={labelStyle}>Notes</div><textarea style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', minHeight: '50px', resize: 'vertical' }} value={cellForm.notes} onChange={e => setCellForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
              <div>
                {editCell.existing && (
                  <Button variant="ghost" onClick={handleRemoveCell} disabled={saving} style={{ color: THEME.error }}>Remove</Button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Button variant="ghost" onClick={() => setEditCell(null)}>Cancel</Button>
                <Button onClick={handleSaveCell} disabled={saving} style={{ background: ACCENT, color: '#fff' }}>{saving ? 'Saving...' : 'Save'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
