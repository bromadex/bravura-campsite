import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { resolveNotifStyle } from '../../utils/notify'
import Denied from '../../components/Denied'

const CATEGORIES = [
  { id: 'all',          label: 'All',           icon: 'notifications' },
  { id: 'approval',     label: 'Approvals',     icon: 'approval' },
  { id: 'reminder',     label: 'Reminders',     icon: 'timer' },
  { id: 'announcement', label: 'Announcements', icon: 'campaign' },
  { id: 'escalation',   label: 'Escalations',   icon: 'priority_high' },
  { id: 'chat',         label: 'Chat',          icon: 'chat' },
  { id: 'general',      label: 'General',       icon: 'inbox' },
]

const PAGE_SIZE = 50

function relativeTime(ts) {
  const diff = Date.now() - new Date(ts)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function dateGroup(ts) {
  const d = new Date(ts)
  const today = new Date()
  const diff = Math.floor((today - d) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (diff < 7) return 'This Week'
  if (diff < 30) return 'This Month'
  return 'Earlier'
}

function groupByDate(items) {
  const order = ['Today', 'Yesterday', 'This Week', 'This Month', 'Earlier']
  const groups = {}
  items.forEach(n => {
    const g = dateGroup(n.created_at)
    if (!groups[g]) groups[g] = []
    groups[g].push(n)
  })
  return order.filter(k => groups[k]).map(k => ({ label: k, items: groups[k] }))
}

const Icon = ({ name, size = 20, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', ...style }}>{name}</span>
)

export default function NotificationCenter() {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const navigate = useNavigate()

  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState('all')
  const [filter, setFilter] = useState('all')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const [mutedCategories, setMutedCategories] = useState([])
  const [savingPrefs, setSavingPrefs] = useState(false)

  useEffect(() => {
    if (!profile?.id) return
    supabase.from('profiles').select('preferences').eq('id', profile.id).maybeSingle().then(({ data }) => {
      if (data?.preferences?.muted_notification_categories) {
        setMutedCategories(data.preferences.muted_notification_categories)
      }
    })
  }, [profile?.id])

  async function toggleMuteCategory(catId) {
    const next = mutedCategories.includes(catId)
      ? mutedCategories.filter(c => c !== catId)
      : [...mutedCategories, catId]
    setMutedCategories(next)
    setSavingPrefs(true)
    const { data: existing } = await supabase.from('profiles').select('preferences').eq('id', profile.id).maybeSingle()
    const prefs = existing?.preferences || {}
    await supabase.from('profiles').update({ preferences: { ...prefs, muted_notification_categories: next } }).eq('id', profile.id)
    setSavingPrefs(false)
  }

  if (!can('notifications.view')) return <Denied />

  const fetchNotifications = useCallback(async (reset = false) => {
    if (!profile?.id) return
    setLoading(true)
    const start = reset ? 0 : offset
    let q = supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
      .range(start, start + PAGE_SIZE - 1)

    if (currentSiteId) q = q.or(`site_id.eq.${currentSiteId},site_id.is.null`)
    if (category !== 'all') q = q.eq('category', category)
    if (filter === 'unread') q = q.eq('is_read', false)
    if (filter === 'read') q = q.eq('is_read', true)

    const { data } = await q
    const rows = data || []
    if (reset) {
      setNotifications(rows)
      setOffset(rows.length)
    } else {
      setNotifications(prev => [...prev, ...rows])
      setOffset(start + rows.length)
    }
    setHasMore(rows.length === PAGE_SIZE)
    setLoading(false)
  }, [profile?.id, currentSiteId, category, filter, offset])

  useEffect(() => {
    fetchNotifications(true)
  }, [profile?.id, currentSiteId, category, filter])

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel('notif-center-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + profile.id }, payload => {
        setNotifications(prev => [payload.new, ...prev])
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile?.id])

  function markRead(id) {
    supabase.from('notifications').update({ is_read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
  }

  function markAllRead() {
    const unread = notifications.filter(n => !n.is_read).map(n => n.id)
    if (!unread.length) return
    supabase.from('notifications').update({ is_read: true }).in('id', unread)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  function archiveNotification(id) {
    supabase.from('notifications').update({ is_archived: true }).eq('id', id)
    setNotifications(prev => prev.filter(n => n.id !== id))
  }

  const unreadCount = notifications.filter(n => !n.is_read).length
  const grouped = groupByDate(notifications)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: THEME.text, margin: 0 }}>Notification Center</h1>
          <p style={{ fontSize: 13, color: THEME.textLow, margin: '4px 0 0' }}>
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {unreadCount > 0 && (
            <button onClick={markAllRead} style={{
              background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`, borderRadius: 8,
              padding: '8px 14px', fontSize: 12, fontWeight: 600, color: THEME.text, cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <Icon name="done_all" size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
              Mark all read
            </button>
          )}
          <button onClick={() => setShowPrefs(v => !v)} style={{
            background: showPrefs ? THEME.accent + '18' : THEME.surfaceVar, border: `1px solid ${showPrefs ? THEME.accent : THEME.outlineVar}`, borderRadius: 8,
            padding: '8px 14px', fontSize: 12, fontWeight: 600, color: showPrefs ? THEME.accent : THEME.text, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <Icon name="tune" size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Preferences
          </button>
        </div>
      </div>

      {/* Preferences panel */}
      {showPrefs && (
        <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: THEME.text, marginBottom: 12 }}>
            <Icon name="notifications_off" size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Mute Categories
          </div>
          <p style={{ fontSize: 12, color: THEME.textLow, margin: '0 0 12px' }}>Muted categories will not show new notifications.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {CATEGORIES.filter(c => c.id !== 'all').map(cat => {
              const muted = mutedCategories.includes(cat.id)
              return (
                <button key={cat.id} onClick={() => toggleMuteCategory(cat.id)} disabled={savingPrefs} style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${muted ? '#d32f2f' : THEME.outlineVar}`,
                  background: muted ? '#d32f2f12' : 'transparent',
                  color: muted ? '#d32f2f' : THEME.textMed,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <Icon name={muted ? 'notifications_off' : cat.icon} size={14} />
                  {cat.label}
                  {muted && <Icon name="close" size={12} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 16 }}>
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => setCategory(cat.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
              border: `1px solid ${category === cat.id ? THEME.accent : THEME.outlineVar}`,
              background: category === cat.id ? THEME.accent + '18' : 'transparent',
              color: category === cat.id ? THEME.accent : THEME.textMed,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Icon name={cat.icon} size={14} />
            {cat.label}
          </button>
        ))}
      </div>

      {/* Filter toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {['all', 'unread', 'read'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: `1px solid ${filter === f ? THEME.accent : THEME.outlineVar}`,
              background: filter === f ? THEME.accent + '12' : 'transparent',
              color: filter === f ? THEME.accent : THEME.textLow,
              cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Notification list */}
      {loading && notifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <Icon name="hourglass_empty" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 13 }}>Loading notifications…</div>
        </div>
      ) : notifications.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <Icon name="notifications_none" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>No notifications</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {filter === 'unread' ? "You're all caught up!" : 'Nothing here yet.'}
          </div>
        </div>
      ) : (
        grouped.map(group => (
          <div key={group.label} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, padding: '0 4px' }}>
              {group.label}
            </div>
            <div style={{ background: THEME.surface, borderRadius: 12, border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
              {group.items.map((n, i) => {
                const { icon: typeIcon, color: typeColor } = resolveNotifStyle(n.type, THEME)
                return (
                  <div
                    key={n.id}
                    onClick={() => {
                      markRead(n.id)
                      if (n.link && n.link.startsWith('/')) navigate(n.link)
                    }}
                    style={{
                      padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start',
                      cursor: n.link ? 'pointer' : 'default',
                      background: n.is_read ? 'transparent' : typeColor + '06',
                      borderBottom: i < group.items.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = THEME.surfaceHover }}
                    onMouseLeave={e => { e.currentTarget.style.background = n.is_read ? 'transparent' : typeColor + '06' }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: typeColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon name={typeIcon} size={17} style={{ color: typeColor }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: n.is_read ? 500 : 700, color: THEME.text }}>{n.title}</span>
                        <span style={{ fontSize: 11, color: THEME.textLow, flexShrink: 0 }}>{relativeTime(n.created_at)}</span>
                      </div>
                      {n.message && (
                        <div style={{ fontSize: 12, color: THEME.textMed, marginTop: 3, lineHeight: 1.5 }}>
                          {n.message.length > 200 ? n.message.slice(0, 200) + '…' : n.message}
                        </div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                        {!n.is_read && <div style={{ width: 6, height: 6, borderRadius: '50%', background: typeColor }} />}
                        {n.category && n.category !== 'general' && (
                          <span style={{ fontSize: 10, fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                            {n.category}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); archiveNotification(n.id) }}
                      title="Archive"
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow,
                        padding: 4, borderRadius: 4, flexShrink: 0, opacity: 0.5,
                        display: 'flex', alignItems: 'center',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = '0.5' }}
                    >
                      <Icon name="archive" size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}

      {/* Load more */}
      {hasMore && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <button
            onClick={() => fetchNotifications(false)}
            disabled={loading}
            style={{
              background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`, borderRadius: 8,
              padding: '10px 24px', fontSize: 13, fontWeight: 600, color: THEME.text, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}
