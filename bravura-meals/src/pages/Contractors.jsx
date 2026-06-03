import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { THEME } from '../utils/permissions'
import { Card, Button, Modal, ConfirmModal, StatusBadge, showToast, SectionLabel } from '../components/ui'

const EMPTY_FORM = { name: '', short_code: '', status: 'Active' }

// Colour pool — one per contractor card
const COLORS = ['#6B1C1C','#00897B','#5E35B1','#1565C0','#C55A11','#2E7D32','#AD1457','#00838F','#4527A0']

export default function Contractors() {
  const { profile } = useAuth()

  const [contractors, setContractors] = useState([])
  const [empCounts,   setEmpCounts]   = useState({})
  const [loading,     setLoading]     = useState(true)

  const [modal,        setModal]        = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: cos }, { data: emps }] = await Promise.all([
      supabase.from('contractors').select('*').order('name'),
      supabase.from('employees').select('contractor_id, status'),
    ])
    setContractors(cos || [])
    // Count active employees per contractor
    const counts = {}
    emps?.forEach(e => {
      if (!counts[e.contractor_id]) counts[e.contractor_id] = { active: 0, total: 0 }
      counts[e.contractor_id].total++
      if (e.status === 'Active') counts[e.contractor_id].active++
    })
    setEmpCounts(counts)
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModal(true)
  }

  function openEdit(co) {
    setEditing(co)
    setForm({ name: co.name, short_code: co.short_code || '', status: co.status })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { showToast('Please enter a company name', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        name:       form.name.trim(),
        short_code: form.short_code.trim().toUpperCase() || null,
        status:     form.status,
      }
      if (editing) {
        const { error } = await supabase.from('contractors').update(payload).eq('id', editing.id)
        if (error) throw error
        showToast('Contractor updated ✓', 'green')
      } else {
        const { error } = await supabase.from('contractors').insert(payload)
        if (error) throw error
        showToast('Contractor added ✓', 'green')
      }
      setModal(false)
      fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(co) {
    const next = co.status === 'Active' ? 'Inactive' : 'Active'
    const { error } = await supabase.from('contractors').update({ status: next }).eq('id', co.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${co.name} → ${next}`)
    fetchAll()
  }

  async function deleteContractor() {
    if (!deleteTarget) return
    const cnt = empCounts[deleteTarget.id]
    if (cnt && cnt.total > 0) {
      showToast(`Cannot delete: ${cnt.total} employee(s) belong to this contractor. Reassign them first.`, 'red')
      setDeleteTarget(null)
      return
    }
    setDeleting(true)
    const { error } = await supabase.from('contractors').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) { showToast('Delete failed: ' + error.message, 'red'); setDeleteTarget(null); return }
    showToast(`${deleteTarget.name} deleted`, 'red')
    setDeleteTarget(null)
    fetchAll()
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: THEME.primary }}>
            Contractors & Employers
          </h2>
          <div style={{ fontSize: '12px', color: '#888', marginTop: '3px' }}>
            Companies whose employees eat on site. Add new contractors as they arrive.
          </div>
        </div>
        <Button onClick={openAdd} variant="primary">+ Add Contractor</Button>
      </div>

      {/* Cards */}
      {loading ? (
        <div style={{ color: '#aaa', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : contractors.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '32px', color: '#aaa' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏢</div>
            No contractors yet. Add the first one.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '14px' }}>
          {contractors.map((co, i) => {
            const color = COLORS[i % COLORS.length]
            const cnt   = empCounts[co.id] || { active: 0, total: 0 }
            const isInactive = co.status === 'Inactive'
            return (
              <Card
                key={co.id}
                style={{
                  borderTop: `4px solid ${color}`,
                  opacity: isInactive ? 0.6 : 1,
                  padding: '16px',
                }}
              >
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* Logo circle */}
                    <div style={{
                      width: '44px', height: '44px', borderRadius: '10px', flexShrink: 0,
                      background: color, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '14px', fontWeight: 800,
                    }}>
                      {co.short_code || co.name.slice(0,2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: '#1a1a2e' }}>{co.name}</div>
                      {co.short_code && (
                        <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>Code: {co.short_code}</div>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={co.status} />
                </div>

                {/* Employee counts */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                  <div style={{ background: '#f4f6f9', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: '#375623' }}>{cnt.active}</div>
                    <div style={{ fontSize: '10px', color: '#888' }}>Active Employees</div>
                  </div>
                  <div style={{ background: '#f4f6f9', borderRadius: '8px', padding: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.primary }}>{cnt.total}</div>
                    <div style={{ fontSize: '10px', color: '#888' }}>Total on Record</div>
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <Button onClick={() => openEdit(co)} variant="ghost" size="sm">✏️ Edit</Button>
                  <Button onClick={() => toggleStatus(co)} variant="ghost" size="sm">
                    {co.status === 'Active' ? '🚫 Deactivate' : '✅ Activate'}
                  </Button>
                  <Button
                    onClick={() => setDeleteTarget(co)}
                    variant="ghost" size="sm"
                    style={{ color: '#C00000', borderColor: '#f5b8b8' }}
                  >
                    🗑️ Delete
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add New Contractor'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={save} variant="primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add contractor'}
            </Button>
          </>
        }
      >
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Company / Contractor Name *</SectionLabel>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. ABC Mining (Pvt) Ltd"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && save()}
            style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <SectionLabel>Short Code (optional)</SectionLabel>
            <input
              type="text"
              value={form.short_code}
              maxLength={6}
              onChange={e => setForm(f => ({ ...f, short_code: e.target.value }))}
              placeholder="e.g. ABC"
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', textTransform: 'uppercase' }}
            />
            <div style={{ fontSize: '10px', color: '#aaa', marginTop: '3px' }}>Displayed on employee badges & filters</div>
          </div>
          <div>
            <SectionLabel>Status</SectionLabel>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteContractor}
        title="Delete Contractor?"
        message={
          deleteTarget && (empCounts[deleteTarget.id]?.total || 0) > 0
            ? `Cannot delete "${deleteTarget?.name}" — ${empCounts[deleteTarget.id]?.total} employee(s) are linked to it. Reassign them first.`
            : `Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`
        }
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        danger
      />
    </div>
  )
}
