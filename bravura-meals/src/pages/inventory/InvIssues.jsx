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
          .select('*, item:items!inventory_movements_item_id_fkey(item_code, description), warehouse:warehouses!inventory_movements_warehouse_id_fkey(name, site_id), creator:profiles!inventory_movements_created_by_fkey(full_name), employee:employees!inventory_movements_issued_to_employee_id_fkey(name, employee_number), department:departments!inventory_movements_department_id_fkey(name)')
          .in('movement_type', ['issue', 'return'])
          .not('warehouse', 'is', null)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name'),
        supabase.from('items').select('id, item_code, description').eq('is_archived', false).order('description'),
        supabase.from('departments').select('id, name').eq('site_id', currentSiteId).order('name'),
        supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
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

  // Batches of the chosen item in the chosen warehouse, earliest expiry first (first-expiry, first-out).
  const [batches, setBatches] = useState([])
  useEffect(() => {
    if (!form.item_id || !form.warehouse_id) { setBatches([]); return }
    supabase.from('inventory_batches').select('batch_no, expiry_date, qty_remaining')
      .eq('item_id', form.item_id).eq('warehouse_id', form.warehouse_id).gt('qty_remaining', 0).eq('is_archived', false)
      .order('expiry_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        setBatches(data || [])
        if (mode === 'issue' && data?.length) setForm(f => ({ ...f, batch_no: f.batch_no || data[0].batch_no }))
      })
  }, [form.item_id, form.warehouse_id, mode])

  async function handleSubmit() {
    const { warehouse_id, item_id, qty } = form
    if (!warehouse_id || !item_id) { showToast('Select warehouse and item', 'red'); return }
    const q = parseFloat(qty)
    if (!q || q <= 0) { showToast('Enter a valid quantity', 'red'); return }
    if (mode === 'issue' && !form.department_id && !form.issued_to_employee_id) { showToast('Choose the department or person the stock is for', 'red'); return }
    setSaving(true)
    try {
      // The database prices the move at the store's average cost and refuses to go below zero.
      const { data, error } = await supabase.rpc(mode === 'issue' ? 'inv_issue' : 'inv_return', { p: {
        warehouse_id,
        department_id: form.department_id || null,
        employee_id: form.issued_to_employee_id || null,
        notes: form.notes || null,
        condition: mode === 'return' ? (form.condition || 'good') : undefined,
        lines: [{ item_id, qty: q, batch_no: form.batch_no || null }],
      } })
      if (error) throw error
      showToast(`${mode === 'issue' ? 'Issued' : 'Returned'} — ${data.voucher} · $${Number(data.value || 0).toFixed(2)}${data.written_off ? ` ($${Number(data.written_off).toFixed(2)} written off)` : ''}`, 'green')
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
      m.department?.name || '', m.employee?.name || '',
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
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{m.employee ? m.employee.name : '—'}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '12px' }}>{m.creator?.full_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal dirty={true} open={modalOpen} onClose={() => setModalOpen(false)} title={mode === 'issue' ? 'Issue Stock' : 'Return Stock'}
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
            {batches.length > 0 && (
              <div>
                <SectionLabel>Batch</SectionLabel>
                <select aria-label="Batch" value={form.batch_no || ''} onChange={e => setForm({ ...form, batch_no: e.target.value })} style={inp}>
                  {mode === 'return' && <option value="">— No batch —</option>}
                  {batches.map(b => <option key={b.batch_no} value={b.batch_no}>{b.batch_no} · {Number(b.qty_remaining)} left{b.expiry_date ? ` · expires ${b.expiry_date}` : ''}</option>)}
                </select>
              </div>
            )}
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
                {employees.map(e => <option key={e.id} value={e.id}>{e.employee_number} — {e.name}</option>)}
              </select>
            </div>
          </div>
          {mode === 'return' && (
            <div>
              <SectionLabel>Condition</SectionLabel>
              <select aria-label="Condition" value={form.condition || 'good'} onChange={e => setForm({ ...form, condition: e.target.value })} style={inp}>
                <option value="good">Good — back on the shelf</option>
                <option value="damaged">Damaged — credit the department, write it off</option>
                <option value="scrap">Scrap — credit the department, write it off</option>
              </select>
            </div>
          )}
          <div>
            <SectionLabel>Notes</SectionLabel>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} style={inp} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
