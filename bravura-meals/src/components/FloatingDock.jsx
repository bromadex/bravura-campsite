import { useState, useEffect, lazy, Suspense } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../utils/permissions'

const ConnectChat  = lazy(() => import('../pages/connect/ConnectPage'))
const MeHome       = lazy(() => import('../pages/me/MeHome'))
const MyPayslips   = lazy(() => import('../pages/me/MyPayslips'))
const MyLeave      = lazy(() => import('../pages/me/MyLeave'))
const MyAttendance = lazy(() => import('../pages/me/MyAttendance'))
const MyExpenses   = lazy(() => import('../pages/me/MyExpenses'))

const ME_TABS = [
  { id: 'me_home',       label: 'Home',       icon: 'home',         C: MeHome },
  { id: 'me_payslips',   label: 'Payslips',   icon: 'payments',     C: MyPayslips },
  { id: 'me_leave',      label: 'Leave',      icon: 'beach_access', C: MyLeave },
  { id: 'me_attendance', label: 'Attendance', icon: 'schedule',     C: MyAttendance },
  { id: 'me_expenses',   label: 'Expenses',   icon: 'receipt_long', C: MyExpenses },
]

// Shared chat-unread count so the home grid badge and the dock use one subscription.
let chatUnreadValue = 0
const unreadListeners = new Set()
function setChatUnreadShared(v) {
  chatUnreadValue = typeof v === 'function' ? v(chatUnreadValue) : v
  unreadListeners.forEach(fn => fn(chatUnreadValue))
}
export function useChatUnreadCount() {
  const [n, setN] = useState(chatUnreadValue)
  useEffect(() => { unreadListeners.add(setN); return () => unreadListeners.delete(setN) }, [])
  return n
}

