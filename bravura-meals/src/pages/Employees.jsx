import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, Button, Modal, showToast, initials } from '../components/ui'

export default function Employees() {
  const { profile } = useAuth()
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [filter,    setFilter]    = useState('all')
  const [modal,     setModal]     = useState(false)
  const [editing,   setEditing]   = useState(null)
  const [form,      setForm]      = useState({ name: '', group_name: 'Main Site', status: 'Active' })
  const [saving,    setSaving]    = useState(false)

  useEffect(() => { fetchEmployees() }, [])

  async function fetchEmployees() {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('*')
      .order('group_name').order('name')
    setEmployees(data || [])
    setLoading(false)
  }

  function openAdd() {
    setEditing(null)
    setForm({ name: '', group_name: 'Main Site', status: 'Active' })
    setModal(true)
  }

  function openEdit(emp) {
    setEditing(emp)
    setForm({ name: emp.name, group_name: emp.group_name, status: emp.status })
    setModal(true)
  }

  async function saveEmployee() {
    if (!form.name.trim()) { showToast('Please enter a name', 'red'); return }
    setSaving(true)
    try {
      if (editing) {
        const { error } = await supabase
          .from('employees')
          .update({ name: form.name.trim(), group_name: form.group_name, status: form.status })
          .eq('id', editing.id)
        if (error) throw error
        showToast('Employee updated', 'green')
      } else {
        const { error } = await supabase
          .from('employees')
          .insert({ name: form.name.trim(), group_name: form.group_name, status: form.status })
        if (error) throw error
        showToast('Employee added', 'green')
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
    const { error } = await supabase
      .from('employees')
      .update({ status: newStatus })
      .eq('id', emp.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${emp.name} set to ${newStatus}`)
    fetchEmployees()
  }

  const filtered = employees.filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filter === 'all'
      ? true
      : filter === 'Active' || filter === 'Inactive'
        ? e.status === filter
        : e.group_name === filter
    return matchSearch && matchFilter
  })

  const activeCount = employees.filter(e => e.status === 'Active').length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>
            Employee Master List
            <span style={{ marginLeft: '8px', padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#D6E4F0', color: '#1F3864' }}>
              {activeCount} active / {employees.length} total
            </span>
          </h2>
        </div>
        <Button onClick={openAdd} variant="success">+ Add employee</Button>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Search employees…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: '200px', maxWidth: '300px',
              padding: '7px 12px', border: '1px solid #dde2ea', borderRadius: '8px',
              fontSize: '13px', fontFamily: 'inherit',
            }}
          />
          {['all', 'Active', 'Inactive', 'Main Site', 'Manhattan'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', border: '1px solid #dde2ea', fontFamily: 'inherit',
                background: filter === f ? '#1F3864' : 'transparent',
                color: filter === f ? '#fff' : '#4a5568',
              }}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </Card>

      {/* Employee grid */}
      {loading ? (
        <div style={{ color: '#888', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>No employees match your filter.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(210px,1fr))', gap: '10px' }}>
          {filtered.map(emp => (
            <div
              key={emp.id}
              style={{
                background: '#fff', border: '1px solid #dde2ea', borderRadius: '10px',
                padding: '12px', display: 'flex', alignItems: 'center', gap: '10px',
                opacity: emp.status === 'Inactive' ? 0.45 : 1,
                transition: 'border-color .15s',
                position: 'relative',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#4472C4'
                e.currentTarget.querySelector('.emp-actions').style.opacity = '1'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#dde2ea'
                e.currentTarget.querySelector('.emp-actions').style.opacity = '0'
              }}
            >
              {/* Avatar */}
              <div style={{
                width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '12px', fontWeight: 700,
                background: emp.group_name === 'Manhattan' ? '#E0F2F1' : '#D6E4F0',
                color: emp.group_name === 'Manhattan' ? '#00897B' : '#1F3864',
              }}>
                {initials(emp.name)}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {emp.name}
                </div>
                <div style={{ fontSize: '11px', color: '#888', marginTop: '1px' }}>
                  {emp.group_name} · {emp.status}
                </div>
              </div>
              {/* Actions (hover) */}
              <div className="emp-actions" style={{ display: 'flex', gap: '4px', opacity: 0, transition: 'opacity .15s' }}>
                <button
                  onClick={() => openEdit(emp)}
                  title="Edit"
                  style={{ width: '28px', height: '28px', border: '1px solid #dde2ea', borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}
                >
                  ✏️
                </button>
                <button
                  onClick={() => toggleStatus(emp)}
                  title={emp.status === 'Active' ? 'Deactivate' : 'Activate'}
                  style={{ width: '28px', height: '28px', border: '1px solid #dde2ea', borderRadius: '6px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}
                >
                  {emp.status === 'Active' ? '🚫' : '✅'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? 'Edit employee' : 'Add employee'}
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="ghost">Cancel</Button>
            <Button onClick={saveEmployee} variant="success" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Full name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. John Smith"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && saveEmployee()}
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Group / Camp</label>
            <select
              value={form.group_name}
              onChange={e => setForm(f => ({ ...f, group_name: e.target.value }))}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}
            >
              <option value="Main Site">Main Site</option>
              <option value="Manhattan">Manhattan</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Status</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      </Modal>
    </div>
  )
}
