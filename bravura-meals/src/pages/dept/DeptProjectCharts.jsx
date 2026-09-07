import { useState, useEffect, useCallback, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard } from '../../components/dash'

const color = MODULE_COLORS.dept || '#1565C0'
const STATUS_CLR = { not_started: '#78909C', in_progress: '#1E88E5', late: '#E53935', completed: '#2E7D32' }
const STATUS_LABEL = { not_started: 'Not Started', in_progress: 'In Progress', late: 'Late', completed: 'Completed' }
const PRIORITY_CLR = { urgent: '#E53935', important: '#D97706', medium: '#1E88E5', low: '#78909C' }
const BUCKET_CLR = { Initiating: '#7C4DFF', Planning: '#1E88E5', Executing: '#2E7D32', 'Monitoring & Controlling': '#D97706', Closing: '#0277BD' }

function DonutChart({ data, size = 160 }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (!total) return <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.textLow, fontSize: '12px' }}>No data</div>
  const r = size / 2 - 8
  const cx = size / 2
  const cy = size / 2
  let cumAngle = -Math.PI / 2
  const arcs = data.filter(d => d.value > 0).map(d => {
    const angle = (d.value / total) * Math.PI * 2
    const startAngle = cumAngle
    cumAngle += angle
    const endAngle = cumAngle
    const large = angle > Math.PI ? 1 : 0
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    return { ...d, path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z` }
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {arcs.map((a, i) => <path key={i} d={a.path} fill={a.color} opacity={0.85} />)}
      <circle cx={cx} cy={cy} r={r * 0.55} fill={THEME.surface} />
      <text x={cx} y={cy - 4} textAnchor="middle" style={{ fontSize: '18px', fontWeight: 700, fill: THEME.text }}>{total}</text>
      <text x={cx} y={cy + 12} textAnchor="middle" style={{ fontSize: '10px', fill: THEME.textLow }}>tasks</text>
    </svg>
  )
}

function BarChart({ data, maxH = 120 }) {
  const max = Math.max(...data.map(d => d.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: maxH + 30 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>{d.value}</div>
          <div style={{ width: '100%', maxWidth: '40px', height: `${(d.value / max) * maxH}px`, background: d.color, borderRadius: '6px 6px 0 0', minHeight: '4px' }} />
          <div style={{ fontSize: '9px', color: THEME.textLow, marginTop: '4px', textAlign: 'center', maxWidth: '60px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
        </div>
      ))}
    </div>
  )
}

export default function DeptProjectCharts({ setPage, projectId }) {
  const { currentSiteId } = useSite()
  const [project, setProject] = useState(null)
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!projectId || !currentSiteId) return
    setLoading(true)
    const [projRes, taskRes] = await Promise.all([
      supabase.from('dept_projects').select('*, department:departments(id, name, color, icon)').eq('id', projectId).maybeSingle(),
      supabase.from('dept_tasks').select('*, assignee:employees!dept_tasks_assigned_to_fkey(id, first_name, last_name)').eq('project_id', projectId).eq('is_archived', false),
    ])
    setProject(projRes.data)
    setTasks(taskRes.data || [])
    setLoading(false)
  }, [projectId, currentSiteId])

  useEffect(() => { load() }, [load])

  const charts = useMemo(() => {
    const statusData = Object.keys(STATUS_CLR).map(s => ({ label: STATUS_LABEL[s], value: tasks.filter(t => t.status === s).length, color: STATUS_CLR[s] }))
    const priorityData = Object.keys(PRIORITY_CLR).map(p => ({ label: p, value: tasks.filter(t => t.priority === p).length, color: PRIORITY_CLR[p] }))
    const bucketData = Object.keys(BUCKET_CLR).map(b => ({ label: b.length > 12 ? b.slice(0, 12) + '…' : b, value: tasks.filter(t => t.bucket === b).length, color: BUCKET_CLR[b] }))

    const memberMap = {}
    tasks.forEach(t => {
      if (t.assignee) {
        const name = `${t.assignee.first_name} ${t.assignee.last_name?.[0] || ''}.`
        memberMap[name] = (memberMap[name] || 0) + 1
      }
    })
    const memberData = Object.entries(memberMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count], i) => ({
      label: name, value: count, color: Object.values(PRIORITY_CLR)[i % 4],
    }))

    return { statusData, priorityData, bucketData, memberData }
  }, [tasks])

  if (loading) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
  if (!project) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>Project not found.</div>

  const dc = project.department?.color || color

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <button onClick={() => setPage('dept_projects')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}>
          <Icon name="arrow_back" size={20} />
        </button>
        <Icon name={project.department?.icon || 'folder'} size={22} style={{ color: dc }} />
        <div>
          <div style={{ fontSize: '18px', fontWeight: 500, color: THEME.text }}>{project.name} — Charts</div>
          <div style={{ fontSize: '12px', color: dc }}>{project.department?.name}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button onClick={() => setPage(`dept_board:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer' }}>Board</button>
          <button onClick={() => setPage(`dept_grid:${projectId}`)} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, fontSize: '12px', cursor: 'pointer' }}>Grid</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        <DashCard>
          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Status Distribution</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <DonutChart data={charts.statusData} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {charts.statusData.map(d => (
                <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: d.color }} />
                  <span style={{ fontSize: '12px', color: THEME.text }}>{d.label}</span>
                  <span style={{ fontSize: '12px', color: THEME.textLow, fontWeight: 600 }}>{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </DashCard>

        <DashCard>
          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Priority Breakdown</div>
          <BarChart data={charts.priorityData} />
        </DashCard>

        <DashCard>
          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Bucket Distribution</div>
          <BarChart data={charts.bucketData} />
        </DashCard>

        <DashCard>
          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Member Workload</div>
          {charts.memberData.length === 0 ? (
            <div style={{ color: THEME.textLow, fontSize: '12px', padding: '20px 0' }}>No assignments yet.</div>
          ) : (
            <BarChart data={charts.memberData} />
          )}
        </DashCard>
      </div>
    </div>
  )
}
