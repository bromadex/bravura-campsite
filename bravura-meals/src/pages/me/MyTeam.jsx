import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, Section, bigBtn } from './shared'

const STATE = {
  a_on_site: { label: 'On site',     color: THEME.statusSuccessText },
  b_leave:   { label: 'On leave',    color: THEME.statusInfoText || THEME.textMed },
  c_done:    { label: 'Clocked out', color: THEME.textMed },
  d_not_in:  { label: 'Not in',      color: THEME.statusWarningText },
}
const time = t => (t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')
const small = (bg, fg = '#fff') => ({ minHeight: '40px', padding: '8px 14px', borderRadius: '10px', border: 'none', background: bg, color: fg, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' })

export default function MyTeam() {
  const { me, loading } = useMe()
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('ess_team_today')
    if (error) showToast(error.message, 'red')
    setData(d || { members: [], timesheets: [], leave: [] })
  }, [])
  useEffect(() => { if (me?.linked) load() }, [me?.linked, load])

  async function timesheets(ids, approve) {
    const note = approve ? null : window.prompt('What needs fixing? The employee will see this.')
    if (!approve && !note) return
    setBusy(true)
    const { data: n, error } = await supabase.rpc('ess_team_decide_timesheet', { p_ids: ids, p_approve: approve, p_note: note })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(approve ? `${n} timesheet${n > 1 ? 's' : ''} approved` : 'Sent back to the employee', 'green'); load()
  }
  async function leave(id, approve) {
    const reason = approve ? null : window.prompt('Reason for not approving:')
    if (!approve && !reason) return
    setBusy(true)
    const { error } = await supabase.rpc('ess_team_decide_leave', { p_id: id, p_approve: approve, p_reason: reason })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(approve ? 'Leave approved' : 'Leave declined', 'green'); load()
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />
  if (!data) return <Loading />

  const counts = Object.fromEntries(Object.keys(STATE).map(k => [k, data.members.filter(m => m.state === k).length]))

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Team" />
      {data.members.length === 0 ? (
        <Card style={{ padding: '20px', fontSize: '13px', color: THEME.textMed }}>
          Nobody reports to you yet. HR sets each employee's line manager on their employee record.
        </Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
            {Object.entries(STATE).map(([k, s]) => (
              <Card key={k} style={{ padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ fontSize: '22px', fontWeight: 700, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{counts[k]}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{s.label}</div>
              </Card>
            ))}
          </div>

          {data.timesheets.length > 0 && (
            <Section title={`Timesheets to approve (${data.timesheets.length})`}>
              <Card style={{ padding: 0, overflow: 'hidden' }}>
                {data.timesheets.map((t, i) => (
                  <div key={t.id} style={{ padding: '10px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 180px' }}>
                      <div style={{ fontSize: '14px', color: THEME.text, fontWeight: 600 }}>{t.name}</div>
                      <div style={{ fontSize: '12px', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtDate(t.date)} · {time(t.clock_in)}–{time(t.clock_out)} · {Number(t.hours || 0).toFixed(1)} h
                        {Number(t.overtime) > 0 && <b style={{ color: ME_COLOR }}> · {Number(t.overtime).toFixed(1)} h OT</b>}
                        {t.late && <span style={{ color: THEME.statusWarningText }}> · late</span>}
                      </div>
                    </div>
                    <button disabled={busy} style={small(THEME.surfaceVar, THEME.error)} onClick={() => timesheets([t.id], false)}>Query</button>
                    <button disabled={busy} style={small(ME_COLOR)} onClick={() => timesheets([t.id], true)}>Approve</button>
                  </div>
                ))}
              </Card>
              {data.timesheets.length > 1 && (
                <button disabled={busy} style={{ ...bigBtn(ME_COLOR), width: '100%', marginTop: '8px' }} onClick={() => timesheets(data.timesheets.map(t => t.id), true)}>
                  <Icon name="done_all" size={20} /> Approve all {data.timesheets.length}
                </button>
              )}
            </Section>
          )}

          {data.leave.length > 0 && (
            <Section title={`Leave requests (${data.leave.length})`}>
              {data.leave.map(l => (
                <Card key={l.id} style={{ padding: '12px 14px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{l.name} · {l.type}</div>
                  <div style={{ fontSize: '13px', color: THEME.textMed }}>{fmtDate(l.start)} – {fmtDate(l.end)} · {Number(l.days)} day{Number(l.days) === 1 ? '' : 's'}{l.reason ? ` · ${l.reason}` : ''}</div>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button disabled={busy} style={{ ...small(THEME.surfaceVar, THEME.error), flex: 1 }} onClick={() => leave(l.id, false)}>Decline</button>
                    <button disabled={busy} style={{ ...small(ME_COLOR), flex: 2 }} onClick={() => leave(l.id, true)}>Approve</button>
                  </div>
                </Card>
              ))}
            </Section>
          )}

          <Section title="Today">
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {data.members.map((m, i) => {
                const s = STATE[m.state]
                return (
                  <div key={m.id} style={{ padding: '10px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: s.color, flexShrink: 0 }} aria-hidden="true" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', color: THEME.text }}>{m.name}</div>
                      <div style={{ fontSize: '12px', color: THEME.textLow }}>{m.designation || m.employee_number}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: s.color, textAlign: 'right', fontWeight: 600 }}>
                      {s.label}
                      <div style={{ fontWeight: 400, color: THEME.textLow }}>
                        {m.state === 'b_leave' ? `${m.leave_type || 'Leave'} until ${fmtDate(m.leave_until)}`
                          : m.clock_in ? `in ${time(m.clock_in)}${m.clock_out ? ` · out ${time(m.clock_out)}` : ''}${m.late ? ' · late' : ''}` : ''}
                      </div>
                    </div>
                  </div>
                )
              })}
            </Card>
          </Section>
        </>
      )}
    </div>
  )
}
