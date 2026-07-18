import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import QuickNav, { CONTRACTOR_PILLS } from '../../components/QuickNav'

const color = MODULE_COLORS.contractors

const STATUSES = ['active', 'inactive']

const EMPTY_FORM = {
  contractor_id: '', contract_id: '', name: '', national_id: '', phone: '',
  role: '', trade: '', access_card: '', induction_date: '', medical_expiry: '',
  ppe_issued: false, accommodation_id: '', meals_authorised: false,
  fuel_authorised: false, status: 'active', notes: '',
}

function expiryStatus(dateStr) {
  if (!dateStr) return 'none'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = (d - now) / 86400000
  if (diff < 0) return 'expired'
  if (diff <= 30) return 'warning'
  return 'ok'
}

const EXPIRY_COLORS = {
  expired: { border: THEME.statusErrorText, text: THEME.statusErrorText },
  warning: { border: THEME.statusWarningText, text: THEME.statusWarningText },
  ok:      { border: THEME.statusSuccessText, text: THEME.statusSuccessText },
  none:    { border: THEME.outlineVar, text: THEME.textLow },
}

export default function CLContractorEmployees({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [items, setItems] = useState([])
  const [contractors, setContractors] = useState([])
  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterContractor, setFilterContractor] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [importCandidates, setImportCandidates] = useState([])
  const [importOpen, setImportOpen] = useState(false)
  const [importSelected, setImportSelected] = useState({})
  const [importing, setImporting] = useState(false)

  async function fetchItems() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('contractor_employees')
      .select('*, contractor:contractors(id, name)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (!err) setItems(data || [])
    else showToast(err.message, 'red')
    setLoading(false)
  }

  async function fetchLookups() {
    if (!currentSiteId) return
    const [c1, c2] = await Promise.all([
      supabase.from('contractors').select('id, name').eq('is_archived', false).order('name'),
      supabase.from('contractor_contracts').select('id, contract_number, title').eq('site_id', currentSiteId).order('created_at', { ascending: false }),
    ])
    setContractors(c1.data || [])
    setContracts(c2.data || [])
  }

  async function fetchImportCandidates() {
    if (!currentSiteId) return
    const { data, error: err } = await supabase
      .from('employees')
      .select('id, name, phone, national_id, position_title, contractor_id')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .not('contractor_id', 'is', null)
      .order('name')
    if (err) { showToast(err.message, 'red'); return }
    const linkedEmployeeIds = new Set(items.map(i => i.employee_id).filter(Boolean))
    setImportCandidates((data || []).filter(e => !linkedEmployeeIds.has(e.id)))
  }

  useEffect(() => { fetchItems(); fetchLookups() }, [currentSiteId])

  function openImport() {
    fetchImportCandidates()
    setImportSelected({})
    setImportOpen(true)
  }

  async function handleImport() {
    const chosen = importCandidates.filter(e => importSelected[e.id])
    if (chosen.length === 0) return
    setImporting(true)
    try {
      const payload = chosen.map(e => ({
        site_id: currentSiteId,
        contractor_id: e.contractor_id,
        employee_id: e.id,
        name: e.name,
        phone: e.phone || null,
        national_id: e.national_id || null,
        role: e.position_title || null,
        status: 'active',
      }))
      const { error: err } = await supabase.from('contractor_employees').insert(payload)
      if (err) throw err
      showToast(`Imported ${chosen.length} employee${chosen.length !== 1 ? 's' : ''}`, 'green')
      setImportOpen(false)
      await fetchItems()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setImporting(false)
    }
  }

  const filtered = useMemo(() => {
    let list = items
    if (filterContractor !== 'all') list = list.filter(d => d.contractor_id === filterContractor)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.national_id || '').toLowerCase().includes(q) ||
        (d.role || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, filterContractor, search])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditId(item.id)
    const f = {}
    for (const k of Object.keys(EMPTY_FORM)) f[k] = item[k] ?? EMPTY_FORM[k]
    setForm(f)
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name || !form.contractor_id) {
      setError('Name and contractor are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        contractor_id: form.contractor_id,
        contract_id: form.contract_id || null,
        name: form.name,
        national_id: form.national_id || null,
        phone: form.phone || null,
        role: form.role || null,
        trade: form.trade || null,
        access_card: form.access_card || null,
        induction_date: form.induction_date || null,
        medical_expiry: form.medical_expiry || null,
        ppe_issued: !!form.ppe_issued,
        accommodation_id: form.accommodation_id || null,
        meals_authorised: !!form.meals_authorised,
        fuel_authorised: !!form.fuel_authorised,
        status: form.status,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('contractor_employees').update(payload).eq('id', editId)
        if (err) throw err
        showToast('Employee updated', 'green')
      } else {
        const { error: err } = await supabase.from('contractor_employees').insert(payload)
        if (err) throw err
        showToast('Employee added', 'green')
      }
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this employee record?')) return
    try {
      const { error: err } = await supabase.from('contractor_employees').update({ is_archived: true }).eq('id', editId)
      if (err) throw err
      showToast('Employee archived', 'green')
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      showToast(err.message, 'red')
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Contractor Employees</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('contractors.create') && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={openImport} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: THEME.surfaceVar, color: THEME.text, border: `1px solid ${THEME.outlineVar}`,
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>group_add</span>
              Import from HR
            </button>
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              Add Employee
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search name, ID or role..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterContractor} onChange={e => setFilterContractor(e.target.value)} style={{ ...inp, maxWidth: '220px' }}>
          <option value="all">All Contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>badge</span>
          <div style={{ fontSize: '14px' }}>No contractor employees found</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Name', 'Contractor', 'Role/Trade', 'Access Card', 'Medical Expiry', 'PPE', 'Meals', 'Fuel', 'Status'].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const es = expiryStatus(d.medical_expiry)
                const ec = EXPIRY_COLORS[es]
                return (
                  <tr
                    key={d.id}
                    onClick={() => can('contractors.edit') ? openEdit(d) : null}
                    style={{ cursor: can('contractors.edit') ? 'pointer' : 'default', borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>{d.name}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.contractor?.name || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{[d.role, d.trade].filter(Boolean).join(' / ') || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.access_card || '-'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: ec.text }}>
                      {d.medical_expiry || '-'}
                      {es === 'expired' && <span style={{ marginLeft: '4px', fontSize: '10px' }}>EXPIRED</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>{d.ppe_issued ? '✓' : '-'}</td>
                    <td style={{ padding: '10px 12px' }}>{d.meals_authorised ? '✓' : '-'}</td>
                    <td style={{ padding: '10px 12px' }}>{d.fuel_authorised ? '✓' : '-'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '6px',
                        background: d.status === 'active' ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                        color: d.status === 'active' ? THEME.statusSuccessText : THEME.statusNeutralText,
                      }}>{d.status}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '640px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
      <QuickNav pills={CONTRACTOR_PILLS} setPage={setPage} current="cl_employees" />
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Employee' : 'Add Employee'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Name *</label>
                  <input style={inp} value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Contractor *</label>
                  <select style={inp} value={form.contractor_id} onChange={e => set('contractor_id', e.target.value)}>
                    <option value="">-- Select --</option>
                    {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Contract</label>
                  <select style={inp} value={form.contract_id} onChange={e => set('contract_id', e.target.value)}>
                    <option value="">-- None --</option>
                    {contracts.map(c => <option key={c.id} value={c.id}>{c.contract_number || c.title}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>National ID</label>
                  <input style={inp} value={form.national_id} onChange={e => set('national_id', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Phone</label>
                  <input style={inp} value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Role</label>
                  <input style={inp} value={form.role} onChange={e => set('role', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Trade</label>
                  <input style={inp} value={form.trade} onChange={e => set('trade', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Access Card</label>
                  <input style={inp} value={form.access_card} onChange={e => set('access_card', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Induction Date</label>
                  <input style={inp} type="date" value={form.induction_date} onChange={e => set('induction_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Medical Expiry</label>
                  <input style={{ ...inp, borderColor: EXPIRY_COLORS[expiryStatus(form.medical_expiry)].border }}
                    type="date" value={form.medical_expiry} onChange={e => set('medical_expiry', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Accommodation ID</label>
                  <input style={inp} value={form.accommodation_id} onChange={e => set('accommodation_id', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '8px', marginTop: '22px' }}>
                  <input type="checkbox" checked={form.ppe_issued} onChange={e => set('ppe_issued', e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: color }} />
                  <label style={{ fontSize: '13px', color: THEME.text, cursor: 'pointer' }} onClick={() => set('ppe_issued', !form.ppe_issued)}>PPE Issued</label>
                </div>
                <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" checked={form.meals_authorised} onChange={e => set('meals_authorised', e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: color }} />
                  <label style={{ fontSize: '13px', color: THEME.text, cursor: 'pointer' }} onClick={() => set('meals_authorised', !form.meals_authorised)}>Meals Authorised</label>
                </div>
                <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" checked={form.fuel_authorised} onChange={e => set('fuel_authorised', e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: color }} />
                  <label style={{ fontSize: '13px', color: THEME.text, cursor: 'pointer' }} onClick={() => set('fuel_authorised', !form.fuel_authorised)}>Fuel Authorised</label>
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                {editId && can('contractors.delete') && (
                  <button onClick={handleArchive} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Archive
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setModalOpen(false)} style={{
                  padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff',
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
                }}>
                  {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setImportOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '560px', maxWidth: '95vw',
            maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>Import from HR</div>
                <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                  HR employees already linked to a contractor company, not yet in this registry.
                </div>
              </div>
              <button onClick={() => setImportOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
              {importCandidates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '30px', color: THEME.textLow, fontSize: '13px' }}>
                  No unimported HR employees found for this site.
                </div>
              ) : (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, color: THEME.text }}>
                    <input
                      type="checkbox"
                      checked={importCandidates.length > 0 && importCandidates.every(e => importSelected[e.id])}
                      onChange={e => {
                        const all = {}
                        if (e.target.checked) importCandidates.forEach(c => { all[c.id] = true })
                        setImportSelected(all)
                      }}
                      style={{ width: '16px', height: '16px', accentColor: color }}
                    />
                    Select all ({importCandidates.length})
                  </label>
                  {importCandidates.map(e => (
                    <label key={e.id} style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0',
                      borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer',
                    }}>
                      <input
                        type="checkbox"
                        checked={!!importSelected[e.id]}
                        onChange={ev => setImportSelected(s => ({ ...s, [e.id]: ev.target.checked }))}
                        style={{ width: '16px', height: '16px', accentColor: color, flexShrink: 0 }}
                      />
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{e.name}</div>
                        <div style={{ fontSize: '11px', color: THEME.textMed }}>
                          {contractors.find(c => c.id === e.contractor_id)?.name || 'Unknown contractor'}
                          {e.position_title ? ` · ${e.position_title}` : ''}
                        </div>
                      </div>
                    </label>
                  ))}
                </>
              )}
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={() => setImportOpen(false)} style={{
                padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: THEME.surfaceVar, color: THEME.textMed,
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing || Object.values(importSelected).every(v => !v)}
                style={{
                  padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff', border: 'none',
                  cursor: importing ? 'not-allowed' : 'pointer',
                  opacity: importing || Object.values(importSelected).every(v => !v) ? 0.6 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {importing ? 'Importing...' : 'Import Selected'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
