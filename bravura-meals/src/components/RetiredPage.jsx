import { useNavigate } from 'react-router-dom'
import { THEME } from '../utils/permissions'
import { Card, Icon, PageHeader } from './ui'

// A screen that has been replaced. Kept so its T-code and old bookmarks still resolve.
export default function RetiredPage({ title, reason, links = [] }) {
  const navigate = useNavigate()
  return (
    <div style={{ maxWidth: '640px' }}>
      <PageHeader title={title} />
      <Card style={{ padding: '20px', display: 'grid', gap: '12px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', color: THEME.text, fontSize: '14px', lineHeight: 1.6 }}>
          <Icon name="info" size={20} style={{ color: THEME.textMed, flexShrink: 0, marginTop: '2px' }} />
          <span>{reason}</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {links.map(([label, path]) => (
            <button key={path} onClick={() => navigate(path)} style={{ minHeight: '40px', padding: '8px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
              background: THEME.surface, color: THEME.text, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
      </Card>
    </div>
  )
}
