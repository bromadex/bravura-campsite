import { useState, useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast } from '../../components/ui'

const EMPTY = { room_number: '', block_id: '', capacity: 1, notes: '' }

function RoomStatusChip({ status }) {
  const map = {
    available:   { bg: '#E8F5E9', color: '#1B5E20', label: 'Available'   },
    occupied:    { bg: '#FDECEA', color: THEME.error, label: 'Occupied'  },
    maintenance: { bg: '#FFF8E1', color: '#7D5700',  label: 'Maintenance'},
  }
  const s = map[status] || map.available
  return (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

// Translate raw DB errors into plain English
function friendlyError(err) {
  const msg = err?.message || ''
  if (msg.includes('duplicate key') && msg.includes('room_number_block_id'))
    return 'A room with that number already exists in the selected block. Choose a different number or block.'
  if (msg.includes('foreign key') || msg.includes('violates'))
    return 'This room is referenced by existing data and cannot be deleted.'
  return msg
}

export default function CampRooms() {
  const { rooms, blocks, assignments, addRoom, updateRoom, deleteRoom, setMaintenance, loading } = useCampsite()

  const [modal,        setModal]        = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [form,         setForm]         = useState(EMPTY)
  const [saving,       setSaving]       = useState(false)

  const [maintTarget,  setMaintTarget]  = useState(null)
  const [maintReason,  setMaintReason]  = useState('')

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  const [blockFilter,  setBlockFilter]  = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search,       setSearch]       = useState('')

  function openAdd() { setEditing(null); setForm(EMPTY); setModal(true) }
  function openEdit(r) {
    setEditing(r)
    setForm({ room_number: r.room_number, block_id: r.block_id, capacity: r.capacity, notes: r.notes || '' })
    setModal(true)
  }

  async function save() {
    if (!form.room_number.trim()) { showToast('Room number is required', 'red'); return }
    if (!form.block_id)           { showToast('Please select a block', 'red'); return }

    // Client-side duplicate check before hitting DB
    const isDuplicate = rooms.some(r =>
      r.room_number.trim().toLowerCase() === form.room_number.trim().toLowerCase() &&
      r.block_id === form.block_id &&
      r.id !== editing?.id   // exclude self when editing
    )
    if (isDuplicate) {
      const blockName = blocks.find(b => b.id === form.block_id)?.name || 'this block'
      showToast(`Room "${form.room_number}" already exists in ${blockName}. Use a different number.`, 'red')
      return
    }

    setSaving(true)
    try {
      const payload = { ...form, capacity: Math.max(1, parseInt(form.capacity) || 1) }
      if (editing) {
        await updateRoom(editing.id, payload)
        showToast('Room updated', 'green')
      } else {
        await addRoom(payload)
        showToast('Room added', 'green')
      }
      setModal(false)
    } catch (err) {
      showToast(friendlyError(err), 'red')
    } finally {
      setSaving(false)
    }
  }

  async function doDelete() {
    setDeleting(true)
    try {
      await deleteRoom(deleteTarget.id)
      showToast(`Room ${deleteTarget.room_number} deleted`, 'red')
      setDeleteTarget(null)
    } catch (err) {
      showToast(friendlyError(err), 'red')
      setDeleteTarget(null)
    } finally {
      setDeleting(false)
    }
  }

  async function toggleMaintenance() {
    try {
      await setMaintenance(maintTarget.id, !maintTarget.is_maintenance, maintReason)
      showToast(maintTarget.is_maintenance ? 'Room returned to service' : 'Room set to maintenance', 'green')
      setMaintTarget(null); setMaintReason('')
    } catch (err) { showToast(friendlyError(err), 'red') }
  }

  const filtered = useMemo(() => rooms.filter(r => {
    const matchBlock  = blockFilter === 'all' || r.block_id === blockFilter
    const matchStatus = statusFilter === 'all' || r.status === statusFilter
    const matchSearch = !search ||
      r.room_number.toLowerCase().includes(search.toLowerCase()) ||
      r.block?.name?.toLowerCase().includes(search.toLowerCase())
    return matchBlock && matchStatus && matchSearch
  }), [rooms, blockFilter, statusFilter, search])

  function occupancy(roomId) {
    return assignments.filter(a => a.room_id === roomId && a.status === 'active').length
  }

  // Stats
  const totalRooms    = rooms.length
  const availableRooms = rooms.filter(r => r.status === 'available').length
  const occupiedRooms  = rooms.filter(r => r.status === 'occupied').length
  const maintRooms     = rooms.filter(r => r.status === 'maintenance').length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>
          Rooms
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '20px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed }}>
            {totalRooms}
          </span>
        </h2>
        <Button onClick={openAdd} variant="filled" icon="add">Add Room</Button>
      </div>

      {/* Summary chips */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {[
          { label: 'Available',   count: availableRooms, color: THEME.success },
          { label: 'Occupied',    count: occupiedRooms,  color: THEME.error   },
          { label: 'Maintenance', count: maintRooms,     color: THEME.warning },
        ].map(s => (
          <div key={s.label} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 16px', borderRadius: '12px', background: '#fff',
            border: `1px solid ${THEME.outlineVar}`,
            fontSize: '13px', fontWeight: 500,
          }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: s.color }} />
            <span style={{ color: THEME.textMed }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: s.color }}>{s.count}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '180px', maxWidth: '260px' }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input
              type="text" placeholder="Search room or block…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 10px 7px 32px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          <select value={blockFilter} onChange={e => setBlockFilter(e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="all">All Blocks</option>
            {blocks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>

          {['all','available','occupied','maintenance'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)} style={{
              padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${statusFilter === s ? THEME.primary : THEME.outline}`,
              background: statusFilter === s ? THEME.surfaceVar : 'transparent',
              color: statusFilter === s ? THEME.primary : THEME.textMed,
            }}>
              {s === 'all' ? 'All Status' : s.charAt(0).toUpperCase() + s.slice(1)}
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: '#fff' }}>
            <thead>
              <tr style={{ background: THEME.primary, color: '#fff' }}>
                {['Room Number','Block','Capacity','Occupancy','Status','Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
                    <Icon name="meeting_room" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                    No rooms found
                  </td>
                </tr>
              ) : filtered.map(room => {
                const occ = occupancy(room.id)
                const pct = room.capacity > 0 ? Math.round(occ / room.capacity * 100) : 0
                const hasHistory = assignments.some(a => a.room_id === room.id)
                return (
                  <tr
                    key={room.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <td style={{ padding: '12px 14px', fontWeight: 600, color: THEME.text }}>{room.room_number}</td>
                    <td style={{ padding: '12px 14px', color: THEME.textMed }}>{room.block?.name || '—'}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'center', color: THEME.text }}>{room.capacity}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: occ > 0 ? THEME.primary : THEME.textLow }}>
                          {occ}/{room.capacity}
                        </span>
                        <div style={{ flex: 1, maxWidth: '60px', height: '6px', background: THEME.outlineVar, borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? THEME.error : THEME.success, borderRadius: '3px' }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}><RoomStatusChip status={room.status} /></td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {/* Edit */}
                        <button
                          onClick={() => openEdit(room)} title="Edit room"
                          style={{ width: '30px', height: '30px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Icon name="edit" size={14} style={{ color: THEME.textMed }} />
                        </button>
                        {/* Maintenance toggle */}
                        <button
                          onClick={() => { setMaintTarget(room); setMaintReason(room.maintenance_reason || '') }}
                          title={room.is_maintenance ? 'Return to service' : 'Set maintenance'}
                          style={{ width: '30px', height: '30px', border: `1px solid ${room.is_maintenance ? THEME.success : THEME.warning}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Icon name={room.is_maintenance ? 'check_circle' : 'construction'} size={14} style={{ color: room.is_maintenance ? THEME.success : THEME.warning }} />
                        </button>
                        {/* Delete — only if no assignment history */}
                        <button
                          onClick={() => setDeleteTarget(room)}
                          title={hasHistory ? 'Cannot delete — has assignment history' : 'Delete room'}
                          disabled={hasHistory}
                          style={{
                            width: '30px', height: '30px',
                            border: `1px solid ${hasHistory ? THEME.outlineVar : '#f5b8b8'}`,
                            borderRadius: '8px', background: '#fff',
                            cursor: hasHistory ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            opacity: hasHistory ? 0.4 : 1,
                          }}
                        >
                          <Icon name="delete" size={14} style={{ color: hasHistory ? THEME.textLow : THEME.error }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add / Edit Modal ── */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit Room ${editing.room_number}` : 'Add New Room'}
        footer={<>
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          <Button onClick={save} variant="filled" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add room'}</Button>
        </>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Room Number *</SectionLabel>
            <input
              type="text" value={form.room_number}
              onChange={e => setForm(f => ({ ...f, room_number: e.target.value }))}
              placeholder="e.g. 101 or A-101" autoFocus
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
              onFocus={e => e.target.style.borderColor = THEME.primary}
              onBlur={e => e.target.style.borderColor = THEME.outline}
            />
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>
              Must be unique within the selected block.
            </div>
          </div>
          <div>
            <SectionLabel>Block *</SectionLabel>
            <select
              value={form.block_id} onChange={e => setForm(f => ({ ...f, block_id: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}
            >
              <option value="">— Select block —</option>
              {blocks.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Capacity (max occupants)</SectionLabel>
          <input
            type="number" min={1} max={20} value={form.capacity}
            onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
            style={{ width: '110px', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}
            onFocus={e => e.target.style.borderColor = THEME.primary}
            onBlur={e => e.target.style.borderColor = THEME.outline}
          />
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={2} placeholder="Optional…"
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }}
          />
        </div>
      </Modal>

      {/* ── Maintenance Modal ── */}
      <Modal
        open={!!maintTarget}
        onClose={() => setMaintTarget(null)}
        title={maintTarget?.is_maintenance
          ? `Return Room ${maintTarget?.room_number} to Service`
          : `Set Room ${maintTarget?.room_number} to Maintenance`}
        footer={<>
          <Button onClick={() => setMaintTarget(null)} variant="text">Cancel</Button>
          <Button
            onClick={toggleMaintenance}
            variant="filled"
            style={{ background: maintTarget?.is_maintenance ? THEME.success : THEME.warning }}
          >
            {maintTarget?.is_maintenance ? 'Return to Service' : 'Set Maintenance'}
          </Button>
        </>}
      >
        {!maintTarget?.is_maintenance ? (
          <div style={{ marginBottom: '12px' }}>
            <SectionLabel>Reason / Notes</SectionLabel>
            <textarea
              value={maintReason} onChange={e => setMaintReason(e.target.value)} rows={3}
              placeholder="Describe the maintenance required…"
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }}
            />
          </div>
        ) : (
          <p style={{ fontSize: '14px', color: THEME.textMed, lineHeight: 1.6 }}>
            Room <strong>{maintTarget?.room_number}</strong> will be marked as available and the maintenance flag cleared.
          </p>
        )}
      </Modal>

      {/* ── Delete Confirm ── */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        title="Delete Room?"
        message={`Permanently delete Room ${deleteTarget?.room_number} in ${deleteTarget?.block?.name || 'this block'}? This cannot be undone. Rooms with any assignment history cannot be deleted — use maintenance mode instead.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete Room'}
        danger
      />
    </div>
  )
}
