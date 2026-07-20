import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, Icon, SectionLabel, fmtDate, PageHeader, TableWrap, THead, Th, TRow, Td, showToast } from '../../components/ui'
import { MODULE_COLORS } from '../../utils/permissions'
import { exportCsv } from '../../utils/csv'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import { useSite } from '../../contexts/SiteContext'

const PAGE_SIZE = 200

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
  fuel_transactions:         'Fuel Transactions',
  fuel_deliveries:           'Fuel Deliveries',
  fuel_dip_readings:         'Fuel Dip Readings',
}

const ACTION_COLORS = {
  insert: { bg: THEME.statusSuccessBg, c: THEME.statusSuccessText },
  update: { bg: THEME.statusWarningBg, c: THEME.statusWarningText },
  delete: { bg: THEME.statusErrorBg, c: THEME.error },
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

export default function AuditLogViewer({ setPage }) {
  const { currentSiteId } = useSite()
  const [entries,      setEntries]      = useState([])
  const [tick, setTick] = useState(0)
  useRealtimeSubscription('audit_log', { column: 'site_id', value: currentSiteId }, () => setTick(t => t + 1))
  const [profiles,     setProfiles]     = useState({}) // id -> profile
  const [loading,      setLoading]      = useState(true)
  const [loadingMore,  setLoadingMore]  = useState(false)
  const [hasMore,      setHasMore]      = useState(false)
  const [tableFilter,  setTableFilter]  = useState('all')
  const [actionFilter, setActionFilter] = useState('all')
  const [actorFilter,  setActorFilter]  = useState('all')
  const [fromDate,     setFromDate]     = useState('')
  const [toDate,       setToDate]       = useState('')
  const [selected,     setSelected]     = useState(null)

  useEffect(() => { fetchLog(0) }, [tableFilter, actionFilter, actorFilter, fromDate, toDate, tick])

  function buildQuery(offset) {
    let q = supabase.from('audit_log').select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (tableFilter !== 'all') q = q.eq('table_name', tableFilter)
    if (actionFilter !== 'all') q = q.eq('action', actionFilter)
    if (actorFilter !== 'all') q = q.eq('user_id', actorFilter)
    if (fromDate) q = q.gte('created_at', fromDate)
    if (toDate) q = q.lte('created_at', `${toDate}T23:59:59.999`)
    return q
  }

  async function resolveActors(rows) {
    // Resolve actor names for whichever user_ids actually show up —
    // many historical rows will have none, since this wasn't captured
    // until now.
    const userIds = [...new Set(rows.map(e => e.user_id).filter(Boolean))]
    const unknown = userIds.filter(id => !profiles[id])
    if (unknown.length === 0) return
    const { data: profs } = await supabase.from('profiles').select('id, username, full_name').in('id', unknown)
    if (profs?.length) {
      setProfiles(prev => {
        const map = { ...prev }
        profs.forEach(p => { map[p.id] = p })
        return map
      })
    }
  }

  async function fetchLog(offset) {
    if (offset === 0) setLoading(true)
    else setLoadingMore(true)
    const { data } = await buildQuery(offset)
    const rows = data || []
    setEntries(prev => offset === 0 ? rows : [...prev, ...rows])
    setHasMore(rows.length === PAGE_SIZE)
    await resolveActors(rows)
    setLoading(false)
    setLoadingMore(false)
  }

  // All actors ever seen this session — populates the actor filter dropdown.
  const actorOptions = useMemo(() =>
    Object.values(profiles).sort((a, b) =>
      (a.full_name || a.username || '').localeCompare(b.full_name || b.username || '')
    ), [profiles])

  function handleExport() {
    if (entries.length === 0) { showToast('Nothing to export', 'red'); return }
    exportCsv(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Timestamp', 'Actor', 'Table', 'Action', 'Record ID'],
      entries.map(e => {
        const actor = profiles[e.user_id]
        return [
          new Date(e.created_at).toLocaleString(),
          actor?.full_name || actor?.username || (e.user_id ? e.user_id.slice(0, 8) : 'Unknown'),
          TABLE_LABELS[e.table_name] || e.table_name,
          e.action,
          e.record_id,
        ]
      })
    )
  }

  return (
    <div>
      <PageHeader title="Audit Log" />

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
          <select value={actorFilter} onChange={e => setActorFilter(e.target.value)}
            style={{ padding: '7px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit', outline: 'none' }}>
            <option value="all">All Actors</option>
            {actorOptions.map(p => <option key={p.id} value={p.id}>{p.full_name || p.username}</option>)}
          </select>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: THEME.textMed }}>From</span>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ padding: '6px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '12px', fontFamily: 'inherit', outline: 'none' }} />
            <span style={{ fontSize: '12px', color: THEME.textMed }}>To</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ padding: '6px 10px', border: `1px solid ${THEME.outline}`, borderRadius: '10px', fontSize: '12px', fontFamily: 'inherit', outline: 'none' }} />
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <Button onClick={handleExport} variant="outlined" size="sm" icon="download">Export CSV</Button>
          </div>
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: MODULE_COLORS.admin }} />
        </div>
      ) : (
        <TableWrap>
          <THead color={MODULE_COLORS.admin}>
            {['When','Table','Action','Changed','Actor',''].map(h => (
              <Th key={h}>{h}</Th>
            ))}
          </THead>
          <tbody>
            {entries.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No matching audit entries</td></tr>
            ) : entries.map(entry => {
              const changes = diffFields(entry.old_value, entry.new_value)
              const ac = ACTION_COLORS[entry.action] || ACTION_COLORS.update
              const actor = profiles[entry.user_id]
              return (
                <TRow key={entry.id} onClick={() => setSelected(entry)}>
                  <Td style={{ color: THEME.textMed, whiteSpace: 'nowrap' }}>
                    {new Date(entry.created_at).toLocaleString()}
                  </Td>
                  <Td style={{ fontWeight: 500 }}>{TABLE_LABELS[entry.table_name] || entry.table_name}</Td>
                  <Td>
                    <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: ac.bg, color: ac.c }}>
                      {entry.action}
                    </span>
                  </Td>
                  <Td style={{ color: THEME.textMed }}>
                    {entry.action === 'update' ? `${changes.length} field${changes.length === 1 ? '' : 's'}` : '—'}
                  </Td>
                  <Td style={{ color: THEME.textMed }}>
                    {actor?.full_name || actor?.username || (entry.user_id ? entry.user_id.slice(0,8) : 'Unknown')}
                  </Td>
                  <Td>
                    <Icon name="chevron_right" size={16} style={{ color: THEME.textLow }} />
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {!loading && hasMore && (
        <div style={{ textAlign: 'center', marginTop: '14px' }}>
          <Button onClick={() => fetchLog(entries.length)} variant="outlined" size="sm" icon="expand_more" disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
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
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_audit" />
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
