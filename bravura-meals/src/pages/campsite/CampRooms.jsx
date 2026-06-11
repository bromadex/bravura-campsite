import { useState, useMemo } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast } from '../../components/ui'

const EMPTY = { room_number: '', block_id: '', capacity: 1, notes: '' }

function RoomStatusChip({ status }) {
  const map = {
    available:   { bg: '#E8F5E9', color: '#1B5E20', label: 'Available' },
    occupied:    { bg: '#FDECEA', color: THEME.error, label: 'Occupied' },
    maintenance: { bg: '#FFF8E1', color: '#7D5700', label: 'Maintenance' },
  }
  const s = map[status] || map.available
  return (
    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}

export default function CampRooms() {
  const { rooms, blocks, assignments, addRoom, updateRoom, setMaintenance, loading } = useCampsite()
  const [modal,   setModal]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [maintTarget,  setMaintTarget]  = useState(null)
  const [maintReason,  setMaintReason]  = useState('')
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
    if (!form.room_number.trim()) { showToast('Room number required', 'red'); return }
    if (!form.block_id)           { showToast('Select a block', 'red'); return }
    setSaving(true)
    try {
      if (editing) {
        await updateRoom(editing.id, { ...form, capacity: parseInt(form.capacity) || 1 })
        showToast('Room updated', 'green')
      } else {
        await addRoom({ ...form, capacity: parseInt(form.capacity) || 1 })
        showToast('Room added', 'green')
      }
      setModal(false)
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  async function toggleMaintenance() {
    try {
      await setMaintenance(maintTarget.id, !maintTarget.is_maintenance, maintReason)
      showToast(maintTarget.is_maintenance ? 'Room returned to service' : 'Room set to maintenance', 'green')
      setMaintTarget(null); setMaintReason('')
    } catch (err) { showToast(err.message, 'red') }
  }

  const filtered = useMemo(() => rooms.filter(r => {
    const matchBlock  = blockFilter === 'all'   || r.block_id === blockFilter
    const matchStatus = statusFilter === 'all'  || r.status === statusFilter
    const matchSearch = !search || r.room_number.toLowerCase().includes(search.toLowerCase()) ||
                        r.block?.name?.toLowerCase().includes(search.toLowerCase())
    return matchBlock && matchStatus && matchSearch
  }), [rooms, blockFilter, statusFilter, search])

  // Occupancy for each room
  function occupancy(roomId) {
    return assignments.filter(a => a.room_id === roomId && a.status === 'active').length
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>
          Rooms
          <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '20px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed }}>{rooms.length}</span>
        </h2>
        <Button onClick={openAdd} variant="filled" icon="add">Add Room</Button>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '180px', maxWidth: '260px' }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input type="text" placeholder="Search room…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 10px 7px 32px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
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
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No rooms found</td></tr>
              ) : filtered.map(room => {
                const occ = occupancy(room.id)
                const pct = room.capacity > 0 ? Math.round(occ / room.capacity * 100) : 0
                return (
                  <tr key={room.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={{ padding: '12px 14px', fontWeight: 600 }}>{room.room_number}</td>
                    <td style={{ padding: '12px 14px', color: THEME.textMed }}>{room.block?.name || '—'}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>{room.capacity}</td>
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
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => openEdit(room)} title="Edit"
                          style={{ width: '30px', height: '30px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="edit" size={14} style={{ color: THEME.textMed }} />
                        </button>
                        <button
                          onClick={() => { setMaintTarget(room); setMaintReason(room.maintenance_reason || '') }}
                          title={room.is_maintenance ? 'Return to service' : 'Set maintenance'}
                          style={{ width: '30px', height: '30px', border: `1px solid ${room.is_maintenance ? THEME.success : THEME.warning}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={room.is_maintenance ? 'check_circle' : 'construction'} size={14} style={{ color: room.is_maintenance ? THEME.success : THEME.warning }} />
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

      {/* Add/Edit Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Edit Room ${editing.room_number}` : 'Add New Room'}
        footer={<>
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          <Button onClick={save} variant="filled" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </>}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Room Number *</SectionLabel>
            <input type="text" value={form.room_number} onChange={e => setForm(f => ({ ...f, room_number: e.target.value }))}
              placeholder="e.g. A-101" autoFocus
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div>
            <SectionLabel>Block *</SectionLabel>
            <select value={form.block_id} onChange={e => setForm(f => ({ ...f, block_id: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }}>
              <option value="">— Select block —</option>
              {blocks.filter(b => b.is_active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Capacity</SectionLabel>
          <input type="number" min={1} max={10} value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
            style={{ width: '100px', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', outline: 'none' }} />
        </div>
        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="Optional…"
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
        </div>
      </Modal>

      {/* Maintenance modal */}
      <Modal open={!!maintTarget} onClose={() => setMaintTarget(null)}
        title={maintTarget?.is_maintenance ? `Return Room ${maintTarget?.room_number} to Service` : `Set Room ${maintTarget?.room_number} to Maintenance`}
        footer={<>
          <Button onClick={() => setMaintTarget(null)} variant="text">Cancel</Button>
          <Button onClick={toggleMaintenance} variant={maintTarget?.is_maintenance ? 'success' : 'filled'} style={maintTarget?.is_maintenance ? {} : { background: THEME.warning }}>
            {maintTarget?.is_maintenance ? 'Return to Service' : 'Set Maintenance'}
          </Button>
        </>}>
        {!maintTarget?.is_maintenance && (
          <div style={{ marginBottom: '12px' }}>
            <SectionLabel>Reason / Notes</SectionLabel>
            <textarea value={maintReason} onChange={e => setMaintReason(e.target.value)} rows={3}
              placeholder="Describe the maintenance required…"
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
          </div>
        )}
        {maintTarget?.is_maintenance && (
          <p style={{ fontSize: '14px', color: THEME.textMed }}>
            This will mark Room <strong>{maintTarget?.room_number}</strong> as available and clear the maintenance flag.
          </p>
        )}
      </Modal>
    </div>
  )
}
