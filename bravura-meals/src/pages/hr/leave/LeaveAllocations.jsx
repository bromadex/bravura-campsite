import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { useAuth } from '../../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { useSite } from '../../../contexts/SiteContext'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast } from '../../../components/ui'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}
const selStyle = { ...inputStyle, width: 'auto', padding: '9px 12px', fontSize: '13px' }

export default function LeaveAllocations() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('leave_allocations', { column: 'site_id', value: currentSiteId })

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState([])
  const [types, setTypes] = useState([])
  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)
  const [empFilter, setEmpFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulk, setBulk] = useState({ leave_type_id: '', days: '', scope: 'all', department_id: '' })
  const [adjOpen, setAdjOpen] = useState(false)
  const [adjRow, setAdjRow] = useState(null)
  const [adj, setAdj] = useState({ days: '', reason: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [alRes, ltRes, empRes, depRes] = await Promise.all([
      supabase.from('leave_allocations')
        .select('*, employee:employees(id, name, department_id), leave_type:leave_types(id, name)')
        .eq('site_id', currentSiteId).eq('year', year).order('created_at', { ascending: false }),
      supabase.from('leave_types').select('id, name, max_days_per_year').eq('is_active', true).order('name'),
      supabase.from('employees').select('id, name, department_id').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('departments').select('id, name').or(`site_id.eq.${currentSiteId},site_id.is.null`).order('name'),
    ])
    if (alRes.error) { console.error(alRes.error); showToast('Failed to load allocations', 'red') }
    setRows(alRes.data || [])
    setTypes(ltRes.data || [])
    setEmployees(empRes.data || [])
    setDepartments(depRes.data || [])
    setLoading(false)
  }, [currentSiteId, year])

  useEffect(() => { load() }, [load, rt])

  const visible = useMemo(() => {
    const q = empFilter.trim().toLowerCase()
    return rows.filter(r =>
      (typeFilter === 'all' || r.leave_type_id === typeFilter) &&
      (!q || (r.employee?.name || '').toLowerCase().includes(q))
    )
  }, [rows, empFilter, typeFilter])

  async function runBulk() {
    if (!bulk.leave_type_id || !bulk.days) { showToast('Select a leave type and days', 'red'); return }
    setSaving(true)
    const targets = employees.filter(e => bulk.scope === 'all' || e.department_id === bulk.department_id)
    const existing = new Set(rows.filter(r => r.leave_type_id === bulk.leave_type_id).map(r => r.employee_id))
    const inserts = targets
      .filter(e => !existing.has(e.id))
      .map(e => ({
        employee_id: e.id, site_id: currentSiteId, leave_type_id: bulk.leave_type_id,
        year, allocated_days: Number(bulk.days), created_by: profile?.id || null,
      }))
    if (inserts.length === 0) { setSaving(false); showToast('Everyone selected already has this allocation', 'red'); return }
    const { error } = await supabase.from('leave_allocations').insert(inserts)
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`Allocated to ${inserts.length} employee${inserts.length === 1 ? '' : 's'}`, 'green')
    setBulkOpen(false); load()
  }

  function openAdjust(r) {
    setAdjRow(r); setAdj({ days: String(r.allocated_days), reason: '' }); setAdjOpen(true)
  }

  async function runAdjust() {
    if (!adj.reason.trim()) { showToast('A reason is required', 'red'); return }
    setSaving(true)
    const { error } = await supabase.from('leave_allocations')
      .update({ allocated_days: Number(adj.days) || 0, adjust_reason: adj.reason.trim() })
      .eq('id', adjRow.id)
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Allocation adjusted', 'green'); setAdjOpen(false); load()
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  return (
    <div>
      <PageHeader title="Leave Allocations" site={currentSite}
        actions={can('hr.approve') && <Button icon="library_add" onClick={() => { setBulk({ leave_type_id: '', days: '', scope: 'all', department_id: '' }); setBulkOpen(true) }}>Bulk Allocate</Button>} />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={selStyle} value={year} onChange={e => setYear(Number(e.target.value))}>
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <input style={{ ...selStyle, minWidth: '200px' }} value={empFilter} onChange={e => setEmpFilter(e.target.value)} placeholder="Search employee…" />
        <select style={selStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Leave Types</option>
          {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {loading ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div> : (
        <TableWrap>
          <THead color={ACCENT}>
            <Th>Employee</Th><Th>Leave Type</Th><Th align="center">Year</Th>
            <Th align="center">Allocated</Th><Th align="center">Used</Th><Th align="center">Remaining</Th>
            <Th align="center">Carried Over</Th><Th></Th>
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: THEME.textLow }}>No allocations for {year}. Use Bulk Allocate to set them up.</td></tr>
            ) : visible.map(r => {
              const remaining = Number(r.allocated_days) + Number(r.carried_over_days) - Number(r.used_days)
              return (
                <TRow key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{r.employee?.name || '—'}</Td>
                  <Td>{r.leave_type?.name || '—'}</Td>
                  <Td align="center">{r.year}</Td>
                  <Td align="center">{Number(r.allocated_days).toFixed(1)}</Td>
                  <Td align="center">{Number(r.used_days).toFixed(1)}</Td>
                  <Td align="center" style={{ fontWeight: 700, color: remaining < 0 ? THEME.error : remaining <= 2 ? THEME.warning : THEME.success }}>
                    {remaining.toFixed(1)}
                  </Td>
                  <Td align="center">{Number(r.carried_over_days).toFixed(1)}</Td>
                  <Td align="right">
                    {can('hr.approve') && (
                      <Button variant="outlined" onClick={() => openAdjust(r)}>Adjust</Button>
                    )}
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {/* Bulk allocate */}
      <Modal dirty={true} open={bulkOpen} onClose={() => setBulkOpen(false)} title={`Bulk Allocate — ${year}`}
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setBulkOpen(false)}>Cancel</Button>
            <Button icon="library_add" onClick={runBulk} disabled={saving}>{saving ? 'Allocating…' : 'Allocate'}</Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <SectionLabel>Leave Type *</SectionLabel>
            <select style={inputStyle} value={bulk.leave_type_id}
              onChange={e => {
                const t = types.find(x => x.id === e.target.value)
                setBulk(b => ({ ...b, leave_type_id: e.target.value, days: b.days || (t?.max_days_per_year ?? '') }))
              }}>
              <option value="">— Select —</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}{t.max_days_per_year ? ` (${t.max_days_per_year}d)` : ''}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Days per employee *</SectionLabel>
            <input style={inputStyle} type="number" min="0" step="0.5" value={bulk.days} onChange={e => setBulk(b => ({ ...b, days: e.target.value }))} />
          </div>
          <div>
            <SectionLabel>Who</SectionLabel>
            <select style={inputStyle} value={bulk.scope} onChange={e => setBulk(b => ({ ...b, scope: e.target.value }))}>
              <option value="all">All active employees ({employees.length})</option>
              <option value="dept">One department</option>
            </select>
          </div>
          {bulk.scope === 'dept' && (
            <div>
              <SectionLabel>Department</SectionLabel>
              <select style={inputStyle} value={bulk.department_id} onChange={e => setBulk(b => ({ ...b, department_id: e.target.value }))}>
                <option value="">— Select —</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ fontSize: '12px', color: THEME.textLow }}>
            Employees who already hold an allocation for this type and year are skipped.
          </div>
        </div>
      </Modal>

      {/* Manual adjust */}
      <Modal dirty={true} open={adjOpen} onClose={() => setAdjOpen(false)} title={`Adjust — ${adjRow?.employee?.name || ''}`}
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setAdjOpen(false)}>Cancel</Button>
            <Button icon="save" onClick={runAdjust} disabled={saving}>{saving ? 'Saving…' : 'Apply'}</Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <SectionLabel>Allocated Days</SectionLabel>
            <input style={inputStyle} type="number" min="0" step="0.5" value={adj.days} onChange={e => setAdj(a => ({ ...a, days: e.target.value }))} />
          </div>
          <div>
            <SectionLabel>Reason *</SectionLabel>
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={adj.reason} onChange={e => setAdj(a => ({ ...a, reason: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
