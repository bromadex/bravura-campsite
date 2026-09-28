import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { friendlyError } from '../../utils/friendlyError'
import FinShell from '../../components/FinShell'
import { useAskContext } from '../../components/AskBravura'
import { FIN, finBtn, finBtn2, finInput, finCard } from '../../utils/financeTheme'
import { HEALTH, ago, fmtDate } from './pjShared'
import { Avatar } from '../../components/TaskDrawer'

// PJ01 Projects home (#76): the portfolio at a glance. Health is measured from the work (overdue tasks,
// late milestones, target date, budget used, stuck work — pj_health); a manager can override it in a weekly update,
// and the card says so when the two disagree.
const money = n => '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })

export default function PJHome({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [d, setD] = useState(null)
  const [upd, setUpd] = useState(null)   // project being updated

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.rpc('pj_home', { p_site: currentSiteId })
    if (error) return showToast(friendlyError(error), 'error')
    setD(data)
  }, [currentSiteId])
  useEffect(() => { load() }, [load])
  useAskContext(d && { screen: 'Projects home', projects: (d.projects || []).map(p => ({ name: p.name, health: p.h?.health, progress: p.h?.progress, overdue: p.h?.overdue, reasons: p.h?.reasons })) })

  const ps = d?.projects || []
  const n = k => ps.filter(p => p.h?.health === k).length

  return (
    <FinShell module="Projects" homePage="pj_dashboard" setPage={setPage} title="Projects"
      subtitle="Every project's health, measured from the work — worst first."
      actions={<>
        <button onClick={() => setPage('pj_workspace')} style={finBtn2}>My workspace</button>
        {can('projects.create') && <button onClick={() => setPage('pj_projects')} style={finBtn}>+ New project</button>}
      </>}>
      {!d ? <div style={{ color: FIN.faint }}>Loading…</div> : <>
        {/* band */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <Fig label="Off track" value={n('off_track')} color={HEALTH.off_track.color} />
          <Fig label="At risk" value={n('at_risk')} color={HEALTH.at_risk.color} />
          <Fig label="On track" value={n('on_track')} color={HEALTH.on_track.color} />
          <Fig label="Due in 7 days" value={d.due_week} />
          <Fig label="Hours this week" value={Number(d.hours_week || 0).toFixed(0)} onClick={() => setPage('pj_time')} />
          {d.time_to_approve > 0 && <Fig label="Time to approve" value={d.time_to_approve} color={FIN.maroon} onClick={() => setPage('pj_time:approve')} />}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 16 }} className="pj-home-grid">
          <style>{`@media (min-width: 1180px) { .pj-home-grid { grid-template-columns: minmax(0,1fr) 300px !important; } }`}</style>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, alignContent: 'start' }}>
            {ps.length === 0 && <div style={{ ...finCard, color: FIN.faint }}>No projects at this site yet.</div>}
            {ps.map(p => <ProjectCard key={p.id} p={p} onOpen={() => setPage('pj_detail_' + p.id)} onUpdate={() => setUpd(p)} canEdit={can('projects.edit')} />)}
          </div>
          <div style={{ ...finCard, alignSelf: 'start' }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: FIN.muted, marginBottom: 10 }}>Who has what</div>
            {(d.workload || []).length === 0 && <div style={{ fontSize: 13, color: FIN.faint }}>No open tasks are assigned.</div>}
            {(() => {
              const max = Math.max(1, ...(d.workload || []).map(w => w.open))
              return (d.workload || []).map(w => (
                <div key={w.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <Avatar name={w.name} size={26} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', color: FIN.muted }}>{w.open}{w.overdue > 0 && <b style={{ color: FIN.bad }}> · {w.overdue} late</b>}</span>
                    </div>
                    <div style={{ height: 6, background: FIN.lineSoft, borderRadius: 3, marginTop: 3, display: 'flex', overflow: 'hidden' }}>
                      <div style={{ width: `${100 * (w.open - w.overdue) / max}%`, background: FIN.blue }} />
                      <div style={{ width: `${100 * w.overdue / max}%`, background: FIN.bad }} />
                    </div>
                  </div>
                </div>
              ))
            })()}
          </div>
        </div>
      </>}
      {upd && <UpdateModal p={upd} onClose={() => setUpd(null)} onSaved={() => { setUpd(null); load() }} />}
    </FinShell>
  )
}

