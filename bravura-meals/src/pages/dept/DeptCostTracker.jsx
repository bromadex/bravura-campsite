import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard, KpiCard } from '../../components/dash'

const color = MODULE_COLORS.dept || '#1565C0'

const fmt$ = v => v ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'

export default function DeptCostTracker({ setPage }) {
  const { currentSiteId } = useSite()
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [projRes, taskRes] = await Promise.all([
      supabase.from('dept_projects').select('*, department:departments(id, name, color)').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
      supabase.from('dept_tasks').select('id, project_id, estimated_cost, actual_cost, status, title, assigned_to, assignee:employees!dept_tasks_assigned_to_fkey(first_name, last_name)').eq('is_archived', false),
    ])
    setProjects(projRes.data || [])
    setTasks(taskRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  const totalBudget = projects.reduce((s, p) => s + Number(p.budget || 0), 0)
  const totalSpent = projects.reduce((s, p) => s + Number(p.spent || 0), 0)
  const totalEstimated = tasks.reduce((s, t) => s + Number(t.estimated_cost || 0), 0)
  const totalActual = tasks.reduce((s, t) => s + Number(t.actual_cost || 0), 0)
  const budgetPct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, marginBottom: '20px' }}>Cost Tracker</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <KpiCard icon="account_balance" label="Total Budget" value={loading ? '…' : fmt$(totalBudget)} accent="#1E88E5" progress={budgetPct} sub={`${budgetPct}% utilised`} />
        <KpiCard icon="payments" label="Total Spent" value={loading ? '…' : fmt$(totalSpent)} accent={totalSpent > totalBudget ? '#E53935' : '#2E7D32'} />
        <KpiCard icon="calculate" label="Estimated (Tasks)" value={loading ? '…' : fmt$(totalEstimated)} accent="#D97706" />
        <KpiCard icon="receipt" label="Actual (Tasks)" value={loading ? '…' : fmt$(totalActual)} accent="#7C4DFF" />
      </div>

      <DashCard>
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Project Budget vs Spend</div>
        {loading ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
        ) : projects.length === 0 ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>No projects yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {projects.map(p => {
              const budget = Number(p.budget || 0)
              const spent = Number(p.spent || 0)
              const pct = budget ? Math.min(100, Math.round((spent / budget) * 100)) : 0
              const over = spent > budget
              return (
                <div key={p.id} style={{ padding: '12px', borderRadius: '12px', background: THEME.surfaceVar + '40' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{p.name}</span>
                      <span style={{ fontSize: '11px', color: p.department?.color || color }}>{p.department?.name}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: over ? '#E53935' : THEME.textMed }}>
                      {fmt$(spent)} / {fmt$(budget)}
                    </div>
                  </div>
                  <div style={{ height: '6px', borderRadius: '3px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: over ? '#E53935' : '#2E7D32', borderRadius: '3px', transition: 'width .4s' }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </DashCard>

      {/* Task-level costs */}
      <DashCard style={{ marginTop: '20px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '14px' }}>Task Cost Breakdown</div>
        {loading ? (
          <div style={{ color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '600px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                  {['Task', 'Assignee', 'Estimated', 'Actual', 'Variance'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.filter(t => Number(t.estimated_cost || 0) > 0 || Number(t.actual_cost || 0) > 0).map(t => {
                  const est = Number(t.estimated_cost || 0)
                  const act = Number(t.actual_cost || 0)
                  const variance = act - est
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 12px', color: THEME.text }}>{t.title}</td>
                      <td style={{ padding: '8px 12px', color: THEME.textMed }}>{t.assignee ? `${t.assignee.first_name} ${t.assignee.last_name}` : '—'}</td>
                      <td style={{ padding: '8px 12px', color: THEME.text }}>{fmt$(est)}</td>
                      <td style={{ padding: '8px 12px', color: THEME.text }}>{fmt$(act)}</td>
                      <td style={{ padding: '8px 12px', color: variance > 0 ? '#E53935' : variance < 0 ? '#2E7D32' : THEME.textLow, fontWeight: 600 }}>
                        {variance > 0 ? '+' : ''}{fmt$(variance)}
                      </td>
                    </tr>
                  )
                })}
                {tasks.filter(t => Number(t.estimated_cost || 0) > 0 || Number(t.actual_cost || 0) > 0).length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '20px', textAlign: 'center', color: THEME.textLow }}>No task costs recorded yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </DashCard>
    </div>
  )
}
