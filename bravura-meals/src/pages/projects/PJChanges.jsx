import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle } from '../../components/dash'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.projects

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const STATUS_COLORS = {
  draft:        { bg: '#F5F5F5', text: '#757575' },
  submitted:    { bg: '#E3F2FD', text: '#1565C0' },
  under_review: { bg: '#FFF3E0', text: '#E65100' },
  approved:     { bg: '#E8F5E9', text: '#2E7D32' },
  rejected:     { bg: '#FFEBEE', text: '#C62828' },
  implemented:  { bg: '#F3E5F5', text: '#6A1B9A' },
}

export default function PJChanges({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('project_change_orders')

  const [orders, setOrders] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterProject, setFilterProject] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

  useEffect(() => {
    if (!currentSiteId) return
    async function fetch() {
      setLoading(true)
      const [pRes, coRes] = await Promise.all([
        supabase.from('projects').select('id, name, project_number').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
        supabase.from('project_change_orders').select('*, project:projects!inner(id, name, project_number, site_id), requester:profiles!project_change_orders_requested_by_fkey(full_name)').eq('project.site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }),
      ])
      setProjects(pRes.data || [])
      setOrders(coRes.data || [])
      setLoading(false)
    }
    fetch()
  }, [currentSiteId, rt])

  const filtered = useMemo(() => {
    let f = orders
    if (filterProject) f = f.filter(o => o.project_id === filterProject)
    if (filterStatus) f = f.filter(o => o.status === filterStatus)
    return f
  }, [orders, filterProject, filterStatus])

  const stats = useMemo(() => {
    const approved = filtered.filter(o => o.status === 'approved' || o.status === 'implemented')
    return {
      total: filtered.length,
      pending: filtered.filter(o => ['draft', 'submitted', 'under_review'].includes(o.status)).length,
      approved: approved.length,
      totalCostImpact: approved.reduce((s, o) => s + Number(o.cost_impact || 0), 0),
      totalScheduleImpact: approved.reduce((s, o) => s + Number(o.schedule_impact_days || 0), 0),
    }
  }, [filtered])

  if (!can('projects.view')) return null

  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit',
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_changes" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Change Orders</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>Scope, cost, and schedule changes across all projects</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={inp}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.project_number} — {p.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={inp}>
            <option value="">All Statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
          </select>
          <button onClick={() => exportCsv('change-orders.csv',
            ['Project', 'CO#', 'Title', 'Status', 'Impact Type', 'Cost Impact', 'Schedule Days', 'Requested By', 'Date'],
            filtered.map(o => [o.project?.name, o.change_order_number, o.title, o.status, o.impact_type, o.cost_impact, o.schedule_impact_days, o.requester?.full_name, o.requested_date])
          )} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, background: color + '18', color, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            Export CSV
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard icon="swap_horiz" label="Total COs" value={stats.total} accent={color} />
        <KpiCard icon="pending" label="Pending" value={stats.pending} accent="#E65100" />
        <KpiCard icon="check_circle" label="Approved" value={stats.approved} accent="#2E7D32" />
        <KpiCard icon="payments" label="Cost Impact" value={fmtMoney(stats.totalCostImpact)} accent="#C62828" sub="Approved COs" />
        <KpiCard icon="schedule" label="Schedule Impact" value={`${stats.totalScheduleImpact}d`} accent="#1565C0" sub="Approved COs" />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={32} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <DashCard style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <Icon name="swap_horiz" size={48} style={{ display: 'block', margin: '0 auto 12px', color: THEME.outline }} />
          <div style={{ fontSize: '14px' }}>No change orders found. Create them inside each project's Costs & EVM tab.</div>
        </DashCard>
      ) : (
        <DashCard>
          <SectionTitle title="Change Orders" subtitle={`${filtered.length} orders`} />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Project', 'CO #', 'Title', 'Status', 'Impact', 'Cost Impact', 'Schedule', 'Requested By', 'Date'].map((h, i) => (
                    <th key={i} style={{ padding: '8px 10px', textAlign: i >= 5 && i <= 6 ? 'right' : 'left', fontWeight: 600, color: THEME.textLow, fontSize: '11px', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const sc = STATUS_COLORS[o.status] || STATUS_COLORS.draft
                  return (
                    <tr key={o.id} style={{ borderTop: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: THEME.text, whiteSpace: 'nowrap' }}>{o.project?.project_number}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color }}>{o.change_order_number}</td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: sc.bg, color: sc.text }}>
                          {o.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed, fontSize: '11px' }}>{(o.impact_type || '').replace(/_/g, ' ')}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: Number(o.cost_impact) > 0 ? '#C62828' : Number(o.cost_impact) < 0 ? '#2E7D32' : THEME.textMed }}>{fmtMoney(o.cost_impact)}</td>
                      <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{o.schedule_impact_days || 0}d</td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed }}>{o.requester?.full_name || '—'}</td>
                      <td style={{ padding: '8px 10px', color: THEME.textLow, fontSize: '12px' }}>{o.requested_date || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DashCard>
      )}
    </div>
  )
}
