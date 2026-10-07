import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { useSite } from '../../contexts/SiteContext'
import { friendlyError } from '../../utils/friendlyError'
import { FIN, finCard, money } from '../../utils/financeTheme'
import { exportCsv } from '../../utils/csv'
import { fmtDate } from './pjShared'

// Money across all projects (#76): budget, spent from the books + approved time, committed on open POs, approved
// change orders, and change orders waiting for a decision. Replaces the old Costs & EVM / Change Orders pages.
export default function PJPortfolioMoney({ setPage }) {
  const { currentSiteId } = useSite()
  const [d, setD] = useState(null)
  useEffect(() => {
    if (!currentSiteId) return
    supabase.rpc('pj_portfolio_money', { p_site: currentSiteId }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'error')
      setD(data || { projects: [], pending_changes: [] })
    })
  }, [currentSiteId])
  if (!d) return <div style={{ color: FIN.faint }}>Loading…</div>

  const sum = k => d.projects.reduce((s, p) => s + Number(p[k] || 0), 0)
  const tot = { budget: sum('budget'), spent: sum('spent'), committed: sum('committed') }
  const open = id => setPage('pj_detail_' + id + ':money')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
        <Fig label="Budgets" v={tot.budget} />
        <Fig label="Spent" v={tot.spent} />
        <Fig label="Committed on open POs" v={tot.committed} />
        <Fig label="Left" v={tot.budget - tot.spent - tot.committed} color={tot.budget - tot.spent - tot.committed < 0 ? FIN.bad : FIN.good} />
      </div>

      <div style={finCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>By project</div>
          <button onClick={() => exportCsv('project-money.csv', ['Code', 'Project', 'Budget', 'Spent', 'Committed', 'Left', 'Approved changes'],
            d.projects.map(p => [p.code, p.name, p.budget, p.spent, p.committed, p.budget - p.spent - p.committed, p.changes_approved]))}
            style={{ background: 'none', border: 'none', color: FIN.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Download CSV</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Project', 'Budget', 'Spent', 'Committed', 'Left', 'Used', 'Changes'].map((h, i) => <th key={h} style={{ ...th, textAlign: i ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {d.projects.length === 0 && <tr><td colSpan={7} style={{ padding: 12, color: FIN.faint }}>No projects.</td></tr>}
              {d.projects.map(p => {
                const left = p.budget - p.spent - p.committed
                const used = p.budget ? Math.round((p.spent + p.committed) / p.budget * 100) : null
                return (
                  <tr key={p.id} onClick={() => open(p.id)} style={{ borderTop: `1px solid ${FIN.line}`, cursor: 'pointer' }}>
                    <td style={td}><div style={{ fontWeight: 600, color: FIN.blue }}>{p.name}</div><div style={{ fontSize: 11, color: FIN.faint }}>{p.code}</div></td>
                    <td style={tdn}>${money(p.budget)}</td>
                    <td style={tdn}>${money(p.spent)}</td>
                    <td style={tdn}>${money(p.committed)}</td>
                    <td style={{ ...tdn, color: left < 0 ? FIN.bad : FIN.ink, fontWeight: 600 }}>${money(left)}</td>
                    <td style={{ ...tdn, color: used > 100 ? FIN.bad : used >= 90 ? FIN.ochreText : FIN.muted }}>{used == null ? '—' : used + '%'}</td>
                    <td style={tdn}>{p.changes_approved ? '$' + money(p.changes_approved) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={finCard}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Change orders waiting for a decision</div>
        {d.pending_changes.length === 0 ? <div style={{ fontSize: 13, color: FIN.muted }}>None waiting.</div> : d.pending_changes.map(c => (
          <div key={c.id} onClick={() => setPage('pj_detail_' + c.project_id + ':costs')}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 13, cursor: 'pointer' }}>
            <span><b style={{ color: FIN.blue }}>{c.number}</b> · {c.title} <span style={{ color: FIN.faint }}>— {c.project}{c.requested_date ? ` · ${fmtDate(c.requested_date)}` : ''}</span></span>
            <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{c.cost_impact ? `+$${money(c.cost_impact)}` : ''}{c.days ? ` · ${c.days} d` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
const th = { padding: '6px 8px', fontSize: 11, color: FIN.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const td = { padding: 8 }
const tdn = { padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
const Fig = ({ label, v, color }) => (
  <div style={{ ...finCard, padding: '12px 14px' }}>
    <div style={{ fontSize: 12, color: FIN.muted }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 600, color: color || FIN.ink, fontVariantNumeric: 'tabular-nums' }}>${money(v)}</div>
  </div>
)
