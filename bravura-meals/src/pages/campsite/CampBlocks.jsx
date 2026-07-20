import { useState } from 'react'
import { useCampsite } from '../../contexts/CampsiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, StatusBadge, showToast, PageHeader } from '../../components/ui'
import QuickNav, { CAMPSITE_PILLS } from '../../components/QuickNav'

const EMPTY = { name: '', description: '', is_active: true }

export default function CampBlocks({ setPage }) {
  const { blocks, rooms, addBlock, updateBlock, deleteBlock, loading } = useCampsite()
  const [modal,   setModal]   = useState(false)
  const [editing, setEditing] = useState(null)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [delTarget, setDelTarget] = useState(null)

  function openAdd() { setEditing(null); setForm(EMPTY); setModal(true) }
  function openEdit(b) { setEditing(b); setForm({ name: b.name, description: b.description || '', is_active: b.is_active }); setModal(true) }

  async function save() {
    if (!form.name.trim()) { showToast('Block name is required', 'red'); return }
    setSaving(true)
    try {
      if (editing) {
        await updateBlock(editing.id, form)
        showToast('Block updated', 'green')
      } else {
        await addBlock(form)
        showToast('Block added', 'green')
      }
      setModal(false)
    } catch (err) { showToast(err.message, 'red') }
    finally { setSaving(false) }
  }

  async function doDelete() {
    try {
      await deleteBlock(delTarget.id)
      showToast(`${delTarget.name} deleted`, 'red')
      setDelTarget(null)
    } catch (err) { showToast(err.message, 'red'); setDelTarget(null) }
  }

  return (
    <div>
      <PageHeader title="Blocks" actions={<Button onClick={openAdd} variant="filled" icon="add">Add Block</Button>} />

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : blocks.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
            <Icon name="domain" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
            No blocks yet. Add the first block.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '14px' }}>
          {blocks.map(block => {
            const blockRooms    = rooms.filter(r => r.block_id === block.id)
            const occupiedRooms = blockRooms.filter(r => r.status === 'occupied').length
            const availRooms    = blockRooms.filter(r => r.status === 'available').length
            const maintRooms    = blockRooms.filter(r => r.status === 'maintenance').length

            return (
              <Card key={block.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
      <QuickNav pills={CAMPSITE_PILLS} setPage={setPage} current="camp_blocks" />
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>{block.name}</div>
                    {block.description && <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px' }}>{block.description}</div>}
                  </div>
                  <StatusBadge status={block.is_active ? 'Active' : 'Inactive'} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', marginBottom: '14px' }}>
                  {[
                    { label: 'Total',       v: blockRooms.length,  c: THEME.primary  },
                    { label: 'Occupied',    v: occupiedRooms,       c: THEME.error    },
                    { label: 'Available',   v: availRooms,          c: THEME.success  },
                    { label: 'Maintenance', v: maintRooms,          c: THEME.warning  },
                  ].map(s => (
                    <div key={s.label} style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '8px', textAlign: 'center' }}>
                      <div style={{ fontSize: '20px', fontWeight: 600, color: s.c }}>{s.v}</div>
                      <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <Button onClick={() => openEdit(block)} variant="tonal" size="sm" icon="edit">Edit</Button>
                  <Button onClick={() => setDelTarget(block)} variant="outlined" size="sm" icon="delete" style={{ color: THEME.error, borderColor: THEME.error }}>Delete</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal dirty={true}
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add New Block'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} variant="filled" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          </>
        }
      >
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Block Name *</SectionLabel>
          <input
            type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Block A" autoFocus
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
            onFocus={e => e.target.style.borderColor = THEME.primary}
            onBlur={e => e.target.style.borderColor = THEME.outline}
          />
        </div>
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Description</SectionLabel>
          <textarea
            value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Optional description…" rows={2}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', outline: 'none' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="checkbox" id="is_active" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
          <label htmlFor="is_active" style={{ fontSize: '13px', color: THEME.textMed, cursor: 'pointer' }}>Block is active</label>
        </div>
      </Modal>

      <ConfirmModal
        open={!!delTarget} onClose={() => setDelTarget(null)} onConfirm={doDelete}
        title="Delete Block?"
        message={`Delete "${delTarget?.name}"? All rooms in this block must be removed first.`}
        confirmLabel="Delete" danger
      />
    </div>
  )
}