function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)
  useEffect(() => {
    const on = () => setM(window.innerWidth < 768)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return m
}

const fabBase = {
  position: 'fixed', border: 'none', cursor: 'pointer', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform .18s',
}

export default function FloatingDock() {
  const { profile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const chatUnread = useChatUnreadCount()

  const [panel, setPanel] = useState(null)        // 'chat' | 'me' | null
  const [meTab, setMeTab] = useState('me_home')
  const [chatPopup, setChatPopup] = useState(null)

  const onConnectPage = location.pathname.startsWith('/connect')
  const onMePage = location.pathname.startsWith('/me')

  // Close the panels when navigating to a full page.
  useEffect(() => { setPanel(null) }, [location.pathname])

  useEffect(() => {
    if (!profile?.id) return
    async function loadChatUnread() {
      const { data: parts } = await supabase.from('chat_participants')
        .select('conversation_id, last_read_at').eq('user_id', profile.id)
      if (!parts?.length) { setChatUnreadShared(0); return }
      let total = 0
      for (const p of parts) {
        let q = supabase.from('chat_messages').select('*', { count: 'exact', head: true })
          .eq('conversation_id', p.conversation_id).eq('is_deleted', false).neq('sender_id', profile.id)
        if (p.last_read_at) q = q.gt('created_at', p.last_read_at)
        const { count } = await q
        total += (count || 0)
      }
      setChatUnreadShared(total)
    }
    loadChatUnread()
    const t = setInterval(loadChatUnread, 30_000)
    const chan = supabase.channel('dock-chat-' + profile.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, async (payload) => {
        const msg = payload.new
        if (msg.sender_id === profile.id) return
        const { data: part } = await supabase.from('chat_participants').select('conversation_id')
          .eq('user_id', profile.id).eq('conversation_id', msg.conversation_id).maybeSingle()
        if (!part) return
        setChatUnreadShared(v => v + 1)
        const { data: sender } = await supabase.from('profiles')
          .select('full_name, username, employee:employees(name)').eq('id', msg.sender_id).maybeSingle()
        const name = sender?.employee?.name || sender?.full_name || sender?.username || 'Someone'
        setChatPopup({ name, text: msg.content?.slice(0, 80) || 'sent a message' })
        setTimeout(() => setChatPopup(null), 5000)
      })
      .subscribe()
    return () => { clearInterval(t); supabase.removeChannel(chan) }
  }, [profile?.id])

  if (!profile?.id) return null

  const panelBox = {
    position: 'fixed', bottom: isMobile ? '84px' : '96px', right: isMobile ? '8px' : '28px', zIndex: 150,
    width: isMobile ? 'calc(100vw - 16px)' : '420px',
    height: isMobile ? 'calc(100dvh - 100px)' : '620px', maxHeight: 'calc(100dvh - 110px)',
    borderRadius: '16px', overflow: 'hidden', background: THEME.surface,
    border: `1px solid ${THEME.outlineVar}`,
    boxShadow: '0 12px 48px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.12)',
    display: 'flex', flexDirection: 'column', animation: 'dockPanelIn .22s ease-out',
  }
  const chatRight = isMobile ? '16px' : '28px'
  const chatBottom = isMobile ? '16px' : '28px'
  const showChatFab = !onConnectPage
  const Tab = ME_TABS.find(t => t.id === meTab) || ME_TABS[0]

  return (
    <>
      {panel === 'chat' && showChatFab && (
        <div style={panelBox}>
          <Suspense fallback={<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: THEME.textLow, fontSize: '13px' }}>Loading…</div>}>
            <ConnectChat floatingPanel />
          </Suspense>
        </div>
      )}

      {panel === 'me' && (
        <div style={panelBox} role="dialog" aria-label="My Workspace">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', background: MODULE_COLORS.me, color: '#fff' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>badge</span>
            <span style={{ fontWeight: 600, fontSize: '15px', flex: 1 }}>My Workspace</span>
            <button onClick={() => navigate(`/me/${meTab}`)} title="Open as full page" aria-label="Open as full page"
              style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px', display: 'flex' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>open_in_full</span>
            </button>
            <button onClick={() => setPanel(null)} title="Close" aria-label="Close"
              style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', padding: '4px', display: 'flex' }}>
              <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>close</span>
            </button>
          </div>
          <div role="tablist" style={{ display: 'flex', borderBottom: `1px solid ${THEME.outlineVar}`, background: THEME.surface }}>
            {ME_TABS.map(t => {
              const active = t.id === meTab
              return (
                <button key={t.id} role="tab" aria-selected={active} onClick={() => setMeTab(t.id)} style={{
                  flex: 1, minHeight: '52px', padding: '6px 2px', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: 'transparent', color: active ? MODULE_COLORS.me : THEME.textMed,
                  borderBottom: `2px solid ${active ? MODULE_COLORS.me : 'transparent'}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', fontSize: '11px', fontWeight: active ? 600 : 400,
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '20px' }}>{t.icon}</span>
                  {t.label}
                </button>
              )
            })}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px', background: THEME.bg || THEME.surface }}>
            <Suspense fallback={<div style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>Loading…</div>}>
              <Tab.C setPage={setMeTab} />
            </Suspense>
          </div>
        </div>
      )}

      {chatPopup && panel !== 'chat' && showChatFab && (
        <div onClick={() => { setChatPopup(null); setPanel('chat') }} style={{
          position: 'fixed', bottom: '152px', right: chatRight, zIndex: 9999,
          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '14px',
          padding: '12px 16px', width: 'min(340px, calc(100vw - 32px))', boxSizing: 'border-box',
          boxShadow: '0 8px 32px rgba(0,0,0,.18)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px',
          animation: 'dockPanelIn .25s ease-out',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '20px', color: MODULE_COLORS.connect }}>chat</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{chatPopup.name}</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chatPopup.text}</div>
          </div>
        </div>
      )}

      {/* Self-service button — stacked above Connect */}
      {!onMePage && panel !== 'chat' && (
        <button onClick={() => setPanel(p => p === 'me' ? null : 'me')} title="My Workspace — payslips, leave, expenses"
          aria-label="My Workspace" aria-expanded={panel === 'me'}
          style={{ ...fabBase, bottom: showChatFab ? (isMobile ? '80px' : '96px') : chatBottom, right: isMobile ? '20px' : '32px',
            zIndex: 160, width: '48px', height: '48px', background: MODULE_COLORS.me,
            boxShadow: '0 4px 14px rgba(0,137,123,.4), 0 2px 6px rgba(0,0,0,.18)',
            display: panel === 'me' && showChatFab ? 'none' : 'flex' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}>
          <span className="material-symbols-rounded filled" style={{ fontSize: '24px', color: '#fff' }}>{panel === 'me' ? 'close' : 'badge'}</span>
        </button>
      )}

      {showChatFab && (
        <button onClick={() => setPanel(p => (p ? null : 'chat'))} title={panel ? 'Close' : 'Bravura Connect'}
          aria-label={panel ? 'Close panel' : 'Bravura Connect'}
          style={{ ...fabBase, bottom: chatBottom, right: chatRight, zIndex: 160, width: '56px', height: '56px',
            background: panel === 'me' ? MODULE_COLORS.me : '#982329',
            boxShadow: '0 4px 14px rgba(152,35,41,.45), 0 2px 6px rgba(0,0,0,.18)' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}>
          <span className="material-symbols-rounded filled" style={{ fontSize: '26px', color: '#fff' }}>{panel ? 'close' : 'chat'}</span>
          {chatUnread > 0 && !panel && (
            <span style={{
              position: 'absolute', top: '-2px', right: '-2px', minWidth: '20px', height: '20px', borderRadius: '50px',
              background: '#EF4444', color: '#fff', fontSize: '11px', fontWeight: 700, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', border: '2px solid #fff',
            }}>{chatUnread > 99 ? '99+' : chatUnread}</span>
          )}
        </button>
      )}

      <style>{`
        @keyframes dockPanelIn { from { transform: translateY(16px) scale(.97); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { [role="dialog"] { animation: none !important; } }
      `}</style>
    </>
  )
}
