import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import { Card, PageHeader, showToast, fmtDate } from '../../components/ui'

const ACCENT = MODULE_COLORS.workforce
const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const btn = (bg, fg = '#fff') => ({ minHeight: '36px', padding: '6px 12px', borderRadius: '8px', border: 'none', background: bg, color: fg, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' })
const TABS = [['submitted', 'To approve'], ['approved', 'To pay out'], ['active', 'Being recovered'], ['closed', 'Closed']]

export default function SalaryAdvances() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [tab, setTab] = useState('submitted')
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    let q = supabase.from('salary_advances')
      .select('id, reference, advance_type, amount, installments, installment_amount, reason, status, recovered_amount, rejected_reason, created_at, disbursed_at, employee:employees(name, employee_number)')
      .eq('site_id', currentSiteId).order('created_at', { ascending: false }).limit(300)
    q = tab === 'closed' ? q.in('status', ['settled', 'rejected', 'cancelled']) : q.eq('status', tab)
    const { data, error } = await q
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [currentSiteId, tab])
  useEffect(() => { setRows(null); load() }, [load])

  async function decide(r, approve) {
    const reason = approve ? null : window.prompt('Reason for not approving (the employee sees this):')
    if (!approve && !reason) return
    setBusy(r.id)
    const { error } = await supabase.rpc('hr_decide_salary_advance', { p_id: r.id, p_approve: approve, p_reason: reason })
    setBusy(null)
    if (error) { showToast(error.message, 'red'); return }
    showToast(approve ? 'Approved' : 'Rejected', 'green'); load()
  }
  async function disburse(r) {
    if (!window.confirm(`Confirm ${usd(r.amount)} has been paid to ${r.employee?.name}? This posts to the ledger.`)) return
    setBusy(r.id)
    const { error } = await supabase.rpc('hr_disburse_salary_advance', { p_id: r.id })
    setBusy(null)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Paid out — recovery starts on the next payroll', 'green'); load()
  }

  const outstanding = (rows || []).reduce((s, r) => s + (r.status === 'active' ? Number(r.amount) - Number(r.recovered_amount) : 0), 0)
  return (
    <div>
      <PageHeader title="Salary Advances & Loans" subtitle="Requested by staff in self-service; recovered automatically through payroll."
        actions={rows?.length ? <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => exportCsv('salary_advances.csv',
          ['Reference', 'Employee', 'Number', 'Type', 'Amount', 'Instalments', 'Per instalment', 'Recovered', 'Status', 'Requested'],
          rows.map(r => [r.reference, r.employee?.name, r.employee?.employee_number, r.advance_type, r.amount, r.installments,
            r.installment_amount, r.recovered_amount, r.status, r.created_at?.slice(0, 10)]))}>Export CSV</button> : null} />
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {TABS.map(([v, t]) => (
          <button key={v} onClick={() => setTab(v)} aria-pressed={tab === v} style={btn(tab === v ? ACCENT : THEME.surfaceVar, tab === v ? '#fff' : THEME.text)}>{t}</button>
        ))}
      </div>
      {tab === 'active' && rows && <div style={{ fontSize: '14px', color: THEME.text, marginBottom: '10px' }}>Outstanding balance: <b>{usd(outstanding)}</b></div>}
      {tab === 'submitted' && <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '10px' }}>Where an approval route exists for advances, decide them from the Approvals Inbox instead.</div>}
      <Card style={{ padding: 0, overflowX: 'auto' }}>
        {!rows ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>Nothing here.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '720px' }}>
            <thead><tr style={{ textAlign: 'left', color: THEME.textMed, background: THEME.surfaceVar }}>
              {['Ref', 'Employee', 'Type', 'Amount', 'Recovery', 'Reason', 'Requested', ''].map(h => <th key={h} style={{ padding: '8px 10px' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.reference}</td>
                  <td style={{ padding: '8px 10px' }}>{r.employee?.name}<div style={{ fontSize: '11px', color: THEME.textLow }}>{r.employee?.employee_number}</div></td>
                  <td style={{ padding: '8px 10px' }}>{r.advance_type === 'loan' ? 'Loan' : 'Advance'}</td>
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{usd(r.amount)}</td>
                  <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.installments} × {usd(r.installment_amount)}
                    {Number(r.recovered_amount) > 0 && <div style={{ fontSize: '11px', color: THEME.textLow }}>{usd(r.recovered_amount)} recovered</div>}</td>
                  <td style={{ padding: '8px 10px', color: THEME.textMed }}>{r.reason}{r.rejected_reason && <div style={{ color: THEME.error }}>{r.rejected_reason}</div>}</td>
                  <td style={{ padding: '8px 10px' }}>{fmtDate(r.created_at.slice(0, 10))}</td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {r.status === 'submitted' && can('hr.approve') && <>
                      <button disabled={busy === r.id} style={btn(THEME.surfaceVar, THEME.error)} onClick={() => decide(r, false)}>Reject</button>{' '}
                      <button disabled={busy === r.id} style={btn(ACCENT)} onClick={() => decide(r, true)}>Approve</button>
                    </>}
                    {r.status === 'approved' && (can('hr.approve') || can('expenses.edit')) &&
                      <button disabled={busy === r.id} style={btn(ACCENT)} onClick={() => disburse(r)}>Mark paid out</button>}
                    {!['submitted', 'approved'].includes(r.status) && <span style={{ fontSize: '12px', color: THEME.textMed, textTransform: 'capitalize' }}>{r.status}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
