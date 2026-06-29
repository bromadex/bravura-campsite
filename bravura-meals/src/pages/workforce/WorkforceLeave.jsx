import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, Icon, SectionLabel, StatusBadge, showToast, fmtDate, PageHeader } from '../../components/ui'

// Category -> bucket mapping, matching the original design exactly:
// short categories keep the room assigned, long categories release it
// automatically via the database trigger once employees.status flips.
const LEAVE_CATEGORIES = [
  { value: 'annual',          label: 'Annual Leave',         bucket: 'short' },
  { value: 'sick',            label: 'Sick Leave',           bucket: 'short' },
  { value: 'compassionate',   label: 'Compassionate Leave',  bucket: 'short' },
  { value: 'maternity',       label: 'Maternity Leave',      bucket: 'long' },
  { value: 'study',           label: 'Study Leave',          bucket: 'long' },
  { value: 'extended_medical',label: 'Extended Medical Leave', bucket: 'long' },
]
const CATEGORY_LABELS = Object.fromEntries(LEAVE_CATEGORIES.map(c => [c.value, c.label]))

const STATUS_LABELS = { active: 'Active', on_leave: 'On Leave', long_leave: 'Long Leave' }
const STATUS_COLORS = {
  active:     { bg: THEME.statusSuccessBg, c: THEME.statusSuccessText },
  on_leave:   { bg: THEME.statusWarningBg, c: THEME.statusWarningText },
  long_leave: { bg: THEME.statusTertiaryBg, c: THEME.statusTertiaryText },
}

