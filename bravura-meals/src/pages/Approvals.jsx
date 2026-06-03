import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, Button, StatusBadge, showToast, fmtDate } from '../components/ui'

export default function Approvals() {
  const { profile } = useAuth()
  const [submissions, setSubmissions] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selected, setSelected]       = useState(null) // selected submission
  const [logs, setLogs]               = useState([])
  const [loadingLogs, setLoadingLogs] = useState(false)
  const [approving, setApproving]     = useState(false)
  const [notes, setNotes]             = useState('')

  useEffect(() => { fetchSubmissions() }, [])

  async function fetchSubmissions() {
    setLoading(true)
    const { data } = await supabase
      .from('daily_submissions')
      .select(`
        *,
        submitted_by_profile:profiles!daily_submissions_submitted_by_fkey(full_name, username),
        approved_by_profile:profiles!daily_submissions_approved_by_fkey(full_name, username)
      `)
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
    const { data } = await supabase
      .from('meal_logs')
      .select('*, employee:employees(name, group_name)')
      .eq('date', sub.date)
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
    showToast(`✅ ${fmtDate(selected.date)} approved`, 'green')
    setSelected(null)
    fetchSubmissions()
  }

  async function reject() {
    if (!notes.trim()) { showToast('Please add a rejection note', 'red'); return }
    setApproving(true)
    const { error } = await supabase
      .from('daily_submissions')
      .update({ status: 'draft', notes, approved_by: null, approved_at: null })
      .eq('id', selected.id)
    setApproving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Returned to Meal Officer for corrections', '')
    setSelected(null)
    fetchSubmissions()
  }

  const mealSummary = (logsArr) => {
    let b=0,l=0,s=0
    logsArr.forEach(log => { if(log.had_breakfast)b++; if(log.had_lunch)l++; if(log.had_supper)s++ })
    return { b, l, s, t: b+l+s }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '320px 1fr' : '1fr', gap: '20px' }}>

      {/* Left: list of pending submissions */}
      <div>
        <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '14px', color: '#1a1a2e' }}>
          Pending & Recent Days
        </div>
        {loading ? (
          <div style={{ color: '#888', padding: '20px' }}>Loading…</div>
        ) : submissions.length === 0 ? (
          <Card>
            <div style={{ textAlign: 'center', padding: '24px', color: '#888' }}>
              No submissions pending approval.
            </div>
          </Card>
        ) : (
          submissions.map(sub => {
            const isActive = selected?.id === sub.id
            return (
              <div
                key={sub.id}
                onClick={() => selectSub(sub)}
                style={{
                  background: isActive ? '#D6E4F0' : '#fff',
                  border: `1px solid ${isActive ? '#2F5496' : '#dde2ea'}`,
                  borderRadius: '10px', padding: '14px 16px', marginBottom: '8px',
                  cursor: 'pointer', transition: 'all .15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>{fmtDate(sub.date)}</span>
                  <StatusBadge status={sub.status} />
                </div>
                <div style={{ fontSize: '12px', color: '#888' }}>
                  Submitted by: {sub.submitted_by_profile?.full_name || sub.submitted_by_profile?.username || '—'}
                </div>
                {sub.status === 'submitted' && (
                  <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 700, color: '#C55A11' }}>
                    ⚠ Awaiting your approval
                  </div>
                )}
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
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>{fmtDate(selected.date)}</h3>
              <div style={{ marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <StatusBadge status={selected.status} />
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#888' }}
            >
              ✕
            </button>
          </div>

          {loadingLogs ? (
            <div style={{ color: '#888', padding: '20px 0' }}>Loading meal data…</div>
          ) : (
            <>
              {/* Summary stats */}
              {(() => { const s = mealSummary(logs); return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '10px', marginBottom: '16px' }}>
                  {[
                    { label: 'Breakfasts', v: s.b, c: '#C55A11' },
                    { label: 'Lunches',    v: s.l, c: '#00897B' },
                    { label: 'Suppers',    v: s.s, c: '#5E35B1' },
                    { label: 'Total',      v: s.t, c: '#C00000' },
                  ].map(x => (
                    <div key={x.label} style={{ textAlign: 'center', background: '#f4f6f9', borderRadius: '8px', padding: '10px' }}>
                      <div style={{ fontSize: '22px', fontWeight: 700, color: x.c }}>{x.v}</div>
                      <div style={{ fontSize: '11px', color: '#888' }}>{x.label}</div>
                    </div>
                  ))}
                </div>
              ) })()}

              {/* Meal log table */}
              <div style={{ overflowX: 'auto', maxHeight: '320px', overflowY: 'auto', marginBottom: '16px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead style={{ background: '#1F3864', color: '#fff', position: 'sticky', top: 0 }}>
                    <tr>
                      <th style={{ padding: '8px 10px', textAlign: 'left' }}>Employee</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>B</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>L</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>S</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.filter(log => log.had_breakfast || log.had_lunch || log.had_supper).map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '7px 10px', fontWeight: 600 }}>{log.employee_name}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'center', color: log.had_breakfast ? '#C55A11' : '#ddd' }}>
                          {log.had_breakfast ? '✓' : '—'}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'center', color: log.had_lunch ? '#00897B' : '#ddd' }}>
                          {log.had_lunch ? '✓' : '—'}
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'center', color: log.had_supper ? '#5E35B1' : '#ddd' }}>
                          {log.had_supper ? '✓' : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Notes */}
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  Notes / Comments
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes or reason for rejection…"
                  rows={3}
                  style={{
                    width: '100%', padding: '8px 12px', border: '1px solid #dde2ea',
                    borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px',
                    resize: 'vertical', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Actions */}
              {selected.status === 'submitted' && (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <Button onClick={approve} variant="success" disabled={approving}>
                    ✅ Approve
                  </Button>
                  <Button onClick={reject} variant="danger" disabled={approving}>
                    ↩ Return for corrections
                  </Button>
                </div>
              )}
              {selected.status === 'approved' && (
                <div style={{ color: '#375623', fontWeight: 700, fontSize: '13px' }}>
                  ✅ Approved
                  {selected.approved_at && ` on ${fmtDate(selected.approved_at.slice(0,10))}`}
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  )
}
