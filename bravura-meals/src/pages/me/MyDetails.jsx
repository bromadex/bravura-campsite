import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, bigBtn, field, label } from './shared'

const FIELDS = [
  { group: 'Contact', items: [['phone', 'Mobile number', 'tel'], ['email', 'Personal email', 'email'], ['residential_address', 'Home address', 'text']] },
  { group: 'Bank (for salary)', items: [['bank_name', 'Bank', 'text'], ['bank_branch', 'Branch', 'text'], ['bank_account_number', 'Account number', 'text']] },
  { group: 'Next of kin', items: [['nok_name', 'Full name', 'text'], ['nok_relationship', 'Relationship', 'text'], ['nok_phone', 'Phone', 'tel']] },
]
const LABEL = Object.fromEntries(FIELDS.flatMap(g => g.items.map(([k, l]) => [k, l])))

export default function MyDetails() {
  const { me, loading } = useMe()
  const [data, setData] = useState(null)
  const [form, setForm] = useState({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('ess_my_details')
    if (error) showToast(error.message, 'red')
    setData(d || {})
    setForm(d?.current || {})
  }, [])
  useEffect(() => { if (me?.linked) load() }, [me?.linked, load])

  const changed = data ? Object.keys(LABEL).filter(k => (form[k] || '').trim() !== (data.current?.[k] || '').trim()) : []

  async function submit() {
    setBusy(true)
    const changes = Object.fromEntries(changed.map(k => [k, form[k] || '']))
    const { error } = await supabase.rpc('ess_request_detail_change', { p_changes: changes, p_reason: reason })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Sent to HR to verify — your record changes once they approve', 'green')
    setReason(''); load()
  }

  async function cancel() {
    const { error } = await supabase.rpc('ess_cancel_detail_change')
    if (error) { showToast(error.message, 'red'); return }
    load()
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />
  if (!data) return <Loading />

  const pending = data.pending
  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Details" />
      <Card style={{ padding: '12px 14px', marginBottom: '14px', background: THEME.statusInfoBg, fontSize: '13px', color: THEME.textMed, display: 'flex', gap: '8px' }}>
        <Icon name="verified_user" size={18} style={{ color: ME_COLOR, flexShrink: 0 }} />
        HR checks every change before it is saved to your record, so payroll and emergency contacts stay correct. You may be asked for proof, such as a bank letter.
      </Card>

      {pending && (
        <Card style={{ padding: '14px', marginBottom: '14px', background: THEME.statusWarningBg }}>
          <div style={{ fontWeight: 600, color: THEME.statusWarningText, marginBottom: '6px' }}>Waiting for HR to verify</div>
          {Object.entries(pending.changes || {}).map(([k, v]) => (
            <div key={k} style={{ fontSize: '13px', color: THEME.statusWarningText }}>{LABEL[k] || k}: <b>{v || '(remove)'}</b></div>
          ))}
          <button onClick={cancel} style={{ marginTop: '8px', background: 'none', border: 'none', padding: '6px 0', color: THEME.error, fontFamily: 'inherit', fontSize: '13px', cursor: 'pointer' }}>Cancel this request</button>
        </Card>
      )}
      {!pending && data.last?.status === 'rejected' && (
        <Card style={{ padding: '12px 14px', marginBottom: '14px', background: THEME.statusErrorBg, color: THEME.statusErrorText, fontSize: '13px' }}>
          Your last change wasn't accepted: {data.last.review_note}
        </Card>
      )}

      {FIELDS.map(g => (
        <Card key={g.group} style={{ padding: '14px 16px', marginBottom: '12px', display: 'grid', gap: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{g.group}</div>
          {g.items.map(([k, l, type]) => (
            <div key={k}>
              <label htmlFor={`md-${k}`} style={label}>{l}{changed.includes(k) && <span style={{ color: ME_COLOR }}> · changed</span>}</label>
              <input id={`md-${k}`} type={type} style={field} value={form[k] || ''} disabled={!!pending}
                onChange={e => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
        </Card>
      ))}

      {!pending && changed.length > 0 && (
        <Card style={{ padding: '14px 16px', display: 'grid', gap: '10px' }}>
          <div>
            <label htmlFor="md-reason" style={label}>Reason for the change (optional)</label>
            <input id="md-reason" style={field} value={reason} placeholder="e.g. Changed banks" onChange={e => setReason(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...bigBtn(THEME.surfaceVar, THEME.text), flex: 1 }} onClick={() => setForm(data.current || {})}>Undo</button>
            <button style={{ ...bigBtn(ME_COLOR), flex: 2, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>
              Send {changed.length} change{changed.length > 1 ? 's' : ''} to HR
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}
