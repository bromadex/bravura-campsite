import { useState, useMemo } from 'react'
import { useProcurement } from '../../contexts/ProcurementContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import QuickNav, { PROCUREMENT_PILLS } from '../../components/QuickNav'

const CLR = MODULE_COLORS.procurement

export default function Suppliers({ setPage }) {
  const { suppliers, fetchAll } = useProcurement()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const { can } = usePermissions()

  const [search, setSearch]       = useState('')
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')

  const blank = { supplier_name: '', contact_person: '', phone: '', email: '', address: '', category: '', notes: '' }
  const [form, setForm] = useState(blank)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return suppliers
      .filter(s => s.status === 'active')
      .filter(s =>
        !q ||
        s.supplier_name?.toLowerCase().includes(q) ||
        s.contact_person?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q)
      )
  }, [suppliers, search])

  function openNew() {
    setForm(blank)
    setEditing(null)
    setError('')
    setShowForm(true)
  }

  function openEdit(s) {
    setForm({
      supplier_name:  s.supplier_name || '',
      contact_person: s.contact_person || '',
      phone:          s.phone || '',
      email:          s.email || '',
      address:        s.address || '',
      category:       s.category || '',
      notes:          s.notes || '',
    })
    setEditing(s)
    setError('')
    setShowForm(true)
  }

  async function save() {
    if (!form.supplier_name.trim()) { setError('Supplier name is required'); return }
    setSaving(true)
    setError('')

    if (editing) {
      const { error: err } = await supabase
        .from('procurement_suppliers')
        .update({ ...form, updated_at: new Date().toISOString() })
        .eq('id', editing.id)
        .eq('site_id', currentSiteId)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase
        .from('procurement_suppliers')
        .insert([{ ...form, site_id: currentSiteId, created_by: user?.id || null }])
      if (err) { setError(err.message); setSaving(false); return }
    }

    setSaving(false)
    setShowForm(false)
    fetchAll()
  }

  async function deactivate(s) {
    if (!confirm(`Deactivate "${s.supplier_name}"?`)) return
    await supabase
      .from('procurement_suppliers')
      .update({ status: 'inactive', updated_at: new Date().toISOString() })
      .eq('id', s.id)
      .eq('site_id', currentSiteId)
    fetchAll()
  }

  const canCreate = can('procurement.create')
  const canEdit   = can('procurement.edit')

  // ── Styles ──
  const card = {
    background: THEME.surface,
    borderRadius: '12px',
    border: `1px solid ${THEME.outlineVar}`,
    overflow: 'hidden',
  }
  const thStyle = {
    padding: '10px 14px', textAlign: 'left', fontSize: '11px',
    fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase',
    letterSpacing: '.04em', borderBottom: `1px solid ${THEME.outlineVar}`,
    background: THEME.surfaceVar,
  }
  const tdStyle = {
    padding: '10px 14px', fontSize: '13px', color: THEME.text,
    borderBottom: `1px solid ${THEME.outlineVar}`,
  }
  const inputStyle = {
    width: '100%', padding: '8px 12px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px',
    background: THEME.surface, color: THEME.text,
    fontFamily: 'inherit', outline: 'none',
  }
  const btnPrimary = {
    padding: '8px 20px', fontSize: '13px', fontWeight: 600,
    background: CLR, color: '#fff', border: 'none',
    borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit',
  }
  const btnSecondary = {
    padding: '8px 20px', fontSize: '13px', fontWeight: 600,
    background: 'transparent', color: THEME.textMed,
    border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px',
    cursor: 'pointer', fontFamily: 'inherit',
  }

  return (
    <div style={{ padding: '24px', fontFamily: "'Google Sans','Segoe UI',Arial,sans-serif" }}>
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_suppliers" />
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Suppliers</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>
            {filtered.length} active supplier{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <span className="material-symbols-rounded" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '18px', color: THEME.textLow }}>search</span>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search suppliers..."
              style={{ ...inputStyle, paddingLeft: '34px', width: '220px' }}
            />
          </div>
          {canCreate && (
            <button onClick={openNew} style={btnPrimary}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
                Add Supplier
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div style={card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Supplier Name</th>
                <th style={thStyle}>Contact Person</th>
                <th style={thStyle}>Phone</th>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Category</th>
                {canEdit && <th style={{ ...thStyle, width: '100px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={canEdit ? 6 : 5} style={{ ...tdStyle, textAlign: 'center', padding: '40px', color: THEME.textLow }}>
                  {search ? 'No suppliers match your search' : 'No suppliers yet. Add your first supplier to get started.'}
                </td></tr>
              ) : filtered.map(s => (
                <tr key={s.id} style={{ cursor: canEdit ? 'pointer' : 'default' }}
                  onMouseEnter={e => { e.currentTarget.style.background = THEME.surfaceHover }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{s.supplier_name}</td>
                  <td style={tdStyle}>{s.contact_person || '—'}</td>
                  <td style={tdStyle}>{s.phone || '—'}</td>
                  <td style={tdStyle}>{s.email || '—'}</td>
                  <td style={tdStyle}>
                    {s.category ? (
                      <span style={{ padding: '2px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: CLR + '18', color: CLR }}>{s.category}</span>
                    ) : '—'}
                  </td>
                  {canEdit && (
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => openEdit(s)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', color: THEME.textMed }}>
                          <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>edit</span>
                        </button>
                        <button onClick={() => deactivate(s)} title="Deactivate" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', color: THEME.error }}>
                          <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>block</span>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add/Edit Modal ── */}
      {showForm && (
        <>
          <div onClick={() => setShowForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 900 }} />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            background: THEME.surface, borderRadius: '14px', width: '480px', maxWidth: '95vw',
            maxHeight: '90vh', overflowY: 'auto', zIndex: 901,
            boxShadow: '0 20px 60px rgba(0,0,0,.25)',
          }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
              <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 600, color: THEME.text }}>
                {editing ? 'Edit Supplier' : 'Add Supplier'}
              </h3>
            </div>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {error && <div style={{ padding: '8px 12px', borderRadius: '8px', background: THEME.statusErrorBg, color: THEME.statusErrorText, fontSize: '12px' }}>{error}</div>}

              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Supplier Name *</label>
                <input value={form.supplier_name} onChange={e => setForm(f => ({ ...f, supplier_name: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Contact Person</label>
                <input value={form.contact_person} onChange={e => setForm(f => ({ ...f, contact_person: e.target.value }))} style={inputStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Phone</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Email</label>
                  <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} style={inputStyle} type="email" />
                </div>
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Address</label>
                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Category</label>
                <input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="e.g. Fuel, General, Construction" style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }}>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button onClick={() => setShowForm(false)} style={btnSecondary}>Cancel</button>
              <button onClick={save} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : editing ? 'Update' : 'Add Supplier'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
