import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { THEME } from '../utils/permissions'
import { usePermissions } from '../contexts/PermissionsContext'
import { useSite } from '../contexts/SiteContext'
import { Card, Button, Modal, ConfirmModal, StatusBadge, Icon, showToast, initials, SectionLabel } from '../components/ui'

const EMPTY_FORM = { name: '', contractor_id: '', status: 'active', gender: '' }

// Colour pool for contractor pills — same palette used across the app
const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457']

export default function Employees() {
  // Real RBAC per the approved matrix — Delete is scoped to HR Officer /
  // System Administrator only, matching 03_RBAC_MATRIX.md.
  const { can } = usePermissions()
  const canDelete = can('employees.delete')

  // Site filtering — the actual payoff for the site foundation work.
  // currentSite is read so its name can be shown in the empty-state message
  // (so switching to a site with no data reads as "correct," not "broken").
  const { currentSiteId, currentSite } = useSite()

  const [employees,    setEmployees]    = useState([])
  const [contractors,  setContractors]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('active')
  const [filterCo,     setFilterCo]     = useState('all')

  const [modal,        setModal]        = useState(false)
  const [editing,      setEditing]      = useState(null)
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [saving,       setSaving]       = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  useEffect(() => {
    fetchContractors()
  }, [])

  // Re-fetch whenever the selected site changes — this is the actual
  // filtering. Guarded on currentSiteId being resolved first, so we don't
  // fire an unfiltered query while SiteContext is still loading.
  useEffect(() => {
    if (currentSiteId) fetchEmployees()
  }, [currentSiteId])

  async function fetchContractors() {
    const { data } = await supabase.from('contractors').select('*').order('name')
    setContractors(data || [])
  }

  async function fetchEmployees() {
    setLoading(true)
    const { data } = await supabase
      .from('employees')
      .select('*, contractor:contractors(id, name, short_code)')
      .eq('site_id', currentSiteId)
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
      gender:        emp.gender || '',
    })
    setModal(true)
  }

  async function saveEmployee() {
    if (!form.name.trim())   { showToast('Please enter a name', 'red'); return }
    if (!form.contractor_id) { showToast('Please select a contractor', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        name:          form.name.trim(),
        contractor_id: form.contractor_id,
        group_name:    contractors.find(c => c.id === form.contractor_id)?.name || '',
        status:        form.status,
        gender:        form.gender || null,
      }
      if (editing) {
        // Site is deliberately NOT touched on edit — changing where an
        // employee belongs is a transfer (employee_movements), not a plain
        // field edit. That's its own future roadmap item.
        const { error } = await supabase.from('employees').update(payload).eq('id', editing.id)
        if (error) throw error
        showToast('Employee updated', 'green')
      } else {
        // New employees are stamped with whichever site is currently
        // selected — otherwise the database default (Kamativi) would
        // silently apply even while viewing a different site, and the new
        // record would never show up in the list you just added it from.
        const { error } = await supabase.from('employees').insert({ ...payload, site_id: currentSiteId })
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
    const newStatus = emp.status === 'active' ? 'terminated' : 'active'
    const { error } = await supabase.from('employees').update({ status: newStatus }).eq('id', emp.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${emp.name} → ${newStatus === 'active' ? 'Active' : 'Terminated'}`, 'green')
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

  const contractorTabs = contractors.filter(c => employees.some(e => e.contractor_id === c.id))
  const coColorMap = {}
  contractors.forEach((c, i) => { coColorMap[c.id] = CO_COLORS[i % CO_COLORS.length] })

  const filtered = useMemo(() => employees.filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || e.status === filterStatus
    const matchCo      = filterCo === 'all' || e.contractor_id === filterCo
    return matchSearch && matchStatus && matchCo
  }), [employees, search, filterStatus, filterCo])

  const activeCount = employees.filter(e => e.status === 'active').length

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>
            Employees
            <span style={{ marginLeft: '10px', padding: '2px 10px', borderRadius: '20px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed }}>
              {employees.length}
            </span>
          </h2>
          <div style={{ marginTop: '6px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#E8F5E9', color: '#1B5E20' }}>
              {activeCount} active
            </span>
            <span style={{ padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed }}>
              {employees.length - activeCount} terminated
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.primary }}>
              <Icon name="location_on" size={12} style={{ color: THEME.primary }} />
              {currentSite?.name || '—'}
            </span>
          </div>
        </div>
        <Button onClick={openAdd} variant="filled" icon="add">Add Employee</Button>
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: '200px', maxWidth: '300px' }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input
              type="text" placeholder="Search by name…" value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', padding: '7px 10px 7px 32px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {[['active','Active'],['terminated','Terminated'],['all','All Status']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} style={{
              padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${filterStatus === val ? THEME.primary : THEME.outline}`,
              background: filterStatus === val ? THEME.surfaceVar : 'transparent',
              color: filterStatus === val ? THEME.primary : THEME.textMed,
            }}>
              {label}
            </button>
          ))}

          <select value={filterCo} onChange={e => setFilterCo(e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="all">All Contractors</option>
            {contractorTabs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
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
                {['Employee','Contractor','Gender','Status','Actions'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
                    <Icon name="badge" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                    {employees.length === 0
                      ? `No employees recorded at ${currentSite?.name || 'this site'} yet`
                      : 'No employees match your filter'}
                  </td>
                </tr>
              ) : filtered.map(emp => {
                const coColor = coColorMap[emp.contractor_id] || THEME.primary
                return (
                  <tr
                    key={emp.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, opacity: emp.status === 'terminated' ? 0.6 : 1 }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                  >
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '12px', fontWeight: 700, color: '#fff', background: coColor,
                        }}>
                          {initials(emp.name)}
                        </div>
                        <span style={{ fontWeight: 500, color: THEME.text }}>{emp.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {emp.contractor ? (
                        <span style={{ background: coColor + '18', color: coColor, padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 600 }}>
                          {emp.contractor.short_code || emp.contractor.name}
                        </span>
                      ) : <span style={{ color: THEME.textLow }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>
                      {emp.gender ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <Icon name={emp.gender === 'female' ? 'woman' : 'man'} size={15} style={{ color: THEME.textLow }} />
                          {emp.gender === 'female' ? 'Female' : 'Male'}
                        </span>
                      ) : <span style={{ color: THEME.textLow }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <StatusBadge status={emp.status} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => openEdit(emp)} title="Edit"
                          style={{ width: '30px', height: '30px', border: `1px solid ${THEME.outline}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="edit" size={14} style={{ color: THEME.textMed }} />
                        </button>
                        <button
                          onClick={() => toggleStatus(emp)}
                          title={emp.status === 'active' ? 'Mark Terminated' : 'Reactivate'}
                          style={{ width: '30px', height: '30px', border: `1px solid ${emp.status === 'active' ? THEME.warning : THEME.success}`, borderRadius: '8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={emp.status === 'active' ? 'block' : 'check_circle'} size={14} style={{ color: emp.status === 'active' ? THEME.warning : THEME.success }} />
                        </button>
                        {canDelete && (
                          <button
                            onClick={() => setDeleteTarget(emp)}
                            title="Delete"
                            style={{ width: '30px', height: '30px', border: '1px solid #f5b8b8', borderRadius: '8px', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="delete" size={14} style={{ color: THEME.error }} />
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

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add New Employee'}
        footer={<>
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          <Button onClick={saveEmployee} variant="filled" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add Employee'}
          </Button>
        </>}
      >
        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Full Name *</SectionLabel>
          <input
            type="text" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. John Banda" autoFocus
            onKeyDown={e => e.key === 'Enter' && saveEmployee()}
            style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
            onFocus={e => e.target.style.borderColor = THEME.primary}
            onBlur={e => e.target.style.borderColor = THEME.outline}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <div>
            <SectionLabel>Employer / Contractor</SectionLabel>
            <select
              value={form.contractor_id}
              onChange={e => setForm(f => ({ ...f, contractor_id: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
            >
              <option value="">— Select —</option>
              {contractors.filter(c => c.status === 'Active').map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <SectionLabel>Gender</SectionLabel>
            <select
              value={form.gender}
              onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
            >
              <option value="">— Not set —</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>

          <div>
            <SectionLabel>Status</SectionLabel>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
            >
              <option value="active">Active</option>
              <option value="terminated">Terminated</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textLow }}>
          Gender is used by Campsite room assignment to enforce single-gender rooms.
        </div>

        {contractors.length === 0 && (
          <div style={{ marginTop: '14px', padding: '10px 14px', background: '#FFF8E1', borderRadius: '10px', fontSize: '12px', color: '#7D5700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="warning" size={16} style={{ color: '#7D5700' }} />
            No contractors found. Please add a contractor first under <strong>Contractors</strong>.
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
