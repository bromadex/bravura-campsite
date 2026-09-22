import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME } from '../../utils/permissions'
import Denied from '../../components/Denied'

export default function ConnectPage({ setPage }) {
  const { can } = usePermissions()
  if (!can('connect.view')) return <Denied />

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ textAlign: 'center', padding: '80px 20px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', margin: '0 auto 12px' }}>chat</span>
        <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text }}>Bravura Connect</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Coming in Phase 3 — messaging, @mentions, /slash T-code tagging.</div>
      </div>
    </div>
  )
}
