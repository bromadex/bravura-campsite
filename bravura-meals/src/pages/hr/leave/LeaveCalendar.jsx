import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { useSite } from '../../../contexts/SiteContext'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { Icon, PageHeader, Button, Modal, showToast, MONTHS } from '../../../components/ui'
import { useRealtimeSubscription } from '../../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function LeaveCalendar() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const [reloadKey, setReloadKey] = useState(0)
  const onRealtime = useCallback(() => setReloadKey(k => k + 1), [])
  useRealtimeSubscription('leave_requests', { column: 'site_id', value: currentSiteId }, onRealtime)

  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })   // m: 0-11
  const [rows, setRows] = useState([])
  const [departments, setDepartments] = useState([])
  const [deptFilter, setDeptFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [dayDetail, setDayDetail] = useState(null)   // 'YYYY-MM-DD'

  const monthStart = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-01`
  const lastDay = new Date(ym.y, ym.m + 1, 0).getDate()
  const monthEnd = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [reqRes, depRes] = await Promise.all([
        supabase.from('leave_requests')
          .select('id, start_date, end_date, leave_type:leave_types(id, name), employee:employees(id, name, department_id)')
          .eq('site_id', currentSiteId).eq('status', 'approved')
          .lte('start_date', monthEnd).gte('end_date', monthStart),
        supabase.from('departments').select('id, name').or(`site_id.eq.${currentSiteId},site_id.is.null`).order('name'),
      ])
      if (reqRes.error) { console.error(reqRes.error); showToast('Failed to load leave calendar', 'red') }
      if (!cancelled) {
        setRows(reqRes.data || [])
        setDepartments(depRes.data || [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId, monthStart, monthEnd, reloadKey])

  const filtered = useMemo(() =>
    rows.filter(r => deptFilter === 'all' || r.employee?.department_id === deptFilter),
    [rows, deptFilter]
  )

  // date string -> [{name, type}]
  const byDay = useMemo(() => {
    const m = {}
    for (const r of filtered) {
      const s = r.start_date < monthStart ? monthStart : r.start_date
      const e = r.end_date > monthEnd ? monthEnd : r.end_date
      for (let d = new Date(s + 'T00:00:00'); d <= new Date(e + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
        const key = d.toISOString().slice(0, 10)
        if (!m[key]) m[key] = []
        m[key].push({ name: r.employee?.name || '?', type: r.leave_type?.name || '' })
      }
    }
    return m
  }, [filtered, monthStart, monthEnd])

  // Build the grid: Monday-first offset
  const firstDow = (new Date(ym.y, ym.m, 1).getDay() + 6) % 7   // 0=Mon
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= lastDay; d++) cells.push(d)

  const prevMonth = () => setYm(({ y, m }) => m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 })
  const nextMonth = () => setYm(({ y, m }) => m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 })

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  const todayStr = new Date().toISOString().slice(0, 10)

  return (
    <div>
      <PageHeader title="Leave Calendar" site={currentSite}
        actions={
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            style={{ padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="all">All Departments</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        } />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '18px', marginBottom: '18px' }}>
        <Button variant="outlined" icon="chevron_left" onClick={prevMonth}>Prev</Button>
        <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, minWidth: '190px', textAlign: 'center' }}>
          {MONTHS[ym.m]} {ym.y}
        </div>
        <Button variant="outlined" icon="chevron_right" onClick={nextMonth}>Next</Button>
      </div>

      {loading ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '6px' }}>
            {DOW.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: '11px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.06em' }}>{d}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={'x' + i} />
              const key = `${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
              const people = byDay[key] || []
              const isToday = key === todayStr
              const dow = (firstDow + d - 1) % 7
              const weekend = dow >= 5
              return (
                <div key={key}
                  onClick={() => people.length > 0 && setDayDetail(key)}
                  style={{
                    minHeight: '86px', padding: '8px', borderRadius: '10px',
                    background: weekend ? THEME.surfaceVar : THEME.surface,
                    border: isToday ? `2px solid ${ACCENT}` : `1px solid ${THEME.outlineVar}`,
                    cursor: people.length > 0 ? 'pointer' : 'default',
                  }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: isToday ? ACCENT : THEME.textMed, marginBottom: '4px' }}>{d}</div>
                  {people.slice(0, 3).map((p, j) => (
                    <div key={j} style={{
                      fontSize: '10px', fontWeight: 600, color: ACCENT,
                      background: ACCENT + '14', borderRadius: '4px',
                      padding: '1px 5px', marginBottom: '2px',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{p.name}</div>
                  ))}
                  {people.length > 3 && (
                    <div style={{ fontSize: '10px', color: THEME.textLow }}>+{people.length - 3} more</div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      <Modal open={!!dayDetail} onClose={() => setDayDetail(null)} title={dayDetail ? `On leave — ${dayDetail}` : ''}>
        {(byDay[dayDetail] || []).map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px' }}>
            <span style={{ fontWeight: 600, color: THEME.text }}>{p.name}</span>
            <span style={{ color: THEME.textLow }}>{p.type}</span>
          </div>
        ))}
      </Modal>
    </div>
  )
}
