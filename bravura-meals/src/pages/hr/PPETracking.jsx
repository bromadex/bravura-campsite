import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, Button, TableWrap, THead, Th, TRow, Td, Modal, showToast, StatCard } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const DAY = 24 * 60 * 60 * 1000

const STATUS_META = {
  active:          { label: 'Active',          color: THEME.success },
  due_replacement: { label: 'Due Replacement', color: THEME.warning },
  returned:        { label: 'Returned',        color: THEME.textLow },
}

const inputStyle = {
  width: '100%', padding: '8px 10px', fontSize: '13px', fontFamily: 'inherit',
  border: `1px solid ${THEME.outline}`, borderRadius: '6px',
  background: THEME.surface, color: THEME.text,
}

const labelStyle = {
  display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed,
  marginBottom: '4px', letterSpacing: '.03em',
}

export default function PPETracking({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('ppe_issues', { column: 'site_id', value: currentSiteId })

  const [loading, setLoading] = useState(true)
  const [issues, setIssues] = useState([])
  const [employees, setEmployees] = useState([])
  const [items, setItems] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [form, setForm] = useState({
    employee_id: '', item_id: '', item_description: '', quantity: 1,
    expected_life_days: '', notes: '',
  })

  const resetForm = useCallback(() => {
    setForm({ employee_id: '', item_id: '', item_description: '', quantity: 1, expected_life_days: '', notes: '' })
  }, [])

  const fetchIssues = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('ppe_issues')
        .select('*, employee:employees(id, name, employee_number), item:items(id, description)')
        .eq('site_id', currentSiteId)
        .order('date_issued', { ascending: false })
      if (error) throw error
      setIssues(data || [])
    } catch (err) {
      console.error('PPETracking fetch:', err)
      setIssues([])
    }
    setLoading(false)
  }, [currentSiteId])

  const fetchEmployees = useCallback(async () => {
    if (!currentSiteId) return
    try {
      const { data } = await supabase
        .from('employees')
        .select('id, name, employee_number')
        .eq('site_id', currentSiteId)
        .eq('status', 'active')
        .eq('is_archived', false)
        .order('name')
      setEmployees(data || [])
    } catch { setEmployees([]); showToast('Failed to load PPE data', 'red') }
  }, [currentSiteId])

  const fetchItems = useCallback(async () => {
    if (!currentSiteId) return
    try {
      const { data } = await supabase
        .from('items')
        .select('id, description, category')
        .eq('site_id', currentSiteId)
        .or('category.ilike.%PPE%,category.ilike.%Safety%,category.ilike.%protective%')
        .order('description')
      setItems(data || [])
    } catch { setItems([]); showToast('Failed to load PPE data', 'red') }
  }, [currentSiteId])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) {
      fetchIssues()
      fetchEmployees()
      fetchItems()
    }
  }, [currentSiteId, fetchIssues, fetchEmployees, fetchItems, rt])

  // Derived data
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return issues.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false
      if (dateFrom && r.date_issued < dateFrom) return false
      if (dateTo && r.date_issued > dateTo) return false
      if (q) {
        const empName = (r.employee?.name || '').toLowerCase()
        const empNum = (r.employee?.employee_number || '').toLowerCase()
        const desc = (r.item_description || '').toLowerCase()
        if (!empName.includes(q) && !empNum.includes(q) && !desc.includes(q)) return false
      }
      return true
    })
  }, [issues, search, statusFilter, dateFrom, dateTo])

  const kpis = useMemo(() => {
    const activeIssues = issues.filter(r => r.status === 'active')
    const threshold = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10)
    const dueCount = activeIssues.filter(r => r.expected_replacement_date && r.expected_replacement_date <= threshold).length
    const overdueCount = activeIssues.filter(r => r.expected_replacement_date && r.expected_replacement_date < today).length
    return { active: activeIssues.length, due: dueCount, overdue: overdueCount }
  }, [issues, today])

  const handleItemSelect = useCallback((itemId) => {
    const item = items.find(i => i.id === itemId)
    setForm(f => ({ ...f, item_id: itemId, item_description: item ? item.description : f.item_description }))
  }, [items])

  const handleSave = useCallback(async () => {
    if (!form.employee_id || !form.item_description.trim()) {
      showToast('Employee and item description are required', 'red')
      return
    }
    setSaving(true)
    try {
      const dateIssued = new Date().toISOString().slice(0, 10)
      let expectedReplacementDate = null
      if (form.expected_life_days && Number(form.expected_life_days) > 0) {
        expectedReplacementDate = new Date(Date.now() + Number(form.expected_life_days) * DAY).toISOString().slice(0, 10)
      }
      const { data: { user } } = await supabase.auth.getUser()
      const payload = {
        site_id: currentSiteId,
        employee_id: form.employee_id,
        item_id: form.item_id || null,
        item_description: form.item_description.trim(),
        quantity: Number(form.quantity) || 1,
        date_issued: dateIssued,
        expected_replacement_date: expectedReplacementDate,
        status: 'active',
        notes: form.notes.trim() || null,
        issued_by: user?.id || null,
      }
      const { error } = await supabase.from('ppe_issues').insert(payload)
      if (error) throw error
      showToast('PPE issue recorded', ACCENT)
      setShowModal(false)
      resetForm()
      fetchIssues()
    } catch (err) {
      console.error('PPE save:', err)
      showToast('Failed to save: ' + (err.message || err), 'red')
    }
    setSaving(false)
  }, [form, currentSiteId, resetForm, fetchIssues])

  const handleExport = useCallback(() => {
    const headers = ['Employee #', 'Employee', 'Item', 'Qty', 'Date Issued', 'Expected Replacement', 'Status', 'Notes']
    const data = rows.map(r => [
      r.employee?.employee_number || '', r.employee?.name || '',
      r.item_description || '', r.quantity,
      r.date_issued || '', r.expected_replacement_date || '',
      STATUS_META[r.status]?.label || r.status, r.notes || '',
    ])
    exportCsv(`ppe_issues_${today}.csv`, headers, data)
  }, [rows, today])

  if (!can('hr.view')) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '12px', fontSize: '16px', fontWeight: 600, color: THEME.text }}>Access Denied</div>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>You do not have permission to view PPE tracking.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader
        title="PPE Issue Tracking"
        site={currentSite?.name}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="outlined" icon="download" onClick={handleExport} size="sm">Export</Button>
            {can('hr.create') && (
              <Button icon="add" onClick={() => { resetForm(); setShowModal(true) }} size="sm">Issue PPE</Button>
            )}
          </div>
        }
      />

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Active Issues" value={kpis.active} icon="shield" color={ACCENT} />
        <StatCard label="Due for Replacement (30d)" value={kpis.due} icon="schedule" color={THEME.warning} />
        <StatCard label="Overdue" value={kpis.overdue} icon="warning" color={THEME.error} />
      </div>

      {/* Filters */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 200px', position: 'relative' }}>
            <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input
              placeholder="Search employee or item..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inputStyle, paddingLeft: '32px' }}
            />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ ...inputStyle, width: 'auto', minWidth: '140px' }}>
            <option value="">All Statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inputStyle, width: 'auto' }} title="From date" />
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inputStyle, width: 'auto' }} title="To date" />
          {(search || statusFilter || dateFrom || dateTo) && (
            <Button variant="text" size="sm" onClick={() => { setSearch(''); setStatusFilter(''); setDateFrom(''); setDateTo('') }}>Clear</Button>
          )}
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</div>
      ) : rows.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '40px' }}>
          <Icon name="shield" size={40} style={{ color: THEME.textLow }} />
          <div style={{ marginTop: '10px', fontSize: '14px', color: THEME.textMed }}>
            {issues.length === 0 ? 'No PPE issues recorded yet.' : 'No records match your filters.'}
          </div>
        </Card>
      ) : (
        <TableWrap>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead>
              <Th>Employee</Th>
              <Th>Item</Th>
              <Th align="center">Qty</Th>
              <Th>Date Issued</Th>
              <Th>Replacement Date</Th>
              <Th>Status</Th>
              <Th>Notes</Th>
            </THead>
            <tbody>
              {rows.map((r, i) => {
                const statusMeta = STATUS_META[r.status] || STATUS_META.active
                const isOverdue = r.status === 'active' && r.expected_replacement_date && r.expected_replacement_date < today
                return (
                  <TRow key={r.id} last={i === rows.length - 1}>
                    <Td>
                      <div style={{ fontWeight: 500, color: THEME.text, fontSize: '13px' }}>{r.employee?.name || 'Unknown'}</div>
                      <div style={{ fontSize: '11px', color: THEME.textLow }}>{r.employee?.employee_number || ''}</div>
                    </Td>
                    <Td style={{ fontSize: '13px' }}>{r.item_description || r.item?.description || '-'}</Td>
                    <Td align="center" style={{ fontSize: '13px' }}>{r.quantity}</Td>
                    <Td style={{ fontSize: '13px' }}>{r.date_issued || '-'}</Td>
                    <Td style={{ fontSize: '13px' }}>
                      <span style={{ color: isOverdue ? THEME.error : THEME.text }}>
                        {r.expected_replacement_date || '-'}
                      </span>
                      {isOverdue && <span style={{ fontSize: '10px', color: THEME.error, marginLeft: '6px', fontWeight: 600 }}>OVERDUE</span>}
                    </Td>
                    <Td>
                      <span style={{
                        display: 'inline-block', padding: '2px 9px', borderRadius: '5px',
                        fontSize: '11px', fontWeight: 600,
                        background: statusMeta.color + '18', color: statusMeta.color,
                      }}>
                        {statusMeta.label}
                      </span>
                    </Td>
                    <Td style={{ fontSize: '12px', color: THEME.textMed, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.notes || '-'}
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <div style={{ textAlign: 'right', fontSize: '11px', color: THEME.textLow, marginTop: '6px' }}>
        {rows.length} record{rows.length !== 1 ? 's' : ''}
      </div>

      {/* Issue PPE Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="Issue PPE"
        footer={
          <>
            <Button variant="text" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={labelStyle}>Employee *</label>
            <select value={form.employee_id} onChange={e => setForm(f => ({ ...f, employee_id: e.target.value }))} style={inputStyle}>
              <option value="">-- Select employee --</option>
              {employees.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.name} ({emp.employee_number || 'N/A'})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>PPE Item (from inventory)</label>
            <select value={form.item_id} onChange={e => handleItemSelect(e.target.value)} style={inputStyle}>
              <option value="">-- Select item (optional) --</option>
              {items.map(item => (
                <option key={item.id} value={item.id}>{item.description}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Item Description *</label>
            <input
              value={form.item_description}
              onChange={e => setForm(f => ({ ...f, item_description: e.target.value }))}
              placeholder="e.g. Hard Hat, Safety Boots Size 9"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Quantity</label>
              <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Expected Life (days)</label>
              <input type="number" min="1" value={form.expected_life_days} onChange={e => setForm(f => ({ ...f, expected_life_days: e.target.value }))} placeholder="e.g. 365" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes..."
              rows={3}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}
