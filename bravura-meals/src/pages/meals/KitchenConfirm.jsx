import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, StatusBadge, Icon, SectionLabel, showToast, today, fmtDate, PageHeader } from '../../components/ui'

export default function KitchenConfirm() {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()

  const [date, setDate] = useState(today())
  const [submission, setSubmission] = useState(null)
  const [counts, setCounts] = useState({ b: '', l: '', s: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Flag form
  const [showFlagForm, setShowFlagForm] = useState(false)
  const [flagReason, setFlagReason] = useState('count_mismatch')
  const [flagMsg, setFlagMsg] = useState('')
  const [flagKitchen, setFlagKitchen] = useState({ b: '', l: '', s: '' })

  // Re-loads whenever the date OR the selected site changes — a date can
  // now have one submission PER SITE, so site has to be part of the lookup,
  // not just the date.
  useEffect(() => { if (currentSiteId) loadDate(date) }, [date, currentSiteId])

  async function loadDate(d) {
    setLoading(true)
    const { data } = await supabase
      .from('daily_submissions')
      .select('*')
      .eq('date', d)
      .eq('site_id', currentSiteId)
      .maybeSingle()
    setSubmission(data)
    if (data) {
      setCounts({
        b: data.kitchen_count_b ?? '',
        l: data.kitchen_count_l ?? '',
        s: data.kitchen_count_s ?? '',
      })
    } else {
      setCounts({ b: '', l: '', s: '' })
    }
    setLoading(false)
  }

  async function saveConfirmation() {
    if (!submission?.id) { showToast('No submission found for this date', 'red'); return }
    setSaving(true)
    const { error } = await supabase
      .from('daily_submissions')
      .update({
        kitchen_count_b: parseInt(counts.b) || 0,
        kitchen_count_l: parseInt(counts.l) || 0,
        kitchen_count_s: parseInt(counts.s) || 0,
        confirmed_by: profile.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', submission.id)
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Kitchen counts saved', 'green')
    loadDate(date)
  }

  async function raiseFlag() {
    if (!flagMsg.trim()) { showToast('Please describe the issue', 'red'); return }
    if (!submission?.id) { showToast('No submission found for this date', 'red'); return }
    setSaving(true)
    // flags links to a specific daily_submissions row via submission_id,
    // which already carries site_id — no separate site column needed here,
    // same "derive through the parent" pattern used throughout this project.
    const { error } = await supabase.from('flags').insert({
      submission_id:  submission.id,
      date,
      raised_by:      profile.id,
      reason:         flagReason,
      message:        flagMsg,
      system_count_b: submission.kitchen_count_b,
      system_count_l: submission.kitchen_count_l,
      system_count_s: submission.kitchen_count_s,
      kitchen_count_b: parseInt(flagKitchen.b) || null,
      kitchen_count_l: parseInt(flagKitchen.l) || null,
      kitchen_count_s: parseInt(flagKitchen.s) || null,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Flag raised — approver has been notified', 'green')
    setShowFlagForm(false)
    setFlagMsg('')
    loadDate(date)
  }

  return (
    <div style={{ maxWidth: '600px' }}>
      <PageHeader
        title="Kitchen Confirmation"
        site={currentSite}
        actions={
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}
          />
        }
      />

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : !submission ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
            <Icon name="restaurant" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
            No submission found for {fmtDate(date)} at {currentSite?.name || 'this site'}. The Meal Officer hasn't submitted this day yet.
          </div>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontWeight: 600, fontSize: '15px', color: THEME.text }}>Day Status</div>
              <StatusBadge status={submission.status} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              {[
                { label: 'Breakfast (system)', v: submission.kitchen_count_b ?? '—', icon: 'wb_sunny',  c: THEME.breakfastClr },
                { label: 'Lunch (system)',     v: submission.kitchen_count_l ?? '—', icon: 'light_mode', c: THEME.lunchClr },
                { label: 'Supper (system)',    v: submission.kitchen_count_s ?? '—', icon: 'bedtime',    c: THEME.supperClr },
              ].map(x => (
                <div key={x.label} style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
                  <Icon name={x.icon} size={16} style={{ color: x.c }} />
                  <div style={{ fontSize: '20px', fontWeight: 700, color: x.c, marginTop: '4px' }}>{x.v}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{x.label}</div>
                </div>
              ))}
            </div>

            {/* Kitchen entry */}
            <SectionLabel>What kitchen received</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              {['b','l','s'].map((k, i) => (
                <div key={k}>
                  <label style={{ display: 'block', fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>
                    {['Breakfast','Lunch','Supper'][i]}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={counts[k]}
                    onChange={e => setCounts(prev => ({ ...prev, [k]: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', border: `1px solid ${THEME.outline}`,
                      borderRadius: '10px', fontSize: '14px', fontFamily: 'inherit',
                      textAlign: 'center', fontWeight: 700, boxSizing: 'border-box', outline: 'none',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <Button onClick={saveConfirmation} variant="success" icon="check_circle" disabled={saving}>
                Confirm counts
              </Button>
              <Button onClick={() => setShowFlagForm(f => !f)} variant="ghost" icon="flag">
                Raise a flag / query
              </Button>
            </div>
          </Card>

          {/* Flag form */}
          {showFlagForm && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '14px', color: THEME.error, marginBottom: '14px' }}>
                <Icon name="flag" size={16} style={{ color: THEME.error }} />
                Raise a Flag / Query
              </div>
              <div style={{ marginBottom: '12px' }}>
                <SectionLabel>Reason</SectionLabel>
                <select
                  value={flagReason}
                  onChange={e => setFlagReason(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontFamily: 'inherit', fontSize: '13px', outline: 'none' }}
                >
                  <option value="count_mismatch">Count mismatch (received different qty)</option>
                  <option value="missing_allocation">Missing allocation (food not delivered)</option>
                  <option value="quality_issue">Quality issue</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <SectionLabel>Description</SectionLabel>
                <textarea
                  value={flagMsg}
                  onChange={e => setFlagMsg(e.target.value)}
                  placeholder="Describe the issue clearly…"
                  rows={3}
                  style={{ width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontFamily: 'inherit', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <SectionLabel>What kitchen actually received (optional)</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  {['b','l','s'].map((k,i) => (
                    <div key={k}>
                      <label style={{ fontSize: '11px', color: THEME.textLow, display: 'block', marginBottom: '3px' }}>{['Breakfast','Lunch','Supper'][i]}</label>
                      <input
                        type="number" min="0"
                        value={flagKitchen[k]}
                        onChange={e => setFlagKitchen(p => ({ ...p, [k]: e.target.value }))}
                        style={{ width: '100%', padding: '8px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <Button onClick={raiseFlag} variant="danger" icon="flag" disabled={saving}>
                  Submit Flag
                </Button>
                <Button onClick={() => setShowFlagForm(false)} variant="ghost">
                  Cancel
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
