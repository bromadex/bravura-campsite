import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, Modal, SectionLabel, StatusBadge, PageHeader, showToast } from '../../components/ui'

const ACCENT = MODULE_COLORS.inventory

const EMPTY = {
  item_code: '', description: '', category_id: '', uom_id: '',
  brand: '', manufacturer: '', part_number: '', barcode: '',
  min_stock: '', max_stock: '', reorder_level: '', reorder_qty: '',
  standard_cost: '', location: '', photo_url: '', status: 'active',
}

export default function InvItems() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()

  const [items, setItems] = useState([])
  const [categories, setCategories] = useState([])
  const [uoms, setUoms] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    setLoading(true)
    try {
      const [itemRes, catRes, uomRes] = await Promise.all([
        supabase.from('items').select('*, category:item_categories!items_category_id_fkey(id, name), uom:units_of_measure!items_uom_id_fkey(id, name, abbreviation)').order('item_code'),
        supabase.from('item_categories').select('id, name').order('name'),
        supabase.from('units_of_measure').select('id, name, abbreviation').order('name'),
      ])
      if (itemRes.error) throw itemRes.error
      setItems(itemRes.data || [])
      setCategories(catRes.data || [])
      setUoms(uomRes.data || [])
    } catch (err) {
      console.error('InvItems fetch:', err)
      showToast('Failed to load items', 'red')
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  const filtered = useMemo(() => {
    let list = items
    if (!showArchived) list = list.filter(i => !i.is_archived)
    if (catFilter) list = list.filter(i => i.category_id === catFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        i.item_code?.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) ||
        i.brand?.toLowerCase().includes(q) ||
        i.part_number?.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, search, catFilter, showArchived])

  function openNew() {
    setEditId(null)
    setForm(EMPTY)
    setModal(true)
  }

  function openEdit(item) {
    setEditId(item.id)
    setForm({
      item_code: item.item_code || '',
      description: item.description || '',
      category_id: item.category_id || '',
      uom_id: item.uom_id || '',
      brand: item.brand || '',
      manufacturer: item.manufacturer || '',
      part_number: item.part_number || '',
      barcode: item.barcode || '',
      min_stock: item.min_stock ?? '',
      max_stock: item.max_stock ?? '',
      reorder_level: item.reorder_level ?? '',
      reorder_qty: item.reorder_qty ?? '',
      standard_cost: item.standard_cost ?? '',
      location: item.location || '',
      photo_url: item.photo_url || '',
      status: item.status || 'active',
    })
    setModal(true)
  }

  async function save() {
    if (!form.description.trim()) { showToast('Description is required', 'red'); return }
    setSaving(true)
    try {
      const row = {
        description: form.description.trim(),
        category_id: form.category_id || null,
        uom_id: form.uom_id || null,
        brand: form.brand.trim() || null,
        manufacturer: form.manufacturer.trim() || null,
        part_number: form.part_number.trim() || null,
        barcode: form.barcode.trim() || null,
        min_stock: form.min_stock !== '' ? parseFloat(form.min_stock) : null,
        max_stock: form.max_stock !== '' ? parseFloat(form.max_stock) : null,
        reorder_level: form.reorder_level !== '' ? parseFloat(form.reorder_level) : null,
        reorder_qty: form.reorder_qty !== '' ? parseFloat(form.reorder_qty) : null,
        standard_cost: form.standard_cost !== '' ? parseFloat(form.standard_cost) : null,
        location: form.location.trim() || null,
        photo_url: form.photo_url.trim() || null,
        status: form.status,
      }
      if (editId) {
        if (form.item_code.trim()) row.item_code = form.item_code.trim()
        const { error } = await supabase.from('items').update(row).eq('id', editId)
        if (error) throw error
        showToast('Item updated', 'green')
      } else {
        const nextCode = await generateCode()
        row.item_code = form.item_code.trim() || nextCode
        const { error } = await supabase.from('items').insert(row)
        if (error) throw error
        showToast('Item created', 'green')
      }
      setModal(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function generateCode() {
    const { data } = await supabase.from('items').select('item_code').like('item_code', 'ITM-%').order('item_code', { ascending: false }).limit(1)
    if (data && data.length > 0) {
      const num = parseInt(data[0].item_code.replace('ITM-', ''), 10) || 0
      return `ITM-${String(num + 1).padStart(4, '0')}`
    }
    return 'ITM-0001'
  }

  async function toggleArchive(item) {
    const { error } = await supabase.from('items').update({ is_archived: !item.is_archived }).eq('id', item.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast(item.is_archived ? 'Item restored' : 'Item archived', 'green')
    fetch()
  }

  function handleExport() {
    const headers = ['Code', 'Description', 'Category', 'UoM', 'Brand', 'Part #', 'Reorder Level', 'Location', 'Status']
    const rows = filtered.map(i => [
      i.item_code, i.description, i.category?.name || '', i.uom?.abbreviation || '',
      i.brand || '', i.part_number || '', i.reorder_level ?? '', i.location || '', i.status,
    ])
    exportCsv('items_catalogue.csv', headers, rows)
  }

  if (!can('inventory.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>You don't have permission to view inventory.</div>
      </Card>
    )
  }

  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  return (
    <div>
      <PageHeader title="Items" actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          {can('inventory.edit') && <Button icon="download" onClick={handleExport}>Export</Button>}
          {can('inventory.create') && <Button icon="add" variant="filled" onClick={openNew}>New Item</Button>}
        </div>
      } />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '280px' }} />
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
          style={{ ...inp, maxWidth: '200px' }}>
          <option value="">All categories</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
        </label>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} items</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Code', 'Description', 'Category', 'UoM', 'Brand', 'Reorder Lvl', 'Location', 'Status', ''].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
                  {search || catFilter ? 'No items match your filters' : 'No items yet — create your first item'}
                </td></tr>
              ) : filtered.map(i => (
                <tr key={i.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, opacity: i.is_archived ? 0.5 : 1 }}>
                  <td style={{ padding: '8px 10px', color: ACCENT, fontWeight: 600, fontFamily: 'monospace', fontSize: '12px' }}>{i.item_code}</td>
                  <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 500 }}>{i.description}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{i.category?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{i.uom?.abbreviation || i.uom?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{i.brand || '—'}</td>
                  <td style={{ padding: '8px 10px', color: i.reorder_level ? THEME.text : THEME.textLow }}>{i.reorder_level ?? '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{i.location || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <StatusBadge status={i.is_archived ? 'archived' : i.status} />
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {can('inventory.edit') && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => openEdit(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                          <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                        </button>
                        <button onClick={() => toggleArchive(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                          <Icon name={i.is_archived ? 'unarchive' : 'archive'} size={16} style={{ color: i.is_archived ? THEME.success : THEME.error }} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Item' : 'New Item'}
        footer={<>
          <Button variant="text" onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={save} disabled={saving}>{saving ? 'Saving...' : editId ? 'Update' : 'Create'}</Button>
        </>}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <SectionLabel>Item Code</SectionLabel>
            <input value={form.item_code} onChange={e => setForm({ ...form, item_code: e.target.value })}
              placeholder="Auto-generated if blank" style={inp} />
          </div>
          <div>
            <SectionLabel>Status</SectionLabel>
            <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} style={inp}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <SectionLabel>Description *</SectionLabel>
            <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Category</SectionLabel>
            <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })} style={inp}>
              <option value="">— None —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Unit of Measure</SectionLabel>
            <select value={form.uom_id} onChange={e => setForm({ ...form, uom_id: e.target.value })} style={inp}>
              <option value="">— None —</option>
              {uoms.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Brand</SectionLabel>
            <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Manufacturer</SectionLabel>
            <input value={form.manufacturer} onChange={e => setForm({ ...form, manufacturer: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Part Number</SectionLabel>
            <input value={form.part_number} onChange={e => setForm({ ...form, part_number: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Barcode</SectionLabel>
            <input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Reorder Level</SectionLabel>
            <input type="number" min="0" value={form.reorder_level} onChange={e => setForm({ ...form, reorder_level: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Reorder Qty</SectionLabel>
            <input type="number" min="0" value={form.reorder_qty} onChange={e => setForm({ ...form, reorder_qty: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Min Stock</SectionLabel>
            <input type="number" min="0" value={form.min_stock} onChange={e => setForm({ ...form, min_stock: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Max Stock</SectionLabel>
            <input type="number" min="0" value={form.max_stock} onChange={e => setForm({ ...form, max_stock: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Standard Cost</SectionLabel>
            <input type="number" min="0" step="0.01" value={form.standard_cost} onChange={e => setForm({ ...form, standard_cost: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Location</SectionLabel>
            <input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. Shelf A3" style={inp} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <SectionLabel>Photo URL</SectionLabel>
            <input value={form.photo_url} onChange={e => setForm({ ...form, photo_url: e.target.value })} style={inp} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
