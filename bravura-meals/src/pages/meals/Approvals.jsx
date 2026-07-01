import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, StatusBadge, Icon, SectionLabel, showToast, fmtDate, PageHeader } from '../../components/ui'

export default function Approvals() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()

  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState(null) // selected submission
  const [logs, setLogs]               = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [approving, setApproving]     = useState(false)
  const [notes, setNotes]             = useState('')
  const [checked, setChecked]         = useState({})   // bulk-approve selection { [subId]: true }
  const [bulkSaving, setBulkSaving]   = useState(false)

  useEffect(() => {
    if (currentSiteId) fetchSubmissions()
  }, [currentSiteId])

  async function fetchSubmissions() {
    setLoading(true)
    // previous_counts is included so the resubmitted badge + diff view can
    // key off it without a second query.
    const { data } = await supabase
      .from('daily_submissions')
      .select(`
        *,
        submitted_by_profile:profiles!daily_submissions_submitted_by_fkey(full_name, username),
        approved_by_profile:profiles!daily_submissions_approved_by_fkey(full_name, username)
      `)
      .eq('site_id', currentSiteId)
      .in('status', ['submitted', 'approved', 'queried'])
      .order('date', { ascending: false })
      .limit(60)
    setSubmissions(data || [])
    setLoading(false)
  }

  async function selectSub(sub) {
    setSelected(sub)
    setNotes(sub.notes || '')
    setLoadingLogs(true)
    // Filtered by submission_id, not date. A date can now have one
    // submission PER SITE rather than one globally — filtering by date
    // alone would mix two different sites' meal logs together on the same
    // calendar day. submission_id is the actual, reliable link.
    const { data } = await supabase
      .from('meal_logs')
      .select('*, employee:employees(name, group_name)')
      .eq('submission_id', sub.id)
      .order('employee(name)')
    setLogs(data || [])
    setLoadingLogs(false)
  }

  async function approve() {
    setApproving(true)
    const { error } = await supabase
      .from('daily_submissions')
      .update({
        status: 'approved',
        approved_by: profile.id,
        approved_at: new Date().toISOString(),
        notes,
      })
      .eq('id', selected.id)
    setApproving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${fmtDate(selected.date)} approved`, 'green')
    setSelected(null)
    fetchSubmissions()
  }

  async function reject() {
    if (!notes.trim()) { showToast('Please add a rejection note', 'red'); return }
    setApproving(true)
    // Snapshot current counts BEFORE resetting to draft so the diff view can
    // show what changed after the meal officer corrects the submission.
    const snap = {
      b: mealSummary(logs).b,
      l: mealSummary(logs).l,
      s: mealSummary(logs).s,
      at: new Date().toISOString(),
      actor: profile.id,
      note: notes,
    }
    const { error } = await supabase
      .from('daily_submissions')
      .update({ status: 'draft', notes, approved_by: null, approved_at: null, previous_counts: snap })
      .eq('id', selected.id)
    setApproving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Returned to Meal Officer for corrections', '')
    setSelected(null)
    fetchSubmissions()
  }

  async function bulkApproveDay() {
    const ids = Object.keys(checked).filter(id => checked[id])
    if (!ids.length) { showToast('Nothing selected', 'red'); return }
    setBulkSaving(true)
    const { error } = await supabase
      .from('daily_submissions')
      .update({ status: 'approved', approved_by: profile.id, approved_at: new Date().toISOString() })
      .in('id', ids)
      .eq('status', 'submitted')    // safety: only touch rows still awaiting approval
    setBulkSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${ids.length} submission${ids.length === 1 ? '' : 's'} approved`, 'green')
    setChecked({})
    fetchSubmissions()
  }

  function toggleCheck(subId) {
    setChecked(prev => ({ ...prev, [subId]: !prev[subId] }))
  }
  function checkAllPending() {
    const next = {}
    for (const s of submissions) if (s.status === 'submitted') next[s.id] = true
    setChecked(next)
  }
  function clearChecks() { setChecked({}) }

  const mealSummary = (logsArr) => {
    let b=0,l=0,s=0
    logsArr.forEach(log => { if(log.had_breakfast)b++; if(log.had_lunch)l++; if(log.had_supper)s++ })
    return { b, l, s, t: b+l+s }
  }

  return (
    <div>
      <PageHeader title="Approvals" site={currentSite} />

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '320px 1fr' : '1fr', gap: '20px' }}>

        {/* Left: list of pending submissions */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Pending & Recent Days
            </div>
            {Object.values(checked).some(Boolean) ? (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', color: THEME.textLow }}>
                  {Object.values(checked).filter(Boolean).length} selected
                </span>
                <Button onClick={bulkApproveDay} variant="success" size="sm" icon="done_all" disabled={bulkSaving}>
                  Approve
                </Button>
                <Button onClick={clearChecks} variant="text" size="sm">Clear</Button>
              </div>
            ) : submissions.some(s => s.status === 'submitted') && (
              <button
                onClick={checkAllPending}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '11px', color: THEME.primary, fontWeight: 600, fontFamily: 'inherit' }}
              >
                Select all pending
              </button>
            )}
          </div>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>
              <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
            </div>
          ) : submissions.length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
                <Icon name="task_alt" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                No submissions recorded yet at {currentSite?.name || 'this site'}.
              </div>
            </Card>
          ) : (
            submissions.map(sub => {
              const isActive = selected?.id === sub.id
              const canBulk  = sub.status === 'submitted'
              const isChecked = !!checked[sub.id]
              const wasResubmitted = !!sub.previous_counts
              return (
                <div
                  key={sub.id}
                  onClick={() => selectSub(sub)}
                  style={{
                    background: isActive ? THEME.surfaceVar : isChecked ? THEME.success + '10' : '#fff',
                    border: `1px solid ${isActive ? THEME.primary : isChecked ? THEME.success + '55' : THEME.outlineVar}`,
                    borderRadius: '10px', padding: '12px 14px', marginBottom: '8px',
                    cursor: 'pointer', transition: 'all .15s',
                    display: 'flex', gap: '10px', alignItems: 'flex-start',
                  }}
                >
                  {canBulk && (
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCheck(sub.id)}
                      onClick={e => e.stopPropagation()}
                      style={{ marginTop: '3px', accentColor: THEME.success, cursor: 'pointer' }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '6px' }}>
                      <span style={{ fontWeight: 600, fontSize: '14px', color: THEME.text }}>{fmtDate(sub.date)}</span>
                      <StatusBadge status={sub.status} />
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textLow }}>
                      Submitted by: {sub.submitted_by_profile?.full_name || sub.submitted_by_profile?.username || '—'}
                    </div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '4px', flexWrap: 'wrap' }}>
                      {sub.status === 'submitted' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: THEME.warning }}>
                          <Icon name="schedule" size={12} style={{ color: THEME.warning }} />
                          Awaiting approval
                        </div>
                      )}
                      {wasResubmitted && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: THEME.info }}>
                          <Icon name="history" size={12} style={{ color: THEME.info }} />
                          Resubmitted after query
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Right: detail panel */}
        {selected && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: THEME.text }}>{fmtDate(selected.date)}</h3>
                <div style={{ marginTop: '4px' }}>
                  <StatusBadge status={selected.status} />
                </div>
              </div>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}
              >
                <Icon name="close" size={18} style={{ color: THEME.textLow }} />
              </button>
            </div>

            {loadingLogs ? (
              <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>
                <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
              </div>
            ) : (
              <>
                {/* Summary stats */}
                {(() => { const s = mealSummary(logs); return (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '12px' }}>
                    {[
                      { label: 'Breakfasts', v: s.b, c: THEME.breakfastClr, k: 'b' },
                      { label: 'Lunches',    v: s.l, c: THEME.lunchClr,     k: 'l' },
                      { label: 'Suppers',    v: s.s, c: THEME.supperClr,    k: 's' },
                      { label: 'Total',      v: s.t, c: THEME.primary,      k: 't' },
                    ].map(x => {
                      const prev = selected.previous_counts
                      const prevVal = prev && (x.k === 't' ? (prev.b || 0) + (prev.l || 0) + (prev.s || 0) : prev[x.k])
                      const diff = prev != null ? x.v - (prevVal || 0) : null
                      return (
                        <div key={x.label} style={{ textAlign: 'center', background: THEME.surfaceVar, borderRadius: '10px', padding: '10px' }}>
                          <div style={{ fontSize: '22px', fontWeight: 700, color: x.c }}>{x.v}</div>
                          <div style={{ fontSize: '11px', color: THEME.textLow }}>{x.label}</div>
                          {diff != null && diff !== 0 && (
                            <div style={{ fontSize: '10px', fontWeight: 700, color: diff > 0 ? THEME.success : THEME.error, marginTop: '3px' }}>
                              {diff > 0 ? '+' : ''}{diff} vs last
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ) })()}

                {/* Diff panel — visible if this submission was returned once */}
                {selected.previous_counts && (
                  <div style={{
                    padding: '10px 14px', marginBottom: '14px',
                    background: THEME.statusInfoBg, border: `1px solid ${THEME.info}22`,
                    borderRadius: '8px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      <Icon name="history" size={14} style={{ color: THEME.info }} />
                      <span style={{ fontSize: '11px', fontWeight: 700, color: THEME.statusInfoText, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        Change from previous version
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontSize: '12px', color: THEME.textMed }}>
                      <span>Previous: B {selected.previous_counts.b ?? 0} · L {selected.previous_counts.l ?? 0} · S {selected.previous_counts.s ?? 0}</span>
                      <span>Returned {selected.previous_counts.at ? fmtDate(selected.previous_counts.at.slice(0,10)) : '—'}</span>
                    </div>
                    {selected.previous_counts.note && (
                      <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '6px', fontStyle: 'italic' }}>
                        Reviewer note: “{selected.previous_counts.note}”
                      </div>
                    )}
                  </div>
                )}

                {/* Meal log table */}
                <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto', marginBottom: '16px', borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead style={{ background: THEME.primary, color: '#fff', position: 'sticky', top: 0 }}>
                      <tr>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Employee</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>B</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>L</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>S</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.filter(log => log.had_breakfast || log.had_lunch || log.had_supper).length === 0 ? (
                        <tr><td colSpan={4} style={{ padding: '24px', textAlign: 'center', color: THEME.textLow }}>No meals recorded for this day</td></tr>
                      ) : logs.filter(log => log.had_breakfast || log.had_lunch || log.had_supper).map(log => (
                        <tr key={log.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                          <td style={{ padding: '7px 10px', fontWeight: 500, color: THEME.text }}>{log.employee_name}</td>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            {log.had_breakfast
                              ? <Icon name="check_circle" size={15} style={{ color: THEME.breakfastClr }} />
                              : <span style={{ color: THEME.outline }}>—</span>}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            {log.had_lunch
                              ? <Icon name="check_circle" size={15} style={{ color: THEME.lunchClr }} />
                              : <span style={{ color: THEME.outline }}>—</span>}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                            {log.had_supper
                              ? <Icon name="check_circle" size={15} style={{ color: THEME.supperClr }} />
                              : <span style={{ color: THEME.outline }}>—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Notes */}
                <div style={{ marginBottom: '14px' }}>
                  <SectionLabel>Notes / Comments</SectionLabel>
                  <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Optional notes or reason for rejection…"
                    rows={3}
                    style={{
                      width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
                      borderRadius: '12px', fontFamily: 'inherit', fontSize: '13px',
                      resize: 'vertical', boxSizing: 'border-box', outline: 'none',
                    }}
                  />
                </div>

                {/* Actions */}
                {selected.status === 'submitted' && (
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <Button onClick={approve} variant="success" icon="check_circle" disabled={approving}>
                      Approve
                    </Button>
                    <Button onClick={reject} variant="danger" icon="undo" disabled={approving}>
                      Return for corrections
                    </Button>
                  </div>
                )}
                {selected.status === 'approved' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: THEME.success, fontWeight: 600, fontSize: '13px' }}>
                    <Icon name="check_circle" size={16} style={{ color: THEME.success }} />
                    Approved{selected.approved_at && ` on ${fmtDate(selected.approved_at.slice(0,10))}`}
                  </div>
                )}
              </>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
