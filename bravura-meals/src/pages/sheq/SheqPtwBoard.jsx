import { useState, useEffect, useMemo, useRef } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, PageHeader } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const COLUMNS = [
  { key: 'requested',  label: 'Requested',  color: '#9E9E9E', icon: 'schedule' },
  { key: 'approved',   label: 'Approved',   color: '#1565C0', icon: 'verified' },
  { key: 'active',     label: 'Active',     color: '#2E7D32', icon: 'play_circle' },
  { key: 'suspended',  label: 'Suspended',  color: '#E65100', icon: 'pause_circle' },
  { key: 'closed',     label: 'Closed',     color: '#37474F', icon: 'check_circle' },
]

// Map raw statuses to board columns
function toColumn(status, endDate) {
  if (status === 'active' && endDate) {
    const today = new Date().toISOString().slice(0, 10)
    if (endDate < today) return 'closed' // expired shows in closed
  }
  if (['supervisor_approved', 'sheq_approved', 'area_approved'].includes(status)) return 'approved'
  if (['requested', 'active', 'suspended', 'closed'].includes(status)) return status
  if (status === 'rejected') return 'closed'
  if (status === 'expired') return 'closed'
  return status
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer', maxWidth: '200px' }

// Use a small color palette for permit types
const TYPE_COLORS = [
  '#D32F2F', '#1565C0', '#2E7D32', '#E65100', '#6A1B9A',
  '#00695C', '#AD1457', '#37474F', '#F57F17', '#00838F',
]

function getTypeColor(typeId, typeMap) {
  const keys = Object.keys(typeMap).sort()
  const idx = keys.indexOf(typeId)
  return TYPE_COLORS[idx >= 0 ? idx % TYPE_COLORS.length : 0]
}

export default function SheqPtwBoard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()

  const [permits, setPermits] = useState([])
  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0, 10))
  const [typeFilter, setTypeFilter] = useState('')
  const [permitTypes, setPermitTypes] = useState([])
  const intervalRef = useRef(null)

  const canView = can('sheq.view')

  async function fetchPermits() {
    if (!currentSiteId) return
    try {
      const { data, error } = await supabase
        .from('sheq_permits')
        .select('*, permit_type:sheq_permit_types!sheq_permits_permit_type_id_fkey(id, name), requester:employees!sheq_permits_requested_by_fkey(name)')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .lte('start_date', dateFilter)
        .or(`end_date.gte.${dateFilter},end_date.is.null`)
        .order('created_at', { ascending: false })
      if (error) throw error
      setPermits(data || [])
    } catch {
      // silent — board is read-only visualization
    } finally {
      setLoading(false)
    }
  }

  async function fetchTypes() {
    if (!currentSiteId) return
    const { data } = await supabase.from('sheq_permit_types').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name')
    setPermitTypes(data || [])
  }

  useEffect(() => { fetchTypes() }, [currentSiteId])
  useEffect(() => { setLoading(true); fetchPermits() }, [currentSiteId, dateFilter])

  // Auto-refresh every 30s
  useEffect(() => {
    intervalRef.current = setInterval(fetchPermits, 30000)
    return () => clearInterval(intervalRef.current)
  }, [currentSiteId, dateFilter])

  // Build type color map
  const typeMap = useMemo(() => {
    const m = {}
    permitTypes.forEach(t => { m[t.id] = t.name })
    return m
  }, [permitTypes])

  // Filter by type
  const filteredPermits = useMemo(() => {
    if (!typeFilter) return permits
    return permits.filter(p => p.permit_type_id === typeFilter)
  }, [permits, typeFilter])

  // Group into columns
  const columns = useMemo(() => {
    const groups = {}
    COLUMNS.forEach(c => { groups[c.key] = [] })
    filteredPermits.forEach(p => {
      const col = toColumn(p.status, p.end_date)
      if (groups[col]) groups[col].push(p)
    })
    return groups
  }, [filteredPermits])

  // Summary counts
  const totalPermits = filteredPermits.length
  const activeCount = columns.active?.length || 0
  const pendingCount = (columns.requested?.length || 0) + (columns.approved?.length || 0)

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_ptw_board" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view permits.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_ptw_board" />

      <PageHeader title="PTW Board" />

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="calendar_today" size={16} style={{ color: THEME.textMed }} />
          <input
            type="date"
            style={{ ...inputStyle, width: 'auto', maxWidth: '160px' }}
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
          />
        </div>
        <select style={selectStyle} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Permit Types</option>
          {permitTypes.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Summary bar */}
      <div style={{
        display: 'flex', gap: '24px', padding: '12px 16px', marginBottom: '16px',
        background: THEME.surfaceVar, borderRadius: '10px', flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="description" size={16} style={{ color: ACCENT }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{totalPermits}</span>
          <span style={{ fontSize: '12px', color: THEME.textMed }}>Total Permits</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="play_circle" size={16} style={{ color: '#2E7D32' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{activeCount}</span>
          <span style={{ fontSize: '12px', color: THEME.textMed }}>Active</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="schedule" size={16} style={{ color: '#1565C0' }} />
          <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{pendingCount}</span>
          <span style={{ fontSize: '12px', color: THEME.textMed }}>Pending</span>
        </div>
        <div style={{ marginLeft: 'auto', fontSize: '11px', color: THEME.textLow, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Icon name="refresh" size={12} style={{ color: THEME.textLow }} />
          Auto-refreshes every 30s
        </div>
      </div>

      {/* Board */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading board...</div>
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '8px' }}>
          {COLUMNS.map(col => (
            <div key={col.key} style={{ minWidth: '220px', flex: 1 }}>
              {/* Column header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 12px', marginBottom: '8px',
                background: col.color + '14', borderRadius: '10px 10px 0 0',
                borderBottom: `2px solid ${col.color}`,
              }}>
                <Icon name={col.icon} size={16} style={{ color: col.color }} />
                <span style={{ fontSize: '13px', fontWeight: 700, color: col.color }}>{col.label}</span>
                <span style={{
                  marginLeft: 'auto', fontSize: '11px', fontWeight: 700,
                  background: col.color, color: '#fff',
                  padding: '2px 8px', borderRadius: '10px',
                }}>
                  {columns[col.key]?.length || 0}
                </span>
              </div>

              {/* Cards */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minHeight: '100px' }}>
                {(columns[col.key] || []).length === 0 ? (
                  <div style={{ padding: '20px', textAlign: 'center', fontSize: '12px', color: THEME.textLow }}>
                    No permits
                  </div>
                ) : (
                  (columns[col.key] || []).map(p => {
                    const typeColor = getTypeColor(p.permit_type_id, typeMap)
                    return (
                      <div
                        key={p.id}
                        onClick={() => setPage('sq_permits')}
                        style={{
                          padding: '12px', borderRadius: '10px',
                          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
                          cursor: 'pointer', transition: 'box-shadow .15s',
                          position: 'relative', overflow: 'hidden',
                        }}
                        onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
                        onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                      >
                        {/* Type color stripe */}
                        <div style={{
                          position: 'absolute', top: 0, left: 0, bottom: 0, width: '4px',
                          background: typeColor, borderRadius: '10px 0 0 10px',
                        }} />

                        <div style={{ paddingLeft: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 600, color: ACCENT }}>{p.permit_number}</span>
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.title || '--'}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: THEME.textMed }}>
                            {p.permit_type?.name && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: typeColor, flexShrink: 0 }} />
                                {p.permit_type.name}
                              </div>
                            )}
                            {p.location && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Icon name="location_on" size={11} style={{ color: THEME.textLow }} />
                                {p.location}
                              </div>
                            )}
                            {(p.start_time || p.end_time) && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Icon name="schedule" size={11} style={{ color: THEME.textLow }} />
                                {p.start_time || '--'} - {p.end_time || '--'}
                              </div>
                            )}
                            {p.requester?.name && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Icon name="person" size={11} style={{ color: THEME.textLow }} />
                                {p.requester.name}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
