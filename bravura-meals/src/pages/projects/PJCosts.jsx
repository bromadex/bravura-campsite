import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast, Icon } from '../../components/ui'
import { DashCard, KpiCard, SectionTitle } from '../../components/dash'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.projects

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PJCosts({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('project_cost_items')

  const [items, setItems] = useState([])
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterProject, setFilterProject] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  useEffect(() => {
    if (!currentSiteId) return
    async function fetch() {
      setLoading(true)
      const [pRes, ciRes] = await Promise.all([
        supabase.from('projects').select('id, name, project_number, budget').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
        supabase.from('project_cost_items').select('*, project:projects!inner(id, name, project_number, site_id)').eq('project.site_id', currentSiteId).eq('is_archived', false).order('cbs_code'),
      ])
      setProjects(pRes.data || [])
      setItems(ciRes.data || [])
      setLoading(false)
    }
    fetch()
  }, [currentSiteId, rt])

  const filtered = useMemo(() => {
    let f = items
    if (filterProject) f = f.filter(i => i.project_id === filterProject)
    if (filterCategory) f = f.filter(i => i.category === filterCategory)
    return f
  }, [items, filterProject, filterCategory])

  const totals = useMemo(() => filtered.reduce((a, i) => ({
    budgeted: a.budgeted + Number(i.budgeted_cost || 0),
    committed: a.committed + Number(i.committed_cost || 0),
    actual: a.actual + Number(i.actual_cost || 0),
    etc: a.etc + Number(i.estimate_to_complete || 0),
    eac: a.eac + Number(i.estimate_at_completion || 0),
  }), { budgeted: 0, committed: 0, actual: 0, etc: 0, eac: 0 }), [filtered])

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))].sort()

  if (!can('projects.view')) return null

  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit',
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_costs" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Costs & EVM Overview</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>Cost breakdown across all projects</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} style={inp}>
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.project_number} — {p.name}</option>)}
          </select>
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={inp}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
          </select>
          <button onClick={() => exportCsv('project-costs.csv',
            ['Project', 'CBS Code', 'Description', 'Category', 'Type', 'Budgeted', 'Committed', 'Actual', 'ETC', 'EAC'],
            filtered.map(i => [i.project?.name, i.cbs_code, i.description, i.category, i.cost_type, i.budgeted_cost, i.committed_cost, i.actual_cost, i.estimate_to_complete, i.estimate_at_completion])
          )} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 500, background: color + '18', color, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            Export CSV
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <KpiCard icon="account_balance" label="Budgeted" value={fmtMoney(totals.budgeted)} accent={color} />
        <KpiCard icon="handshake" label="Committed" value={fmtMoney(totals.committed)} accent="#1565C0" />
        <KpiCard icon="payments" label="Actual" value={fmtMoney(totals.actual)} accent="#E65100" />
        <KpiCard icon="trending_up" label="ETC" value={fmtMoney(totals.etc)} accent="#2E7D32" />
        <KpiCard icon="calculate" label="EAC" value={fmtMoney(totals.eac)} accent="#6A1B9A" />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={32} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <DashCard style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <Icon name="payments" size={48} style={{ display: 'block', margin: '0 auto 12px', color: THEME.outline }} />
          <div style={{ fontSize: '14px' }}>No cost items found. Add CBS items inside each project's Costs & EVM tab.</div>
        </DashCard>
      ) : (
        <DashCard>
          <SectionTitle title="Cost Items" subtitle={`${filtered.length} items`} />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  {['Project', 'CBS Code', 'Description', 'Category', 'Type', 'Budgeted', 'Committed', 'Actual', 'ETC', 'EAC'].map((h, i) => (
                    <th key={i} style={{ padding: '8px 10px', textAlign: i < 5 ? 'left' : 'right', fontWeight: 600, color: THEME.textLow, fontSize: '11px', whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '.03em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, idx) => (
                  <tr key={item.id} style={{ borderTop: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color: THEME.text, whiteSpace: 'nowrap' }}>{item.project?.project_number || ''}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 600, color }}>{item.cbs_code}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed }}>{item.category}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textLow, fontSize: '11px' }}>{item.cost_type}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{fmtMoney(item.budgeted_cost)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{fmtMoney(item.committed_cost)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: THEME.text }}>{fmtMoney(item.actual_cost)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>{fmtMoney(item.estimate_to_complete)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: Number(item.estimate_at_completion) > Number(item.budgeted_cost) ? '#C62828' : THEME.text }}>{fmtMoney(item.estimate_at_completion)}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${THEME.outline}`, fontWeight: 700 }}>
                  <td colSpan={5} style={{ padding: '10px', color: THEME.text }}>Totals</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmtMoney(totals.budgeted)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmtMoney(totals.committed)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmtMoney(totals.actual)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmtMoney(totals.etc)}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: totals.eac > totals.budgeted ? '#C62828' : THEME.text }}>{fmtMoney(totals.eac)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </DashCard>
      )}
    </div>
  )
}
