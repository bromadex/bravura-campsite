import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Modal, Icon, SectionLabel, fmtDate } from '../../components/ui'

const TABLE_LABELS = {
  employees:                 'Employees',
  employee_movements:        'Employee Movements',
  employee_position_history: 'Position History',
  room_assignments:          'Room Assignments',
  beds:                      'Beds',
  camp_supply_txns:          'Supply Transactions',
  stock_transfers:           'Stock Transfers',
  user_roles:                'User Roles',
  user_sites:                'User Sites',
}

const ACTION_COLORS = {
  insert: { bg: '#E8F5E9', c: '#1B5E20' },
  update: { bg: '#FFF8E1', c: '#7D5700' },
  delete: { bg: '#FDECEA', c: THEME.error },
}

// Fields that exist on nearly every audited table but add no readable
// value to a diff view — timestamps and the row's own id just repeat
// information already shown elsewhere in the row.
const NOISE_FIELDS = new Set(['id', 'created_at', 'updated_at'])

function diffFields(oldVal, newVal) {
  if (!oldVal && newVal) return Object.entries(newVal).filter(([k]) => !NOISE_FIELDS.has(k)).map(([k, v]) => ({ field: k, from: null, to: v }))
  if (oldVal && !newVal) return Object.entries(oldVal).filter(([k]) => !NOISE_FIELDS.has(k)).map(([k, v]) => ({ field: k, from: v, to: null }))
  if (!oldVal && !newVal) return []
  const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)])
  const out = []
  keys.forEach(k => {
    if (NOISE_FIELDS.has(k)) return
    const from = oldVal[k], to = newVal[k]
    if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ field: k, from, to })
  })
  return out
}

function fmtValue(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function AuditLogViewer() {
  const [entries,      setEntries]      = useState([])
  const [profiles,     setProfiles]     = useState({}) // id -> profile
  const [loading,      setLoading]      = useState(true)
  const [tableFilter,  setTableFilter]  = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [selected,     setSelected]     = useState(null)

  useEffect(() => { fetchLog() }, [tableFilter, actionFilter])

  async function fetchLog() {
    setLoading(true)
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200)
    if (tableFilter !== 'all') q = q.eq('table_name', tableFilter)
    if (actionFilter !== 'all') q = q.eq('action', actionFilter)
    const { data } = await q
    setEntries(data || [])

    // Resolve actor names for whichever user_ids actually show up —
    // many historical rows will have none, since this wasn't captured
    // until now.
    const userIds = [...new Set((data || []).map(e => e.user_id).filter(Boolean))]
    if (userIds.length > 0) {
      const { data: profs } = await supabase.from('profiles').select('id, username, full_name').in('id', userIds)
      const map = {}
      profs?.forEach(p => { map[p.id] = p })
      setProfiles(map)
    } else {
      setProfiles({})
    }
    setLoading(false)
  }

  const tablesPresent = useMemo(() => [...new Set(entries.map(e => e.table_name))], [entries])

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: '0 0 16px' }}>Audit Log</h2>

      {/* Filters */}
      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={tableFilter} onChange={e => setTableFilter(e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="all">All Tables</option>
            {Object.entries(TABLE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          {['all','insert','update','delete'].map(a => (
            <button key={a} onClick={() => setActionFilter(a)} style={{
              padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${actionFilter === a ? THEME.primary : THEME.outline}`,
              background: actionFilter === a ? THEME.surfaceVar : 'transparent',
              color: actionFilter === a ? THEME.primary : THEME.textMed,
            }}>
              {a === 'all' ? 'All Actions' : a.charAt(0).toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: '#5C6BC0' }} />
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '16px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', background: '#fff' }}>
            <thead>
              <tr style={{ background: '#5C6BC0', color: '#fff' }}>
                {['When','Table','Action','Changed','Actor',''].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No matching audit entries</td></tr>
              ) : entries.map(entry => {
                const changes = diffFields(entry.old_value, entry.new_value)
                const ac = ACTION_COLORS[entry.action] || ACTION_COLORS.update
                const actor = profiles[entry.user_id]
                return (
                  <tr key={entry.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => setSelected(entry)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={{ padding: '10px 14px', color: THEME.textMed, whiteSpace: 'nowrap' }}>
                      {new Date(entry.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 500 }}>{TABLE_LABELS[entry.table_name] || entry.table_name}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: ac.bg, color: ac.c }}>
                        {entry.action}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>
                      {entry.action === 'update' ? `${changes.length} field${changes.length === 1 ? '' : 's'}` : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>
                      {actor?.full_name || actor?.username || (entry.user_id ? entry.user_id.slice(0,8) : 'Unknown')}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)}
        title={`${TABLE_LABELS[selected?.table_name] || selected?.table_name} — ${selected?.action}`}>
        {selected && (
          <>
            <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '14px' }}>
              {new Date(selected.created_at).toLocaleString()} · Record ID: {selected.record_id}
            </div>

            <SectionLabel>{selected.action === 'update' ? 'Changed Fields' : selected.action === 'insert' ? 'Created With' : 'Deleted Record'}</SectionLabel>
            {(() => {
              const changes = diffFields(selected.old_value, selected.new_value)
              if (changes.length === 0) return <div style={{ fontSize: '13px', color: THEME.textLow, padding: '10px 0' }}>No field-level differences recorded.</div>
              return (
                <div style={{ borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: THEME.surfaceVar }}>
                        <th style={{ padding: '7px 10px', textAlign: 'left', color: THEME.textMed }}>Field</th>
                        {selected.action === 'update' && <th style={{ padding: '7px 10px', textAlign: 'left', color: THEME.textMed }}>Before</th>}
                        <th style={{ padding: '7px 10px', textAlign: 'left', color: THEME.textMed }}>{selected.action === 'delete' ? 'Was' : selected.action === 'update' ? 'After' : 'Value'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changes.map(c => (
                        <tr key={c.field} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                          <td style={{ padding: '7px 10px', fontWeight: 500, color: THEME.text }}>{c.field}</td>
                          {selected.action === 'update' && <td style={{ padding: '7px 10px', color: THEME.error }}>{fmtValue(c.from)}</td>}
                          <td style={{ padding: '7px 10px', color: THEME.success }}>{fmtValue(selected.action === 'delete' ? c.from : c.to)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
          </>
        )}
      </Modal>
    </div>
  )
}
