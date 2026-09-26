import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { THEME } from '../utils/permissions'

// Fleet A6 (#67): what a person is holding (radios, tools, laptops…). Shown on the employee profile and the
// exit checklist — clearance can't be completed until the list is empty (trg_exit_small_assets).
export default function SmallAssetsHeld({ employeeId, forExit = false, onCount }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    if (!employeeId) return
    supabase.rpc('small_assets_held', { p_employee_id: employeeId }).then(({ data }) => { setRows(data || []); onCount?.((data || []).length) })
  }, [employeeId, onCount])
  if (!rows) return null
  if (!rows.length) return forExit
    ? <div style={{ fontSize: 13, color: THEME.statusSuccessText }}>Holds no company tools or equipment.</div>
    : null
  return (
    <div style={{ border: `1px solid ${forExit ? THEME.statusErrorText : THEME.outlineVar}`, borderRadius: 10, padding: 12, background: forExit ? THEME.statusErrorBg : THEME.surface }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: forExit ? THEME.statusErrorText : THEME.text, marginBottom: 6 }}>
        {forExit ? `Still holding ${rows.length} item${rows.length === 1 ? '' : 's'} — take them back before clearance` : `Holding ${rows.length} item${rows.length === 1 ? '' : 's'}`}
      </div>
      {rows.map(r => (
        <div key={r.asset_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, padding: '3px 0', color: THEME.text }}>
          <span>{r.tag_number} · {r.name}{r.serial_number ? <span style={{ color: THEME.textLow }}> ({r.serial_number})</span> : null}</span>
          <span style={{ color: r.overdue ? THEME.statusErrorText : THEME.textMed, whiteSpace: 'nowrap' }}>
            since {new Date(r.issued_at).toLocaleDateString()}{r.due_back ? ` · due ${r.due_back}` : ''}</span>
        </div>
      ))}
    </div>
  )
}
