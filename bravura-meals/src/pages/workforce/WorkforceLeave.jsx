import { useState, useEffect, useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, Icon, SectionLabel, StatusBadge, showToast, fmtDate } from '../../components/ui'

const LEAVE_LABELS = { active: 'Active', short_leave: 'Short Leave', long_leave: 'Long Leave' }
const LEAVE_COLORS = {
  active:      { bg: '#E8F5E9', c: '#1B5E20' },
  short_leave: { bg: '#FFF8E1', c: '#7D5700' },
  long_leave:  { bg: '#EDE7F6', c: '#4A3C8C' },
}

export default function WorkforceLeave() {
  const { employees, setLeaveStatus, returnFromLeave, loading } = useCampsite()
  const [search,      setSearch]      = useState('')
  const [statusFilter,setStatusFilter]= useState('all')
  const [leaveModal,  setLeaveModal]  = useState(false)
  const [leaveTarget, setLeaveTarget] = useState(null)
  const [leaveForm,   setLeaveForm]   = useState({ type: 'short_leave', start: '', end: '', notes: '' })
  const [saving,      setSaving]      = useState(false)

  // All employees including on-leave
  const [allEmployees, setAllEmployees] = useState([])
  useEffect(() => {
    import('../../supabaseClient').then(({ supabase }) => {
      supabase.from('employees')
        .select('*, contractor:contractors(id,name,short_code)')
        .order('name')
        .then(({ data }) => setAllEmployees(data || []))
    })
  }, [employees]) // refresh when campsite context updates

  const filtered = useMemo(() => allEmployees.filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
                        e.contractor?.name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || e.leave_status === statusFilter
    return matchSearch && matchStatus
  }), [allEmployees, search, statusFilter])

  // Summary counts
  const counts = {
    active:      allEmployees.filter(e => e.leave_status === 'active').length,
    short_leave: allEmployees.filter(e => e.leave_status === 'short_leave').length,
    long_leave:  allEmployees.filter(e => e.leave_status === 'long_leave').length,
  }

  async function doSetLeave() {
    if (!leaveForm.start) { showToast('Start date required', 'red'); return }
    setSaving(true)
    try {
      await setLeaveStatus({ employeeId: leaveTarget.id, leaveStatus: leaveForm.type, startDate: leaveForm.start, endDate: leaveForm.end, notes: leaveForm.notes })
      showToast(`${leaveTarget.name} → ${LEAVE_LABELS[leaveForm.type]}`, 'green')
      setLeaveModal(false)
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  async function doReturn(emp) {
    try {
      await returnFromLeave(emp.id)
      showToast(`${emp.name} returned from leave`, 'green')
    } catch (err) { showToast(err.message, 'red') }
  }

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: '0 0 20px' }}>Leave Management</h2>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '12px', marginBottom: '20px' }}>
        {Object.entries(counts).map(([status, count]) => {
          const lc = LEAVE_COLORS[status]
          return (
            <div key={status} style={{ background: '#fff', border: `1px solid ${THEME.outlineVar}`, borderRadius: '16px', padding: '16px', textAlign: 'center', borderTop: `4px solid ${lc.c}` }}>
              <div style={{ fontSize: '32px', fontWeight: 300, color: lc.c }}>{count}</div>
              <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '4px' }}>{LEAVE_LABELS[status]}</div>
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
          {['all','active','short_leave','long_leave'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${statusFilter === s ? THEME.primary : THEME.outline}`,
              background: statusFilter === s ? THEME.surfaceVar : 'transparent',
              color: statusFilter === s ? THEME.primary : THEME.textMed,
            }}>
              {s === 'all' ? 'All' : LEAVE_LABELS[s]}
            </button>
          ))}
        </div>
      </Card>

      {/* Table */}
      <div style={{ overflowX: 'auto', borderRadius: '16px', border: `1px solid ${THEME.outlineVar}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: '#fff' }}>
          <thead>
            <tr style={{ background: THEME.primary, color: '#fff' }}>
              {['Employee','Contractor','Status','Start','Expected Return','Notes','Actions'].map(h => (
                <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No employees found</td></tr>
            ) : filtered.map(emp => {
              const lc = LEAVE_COLORS[emp.leave_status] || LEAVE_COLORS.active
              return (
                <tr key={emp.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                  onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                  <td style={{ padding: '11px 14px', fontWeight: 500 }}>{emp.name}</td>
                  <td style={{ padding: '11px 14px', color: THEME.textMed }}>{emp.contractor?.name || '—'}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: lc.bg, color: lc.c }}>
                      {LEAVE_LABELS[emp.leave_status]}
                    </span>
                  </td>
                  <td style={{ padding: '11px 14px', color: THEME.textMed }}>{emp.leave_start ? fmtDate(emp.leave_start) : '—'}</td>
                  <td style={{ padding: '11px 14px', color: THEME.textMed }}>{emp.leave_end ? fmtDate(emp.leave_end) : '—'}</td>
                  <td style={{ padding: '11px 14px', color: THEME.textLow, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{emp.leave_notes || '—'}</td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {emp.leave_status !== 'active' ? (
                        <button onClick={() => doReturn(emp)} style={{ padding: '4px 10px', border: `1px solid ${THEME.success}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.success, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Icon name="login" size={13} style={{ color: THEME.success }} /> Return
                        </button>
                      ) : (
                        <button onClick={() => { setLeaveTarget(emp); setLeaveForm({ type: 'short_leave', start: '', end: '', notes: '' }); setLeaveModal(true) }}
                          style={{ padding: '4px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.textMed, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
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

      {/* Leave Modal */}
      <Modal open={leaveModal} onClose={() => setLeaveModal(false)} title={`Set Leave — ${leaveTarget?.name}`}
        footer={<>
          <Button onClick={() => setLeaveModal(false)} variant="text">Cancel</Button>
          <Button onClick={doSetLeave} variant="filled" disabled={saving}>{saving ? 'Saving…' : 'Confirm'}</Button>
        </>}>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Leave Type *</SectionLabel>
          <div style={{ display: 'flex', gap: '10px' }}>
            {[
              { v: 'short_leave', l: 'Short Leave', note: 'Room kept assigned' },
              { v: 'long_leave',  l: 'Long Leave',  note: 'Room auto-released' },
            ].map(opt => (
              <label key={opt.v} style={{ flex: 1, padding: '12px', border: `2px solid ${leaveForm.type === opt.v ? THEME.primary : THEME.outline}`, borderRadius: '12px', cursor: 'pointer', background: leaveForm.type === opt.v ? THEME.surfaceVar : '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <input type="radio" name="leaveType" value={opt.v} checked={leaveForm.type === opt.v} onChange={e => setLeaveForm(f => ({ ...f, type: e.target.value }))} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{opt.l}</span>
                </div>
                <div style={{ fontSize: '11px', color: THEME.textLow }}>{opt.note}</div>
              </label>
            ))}
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
          <SectionLabel>Notes</SectionLabel>
          <textarea value={leaveForm.notes} onChange={e => setLeaveForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
      </Modal>
    </div>
  )
}
