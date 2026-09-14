import { THEME } from '../../utils/permissions'

export default function AggregateInventory({ setPage }) {
  return (
    <div style={{ padding: '32px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '28px', color: '#EF6C00' }}>layers</span>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, margin: 0 }}>Aggregate Inventory</h1>
      </div>
      <div style={{
        background: THEME.cardBg, border: '1px solid ' + THEME.border,
        borderRadius: '12px', padding: '40px', textAlign: 'center',
      }}>
        <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>construction</span>
        <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
          This page is under construction. Coming soon.
        </p>
      </div>
    </div>
  )
}
