import { useState, useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast, fmtDate, PageHeader, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
import QuickNav, { CAMPSITE_PILLS } from '../../components/QuickNav'

const tabs = ['Active', 'History', 'On Leave']

export default function CampAssignments({ setPage }) {
  const { profile } = useAuth()
  const { rooms, blocks, employees, assignments, returnFromLeave,
          assignRoom, transferRoom, releaseRoom, loading } = useCampsite()

  const [tab,        setTab]        = useState('Active')
  const [search,     setSearch]     = useState('')

  // Assign modal
  const [assignModal,  setAssignModal]  = useState(false)
  const [assignEmpId,  setAssignEmpId]  = useState('')
  const [assignRoomId, setAssignRoomId] = useState('')
  const [assignNotes,  setAssignNotes]  = useState('')
  const [saving,       setSaving]       = useState(false)

  // Transfer modal
  const [transferModal, setTransferModal] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null) // assignment
  const [transferRoomId, setTransferRoomId] = useState('')
  const [transferNotes,  setTransferNotes]  = useState('')

  // Release confirm
  const [releaseTarget, setReleaseTarget] = useState(null)
  const [releaseNotes,  setReleaseNotes]  = useState('')

  // --- Filtered data ---
  const activeAssignments = assignments.filter(a => a.status === 'active')
  const historyAssignments = assignments.filter(a => a.status !== 'active')
  const onLeaveEmployees   = employees.filter(e => e.status === 'on_leave' || e.status === 'long_leave')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (tab === 'Active') {
      return activeAssignments.filter(a =>
        !q ||
        a.employee?.name?.toLowerCase().includes(q) ||
        a.room?.room_number?.toLowerCase().includes(q) ||
        a.room?.block?.name?.toLowerCase().includes(q) ||
        a.employee?.contractor?.name?.toLowerCase().includes(q)
      )
    }
    if (tab === 'History') {
      return historyAssignments.filter(a =>
        !q ||
        a.employee?.name?.toLowerCase().includes(q) ||
        a.room?.room_number?.toLowerCase().includes(q)
      )
    }
    // On Leave
    return onLeaveEmployees.filter(e =>
      !q || e.name?.toLowerCase().includes(q) || e.contractor?.name?.toLowerCase().includes(q)
    )
  }, [tab, search, activeAssignments, historyAssignments, onLeaveEmployees])

  // --- Available rooms for assignment/transfer ---
  function availableRooms(excludeRoomId = null) {
    return rooms.filter(r => {
      if (r.is_maintenance) return false
      if (r.id === excludeRoomId) return false
      const occ = assignments.filter(a => a.room_id === r.id && a.status === 'active').length
      return occ < r.capacity
    })
  }

  // --- Unassigned employees ---
  const unassignedEmployees = useMemo(() => {
    const assignedIds = new Set(activeAssignments.map(a => a.employee_id))
    return employees.filter(e => !assignedIds.has(e.id))
  }, [employees, activeAssignments])

  // --- Actions ---
  async function doAssign() {
    if (!assignEmpId || !assignRoomId) { showToast('Select employee and room', 'red'); return }
    setSaving(true)
    try {
      await assignRoom({ employeeId: assignEmpId, roomId: assignRoomId, notes: assignNotes, assignedBy: profile?.id })
      showToast('Room assigned', 'green')
      setAssignModal(false); setAssignEmpId(''); setAssignRoomId(''); setAssignNotes('')
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  async function doTransfer() {
    if (!transferRoomId) { showToast('Select target room', 'red'); return }
    setSaving(true)
    try {
      await transferRoom({ assignmentId: transferTarget.id, newRoomId: transferRoomId, notes: transferNotes, assignedBy: profile?.id })
      showToast('Transfer complete', 'green')
      setTransferModal(false); setTransferTarget(null); setTransferRoomId(''); setTransferNotes('')
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  async function doRelease() {
    setSaving(true)
    try {
      await releaseRoom({ assignmentId: releaseTarget.id, notes: releaseNotes, releasedBy: profile?.id })
      showToast('Room released', 'green')
      setReleaseTarget(null); setReleaseNotes('')
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  // Setting leave is handled on the Workforce → Leave Management page now,
  // which has the full category picker (Annual/Sick/Compassionate vs
  // Maternity/Study/Extended Medical). Keeping a second, simpler copy of
  // that same form here would mean two places to maintain in lockstep —
  // this tab stays read-only plus a Return action, which is simple enough
  // not to need its own page.
  async function doReturnFromLeave(emp) {
    try {
      await returnFromLeave(emp.id, profile?.id, emp.site_id)
      showToast(`${emp.name} returned from leave`, 'green')
    } catch (err) { showToast(err.message, 'red') }
  }

  const leaveLabel = { on_leave: 'On Leave', long_leave: 'Long Leave' }

  return (
    <div>
      <PageHeader title="Assignments" actions={<Button onClick={() => setAssignModal(true)} variant="filled" icon="add_home">Assign Room</Button>} />

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: `2px solid ${THEME.outlineVar}` }}>
        {tabs.map(t => (
          <div key={t} onClick={() => setTab(t)} style={{
            padding: '8px 18px', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
            color: tab === t ? THEME.primary : THEME.textMed,
            borderBottom: `2px solid ${tab === t ? THEME.primary : 'transparent'}`,
            marginBottom: '-2px', borderRadius: '8px 8px 0 0',
          }}>
            {t}
            <span style={{ marginLeft: '6px', padding: '1px 7px', borderRadius: '10px', fontSize: '11px', background: tab === t ? THEME.surfaceVar : 'transparent', color: tab === t ? THEME.primary : THEME.textLow }}>
              {t === 'Active' ? activeAssignments.length : t === 'History' ? historyAssignments.length : onLeaveEmployees.length}
            </span>
          </div>
        ))}
      </div>

      {/* Search */}
      <Card style={{ marginBottom: '14px', padding: '10px 14px' }}>
        <div style={{ position: 'relative', maxWidth: '340px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input type="text" placeholder="Search employee, room, block, contractor…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '8px 10px 8px 32px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
        </div>
      </Card>

      {/* Content */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : (

        /* ── Active / History table ── */
        tab !== 'On Leave' ? (
          <TableWrap>
            <THead>
              {['Employee','Contractor','Room','Block','Assigned','Released','Status', tab === 'Active' ? 'Actions' : ''].filter(Boolean).map(h => (
                <Th key={h} style={{ whiteSpace: 'nowrap' }}>{h}</Th>
              ))}
            </THead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No records found</td></tr>
              ) : filtered.map(a => {
                const statusMap = { active: { bg: THEME.statusSuccessBg, c: THEME.statusSuccessText, l: 'Active' }, released: { bg: THEME.statusNeutralBg, c: THEME.statusNeutralText, l: 'Released' }, transferred: { bg: THEME.statusInfoBg, c: THEME.info, l: 'Transferred' } }
                const s = statusMap[a.status] || statusMap.released
                return (
                  <TRow key={a.id}>
                    <Td style={{ fontWeight: 500 }}>{a.employee?.name || '—'}</Td>
                    <Td style={{ color: THEME.textMed }}>{a.employee?.contractor?.name || '—'}</Td>
                    <Td style={{ fontWeight: 600 }}>{a.room?.room_number || '—'}</Td>
                    <Td style={{ color: THEME.textMed }}>{a.room?.block?.name || '—'}</Td>
                    <Td style={{ color: THEME.textMed }}>{fmtDate(a.assigned_date)}</Td>
                    <Td style={{ color: THEME.textMed }}>{a.released_date ? fmtDate(a.released_date) : '—'}</Td>
                    <Td>
                      <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: s.bg, color: s.c }}>{s.l}</span>
                    </Td>
                    {tab === 'Active' && (
                      <Td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => { setTransferTarget(a); setTransferModal(true) }} title="Transfer room"
                            style={{ padding: '4px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: THEME.surface, cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.textMed, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Icon name="swap_horiz" size={14} style={{ color: THEME.info }} /> Transfer
                          </button>
                          <button onClick={() => { setReleaseTarget(a); setReleaseNotes('') }} title="Release room"
                            style={{ padding: '4px 10px', border: `1px solid #f5b8b8`, borderRadius: '8px', background: THEME.surface, cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.error, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Icon name="logout" size={14} style={{ color: THEME.error }} /> Release
                          </button>
                        </div>
                      </Td>
                    )}
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        ) : (

          /* ── On Leave table ── */
          <TableWrap>
            <THead>
              {['Employee','Contractor','Status','Actions'].map(h => (
                <Th key={h}>{h}</Th>
              ))}
            </THead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No employees on leave</td></tr>
              ) : filtered.map(emp => {
                const typeColor = emp.status === 'on_leave' ? { bg: THEME.statusWarningBg, c: THEME.statusWarningText } : { bg: THEME.statusTertiaryBg, c: THEME.statusTertiaryText }
                return (
                  <TRow key={emp.id}>
                    <Td style={{ fontWeight: 500 }}>{emp.name}</Td>
                    <Td style={{ color: THEME.textMed }}>{emp.contractor?.name || '—'}</Td>
                    <Td>
                      <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: typeColor.bg, color: typeColor.c }}>
                        {leaveLabel[emp.status]}
                      </span>
                    </Td>
                    <Td>
                      <button onClick={() => doReturnFromLeave(emp)}
                        style={{ padding: '5px 12px', border: `1px solid ${THEME.success}`, borderRadius: '8px', background: THEME.surface, cursor: 'pointer', fontSize: '12px', fontWeight: 500, color: THEME.success, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Icon name="login" size={14} style={{ color: THEME.success }} /> Return
                      </button>
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )
      )}

      {/* ── Assign Modal ── */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title="Assign Room"
        footer={<>
          <Button onClick={() => setAssignModal(false)} variant="text">Cancel</Button>
          <Button onClick={doAssign} variant="filled" disabled={saving}>{saving ? 'Assigning…' : 'Assign'}</Button>
        </>}>
        <div style={{ marginBottom: '14px' }}>
      <QuickNav pills={CAMPSITE_PILLS} setPage={setPage} current="camp_assignments" />
          <SectionLabel>Employee *</SectionLabel>
          <select value={assignEmpId} onChange={e => setAssignEmpId(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="">— Select employee —</option>
            {unassignedEmployees.map(e => (
              <option key={e.id} value={e.id}>{e.name}{e.contractor ? ` (${e.contractor.name})` : ''}</option>
            ))}
          </select>
          {unassignedEmployees.length === 0 && <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '4px' }}>All active employees already have rooms assigned.</div>}
        </div>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Room *</SectionLabel>
          <select value={assignRoomId} onChange={e => setAssignRoomId(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="">— Select room —</option>
            {availableRooms().map(r => {
              const occ = assignments.filter(a => a.room_id === r.id && a.status === 'active').length
              const block = blocks.find(b => b.id === r.block_id)
              return <option key={r.id} value={r.id}>{block?.name} — {r.room_number} ({occ}/{r.capacity} occupied)</option>
            })}
          </select>
        </div>
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={assignNotes} onChange={e => setAssignNotes(e.target.value)} rows={2} placeholder="Optional…"
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
      </Modal>

      {/* ── Transfer Modal ── */}
      <Modal open={transferModal} onClose={() => setTransferModal(false)} title={`Transfer Room — ${transferTarget?.employee?.name}`}
        footer={<>
          <Button onClick={() => setTransferModal(false)} variant="text">Cancel</Button>
          <Button onClick={doTransfer} variant="filled" disabled={saving}>{saving ? 'Transferring…' : 'Transfer'}</Button>
        </>}>
        <div style={{ marginBottom: '12px', padding: '10px 14px', background: THEME.surfaceVar, borderRadius: '12px', fontSize: '13px', color: THEME.textMed }}>
          Current room: <strong style={{ color: THEME.text }}>{transferTarget?.room?.block?.name} — {transferTarget?.room?.room_number}</strong>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>New Room *</SectionLabel>
          <select value={transferRoomId} onChange={e => setTransferRoomId(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="">— Select new room —</option>
            {availableRooms(transferTarget?.room_id).map(r => {
              const occ = assignments.filter(a => a.room_id === r.id && a.status === 'active').length
              const block = blocks.find(b => b.id === r.block_id)
              return <option key={r.id} value={r.id}>{block?.name} — {r.room_number} ({occ}/{r.capacity} occupied)</option>
            })}
          </select>
        </div>
        <div>
          <SectionLabel>Reason / Notes</SectionLabel>
          <textarea value={transferNotes} onChange={e => setTransferNotes(e.target.value)} rows={2} placeholder="Reason for transfer…"
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
      </Modal>

      {/* ── Release Confirm ── */}
      <Modal open={!!releaseTarget} onClose={() => setReleaseTarget(null)} title={`Release Room — ${releaseTarget?.employee?.name}`}
        footer={<>
          <Button onClick={() => setReleaseTarget(null)} variant="text">Cancel</Button>
          <Button onClick={doRelease} variant="danger" disabled={saving}>{saving ? 'Releasing…' : 'Release Room'}</Button>
        </>}>
        <div style={{ marginBottom: '12px', padding: '10px 14px', background: THEME.statusErrorBg, borderRadius: '12px', fontSize: '13px', color: THEME.error }}>
          This will release <strong>{releaseTarget?.employee?.name}</strong> from <strong>{releaseTarget?.room?.block?.name} — {releaseTarget?.room?.room_number}</strong> and mark the room as available.
        </div>
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={releaseNotes} onChange={e => setReleaseNotes(e.target.value)} rows={2} placeholder="Reason for release…"
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
      </Modal>
    </div>
  )
}
