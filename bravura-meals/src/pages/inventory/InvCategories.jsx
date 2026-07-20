import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.inventory

export default function InvCategories({ setPage }) {
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('item_categories', null)
  const [tab, setTab] = useState('categories')
  const [categories, setCategories] = useState([])
  const [uoms, setUoms] = useState([])
  const [loading, setLoading] = useState(true)

  const [catModal, setCatModal] = useState(false)
  const [catForm, setCatForm] = useState({ name: '', parent_id: '' })
  const [catEditId, setCatEditId] = useState(null)

  const [uomModal, setUomModal] = useState(false)
  const [uomForm, setUomForm] = useState({ name: '', abbreviation: '' })
  const [uomEditId, setUomEditId] = useState(null)

  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const [catRes, uomRes] = await Promise.all([
        supabase.from('item_categories').select('*').order('name'),
        supabase.from('units_of_measure').select('*').order('name'),
      ])
      if (catRes.error) throw catRes.error
      if (uomRes.error) throw uomRes.error
      setCategories(catRes.data || [])
      setUoms(uomRes.data || [])
    } catch (err) {
      showToast('Failed to load data', 'red')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch, rt])

  function openCatNew() { setCatEditId(null); setCatForm({ name: '', parent_id: '' }); setCatModal(true) }
  function openCatEdit(c) { setCatEditId(c.id); setCatForm({ name: c.name, parent_id: c.parent_id || '' }); setCatModal(true) }

  async function saveCat() {
    if (!catForm.name.trim()) { showToast('Name required', 'red'); return }
    setSaving(true)
    try {
      const row = { name: catForm.name.trim(), parent_id: catForm.parent_id || null }
      if (catEditId) {
        const { error } = await supabase.from('item_categories').update(row).eq('id', catEditId)
        if (error) throw error
        showToast('Category updated', 'green')
      } else {
        const { error } = await supabase.from('item_categories').insert(row)
        if (error) throw error
        showToast('Category created', 'green')
      }
      setCatModal(false); fetch()
    } catch (err) { showToast(err.message, 'red') }
    setSaving(false)
  }

  function openUomNew() { setUomEditId(null); setUomForm({ name: '', abbreviation: '' }); setUomModal(true) }
  function openUomEdit(u) { setUomEditId(u.id); setUomForm({ name: u.name, abbreviation: u.abbreviation || '' }); setUomModal(true) }

  async function saveUom() {
    if (!uomForm.name.trim()) { showToast('Name required', 'red'); return }
    if (!uomForm.abbreviation.trim()) { showToast('Abbreviation required', 'red'); return }
    setSaving(true)
    try {
      const row = { name: uomForm.name.trim(), abbreviation: uomForm.abbreviation.trim() }
      if (uomEditId) {
        const { error } = await supabase.from('units_of_measure').update(row).eq('id', uomEditId)
        if (error) throw error
        showToast('UoM updated', 'green')
      } else {
        const { error } = await supabase.from('units_of_measure').insert(row)
        if (error) throw error
        showToast('UoM created', 'green')
      }
      setUomModal(false); fetch()
    } catch (err) { showToast(err.message, 'red') }
    setSaving(false)
  }

  if (!can('inventory.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div>
      </Card>
    )
  }

  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  const catMap = Object.fromEntries(categories.map(c => [c.id, c.name]))

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_categories" />
      <PageHeader title="Categories & Units of Measure" actions={
        can('inventory.create') && (
          <Button icon="add" variant="filled" onClick={tab === 'categories' ? openCatNew : openUomNew}>
            {tab === 'categories' ? 'New Category' : 'New UoM'}
          </Button>
        )
      } />

      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px' }}>
        {[['categories', 'Categories'], ['uom', 'Units of Measure']].map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
            cursor: 'pointer', fontFamily: 'inherit',
            border: `1px solid ${tab === v ? ACCENT : THEME.outline}`,
            background: tab === v ? ACCENT + '15' : 'transparent',
            color: tab === v ? ACCENT : THEME.textMed,
          }}>{l}</button>
        ))}
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : tab === 'categories' ? (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr>
              {['Name', 'Parent', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {categories.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No categories yet</td></tr>
              ) : categories.map(c => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 500 }}>{c.name}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{c.parent_id ? catMap[c.parent_id] || '—' : '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {can('inventory.edit') && (
                      <button onClick={() => openCatEdit(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr>
              {['Name', 'Abbreviation', ''].map(h => <th key={h} style={th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {uoms.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No units yet</td></tr>
              ) : uoms.map(u => (
                <tr key={u.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 500 }}>{u.name}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontFamily: 'monospace' }}>{u.abbreviation}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {can('inventory.edit') && (
                      <button onClick={() => openUomEdit(u)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                        <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Category modal */}
      <Modal dirty={true} open={catModal} onClose={() => setCatModal(false)} title={catEditId ? 'Edit Category' : 'New Category'}
        footer={<>
          <Button variant="text" onClick={() => setCatModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={saveCat} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input value={catForm.name} onChange={e => setCatForm({ ...catForm, name: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Parent Category</SectionLabel>
            <select value={catForm.parent_id} onChange={e => setCatForm({ ...catForm, parent_id: e.target.value })} style={inp}>
              <option value="">— None (top-level) —</option>
              {categories.filter(c => c.id !== catEditId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      {/* UoM modal */}
      <Modal dirty={true} open={uomModal} onClose={() => setUomModal(false)} title={uomEditId ? 'Edit Unit of Measure' : 'New Unit of Measure'}
        footer={<>
          <Button variant="text" onClick={() => setUomModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={saveUom} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input value={uomForm.name} onChange={e => setUomForm({ ...uomForm, name: e.target.value })} placeholder="e.g. Kilograms" style={inp} />
          </div>
          <div>
            <SectionLabel>Abbreviation *</SectionLabel>
            <input value={uomForm.abbreviation} onChange={e => setUomForm({ ...uomForm, abbreviation: e.target.value })} placeholder="e.g. kg" style={inp} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
