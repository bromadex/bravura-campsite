import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast, TableWrap, THead, Th, TRow, Td } from '../../components/ui'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.projects

const DISCIPLINES = ['Civil', 'Structural', 'Mechanical', 'Electrical', 'Piping', 'Instrumentation', 'Process', 'Architectural', 'HVAC', 'Fire Protection']

const COLORS = ['#1B5E20', '#0D47A1', '#BF360C', '#4A148C', '#006064', '#E65100', '#1A237E', '#880E4F', '#33691E', '#263238']

export default function PJAreas({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const rt = useRealtimeRefresh('area_codes', null)
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ code: '', name: '', description: '', discipline: '', color: '#1B5E20', sort_order: 0 })
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('area_codes').select('*').eq('is_active', true).order('sort_order').order('code')
      if (error) throw error
      setAreas(data || [])
    } catch (err) {
      showToast('Failed to load area codes', 'red')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch, rt])

  const filtered = useMemo(() => {
    if (!search) return areas
    const q = search.toLowerCase()
    return areas.filter(a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || (a.discipline || '').toLowerCase().includes(q))
  }, [areas, search])

  function openNew() {
    setEditId(null)
    setForm({ code: '', name: '', description: '', discipline: '', color: COLORS[areas.length % COLORS.length], sort_order: (areas.length + 1) * 10 })
    setModalOpen(true)
  }

  function openEdit(a) {
    setEditId(a.id)
    setForm({ code: a.code, name: a.name, description: a.description || '', discipline: a.discipline || '', color: a.color || '#1B5E20', sort_order: a.sort_order || 0 })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and name are required', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        discipline: form.discipline || null,
        color: form.color,
        sort_order: parseInt(form.sort_order) || 0,
      }
      if (editId) {
        const { error } = await supabase.from('area_codes').update(payload).eq('id', editId)
        if (error) throw error
        showToast('Area code updated', 'green')
      } else {
        const { error } = await supabase.from('area_codes').insert(payload)
        if (error) throw error
        showToast('Area code created', 'green')
      }
      setModalOpen(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function handleArchive(a) {
    if (!confirm(`Archive area code ${a.code}?`)) return
    const { error } = await supabase.from('area_codes').update({ is_active: false }).eq('id', a.id)
    if (error) showToast(error.message, 'red')
    else { showToast('Area code archived', 'green'); fetch() }
  }

  function handleExport() {
    exportCsv('area_codes.csv', ['Code', 'Name', 'Discipline', 'Description', 'Sort Order'],
      filtered.map(a => [a.code, a.name, a.discipline || '', a.description || '', a.sort_order]))
  }

  if (!can('projects.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  return (
    <div>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_areas" />
      <PageHeader title="Area Codes" site={currentSite} actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button icon="download" onClick={handleExport}>Export</Button>
          {can('projects.edit') && <Button icon="add" variant="filled" onClick={openNew}>Add Area Code</Button>}
        </div>
      } />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search areas..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '280px' }} />
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} area codes</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '48px' }}>
          <Icon name="location_city" size={40} style={{ color: THEME.outline }} />
          <div style={{ marginTop: '12px', color: THEME.textMed, fontSize: '14px' }}>No area codes yet. Add your first area code to get started.</div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px' }}>
          {filtered.map(a => (
            <Card key={a.id} style={{ padding: '0', overflow: 'hidden', cursor: 'pointer' }} onClick={() => can('projects.edit') && openEdit(a)}>
              <div style={{ height: '6px', background: a.color || color }} />
              <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: (a.color || color) + '18', color: a.color || color, fontWeight: 800, fontSize: '13px',
                  }}>{a.code}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>{a.name}</div>
                    {a.discipline && <div style={{ fontSize: '12px', color: THEME.textMed }}>{a.discipline}</div>}
                  </div>
                  {can('projects.edit') && (
                    <Button size="sm" onClick={e => { e.stopPropagation(); handleArchive(a) }} style={{ color: THEME.textLow, fontSize: '11px' }}>
                      <Icon name="archive" size={14} />
                    </Button>
                  )}
                </div>
                {a.description && <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.5 }}>{a.description}</div>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal dirty={true} open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Area Code' : 'Add Area Code'}
        footer={<>
          <Button variant="text" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="filled" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Code *</SectionLabel>
              <input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="A100" maxLength={10} style={{ ...inp, textTransform: 'uppercase' }} />
            </div>
            <div>
              <SectionLabel>Name *</SectionLabel>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Crushing & Screening" style={inp} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Discipline</SectionLabel>
              <select value={form.discipline} onChange={e => setForm({ ...form, discipline: e.target.value })} style={inp}>
                <option value="">— None —</option>
                {DISCIPLINES.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Sort Order</SectionLabel>
              <input type="number" value={form.sort_order} onChange={e => setForm({ ...form, sort_order: e.target.value })} style={inp} />
            </div>
          </div>
          <div>
            <SectionLabel>Color</SectionLabel>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {COLORS.map(c => (
                <div key={c} onClick={() => setForm({ ...form, color: c })} style={{
                  width: '28px', height: '28px', borderRadius: '8px', background: c, cursor: 'pointer',
                  border: form.color === c ? '3px solid ' + THEME.text : '2px solid transparent',
                }} />
              ))}
            </div>
          </div>
          <div>
            <SectionLabel>Description</SectionLabel>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical' }} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
