import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, Button, StatusBadge, showToast, fmtDate } from '../components/ui'
import { usePermissions } from '../contexts/PermissionsContext'

const REASON_LABELS = {
  count_mismatch:     'Count Mismatch',
  missing_allocation: 'Missing Allocation',
  quality_issue:      'Quality Issue',
  other:              'Other',
}

export default function Flags() {
  const { profile } = useAuth()
  const role = profile?.role
  const { can } = usePermissions()
  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const [filter, setFilter] = useState('open')

  useEffect(() => { fetchFlags() }, [filter])

  async function fetchFlags() {
    setLoading(true)
    let q = supabase
      .from('flags')
      .select(`
        *,
        raised_by_profile:profiles!flags_raised_by_fkey(full_name, username),
        resolved_by_profile:profiles!flags_resolved_by_fkey(full_name, username)
      `)
      .order('raised_at', { ascending: false })

    if (filter !== 'all') q = q.eq('status', filter)
    if (role === 'kitchen') q = q.eq('raised_by', profile.id)

    const { data } = await q
    setFlags(data || [])
    setLoading(false)
  }

  async function resolveFlag(action) {
    if (!note.trim() && action === 'resolved') { showToast('Please add a resolution note', 'red'); return }
    setResolving(true)
    const { error } = await supabase
      .from('flags')
      .update({
        status: action,
        resolved_by: profile.id,
        resolved_at: new Date().toISOString(),
        resolution_note: note,
      })
      .eq('id', selected.id)
    setResolving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(action === 'resolved' ? '✅ Flag resolved' : 'Flag dismissed', 'green')
    setSelected(null)
    setNote('')
    fetchFlags()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>Flags & Queries</h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {['open','resolved','dismissed','all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', border: '1px solid #dde2ea', fontFamily: 'inherit',
                background: filter === f ? '#1F3864' : 'transparent',
                color: filter === f ? '#fff' : '#4a5568',
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#888', padding: '20px' }}>Loading flags…</div>
      ) : flags.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '32px', color: '#888' }}>
            No {filter === 'all' ? '' : filter} flags found.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '360px 1fr' : '1fr', gap: '20px' }}>
          {/* List */}
          <div>
            {flags.map(flag => (
              <div
                key={flag.id}
                onClick={() => { setSelected(flag); setNote(flag.resolution_note || '') }}
                style={{
                  background: selected?.id === flag.id ? '#D6E4F0' : '#fff',
                  border: `1px solid ${flag.status === 'open' ? '#f5b8b8' : '#dde2ea'}`,
                  borderRadius: '10px', padding: '14px 16px', marginBottom: '8px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 700, fontSize: '14px' }}>🚩 {fmtDate(flag.date)}</span>
                  <StatusBadge status={flag.status} />
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600, color: '#C00000' }}>{REASON_LABELS[flag.reason]}</span>
                  {' · '}
                  {flag.raised_by_profile?.full_name || flag.raised_by_profile?.username}
                </div>
                <div style={{ fontSize: '12px', color: '#4a5568', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                  {flag.message}
                </div>
              </div>
            ))}
          </div>

          {/* Detail */}
          {selected && (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Flag — {fmtDate(selected.date)}</h3>
                  <StatusBadge status={selected.status} />
                </div>
                <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#888' }}>✕</button>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#888', marginBottom: '4px' }}>Reason</div>
                <div style={{ fontWeight: 600, color: '#C00000' }}>{REASON_LABELS[selected.reason]}</div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#888', marginBottom: '4px' }}>Message from Kitchen</div>
                <div style={{ background: '#FFF2CC', borderRadius: '8px', padding: '12px', fontSize: '13px', lineHeight: 1.6 }}>
                  {selected.message}
                </div>
              </div>

              {/* Count comparison */}
              {selected.system_count_b != null && (
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: '#888', marginBottom: '8px' }}>Count Comparison</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f4f6f9' }}>
                        <th style={{ padding: '6px 10px', textAlign: 'left' }}>Meal</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>System</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>Kitchen</th>
                        <th style={{ padding: '6px 10px', textAlign: 'center' }}>Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[['Breakfast','system_count_b','kitchen_count_b'],['Lunch','system_count_l','kitchen_count_l'],['Supper','system_count_s','kitchen_count_s']].map(([label, sk, kk]) => {
                        const diff = (selected[kk] ?? 0) - (selected[sk] ?? 0)
                        return (
                          <tr key={label} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '6px 10px' }}>{label}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700 }}>{selected[sk] ?? '—'}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700 }}>{selected[kk] ?? '—'}</td>
                            <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 700, color: diff === 0 ? '#375623' : '#C00000' }}>
                              {diff > 0 ? '+' : ''}{diff === 0 ? '=' : diff}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Raised by */}
              <div style={{ fontSize: '12px', color: '#888', marginBottom: '14px' }}>
                Raised by <strong>{selected.raised_by_profile?.full_name || selected.raised_by_profile?.username}</strong>
                {' on '}{new Date(selected.raised_at).toLocaleString()}
              </div>

              {/* Resolution */}
              {/* meals.approve: matches old resolveFlag (super_admin, approver) —
                  narrower for Camp Supervisor under the approved matrix, same
                  pattern used throughout this swap. */}
              {selected.status === 'open' && can('meals.approve') && (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', color: '#4a5568', marginBottom: '5px' }}>
                      Resolution Note
                    </label>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Explain how this was resolved…"
                      rows={3}
                      style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <Button onClick={() => resolveFlag('resolved')} variant="success" disabled={resolving}>✅ Mark Resolved</Button>
                    <Button onClick={() => resolveFlag('dismissed')} variant="ghost" disabled={resolving}>Dismiss</Button>
                  </div>
                </>
              )}
              {selected.status !== 'open' && selected.resolution_note && (
                <div style={{ background: '#E2EFDA', borderRadius: '8px', padding: '12px', fontSize: '13px' }}>
                  <div style={{ fontWeight: 700, color: '#375623', marginBottom: '4px' }}>Resolution note</div>
                  {selected.resolution_note}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
