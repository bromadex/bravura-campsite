import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast } from '../../components/ui'

const ACCENT = MODULE_COLORS.inventory

export default function InvGrn() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const [movements, setMovements] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [whFilter, setWhFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [lines, setLines] = useState([{ item_id: '', qty: '', unit_cost: '' }])
  const [grnForm, setGrnForm] = useState({ warehouse_id: '', voucher_no: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [movRes, whRes, itemRes] = await Promise.all([
        supabase.from('inventory_movements')
          .select('*, item:items!inventory_movements_item_id_fkey(item_code, description), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name, site_id), creator:profiles!inventory_movements_created_by_fkey(full_name)')
          .eq('movement_type', 'grn')
          .not('warehouse', 'is', null)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('warehouses').select('id, name, code').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
      ])
      if (movRes.error) throw movRes.error
      setMovements((movRes.data || []).filter(m => m.warehouse?.site_id === currentSiteId))
      setWarehouses(whRes.data || [])
      setItems(itemRes.data || [])
    } catch (err) {
      console.error('InvGrn:', err)
      showToast('Failed to load GRN data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch])

  const filtered = useMemo(() => {
    let list = movements
    if (whFilter) list = list.filter(m => m.warehouse_id === whFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.item?.item_code?.toLowerCase().includes(q) ||
        m.item?.description?.toLowerCase().includes(q) ||
        (m.voucher_no || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [movements, search, whFilter])

  function addLine() {
    setLines([...lines, { item_id: '', qty: '', unit_cost: '' }])
  }

  function updateLine(i, field, val) {
    const next = [...lines]
    next[i] = { ...next[i], [field]: val }
    setLines(next)
  }

  function removeLine(i) {
    if (lines.length <= 1) return
    setLines(lines.filter((_, idx) => idx !== i))
  }

  async function handleSubmit() {
    const { warehouse_id, voucher_no } = grnForm
    if (!warehouse_id) { showToast('Select a warehouse', 'red'); return }
    const valid = lines.filter(l => l.item_id && parseFloat(l.qty) > 0)
    if (valid.length === 0) { showToast('Add at least one item line', 'red'); return }
    setSaving(true)
    try {
      const rows = valid.map(l => ({
        item_id: l.item_id,
        warehouse_id,
        movement_type: 'grn',
        quantity: parseFloat(l.qty),
        unit_cost: parseFloat(l.unit_cost) || 0,
        value: parseFloat(l.qty) * (parseFloat(l.unit_cost) || 0),
        voucher_type: 'GRN',
        voucher_no: voucher_no || null,
        source_module: 'inventory',
        notes: grnForm.notes || null,
        created_by: profile?.id,
      }))
      const { error } = await supabase.from('inventory_movements').insert(rows)
      if (error) throw error
      showToast(`GRN recorded — ${valid.length} item(s)`, 'green')
      setModalOpen(false)
      setLines([{ item_id: '', qty: '', unit_cost: '' }])
      setGrnForm({ warehouse_id: '', voucher_no: '', notes: '' })
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  function handleExport() {
    const headers = ['Date', 'Voucher No', 'Item Code', 'Description', 'Warehouse', 'Qty', 'Unit Cost', 'Value', 'Received By']
    const rows = filtered.map(m => [
      new Date(m.created_at).toLocaleDateString(), m.voucher_no || '', m.item?.item_code || '',
      m.item?.description || '', m.warehouse?.name || '', m.quantity,
      m.unit_cost?.toFixed(2) || '', m.value?.toFixed(2) || '', m.creator?.full_name || '',
    ])
    exportCsv('goods_received.csv', headers, rows)
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <PageHeader title="Goods Received (GRN)" site={currentSite} actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          {can('inventory.view') && <Button icon="download" onClick={handleExport}>Export</Button>}
          {can('inventory.create') && <Button icon="add" variant="filled" onClick={() => {
            setLines([{ item_id: '', qty: '', unit_cost: '' }])
            setGrnForm({ warehouse_id: '', voucher_no: '', notes: '' })
            setModalOpen(true)
          }}>Receive Goods</Button>}
        </div>
      } />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search items or voucher..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
        <select value={whFilter} onChange={e => setWhFilter(e.target.value)} style={{ ...inp, maxWidth: '200px' }}>
          <option value="">All warehouses</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>{filtered.length} records</span>
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <Card style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr>
                {['Date', 'Voucher', 'Item Code', 'Description', 'Warehouse', 'Qty', 'Unit Cost', 'Value', 'By'].map(h => (
                  <th key={h} style={{ ...th, textAlign: ['Qty', 'Unit Cost', 'Value'].includes(h) ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No GRN records</td></tr>
              ) : filtered.map(m => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '8px 10px', color: ACCENT, fontWeight: 600, fontFamily: 'monospace', fontSize: '12px' }}>{m.voucher_no || '—'}</td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: THEME.text }}>{m.item?.item_code || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.text }}>{m.item?.description || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{m.warehouse?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>+{m.quantity}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', color: THEME.textMed }}>{m.unit_cost ? `$${m.unit_cost.toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: THEME.text }}>{m.value ? `$${m.value.toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{m.creator?.full_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Receive Goods (GRN)"
        footer={<>
          <Button variant="text" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="filled" onClick={handleSubmit} disabled={saving}>{saving ? 'Recording...' : 'Record GRN'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Warehouse *</SectionLabel>
              <select value={grnForm.warehouse_id} onChange={e => setGrnForm({ ...grnForm, warehouse_id: e.target.value })} style={inp}>
                <option value="">— Select warehouse —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Voucher / PO No</SectionLabel>
              <input value={grnForm.voucher_no} onChange={e => setGrnForm({ ...grnForm, voucher_no: e.target.value })} placeholder="e.g. GRN-0001" style={inp} />
            </div>
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <input value={grnForm.notes} onChange={e => setGrnForm({ ...grnForm, notes: e.target.value })} style={inp} />
          </div>

          <div style={{ fontSize: '12px', fontWeight: 700, color: ACCENT, textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' }}>Line Items</div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
              <div>
                {i === 0 && <SectionLabel>Item *</SectionLabel>}
                <select value={l.item_id} onChange={e => updateLine(i, 'item_id', e.target.value)} style={inp}>
                  <option value="">— Select —</option>
                  {items.map(it => <option key={it.id} value={it.id}>{it.item_code} — {it.description}</option>)}
                </select>
              </div>
              <div>
                {i === 0 && <SectionLabel>Qty *</SectionLabel>}
                <input type="number" min="0.01" step="0.01" value={l.qty} onChange={e => updateLine(i, 'qty', e.target.value)} style={inp} />
              </div>
              <div>
                {i === 0 && <SectionLabel>Unit Cost</SectionLabel>}
                <input type="number" min="0" step="0.01" value={l.unit_cost} onChange={e => updateLine(i, 'unit_cost', e.target.value)} style={inp} />
              </div>
              <div style={{ paddingBottom: '2px' }}>
                {lines.length > 1 && (
                  <button onClick={() => removeLine(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px' }}>
                    <Icon name="close" size={18} style={{ color: THEME.textLow }} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <Button icon="add" variant="text" onClick={addLine} style={{ alignSelf: 'flex-start' }}>Add Line</Button>
        </div>
      </Modal>
    </div>
  )
}