function ProjectCard({ p, onOpen, onUpdate, canEdit }) {
  const h = p.h || {}
  const H = HEALTH[h.health] || HEALTH.on_track
  const m = h.money || {}
  const overridden = h.set && h.set !== h.measured
  return (
    <div style={{ ...finCard, padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: 4, background: H.color }} />
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <button onClick={onOpen} style={{ flex: 1, textAlign: 'left', border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: FIN.sans }}>
            <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: FIN.muted }}>{p.code}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: FIN.ink, lineHeight: 1.3 }}>{p.name}</div>
          </button>
          <span style={{ fontSize: 12, fontWeight: 700, color: H.color, background: H.tint, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>{H.label}</span>
        </div>
        {/* progress */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: FIN.muted }}>
            <span>{h.done}/{h.total} tasks done</span><b style={{ color: FIN.ink, fontVariantNumeric: 'tabular-nums' }}>{Math.round(h.progress || 0)}%</b>
          </div>
          <div style={{ height: 8, background: FIN.lineSoft, borderRadius: 4, marginTop: 4, overflow: 'hidden' }}>
            <div style={{ width: `${h.progress || 0}%`, height: '100%', background: H.color }} />
          </div>
        </div>
        {(h.reasons || []).length > 0 && <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: FIN.ink, lineHeight: 1.5 }}>
          {h.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
        {overridden && <div style={{ fontSize: 12, color: FIN.ochreText }}>Set to “{HEALTH[h.set]?.label}” by hand; the work says “{HEALTH[h.measured]?.label}”.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, fontSize: 12 }}>
          <Mini label="Budget" value={m.budget ? money(m.budget) : '—'} />
          <Mini label="Spent" value={money(m.actual)} />
          <Mini label="Committed" value={money(m.committed)} />
        </div>
        {m.used_pct != null && <div style={{ height: 6, background: FIN.lineSoft, borderRadius: 3, overflow: 'hidden', display: 'flex' }} title={`${m.used_pct}% of budget used or committed`}>
          <div style={{ width: `${Math.min(100, 100 * m.actual / m.budget)}%`, background: m.used_pct > 100 ? FIN.bad : FIN.blue }} />
          <div style={{ width: `${Math.max(0, Math.min(100 - 100 * m.actual / m.budget, 100 * m.committed / m.budget))}%`, background: FIN.ochreLine }} />
        </div>}
        {p.last_update
          ? <div style={{ fontSize: 13, background: FIN.ground, borderRadius: 8, padding: '8px 10px' }}>
              <span style={{ color: FIN.faint, fontSize: 12 }}>Update {ago(p.last_update.at)} — </span>{p.last_update.note}</div>
          : <div style={{ fontSize: 12, color: FIN.faint }}>No weekly update yet.</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', alignItems: 'center', fontSize: 12, color: FIN.muted }}>
          <span>{p.manager || 'No manager'}{p.target_end_date ? ' · ends ' + fmtDate(p.target_end_date) : ''}</span>
          <span style={{ flex: 1 }} />
          {canEdit && <button onClick={onUpdate} style={{ ...finBtn2, minHeight: 32, fontSize: 12 }}>Post update</button>}
          <button onClick={onOpen} style={{ ...finBtn2, minHeight: 32, fontSize: 12, color: FIN.blue }}>Open</button>
        </div>
      </div>
    </div>
  )
}

function UpdateModal({ p, onClose, onSaved }) {
  const [health, setHealth] = useState(p.h?.measured || 'on_track')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function post() {
    setBusy(true)
    const { error } = await supabase.rpc('pj_update_post', { p_project: p.id, p_health: health, p_note: note, p_override: health !== p.h?.measured })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Update posted'); onSaved()
  }
  return (
    <div role="dialog" aria-modal="true" onMouseDown={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,.35)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...finCard, width: 'min(520px, 100%)', fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Weekly update — {p.name}</div>
        <div style={{ fontSize: 13, color: FIN.muted }}>The work says <b style={{ color: HEALTH[p.h?.measured]?.color }}>{HEALTH[p.h?.measured]?.label}</b>{(p.h?.reasons || []).length ? ': ' + p.h.reasons.join(', ') : ''}.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {Object.entries(HEALTH).map(([k, v]) => (
            <button key={k} onClick={() => setHealth(k)} style={{ flex: 1, minHeight: 40, borderRadius: 10, cursor: 'pointer', fontWeight: 600,
              border: `2px solid ${health === k ? v.color : FIN.line}`, background: health === k ? v.tint : '#fff', color: v.color }}>{v.label}</button>
          ))}
        </div>
        {health !== p.h?.measured && <div style={{ fontSize: 12, color: FIN.ochreText }}>You're overriding the measured health — say why in the note.</div>}
        <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="What happened this week, what's next, what's in the way"
          style={{ ...finInput, resize: 'vertical', fontFamily: FIN.sans }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={finBtn2}>Cancel</button>
          <button onClick={post} disabled={busy || !note.trim()} style={finBtn}>Post update</button>
        </div>
      </div>
    </div>
  )
}

function Fig({ label, value, color, onClick }) {
  const Tag = onClick ? 'button' : 'div'
  return <Tag onClick={onClick} style={{ ...finCard, padding: '12px 14px', textAlign: 'left', cursor: onClick ? 'pointer' : 'default', fontFamily: FIN.sans }}>
    <div style={{ fontSize: 12, color: FIN.muted }}>{label}</div>
    <div style={{ fontSize: 26, fontWeight: 700, color: color || FIN.ink, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
  </Tag>
}
const Mini = ({ label, value }) => <div><div style={{ color: FIN.faint }}>{label}</div><div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div></div>
