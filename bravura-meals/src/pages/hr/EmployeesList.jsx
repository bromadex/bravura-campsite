import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, showToast } from '../../components/ui'

const ACCENT = MODULE_COLORS.workforce
const PAGE_SIZE = 25

const STATUS_META = {
  active:               { label: 'Active',        bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText },
  on_leave:             { label: 'On Leave',      bg: THEME.statusWarningBg,  text: THEME.statusWarningText },
  long_leave:           { label: 'Long Leave',    bg: THEME.statusTertiaryBg, text: THEME.statusTertiaryText },
  temporary_assignment: { label: 'Temp Assign',   bg: THEME.statusInfoBg,     text: THEME.statusInfoText },
  transferred:          { label: 'Transferred',   bg: THEME.statusInfoBg,     text: THEME.statusInfoText },
  terminated:           { label: 'Terminated',    bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.active
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '999px',
      fontSize: '11px', fontWeight: 600, background: m.bg, color: m.text, whiteSpace: 'nowrap',
    }}>{m.label}</span>
  )
}

const inputStyle = {
  padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
  fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: THEME.surface,
}

export default function EmployeesList({ setPage }) {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [coFilter, setCoFilter] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [pageNo, setPageNo] = useState(0)

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('employees')
        .select('*, contractor:contractors(id, name), department:departments!employees_department_id_fkey(id, name), designation:designations(id, name), employment_type:employment_types(id, name)')
        .eq('site_id', currentSiteId)
        .order('name')
      if (error) { console.error(error); showToast('Failed to load employees', 'red') }
      if (!cancelled) { setRows(data || []); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId])

  const departments = useMemo(() => {
    const m = new Map()
    rows.forEach(r => { if (r.department) m.set(r.department.id, r.department.name) })
    return [...m.entries()]
  }, [rows])

  const contractors = useMemo(() => {
    const m = new Map()
    rows.forEach(r => { if (r.contractor) m.set(r.contractor.id, r.contractor.name) })
    return [...m.entries()]
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (!showArchived && r.is_archived) return false
      if (deptFilter !== 'all' && r.department_id !== deptFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (coFilter !== 'all' && r.contractor_id !== coFilter) return false
      if (q && !r.name.toLowerCase().includes(q) && !(r.employee_number || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [rows, search, deptFilter, statusFilter, coFilter, showArchived])

  useEffect(() => { setPageNo(0) }, [search, deptFilter, statusFilter, coFilter, showArchived])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice(pageNo * PAGE_SIZE, (pageNo + 1) * PAGE_SIZE)

  function exportCsv() {
    const bom = '﻿'
    const esc = v => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ['Employee Number', 'Name', 'Department', 'Designation', 'Employment Type', 'Status', 'Contractor', 'Phone', 'Email', 'Start Date']
    const lines = filtered.map(r => [
      r.employee_number, r.name, r.department?.name, r.designation?.name,
      r.employment_type?.name, r.status, r.contractor?.name, r.phone, r.email, r.start_date,
    ].map(esc).join(','))
    const blob = new Blob([bom + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `employees_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Employees"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {can('hr.view') && <Button variant="outlined" icon="download" onClick={exportCsv}>CSV</Button>}
            {can('hr.create') && <Button icon="person_add" onClick={() => setPage('wf_employee_form')}>Add Employee</Button>}
          </div>
        }
      />

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name or number…"
          style={{ ...inputStyle, minWidth: '220px' }}
        />
        <select style={inputStyle} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="all">All Departments</option>
          {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select style={inputStyle} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select style={inputStyle} value={coFilter} onChange={e => setCoFilter(e.target.value)}>
          <option value="all">All Contractors</option>
          {contractors.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMed, cursor: 'pointer' }}>
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          Archived
        </label>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow }}>
          {filtered.length} employee{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
      ) : (
        <>
          <TableWrap>
            <THead color={ACCENT}>
              <Th>#</Th><Th>Number</Th><Th>Name</Th><Th>Department</Th><Th>Designation</Th>
              <Th>Type</Th><Th>Status</Th><Th>Contractor</Th><Th></Th>
            </THead>
            <tbody>
              {pageRows.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '32px', textAlign: 'center', color: THEME.textLow }}>No employees match.</td></tr>
              ) : pageRows.map((r, i) => (
                <TRow key={r.id} onClick={() => setPage('wf_employee_detail:' + r.id)} style={{ cursor: 'pointer' }}>
                  <Td style={{ color: THEME.textLow }}>{pageNo * PAGE_SIZE + i + 1}</Td>
                  <Td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{r.employee_number || '—'}</Td>
                  <Td style={{ fontWeight: 600 }}>{r.name}</Td>
                  <Td>{r.department?.name || '—'}</Td>
                  <Td>{r.designation?.name || '—'}</Td>
                  <Td>{r.employment_type?.name || '—'}</Td>
                  <Td><StatusBadge status={r.status} /></Td>
                  <Td>{r.contractor?.name || '—'}</Td>
                  <Td align="right"><Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} /></Td>
                </TRow>
              ))}
            </tbody>
          </TableWrap>

          {/* Pagination */}
          {pageCount > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '14px', marginTop: '16px' }}>
              <Button variant="outlined" onClick={() => setPageNo(p => Math.max(0, p - 1))} disabled={pageNo === 0}>Prev</Button>
              <span style={{ fontSize: '13px', color: THEME.textMed }}>Page {pageNo + 1} of {pageCount}</span>
              <Button variant="outlined" onClick={() => setPageNo(p => Math.min(pageCount - 1, p + 1))} disabled={pageNo >= pageCount - 1}>Next</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
