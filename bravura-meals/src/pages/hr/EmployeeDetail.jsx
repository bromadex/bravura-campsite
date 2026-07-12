import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
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

const TABS = ['Overview', 'Employment', 'Documents', 'Leave', 'History']

export default function EmployeeDetail({ setPage, employeeId }) {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [emp, setEmp] = useState(null)
  const [contacts, setContacts] = useState([])
  const [history, setHistory] = useState([])
  const [actors, setActors] = useState({})
  const [tab, setTab] = useState('Overview')
  const [loading, setLoading] = useState(true)

  const [statusModal, setStatusModal] = useState(false)
  const [stForm, setStForm] = useState({ status: '', reason: '', effective: new Date().toISOString().slice(0, 10), finalDate: '' })
  const [saving, setSaving] = useState(false)

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
    setLoading(false)
  }, [currentSiteId, employeeId])

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
        {TABS.map(t => (
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
        <Card style={{ textAlign: 'center', padding: '48px', color: THEME.textLow }}>
          <Icon name="folder" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
          Documents arrive in HR Phase 2.
        </Card>
      )}

      {tab === 'Leave' && (
        <Card style={{ textAlign: 'center', padding: '48px', color: THEME.textLow }}>
          <Icon name="flight_takeoff" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
          Leave management arrives in HR Phase 2.
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
    </div>
  )
}
