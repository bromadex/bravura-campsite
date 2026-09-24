import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, PageHeader, showToast, fmtDate } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, StatusPill, bigBtn, field, label } from './shared'

function workingDays(a, b) {
  if (!a || !b || b < a) return 0
  let n = 0
  for (let d = new Date(a + 'T00:00:00'); d <= new Date(b + 'T00:00:00'); d.setDate(d.getDate() + 1)) {
    const w = d.getDay(); if (w !== 0 && w !== 6) n++
  }
  return n
}

export default function MyLeave() {
  const { me, loading } = useMe()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ leave_type_id: '', start: '', end: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('ess_my_leave')
    if (error) showToast(error.message, 'red')
    setData(d || { balances: [], requests: [] })
  }, [])
  useEffect(() => { if (me?.linked) load() }, [me?.linked, load])

  const days = workingDays(form.start, form.end)
  const balance = useMemo(() => (data?.balances || []).find(b => b.leave_type_id === form.leave_type_id), [data, form.leave_type_id])

  async function submit() {
    if (!form.leave_type_id || !form.start || !form.end) { showToast('Choose the leave type and both dates', 'red'); return }
    setSaving(true)
    const { error } = await supabase.rpc('ess_request_leave', {
      p_leave_type_id: form.leave_type_id, p_start: form.start, p_end: form.end, p_reason: form.reason,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Leave requested — you will be notified of the decision', 'green')
    setForm({ leave_type_id: '', start: '', end: '', reason: '' })
    setShowForm(false)
    load()
  }

  async function cancel(id) {
    if (!window.confirm('Cancel this leave request?')) return
    const { error } = await supabase.rpc('ess_cancel_leave', { p_request_id: id })
    if (error) { showToast(error.message, 'red'); return }
    showToast('Request cancelled', 'green')
    load()
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />
  if (!data) return <Loading />

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Leave" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', marginBottom: '14px' }}>
        {data.balances.map(b => (
          <Card key={b.leave_type_id} style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>{b.leave_type}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{Number(b.remaining).toFixed(1)} <span style={{ fontSize: '12px', fontWeight: 400, color: THEME.textLow }}>days left</span></div>
            <div style={{ fontSize: '11px', color: THEME.textLow }}>{Number(b.used).toFixed(1)} used of {Number(b.allocated).toFixed(1)}</div>
          </Card>
        ))}
      </div>

      {!showForm ? (
        <button style={{ ...bigBtn(ME_COLOR), width: '100%', marginBottom: '16px' }} onClick={() => setShowForm(true)}>Request leave</button>
      ) : (
        <Card style={{ padding: '16px', marginBottom: '16px', display: 'grid', gap: '12px' }}>
          <div>
            <label htmlFor="ml-type" style={label}>Leave type</label>
            <select id="ml-type" style={field} value={form.leave_type_id} onChange={e => setForm({ ...form, leave_type_id: e.target.value })}>
              <option value="">Choose…</option>
              {data.balances.map(b => <option key={b.leave_type_id} value={b.leave_type_id}>{b.leave_type} ({Number(b.remaining).toFixed(1)} days left)</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="ml-start" style={label}>First day</label>
              <input id="ml-start" type="date" style={field} value={form.start} onChange={e => setForm({ ...form, start: e.target.value, end: form.end || e.target.value })} />
            </div>
            <div>
              <label htmlFor="ml-end" style={label}>Last day</label>
              <input id="ml-end" type="date" style={field} value={form.end} min={form.start} onChange={e => setForm({ ...form, end: e.target.value })} />
            </div>
          </div>
          {days > 0 && (
            <div style={{ fontSize: '13px', color: balance && days > Number(balance.remaining) ? THEME.error : THEME.textMed }}>
              {days} working day{days === 1 ? '' : 's'} (weekends excluded)
              {balance && days > Number(balance.remaining) && ' — more than your balance; HR will decide'}
            </div>
          )}
          <div>
            <label htmlFor="ml-reason" style={label}>Reason (optional)</label>
            <textarea id="ml-reason" rows={2} style={{ ...field, minHeight: '64px', resize: 'vertical' }} value={form.reason}
              onChange={e => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...bigBtn(THEME.surfaceVar, THEME.text), flex: 1 }} onClick={() => setShowForm(false)}>Cancel</button>
            <button style={{ ...bigBtn(ME_COLOR), flex: 2, opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={submit}>
              {saving ? 'Sending…' : 'Send request'}
            </button>
          </div>
        </Card>
      )}

      <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>My requests</div>
      {data.requests.length === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No leave requests yet.</Card>
      ) : (
        <div style={{ display: 'grid', gap: '8px' }}>
          {data.requests.map(r => (
            <Card key={r.id} style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{r.leave_type} · {Number(r.days)} day{Number(r.days) === 1 ? '' : 's'}</div>
                  <div style={{ fontSize: '13px', color: THEME.textMed }}>{fmtDate(r.start_date)} – {fmtDate(r.end_date)}</div>
                  {r.waiting_on && <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '2px' }}>Waiting on: {r.waiting_on}</div>}
                  {r.rejected_reason && <div style={{ fontSize: '12px', color: THEME.error, marginTop: '2px' }}>{r.rejected_reason}</div>}
                </div>
                <StatusPill status={r.status} />
              </div>
              {r.status === 'pending' && (
                <button onClick={() => cancel(r.id)} style={{ marginTop: '8px', background: 'none', border: 'none', padding: '6px 0', color: THEME.error, fontFamily: 'inherit', fontSize: '13px', cursor: 'pointer' }}>
                  Cancel request
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
