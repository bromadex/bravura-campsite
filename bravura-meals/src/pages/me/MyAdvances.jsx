import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, StatusPill, usd, bigBtn, field, label } from './shared'

const STATUS_LABEL = { active: 'Being repaid', settled: 'Repaid', submitted: 'Waiting for approval' }

export default function MyAdvances() {
  const { me, loading } = useMe()
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('ess_my_salary_advances')
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [])
  useEffect(() => { if (me?.linked) load() }, [me?.linked, load])

  async function submit() {
    setBusy(true)
    const { data: ref, error } = await supabase.rpc('ess_request_salary_advance', {
      p_type: form.type, p_amount: Number(form.amount), p_installments: form.type === 'loan' ? Number(form.installments) : 1, p_reason: form.reason || '',
    })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`Requested (${ref}) — you will be notified of the decision`, 'green')
    setForm(null); load()
  }

  async function cancel(id) {
    if (!window.confirm('Cancel this request?')) return
    const { error } = await supabase.rpc('ess_cancel_salary_advance', { p_id: id })
    if (error) { showToast(error.message, 'red'); return }
    load()
  }

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />
  if (!rows) return <Loading />

  const open = rows.some(r => ['submitted', 'approved', 'active'].includes(r.status))
  const inst = form && form.type === 'loan' && Number(form.amount) > 0 ? Number(form.amount) / Number(form.installments || 1) : null

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="Advances & Loans" />
      <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '12px' }}>
        A <b>salary advance</b> (up to half your basic pay) is taken off your next payslip. A <b>staff loan</b> is repaid over up to 24 payslips. Both need approval.
      </div>

      {!open && !form && (
        <button style={{ ...bigBtn(ME_COLOR), width: '100%', marginBottom: '16px' }} onClick={() => setForm({ type: 'salary_advance', amount: '', installments: 3, reason: '' })}>
          <Icon name="savings" size={20} /> Request an advance or loan
        </button>
      )}
      {open && !form && <Card style={{ padding: '12px 14px', marginBottom: '14px', fontSize: '13px', color: THEME.textMed }}>You can request another once your current one is repaid.</Card>}

      {form && (
        <Card style={{ padding: '16px', display: 'grid', gap: '12px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[['salary_advance', 'Salary advance'], ['loan', 'Staff loan']].map(([v, t]) => (
              <button key={v} onClick={() => setForm({ ...form, type: v })} aria-pressed={form.type === v} style={{
                flex: 1, minHeight: '44px', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', fontWeight: 600,
                border: `1px solid ${form.type === v ? ME_COLOR : THEME.outline}`, background: form.type === v ? ME_COLOR + '14' : THEME.surface,
                color: form.type === v ? ME_COLOR : THEME.textMed }}>{t}</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="sa-amt" style={label}>Amount (USD)</label>
              <input id="sa-amt" type="number" inputMode="decimal" step="0.01" style={field} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
            </div>
            {form.type === 'loan' && (
              <div>
                <label htmlFor="sa-inst" style={label}>Repay over (months)</label>
                <select id="sa-inst" style={field} value={form.installments} onChange={e => setForm({ ...form, installments: e.target.value })}>
                  {[2, 3, 4, 6, 9, 12, 18, 24].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
          </div>
          {inst && <div style={{ fontSize: '13px', color: THEME.textMed }}>About <b>{usd(inst)}</b> will come off each payslip.</div>}
          <div>
            <label htmlFor="sa-reason" style={label}>Reason</label>
            <input id="sa-reason" style={field} value={form.reason} placeholder="e.g. School fees" onChange={e => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={{ ...bigBtn(THEME.surfaceVar, THEME.text), flex: 1 }} onClick={() => setForm(null)}>Cancel</button>
            <button style={{ ...bigBtn(ME_COLOR), flex: 2, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit}>Send request</button>
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gap: '8px' }}>
        {rows.length === 0 && <Card style={{ padding: '20px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No advances or loans.</Card>}
        {rows.map(r => {
          const pct = Math.min(100, Math.round(Number(r.recovered_amount) / Number(r.amount) * 100))
          return (
            <Card key={r.id} style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{r.advance_type === 'loan' ? 'Staff loan' : 'Salary advance'} {r.reference} · {usd(r.amount)}</div>
                  <div style={{ fontSize: '13px', color: THEME.textMed }}>{r.reason}{r.advance_type === 'loan' ? ` · ${r.installments} × ${usd(r.installment_amount)}` : ''}</div>
                  {r.rejected_reason && <div style={{ fontSize: '12px', color: THEME.error }}>{r.rejected_reason}</div>}
                </div>
                {STATUS_LABEL[r.status]
                  ? <span style={{ fontSize: '11px', fontWeight: 600, color: r.status === 'settled' ? THEME.statusSuccessText : THEME.statusWarningText, whiteSpace: 'nowrap' }}>{STATUS_LABEL[r.status]}</span>
                  : <StatusPill status={r.status} />}
              </div>
              {['active', 'settled'].includes(r.status) && (
                <div style={{ marginTop: '8px' }}>
                  <div style={{ height: '8px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: ME_COLOR }} />
                  </div>
                  <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '4px' }}>{usd(r.recovered_amount)} repaid · {usd(Number(r.amount) - Number(r.recovered_amount))} to go</div>
                </div>
              )}
              {r.status === 'submitted' && (
                <button onClick={() => cancel(r.id)} style={{ marginTop: '6px', background: 'none', border: 'none', padding: '6px 0', color: THEME.error, fontFamily: 'inherit', fontSize: '13px', cursor: 'pointer' }}>Cancel request</button>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
