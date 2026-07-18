import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, Icon, Button, Modal, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.inventory

export default function InvIssues({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('inventory_movements', { column: 'site_id', value: currentSiteId })
  const [movements, setMovements] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [items, setItems] = useState([])
  const [departments, setDepartments] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [mode, setMode] = useState('issue')
  const [form, setForm] = useState({ warehouse_id: '', item_id: '', qty: '', notes: '', department_id: '', issued_to_employee_id: '' })
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [movRes, whRes, itemRes, deptRes, empRes] = await Promise.all([
        supabase.from('inventory_movements')
          .select('*, item:items!inventory_movements_item_id_fkey(item_code, description), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name, site_id), creator:profiles!inventory_movements_created_by_fkey(full_name), employee:employees!inventory_movements_issued_to_employee_id_fkey(first_name, last_name), department:departments!inventory_movements_department_id_fkey(name)')
          .in('movement_type', ['issue', 'return'])
          .not('warehouse', 'is', null)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
        supabase.from('departments').select('id, name').eq('site_id', currentSiteId).order('name'),
        supabase.from('employees').select('id, first_name, last_name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('last_name'),
      ])
      if (movRes.error) throw movRes.error
      setMovements((movRes.data || []).filter(m => m.warehouse?.site_id === currentSiteId))
      setWarehouses(whRes.data || [])
      setItems(itemRes.data || [])
      setDepartments(deptRes.data || [])
      setEmployees(empRes.data || [])
    } catch (err) {
      console.error('InvIssues:', err)
      showToast('Failed to load data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch, rt])

  const filtered = useMemo(() => {
    let list = movements
    if (typeFilter) list = list.filter(m => m.movement_type === typeFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(m =>
        m.item?.item_code?.toLowerCase().includes(q) ||
        m.item?.description?.toLowerCase().includes(q) ||
        (m.notes || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [movements, search, typeFilter])

  function openModal(type) {
    setMode(type)
    setForm({ warehouse_id: '', item_id: '', qty: '', notes: '', department_id: '', issued_to_employee_id: '' })
    setModalOpen(true)
  }

  async function handleSubmit() {
    const { warehouse_id, item_id, qty } = form
    if (!warehouse_id || !item_id) { showToast('Select warehouse and item', 'red'); return }
    const q = parseFloat(qty)
    if (!q || q <= 0) { showToast('Enter a valid quantity', 'red'); return }
    setSaving(true)
    try {
      const { error } = await supabase.from('inventory_movements').insert({
        item_id,
        warehouse_id,
        movement_type: mode,
        quantity: mode === 'issue' ? -q : q,
        unit_cost: 0,
        value: 0,
        voucher_type: mode === 'issue' ? 'ISSUE' : 'RETURN',
        source_module: 'inventory',
        notes: form.notes || null,
        department_id: form.department_id || null,
        issued_to_employee_id: form.issued_to_employee_id || null,
        created_by: profile?.id,
      })
      if (error) throw error
      showToast(mode === 'issue' ? 'Stock issued' : 'Stock returned', 'green')
      setModalOpen(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  function handleExport() {
    const headers = ['Date', 'Type', 'Item Code', 'Description', 'Warehouse', 'Qty', 'Department', 'Issued To', 'Notes', 'By']
    const rows = filtered.map(m => [
      new Date(m.created_at).toLocaleDateString(), m.movement_type, m.item?.item_code || '',
      m.item?.description || '', m.warehouse?.name || '', m.quantity,
      m.department?.name || '', m.employee ? `${m.employee.first_name} ${m.employee.last_name}` : '',
      m.notes || '', m.creator?.full_name || '',
    ])
    exportCsv('stock_issues_returns.csv', headers, rows)
  }

  if (!can('inventory.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }
  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_issues" />
      <PageHeader title="Issues & Returns" site={currentSite} actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button icon="download" onClick={handleExport}>Export</Button>
          {can('inventory.create') && <>
            <Button icon="keyboard_return" onClick={() => openModal('return')}>Return Stock</Button>
            <Button icon="outbox" variant="filled" onClick={() => openModal('issue')}>Issue Stock</Button>
          </>}
        </div>
      } />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="">All types</option>
          <option value="issue">Issues</option>
          <option value="return">Returns</option>
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
                {['Date', 'Type', 'Item Code', 'Description', 'Warehouse', 'Qty', 'Department', 'Issued To', 'By'].map(h => (
                  <th key={h} style={{ ...th, textAlign: h === 'Qty' ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>No records</td></tr>
              ) : filtered.map(m => (
                <tr key={m.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{new Date(m.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                      background: m.movement_type === 'issue' ? THEME.statusErrorBg : THEME.statusSuccessBg,
                      color: m.movement_type === 'issue' ? THEME.statusErrorText : THEME.statusSuccessText,
                    }}>{m.movement_type === 'issue' ? 'Issue' : 'Return'}</span>
                  </td>
                  <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px', color: ACCENT, fontWeight: 600 }}>{m.item?.item_code || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.text }}>{m.item?.description || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{m.warehouse?.name || '—'}</td>
                  <td style={{
                    padding: '8px 10px', textAlign: 'right', fontWeight: 600,
                    color: m.quantity < 0 ? THEME.error : '#16a34a',
                  }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{m.department?.name || '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{m.employee ? `${m.employee.first_name} ${m.employee.last_name}` : '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{m.creator?.full_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={mode === 'issue' ? 'Issue Stock' : 'Return Stock'}
        footer={<>
          <Button variant="text" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="filled" onClick={handleSubmit} disabled={saving}>{saving ? 'Saving...' : mode === 'issue' ? 'Issue' : 'Return'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <SectionLabel>Item *</SectionLabel>
            <select value={form.item_id} onChange={e => setForm({ ...form, item_id: e.target.value })} style={inp}>
              <option value="">— Select item —</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.item_code} — {i.description}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Warehouse *</SectionLabel>
              <select value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })} style={inp}>
                <option value="">— Select —</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Quantity *</SectionLabel>
              <input type="number" min="0.01" step="0.01" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} style={inp} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>Department</SectionLabel>
              <select value={form.department_id} onChange={e => setForm({ ...form, department_id: e.target.value })} style={inp}>
                <option value="">— None —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Issued To (Employee)</SectionLabel>
              <select value={form.issued_to_employee_id} onChange={e => setForm({ ...form, issued_to_employee_id: e.target.value })} style={inp}>
                <option value="">— None —</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.employee_number} — {e.first_name} {e.last_name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <SectionLabel>Notes</SectionLabel>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={inp} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
