import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const CATEGORIES = {
  workplace: 'Workplace', electrical: 'Electrical', fire: 'Fire Safety', scaffold: 'Scaffold',
  excavation: 'Excavation', crane: 'Crane/Lifting', vehicle: 'Vehicle', housekeeping: 'Housekeeping',
  environmental: 'Environmental', ppe: 'PPE', chemical: 'Chemical Storage',
  confined_space: 'Confined Space', working_at_height: 'Working at Height',
  general: 'General', other: 'Other',
}

const FREQUENCIES = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', annually: 'Annually', ad_hoc: 'Ad Hoc',
}

const RESPONSE_TYPES = {
  yes_no: 'Yes / No', ok_nok: 'OK / Not OK', rating: 'Rating (1-5)', text: 'Text', numeric: 'Numeric',
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }

function Field({ label, children, required }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}{required && <span style={{ color: THEME.error }}> *</span>}
      </div>
      {children}
    </div>
  )
}

function TemplateModal({ template, siteId, userId, onClose, onSaved }) {
  const isEdit = !!template
  const [form, setForm] = useState(() => {
    if (template) return {
      name: template.name || '', category: template.category || '',
      description: template.description || '', frequency: template.frequency || '',
      is_active: template.is_active !== false,
    }
    return { name: '', category: '', description: '', frequency: '', is_active: true }
  })
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  useEffect(() => {
    if (isEdit) {
      supabase.from('sheq_template_items').select('*').eq('template_id', template.id).order('sort_order')
        .then(({ data }) => setItems(data || []))
    }
  }, [])

  function addItem() {
    setItems(prev => [...prev, { id: crypto.randomUUID(), sort_order: prev.length, section: '', question: '', response_type: 'yes_no', is_critical: false, guidance: '', _new: true }])
  }

  function updateItem(idx, k, v) {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [k]: v } : it))
  }

  function removeItem(idx) { setItems(prev => prev.filter((_, i) => i !== idx)) }

  async function handleSave() {
    if (!form.name || !form.category) { showToast('Name and category are required', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name, category: form.category, description: form.description || null,
        frequency: form.frequency || null, is_active: form.is_active,
      }
      let templateId
      if (isEdit) {
        const { error } = await supabase.from('sheq_inspection_templates').update(payload).eq('id', template.id).eq('site_id', siteId)
        if (error) throw error
        templateId = template.id
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'TPL', p_table: 'sheq_inspection_templates' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.template_code = num
        payload.created_by = userId
        const { data, error } = await supabase.from('sheq_inspection_templates').insert(payload).select('id').single()
        if (error) throw error
        templateId = data.id
      }

      if (isEdit) {
        await supabase.from('sheq_template_items').delete().eq('template_id', templateId)
      }
      if (items.length > 0) {
        const itemPayload = items.map((it, i) => ({
          template_id: templateId, sort_order: i, section: it.section || null,
          question: it.question, response_type: it.response_type,
          is_critical: it.is_critical, guidance: it.guidance || null,
        })).filter(it => it.question)
        if (itemPayload.length > 0) {
          const { error } = await supabase.from('sheq_template_items').insert(itemPayload)
          if (error) throw error
        }
      }
      showToast(isEdit ? 'Template updated' : `Template ${payload.template_code || ''} created`)
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '700px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${template.template_code}` : 'New Inspection Template'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Name" required><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Template name" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Category" required>
              <select style={selectStyle} value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="">Select...</option>
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Frequency">
              <select style={selectStyle} value={form.frequency} onChange={e => set('frequency', e.target.value)}>
                <option value="">Select...</option>
                {Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Active">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: THEME.text, paddingTop: '8px' }}>
                <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} /> Active
              </label>
            </Field>
          </div>
          <Field label="Description"><input style={inputStyle} value={form.description} onChange={e => set('description', e.target.value)} /></Field>

          <SectionLabel>Checklist Items</SectionLabel>
          {items.map((it, idx) => (
            <div key={it.id || idx} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '10px', background: THEME.surfaceVar, borderRadius: '10px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.textMed, minWidth: '24px', paddingTop: '10px' }}>{idx + 1}</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <input style={inputStyle} placeholder="Section (optional)" value={it.section || ''} onChange={e => updateItem(idx, 'section', e.target.value)} />
                  <select style={selectStyle} value={it.response_type} onChange={e => updateItem(idx, 'response_type', e.target.value)}>
                    {Object.entries(RESPONSE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <input style={inputStyle} placeholder="Question *" value={it.question} onChange={e => updateItem(idx, 'question', e.target.value)} />
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: THEME.textMed, cursor: 'pointer' }}>
                    <input type="checkbox" checked={it.is_critical} onChange={e => updateItem(idx, 'is_critical', e.target.checked)} /> Critical
                  </label>
                  <input style={{ ...inputStyle, flex: 1 }} placeholder="Guidance (optional)" value={it.guidance || ''} onChange={e => updateItem(idx, 'guidance', e.target.value)} />
                </div>
              </div>
              <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', marginTop: '6px' }}><Icon name="delete" size={16} style={{ color: '#D32F2F' }} /></button>
            </div>
          ))}
          <Button variant="ghost" onClick={addItem} style={{ alignSelf: 'flex-start' }}><Icon name="add" size={16} /> Add Item</Button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqTemplates({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_inspection_templates', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('sheq_inspection_templates')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('name')
    if (error) showToast(error.message, 'error')
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId, rt])

  const filtered = rows.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return (r.template_code || '').toLowerCase().includes(s) || (r.name || '').toLowerCase().includes(s)
  })

  async function handleArchive(r) {
    if (!confirm(`Archive template ${r.template_code}?`)) return
    const { error } = await supabase.from('sheq_inspection_templates').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view inspection templates.</div>

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_templates" />
      <PageHeader title="Inspection Templates" subtitle={`${rows.length} templates`} icon="list_alt" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search templates..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {can('sheq.create') && <Button style={{ background: ACCENT, color: '#fff' }} onClick={() => setModal('new')}><Icon name="add" size={16} style={{ color: '#fff' }} /> New Template</Button>}
      </div>

      <Card style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Code', 'Name', 'Category', 'Frequency', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No templates found</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.template_code}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.name}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{CATEGORIES[r.category] || r.category}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{FREQUENCIES[r.frequency] || r.frequency || '--'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: r.is_active ? '#E8F5E9' : '#FFEBEE', color: r.is_active ? '#2E7D32' : '#D32F2F' }}>
                      {r.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {can('sheq.edit') && <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                      {can('sheq.delete') && <button onClick={() => handleArchive(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="archive" size={16} style={{ color: THEME.textMed }} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <TemplateModal
          template={modal === 'new' ? null : modal}
          siteId={currentSiteId} userId={user?.id}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
