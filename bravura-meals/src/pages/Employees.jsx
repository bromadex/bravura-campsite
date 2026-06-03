import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { can, THEME } from '../utils/permissions'
import { Card, Button, Modal, ConfirmModal, StatusBadge, showToast, initials, SectionLabel } from '../components/ui'

const EMPTY_FORM = { name: '', contractor_id: '', status: 'Active' }

export default function Employees() {
  const { profile } = useAuth()
  const role = profile?.role
  const canDelete = can.deleteEmployee(role)

  const [employees,    setEmployees]    = useState([])
  const [contractors,  setContractors]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('Active')
  const [filterCo,     setFilterCo]     = useState('all')

  // Employee modal
  const [modal,        setModal]        = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  useEffect(() => {
    fetchContractors()
    fetchEmployees()
  }, [])

  async function fetchContractors() {
    const { data } = await supabase
      .from('contractors')
      .select('*')
      .order('name')
    setContractors(data || [])
  }

  async function fetchEmployees() {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('*, contractor:contractors(id, name, short_code)')
      .order('name')
    setEmployees(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, contractor_id: contractors[0]?.id || '' })
    setModal(true)
  }

  function openEdit(emp) {
    setEditing(emp)
    setForm({
      name:          emp.name,
      contractor_id: emp.contractor_id || '',
      status:        emp.status,
    })
    setModal(true)
  }

  async function saveEmployee() {
    if (!form.name.trim())       { showToast('Please enter a name', 'red'); return }
    if (!form.contractor_id)     { showToast('Please select a contractor', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        name:          form.name.trim(),
        contractor_id: form.contractor_id,
        group_name:    contractors.find(c => c.id === form.contractor_id)?.name || '',
        status:        form.status,
      }
      if (editing) {
        const { error } = await supabase.from('employees').update(payload).eq('id', editing.id)
        if (error) throw error
        showToast('Employee updated ✓', 'green')
      } else {
        const { error } = await supabase.from('employees').insert(payload)
        if (error) throw error
        showToast('Employee added ✓', 'green')
      }
      setModal(false)
      fetchEmployees()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(emp) {
    const newStatus = emp.status === 'Active' ? 'Inactive' : 'Active'
    const { error } = await supabase.from('employees').update({ status: newStatus }).eq('id', emp.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${emp.name} → ${newStatus}`)
    fetchEmployees()
  }

  async function deleteEmployee() {
    if (!deleteTarget) return
    setDeleting(true)
    const { error } = await supabase.from('employees').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) { showToast('Cannot delete: ' + error.message, 'red'); setDeleteTarget(null); return }
    showToast(`${deleteTarget.name} deleted`, 'red')
    setDeleteTarget(null)
    fetchEmployees()
  }

  // Unique contractor list for filter tabs
  const contractorTabs = contractors.filter(c => employees.some(e => e.contractor_id === c.id))

  const filtered = employees.filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || e.status === filterStatus
    const matchCo     = filterCo === 'all' || e.contractor_id === filterCo
    return matchSearch && matchStatus && matchCo
  })

  const activeCount = employees.filter(e => e.status === 'Active').length

  // Colour pool for contractor avatars
  const coColors = ['#6B1C1C','#00897B','#5E35B1','#1565C0','#C55A11','#2E7D32','#AD1457']
  const coColorMap = {}
  contractors.forEach((c, i) => { coColorMap[c.id] = coColors[i % coColors.length] })

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: THEME.primary }}>
            Employee Master List
          </h2>
          <div style={{ marginTop: '4px', display: 'flex', gap: '8px' }}>
            <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#E2EFDA', color: '#375623' }}>
              {activeCount} active
            </span>
            <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#F5EDEE', color: THEME.primary }}>
              {employees.length} total
            </span>
          </div>
        </div>
        <Button onClick={openAdd} variant="primary">+ Add Employee</Button>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '16px', padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Search by name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: '180px', maxWidth: '280px',
              padding: '7px 12px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '8px',
              fontSize: '13px', fontFamily: 'inherit', outline: 'none',
            }}
          />

          {/* Status filter */}
          <div style={{ display: 'flex', gap: '4px' }}>
            {['Active','Inactive','all'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} style={{
                padding: '5px 11px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', border: `1px solid ${THEME.cardBorder}`, fontFamily: 'inherit',
                background: filterStatus === s ? THEME.primary : 'transparent',
                color: filterStatus === s ? '#fff' : '#4a5568',
              }}>
                {s === 'all' ? 'All Status' : s}
              </button>
            ))}
          </div>

          {/* Contractor filter */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            <button onClick={() => setFilterCo('all')} style={{
              padding: '5px 11px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', border: `1px solid ${THEME.cardBorder}`, fontFamily: 'inherit',
              background: filterCo === 'all' ? THEME.primaryLight : 'transparent',
              color: filterCo === 'all' ? '#fff' : '#4a5568',
            }}>
              All Companies
            </button>
            {contractorTabs.map(c => (
              <button key={c.id} onClick={() => setFilterCo(c.id)} style={{
                padding: '5px 11px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', border: `1px solid ${THEME.cardBorder}`, fontFamily: 'inherit',
                background: filterCo === c.id ? coColorMap[c.id] : 'transparent',
                color: filterCo === c.id ? '#fff' : '#4a5568',
              }}>
                {c.short_code || c.name}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Employee grid */}
      {loading ? (
        <div style={{ color: '#aaa', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#aaa' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>👤</div>
          No employees match your filter.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '10px' }}>
          {filtered.map(emp => {
            const coColor = coColorMap[emp.contractor_id] || THEME.primary
            return (
              <div
                key={emp.id}
                className="emp-card"
                style={{
                  background: '#fff',
                  border: `1px solid ${THEME.cardBorder}`,
                  borderRadius: '10px',
                  padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  opacity: emp.status === 'Inactive' ? 0.5 : 1,
                  transition: 'box-shadow .15s, border-color .15s',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = coColor
                  e.currentTarget.style.boxShadow = `0 2px 12px rgba(107,28,28,.1)`
                  e.currentTarget.querySelector('.emp-actions').style.opacity = '1'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = THEME.cardBorder
                  e.currentTarget.style.boxShadow = 'none'
                  e.currentTarget.querySelector('.emp-actions').style.opacity = '0'
                }}
              >
                {/* Avatar */}
                <div style={{
                  width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '12px', fontWeight: 700, color: '#fff',
                  background: coColor,
                }}>
                  {initials(emp.name)}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#1a1a2e' }}>
                    {emp.name}
                  </div>
                  <div style={{ fontSize: '11px', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{
                      background: coColor + '22', color: coColor,
                      padding: '1px 6px', borderRadius: '8px', fontWeight: 700, fontSize: '10px',
                    }}>
                      {emp.contractor?.short_code || emp.contractor?.name || '—'}
                    </span>
                    <StatusBadge status={emp.status} />
                  </div>
                </div>

                {/* Hover actions */}
                <div className="emp-actions" style={{ display: 'flex', flexDirection: 'column', gap: '3px', opacity: 0, transition: 'opacity .15s', flexShrink: 0 }}>
                  <button
                    onClick={() => openEdit(emp)}
                    title="Edit"
                    style={{ width: '26px', height: '26px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                  >✏️</button>
                  <button
                    onClick={() => toggleStatus(emp)}
                    title={emp.status === 'Active' ? 'Deactivate' : 'Activate'}
                    style={{ width: '26px', height: '26px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                  >{emp.status === 'Active' ? '🚫' : '✅'}</button>
                  {canDelete && (
                    <button
                      onClick={() => setDeleteTarget(emp)}
                      title="Delete"
                      style={{ width: '26px', height: '26px', border: '1px solid #f5b8b8', borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                    >🗑️</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add New Employee'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={saveEmployee} variant="primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add employee'}
            </Button>
          </>
        }
      >
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Full Name</SectionLabel>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. John Banda"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && saveEmployee()}
            style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <SectionLabel>Employer / Contractor</SectionLabel>
            <select
              value={form.contractor_id}
              onChange={e => setForm(f => ({ ...f, contractor_id: e.target.value }))}
              style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.cardBorder}`, borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}
            >
              <option value="">— Select —</option>
              {contractors.filter(c => c.status === 'Active').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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

        {contractors.length === 0 && (
          <div style={{ marginTop: '12px', padding: '10px 14px', background: '#FFF2CC', borderRadius: '8px', fontSize: '12px', color: '#7B5800' }}>
            ⚠ No contractors found. Please add a contractor first under <strong>Admin → Contractors</strong>.
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteEmployee}
        title="Delete Employee?"
        message={`Are you sure you want to permanently delete ${deleteTarget?.name}? This cannot be undone. Historical meal records will still reference their name.`}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        danger
      />
    </div>
  )
}
