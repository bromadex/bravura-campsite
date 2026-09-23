import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME } from '../../utils/permissions'
import Denied from '../../components/Denied'

export default function DocShareSettings({ setPage }) {
  const { can } = usePermissions()
  if (!can('ds.view')) return <Denied />

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ textAlign: 'center', padding: '80px 20px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', margin: '0 auto 12px' }}>settings</span>
        <div style={{ fontSize: 16, fontWeight: 700, color: THEME.text }}>DocShare Settings</div>
        <div style={{ fontSize: 13, marginTop: 6 }}>Categories, folder templates, file size limits, and allowed file types.</div>
        <div style={{ fontSize: 12, marginTop: 4, color: THEME.textLow }}>Coming in a future update.</div>
      </div>
    </div>
  )
}
