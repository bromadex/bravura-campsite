import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'

export default function DeptSettings({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', icon: 'domain', color: '#1565C0' })
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const { data } = await supabase.from('departments').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('name')
    setDepartments(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  async function handleSave() {
    if (!form.name.trim() || !form.code.trim()) return
    setSaving(true)
    const payload = { ...form, site_id: currentSiteId }
    if (editId) {
      await supabase.from('departments').update(payload).eq('id', editId)
    } else {
      await supabase.from('departments').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    setEditId(null)
    setForm({ name: '', code: '', icon: 'domain', color: '#1565C0' })
    load()
  }

  async function handleArchive(id) {
    await supabase.from('departments').update({ is_archived: true }).eq('id', id)
    load()
  }

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', background: THEME.surface, color: THEME.text, width: '100%' }

  return (
    <div style={{ padding: '24px', maxWidth: '800px' }}>
      <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, marginBottom: '20px' }}>Department Settings</div>

      {can('dept.edit') && (
        <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', code: '', icon: 'domain', color: '#1565C0' }) }}
          style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="add" size={16} style={{ color: '#fff' }} /> Add Department
        </button>
      )}

      {showForm && (
        <div style={{ background: THEME.surface, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>{editId ? 'Edit' : 'New'} Department</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <input placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} />
            <input placeholder="Code (e.g. ELEC)" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} style={inp} />
            <input placeholder="Icon (Material)" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} style={inp} />
            <input type="color" value={form.color} onChange={e => setForm({ ...form, color: e.target.value })} style={{ ...inp, height: '38px', padding: '4px' }} />
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowForm(false); setEditId(null) }} style={{ padding: '7px 16px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
      ) : departments.length === 0 ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '20px', textAlign: 'center' }}>No departments configured yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {departments.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: THEME.surface, borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: (d.color || color) + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={d.icon || 'domain'} size={18} style={{ color: d.color || color }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{d.name}</div>
                <div style={{ fontSize: '11px', color: THEME.textLow }}>{d.code}</div>
              </div>
              {can('dept.edit') && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => { setForm({ name: d.name, code: d.code, icon: d.icon || 'domain', color: d.color || '#1565C0' }); setEditId(d.id); setShowForm(true) }}
                    style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textMed, fontSize: '11px', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => handleArchive(d.id)}
                    style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textLow, fontSize: '11px', cursor: 'pointer' }}>Archive</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
