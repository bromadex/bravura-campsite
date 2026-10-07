import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { usePermissions } from '../../contexts/PermissionsContext'
import { friendlyError } from '../../utils/friendlyError'
import { FIN, finCard, money } from '../../utils/financeTheme'
import { fmtDate } from './pjShared'

// Stage gate (#76): close a phase — refuses while tasks are open unless the person says why.
export async function closePhase(ph) {
  const note = window.prompt(`Close the "${ph.name}" phase? Note for the gate (what was delivered):`, '')
  if (note === null) return false
  let { error } = await supabase.rpc('pj_phase_close', { p_phase: ph.id, p_note: note, p_force: false })
  if (error && /OPEN_TASKS:(\d+)/.test(error.message)) {
    const n = error.message.match(/OPEN_TASKS:(\d+)/)[1]
    const why = window.prompt(`${n} task(s) in this phase are still open. Close anyway? Say why:`, note)
    if (!why) return false
    ;({ error } = await supabase.rpc('pj_phase_close', { p_phase: ph.id, p_note: why, p_force: true }))
  }
  if (error) { showToast(friendlyError(error), 'error'); return false }
  showToast('Phase closed')
  return true
}

// Money tab (#76 PJ-E): real costs from the books (bills, Stores issues, fuel, hired plant booked to the project),
// approved labour, open purchase orders, budget per phase with stage gates.
export default function PJMoney({ projectId, onChanged }) {
  const { can } = usePermissions()
  const [d, setD] = useState(null)
  const load = useCallback(() => {
    supabase.rpc('pj_costs', { p_project: projectId }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'error')
      setD(data || { by_category: [], phases: [], open_pos: [], recent: [] })
    })
  }, [projectId])
  useEffect(() => { load() }, [load])

  if (!d) return <div style={{ color: FIN.faint, fontFamily: FIN.sans }}>Loading…</div>
  const actual = d.by_category.reduce((s, c) => s + Number(c.amount), 0)
  const committed = Number(d.committed || 0)
  const budget = Number(d.budget || 0)
  const left = budget - actual - committed
  const pctA = budget ? Math.min(100, actual / budget * 100) : 0
  const pctC = budget ? Math.min(100 - pctA, committed / budget * 100) : 0
  const maxCat = Math.max(1, ...d.by_category.map(c => Math.abs(c.amount)))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FIN.sans, color: FIN.ink }}>
      <div style={finCard}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
          <Fig label="Budget" v={budget} />
          <Fig label="Spent" v={actual} />
          <Fig label="Committed (open POs)" v={committed} />
          <Fig label={left < 0 ? 'Over budget' : 'Left'} v={Math.abs(left)} color={left < 0 ? FIN.bad : FIN.good} />
        </div>
        {budget > 0 && (
          <div style={{ marginTop: 14, height: 10, borderRadius: 5, background: FIN.lineSoft, overflow: 'hidden', display: 'flex' }}>
            <div style={{ width: `${pctA}%`, background: FIN.maroon }} />
            <div style={{ width: `${pctC}%`, background: FIN.ochre }} />
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 12, color: FIN.muted }}>Spent = posted bills, Stores issues, fuel and hired plant booked to this project + approved project time. Change orders raise the budget when approved.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
        <div style={finCard}>
          <H>Where the money went</H>
          {d.by_category.length === 0 ? <Empty>Nothing booked to this project yet. Put the project on POs, Stores issues and fuel fills.</Empty> :
            d.by_category.map(c => (
              <div key={c.category} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{c.category}</span><b style={num}>${money(c.amount)}</b></div>
                <div style={{ height: 6, borderRadius: 3, background: FIN.lineSoft, marginTop: 4 }}><div style={{ width: `${Math.abs(c.amount) / maxCat * 100}%`, height: '100%', borderRadius: 3, background: FIN.blue }} /></div>
              </div>
            ))}
        </div>
        <div style={finCard}>
          <H>Open purchase orders</H>
          {d.open_pos.length === 0 ? <Empty>No open POs on this project.</Empty> : d.open_pos.map(p => (
            <div key={p.id} style={row}><span><b style={{ color: FIN.blue }}>{p.number}</b> · {p.supplier || '—'} <span style={{ color: FIN.faint }}>({p.status.replace(/_/g, ' ')})</span></span><b style={num}>${money(p.open)}</b></div>
          ))}
        </div>
      </div>

      <div style={finCard}>
        <H>Budget per phase · stage gates</H>
        {d.phases.length === 0 ? <Empty>No phases. Add phases (with a budget each) on the Phases tab.</Empty> : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Phase', 'Budget', 'Labour spent', 'Hours', 'Tasks open', 'Gate', ''].map((h, i) => <th key={i} style={{ ...th, textAlign: i && i < 5 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
              <tbody>{d.phases.map(ph => (
                <tr key={ph.id} style={{ borderTop: `1px solid ${FIN.line}` }}>
                  <td style={td}>{ph.name}</td>
                  <td style={{ ...td, ...num, textAlign: 'right' }}>${money(ph.budget)}</td>
                  <td style={{ ...td, ...num, textAlign: 'right', color: ph.budget && ph.labour > ph.budget ? FIN.bad : FIN.ink }}>${money(ph.labour)}</td>
                  <td style={{ ...td, ...num, textAlign: 'right' }}>{Number(ph.hours).toFixed(1)}</td>
                  <td style={{ ...td, ...num, textAlign: 'right' }}>{ph.open} / {ph.tasks}</td>
                  <td style={td}>{ph.gate_closed_at
                    ? <span style={{ color: FIN.good }}>Closed {fmtDate(ph.gate_closed_at)} · left ${money(ph.leftover)}{ph.gate_note ? ` · ${ph.gate_note}` : ''}</span>
                    : <span style={{ color: FIN.faint }}>Open</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{!ph.gate_closed_at && can('projects.edit') &&
                    <button onClick={async () => { if (await closePhase(ph)) { load(); onChanged?.() } }} style={smallBtn}>Close phase</button>}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={finCard}>
        <H>Latest costs from the books</H>
        {d.recent.length === 0 ? <Empty>No postings yet.</Empty> : d.recent.map((r, i) => (
          <div key={i} style={row}><span><span style={{ color: FIN.faint, ...num }}>{fmtDate(r.date)}</span> · <b style={{ color: FIN.blue }}>{r.ref}</b> · {r.what || r.account}</span><b style={num}>${money(r.amount)}</b></div>
        ))}
      </div>
    </div>
  )
}

const num = { fontVariantNumeric: 'tabular-nums' }
const row = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderTop: `1px solid ${FIN.lineSoft}`, fontSize: 13 }
const th = { padding: '6px 8px', fontSize: 11, color: FIN.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const td = { padding: '8px' }
const smallBtn = { padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#fff', color: FIN.maroon, border: `1px solid ${FIN.field}`, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }
const H = ({ children }) => <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{children}</div>
const Empty = ({ children }) => <div style={{ fontSize: 13, color: FIN.muted }}>{children}</div>
const Fig = ({ label, v, color }) => (
  <div><div style={{ fontSize: 11, color: FIN.faint, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 600, color: color || FIN.ink, ...num }}>${money(v)}</div></div>
)
