import { THEME, MODULE_COLORS } from '../../utils/permissions'

const color = MODULE_COLORS.contractors

const READY_REPORTS = [
  { icon: 'business_center', label: 'Contractor Cost Report', page: 'cl_cost_dashboard' },
]

const PLANNED_REPORTS = [
  { icon: 'engineering', label: 'Casual Labour Report' },
  { icon: 'schedule', label: 'Timesheet Report' },
  { icon: 'local_shipping', label: 'Vehicle Hire Report' },
  { icon: 'construction', label: 'Equipment Hire Report' },
  { icon: 'location_on', label: 'Cost by Site' },
]

export default function CLReports({ setPage }) {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '16px' }}>
        Reports
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '14px' }}>
        {READY_REPORTS.map(r => (
          <div key={r.label} onClick={() => setPage?.(r.page)} style={{
            background: THEME.surface, borderRadius: '14px', padding: '20px',
            border: `1px solid ${THEME.outlineVar}`, position: 'relative', cursor: 'pointer',
          }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px', marginBottom: '12px',
              background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>{r.icon}</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '10px' }}>{r.label}</div>
            <span style={{
              display: 'inline-block', fontSize: '10px', fontWeight: 700, padding: '3px 10px',
              borderRadius: '999px', background: color + '18', color,
              textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              View Report
            </span>
          </div>
        ))}
        {PLANNED_REPORTS.map(r => (
          <div key={r.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '20px',
            border: `1px solid ${THEME.outlineVar}`, position: 'relative',
          }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px', marginBottom: '12px',
              background: color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '20px', color }}>{r.icon}</span>
            </div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text, marginBottom: '10px' }}>{r.label}</div>
            <span style={{
              display: 'inline-block', fontSize: '10px', fontWeight: 700, padding: '3px 10px',
              borderRadius: '999px', background: THEME.statusNeutralBg, color: THEME.statusNeutralText,
              textTransform: 'uppercase', letterSpacing: '.04em',
            }}>
              Coming Soon
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
