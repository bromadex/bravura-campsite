import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { useSite } from '../../../contexts/SiteContext'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, showToast } from '../../../components/ui'

const ACCENT = MODULE_COLORS.workforce

const selStyle = {
  padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
  fontSize: '13px', fontFamily: 'inherit', outline: 'none', background: THEME.surface,
}

export default function LeaveBalanceReport() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [deptFilter, setDeptFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase.from('leave_allocations')
        .select('*, employee:employees(id, name, department:departments(id, name)), leave_type:leave_types(id, name)')
        .eq('site_id', currentSiteId).eq('year', year)
        .order('created_at')
      if (error) { console.error(error); showToast('Failed to load balances', 'red') }
      if (!cancelled) { setRows(data || []); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId, year])

  const departments = useMemo(() => {
    const m = new Map()
    rows.forEach(r => { const d = r.employee?.department; if (d) m.set(d.id, d.name) })
    return [...m.entries()]
  }, [rows])
  const types = useMemo(() => {
    const m = new Map()
    rows.forEach(r => { if (r.leave_type) m.set(r.leave_type.id, r.leave_type.name) })
    return [...m.entries()]
  }, [rows])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r =>
      (deptFilter === 'all' || r.employee?.department?.id === deptFilter) &&
      (typeFilter === 'all' || r.leave_type_id === typeFilter) &&
      (!q || (r.employee?.name || '').toLowerCase().includes(q))
    ).sort((a, b) => (a.employee?.name || '').localeCompare(b.employee?.name || ''))
  }, [rows, deptFilter, typeFilter, search])

  function exportCsv() {
    const bom = '﻿'
    const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const headers = ['Employee', 'Department', 'Leave Type', 'Year', 'Allocated', 'Used', 'Remaining', 'Carried Over']
    const lines = visible.map(r => {
      const rem = Number(r.allocated_days) + Number(r.carried_over_days) - Number(r.used_days)
      return [r.employee?.name, r.employee?.department?.name, r.leave_type?.name, r.year,
        r.allocated_days, r.used_days, rem.toFixed(1), r.carried_over_days].map(esc).join(',')
    })
    const blob = new Blob([bom + [headers.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `leave_balances_${year}.csv`; a.click()
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
      <PageHeader title="Leave Balance Report" site={currentSite}
        actions={can('hr.export') && <Button variant="outlined" icon="download" onClick={exportCsv}>CSV</Button>} />

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select style={selStyle} value={year} onChange={e => setYear(Number(e.target.value))}>
          {[thisYear + 1, thisYear, thisYear - 1].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select style={selStyle} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="all">All Departments</option>
          {departments.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select style={selStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="all">All Leave Types</option>
          {types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <input style={{ ...selStyle, minWidth: '200px' }} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search employee…" />
      </div>

      {loading ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div> : (
        <TableWrap>
          <THead color={ACCENT}>
            <Th>Employee</Th><Th>Department</Th><Th>Leave Type</Th>
            <Th align="center">Allocated</Th><Th align="center">Used</Th>
            <Th align="center">Remaining</Th><Th align="center">Carried Over</Th>
          </THead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: THEME.textLow }}>No allocations for {year}.</td></tr>
            ) : visible.map(r => {
              const rem = Number(r.allocated_days) + Number(r.carried_over_days) - Number(r.used_days)
              return (
                <TRow key={r.id}>
                  <Td style={{ fontWeight: 600 }}>{r.employee?.name || '—'}</Td>
                  <Td>{r.employee?.department?.name || '—'}</Td>
                  <Td>{r.leave_type?.name || '—'}</Td>
                  <Td align="center">{Number(r.allocated_days).toFixed(1)}</Td>
                  <Td align="center">{Number(r.used_days).toFixed(1)}</Td>
                  <Td align="center" style={{ fontWeight: 700, color: rem < 0 ? THEME.error : rem <= 2 ? THEME.warning : THEME.success }}>{rem.toFixed(1)}</Td>
                  <Td align="center">{Number(r.carried_over_days).toFixed(1)}</Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}
    </div>
  )
}
