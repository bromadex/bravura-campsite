import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, MONTHS, usd } from './shared'

function Row({ label, value, strong, negative }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '6px 0', fontSize: '14px',
      borderBottom: `1px solid ${THEME.outlineVar}` }}>
      <span style={{ color: strong ? THEME.text : THEME.textMed, fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 700 : 500, color: negative ? THEME.error : THEME.text }}>
        {negative ? '−' : ''}{usd(value)}
      </span>
    </div>
  )
}

export default function MyPayslips() {
  const { me, loading } = useMe()
  const [slips, setSlips] = useState([])
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(true)

  useEffect(() => {
    if (!me?.linked) return
    supabase.rpc('ess_my_payslips').then(({ data, error }) => {
      if (error) showToast(error.message, 'red')
      setSlips(data || [])
      setOpen((data || [])[0]?.id || null)
      setBusy(false)
    })
  }, [me?.linked])

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="My Payslips" />
      {busy ? <Loading /> : slips.length === 0 ? (
        <Card style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
          No payslips yet. They appear here once payroll for the month is approved.
        </Card>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {slips.map(s => {
            const isOpen = open === s.id
            const allowances = (s.components || []).filter(c => c.type === 'allowance')
            const other = (s.components || []).filter(c => c.type === 'deduction' && !c.statutory)
            return (
              <Card key={s.id} style={{ padding: 0, overflow: 'hidden' }} className="payslip">
                <button onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', border: 'none',
                    background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', minHeight: '56px' }}>
                  <Icon name="payments" size={22} style={{ color: ME_COLOR }} />
                  <span style={{ flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 600, color: THEME.text }}>{MONTHS[s.period_month - 1]} {s.period_year}</span>
                    <span style={{ fontSize: '12px', color: THEME.textLow }}>{s.run_status === 'paid' ? `Paid ${s.paid_at ? new Date(s.paid_at).toLocaleDateString() : ''}` : 'Approved — payment pending'}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{usd(s.net_salary)}</span>
                  <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={20} style={{ color: THEME.textLow }} />
                </button>
                {isOpen && (
                  <div style={{ padding: '4px 16px 16px' }}>
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, margin: '8px 0 2px' }}>Earnings</div>
                    <Row label={`Basic pay (${s.days_worked} days worked${s.days_absent ? `, ${s.days_absent} absent` : ''})`} value={s.basic_salary} />
                    {allowances.map(c => <Row key={c.code || c.name} label={c.name} value={c.amount} />)}
                    <Row label="Gross pay" value={s.gross_salary} strong />
                    <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textLow, margin: '12px 0 2px' }}>Deductions</div>
                    <Row label="PAYE" value={s.paye} negative />
                    <Row label="AIDS levy" value={s.aids_levy} negative />
                    <Row label="NSSA" value={s.nssa_employee} negative />
                    {other.map(c => <Row key={c.code || c.name} label={c.name} value={c.amount} negative />)}
                    <Row label="Total deductions" value={s.total_deductions} strong negative />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '12px' }}>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: THEME.text }}>Net pay</span>
                      <span style={{ fontSize: '20px', fontWeight: 700, color: ME_COLOR, fontVariantNumeric: 'tabular-nums' }}>{usd(s.net_salary)}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '8px' }}>
                      Taxable income {usd(s.taxable_income)} · {me.name} · {me.employee_number} · USD
                    </div>
                    <button onClick={() => window.print()} style={{ marginTop: '12px', border: `1px solid ${THEME.outline}`, background: THEME.surface,
                      color: THEME.text, borderRadius: '10px', padding: '10px 14px', minHeight: '44px', fontFamily: 'inherit', cursor: 'pointer' }}>
                      <Icon name="print" size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Print or save as PDF
                    </button>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
