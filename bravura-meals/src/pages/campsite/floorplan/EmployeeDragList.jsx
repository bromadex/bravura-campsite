import { useState, useMemo } from 'react'
import { THEME } from '../../../utils/permissions'
import { Icon, initials } from '../../../components/ui'

// ── Draggable roster of unassigned people ─────────────────────────────────────
// Sits in a collapsible left rail. Drag an employee card onto a room in the
// floorplan to assign them. Also supports dragging a whole contractor's team.
export default function EmployeeDragList({ employees, contractors, assignments, onDragStart, onDragEnd }) {
  const [search, setSearch]   = useState('')
  const [coFilter, setCoFilter] = useState('all')
  const [collapsed, setCollapsed] = useState(false)

  const assignedIds = new Set(assignments.filter(a => a.status === 'active' && a.employee_id).map(a => a.employee_id))
  const unassigned = useMemo(() => employees.filter(e => !assignedIds.has(e.id)), [employees, assignedIds])

  const filtered = unassigned.filter(e => {
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase())
    const matchCo = coFilter === 'all' || e.contractor_id === coFilter
    return matchSearch && matchCo
  })

  // Group by contractor for "drag whole team" capability
  const grouped = {}
  filtered.forEach(e => {
    const key = e.contractor?.name || 'Unassigned Contractor'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(e)
  })

  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          width: '40px', background: '#fff', borderRight: `1px solid ${THEME.outlineVar}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '16px',
          cursor: 'pointer', gap: '8px',
        }}
      >
        <Icon name="chevron_right" size={20} style={{ color: THEME.textMed }} />
        <div style={{ writingMode: 'vertical-rl', fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginTop: '8px' }}>
          Unassigned ({unassigned.length})
        </div>
      </div>
    )
  }

  return (
    <div style={{
      width: '260px', background: '#fff', borderRight: `1px solid ${THEME.outlineVar}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text }}>Unassigned</div>
          <div style={{ fontSize: '11px', color: THEME.textLow }}>{unassigned.length} people · drag to assign</div>
        </div>
        <button onClick={() => setCollapsed(true)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}>
          <Icon name="chevron_left" size={18} style={{ color: THEME.textMed }} />
        </button>
      </div>

      {/* Search + filter */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
        <div style={{ position: 'relative', marginBottom: '8px' }}>
          <Icon name="search" size={15} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', padding: '6px 10px 6px 28px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '12px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
        <select value={coFilter} onChange={e => setCoFilter(e.target.value)}
          style={{ width: '100%', padding: '6px 8px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '12px', fontFamily: 'inherit', outline: 'none' }}>
          <option value="all">All contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* List, grouped by contractor */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {Object.keys(grouped).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 12px', color: THEME.textLow, fontSize: '12px' }}>
            <Icon name="check_circle" size={28} style={{ color: THEME.outline, display: 'block', margin: '0 auto 8px' }} />
            Everyone is assigned
          </div>
        ) : Object.entries(grouped).map(([coName, people]) => (
          <div key={coName} style={{ marginBottom: '12px' }}>
            <div
              draggable
              onDragStart={e => {
                e.dataTransfer.setData('application/json', JSON.stringify({ type: 'team', employeeIds: people.map(p => p.id) }))
                onDragStart?.({ type: 'team', people })
              }}
              onDragEnd={onDragEnd}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px',
                fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase',
                letterSpacing: '.04em', cursor: 'grab', borderRadius: '8px',
              }}
              title="Drag whole team onto a room"
            >
              <Icon name="drag_indicator" size={14} style={{ color: THEME.outline }} />
              {coName} ({people.length})
            </div>
            {people.map(emp => (
              <div
                key={emp.id}
                draggable
                onDragStart={e => {
                  e.dataTransfer.setData('application/json', JSON.stringify({ type: 'employee', employeeId: emp.id }))
                  onDragStart?.({ type: 'employee', employee: emp })
                }}
                onDragEnd={onDragEnd}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px', padding: '7px 8px',
                  borderRadius: '10px', cursor: 'grab', marginBottom: '2px',
                  border: `1px solid ${THEME.outlineVar}`, background: '#fff',
                  transition: 'background .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                onMouseLeave={e => e.currentTarget.style.background = '#fff'}
              >
                <div style={{
                  width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                  background: emp.gender === 'female' ? '#F8BBD0' : '#90CAF9',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', fontWeight: 700, color: '#fff',
                }}>
                  {initials(emp.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {emp.name}
                  </div>
                </div>
                <Icon name="drag_indicator" size={14} style={{ color: THEME.outline, flexShrink: 0 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
