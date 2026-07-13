import { THEME, MODULE_COLORS } from '../../utils/permissions'

const color = MODULE_COLORS.contractors

export default function CLCostDashboard() {
  return (
    <div style={{ maxWidth: '700px', margin: '0 auto', padding: '80px 20px', textAlign: 'center' }}>
      <div style={{
        width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 20px',
        background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="material-symbols-rounded" style={{ fontSize: '36px', color }}>payments</span>
      </div>
      <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, marginBottom: '8px' }}>
        Cost Dashboard — Coming in Phase 3
      </div>
      <div style={{ fontSize: '13px', color: THEME.textMed, maxWidth: '460px', margin: '0 auto' }}>
        This dashboard will aggregate costs from Meals, Campsite, Fuel, Fleet, and Timesheets
        to show per-contractor cost breakdowns.
      </div>
    </div>
  )
}
