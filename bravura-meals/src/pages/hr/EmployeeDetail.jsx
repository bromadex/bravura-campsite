import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useAuth } from '../../auth/AuthContext'
import { Card, Icon, PageHeader, Button, Modal, SectionLabel, showToast, fmtDate } from '../../components/ui'

const ACCENT = MODULE_COLORS.workforce

const STATUS_META = {
  active:               { label: 'Active',       bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText },
  on_leave:             { label: 'On Leave',     bg: THEME.statusWarningBg,  text: THEME.statusWarningText },
  long_leave:           { label: 'Long Leave',   bg: THEME.statusTertiaryBg, text: THEME.statusTertiaryText },
  temporary_assignment: { label: 'Temp Assign',  bg: THEME.statusInfoBg,     text: THEME.statusInfoText },
  transferred:          { label: 'Transferred',  bg: THEME.statusInfoBg,     text: THEME.statusInfoText },
  terminated:           { label: 'Terminated',   bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
}
const STATUS_OPTIONS = [
  { value: 'active',               label: 'Active' },
  { value: 'on_leave',             label: 'On Leave (short)' },
  { value: 'long_leave',           label: 'Long Leave' },
  { value: 'temporary_assignment', label: 'Temporary Assignment' },
  { value: 'transferred',          label: 'Transferred' },
  { value: 'terminated',           label: 'Terminated' },
]

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

function Badge({ status }) {
  const m = STATUS_META[status] || STATUS_META.active
  return <span style={{ padding: '3px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 700, background: m.bg, color: m.text }}>{m.label}</span>
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px' }}>
      <span style={{ color: THEME.textLow }}>{label}</span>
      <span style={{ color: THEME.text, fontWeight: 600, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  )
}

const EXAM_RESULTS = ['Fit', 'Fit with Restrictions', 'Unfit', 'Pending']
const EXAM_TYPES = ['Pre-Employment', 'Annual', 'Exit', 'Specific']

export default function EmployeeDetail({ setPage, employeeId }) {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const { profile } = useAuth()
  const userId = profile?.id

  const [emp, setEmp] = useState(null)
  const [contacts, setContacts] = useState([])
  const [history, setHistory] = useState([])
  const [actors, setActors] = useState({})
  const [tab, setTab] = useState('Overview')
  const [loading, setLoading] = useState(true)

  const [statusModal, setStatusModal] = useState(false)
  const [stForm, setStForm] = useState({ status: '', reason: '', effective: new Date().toISOString().slice(0, 10), finalDate: '' })
  const [saving, setSaving] = useState(false)

  // Phase 2 tab data
  const [docs, setDocs] = useState([])
  const [docTypes, setDocTypes] = useState([])
  const [medical, setMedical] = useState([])
  const [leaveAlloc, setLeaveAlloc] = useState([])
  const [leaveReqs, setLeaveReqs] = useState([])
  const [docModal, setDocModal] = useState(false)
  const [docForm, setDocForm] = useState({ document_type_id: '', issue_date: '', expiry_date: '', file: null })
  const [medModal, setMedModal] = useState(false)
  const [medForm, setMedForm] = useState({ exam_type: 'Annual', exam_date: new Date().toISOString().slice(0, 10), result: 'Fit', restrictions: '', next_exam_date: '', blood_group: '', allergies: '', notes: '' })

  const load = useCallback(async () => {
    if (!currentSiteId || !employeeId) return
    setLoading(true)
    const [empRes, ecRes, histRes] = await Promise.all([
      supabase.from('employees')
        .select('*, contractor:contractors(id, name), department:departments(id, name), designation:designations(id, name), employment_type:employment_types(id, name)')
        .eq('id', employeeId).eq('site_id', currentSiteId).maybeSingle(),
      supabase.from('emergency_contacts').select('*').eq('employee_id', employeeId).order('is_primary', { ascending: false }),
      supabase.from('employee_status_history').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false }),
    ])
    if (empRes.error || !empRes.data) {
      console.error(empRes.error)
      showToast('Employee not found', 'red')
      setLoading(false)
      return
    }
    const e = empRes.data
    // Manager name (no reliable named-FK embed — resolve separately)
    if (e.manager_id) {
      const { data: mgr } = await supabase.from('employees').select('id, name').eq('id', e.manager_id).maybeSingle()
      e.manager_name = mgr?.name || null
    }
    setEmp(e)
    setContacts(ecRes.data || [])
    const hist = histRes.data || []
    setHistory(hist)
    const actorIds = [...new Set(hist.map(h => h.changed_by).filter(Boolean))]
    if (actorIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name, username').in('id', actorIds)
      setActors(Object.fromEntries((profs || []).map(p => [p.id, p.full_name || p.username])))
    }

    // Phase 2 data (documents, leave; medical only with its own permission)
    const year = new Date().getFullYear()
    const [docsRes, dtRes, laRes, lrRes] = await Promise.all([
      supabase.from('employee_documents')
        .select('*, document_type:document_types(id, name, requires_expiry)')
        .eq('employee_id', employeeId).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('document_types').select('*').eq('is_active', true).order('name'),
      supabase.from('leave_allocations')
        .select('*, leave_type:leave_types(id, name)')
        .eq('employee_id', employeeId).eq('year', year),
      supabase.from('leave_requests')
        .select('*, leave_type:leave_types(id, name)')
        .eq('employee_id', employeeId).order('created_at', { ascending: false }).limit(20),
    ])
    setDocs(docsRes.data || [])
    setDocTypes(dtRes.data || [])
    setLeaveAlloc(laRes.data || [])
    setLeaveReqs(lrRes.data || [])
    if (can('hr.approve')) {
      const { data: med } = await supabase.from('medical_records')
        .select('*').eq('employee_id', employeeId).order('exam_date', { ascending: false })
      setMedical(med || [])
    }
    setLoading(false)
  }, [currentSiteId, employeeId, can])

  useEffect(() => { load() }, [load])

  async function changeStatus() {
    if (!stForm.status) { showToast('Select a new status', 'red'); return }
    if (!stForm.reason.trim()) { showToast('A reason is required', 'red'); return }
    setSaving(true)
    const { error } = await supabase.rpc('change_employee_status', {
      p_employee_id: employeeId,
      p_new_status: stForm.status,
      p_reason: stForm.reason.trim(),
      p_effective_date: stForm.effective,
      p_end_date: stForm.status === 'terminated' ? (stForm.finalDate || stForm.effective) : null,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Status updated', 'green')
    setStatusModal(false)
    setStForm({ status: '', reason: '', effective: new Date().toISOString().slice(0, 10), finalDate: '' })
    load()
  }

  async function uploadDoc() {
    if (!docForm.document_type_id || !docForm.file) { showToast('Pick a document type and file', 'red'); return }
    const f = docForm.file
    if (!/\.(pdf|jpe?g|png)$/i.test(f.name)) { showToast('PDF, JPG or PNG only', 'red'); return }
    setSaving(true)
    const path = `${employeeId}/${Date.now()}_${f.name.replace(/[^\w.\-]/g, '_')}`
    const { error: upErr } = await supabase.storage.from('employee-documents').upload(path, f)
    if (upErr) { setSaving(false); showToast(upErr.message, 'red'); return }
    const { error } = await supabase.from('employee_documents').insert({
      employee_id: employeeId, site_id: currentSiteId,
      document_type_id: docForm.document_type_id,
      file_path: path, file_name: f.name, file_size_bytes: f.size,
      issue_date: docForm.issue_date || null,
      expiry_date: docForm.expiry_date || null,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Document uploaded', 'green')
    setDocModal(false)
    setDocForm({ document_type_id: '', issue_date: '', expiry_date: '', file: null })
    load()
  }

  async function verifyDoc(d) {
    const { error } = await supabase.from('employee_documents')
      .update({ is_verified: true, verified_by: userId, verified_at: new Date().toISOString() })
      .eq('id', d.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Document verified', 'green'); load()
  }

  async function downloadDoc(d) {
    const { data, error } = await supabase.storage.from('employee-documents').createSignedUrl(d.file_path, 300)
    if (error || !data?.signedUrl) { showToast('Could not generate download link', 'red'); return }
    window.open(data.signedUrl, '_blank')
  }

  async function saveMedical() {
    if (!medForm.exam_date) { showToast('Exam date is required', 'red'); return }
    setSaving(true)
    const { error } = await supabase.from('medical_records').insert({
      employee_id: employeeId, site_id: currentSiteId,
      exam_type: medForm.exam_type, exam_date: medForm.exam_date,
      result: medForm.result, restrictions: medForm.restrictions.trim() || null,
      next_exam_date: medForm.next_exam_date || null,
      blood_group: medForm.blood_group.trim() || null,
      allergies: medForm.allergies.trim() || null,
      notes: medForm.notes.trim() || null,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Medical record added', 'green'); setMedModal(false); load()
  }

  function docExpiryBadge(d) {
    if (!d.document_type?.requires_expiry || !d.expiry_date) return { label: 'No expiry', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText }
    const diff = (new Date(d.expiry_date) - new Date()) / 86400000
    if (diff < 0)  return { label: 'Expired',  bg: THEME.statusErrorBg,   text: THEME.statusErrorText }
    if (diff <= 30) return { label: `Expires ${fmtDate(d.expiry_date)}`, bg: THEME.statusWarningBg, text: THEME.statusWarningText }
    return { label: `Valid to ${fmtDate(d.expiry_date)}`, bg: THEME.statusSuccessBg, text: THEME.statusSuccessText }
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )
  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
  if (!emp) return (
    <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
      Employee not found at {currentSite?.name}.
      <div style={{ marginTop: '12px' }}><Button variant="outlined" onClick={() => setPage('wf_employees')}>Back to list</Button></div>
    </div>
  )

  const initials = emp.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const canChangeStatus = can('hr.edit') || can('hr.terminate')
  const statusOptions = STATUS_OPTIONS.filter(o => o.value !== 'terminated' || can('hr.terminate'))

  const historyTable = (full) => (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead>
        <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
          {['Date', 'Change', 'Reason', 'By'].map(h => (
            <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(full ? history : history.slice(0, 10)).map(h => (
          <tr key={h.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
            <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{fmtDate(h.effective_date)}</td>
            <td style={{ padding: '8px 10px' }}>
              {h.old_status ? <><Badge status={h.old_status} /> <Icon name="arrow_forward" size={12} style={{ color: THEME.textLow, verticalAlign: 'middle' }} /> </> : null}
              <Badge status={h.new_status} />
            </td>
            <td style={{ padding: '8px 10px', color: THEME.textMed }}>{h.reason || '—'}</td>
            <td style={{ padding: '8px 10px', color: THEME.textLow }}>{actors[h.changed_by] || '—'}</td>
          </tr>
        ))}
        {history.length === 0 && (
          <tr><td colSpan={4} style={{ padding: '20px', textAlign: 'center', color: THEME.textLow }}>No status changes recorded.</td></tr>
        )}
      </tbody>
    </table>
  )

  return (
    <div style={{ maxWidth: '960px' }}>
      <PageHeader
        title="Employee Detail"
        site={currentSite}
        actions={<Button variant="outlined" icon="arrow_back" onClick={() => setPage('wf_employees')}>All employees</Button>}
      />

      {/* Header card */}
      <Card style={{ marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%', background: ACCENT,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '22px', fontWeight: 700, flexShrink: 0,
          }}>{initials}</div>
          <div style={{ flex: 1, minWidth: '200px' }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{emp.name}</div>
            <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '3px' }}>
              <span style={{ fontFamily: 'monospace' }}>{emp.employee_number || 'No number'}</span>
              {emp.designation?.name && <> · {emp.designation.name}</>}
              {emp.department?.name && <> · {emp.department.name}</>}
            </div>
            <div style={{ marginTop: '8px' }}><Badge status={emp.status} /></div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {can('hr.edit') && <Button variant="outlined" icon="edit" onClick={() => setPage('wf_employee_form:' + emp.id)}>Edit</Button>}
            {canChangeStatus && <Button icon="swap_horiz" onClick={() => setStatusModal(true)}>Change Status</Button>}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '18px', borderBottom: `2px solid ${THEME.outlineVar}` }}>
        {['Overview', 'Employment', 'Documents', 'Leave', ...(can('hr.approve') ? ['Medical'] : []), 'History'].map(t => (
          <div key={t} onClick={() => setTab(t)} style={{
            padding: '9px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            color: tab === t ? ACCENT : THEME.textMed,
            borderBottom: tab === t ? `2px solid ${ACCENT}` : '2px solid transparent',
            marginBottom: '-2px',
          }}>{t}</div>
        ))}
      </div>

      {tab === 'Overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '10px' }}>Personal</div>
            <InfoRow label="Date of Birth" value={emp.date_of_birth && fmtDate(emp.date_of_birth)} />
            <InfoRow label="Gender" value={emp.gender} />
            <InfoRow label="National ID" value={emp.national_id} />
            <InfoRow label="Passport" value={emp.passport_number} />
            <InfoRow label="Phone" value={emp.phone} />
            <InfoRow label="Email" value={emp.email} />
          </Card>
          <Card>
            <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '10px' }}>Employment</div>
            <InfoRow label="Start Date" value={emp.start_date && fmtDate(emp.start_date)} />
            <InfoRow label="End Date" value={emp.end_date && fmtDate(emp.end_date)} />
            <InfoRow label="Employment Type" value={emp.employment_type?.name} />
            <InfoRow label="Contractor" value={emp.contractor?.name} />
            <InfoRow label="Manager" value={emp.manager_name} />
            <InfoRow label="Site" value={currentSite?.name} />
          </Card>
          <Card>
            <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '10px' }}>Emergency Contacts</div>
            {contacts.length === 0 ? (
              <div style={{ fontSize: '13px', color: THEME.textLow }}>None recorded.</div>
            ) : contacts.map(c => (
              <div key={c.id} style={{ padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>
                  {c.name} {c.is_primary && <span style={{ fontSize: '10px', color: ACCENT, fontWeight: 700 }}>PRIMARY</span>}
                </div>
                <div style={{ fontSize: '12px', color: THEME.textMed }}>{c.relationship} · {c.phone}{c.email ? ` · ${c.email}` : ''}</div>
              </div>
            ))}
          </Card>
        </div>
      )}

      {tab === 'Employment' && (
        <Card>
          <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '12px' }}>Status History</div>
          {historyTable(false)}
        </Card>
      )}

      {tab === 'Documents' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow }}>Documents</div>
            {can('hr.edit') && <Button icon="upload" onClick={() => { setDocForm({ document_type_id: '', issue_date: '', expiry_date: '', file: null }); setDocModal(true) }}>Upload</Button>}
          </div>
          {docs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
              <Icon name="folder" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
              No documents on file.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {docs.map(d => {
                const b = docExpiryBadge(d)
                return (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', flexWrap: 'wrap' }}>
                    <Icon name="description" size={22} style={{ color: ACCENT }} />
                    <div style={{ flex: 1, minWidth: '180px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text }}>
                        {d.document_type?.name || 'Document'}
                        {d.is_verified && (
                          <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, color: THEME.statusSuccessText, background: THEME.statusSuccessBg, padding: '2px 8px', borderRadius: '999px' }}>VERIFIED</span>
                        )}
                      </div>
                      <div style={{ fontSize: '12px', color: THEME.textLow }}>
                        {d.file_name}{d.issue_date ? ` · Issued ${fmtDate(d.issue_date)}` : ''}
                      </div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: b.bg, color: b.text }}>{b.label}</span>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {!d.is_verified && can('hr.edit') && <Button variant="outlined" icon="verified" onClick={() => verifyDoc(d)}>Verify</Button>}
                      <Button variant="outlined" icon="download" onClick={() => downloadDoc(d)}>Download</Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {tab === 'Leave' && (
        <div style={{ display: 'grid', gap: '16px' }}>
          <Card>
            <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '12px' }}>
              Balances — {new Date().getFullYear()}
            </div>
            {leaveAlloc.length === 0 ? (
              <div style={{ fontSize: '13px', color: THEME.textLow }}>No leave allocated this year. Allocate from Workforce → Leave Allocations.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
                {leaveAlloc.map(a => {
                  const rem = Number(a.allocated_days) + Number(a.carried_over_days) - Number(a.used_days)
                  return (
                    <div key={a.id} style={{ padding: '12px 14px', border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>{a.leave_type?.name}</div>
                      <div style={{ fontSize: '22px', fontWeight: 800, color: rem < 0 ? THEME.error : rem <= 2 ? THEME.warning : THEME.text }}>{rem.toFixed(1)}</div>
                      <div style={{ fontSize: '11px', color: THEME.textLow }}>of {(Number(a.allocated_days) + Number(a.carried_over_days)).toFixed(1)} · used {Number(a.used_days).toFixed(1)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
          <Card>
            <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '12px' }}>Recent Requests</div>
            {leaveReqs.length === 0 ? (
              <div style={{ fontSize: '13px', color: THEME.textLow }}>No leave requests recorded.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                    {['Type', 'From', 'To', 'Days', 'Status'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leaveReqs.map(r => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: THEME.text }}>{r.leave_type?.name || '—'}</td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed }}>{fmtDate(r.start_date)}</td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed }}>{fmtDate(r.end_date)}</td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed }}>{Number(r.days_requested).toFixed(1)}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{
                          padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                          background: r.status === 'approved' ? THEME.statusSuccessBg : r.status === 'rejected' ? THEME.statusErrorBg : r.status === 'cancelled' ? THEME.statusNeutralBg : THEME.statusWarningBg,
                          color: r.status === 'approved' ? THEME.statusSuccessText : r.status === 'rejected' ? THEME.statusErrorText : r.status === 'cancelled' ? THEME.statusNeutralText : THEME.statusWarningText,
                        }}>{r.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === 'Medical' && can('hr.approve') && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow }}>Medical Records</div>
            <Button icon="add" onClick={() => { setMedForm({ exam_type: 'Annual', exam_date: new Date().toISOString().slice(0, 10), result: 'Fit', restrictions: '', next_exam_date: '', blood_group: '', allergies: '', notes: '' }); setMedModal(true) }}>Add Record</Button>
          </div>
          {(() => {
            const next = medical.map(m => m.next_exam_date).filter(Boolean).sort()[0]
            if (!next) return null
            const diff = (new Date(next) - new Date()) / 86400000
            if (diff > 30) return null
            const overdue = diff < 0
            return (
              <div style={{ padding: '10px 14px', borderRadius: '10px', marginBottom: '14px', fontSize: '13px', background: overdue ? THEME.statusErrorBg : THEME.statusWarningBg, color: overdue ? THEME.statusErrorText : THEME.statusWarningText }}>
                <b>{overdue ? 'Medical exam overdue' : 'Medical exam due soon'}:</b> next exam {fmtDate(next)}
              </div>
            )
          })()}
          {medical.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
              <Icon name="medical_services" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
              No medical records.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '10px' }}>
              {medical.map(m => (
                <div key={m.id} style={{ padding: '12px 14px', border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text }}>{m.exam_type} exam · {fmtDate(m.exam_date)}</div>
                    <span style={{
                      padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                      background: m.result === 'Fit' ? THEME.statusSuccessBg : m.result === 'Unfit' ? THEME.statusErrorBg : THEME.statusWarningBg,
                      color: m.result === 'Fit' ? THEME.statusSuccessText : m.result === 'Unfit' ? THEME.statusErrorText : THEME.statusWarningText,
                    }}>{m.result}</span>
                  </div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '6px' }}>
                    {m.restrictions && <div><b>Restrictions:</b> {m.restrictions}</div>}
                    {m.next_exam_date && <div><b>Next exam:</b> {fmtDate(m.next_exam_date)}</div>}
                    {(m.blood_group || m.allergies) && <div>{m.blood_group && <><b>Blood group:</b> {m.blood_group} </>}{m.allergies && <><b>Allergies:</b> {m.allergies}</>}</div>}
                    {m.notes && <div style={{ color: THEME.textLow }}>{m.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'History' && (
        <Card>
          <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, marginBottom: '12px' }}>Audit Trail</div>
          {historyTable(true)}
        </Card>
      )}

      {/* Change status modal */}
      <Modal open={statusModal} onClose={() => setStatusModal(false)} title="Change Status"
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setStatusModal(false)}>Cancel</Button>
            <Button icon="check" onClick={changeStatus} disabled={saving}
              style={stForm.status === 'terminated' ? { background: THEME.error, border: `1px solid ${THEME.error}` } : undefined}>
              {saving ? 'Saving…' : stForm.status === 'terminated' ? 'Terminate employee' : 'Apply'}
            </Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>
            Current status: <Badge status={emp.status} />
          </div>
          <div>
            <SectionLabel>New Status *</SectionLabel>
            <select style={inputStyle} value={stForm.status} onChange={e => setStForm(f => ({ ...f, status: e.target.value }))}>
              <option value="">— Select —</option>
              {statusOptions.filter(o => o.value !== emp.status).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Effective Date</SectionLabel>
            <input style={inputStyle} type="date" value={stForm.effective} onChange={e => setStForm(f => ({ ...f, effective: e.target.value }))} />
          </div>
          {stForm.status === 'terminated' && (
            <>
              <div>
                <SectionLabel>Final Date</SectionLabel>
                <input style={inputStyle} type="date" value={stForm.finalDate} onChange={e => setStForm(f => ({ ...f, finalDate: e.target.value }))} />
              </div>
              <div style={{ padding: '10px 12px', borderRadius: '10px', background: THEME.statusErrorBg, color: THEME.statusErrorText, fontSize: '12px' }}>
                <b>Warning:</b> This terminates the employee. They disappear from meal entry,
                fuel operators, and fleet assignments. This cannot be undone easily.
              </div>
            </>
          )}
          <div>
            <SectionLabel>Reason *</SectionLabel>
            <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={stForm.reason} onChange={e => setStForm(f => ({ ...f, reason: e.target.value }))} placeholder="Recorded permanently in the status history" />
          </div>
        </div>
      </Modal>

      {/* Upload document modal */}
      <Modal open={docModal} onClose={() => setDocModal(false)} title="Upload Document"
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setDocModal(false)}>Cancel</Button>
            <Button icon="upload" onClick={uploadDoc} disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <SectionLabel>Document Type *</SectionLabel>
            <select style={inputStyle} value={docForm.document_type_id} onChange={e => setDocForm(f => ({ ...f, document_type_id: e.target.value }))}>
              <option value="">— Select —</option>
              {docTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>File (PDF, JPG or PNG) *</SectionLabel>
            <input style={inputStyle} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setDocForm(f => ({ ...f, file: e.target.files?.[0] || null }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Issue Date</SectionLabel>
              <input style={inputStyle} type="date" value={docForm.issue_date} onChange={e => setDocForm(f => ({ ...f, issue_date: e.target.value }))} />
            </div>
            <div>
              <SectionLabel>Expiry Date{docTypes.find(t => t.id === docForm.document_type_id)?.requires_expiry ? ' *' : ''}</SectionLabel>
              <input style={inputStyle} type="date" value={docForm.expiry_date} onChange={e => setDocForm(f => ({ ...f, expiry_date: e.target.value }))} />
            </div>
          </div>
          {docTypes.find(t => t.id === docForm.document_type_id)?.requires_expiry && !docForm.expiry_date && (
            <div style={{ fontSize: '12px', color: THEME.statusWarningText, background: THEME.statusWarningBg, padding: '8px 12px', borderRadius: '10px' }}>
              This document type tracks expiry — enter the expiry date so renewal alerts work.
            </div>
          )}
        </div>
      </Modal>

      {/* Add medical record modal */}
      <Modal open={medModal} onClose={() => setMedModal(false)} title="Add Medical Record"
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setMedModal(false)}>Cancel</Button>
            <Button icon="check" onClick={saveMedical} disabled={saving}>{saving ? 'Saving…' : 'Save record'}</Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Exam Type *</SectionLabel>
              <select style={inputStyle} value={medForm.exam_type} onChange={e => setMedForm(f => ({ ...f, exam_type: e.target.value }))}>
                {EXAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Exam Date *</SectionLabel>
              <input style={inputStyle} type="date" value={medForm.exam_date} onChange={e => setMedForm(f => ({ ...f, exam_date: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Result *</SectionLabel>
              <select style={inputStyle} value={medForm.result} onChange={e => setMedForm(f => ({ ...f, result: e.target.value }))}>
                {EXAM_RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Next Exam Date</SectionLabel>
              <input style={inputStyle} type="date" value={medForm.next_exam_date} onChange={e => setMedForm(f => ({ ...f, next_exam_date: e.target.value }))} />
            </div>
          </div>
          {medForm.result === 'Fit with Restrictions' && (
            <div>
              <SectionLabel>Restrictions</SectionLabel>
              <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical' }} value={medForm.restrictions} onChange={e => setMedForm(f => ({ ...f, restrictions: e.target.value }))} />
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Blood Group</SectionLabel>
              <input style={inputStyle} value={medForm.blood_group} onChange={e => setMedForm(f => ({ ...f, blood_group: e.target.value }))} placeholder="e.g. O+" />
            </div>
            <div>
              <SectionLabel>Allergies</SectionLabel>
              <input style={inputStyle} value={medForm.allergies} onChange={e => setMedForm(f => ({ ...f, allergies: e.target.value }))} />
            </div>
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical' }} value={medForm.notes} onChange={e => setMedForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div style={{ fontSize: '12px', color: THEME.textLow }}>
            Medical records are visible only to holders of the HR medical permission.
          </div>
        </div>
      </Modal>
    </div>
  )
}
