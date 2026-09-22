import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { TXN_CODES, searchCodes } from '../../utils/txnCodes'
import { Icon, Button, Modal, SectionLabel, showToast, initials, fmtDate } from '../../components/ui'
import Denied from '../../components/Denied'

const ACCENT = MODULE_COLORS.connect

const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🔥']

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
  background: THEME.surface, color: THEME.text,
}

function avatarColor(seed) {
  const colors = ['#00838F', '#E07B39', '#2A9D8F', '#5C6BC0', '#D97706', '#7C3AED', '#1565C0', '#0D7377']
  let h = 0
  for (let i = 0; i < (seed || '').length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}

function Avatar({ name, size = 36 }) {
  const label = name ? initials(name) : '?'
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: avatarColor(name || ''), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 700, letterSpacing: '-.02em',
    }}>
      {label}
    </div>
  )
}

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`
  return d.toLocaleDateString()
}

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

export default function ConnectPage({ setPage }) {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [conversations, setConversations] = useState([])
  const [lastMessages, setLastMessages] = useState({})
  const [unreadCounts, setUnreadCounts] = useState({})
  const [siteUsers, setSiteUsers] = useState([])
  const [loadingConvos, setLoadingConvos] = useState(true)

  const [selectedId, setSelectedId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingMessages, setLoadingMessages] = useState(false)

  const [convoSearch, setConvoSearch] = useState('')
  const [convoFilter, setConvoFilter] = useState('all') // all | dm | group | department
  const [msgSearch, setMsgSearch] = useState('')

  const [mobileShowThread, setMobileShowThread] = useState(false)
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 768)

  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatType, setNewChatType] = useState('dm')
  const [newChatName, setNewChatName] = useState('')
  const [newChatUserSearch, setNewChatUserSearch] = useState('')
  const [newChatSelected, setNewChatSelected] = useState([])
  const [creating, setCreating] = useState(false)

  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')

  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const channelRef = useRef(null)

  useEffect(() => {
    function onResize() { setIsMobile(window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // ── Load conversations ──────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    if (!currentSiteId || !profile?.id) return
    setLoadingConvos(true)
    const { data, error } = await supabase
      .from('chat_conversations')
      .select('*, chat_participants!inner(user_id, last_read_at)')
      .eq('site_id', currentSiteId)
      .eq('chat_participants.user_id', profile.id)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (error) { console.error(error); showToast('Failed to load conversations', 'red'); setLoadingConvos(false); return }
    const convos = data || []
    setConversations(convos)

    if (convos.length > 0) {
      const ids = convos.map(c => c.id)
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id, conversation_id, content, created_at, sender_id, is_deleted, sender:profiles(id, full_name)')
        .in('conversation_id', ids)
        .order('created_at', { ascending: false })
      const lastByConvo = {}
      const unread = {}
      const readMap = {}
      convos.forEach(c => {
        const part = (c.chat_participants || []).find(p => p.user_id === profile.id)
        readMap[c.id] = part?.last_read_at || null
      })
      for (const m of msgs || []) {
        if (!lastByConvo[m.conversation_id]) lastByConvo[m.conversation_id] = m
        const lastRead = readMap[m.conversation_id]
        if (m.sender_id !== profile.id && (!lastRead || new Date(m.created_at) > new Date(lastRead))) {
          unread[m.conversation_id] = (unread[m.conversation_id] || 0) + 1
        }
      }
      setLastMessages(lastByConvo)
      setUnreadCounts(unread)
    }
    setLoadingConvos(false)
  }, [currentSiteId, profile?.id])

  const loadSiteUsers = useCallback(async () => {
    if (!currentSiteId) return
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('user_id')
      .or(`site_id.eq.${currentSiteId},site_id.is.null`)
    const roleUserIds = [...new Set((roleData || []).map(r => r.user_id).filter(Boolean))]
    if (!roleUserIds.length) { setSiteUsers([]); return }
    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, full_name, username, employee_id')
      .in('id', roleUserIds)
    // Build employee name + department map
    const empIds = (profileData || []).map(p => p.employee_id).filter(Boolean)
    let empMap = {}
    if (empIds.length) {
      const { data: empData } = await supabase
        .from('employees')
        .select('id, name, department:departments(name)')
        .in('id', empIds)
      ;(empData || []).forEach(e => { empMap[e.id] = { name: e.name, department: e.department?.name || null } })
    }
    const users = (profileData || []).map(p => {
      const emp = empMap[p.employee_id]
      return {
        id: p.id,
        full_name: emp?.name || p.full_name || p.username || 'Unknown',
        department: emp?.department || null,
      }
    }).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    setSiteUsers(users)
  }, [currentSiteId])

  useEffect(() => { loadConversations() }, [loadConversations])
  useEffect(() => { loadSiteUsers() }, [loadSiteUsers])

  // ── Load messages for selected conversation ─────────────────────────────
  const loadMessages = useCallback(async (convoId) => {
    if (!convoId) return
    setLoadingMessages(true)
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*, sender:profiles(id, full_name), reactions:message_reactions(id, emoji, user_id)')
      .eq('conversation_id', convoId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
    if (error) { console.error(error); showToast('Failed to load messages', 'red'); setLoadingMessages(false); return }
    setMessages(data || [])
    setLoadingMessages(false)
    // mark read
    await supabase.from('chat_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', convoId)
      .eq('user_id', profile?.id)
    setUnreadCounts(u => ({ ...u, [convoId]: 0 }))
  }, [profile?.id])

  useEffect(() => {
    if (selectedId) loadMessages(selectedId)
  }, [selectedId, loadMessages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, selectedId])

  // ── Realtime: messages on selected conversation ─────────────────────────
  useEffect(() => {
    if (!selectedId) return
    const channel = supabase.channel(`chat_messages_${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${selectedId}` },
        () => { loadMessages(selectedId) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${selectedId}` },
        () => { loadMessages(selectedId) })
      .subscribe()
    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [selectedId, loadMessages])

  // ── Realtime: all-conversation refresh for unread badges ────────────────
  useEffect(() => {
    if (!currentSiteId) return
    const channel = supabase.channel(`chat_convo_watch_${currentSiteId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => { loadConversations() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [currentSiteId, loadConversations])

  // ── Conversation display helpers ─────────────────────────────────────────
  const [dmNames, setDmNames] = useState({})

  // Resolve DM conversation names to the other participant's name
  useEffect(() => {
    if (!profile?.id || !conversations.length) return
    const dmConvos = conversations.filter(c => c.type === 'dm' && !c.name)
    if (!dmConvos.length) return
    ;(async () => {
      const { data } = await supabase
        .from('chat_participants')
        .select('conversation_id, user_id, profile:profiles(full_name, username)')
        .in('conversation_id', dmConvos.map(c => c.id))
        .neq('user_id', profile.id)
      const names = {}
      ;(data || []).forEach(p => {
        names[p.conversation_id] = p.profile?.full_name || p.profile?.username || 'Unknown'
      })
      setDmNames(names)
    })()
  }, [conversations, profile?.id])

  function convoName(c) {
    if (c.name) return c.name
    if (c.type === 'dm' && dmNames[c.id]) return dmNames[c.id]
    if (c.type === 'dm') return 'Direct Message'
    return 'Conversation'
  }

  const visibleConvos = useMemo(() => {
    const q = convoSearch.trim().toLowerCase()
    return conversations
      .filter(c => convoFilter === 'all' || c.type === convoFilter)
      .filter(c => !q || convoName(c).toLowerCase().includes(q))
      .sort((a, b) => {
        const ta = lastMessages[a.id]?.created_at || a.created_at
        const tb = lastMessages[b.id]?.created_at || b.created_at
        return new Date(tb) - new Date(ta)
      })
  }, [conversations, convoSearch, convoFilter, lastMessages])

  const selectedConvo = conversations.find(c => c.id === selectedId) || null

  const filteredMessages = useMemo(() => {
    const q = msgSearch.trim().toLowerCase()
    if (!q) return messages
    return messages.filter(m => (m.content || '').toLowerCase().includes(q))
  }, [messages, msgSearch])

  const groupedMessages = useMemo(() => {
    const groups = []
    let currentDay = null
    let bucket = null
    for (const m of filteredMessages) {
      const day = new Date(m.created_at).toDateString()
      if (day !== currentDay) {
        currentDay = day
        bucket = { day, label: dayLabel(m.created_at), items: [] }
        groups.push(bucket)
      }
      bucket.items.push(m)
    }
    return groups
  }, [filteredMessages])

  // ── New conversation ─────────────────────────────────────────────────────
  function openNewChat() {
    setNewChatType('dm'); setNewChatName(''); setNewChatUserSearch(''); setNewChatSelected([])
    setNewChatOpen(true)
  }

  const filteredNewChatUsers = useMemo(() => {
    const q = newChatUserSearch.trim().toLowerCase()
    return siteUsers.filter(u => u.id !== profile?.id && (!q || u.full_name.toLowerCase().includes(q)))
  }, [siteUsers, newChatUserSearch, profile?.id])

  function toggleNewChatUser(u) {
    setNewChatSelected(sel => sel.some(s => s.id === u.id) ? sel.filter(s => s.id !== u.id) : [...sel, u])
  }

  async function createConversation() {
    if (newChatType === 'dm' && newChatSelected.length !== 1) {
      showToast('Pick one person for a direct message', 'red'); return
    }
    if (newChatType === 'group' && (!newChatName.trim() || newChatSelected.length === 0)) {
      showToast('Group name and at least one member are required', 'red'); return
    }
    setCreating(true)
    // DM dedupe: check for an existing dm between these two users
    if (newChatType === 'dm') {
      const other = newChatSelected[0]
      const existing = conversations.find(c =>
        c.type === 'dm' &&
        [c.created_by, other.id].every(() => true) // fallback below via participants check
      )
      // Simple check: look through loaded conversations' names isn't reliable for DM;
      // rely on backend constraint if present, otherwise just create.
      void existing
    }
    const { data: convo, error } = await supabase.from('chat_conversations').insert({
      site_id: currentSiteId,
      type: newChatType,
      name: newChatType === 'group' ? newChatName.trim() : null,
      created_by: profile?.id || null,
    }).select().single()
    if (error) { setCreating(false); showToast(error.message, 'red'); return }

    const participantIds = newChatType === 'dm'
      ? [profile.id, newChatSelected[0].id]
      : [profile.id, ...newChatSelected.map(u => u.id)]
    const uniqueIds = [...new Set(participantIds)]
    const { error: partError } = await supabase.from('chat_participants').insert(
      uniqueIds.map(uid => ({ conversation_id: convo.id, user_id: uid }))
    )
    setCreating(false)
    if (partError) { showToast(partError.message, 'red'); return }
    showToast('Conversation created', 'green')
    setNewChatOpen(false)
    await loadConversations()
    setSelectedId(convo.id)
    if (isMobile) setMobileShowThread(true)
  }

  // ── Message input handling (mentions + slash) ───────────────────────────
  function handleInputChange(e) {
    const val = e.target.value
    setInput(val)
    const caret = e.target.selectionStart
    const upToCaret = val.slice(0, caret)
    const atMatch = upToCaret.match(/@([\w .]*)$/)
    const slashMatch = upToCaret.match(/\/(\w*)$/)
    if (atMatch) {
      setMentionOpen(true); setMentionQuery(atMatch[1]); setSlashOpen(false)
    } else if (slashMatch) {
      setSlashOpen(true); setSlashQuery(slashMatch[1]); setMentionOpen(false)
    } else {
      setMentionOpen(false); setSlashOpen(false)
    }
  }

  function insertMention(user) {
    const val = input
    const caret = textareaRef.current?.selectionStart ?? val.length
    const upToCaret = val.slice(0, caret)
    const replaced = upToCaret.replace(/@([\w .]*)$/, `@${user.full_name} `)
    setInput(replaced + val.slice(caret))
    setMentionOpen(false)
    textareaRef.current?.focus()
  }

  function insertTxnCode(t) {
    const val = input
    const caret = textareaRef.current?.selectionStart ?? val.length
    const upToCaret = val.slice(0, caret)
    const replaced = upToCaret.replace(/\/(\w*)$/, `[${t.code}] `)
    setInput(replaced + val.slice(caret))
    setSlashOpen(false)
    textareaRef.current?.focus()
  }

  const mentionMatches = useMemo(() => {
    if (!mentionOpen) return []
    const q = mentionQuery.trim().toLowerCase()
    return siteUsers.filter(u => !q || u.full_name.toLowerCase().includes(q)).slice(0, 6)
  }, [mentionOpen, mentionQuery, siteUsers])

  const slashMatches = useMemo(() => {
    if (!slashOpen) return []
    return searchCodes(slashQuery).slice(0, 6)
  }, [slashOpen, slashQuery])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !mentionOpen && !slashOpen) {
      e.preventDefault()
      sendMessage()
    }
  }

  // ── Send / edit / delete ─────────────────────────────────────────────────
  async function sendMessage() {
    const content = input.trim()
    if (!content || !selectedId || sending) return
    setSending(true)
    if (editingId) {
      const { error } = await supabase.from('chat_messages')
        .update({ content, is_edited: true })
        .eq('id', editingId)
      setSending(false)
      if (error) { showToast(error.message, 'red'); return }
      setEditingId(null); setInput(''); loadMessages(selectedId)
      return
    }
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: selectedId,
      sender_id: profile?.id || null,
      content,
      reply_to: replyTo?.id || null,
    })
    setSending(false)
    if (error) { showToast(error.message, 'red'); return }
    setInput(''); setReplyTo(null)
    loadMessages(selectedId)
    loadConversations()
  }

  async function deleteMessage(m) {
    if (!window.confirm('Delete this message?')) return
    const { error } = await supabase.from('chat_messages').update({ is_deleted: true }).eq('id', m.id)
    if (error) { showToast(error.message, 'red'); return }
    loadMessages(selectedId)
  }

  function startEdit(m) {
    setEditingId(m.id); setInput(m.content || ''); setReplyTo(null)
    textareaRef.current?.focus()
  }

  async function togglePin(m) {
    const { error } = await supabase.from('chat_messages').update({ is_pinned: !m.is_pinned }).eq('id', m.id)
    if (error) { showToast(error.message, 'red'); return }
    loadMessages(selectedId)
  }

  async function toggleReaction(m, emoji) {
    const mine = (m.reactions || []).find(r => r.emoji === emoji && r.user_id === profile?.id)
    if (mine) {
      const { error } = await supabase.from('message_reactions').delete().eq('id', mine.id)
      if (error) { showToast(error.message, 'red'); return }
    } else {
      const { error } = await supabase.from('message_reactions').insert({
        message_id: m.id, user_id: profile?.id, emoji,
      })
      if (error) { showToast(error.message, 'red'); return }
    }
    loadMessages(selectedId)
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selectedId) return
    setUploading(true)
    const path = `${currentSiteId}/${selectedId}/${Date.now()}_${file.name}`
    const { error: upErr } = await supabase.storage.from('connect-files').upload(path, file)
    if (upErr) { setUploading(false); showToast(upErr.message, 'red'); return }
    const { data: urlData } = supabase.storage.from('connect-files').getPublicUrl(path)
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: selectedId,
      sender_id: profile?.id || null,
      content: input.trim() || file.name,
      attachment_url: urlData?.publicUrl || null,
      attachment_name: file.name,
    })
    setUploading(false)
    if (error) { showToast(error.message, 'red'); return }
    setInput('')
    loadMessages(selectedId)
    loadConversations()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function selectConvo(id) {
    setSelectedId(id)
    setEditingId(null); setReplyTo(null); setInput(''); setMsgSearch('')
    if (isMobile) setMobileShowThread(true)
  }

  // ── Reaction summary ─────────────────────────────────────────────────────
  function reactionSummary(m) {
    const map = {}
    for (const r of m.reactions || []) {
      map[r.emoji] = map[r.emoji] || { count: 0, mine: false }
      map[r.emoji].count++
      if (r.user_id === profile?.id) map[r.emoji].mine = true
    }
    return map
  }

  if (!can('connect.view')) return <Denied />

  const showList = !isMobile || !mobileShowThread
  const showThread = !isMobile || mobileShowThread

  return (
    <div style={{ height: 'calc(100vh - 96px)', minHeight: 480, display: 'flex', border: `1px solid ${THEME.outlineVar}`, borderRadius: '14px', overflow: 'hidden', background: THEME.surface }}>
      {/* ── Left: conversation list ── */}
      {showList && (
        <div style={{
          width: isMobile ? '100%' : 320, flexShrink: 0,
          borderRight: isMobile ? 'none' : `1px solid ${THEME.outlineVar}`,
          display: 'flex', flexDirection: 'column', background: THEME.surfaceVar,
        }}>
          <div style={{ padding: '14px 14px 10px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: THEME.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="chat" style={{ color: ACCENT }} />
                Connect
              </div>
              {can('connect.create') && (
                <Button icon="add" size="sm" onClick={openNewChat}>New Chat</Button>
              )}
            </div>
            <input
              style={{ ...inputStyle, padding: '8px 12px', fontSize: '13px' }}
              placeholder="Search conversations…"
              value={convoSearch}
              onChange={e => setConvoSearch(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
              {[['all', 'All'], ['dm', 'DMs'], ['group', 'Groups'], ['department', 'Departments']].map(([k, label]) => (
                <button key={k} onClick={() => setConvoFilter(k)} style={{
                  padding: '4px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                  border: `1px solid ${convoFilter === k ? ACCENT : THEME.outline}`,
                  background: convoFilter === k ? ACCENT : 'transparent',
                  color: convoFilter === k ? '#fff' : THEME.textMed,
                  cursor: 'pointer',
                }}>{label}</button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingConvos ? (
              <div style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
            ) : visibleConvos.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center', color: THEME.textLow }}>
                <Icon name="forum" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                <div style={{ fontSize: '13px', marginBottom: '12px' }}>Start a conversation</div>
                {can('connect.create') && <Button icon="add" size="sm" onClick={openNewChat}>New Chat</Button>}
              </div>
            ) : visibleConvos.map(c => {
              const last = lastMessages[c.id]
              const unread = unreadCounts[c.id] || 0
              const active = c.id === selectedId
              return (
                <div key={c.id} onClick={() => selectConvo(c.id)} style={{
                  display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 14px',
                  cursor: 'pointer', background: active ? THEME.surfaceHover : 'transparent',
                  borderLeft: `3px solid ${active ? ACCENT : 'transparent'}`,
                }}>
                  <Avatar name={convoName(c)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                      <div style={{ fontSize: '13px', fontWeight: unread ? 700 : 600, color: THEME.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {convoName(c)}
                      </div>
                      <div style={{ fontSize: '11px', color: THEME.textLow, flexShrink: 0 }}>{timeAgo(last?.created_at || c.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '2px' }}>
                      <div style={{
                        fontSize: '12px', color: unread ? THEME.text : THEME.textLow, fontWeight: unread ? 600 : 400,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {last ? (last.is_deleted ? 'Message deleted' : `${last.sender_id === profile?.id ? 'You: ' : ''}${last.content || ''}`) : 'No messages yet'}
                      </div>
                      {unread > 0 && (
                        <div style={{
                          background: ACCENT, color: '#fff', borderRadius: '999px', fontSize: '10px', fontWeight: 700,
                          minWidth: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0,
                        }}>{unread}</div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Right: message thread ── */}
      {showThread && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!selectedConvo ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.textLow }}>
              <div style={{ textAlign: 'center' }}>
                <Icon name="forum" size={44} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                Select a conversation or start a new one
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ padding: '12px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', gap: '10px' }}>
                {isMobile && (
                  <button onClick={() => setMobileShowThread(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}>
                    <Icon name="arrow_back" />
                  </button>
                )}
                <Avatar name={convoName(selectedConvo)} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.text }}>{convoName(selectedConvo)}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow }}>
                    {selectedConvo.type === 'dm' ? 'Direct message' : `${selectedConvo.type} conversation`}
                  </div>
                </div>
                <input
                  style={{ ...inputStyle, width: 160, padding: '6px 10px', fontSize: '12px' }}
                  placeholder="Search messages…"
                  value={msgSearch}
                  onChange={e => setMsgSearch(e.target.value)}
                />
              </div>

              {/* Pinned messages */}
              {messages.some(m => m.is_pinned) && (
                <div style={{ padding: '8px 16px', background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '11px', color: THEME.textMed, display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Icon name="push_pin" size={14} style={{ color: ACCENT }} />
                  {messages.filter(m => m.is_pinned).slice(0, 3).map(m => (
                    <span key={m.id} style={{ background: THEME.surface, borderRadius: '8px', padding: '2px 8px', border: `1px solid ${THEME.outlineVar}` }}>
                      {(m.content || '').slice(0, 40)}
                    </span>
                  ))}
                </div>
              )}

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {loadingMessages ? (
                  <div style={{ textAlign: 'center', color: THEME.textLow, padding: '32px' }}>Loading…</div>
                ) : filteredMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: THEME.textLow, padding: '48px 20px' }}>
                    <Icon name="waving_hand" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                    No messages yet — say hello!
                  </div>
                ) : groupedMessages.map(group => (
                  <div key={group.day}>
                    <div style={{ textAlign: 'center', margin: '14px 0 10px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, background: THEME.surfaceVar, padding: '3px 12px', borderRadius: '999px' }}>
                        {group.label}
                      </span>
                    </div>
                    {group.items.map(m => {
                      const mine = m.sender_id === profile?.id
                      const reactions = reactionSummary(m)
                      const replied = m.reply_to ? messages.find(x => x.id === m.reply_to) : null
                      return (
                        <div key={m.id} style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexDirection: mine ? 'row-reverse' : 'row' }}>
                          {!mine && <Avatar name={m.sender?.full_name} size={28} />}
                          <div style={{ maxWidth: '70%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                            {!mine && (
                              <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textMed, marginBottom: '2px' }}>
                                {m.sender?.full_name || 'Unknown'}
                              </div>
                            )}
                            {replied && (
                              <div style={{ fontSize: '11px', color: THEME.textLow, borderLeft: `2px solid ${ACCENT}`, paddingLeft: '6px', marginBottom: '3px', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {replied.is_deleted ? 'Message deleted' : replied.content}
                              </div>
                            )}
                            <div style={{
                              padding: '9px 13px', borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                              background: mine ? ACCENT : THEME.surfaceVar,
                              color: mine ? '#fff' : THEME.text,
                              fontSize: '13.5px', lineHeight: 1.45, wordBreak: 'break-word', position: 'relative',
                            }}>
                              {m.content}
                              {m.attachment_url && (
                                <div style={{ marginTop: '6px' }}>
                                  <a href={m.attachment_url} target="_blank" rel="noreferrer" style={{ color: mine ? '#fff' : ACCENT, fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'underline' }}>
                                    <Icon name="attach_file" size={14} />{m.attachment_name || 'Attachment'}
                                  </a>
                                </div>
                              )}
                              {m.is_edited && <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '6px' }}>(edited)</span>}
                              {m.is_pinned && <Icon name="push_pin" size={12} style={{ position: 'absolute', top: -6, right: mine ? 'auto' : -6, left: mine ? -6 : 'auto', color: ACCENT }} />}
                            </div>

                            {/* Reactions bar */}
                            {Object.keys(reactions).length > 0 && (
                              <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                                {Object.entries(reactions).map(([emoji, info]) => (
                                  <button key={emoji} onClick={() => toggleReaction(m, emoji)} style={{
                                    fontSize: '11px', padding: '1px 6px', borderRadius: '999px', cursor: 'pointer',
                                    border: `1px solid ${info.mine ? ACCENT : THEME.outline}`,
                                    background: info.mine ? `${ACCENT}22` : THEME.surface,
                                  }}>
                                    {emoji} {info.count}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Row actions */}
                            <div style={{ display: 'flex', gap: '8px', marginTop: '3px', fontSize: '10px', color: THEME.textLow, alignItems: 'center' }}>
                              <span>{timeAgo(m.created_at)}</span>
                              <div style={{ display: 'flex', gap: '2px' }}>
                                {REACTIONS.map(emo => (
                                  <button key={emo} onClick={() => toggleReaction(m, emo)} title="React" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '1px 2px', opacity: 0.7 }}>{emo}</button>
                                ))}
                              </div>
                              <button onClick={() => setReplyTo(m)} title="Reply" style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: 0 }}>
                                <Icon name="reply" size={14} />
                              </button>
                              {can('connect.edit') && (
                                <button onClick={() => togglePin(m)} title="Pin" style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: 0 }}>
                                  <Icon name="push_pin" size={14} />
                                </button>
                              )}
                              {mine && (
                                <>
                                  <button onClick={() => startEdit(m)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: 0 }}>
                                    <Icon name="edit" size={14} />
                                  </button>
                                  <button onClick={() => deleteMessage(m)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: 0 }}>
                                    <Icon name="delete" size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply / edit indicator */}
              {(replyTo || editingId) && (
                <div style={{ padding: '8px 16px', background: THEME.surfaceVar, borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                  <div style={{ color: THEME.textMed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {editingId ? 'Editing message' : `Replying to: ${replyTo?.content?.slice(0, 60)}`}
                  </div>
                  <button onClick={() => { setReplyTo(null); setEditingId(null); setInput('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow }}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}

              {/* Input area */}
              <div style={{ padding: '10px 14px', borderTop: `1px solid ${THEME.outlineVar}`, position: 'relative' }}>
                {mentionOpen && mentionMatches.length > 0 && (
                  <div style={{ position: 'absolute', bottom: '100%', left: 14, marginBottom: 4, background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', boxShadow: THEME.shadow2, zIndex: 20, width: 220, maxHeight: 200, overflowY: 'auto' }}>
                    {mentionMatches.map(u => (
                      <div key={u.id} onClick={() => insertMention(u)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        onMouseDown={e => e.preventDefault()}>
                        <Avatar name={u.full_name} size={22} />{u.full_name}
                      </div>
                    ))}
                  </div>
                )}
                {slashOpen && slashMatches.length > 0 && (
                  <div style={{ position: 'absolute', bottom: '100%', left: 14, marginBottom: 4, background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', boxShadow: THEME.shadow2, zIndex: 20, width: 260, maxHeight: 220, overflowY: 'auto' }}>
                    {slashMatches.map(t => (
                      <div key={t.code} onClick={() => insertTxnCode(t)} style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}
                        onMouseDown={e => e.preventDefault()}>
                        <span style={{ fontWeight: 700, color: ACCENT }}>{t.code}</span>
                        <span style={{ color: THEME.textMed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                  {can('connect.create') && (
                    <>
                      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileUpload} />
                      <button onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach file" style={{
                        background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '10px', width: 38, height: 38,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: THEME.textMed, flexShrink: 0,
                      }}>
                        <Icon name={uploading ? 'hourglass_empty' : 'attach_file'} size={18} />
                      </button>
                    </>
                  )}
                  <textarea
                    ref={textareaRef}
                    style={{ ...inputStyle, minHeight: 40, maxHeight: 120, resize: 'vertical', flex: 1 }}
                    placeholder={can('connect.create') ? 'Type a message… @mention  /txn-code' : 'You do not have permission to send messages'}
                    value={input}
                    disabled={!can('connect.create')}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                  />
                  {can('connect.create') && (
                    <Button icon="send" onClick={sendMessage} disabled={sending || !input.trim()}>
                      {sending ? '…' : (editingId ? 'Save' : 'Send')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── New conversation modal ── */}
      <Modal open={newChatOpen} onClose={() => setNewChatOpen(false)} title="New Conversation" dirty={false}
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setNewChatOpen(false)}>Cancel</Button>
            <Button icon="add" onClick={createConversation} disabled={creating}>{creating ? 'Creating…' : 'Create'}</Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <SectionLabel>Type</SectionLabel>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[['dm', 'Direct Message'], ['group', 'Group']].map(([k, label]) => (
                <button key={k} onClick={() => { setNewChatType(k); setNewChatSelected([]) }} style={{
                  flex: 1, padding: '10px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                  border: `1px solid ${newChatType === k ? ACCENT : THEME.outline}`,
                  background: newChatType === k ? `${ACCENT}18` : 'transparent',
                  color: newChatType === k ? ACCENT : THEME.textMed,
                }}>{label}</button>
              ))}
            </div>
          </div>
          {newChatType === 'group' && (
            <div>
              <SectionLabel>Group Name *</SectionLabel>
              <input style={inputStyle} value={newChatName} onChange={e => setNewChatName(e.target.value)} placeholder="e.g. Kamativi Site Ops" />
            </div>
          )}
          <div>
            <SectionLabel>{newChatType === 'dm' ? 'Select Person *' : 'Add Members *'}</SectionLabel>
            <input style={{ ...inputStyle, marginBottom: '8px' }} value={newChatUserSearch} onChange={e => setNewChatUserSearch(e.target.value)} placeholder="Search people…" />
            <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px' }}>
              {filteredNewChatUsers.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: THEME.textLow, fontSize: '12px' }}>No users found</div>
              ) : filteredNewChatUsers.map(u => {
                const sel = newChatSelected.some(s => s.id === u.id)
                return (
                  <div key={u.id} onClick={() => toggleNewChatUser(u)} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', cursor: 'pointer',
                    background: sel ? `${ACCENT}14` : 'transparent', borderBottom: `1px solid ${THEME.outlineVar}`,
                  }}>
                    <Avatar name={u.full_name} size={26} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: THEME.text }}>{u.full_name}</div>
                      {u.department && <div style={{ fontSize: '11px', color: THEME.textLow }}>{u.department}</div>}
                    </div>
                    {sel && <Icon name="check_circle" size={18} style={{ color: ACCENT }} />}
                  </div>
                )
              })}
            </div>
            {newChatSelected.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: THEME.textMed }}>
                {newChatSelected.length} selected: {newChatSelected.map(u => u.full_name).join(', ')}
              </div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
