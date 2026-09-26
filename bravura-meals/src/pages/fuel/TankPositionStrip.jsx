import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'

// Fuel F1 (#69): each tank's book level (last dip + movements since, or the running total for drums),
// how full it is, days of cover at the last 30 days' use, and the dip gap over 30 days — from fuel_tank_position.
export default function TankPositionStrip({ siteId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    if (!siteId) return
    supabase.rpc('fuel_tank_position', { p_site_id: siteId }).then(({ data }) => setRows(data || []))
  }, [siteId])
  if (!rows?.length) return null
  const n = v => Number(v || 0).toLocaleString()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, margin: '0 0 16px' }}>
      {rows.map(r => {
        const low = r.days_cover != null && Number(r.days_cover) < 5
        const gapBad = r.gap_30d != null && Math.abs(Number(r.gap_30d)) > Number(r.tolerance || 120)
        return (
          <div key={r.tank_id} style={{ background: THEME.surface, border: `1px solid ${low ? THEME.error : THEME.outlineVar}`, borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: THEME.textMed }}>
              <span style={{ fontWeight: 600, color: THEME.text }}>{r.tank}</span><span>{r.fuel_type || ''}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: THEME.text, marginTop: 2 }}>{n(r.book_level)} L
              <span style={{ fontSize: 12, fontWeight: 400, color: THEME.textMed }}> of {n(r.capacity)} · {r.pct_full ?? 0}%</span></div>
            <div style={{ height: 6, background: THEME.surfaceVar, borderRadius: 3, margin: '6px 0' }}>
              <div style={{ width: `${Math.min(100, Number(r.pct_full || 0))}%`, height: '100%', borderRadius: 3, background: low ? THEME.error : THEME.primary }} />
            </div>
            <div style={{ fontSize: 12, color: low ? THEME.error : THEME.textMed }}>
              {r.days_cover != null ? `${r.days_cover} days of cover at ${n(r.use_per_day)} L/day` : 'No issues in 30 days'}
            </div>
            <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 2 }}>
              {r.method === 'dipstick' ? (r.last_dip_date ? `Last dip ${r.last_dip_date}: ${n(r.last_dip)} L` : 'No dip yet') : 'Running total (no dips)'}
              {r.gap_30d != null && <span style={{ color: gapBad ? THEME.error : THEME.textLow }}> · dip gaps 30 d: {Number(r.gap_30d) > 0 ? '+' : ''}{n(r.gap_30d)} L</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
