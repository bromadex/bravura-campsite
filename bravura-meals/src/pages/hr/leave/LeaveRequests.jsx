import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { useAuth } from '../../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { useSite } from '../../../contexts/SiteContext'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast, fmtDate } from '../../../components/ui'

const ACCENT = MODULE_COLORS.workforce

const STATUS_META = {
  pending:   { label: 'Pending',   bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  approved:  { label: 'Approved',  bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  rejected:  { label: 'Rejected',  bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
  cancelled: { label: 'Cancelled', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}
const selStyle = { ...inputStyle, width: 'auto', padding: '9px 12px', fontSize: '13px' }

// Working days between two dates inclusive (weekends excluded)
function workingDays(start, end) {
  const s = new Date(start + 'T00:00:00'), e = new Date(end + 'T00:00:00')
  if (isNaN(s) || isNaN(e) || e < s) return 0
  let n = 0
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) n++
  }
  return n
}

export default function LeaveRequests() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [rows, setRows] = useState([])
  const [allocations, setAllocations] = useState([])
  const [employees, setEmployees] = useState([])
  const [types, setTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [empSearch, setEmpSearch] = useState('')

  const [reqOpen, setReqOpen] = useState(false)
  const [req, setReq] = useState({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' })
  const [rejOpen, setRejOpen] = useState(false)
  const [rejTarget, setRejTarget] = useState(null)
  const [rejReason, setRejReason] = useState('')
  const [saving, setSaving] = useState(false)

  const year = new Date().getFullYear()

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [reqRes, alRes, empRes, ltRes] = await Promise.all([
      supabase.from('leave_requests')
        .select('*, employee:employees(id, name), leave_type:leave_types(id, name)')
        .eq('site_id', currentSiteId).order('created_at', { ascending: false }),
      supabase.from('leave_allocations').select('employee_id, leave_type_id, allocated_days, used_days, carried_over_days')
        .eq('site_id', currentSiteId).eq('year', year),
      supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('leave_types').select('id, name, requires_approval').eq('is_active', true).order('name'),
    ])
    if (reqRes.error) { console.error(reqRes.error); showToast('Failed to load leave requests', 'red') }
    setRows(reqRes.data || [])
    setAllocations(alRes.data || [])
    setEmployees(empRes.data || [])
    setTypes(ltRes.data || [])
    setLoading(false)
  }, [currentSiteId, year])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const q = empSearch.trim().toLowerCase()
    return rows.filter(r =>
      (statusFilter === 'all' || r.status === statusFilter) &&
      (typeFilter === 'all' || r.leave_type_id === typeFilter) &&
      (!q || (r.employee?.name || '').toLowerCase().includes(q))
    )
  }, [rows, statusFilter, typeFilter, empSearch])

  const reqDays = workingDays(req.start_date, req.end_date)
  const reqBalance = useMemo(() => {
    if (!req.employee_id || !req.leave_type_id) return null
    const a = allocations.find(x => x.employee_id === req.employee_id && x.leave_type_id === req.leave_type_id)
    if (!a) return null
    return Number(a.allocated_days) + Number(a.carried_over_days) - Number(a.used_days)
  }, [req.employee_id, req.leave_type_id, allocations])

  const clash = useMemo(() => {
    if (!req.employee_id || !req.start_date || !req.end_date) return false
    return rows.some(r =>
      r.employee_id === req.employee_id && r.status === 'approved' &&
      r.start_date <= req.end_date && r.end_date >= req.start_date
    )
  }, [rows, req])

  async function submitRequest() {
    if (!req.employee_id || !req.leave_type_id || !req.start_date || !req.end_date) {
      showToast('Employee, type and dates are required', 'red'); return
    }
    if (reqDays <= 0) { showToast('End date must be on or after the start date', 'red'); return }
    setSaving(true)
    const { error } = await supabase.from('leave_requests').insert({
      site_id: currentSiteId,
      employee_id: req.employee_id,
      leave_type_id: req.leave_type_id,
      start_date: req.start_date,
      end_date: req.end_date,
      days_requested: reqDays,
      reason: req.reason.trim() || null,
      status: 'pending',
      created_by: profile?.id || null,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Leave request submitted', 'green')
    setReqOpen(false)
    setReq({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' })
    load()
  }

  async function approve(r) {
    if (!window.confirm(`Approve ${r.days_requested} day(s) of ${r.leave_type?.name} for ${r.employee?.name}?`)) return
    const { error } = await supabase.rpc('approve_leave_request', { p_request_id: r.id })
    if (error) { showToast(error.message, 'red'); return }
    showToast('Leave approved', 'green'); load()
  }

  async function reject() {
    if (!rejReason.trim()) { showToast('A reason is required', 'red'); return }
    setSaving(true)
    const { error } = await supabase.rpc('reject_leave_request', { p_request_id: rejTarget.id, p_reason: rejReason.trim() })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Leave rejected', 'green')
    setRejOpen(false); setRejReason(''); load()
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  return (
    <div>
      <PageHeader title="Leave Requests" site={currentSite}
        actions={can('hr.edit') && <Button icon="add" onClick={() => setReqOpen(true)}>New Request</Button>} />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select style={selStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select style={selStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Types</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input style={{ ...selStyle, minWidth: '200px' }} value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Search employee…" />
      </div>

      {loading ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div> : (
        <TableWrap>
          <THead color={ACCENT}>
            <Th>Employee</Th><Th>Type</Th><Th>From</Th><Th>To</Th>
            <Th align="center">Days</Th><Th align="center">Status</Th><Th>Submitted</Th><Th></Th>
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: THEME.textLow }}>No leave requests.</td></tr>
            ) : visible.map(r => {
              const m = STATUS_META[r.status] || STATUS_META.pending
              return (
                <TRow key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{r.employee?.name || '—'}</Td>
                  <Td>{r.leave_type?.name || '—'}</Td>
                  <Td>{fmtDate(r.start_date)}</Td>
                  <Td>{fmtDate(r.end_date)}</Td>
                  <Td align="center" style={{ fontWeight: 700 }}>{Number(r.days_requested).toFixed(1)}</Td>
                  <Td align="center">
                    <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: m.bg, color: m.text }}>{m.label}</span>
                    {r.status === 'rejected' && r.rejected_reason && (
                      <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px' }}>{r.rejected_reason}</div>
                    )}
                  </Td>
                  <Td style={{ color: THEME.textLow, fontSize: '12px' }}>{fmtDate((r.created_at || '').slice(0, 10))}</Td>
                  <Td align="right">
                    {r.status === 'pending' && can('hr.approve') && (
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <Button icon="check" onClick={() => approve(r)}>Approve</Button>
                        <Button variant="danger" icon="close" onClick={() => { setRejTarget(r); setRejOpen(true) }}>Reject</Button>
                      </div>
                    )}
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {/* New request */}
      <Modal open={reqOpen} onClose={() => setReqOpen(false)} title="New Leave Request"
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setReqOpen(false)}>Cancel</Button>
            <Button icon="send" onClick={submitRequest} disabled={saving}>{saving ? 'Submitting…' : 'Submit'}</Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <SectionLabel>Employee *</SectionLabel>
            <select style={inputStyle} value={req.employee_id} onChange={e => setReq(f => ({ ...f, employee_id: e.target.value }))}>
              <option value="">— Select —</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Leave Type *</SectionLabel>
            <select style={inputStyle} value={req.leave_type_id} onChange={e => setReq(f => ({ ...f, leave_type_id: e.target.value }))}>
              <option value="">— Select —</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div><SectionLabel>Start Date *</SectionLabel><input style={inputStyle} type="date" value={req.start_date} onChange={e => setReq(f => ({ ...f, start_date: e.target.value }))} /></div>
            <div><SectionLabel>End Date *</SectionLabel><input style={inputStyle} type="date" value={req.end_date} onChange={e => setReq(f => ({ ...f, end_date: e.target.value }))} /></div>
          </div>
          {reqDays > 0 && (
            <div style={{ fontSize: '13px', color: THEME.textMed }}>
              <b>{reqDays}</b> working day{reqDays === 1 ? '' : 's'} (weekends excluded)
              {reqBalance != null && (
                <span style={{ marginLeft: '10px', color: reqDays > reqBalance ? THEME.error : THEME.success }}>
                  · balance {reqBalance.toFixed(1)}d{reqDays > reqBalance && ' — exceeds balance (HR may still submit)'}
                </span>
              )}
              {reqBalance == null && req.leave_type_id && (
                <span style={{ marginLeft: '10px', color: THEME.warning }}>· no allocation for this type this year</span>
              )}
            </div>
          )}
          {clash && (
            <div style={{ padding: '10px 12px', borderRadius: '10px', background: THEME.statusWarningBg, color: THEME.statusWarningText, fontSize: '12px' }}>
              ⚠ This employee already has approved leave overlapping those dates.
            </div>
          )}
          <div>
            <SectionLabel>Reason</SectionLabel>
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={req.reason} onChange={e => setReq(f => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>
      </Modal>

      {/* Reject */}
      <Modal open={rejOpen} onClose={() => setRejOpen(false)} title={`Reject — ${rejTarget?.employee?.name || ''}`}
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setRejOpen(false)}>Cancel</Button>
            <Button variant="danger" icon="close" onClick={reject} disabled={saving}>{saving ? 'Rejecting…' : 'Reject request'}</Button>
          </div>
        }>
        <SectionLabel>Rejection Reason *</SectionLabel>
        <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} value={rejReason} onChange={e => setRejReason(e.target.value)}
          placeholder="Sent to the requester as a notification" />
      </Modal>
    </div>
  )
}
