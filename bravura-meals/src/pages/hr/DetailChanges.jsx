import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'

const ACCENT = MODULE_COLORS.workforce
const LABEL = {
  phone: 'Mobile number', email: 'Personal email', residential_address: 'Home address',
  bank_name: 'Bank', bank_branch: 'Branch', bank_account_number: 'Account number',
  nok_name: 'Next of kin', nok_relationship: 'Relationship', nok_phone: 'Next of kin phone',
}
const btn = (bg, fg = '#fff') => ({ minHeight: '40px', padding: '8px 14px', borderRadius: '8px', border: 'none', background: bg, color: fg, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' })

export default function DetailChanges() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [tab, setTab] = useState('pending')
  const [rows, setRows] = useState(null)
  const [notes, setNotes] = useState({})
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    let q = supabase.from('employee_change_requests')
      .select('id, changes, previous, reason, status, review_note, created_at, reviewed_at, employee:employees(name, employee_number)')
      .eq('site_id', currentSiteId).order('created_at', { ascending: false }).limit(200)
    q = tab === 'pending' ? q.eq('status', 'pending') : q.neq('status', 'pending')
    const { data, error } = await q
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [currentSiteId, tab])
  useEffect(() => { setRows(null); load() }, [load])

  async function decide(id, approve) {
    setBusy(id)
    const { error } = await supabase.rpc('hr_decide_detail_change', { p_request_id: id, p_approve: approve, p_note: notes[id] || null })
    setBusy(null)
    if (error) { showToast(error.message, 'red'); return }
    showToast(approve ? 'Approved — the employee record is updated' : 'Rejected — the employee has been told why', 'green')
    load()
  }

  const canDecide = can('hr.edit')
  return (
    <div>
      <PageHeader title="Employee Detail Changes" subtitle="Staff request changes from self-service; nothing is saved to their record until HR verifies it." />
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        {[['pending', 'Waiting for HR'], ['done', 'Decided']].map(([v, t]) => (
          <button key={v} onClick={() => setTab(v)} aria-pressed={tab === v} style={btn(tab === v ? ACCENT : THEME.surfaceVar, tab === v ? '#fff' : THEME.text)}>{t}</button>
        ))}
      </div>
      {!rows ? <div style={{ color: THEME.textLow }}>Loading…</div> : rows.length === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>Nothing here.</Card>
      ) : rows.map(r => (
        <Card key={r.id} style={{ padding: '14px 16px', marginBottom: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, color: THEME.text }}>{r.employee?.name} <span style={{ color: THEME.textLow, fontWeight: 400 }}>{r.employee?.employee_number}</span></div>
            <div style={{ fontSize: '12px', color: THEME.textLow }}>Requested {fmtDate(r.created_at.slice(0, 10))}{r.status !== 'pending' ? ` · ${r.status}` : ''}</div>
          </div>
          {r.reason && <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>Reason: {r.reason}</div>}
          <div style={{ overflowX: 'auto', marginTop: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ color: THEME.textMed, textAlign: 'left' }}><th style={{ padding: '4px 8px 4px 0' }}>Field</th><th style={{ padding: '4px 8px' }}>Now on record</th><th style={{ padding: '4px 8px' }}>Requested</th></tr></thead>
              <tbody>
                {Object.entries(r.changes || {}).map(([k, v]) => (
                  <tr key={k} style={{ borderTop: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '6px 8px 6px 0', color: THEME.textMed }}>{LABEL[k] || k}</td>
                    <td style={{ padding: '6px 8px', color: THEME.textLow, textDecoration: 'line-through' }}>{r.previous?.[k] || '—'}</td>
                    <td style={{ padding: '6px 8px', color: THEME.text, fontWeight: 600 }}>{v || '(remove)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.review_note && <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '6px' }}>HR note: {r.review_note}</div>}
          {r.status === 'pending' && canDecide && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
              <input id={`dc-note-${r.id}`} aria-label="Note to employee" placeholder="Note (required to reject, e.g. send a bank letter)" value={notes[r.id] || ''}
                onChange={e => setNotes({ ...notes, [r.id]: e.target.value })}
                style={{ flex: '1 1 240px', minHeight: '40px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }} />
              <button disabled={busy === r.id} onClick={() => decide(r.id, false)} style={btn(THEME.surfaceVar, THEME.error)}>Reject</button>
              <button disabled={busy === r.id} onClick={() => decide(r.id, true)} style={btn(ACCENT)}><Icon name="check" size={16} style={{ verticalAlign: 'middle' }} /> Verified — apply</button>
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
