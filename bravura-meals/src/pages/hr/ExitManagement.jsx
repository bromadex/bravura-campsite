import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast, fmtDate } from '../../components/ui'

const ACCENT = MODULE_COLORS.workforce

const STATUS_META = {
  in_progress: { label: 'In Progress', bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  completed:   { label: 'Completed',   bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
}

const EXIT_TYPES = ['Resignation', 'Termination', 'Retirement', 'Redundancy', 'Death']

const CLEARANCE_ITEMS = [
  { key: 'room_returned', label: 'Room Returned' },
  { key: 'equipment_returned', label: 'Equipment Returned' },
  { key: 'access_revoked', label: 'Access Revoked' },
  { key: 'final_payslip_generated', label: 'Final Payslip Generated' },
]

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}
const selectStyle = { ...inputStyle, appearance: 'auto' }

const badgeStyle = (meta) => ({
  display: 'inline-block', padding: '3px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
  background: meta.bg, color: meta.text,
})

const EMPTY = { employee_id: '', exit_type: 'Resignation', last_working_date: '', exit_interview_date: '', exit_interview_notes: '' }

export default function ExitManagement() {
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

  const canEdit = can('hr.edit')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [exitRes, empRes] = await Promise.all([
      supabase.from('exit_records')
        .select('*')
        .eq('site_id', currentSiteId)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name')
        .eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    if (exitRes.error) { showToast('Failed to load exit records', 'red'); console.error(exitRes.error) }
    setRows(exitRes.data || [])
    setEmployees(empRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e.name])), [employees])

  const addRecord = async () => {
    if (!form.employee_id || !form.last_working_date) {
      showToast('Employee and last working date required', 'red'); return
    }
    setSaving(true)
    const { error } = await supabase.from('exit_records').insert({
      ...form, site_id: currentSiteId, status: 'in_progress', clearance_completed: false,
    })
    setSaving(false)
    if (error) { showToast('Failed to create exit record', 'red'); console.error(error); return }
    showToast('Exit record created', 'green')
    setAddModal(false)
    setForm(EMPTY)
    load()
  }

  const openDetail = (row) => {
    setDetailModal(row)
    setDetailForm({
      room_returned: !!row.room_returned,
      equipment_returned: !!row.equipment_returned,
      access_revoked: !!row.access_revoked,
      final_payslip_generated: !!row.final_payslip_generated,
      exit_interview_notes: row.exit_interview_notes || '',
    })
  }

  const saveDetail = async () => {
    setDetailSaving(true)
    const { error } = await supabase.from('exit_records')
      .update({
        room_returned: detailForm.room_returned,
        equipment_returned: detailForm.equipment_returned,
        access_revoked: detailForm.access_revoked,
        final_payslip_generated: detailForm.final_payslip_generated,
        exit_interview_notes: detailForm.exit_interview_notes || null,
      })
      .eq('id', detailModal.id)
      .eq('site_id', currentSiteId)
    setDetailSaving(false)
    if (error) { showToast('Failed to update record', 'red'); console.error(error); return }
    showToast('Record updated', 'green')
    setDetailModal(null)
    load()
  }

  const markClearanceComplete = async () => {
    setDetailSaving(true)
    const { error } = await supabase.from('exit_records')
      .update({
        clearance_completed: true,
        clearance_date: new Date().toISOString().slice(0, 10),
        clearance_by: profile?.id,
        status: 'completed',
        room_returned: detailForm.room_returned,
        equipment_returned: detailForm.equipment_returned,
        access_revoked: detailForm.access_revoked,
        final_payslip_generated: detailForm.final_payslip_generated,
        exit_interview_notes: detailForm.exit_interview_notes || null,
      })
      .eq('id', detailModal.id)
      .eq('site_id', currentSiteId)
    setDetailSaving(false)
    if (error) { showToast('Failed to complete clearance', 'red'); console.error(error); return }
    showToast('Clearance completed', 'green')
    setDetailModal(null)
    load()
  }

  if (!can('hr.view')) return <div style={{ padding: 40, color: THEME.textLow }}>You do not have permission to view this page.</div>

  return (
    <div style={{ padding: '0 24px 40px' }}>
      <PageHeader title="Exit Management" accent={ACCENT} />

      {canEdit && (
        <div style={{ marginBottom: 16 }}>
          <Button onClick={() => setAddModal(true)} accent={ACCENT}>+ Add Exit Record</Button>
        </div>
      )}

      {loading ? (
        <div style={{ color: THEME.textLow, padding: 24 }}>Loading...</div>
      ) : rows.length === 0 ? (
        <div style={{ color: THEME.textLow, padding: 24 }}>No exit records found.</div>
      ) : (
        <TableWrap>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead><tr><Th>Employee</Th><Th>Exit Type</Th><Th>Last Working Date</Th><Th>Clearance</Th><Th>Status</Th></tr></THead>
            <tbody>
              {rows.map(r => {
                const meta = STATUS_META[r.status] || STATUS_META.in_progress
                return (
                  <TRow key={r.id} onClick={() => openDetail(r)} style={{ cursor: 'pointer' }}>
                    <Td>{empMap[r.employee_id] || r.employee_id}</Td>
                    <Td>{r.exit_type}</Td>
                    <Td>{fmtDate(r.last_working_date)}</Td>
                    <Td>{r.clearance_completed ? 'Complete' : 'Pending'}</Td>
                    <Td><span style={badgeStyle(meta)}>{meta.label}</span></Td>
                  </TRow>
                )
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      {/* Add Exit Record Modal */}
      {addModal && (
        <Modal title="New Exit Record" onClose={() => setAddModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Employee</SectionLabel>
              <select style={selectStyle} value={form.employee_id} onChange={e => setForm(p => ({ ...p, employee_id: e.target.value }))}>
                <option value="">Select employee...</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Exit Type</SectionLabel>
              <select style={selectStyle} value={form.exit_type} onChange={e => setForm(p => ({ ...p, exit_type: e.target.value }))}>
                {EXIT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Last Working Date</SectionLabel>
              <input style={inputStyle} type="date" value={form.last_working_date} onChange={e => setForm(p => ({ ...p, last_working_date: e.target.value }))} />
            </div>
            <div>
              <SectionLabel>Exit Interview Date</SectionLabel>
              <input style={inputStyle} type="date" value={form.exit_interview_date} onChange={e => setForm(p => ({ ...p, exit_interview_date: e.target.value }))} />
            </div>
            <div>
              <SectionLabel>Notes</SectionLabel>
              <textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={form.exit_interview_notes} onChange={e => setForm(p => ({ ...p, exit_interview_notes: e.target.value }))} />
            </div>
            <Button onClick={addRecord} accent={ACCENT} disabled={saving}>{saving ? 'Saving...' : 'Create Record'}</Button>
          </div>
        </Modal>
      )}

      {/* Detail Modal */}
      {detailModal && (
        <Modal title={`Exit - ${empMap[detailModal.employee_id] || 'Employee'}`} onClose={() => setDetailModal(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><SectionLabel>Exit Type</SectionLabel><div style={{ fontSize: 14 }}>{detailModal.exit_type}</div></div>
              <div><SectionLabel>Last Working Date</SectionLabel><div style={{ fontSize: 14 }}>{fmtDate(detailModal.last_working_date)}</div></div>
              <div><SectionLabel>Exit Interview Date</SectionLabel><div style={{ fontSize: 14 }}>{detailModal.exit_interview_date ? fmtDate(detailModal.exit_interview_date) : '-'}</div></div>
              <div><SectionLabel>Status</SectionLabel><span style={badgeStyle(STATUS_META[detailModal.status] || STATUS_META.in_progress)}>{(STATUS_META[detailModal.status] || STATUS_META.in_progress).label}</span></div>
            </div>

            <SectionLabel>Clearance Checklist</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {CLEARANCE_ITEMS.map(item => (
                <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, cursor: canEdit && !detailModal.clearance_completed ? 'pointer' : 'default' }}>
                  <div
                    onClick={() => {
                      if (!canEdit || detailModal.clearance_completed) return
                      setDetailForm(p => ({ ...p, [item.key]: !p[item.key] }))
                    }}
                    style={{
                      width: 40, height: 22, borderRadius: 11, position: 'relative', transition: 'background 0.2s',
                      background: detailForm[item.key] ? THEME.success : THEME.outline, cursor: canEdit && !detailModal.clearance_completed ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2,
                      left: detailForm[item.key] ? 20 : 2, transition: 'left 0.2s',
                    }} />
                  </div>
                  {item.label}
                </label>
              ))}
            </div>

            <div>
              <SectionLabel>Exit Interview Notes</SectionLabel>
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={detailForm.exit_interview_notes}
                onChange={e => setDetailForm(p => ({ ...p, exit_interview_notes: e.target.value }))}
                disabled={!canEdit}
              />
            </div>

            {canEdit && !detailModal.clearance_completed && (
              <div style={{ display: 'flex', gap: 12 }}>
                <Button onClick={saveDetail} accent={ACCENT} disabled={detailSaving}>{detailSaving ? 'Saving...' : 'Save'}</Button>
                <Button onClick={markClearanceComplete} accent={THEME.success} disabled={detailSaving}>Mark Clearance Complete</Button>
              </div>
            )}

            {detailModal.clearance_completed && (
              <div style={{ padding: 12, background: THEME.statusSuccessBg, borderRadius: 8, fontSize: 13, color: THEME.statusSuccessText }}>
                Clearance completed on {fmtDate(detailModal.clearance_date)}.
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
