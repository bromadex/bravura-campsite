import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const EVENT_TYPES = {
  inspection: { label: 'Inspection', color: '#00695C', icon: 'checklist' },
  audit:      { label: 'Audit',      color: '#4527A0', icon: 'verified' },
  permit:     { label: 'Permit',     color: '#E65100', icon: 'description' },
  capa:       { label: 'CAPA Due',   color: '#D32F2F', icon: 'task_alt' },
}

export default function SheqCalendar({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewDate, setViewDate] = useState(() => new Date())
  const [filterType, setFilterType] = useState('all')

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const startOfMonth = new Date(year, month, 1).toISOString().slice(0, 10)
    const endOfMonth = new Date(year, month + 1, 0).toISOString().slice(0, 10)

    const [insRes, audRes, ptwRes, capaRes] = await Promise.all([
      supabase.from('sheq_inspections').select('id, inspection_number, title, inspection_date, status').eq('site_id', currentSiteId).eq('is_archived', false).gte('inspection_date', startOfMonth).lte('inspection_date', endOfMonth),
      supabase.from('sheq_audits').select('id, audit_number, title, audit_date, end_date, status').eq('site_id', currentSiteId).eq('is_archived', false).gte('audit_date', startOfMonth).lte('audit_date', endOfMonth),
      supabase.from('sheq_permits').select('id, permit_number, description, valid_from, valid_until, status').eq('site_id', currentSiteId).eq('is_archived', false).gte('valid_from', startOfMonth).lte('valid_from', endOfMonth),
      supabase.from('sheq_capa').select('id, capa_number, title, due_date, status').eq('site_id', currentSiteId).eq('is_archived', false).gte('due_date', startOfMonth).lte('due_date', endOfMonth).neq('status', 'closed'),
    ])

    const all = []
    ;(insRes.data || []).forEach(r => all.push({ type: 'inspection', date: r.inspection_date, number: r.inspection_number, title: r.title, status: r.status }))
    ;(audRes.data || []).forEach(r => all.push({ type: 'audit', date: r.audit_date, number: r.audit_number, title: r.title, status: r.status }))
    ;(ptwRes.data || []).forEach(r => all.push({ type: 'permit', date: r.valid_from, number: r.permit_number, title: r.description || 'Permit', status: r.status }))
    ;(capaRes.data || []).forEach(r => all.push({ type: 'capa', date: r.due_date, number: r.capa_number, title: r.title, status: r.status }))

    setEvents(all)
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId, year, month])

  const filteredEvents = filterType === 'all' ? events : events.filter(e => e.type === filterType)

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days = []
    for (let i = 0; i < firstDay; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(d)
    return days
  }, [year, month])

  function getEventsForDay(day) {
    if (!day) return []
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return filteredEvents.filter(e => e.date === dateStr)
  }

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)) }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)) }
  function goToday() { setViewDate(new Date()) }

  const today = new Date()
  const isToday = (day) => day && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day

  const monthName = viewDate.toLocaleString('default', { month: 'long', year: 'numeric' })

  const selectStyle = {
    padding: '9px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '10px',
    fontSize: '13px', color: THEME.text, fontFamily: 'inherit', outline: 'none',
    background: THEME.surface, cursor: 'pointer',
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view SHEQ calendar.</div>

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_calendar" />
      <PageHeader title="SHEQ Calendar" subtitle={`${events.length} events this month`} icon="calendar_month" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button variant="ghost" onClick={prevMonth}><Icon name="chevron_left" size={18} /></Button>
          <div style={{ fontSize: '16px', fontWeight: 700, color: THEME.text, minWidth: '180px', textAlign: 'center' }}>{monthName}</div>
          <Button variant="ghost" onClick={nextMonth}><Icon name="chevron_right" size={18} /></Button>
          <Button variant="ghost" onClick={goToday} style={{ fontSize: '12px' }}>Today</Button>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select style={selectStyle} value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="all">All Events</option>
            {Object.entries(EVENT_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {Object.entries(EVENT_TYPES).map(([k, v]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: THEME.textMed }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: v.color }} />
            {v.label}
          </div>
        ))}
      </div>

      <Card style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: THEME.textMed }}>Loading...</div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${THEME.outline}` }}>
              {DAYS.map(d => (
                <div key={d} style={{ padding: '10px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', background: THEME.surfaceVar }}>{d}</div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {calendarDays.map((day, idx) => {
                const dayEvents = getEventsForDay(day)
                return (
                  <div key={idx} style={{
                    minHeight: '90px', padding: '6px', borderRight: (idx + 1) % 7 === 0 ? 'none' : `1px solid ${THEME.outline}`,
                    borderBottom: `1px solid ${THEME.outline}`,
                    background: isToday(day) ? '#FFF3E0' : day ? 'transparent' : THEME.surfaceVar,
                  }}>
                    {day && (
                      <>
                        <div style={{ fontSize: '12px', fontWeight: isToday(day) ? 700 : 500, color: isToday(day) ? ACCENT : THEME.text, marginBottom: '4px' }}>{day}</div>
                        {dayEvents.slice(0, 3).map((ev, i) => {
                          const et = EVENT_TYPES[ev.type]
                          return (
                            <div key={i} style={{
                              fontSize: '10px', padding: '2px 5px', borderRadius: '4px', marginBottom: '2px',
                              background: et.color + '18', color: et.color, fontWeight: 600,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {ev.number}
                            </div>
                          )
                        })}
                        {dayEvents.length > 3 && (
                          <div style={{ fontSize: '10px', color: THEME.textMed, fontWeight: 600 }}>+{dayEvents.length - 3} more</div>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {filteredEvents.length > 0 && (
        <Card style={{ marginTop: '18px' }}>
          <div style={{ padding: '16px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.text, marginBottom: '12px' }}>Events This Month</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredEvents.sort((a, b) => a.date.localeCompare(b.date)).map((ev, i) => {
                const et = EVENT_TYPES[ev.type]
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', borderRadius: '8px', background: THEME.surfaceVar }}>
                    <Icon name={et.icon} size={16} style={{ color: et.color }} />
                    <span style={{ fontSize: '12px', fontWeight: 600, color: et.color, minWidth: '70px' }}>{ev.number}</span>
                    <span style={{ fontSize: '12px', color: THEME.textMed, minWidth: '80px' }}>{ev.date}</span>
                    <span style={{ fontSize: '12px', color: THEME.text, flex: 1 }}>{ev.title}</span>
                    <span style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '4px', background: et.color + '18', color: et.color, fontWeight: 600 }}>{et.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
