import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { FIN, finCard, money } from '../../utils/financeTheme'

// Plant-area roll-up (#76): tasks grouped by their area code (AC-49 …) — progress, late, blocked, hours and labour.
export default function PJAreaRollup({ projectId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { supabase.rpc('pj_area_rollup', { p_project: projectId }).then(({ data }) => setRows(data || [])) }, [projectId])
  if (!rows) return null
  if (rows.length === 0) return null
  return (
    <div style={{ ...finCard, fontFamily: FIN.sans, color: FIN.ink, marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Progress by area code</div>
      <div style={{ fontSize: 12, color: FIN.muted, marginBottom: 10 }}>From each task's area code. Labour = approved project time.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{['Area', 'Progress', 'Open', 'Late', 'Blocked', 'Hours', 'Labour'].map((h, i) => <th key={h} style={{ padding: '6px 8px', fontSize: 11, color: FIN.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', textAlign: i > 1 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>{rows.map(r => {
            const pct = r.tasks ? Math.round(r.done / r.tasks * 100) : 0
            return (
              <tr key={r.area} style={{ borderTop: `1px solid ${FIN.line}` }} title={r.titles}>
                <td style={{ padding: 8, fontWeight: 600, color: r.area === 'No area' ? FIN.faint : FIN.blue, whiteSpace: 'nowrap' }}>{r.area}</td>
                <td style={{ padding: 8, minWidth: 140 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: FIN.lineSoft }}><div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct === 100 ? FIN.good : FIN.maroon }} /></div>
                    <span style={{ fontSize: 12, color: FIN.muted, fontVariantNumeric: 'tabular-nums', width: 64 }}>{r.done}/{r.tasks}</span>
                  </div>
                </td>
                <td style={cell}>{r.open}</td>
                <td style={{ ...cell, color: r.overdue ? FIN.bad : FIN.faint }}>{r.overdue}</td>
                <td style={{ ...cell, color: r.blocked ? FIN.bad : FIN.faint }}>{r.blocked}</td>
                <td style={cell}>{Number(r.hours).toFixed(1)}</td>
                <td style={cell}>${money(r.labour)}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
    </div>
  )
}
const cell = { padding: 8, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
