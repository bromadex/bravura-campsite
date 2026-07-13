import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { useAuth } from '../../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast, fmtDate } from '../../../components/ui'

const ACCENT = MODULE_COLORS.workforce

const STATUS_META = {
  open:              { label: 'Open',              bg: THEME.statusWarningBg,  text: THEME.statusWarningText },
  hearing_scheduled: { label: 'Hearing Scheduled', bg: THEME.statusInfoBg,     text: THEME.statusInfoText },
  closed:            { label: 'Closed',            bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
}

const INCIDENT_TYPES = ['Misconduct', 'Negligence', 'Insubordination', 'Absenteeism', 'Other']
const OUTCOMES = ['Verbal Warning', 'Written Warning', 'Final Warning', 'Suspension', 'Dismissal', 'Not Guilty', 'Case Withdrawn']

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}
const selectStyle = { ...inputStyle, appearance: 'auto' }

const badgeStyle = (meta) => ({
  display: 'inline-block', padding: '3px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
  background: meta.bg, color: meta.text,
})

const EMPTY = { employee_id: '', incident_date: new Date().toISOString().slice(0, 10), incident_type: 'Misconduct', description: '' }

export default function DisciplinaryCases() {
  const { profile } = useAuth()
  const { currentSiteId } = useSite()
  const { can } = usePermissions()

  const [rows, setRows] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [addModal, setAddModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [detailModal, setDetailModal] = useState(null)
  const [detailForm, setDetailForm] = useState({})
  const [detailSaving, setDetailSaving] = useState(false)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterEmployee, setFilterEmployee] = useState('')
  const [filterType, setFilterType] = useState('')

  const canEdit = can('hr.edit')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [caseRes, empRes] = await Promise.all([
      supabase.from('disciplinary_cases')
        .select('*')
        .eq('site_id', currentSiteId)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name')
        .eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    if (caseRes.error) { showToast('Failed to load cases', 'red'); console.error(caseRes.error) }
    setRows(caseRes.data || [])
    setEmployees(empRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e.name])), [employees])

  const filtered = useMemo(() => {
    let out = rows
    if (filterStatus !== 'all') out = out.filter(r => r.status === filterStatus)
    if (filterEmployee) out = out.filter(r => r.employee_id === filterEmployee)
    if (filterType) out = out.filter(r => r.incident_type === filterType)
    return out
  }, [rows, filterStatus, filterEmployee, filterType])

  const addCase = async () => {
    if (!form.employee_id || !form.incident_date || !form.description) {
      showToast('Employee, date, and description required', 'red'); return
    }
    setSaving(true)
    const caseNumber = 'DC-' + Date.now()
    const { error } = await supabase.from('disciplinary_cases').insert({
      ...form, case_number: caseNumber, site_id: currentSiteId, status: 'open', created_by: profile?.id,
    })
    setSaving(false)
    if (error) { showToast('Failed to create case', 'red'); console.error(error); return }
    showToast('Case created', 'green')
    setAddModal(false)
    setForm(EMPTY)
    load()
  }

  const openDetail = (row) => {
    setDetailModal(row)
    setDetailForm({
      outcome: row.outcome || '',
      hearing_date: row.hearing_date || '',
      status: row.status,
    })
  }

  const saveDetail = async () => {
    setDetailSaving(true)
    const updates = { outcome: detailForm.outcome || null, hearing_date: detailForm.hearing_date || null }
    if (detailForm.status === 'closed' && detailModal.status !== 'closed') {
      if (!detailForm.outcome) { showToast('Outcome required to close case', 'red'); setDetailSaving(false); return }
      updates.status = 'closed'
      updates.closed_at = new Date().toISOString()
    } else if (detailForm.hearing_date && detailModal.status === 'open') {
      updates.status = 'hearing_scheduled'
    }
    const { error } = await supabase.from('disciplinary_cases')
      .update(updates)
      .eq('id', detailModal.id)
      .eq('site_id', currentSiteId)
    setDetailSaving(false)
    if (error) { showToast('Failed to update case', 'red'); console.error(error); return }
    showToast('Case updated', 'green')
    setDetailModal(null)
    load()
  }

  if (!can('hr.view')) return <div style={{ padding: 40, color: THEME.textLow }}>You do not have permission to view this page.</div>

  return (
    <div style={{ padding: '0 24px 40px' }}>
      <PageHeader title="Disciplinary Cases" accent={ACCENT} />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 160 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="hearing_scheduled">Hearing Scheduled</option>
          <option value="closed">Closed</option>
        </select>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 180 }} value={filterEmployee} onChange={e => setFilterEmployee(e.target.value)}>
          <option value="">All Employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 'auto', minWidth: 160 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">All Types</option>
          {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {canEdit && <Button onClick={() => setAddModal(true)} accent={ACCENT}>+ Add Case</Button>}
      </div>

      {loading ? (
        <div style={{ color: THEME.textLow, padding: 24 }}>Loading...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: THEME.textLow, padding: 24 }}>No disciplinary cases found.</div>
      ) : (
        <TableWrap>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead><tr><Th>Case #</Th><Th>Employee</Th><Th>Incident Date</Th><Th>Type</Th><Th>Outcome</Th><Th>Status</Th></tr></THead>
            <tbody>
              {filtered.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.open
                return (
                  <TRow key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                    <Td>{r.case_number}</Td>
                    <Td>{empMap[r.employee_id] || r.employee_id}</Td>
                    <Td>{fmtDate(r.incident_date)}</Td>
                    <Td>{r.incident_type}</Td>
                    <Td>{r.outcome || '-'}</Td>
                    <Td><span style={badgeStyle(meta)}>{meta.label}</span></Td>
                  </TRow>
                )
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      {/* Add Case Modal */}
      {addModal && (
        <Modal title="New Disciplinary Case" onClose={() => setAddModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Employee</SectionLabel>
              <select style={selectStyle} value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}>
                <option value="">Select employee...</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Incident Date</SectionLabel>
              <input style={inputStyle} type="date" value={form.incident_date} onChange={e => setForm(p => ({ ...p, incident_date: e.target.value }))} />
            </div>
            <div>
              <SectionLabel>Type</SectionLabel>
              <select style={selectStyle} value={form.incident_type} onChange={e => setForm(p => ({ ...p, incident_type: e.target.value }))}>
                {INCIDENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Description</SectionLabel>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
            </div>
            <Button onClick={addCase} accent={ACCENT} disabled={saving}>{saving ? 'Saving...' : 'Create Case'}</Button>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {detailModal && (
        <Modal title={`Case ${detailModal.case_number}`} onClose={() => setDetailModal(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><SectionLabel>Employee</SectionLabel><div style={{ fontSize: 14 }}>{empMap[detailModal.employee_id] || detailModal.employee_id}</div></div>
              <div><SectionLabel>Incident Date</SectionLabel><div style={{ fontSize: 14 }}>{fmtDate(detailModal.incident_date)}</div></div>
              <div><SectionLabel>Type</SectionLabel><div style={{ fontSize: 14 }}>{detailModal.incident_type}</div></div>
              <div><SectionLabel>Status</SectionLabel><span style={badgeStyle(STATUS_META[detailModal.status] || STATUS_META.open)}>{(STATUS_META[detailModal.status] || STATUS_META.open).label}</span></div>
            </div>
            <div><SectionLabel>Description</SectionLabel><div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{detailModal.description}</div></div>

            {canEdit && detailModal.status !== 'closed' && (
              <>
                <div>
                  <SectionLabel>Hearing Date</SectionLabel>
                  <input style={inputStyle} type="date" value={detailForm.hearing_date} onChange={e => setDetailForm(p => ({ ...p, hearing_date: e.target.value }))} />
                </div>
                <div>
                  <SectionLabel>Outcome</SectionLabel>
                  <select style={selectStyle} value={detailForm.outcome} onChange={e => setDetailForm(p => ({ ...p, outcome: e.target.value }))}>
                    <option value="">Select outcome...</option>
                    {OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <Button onClick={saveDetail} accent={ACCENT} disabled={detailSaving}>{detailSaving ? 'Saving...' : 'Save'}</Button>
                  <Button onClick={() => { setDetailForm(p => ({ ...p, status: 'closed' })); }} accent={THEME.textLow}>Close Case</Button>
                </div>
                {detailForm.status === 'closed' && (
                  <div style={{ padding: 12, background: THEME.statusWarningBg, borderRadius: 8, fontSize: 13, color: THEME.statusWarningText }}>
                    Select an outcome above, then click Save to close the case.
                    <div style={{ marginTop: 8 }}>
                      <Button onClick={saveDetail} accent={THEME.error} disabled={detailSaving}>{detailSaving ? 'Closing...' : 'Confirm Close'}</Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {detailModal.status === 'closed' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div><SectionLabel>Outcome</SectionLabel><div style={{ fontSize: 14 }}>{detailModal.outcome || '-'}</div></div>
                <div><SectionLabel>Closed At</SectionLabel><div style={{ fontSize: 14 }}>{detailModal.closed_at ? fmtDate(detailModal.closed_at) : '-'}</div></div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
