import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'

const color = MODULE_COLORS.contractors

const TABLES_CREATED = [
  'contractors',
  'contractor_contracts',
  'contractor_employees',
  'casual_workers',
  'casual_timesheets',
  'hired_vehicles',
  'hired_equipment',
]

export default function CLSettings() {
  const { can } = usePermissions()

  if (!can('contractors.edit')) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>lock</span>
        <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
          You don't have permission to view contractor settings.
        </p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '28px', color }}>settings</span>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: THEME.text }}>Contractor Settings</h2>
      </div>
      <p style={{ fontSize: '13px', color: THEME.textMed, marginTop: '0', marginBottom: '20px' }}>
        Module configuration for Contract &amp; Contractor Management.
      </p>

      <div style={{
        background: THEME.surface, borderRadius: '14px', padding: '20px',
        border: `1px solid ${THEME.outlineVar}`,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>Module Version</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: THEME.text }}>Phase 1</span>
        </div>

        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
          Tables Created
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
          {TABLES_CREATED.map(t => (
            <span key={t} style={{
              fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '999px',
              background: color + '14', color,
            }}>{t}</span>
          ))}
        </div>

        <div style={{
          fontSize: '12px', color: THEME.textMed, padding: '12px 14px',
          background: THEME.surfaceVar, borderRadius: '10px',
        }}>
          Configurable settings (rate defaults, approval workflow, expiry thresholds) are
          coming in Phase 2.
        </div>
      </div>
    </div>
  )
}
