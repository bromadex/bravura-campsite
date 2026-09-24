import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, usd, field } from './shared'

function Row({ label, value, strong }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '14px' }}>
      <span style={{ color: strong ? THEME.text : THEME.textMed, fontWeight: strong ? 600 : 400 }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: strong ? 700 : 500, color: THEME.text }}>{value}</span>
    </div>
  )
}

export default function MyTaxCertificate() {
  const { me, loading } = useMe()
  const [year, setYear] = useState(new Date().getFullYear())
  const [cert, setCert] = useState(null)

  useEffect(() => {
    if (!me?.linked) return
    setCert(null)
    supabase.rpc('ess_my_tax_certificate', { p_year: year }).then(({ data, error }) => {
      if (error) showToast(error.message, 'red')
      setCert(data || {})
    })
  }, [me?.linked, year])

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />

  const years = Array.from(new Set([new Date().getFullYear(), ...(cert?.available_years || [])])).sort((a, b) => b - a)

  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title="Tax Certificate (ITF16)" />
      <label htmlFor="tc-year" style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Tax year</label>
      <select id="tc-year" style={{ ...field, maxWidth: '160px', marginBottom: '14px' }} value={year} onChange={e => setYear(Number(e.target.value))}>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>

      {!cert ? <Loading /> : Number(cert.months) === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No approved payroll for {year} yet.</Card>
      ) : (
        <Card style={{ padding: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
            <div>
              <div style={{ fontSize: '12px', letterSpacing: '.06em', textTransform: 'uppercase', color: THEME.textLow }}>Employee tax certificate · 1 Jan – 31 Dec {cert.year}</div>
              <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginTop: '4px' }}>{cert.name}</div>
              <div style={{ fontSize: '13px', color: THEME.textMed }}>
                {cert.employee_number} · ID {cert.national_id || '—'} · ZIMRA TIN {cert.zimra_tin || '—'} · {cert.site}
              </div>
            </div>
            <Icon name="receipt_long" size={28} style={{ color: ME_COLOR }} />
          </div>
          <Row label={`Months paid`} value={cert.months} />
          <Row label="Gross earnings" value={usd(cert.gross)} />
          <Row label="Taxable income" value={usd(cert.taxable)} />
          <Row label="PAYE deducted" value={usd(cert.paye)} />
          <Row label="AIDS levy deducted" value={usd(cert.aids_levy)} />
          <Row label="Total tax deducted" value={usd(Number(cert.paye) + Number(cert.aids_levy))} strong />
          <Row label="NSSA contributions (employee)" value={usd(cert.nssa)} />
          <Row label="Net pay received" value={usd(cert.net)} />
          <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '10px' }}>
            Figures from approved payroll, in USD. {!cert.zimra_tin && 'Your ZIMRA TIN is missing — ask HR to add it. '}
            HR issues the signed ITF16 at year end; this is your copy to check it against.
          </div>
          <button onClick={() => window.print()} style={{ marginTop: '12px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text,
            borderRadius: '10px', padding: '10px 14px', minHeight: '44px', fontFamily: 'inherit', cursor: 'pointer' }}>
            <Icon name="print" size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />Print or save as PDF
          </button>
        </Card>
      )}
    </div>
  )
}
