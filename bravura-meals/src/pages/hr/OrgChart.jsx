import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Icon, PageHeader, showToast } from '../../components/ui'
import QuickNav, { HR_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.workforce

function Node({ emp, childrenMap, depth }) {
  const [open, setOpen] = useState(depth < 2)
  const kids = childrenMap[emp.id] || []
  const initials = emp.name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        onClick={() => kids.length > 0 && setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
          borderRadius: '12px', padding: '10px 16px',
          cursor: kids.length > 0 ? 'pointer' : 'default',
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
        }}>
        <div style={{
          width: '34px', height: '34px', borderRadius: '50%', background: ACCENT,
          color: '#fff', fontSize: '13px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>{initials}</div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text, whiteSpace: 'nowrap' }}>{emp.name}</div>
          <div style={{ fontSize: '11px', color: THEME.textLow, whiteSpace: 'nowrap' }}>
            {emp.designation?.name || emp.department?.name || '—'}
          </div>
        </div>
        {kids.length > 0 && (
          <Icon name={open ? 'expand_less' : 'expand_more'} size={16} style={{ color: THEME.textLow }} />
        )}
      </div>
      {open && kids.length > 0 && (
        <>
          <div style={{ width: '2px', height: '18px', background: ACCENT + '55' }} />
          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'center' }}>
            {kids.map(k => (
              <div key={k.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: '2px', height: '14px', background: ACCENT + '55' }} />
                <Node emp={k} childrenMap={childrenMap} depth={depth + 1} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default function OrgChart({ setPage }) {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [employees, setEmployees] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [empRes, depRes] = await Promise.all([
        supabase.from('employees')
          .select('id, name, manager_id, department_id, designation:designations(id, name), department:departments!employees_department_id_fkey(id, name)')
          .eq('site_id', currentSiteId).eq('status', 'active').eq('is_archived', false).order('name'),
        supabase.from('departments').select('id, name').or(`site_id.eq.${currentSiteId},site_id.is.null`).order('name'),
      ])
      if (empRes.error) { console.error(empRes.error); showToast('Failed to load org chart', 'red') }
      if (!cancelled) {
        setEmployees(empRes.data || [])
        setDepartments(depRes.data || [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId])

  const filtered = useMemo(() =>
    employees.filter(e => deptFilter === 'all' || e.department_id === deptFilter),
    [employees, deptFilter]
  )

  const { roots, childrenMap } = useMemo(() => {
    const ids = new Set(filtered.map(e => e.id))
    const cm = {}
    const rs = []
    for (const e of filtered) {
      // A node is a root if it has no manager, or its manager is outside the filter.
      if (!e.manager_id || !ids.has(e.manager_id)) rs.push(e)
      else {
        if (!cm[e.manager_id]) cm[e.manager_id] = []
        cm[e.manager_id].push(e)
      }
    }
    return { roots: rs, childrenMap: cm }
  }, [filtered])

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  return (
    <div>
      <QuickNav pills={HR_PILLS} setPage={setPage} current="wf_org_chart" />
      <PageHeader title="Org Chart" site={currentSite}
        actions={
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            style={{ padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        } />

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
      ) : roots.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          No employees to chart. Assign managers on the employee form to build the hierarchy.
        </div>
      ) : (
        <div style={{ overflowX: 'auto', padding: '10px 0 30px' }}>
          <div style={{ display: 'flex', gap: '40px', alignItems: 'flex-start', justifyContent: 'center', minWidth: 'fit-content' }}>
            {roots.map(r => <Node key={r.id} emp={r} childrenMap={childrenMap} depth={0} />)}
          </div>
        </div>
      )}
    </div>
  )
}
