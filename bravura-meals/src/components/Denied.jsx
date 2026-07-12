import { THEME } from '../utils/permissions'

export default function Denied({ message = 'You do not have permission to view this page.' }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '40vh', color: THEME.textMed, fontSize: '15px',
    }}>
      <div style={{ textAlign: 'center' }}>
        <span style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}>🔒</span>
        {message}
      </div>
    </div>
  )
}
