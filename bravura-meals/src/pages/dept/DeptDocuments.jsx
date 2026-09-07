import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'
const CATEGORIES = ['SOP', 'Drawing', 'Report', 'Correspondence', 'General']
const CAT_ICON = { SOP: 'menu_book', Drawing: 'architecture', Report: 'summarize', Correspondence: 'mail', General: 'description' }
const CAT_CLR = { SOP: '#7C4DFF', Drawing: '#1E88E5', Report: '#2E7D32', Correspondence: '#D97706', General: '#78909C' }

export default function DeptDocuments({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const { user } = useAuth()
  const [documents, setDocuments] = useState([])
  const [departments, setDepartments] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', department_id: '', project_id: '', category: 'General', storage_path: '' })
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState('all')
  const [filterDept, setFilterDept] = useState('all')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [docRes, deptRes, projRes] = await Promise.all([
      supabase.from('dept_documents').select('*, department:departments(id, name, color), project:dept_projects(id, name)').eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('departments').select('*').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('dept_projects').select('id, name, department_id').eq('site_id', currentSiteId).eq('is_archived', false),
    ])
    setDocuments(docRes.data || [])
    setDepartments(deptRes.data || [])
    setProjects(projRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (!form.name.trim() || !form.department_id || !form.storage_path.trim()) return
    setSaving(true)
    await supabase.from('dept_documents').insert({
      ...form,
      project_id: form.project_id || null,
      uploaded_by: user?.id,
    })
    setSaving(false)
    setShowForm(false)
    setForm({ name: '', department_id: '', project_id: '', category: 'General', storage_path: '' })
    load()
  }

  async function handleArchive(id) {
    await supabase.from('dept_documents').update({ is_archived: true }).eq('id', id)
    load()
  }

  const filtered = documents.filter(d => {
    if (filterCat !== 'all' && d.category !== filterCat) return false
    if (filterDept !== 'all' && d.department_id !== filterDept) return false
    return true
  })

  const grouped = {}
  filtered.forEach(d => {
    const key = d.project?.name || 'Unlinked'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(d)
  })

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', background: THEME.surface, color: THEME.text, width: '100%' }

  return (
    <div style={{ padding: '24px', maxWidth: '1000px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Documents</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ ...inp, width: 'auto' }}>
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {can('dept.create') && (
            <button onClick={() => { setShowForm(true); setForm({ name: '', department_id: departments[0]?.id || '', project_id: '', category: 'General', storage_path: '' }) }}
              style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
              <Icon name="upload_file" size={16} style={{ color: '#fff' }} /> Add Document
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <div style={{ background: THEME.surface, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Add Document</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <input placeholder="Document name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} />
            <input placeholder="Storage path / URL" value={form.storage_path} onChange={e => setForm({ ...form, storage_path: e.target.value })} style={inp} />
            <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })} style={inp}>
              <option value="">Department…</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} style={inp}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={form.project_id} onChange={e => setForm({ ...form, project_id: e.target.value })} style={inp}>
              <option value="">No project</option>
              {projects.filter(p => !form.department_id || p.department_id === form.department_id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '14px', justifyContent: 'flex-end' }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '7px 16px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving || !form.name.trim()} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>No documents yet.</div>
      ) : (
        Object.entries(grouped).map(([group, docs]) => (
          <div key={group} style={{ marginBottom: '20px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', marginBottom: '8px', padding: '0 4px' }}>
              {group} ({docs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {docs.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', background: THEME.surface, borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: (CAT_CLR[d.category] || '#78909C') + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name={CAT_ICON[d.category] || 'description'} size={18} style={{ color: CAT_CLR[d.category] || '#78909C' }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                    <div style={{ fontSize: '11px', color: THEME.textLow, display: 'flex', gap: '8px' }}>
                      <span style={{ color: d.department?.color || color }}>{d.department?.name}</span>
                      <span>{d.category}</span>
                      <span>{new Date(d.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {d.storage_path && (
                    <a href={d.storage_path} target="_blank" rel="noopener noreferrer" style={{ color: color, fontSize: '12px', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="open_in_new" size={14} /> Open
                    </a>
                  )}
                  {can('dept.delete') && (
                    <button onClick={() => handleArchive(d.id)} style={{ padding: '4px 8px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textLow, fontSize: '11px', cursor: 'pointer' }}>Archive</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