export default function WorkforceLeave() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const { setLeaveStatus, returnFromLeave } = useCampsite()

  const [search,       setSearch]       = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [leaveModal,   setLeaveModal]   = useState(false)
  const [leaveTarget,  setLeaveTarget]  = useState(null)
  const [leaveForm,    setLeaveForm]    = useState({ category: 'annual', start: '', end: '', reason: '' })
  const [saving,       setSaving]       = useState(false)

  // This page needs active + on_leave + long_leave employees together —
  // CampsiteContext's own employee list is filtered to status='active'
  // only, which would exclude anyone currently on leave. A separate fetch
  // is genuinely necessary here, not a duplication to clean up.
  const [pageEmployees, setPageEmployees] = useState([])
  const [recentLeaves,  setRecentLeaves]  = useState({}) // employee_id -> most recent leave movement
  const [loading,       setLoading]       = useState(true)

  useEffect(() => { if (currentSiteId) fetchPageData() }, [currentSiteId])

  async function fetchPageData() {
    setLoading(true)
    const { data: emps } = await supabase
      .from('employees')
      .select('*, contractor:contractors(id,name,short_code)')
      .eq('site_id', currentSiteId)
      .in('status', ['active', 'on_leave', 'long_leave'])
      .order('name')
    setPageEmployees(emps || [])

    // Pull the most recent 'leave' movement for anyone currently on leave,
    // so the specific category (e.g. "Maternity Leave") can be shown
    // instead of just the broad status bucket.
    const onLeaveIds = (emps || []).filter(e => e.status !== 'active').map(e => e.id)
    if (onLeaveIds.length > 0) {
      const { data: moves } = await supabase
        .from('employee_movements')
        .select('*')
        .in('employee_id', onLeaveIds)
        .eq('movement_type', 'leave')
        .order('effective_date', { ascending: false })
      const latest = {}
      moves?.forEach(m => { if (!latest[m.employee_id]) latest[m.employee_id] = m })
      setRecentLeaves(latest)
    } else {
      setRecentLeaves({})
    }
    setLoading(false)
  }

  const filtered = useMemo(() => pageEmployees.filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
                        e.contractor?.name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || e.status === statusFilter
    return matchSearch && matchStatus
  }), [pageEmployees, search, statusFilter])

  const counts = {
    active:     pageEmployees.filter(e => e.status === 'active').length,
    on_leave:   pageEmployees.filter(e => e.status === 'on_leave').length,
    long_leave: pageEmployees.filter(e => e.status === 'long_leave').length,
  }

  async function doSetLeave() {
    if (!leaveForm.start) { showToast('Start date required', 'red'); return }
    setSaving(true)
    try {
      await setLeaveStatus({
        employeeId: leaveTarget.id,
        leaveCategory: leaveForm.category,
        startDate: leaveForm.start,
        endDate: leaveForm.end,
        reason: leaveForm.reason,
        createdBy: profile?.id,
        siteId: leaveTarget.site_id,
      })
      showToast(`${leaveTarget.name} → ${CATEGORY_LABELS[leaveForm.category]}`, 'green')
      setLeaveModal(false)
      fetchPageData()
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  async function doReturn(emp) {
    try {
      await returnFromLeave(emp.id, profile?.id, emp.site_id)
      showToast(`${emp.name} returned from leave`, 'green')
      fetchPageData()
    } catch (err) { showToast(err.message, 'red') }
  }

  return (
    <div>
      <PageHeader title="Leave Management" site={currentSite} />

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '12px', marginBottom: '20px' }}>
        {Object.entries(counts).map(([status, count]) => {
          const lc = STATUS_COLORS[status]
          return (
            <div key={status} style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '16px', padding: '16px', textAlign: 'center', borderTop: `4px solid ${lc.c}` }}>
              <div style={{ fontSize: '32px', fontWeight: 300, color: lc.c }}>{count}</div>
              <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '4px' }}>{STATUS_LABELS[status]}</div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '14px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '200px', maxWidth: '300px' }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input type="text" placeholder="Search employee or contractor…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 10px 7px 32px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          {['all','active','on_leave','long_leave'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${statusFilter === s ? THEME.primary : THEME.outline}`,
              background: statusFilter === s ? THEME.surfaceVar : 'transparent',
              color: statusFilter === s ? THEME.primary : THEME.textMed,
            }}>
              {s === 'all' ? 'All' : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '16px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: THEME.surface }}>
            <thead>
              <tr style={{ background: THEME.primary, color: '#fff' }}>
                {['Employee','Contractor','Status','Leave Type','Start','Expected Return','Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No employees found at {currentSite?.name || 'this site'}</td></tr>
              ) : filtered.map(emp => {
                const lc = STATUS_COLORS[emp.status] || STATUS_COLORS.active
                const recentLeave = recentLeaves[emp.id]
                return (
                  <tr key={emp.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = THEME.surface}>
                    <td style={{ padding: '11px 14px', fontWeight: 500 }}>{emp.name}</td>
                    <td style={{ padding: '11px 14px', color: THEME.textMed }}>{emp.contractor?.name || '—'}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: lc.bg, color: lc.c }}>
                        {STATUS_LABELS[emp.status]}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', color: THEME.textMed }}>
                      {emp.status !== 'active' && recentLeave ? CATEGORY_LABELS[recentLeave.leave_category] || '—' : '—'}
                    </td>
                    <td style={{ padding: '11px 14px', color: THEME.textMed }}>{recentLeave?.effective_date ? fmtDate(recentLeave.effective_date) : '—'}</td>
                    <td style={{ padding: '11px 14px', color: THEME.textMed }}>{recentLeave?.expected_return_date ? fmtDate(recentLeave.expected_return_date) : '—'}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {emp.status !== 'active' ? (
                          <button onClick={() => doReturn(emp)} style={{ padding: '4px 10px', border: `1px solid ${THEME.success}`, borderRadius: '8px', background: THEME.surface, cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.success, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Icon name="login" size={13} style={{ color: THEME.success }} /> Return
                          </button>
                        ) : (
                          <button onClick={() => { setLeaveTarget(emp); setLeaveForm({ category: 'annual', start: '', end: '', reason: '' }); setLeaveModal(true) }}
                            style={{ padding: '4px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: THEME.surface, cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.textMed, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Icon name="flight_takeoff" size={13} style={{ color: THEME.warning }} /> Set Leave
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Leave Modal */}
      <Modal open={leaveModal} onClose={() => setLeaveModal(false)} title={`Set Leave — ${leaveTarget?.name}`}
        footer={<>
          <Button onClick={() => setLeaveModal(false)} variant="text">Cancel</Button>
          <Button onClick={doSetLeave} variant="filled" disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</Button>
        </>}>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Leave Category *</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, marginBottom: '6px' }}>SHORT-TERM · room stays assigned</div>
              {LEAVE_CATEGORIES.filter(c => c.bucket === 'short').map(opt => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', border: `1px solid ${leaveForm.category === opt.value ? THEME.primary : THEME.outline}`, borderRadius: '10px', cursor: 'pointer', marginBottom: '6px', background: leaveForm.category === opt.value ? THEME.surfaceVar : '#fff' }}>
                  <input type="radio" name="leaveCategory" value={opt.value} checked={leaveForm.category === opt.value} onChange={e => setLeaveForm(f => ({ ...f, category: e.target.value }))} />
                  <span style={{ fontSize: '13px', color: THEME.text }}>{opt.label}</span>
                </label>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, marginBottom: '6px' }}>LONG-TERM · room auto-released</div>
              {LEAVE_CATEGORIES.filter(c => c.bucket === 'long').map(opt => (
                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', border: `1px solid ${leaveForm.category === opt.value ? THEME.primary : THEME.outline}`, borderRadius: '10px', cursor: 'pointer', marginBottom: '6px', background: leaveForm.category === opt.value ? THEME.surfaceVar : '#fff' }}>
                  <input type="radio" name="leaveCategory" value={opt.value} checked={leaveForm.category === opt.value} onChange={e => setLeaveForm(f => ({ ...f, category: e.target.value }))} />
                  <span style={{ fontSize: '13px', color: THEME.text }}>{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Start Date *</SectionLabel>
            <input type="date" value={leaveForm.start} onChange={e => setLeaveForm(f => ({ ...f, start: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div>
            <SectionLabel>Expected Return</SectionLabel>
            <input type="date" value={leaveForm.end} onChange={e => setLeaveForm(f => ({ ...f, end: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div>
          <SectionLabel>Reason / Notes</SectionLabel>
          <textarea value={leaveForm.reason} onChange={e => setLeaveForm(f => ({ ...f, reason: e.target.value }))} rows={2}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
        <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textLow }}>
          Returning from long leave does not auto-assign a room — that's done manually under Campsite → Room Assignments.
        </div>
      </Modal>
    </div>
  )
}
