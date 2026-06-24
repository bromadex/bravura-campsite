import { useState } from 'react'
import { THEME } from '../../../utils/permissions'
import { Button, Modal, ConfirmModal, SectionLabel, Icon, showToast, fmtDate } from '../../../components/ui'
import { ROOM_STATUS_COLORS, getRoomOccupancyStatus, roomOccupancy } from './geometry'
import { useCampsite } from '../../../contexts/CampsiteContext'

// ── Side panel for a selected room ────────────────────────────────────────────
// Two tabs: Quick View (read-only info) and Occupants (assign/move/remove)
export default function RoomDetailPanel({ room, onClose, profile }) {
  const {
    rooms, assignments, employees, contractors, visitors,
    assignRoom, transferRoom, releaseRoom, setMaintenance, addVisitor,
  } = useCampsite()

  const [tab, setTab] = useState('quick') // quick | occupants
  const [assignModal, setAssignModal] = useState(false)
  const [occupantType, setOccupantType] = useState('employee')
  const [pickedId, setPickedId] = useState('')
  const [expectedCheckout, setExpectedCheckout] = useState('')
  const [saving, setSaving] = useState(false)

  // Inline "new visitor" sub-form
  const [showNewVisitor, setShowNewVisitor] = useState(false)
  const [newVisitor, setNewVisitor] = useState({ name: '', phone: '', purpose: '', gender: '' })
  const [creatingVisitor, setCreatingVisitor] = useState(false)

  const [transferTarget, setTransferTarget] = useState(null) // assignment being moved
  const [transferRoomId, setTransferRoomId] = useState('')
  const [removeTarget, setRemoveTarget] = useState(null)

  if (!room) return null

  const status = getRoomOccupancyStatus(room, assignments.filter(a => a.status === 'active'))
  const colors = ROOM_STATUS_COLORS[status]
  const activeOccupants = assignments.filter(a => a.room_id === room.id && a.status === 'active')
  const occ = activeOccupants.length
  const pct = room.capacity > 0 ? Math.round((occ / room.capacity) * 100) : 0

  // People not currently assigned anywhere (eligible for this room)
  const assignedEmpIds = new Set(assignments.filter(a => a.status === 'active' && a.employee_id).map(a => a.employee_id))
  const assignedVisIds = new Set(assignments.filter(a => a.status === 'active' && a.visitor_id).map(a => a.visitor_id))
  const eligibleEmployees = employees.filter(e => !assignedEmpIds.has(e.id))
  const eligibleVisitors  = (visitors || []).filter(v => !assignedVisIds.has(v.id))

  // Gender restriction check for the picker UI (informational)
  const roomGender = room.gender && room.gender !== 'unassigned' ? room.gender : null

  async function doAssign() {
    if (!pickedId) { showToast('Please select someone to assign', 'red'); return }
    setSaving(true)
    try {
      await assignRoom({
        roomId: room.id,
        employeeId: occupantType === 'employee' ? pickedId : null,
        visitorId:  occupantType === 'visitor'  ? pickedId : null,
        occupantType,
        expectedCheckout: expectedCheckout || null,
        assignedBy: profile?.id,
      })
      showToast('Assigned successfully', 'green')
      setAssignModal(false); setPickedId(''); setExpectedCheckout('')
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function doCreateVisitorAndAssign() {
    if (!newVisitor.name.trim()) { showToast('Visitor name is required', 'red'); return }
    setCreatingVisitor(true)
    try {
      const created = await addVisitor({
        name:    newVisitor.name.trim(),
        phone:   newVisitor.phone || null,
        purpose: newVisitor.purpose || null,
        gender:  newVisitor.gender || null,
      })
      await assignRoom({
        roomId: room.id,
        visitorId: created.id,
        occupantType: 'visitor',
        expectedCheckout: expectedCheckout || null,
        assignedBy: profile?.id,
      })
      showToast(`${created.name} added and assigned`, 'green')
      setAssignModal(false); setShowNewVisitor(false)
      setNewVisitor({ name: '', phone: '', purpose: '', gender: '' })
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setCreatingVisitor(false)
    }
  }

  async function doTransfer() {
    if (!transferRoomId) { showToast('Select target room', 'red'); return }
    setSaving(true)
    try {
      await transferRoom({ assignmentId: transferTarget.id, newRoomId: transferRoomId, assignedBy: profile?.id })
      showToast('Occupant moved', 'green')
      setTransferTarget(null); setTransferRoomId('')
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function doRemove() {
    setSaving(true)
    try {
      await releaseRoom({ assignmentId: removeTarget.id, releasedBy: profile?.id })
      showToast('Occupant removed', 'green')
      setRemoveTarget(null)
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  // Rooms with free space, excluding this one — for transfer target picker
  function availableTargetRooms(excludeRoomId) {
    return rooms.filter(r => {
      if (r.id === excludeRoomId || r.is_maintenance) return false
      const o = assignments.filter(a => a.room_id === r.id && a.status === 'active').length
      return o < r.capacity
    })
  }

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh', width: '380px',
      background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,.12)',
      zIndex: 1500, display: 'flex', flexDirection: 'column',
      animation: 'slideIn .2s ease-out',
    }}>
      <style>{`@keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }`}</style>

      {/* Header */}
      <div style={{ padding: '20px', borderBottom: `1px solid ${THEME.outlineVar}`, background: colors.fill }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: colors.label }}>Room {room.room_number}</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '5px', marginTop: '4px',
              padding: '3px 10px', borderRadius: '20px', background: '#fff',
              fontSize: '11px', fontWeight: 600, color: colors.label,
            }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: colors.dot }} />
              {{ available: 'Available', partial: 'Partially Occupied', full: 'Full', maintenance: 'Maintenance' }[status]}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,.6)', border: 'none', borderRadius: '50%', width: '32px', height: '32px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={18} style={{ color: colors.label }} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${THEME.outlineVar}` }}>
        {[{ id: 'quick', label: 'Quick View' }, { id: 'occupants', label: `Occupants (${occ})` }].map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, textAlign: 'center', padding: '12px', cursor: 'pointer',
            fontSize: '13px', fontWeight: 600,
            color: tab === t.id ? THEME.primary : THEME.textMed,
            borderBottom: `2px solid ${tab === t.id ? THEME.primary : 'transparent'}`,
          }}>
            {t.label}
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {tab === 'quick' ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
              <StatBox label="Capacity"   value={room.capacity} icon="bed" />
              <StatBox label="Occupied"   value={occ} icon="groups" />
              <StatBox label="Occupancy"  value={`${pct}%`} icon="percent" />
              <StatBox label="Gender"     value={roomGender ? (roomGender === 'male' ? 'Male' : 'Female') : 'Unset'} icon={roomGender === 'female' ? 'woman' : 'man'} />
            </div>

            <SectionLabel>Block</SectionLabel>
            <div style={{ fontSize: '14px', color: THEME.text, marginBottom: '14px' }}>{room.block?.name || '—'}</div>

            <SectionLabel>Contractor(s) in Room</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
              {activeOccupants.length === 0 ? (
                <span style={{ fontSize: '13px', color: THEME.textLow }}>No occupants</span>
              ) : [...new Set(activeOccupants.map(a => a.employee?.contractor?.name).filter(Boolean))].map(name => (
                <span key={name} style={{ padding: '3px 10px', borderRadius: '20px', background: THEME.surfaceVar, color: THEME.primary, fontSize: '12px', fontWeight: 500 }}>
                  {name}
                </span>
              ))}
            </div>

            <SectionLabel>Check-in Dates</SectionLabel>
            {activeOccupants.length === 0 ? (
              <div style={{ fontSize: '13px', color: THEME.textLow }}>—</div>
            ) : activeOccupants.map(a => (
              <div key={a.id} style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '3px' }}>
                {a.employee?.name || a.visitor?.name}: {fmtDate(a.assigned_date)}
              </div>
            ))}

            {room.is_maintenance && (
              <div style={{ marginTop: '16px', padding: '12px', background: '#FFF8E1', borderRadius: '10px', fontSize: '13px', color: '#7D5700' }}>
                <strong>Maintenance:</strong> {room.maintenance_reason || 'No reason given'}
              </div>
            )}

            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {occ < room.capacity && !room.is_maintenance && (
                <Button onClick={() => setAssignModal(true)} variant="filled" icon="person_add">Assign Occupant</Button>
              )}
              <Button
                onClick={async () => {
                  try { await setMaintenance(room.id, !room.is_maintenance); showToast('Updated', 'green') }
                  catch (err) { showToast(err.message, 'red') }
                }}
                variant="outlined" icon={room.is_maintenance ? 'check_circle' : 'construction'}
                disabled={occ > 0}
              >
                {room.is_maintenance ? 'Return to Service' : 'Set Maintenance'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {activeOccupants.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: THEME.textLow }}>
                <Icon name="bed" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                No occupants yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {activeOccupants.map(a => {
                  const person = a.employee || a.visitor
                  return (
                    <div key={a.id} style={{ border: `1px solid ${THEME.outlineVar}`, borderRadius: '12px', padding: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px', color: THEME.text }}>{person?.name || 'Unknown'}</div>
                          <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '1px' }}>
                            {a.occupant_type === 'visitor' ? 'Visitor' : (a.employee?.contractor?.name || 'Employee')}
                          </div>
                        </div>
                        <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.primary }}>
                          {a.occupant_type === 'visitor' ? 'VISITOR' : 'STAFF'}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>
                        Check-in: {fmtDate(a.assigned_date)}
                        {a.expected_checkout && <> · Expected out: {fmtDate(a.expected_checkout)}</>}
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => setTransferTarget(a)} style={{ flex: 1, padding: '6px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.textMed, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                          <Icon name="swap_horiz" size={13} style={{ color: THEME.info }} /> Move
                        </button>
                        <button onClick={() => setRemoveTarget(a)} style={{ flex: 1, padding: '6px', border: '1px solid #f5b8b8', borderRadius: '8px', background: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 500, color: THEME.error, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                          <Icon name="person_remove" size={13} style={{ color: THEME.error }} /> Remove
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {occ < room.capacity && !room.is_maintenance && (
              <Button onClick={() => setAssignModal(true)} variant="filled" icon="person_add" style={{ width: '100%', marginTop: '14px', justifyContent: 'center' }}>
                Add Occupant
              </Button>
            )}
          </>
        )}
      </div>

      {/* ── Assign Modal ── */}
      <Modal open={assignModal} onClose={() => setAssignModal(false)} title={`Assign to Room ${room.room_number}`}
        footer={<>
          <Button onClick={() => setAssignModal(false)} variant="text">Cancel</Button>
          <Button
            onClick={occupantType === 'visitor' && showNewVisitor ? doCreateVisitorAndAssign : doAssign}
            variant="filled"
            disabled={saving || creatingVisitor}
          >
            {saving || creatingVisitor ? 'Assigning…' : 'Assign'}
          </Button>
        </>}>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Occupant Type</SectionLabel>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[{ v: 'employee', l: 'Employee / Contractor' }, { v: 'visitor', l: 'Visitor' }].map(opt => (
              <button key={opt.v} onClick={() => { setOccupantType(opt.v); setPickedId('') }} style={{
                flex: 1, padding: '10px', borderRadius: '10px', cursor: 'pointer',
                border: `2px solid ${occupantType === opt.v ? THEME.primary : THEME.outline}`,
                background: occupantType === opt.v ? THEME.surfaceVar : '#fff',
                fontSize: '12px', fontWeight: 600, color: occupantType === opt.v ? THEME.primary : THEME.textMed,
              }}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        {roomGender && (
          <div style={{ marginBottom: '14px', padding: '8px 12px', background: '#FFF8E1', borderRadius: '8px', fontSize: '12px', color: '#7D5700' }}>
            This room is currently allocated to {roomGender === 'male' ? 'males' : 'females'} only.
          </div>
        )}

        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>{occupantType === 'employee' ? 'Select Employee' : 'Select Visitor'}</SectionLabel>
          {occupantType === 'visitor' && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                onClick={() => setShowNewVisitor(false)}
                style={{ flex: 1, padding: '6px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: `1px solid ${!showNewVisitor ? THEME.primary : THEME.outline}`, background: !showNewVisitor ? THEME.surfaceVar : '#fff', color: !showNewVisitor ? THEME.primary : THEME.textMed }}
              >
                Existing Visitor
              </button>
              <button
                onClick={() => setShowNewVisitor(true)}
                style={{ flex: 1, padding: '6px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: `1px solid ${showNewVisitor ? THEME.primary : THEME.outline}`, background: showNewVisitor ? THEME.surfaceVar : '#fff', color: showNewVisitor ? THEME.primary : THEME.textMed }}
              >
                + New Visitor
              </button>
            </div>
          )}

          {occupantType === 'visitor' && showNewVisitor ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <input type="text" placeholder="Full name *" value={newVisitor.name} onChange={e => setNewVisitor(v => ({ ...v, name: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <input type="text" placeholder="Phone" value={newVisitor.phone} onChange={e => setNewVisitor(v => ({ ...v, phone: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
                <select value={newVisitor.gender} onChange={e => setNewVisitor(v => ({ ...v, gender: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
                  <option value="">Gender</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <input type="text" placeholder="Purpose of visit" value={newVisitor.purpose} onChange={e => setNewVisitor(v => ({ ...v, purpose: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
            </div>
          ) : (
            <select value={pickedId} onChange={e => setPickedId(e.target.value)}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
              <option value="">— Select —</option>
              {occupantType === 'employee'
                ? eligibleEmployees.map(e => (
                    <option key={e.id} value={e.id}>{e.name}{e.contractor ? ` (${e.contractor.short_code || e.contractor.name})` : ''}{e.gender ? ` — ${e.gender}` : ''}</option>
                  ))
                : eligibleVisitors.map(v => (
                    <option key={v.id} value={v.id}>{v.name}{v.gender ? ` — ${v.gender}` : ''}</option>
                  ))
              }
            </select>
          )}
          {occupantType === 'employee' && eligibleEmployees.length === 0 && (
            <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '4px' }}>All employees already have rooms assigned.</div>
          )}
        </div>

        <div>
          <SectionLabel>Expected Check-out (optional)</SectionLabel>
          <input type="date" value={expectedCheckout} onChange={e => setExpectedCheckout(e.target.value)}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
        </div>
      </Modal>

      {/* ── Transfer Modal ── */}
      <Modal open={!!transferTarget} onClose={() => setTransferTarget(null)} title={`Move ${transferTarget?.employee?.name || transferTarget?.visitor?.name}`}
        footer={<>
          <Button onClick={() => setTransferTarget(null)} variant="text">Cancel</Button>
          <Button onClick={doTransfer} variant="filled" disabled={saving}>{saving ? 'Moving…' : 'Move'}</Button>
        </>}>
        <SectionLabel>Target Room</SectionLabel>
        <select value={transferRoomId} onChange={e => setTransferRoomId(e.target.value)}
          style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
          <option value="">— Select room —</option>
          {availableTargetRooms(room.id).map(r => {
            const o = assignments.filter(a => a.room_id === r.id && a.status === 'active').length
            return <option key={r.id} value={r.id}>{r.block?.name} — Room {r.room_number} ({o}/{r.capacity})</option>
          })}
        </select>
      </Modal>

      {/* ── Remove Confirm ── */}
      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={doRemove}
        title="Remove Occupant?"
        message={`Remove ${removeTarget?.employee?.name || removeTarget?.visitor?.name} from Room ${room.room_number}? The room will become available.`}
        confirmLabel={saving ? 'Removing…' : 'Remove'}
        danger
      />
    </div>
  )
}

function StatBox({ label, value, icon }) {
  return (
    <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
      <Icon name={icon} size={16} style={{ color: THEME.primary }} />
      <div style={{ fontSize: '17px', fontWeight: 700, color: THEME.text, marginTop: '2px' }}>{value}</div>
      <div style={{ fontSize: '10px', color: THEME.textLow }}>{label}</div>
    </div>
  )
}
