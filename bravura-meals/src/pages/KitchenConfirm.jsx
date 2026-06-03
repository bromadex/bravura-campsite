import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { Card, Button, StatusBadge, showToast, today, fmtDate } from '../components/ui'

export default function KitchenConfirm() {
  const { profile } = useAuth()
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

  useEffect(() => { loadDate(date) }, [date])

  async function loadDate(d) {
    setLoading(true)
    const { data } = await supabase
      .from('daily_submissions')
      .select('*')
      .eq('date', d)
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
    showToast('Kitchen counts saved ✓', 'green')
    loadDate(date)
  }

  async function raiseFlag() {
    if (!flagMsg.trim()) { showToast('Please describe the issue', 'red'); return }
    if (!submission?.id) { showToast('No submission found for this date', 'red'); return }
    setSaving(true)
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
    showToast('🚩 Flag raised — approver has been notified', 'green')
    setShowFlagForm(false)
    setFlagMsg('')
    loadDate(date)
  }

  return (
    <div style={{ maxWidth: '600px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>Kitchen Confirmation</h2>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit' }}
        />
      </div>

      {loading ? (
        <div style={{ color: '#888', padding: '20px' }}>Loading…</div>
      ) : !submission ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '24px', color: '#888' }}>
            No submission found for {fmtDate(date)}. The Meal Officer hasn't submitted this day yet.
          </div>
        </Card>
      ) : (
        <>
          <Card style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>Day Status</div>
              <StatusBadge status={submission.status} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' }}>
              {[
                { label: '🌅 Breakfast (system)', v: submission.kitchen_count_b ?? '—' },
                { label: '☀️ Lunch (system)',     v: submission.kitchen_count_l ?? '—' },
                { label: '🌙 Supper (system)',    v: submission.kitchen_count_s ?? '—' },
              ].map(x => (
                <div key={x.label} style={{ background: '#f4f6f9', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: '#1F3864' }}>{x.v}</div>
                  <div style={{ fontSize: '11px', color: '#888', marginTop: '4px' }}>{x.label}</div>
                </div>
              ))}
            </div>

            {/* Kitchen entry */}
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#4a5568', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
              What kitchen received
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
              {['b','l','s'].map((k, i) => (
                <div key={k}>
                  <label style={{ display: 'block', fontSize: '11px', color: '#888', marginBottom: '4px' }}>
                    {['Breakfast','Lunch','Supper'][i]}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={counts[k]}
                    onChange={e => setCounts(prev => ({ ...prev, [k]: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 12px', border: '1px solid #dde2ea',
                      borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit',
                      textAlign: 'center', fontWeight: 700, boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <Button onClick={saveConfirmation} variant="success" disabled={saving}>
                ✓ Confirm counts
              </Button>
              <Button onClick={() => setShowFlagForm(f => !f)} variant="ghost">
                🚩 Raise a flag / query
              </Button>
            </div>
          </Card>

          {/* Flag form */}
          {showFlagForm && (
            <Card>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#C00000', marginBottom: '14px' }}>
                🚩 Raise a Flag / Query
              </div>
              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  Reason
                </label>
                <select
                  value={flagReason}
                  onChange={e => setFlagReason(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px' }}
                >
                  <option value="count_mismatch">Count mismatch (received different qty)</option>
                  <option value="missing_allocation">Missing allocation (food not delivered)</option>
                  <option value="quality_issue">Quality issue</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#4a5568', marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  Description
                </label>
                <textarea
                  value={flagMsg}
                  onChange={e => setFlagMsg(e.target.value)}
                  placeholder="Describe the issue clearly…"
                  rows={3}
                  style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#4a5568', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  What kitchen actually received (optional)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                  {['b','l','s'].map((k,i) => (
                    <div key={k}>
                      <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>{['Breakfast','Lunch','Supper'][i]}</label>
                      <input
                        type="number" min="0"
                        value={flagKitchen[k]}
                        onChange={e => setFlagKitchen(p => ({ ...p, [k]: e.target.value }))}
                        style={{ width: '100%', padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px', fontFamily: 'inherit', fontSize: '13px', boxSizing: 'border-box' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <Button onClick={raiseFlag} variant="danger" disabled={saving}>
                  🚩 Submit Flag
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
