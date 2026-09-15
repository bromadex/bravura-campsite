import { Card, Icon, PageHeader } from '../../components/ui'
import { THEME } from '../../utils/permissions'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'

export default function SheqRiskAssessments({ setPage }) {
  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_risk_assessments" />
      <PageHeader title="Risk Assessments" />
      <Card style={{ padding: '40px', textAlign: 'center' }}>
        <Icon name="assessment" size={48} style={{ color: THEME.textLow }} />
        <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>Risk Assessments — coming soon.</p>
      </Card>
    </div>
  )
}
