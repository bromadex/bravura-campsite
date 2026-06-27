import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { useSite } from '../contexts/SiteContext'
import { usePermissions } from '../contexts/PermissionsContext'
import { THEME } from '../utils/permissions'
import { Card, Button, StatusBadge, Icon, SectionLabel, showToast, fmtDate } from '../components/ui'

const REASON_LABELS = {
  count_mismatch:     'Count Mismatch',
  missing_allocation: 'Missing Allocation',
  quality_issue:      'Quality Issue',
  other:              'Other',
}

export default function Flags() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const canResolve = can('meals.approve')

  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const [filter, setFilter] = useState('open')

  useEffect(() => { if (currentSiteId) fetchFlags() }, [filter, currentSiteId])

  async function fetchFlags() {
    setLoading(true)

    // flags has no site_id of its own — it reaches site only through
    // submission_id (a FK to daily_submissions, which does carry site_id).
    // Fetch this site's submission IDs first, then filter flags down to
    // just those — the same safe two-step pattern used everywhere else in
    // this project, rather than a nested-join filter on an embedded
    // resource, which has been unreliable across PostgREST versions.
    const { data: subs } = await supabase
      .from('daily_submissions')
      .select('id')
      .eq('site_id', currentSiteId)
    const subIds = (subs || []).map(s => s.id)

    if (subIds.length === 0) {
      setFlags([])
      setLoading(false)
      return
    }

    let q = supabase
      .from('flags')
      .select(`
        *,
        raised_by_profile:profiles!flags_raised_by_fkey(full_name, username),
        resolved_by_profile:profiles!flags_resolved_by_fkey(full_name, username)
      `)
      .in('submission_id', subIds)
      .order('raised_at', { ascending: false })

    if (filter !== 'all') q = q.eq('status', filter)
    // If you can't resolve flags, you only see your own — a real,
    // sensible tightening over the old hardcoded 'kitchen'-only
    // restriction, which left Meal Officer and Pricing Officer seeing
    // every flag regardless of relevance to their role.
    if (!canResolve) q = q.eq('raised_by', profile.id)

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
    showToast(action === 'resolved' ? 'Flag resolved' : 'Flag dismissed', 'green')
    setSelected(null)
    setNote('')
    fetchFlags()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>
          Flags & Queries
          <span style={{ marginLeft: '10px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.primary, verticalAlign: 'middle' }}>
            <Icon name="location_on" size={12} style={{ color: THEME.primary }} />
            {currentSite?.name || '—'}
          </span>
        </h2>
        <div style={{ display: 'flex', gap: '6px' }}>
          {['open','resolved','dismissed','all'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', border: `1px solid ${THEME.outline}`, fontFamily: 'inherit',
                background: filter === f ? THEME.primary : 'transparent',
                color: filter === f ? '#fff' : THEME.textMed,
              }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : flags.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
            <Icon name="flag" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
            No {filter === 'all' ? '' : filter} flags at {currentSite?.name || 'this site'}.
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
                  background: selected?.id === flag.id ? THEME.surfaceVar : '#fff',
                  border: `1px solid ${flag.status === 'open' ? '#f5b8b8' : THEME.outlineVar}`,
                  borderRadius: '12px', padding: '14px 16px', marginBottom: '8px',
                  cursor: 'pointer', transition: 'all .15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '14px', color: THEME.text }}>
                    <Icon name="flag" size={14} style={{ color: THEME.error }} />
                    {fmtDate(flag.date)}
                  </span>
                  <StatusBadge status={flag.status} />
                </div>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>
                  <span style={{ fontWeight: 600, color: THEME.error }}>{REASON_LABELS[flag.reason]}</span>
                  {' · '}
                  {flag.raised_by_profile?.full_name || flag.raised_by_profile?.username}
                </div>
                <div style={{ fontSize: '12px', color: THEME.textMed, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
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
                  <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 600, color: THEME.text }}>Flag — {fmtDate(selected.date)}</h3>
                  <StatusBadge status={selected.status} />
                </div>
                <button onClick={() => setSelected(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex' }}>
                  <Icon name="close" size={18} style={{ color: THEME.textLow }} />
                </button>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <SectionLabel>Reason</SectionLabel>
                <div style={{ fontWeight: 600, color: THEME.error }}>{REASON_LABELS[selected.reason]}</div>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <SectionLabel>Message from Kitchen</SectionLabel>
                <div style={{ background: THEME.statusWarningBg, borderRadius: '10px', padding: '12px', fontSize: '13px', lineHeight: 1.6, color: THEME.text }}>
                  {selected.message}
                </div>
              </div>

              {/* Count comparison */}
              {selected.system_count_b != null && (
                <div style={{ marginBottom: '14px' }}>
                  <SectionLabel>Count Comparison</SectionLabel>
                  <div style={{ borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: THEME.surfaceVar }}>
                          <th style={{ padding: '7px 10px', textAlign: 'left', color: THEME.textMed }}>Meal</th>
                          <th style={{ padding: '7px 10px', textAlign: 'center', color: THEME.textMed }}>System</th>
                          <th style={{ padding: '7px 10px', textAlign: 'center', color: THEME.textMed }}>Kitchen</th>
                          <th style={{ padding: '7px 10px', textAlign: 'center', color: THEME.textMed }}>Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[['Breakfast','system_count_b','kitchen_count_b'],['Lunch','system_count_l','kitchen_count_l'],['Supper','system_count_s','kitchen_count_s']].map(([label, sk, kk]) => {
                          const diff = (selected[kk] ?? 0) - (selected[sk] ?? 0)
                          return (
                            <tr key={label} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                              <td style={{ padding: '7px 10px', color: THEME.text }}>{label}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, color: THEME.text }}>{selected[sk] ?? '—'}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, color: THEME.text }}>{selected[kk] ?? '—'}</td>
                              <td style={{ padding: '7px 10px', textAlign: 'center', fontWeight: 700, color: diff === 0 ? THEME.success : THEME.error }}>
                                {diff > 0 ? '+' : ''}{diff === 0 ? '=' : diff}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Raised by */}
              <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '14px' }}>
                Raised by <strong style={{ color: THEME.textMed }}>{selected.raised_by_profile?.full_name || selected.raised_by_profile?.username}</strong>
                {' on '}{new Date(selected.raised_at).toLocaleString()}
              </div>

              {/* Resolution */}
              {selected.status === 'open' && canResolve && (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <SectionLabel>Resolution Note</SectionLabel>
                    <textarea
                      value={note}
                      onChange={e => setNote(e.target.value)}
                      placeholder="Explain how this was resolved…"
                      rows={3}
                      style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontFamily: 'inherit', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <Button onClick={() => resolveFlag('resolved')} variant="success" icon="check_circle" disabled={resolving}>Mark Resolved</Button>
                    <Button onClick={() => resolveFlag('dismissed')} variant="ghost" disabled={resolving}>Dismiss</Button>
                  </div>
                </>
              )}
              {selected.status !== 'open' && selected.resolution_note && (
                <div style={{ background: THEME.statusSuccessBg, borderRadius: '10px', padding: '12px', fontSize: '13px' }}>
                  <div style={{ fontWeight: 600, color: THEME.success, marginBottom: '4px' }}>Resolution note</div>
                  <div style={{ color: THEME.text }}>{selected.resolution_note}</div>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
