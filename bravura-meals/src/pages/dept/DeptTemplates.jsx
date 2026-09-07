import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'
const DEFAULT_BUCKETS = ['Initiating', 'Planning', 'Executing', 'Monitoring & Controlling', 'Closing']

export default function DeptTemplates({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [templates, setTemplates] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', department_id: '', default_buckets: DEFAULT_BUCKETS, template_tasks: [] })
  const [saving, setSaving] = useState(false)
  const [newTask, setNewTask] = useState('')
  const [newBucket, setNewBucket] = useState('')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [tRes, dRes] = await Promise.all([
      supabase.from('dept_project_templates').select('*, department:departments(id, name, color)').eq('is_archived', false).order('name'),
      supabase.from('departments').select('id, name, color').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
    ])
    setTemplates((tRes.data || []).filter(t => {
      const dept = departments.length ? departments : dRes.data || []
      return dept.some(d => d.id === t.department_id)
    }))
    setTemplates(tRes.data || [])
    setDepartments(dRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  async function handleSave() {
    if (!form.name.trim() || !form.department_id) return
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      department_id: form.department_id,
      default_buckets: form.default_buckets,
      template_tasks: form.template_tasks,
    }
    if (editId) {
      await supabase.from('dept_project_templates').update(payload).eq('id', editId)
    } else {
      await supabase.from('dept_project_templates').insert(payload)
    }
    setSaving(false)
    resetForm()
    load()
  }

  function resetForm() {
    setShowForm(false)
    setEditId(null)
    setForm({ name: '', description: '', department_id: '', default_buckets: DEFAULT_BUCKETS, template_tasks: [] })
  }

  function addTemplateTask() {
    if (!newTask.trim()) return
    setForm(f => ({ ...f, template_tasks: [...f.template_tasks, { title: newTask.trim(), bucket: f.default_buckets[0] || 'Initiating', priority: 'medium' }] }))
    setNewTask('')
  }

  function removeTemplateTask(idx) {
    setForm(f => ({ ...f, template_tasks: f.template_tasks.filter((_, i) => i !== idx) }))
  }

  function addBucket() {
    if (!newBucket.trim() || form.default_buckets.includes(newBucket.trim())) return
    setForm(f => ({ ...f, default_buckets: [...f.default_buckets, newBucket.trim()] }))
    setNewBucket('')
  }

  function removeBucket(idx) {
    setForm(f => ({ ...f, default_buckets: f.default_buckets.filter((_, i) => i !== idx) }))
  }

  async function handleArchive(id) {
    await supabase.from('dept_project_templates').update({ is_archived: true }).eq('id', id)
    load()
  }

  async function handleUseTemplate(tpl) {
    if (!can('dept.create')) return
    const { data: proj } = await supabase.from('dept_projects').insert({
      name: `${tpl.name} — Copy`,
      department_id: tpl.department_id,
      site_id: currentSiteId,
      status: 'active',
    }).select().single()
    if (proj && tpl.template_tasks?.length) {
      const rows = tpl.template_tasks.map((t, i) => ({
        project_id: proj.id,
        title: t.title,
        bucket: t.bucket || (tpl.default_buckets?.[0] || 'Initiating'),
        priority: t.priority || 'medium',
        sort_order: i,
      }))
      await supabase.from('dept_tasks').insert(rows)
    }
    if (proj) setPage(`dept_board:${proj.id}`)
  }

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', background: THEME.surface, color: THEME.text, width: '100%' }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Project Templates</div>
        {can('dept.edit') && (
          <button onClick={() => { setShowForm(true); setEditId(null); setForm({ name: '', description: '', department_id: departments[0]?.id || '', default_buckets: DEFAULT_BUCKETS, template_tasks: [] }) }}
            style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="add" size={16} style={{ color: '#fff' }} /> New Template
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ background: THEME.surface, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>{editId ? 'Edit' : 'New'} Template</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <input placeholder="Template name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} />
            <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })} style={inp}>
              <option value="">Select department…</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <textarea placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} style={{ ...inp, marginBottom: '14px', resize: 'vertical' }} />

          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>Buckets</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
            {form.default_buckets.map((b, i) => (
              <span key={i} style={{ padding: '4px 10px', borderRadius: '6px', background: color + '18', color, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {b}
                <span onClick={() => removeBucket(i)} style={{ cursor: 'pointer', fontWeight: 700 }}>&times;</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
            <input placeholder="Add bucket" value={newBucket} onChange={e => setNewBucket(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBucket()} style={{ ...inp, flex: 1 }} />
            <button onClick={addBucket} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '12px', cursor: 'pointer' }}>Add</button>
          </div>

          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>Template Tasks</div>
          {form.template_tasks.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span style={{ fontSize: '12px', color: THEME.text, flex: 1 }}>{t.title}</span>
              <span style={{ fontSize: '11px', color: THEME.textLow }}>{t.bucket}</span>
              <span onClick={() => removeTemplateTask(i)} style={{ cursor: 'pointer', color: THEME.textLow, fontSize: '14px' }}>&times;</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
            <input placeholder="Task title" value={newTask} onChange={e => setNewTask(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTemplateTask()} style={{ ...inp, flex: 1 }} />
            <button onClick={addTemplateTask} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '12px', cursor: 'pointer' }}>Add</button>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button onClick={resetForm} style={{ padding: '7px 16px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px', cursor: 'pointer' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '7px 16px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading…</div>
      ) : templates.length === 0 ? (
        <div style={{ color: THEME.textLow, fontSize: '13px', padding: '40px', textAlign: 'center' }}>No templates yet. Create one to speed up project setup.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {templates.map(tpl => (
            <div key={tpl.id} style={{ background: THEME.surface, borderRadius: '14px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', borderTop: `3px solid ${tpl.department?.color || color}` }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>{tpl.name}</div>
              <div style={{ fontSize: '11px', color: tpl.department?.color || color, marginBottom: '6px' }}>{tpl.department?.name}</div>
              {tpl.description && <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>{tpl.description}</div>}
              <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '8px' }}>
                {tpl.default_buckets?.length || 0} buckets · {tpl.template_tasks?.length || 0} tasks
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {can('dept.create') && (
                  <button onClick={() => handleUseTemplate(tpl)}
                    style={{ padding: '5px 12px', borderRadius: '6px', border: 'none', background: color, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Icon name="rocket_launch" size={13} style={{ color: '#fff' }} /> Use
                  </button>
                )}
                {can('dept.edit') && (
                  <button onClick={() => { setForm({ name: tpl.name, description: tpl.description || '', department_id: tpl.department_id, default_buckets: tpl.default_buckets || DEFAULT_BUCKETS, template_tasks: tpl.template_tasks || [] }); setEditId(tpl.id); setShowForm(true) }}
                    style={{ padding: '5px 12px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textMed, fontSize: '11px', cursor: 'pointer' }}>Edit</button>
                )}
                {can('dept.edit') && (
                  <button onClick={() => handleArchive(tpl.id)}
                    style={{ padding: '5px 12px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, background: 'transparent', color: THEME.textLow, fontSize: '11px', cursor: 'pointer' }}>Archive</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
