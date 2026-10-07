import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { usePermissions } from '../../contexts/PermissionsContext'
import { friendlyError } from '../../utils/friendlyError'
import { FIN, finCard, finBtn, finBtn2, finInput } from '../../utils/financeTheme'
import { fmtDate, usePeople } from './pjShared'

const LEVEL = { critical: [FIN.bad, '#FBEDEC'], high: [FIN.ochreText, FIN.ochreTint], medium: [FIN.blue, FIN.blueTint], low: [FIN.good, FIN.goodTint] }

// Risks tab (#76 PJ-F): the project's rows in the SHEQ risk register (same register, tagged with the project).
export default function PJRisks({ projectId }) {
  const { can } = usePermissions()
  const people = usePeople()
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null)
  const load = useCallback(() => {
    supabase.rpc('pj_risks', { p_project: projectId }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'error')
      setList(data || [])
    })
  }, [projectId])
  useEffect(() => { load() }, [load])

  async function save() {
    const { error } = await supabase.rpc('pj_risk_add', { p_project: projectId, p: form })
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Risk added to the SHEQ risk register'); setForm(null); load()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontFamily: FIN.sans, color: FIN.ink }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: FIN.muted }}>Risks live in the SHEQ risk register, tagged with this project.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/sheq/sq_risk_register" style={{ ...finBtn2, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>Open SHEQ register</a>
          {can('projects.edit') && !form && <button onClick={() => setForm({ title: '', hazard: '', consequence: '', controls: '', likelihood: 3, severity: 3, owner_id: '', review_date: '' })} style={finBtn}>Add risk</button>}
        </div>
      </div>

      {form && (
        <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={lbl}>Risk<input autoFocus value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="e.g. Crane lift over live conveyor" style={finInput} /></label>
          <div style={grid}>
            <label style={lbl}>Hazard<input value={form.hazard} onChange={e => setForm({ ...form, hazard: e.target.value })} style={finInput} /></label>
            <label style={lbl}>What could happen<input value={form.consequence} onChange={e => setForm({ ...form, consequence: e.target.value })} style={finInput} /></label>
          </div>
          <label style={lbl}>Controls in place<input value={form.controls} onChange={e => setForm({ ...form, controls: e.target.value })} style={finInput} /></label>
          <div style={grid}>
            <label style={lbl}>Likelihood (1–5)<input type="number" min="1" max="5" value={form.likelihood} onChange={e => setForm({ ...form, likelihood: e.target.value })} style={finInput} /></label>
            <label style={lbl}>Severity (1–5)<input type="number" min="1" max="5" value={form.severity} onChange={e => setForm({ ...form, severity: e.target.value })} style={finInput} /></label>
            <label style={lbl}>Owner<select value={form.owner_id} onChange={e => setForm({ ...form, owner_id: e.target.value })} style={finInput}>
              <option value="">—</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label style={lbl}>Review by<input type="date" value={form.review_date} onChange={e => setForm({ ...form, review_date: e.target.value })} style={finInput} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setForm(null)} style={finBtn2}>Cancel</button>
            <button onClick={save} disabled={!form.title.trim()} style={finBtn}>Save risk</button>
          </div>
        </div>
      )}

      {!list ? <div style={{ color: FIN.faint }}>Loading…</div> : list.length === 0 ? (
        <div style={{ ...finCard, fontSize: 14, color: FIN.muted }}>No risks recorded for this project yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {list.map(r => {
            const [c, bg] = LEVEL[r.level] || LEVEL.low
            return (
              <div key={r.id} style={{ ...finCard, padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: bg, color: c, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, flexShrink: 0 }}>{r.score ?? '—'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{r.title} <span style={{ fontSize: 12, color: FIN.faint, fontWeight: 400 }}>{r.number}</span></div>
                  <div style={{ fontSize: 12, color: FIN.muted }}>
                    <span style={{ color: c, fontWeight: 600, textTransform: 'capitalize' }}>{r.level || '—'}</span>
                    {r.residual_level ? ` → ${r.residual_level} after controls` : ''}{r.owner ? ` · ${r.owner}` : ''}{r.review_date ? ` · review ${fmtDate(r.review_date)}` : ''}
                    {r.controls ? ` · ${r.controls}` : ''}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: FIN.muted, textTransform: 'capitalize' }}>{r.status}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: FIN.muted, flex: '1 1 160px' }
const grid = { display: 'flex', gap: 10, flexWrap: 'wrap' }
