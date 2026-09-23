import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { searchCodes, resolveCode } from '../../utils/txnCodes'
import { searchEntities, SEARCH_CATEGORIES } from '../../utils/searchEngine'
import { Icon, Button, Modal, SectionLabel, showToast, initials } from '../../components/ui'
import Denied from '../../components/Denied'

const ACCENT = MODULE_COLORS.connect
const MR_PRIMARY = '#800020'
const MR_SENT_BG = '#F2D5DC'
const MR_RECV_BG = '#FFFFFF'
const MR_HEADER_BG = '#5C0015'
const MR_LIGHT = '#9B1B30'
const MR_CHAT_BG = '#F5EDED'
const MR_TIME = '#667781'
const MR_TICK = '#9B1B30'

const REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🔥']
const EMOJI_QUICK = ['😀', '😂', '😍', '🥰', '😎', '🤔', '😢', '😡', '👍', '👎', '❤️', '🔥', '🎉', '👏', '🙏', '💯', '✅', '❌', '👋', '🤝', '💪', '🫡', '😮', '🤣']

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

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (d.toDateString() === now.toDateString()) return formatTime(iso)
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  if (diff < 86400 * 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

function ReadReceipt({ mine, isRead }) {
  if (!mine) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: '3px' }}>
      {isRead ? (
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M11.07 0.73L4.54 7.26L2.41 5.13L1 6.54L4.54 10.08L12.48 2.14L11.07 0.73Z" fill={MR_TICK} />
          <path d="M14.07 0.73L7.54 7.26L6.88 6.6L5.47 8.01L7.54 10.08L15.48 2.14L14.07 0.73Z" fill={MR_TICK} />
        </svg>
      ) : (
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M11.07 0.73L4.54 7.26L2.41 5.13L1 6.54L4.54 10.08L12.48 2.14L11.07 0.73Z" fill={MR_TIME} />
          <path d="M14.07 0.73L7.54 7.26L6.88 6.6L5.47 8.01L7.54 10.08L15.48 2.14L14.07 0.73Z" fill={MR_TIME} />
        </svg>
      )}
    </span>
  )
}

function RenderContent({ text, navigate }) {
  if (!text) return null
  const parts = text.split(/(\[[A-Z]{2}\d{2}\])/)
  return parts.map((part, i) => {
    const match = part.match(/^\[([A-Z]{2}\d{2})\]$/)
    if (match) {
      const entry = resolveCode(match[1])
      if (entry) {
        const c = MODULE_COLORS[entry.module] || THEME.primary
        return (
          <span key={i} onClick={(e) => { e.stopPropagation(); navigate(entry.path) }} style={{
            display: 'inline-flex', alignItems: 'center', gap: '3px',
            padding: '1px 8px', borderRadius: '6px', cursor: 'pointer',
            background: c + '22', color: c, fontSize: '12px', fontWeight: 700,
            fontFamily: 'monospace', verticalAlign: 'middle', margin: '0 2px',
          }}>
            {match[1]} {entry.label}
          </span>
        )
      }
    }
    return <span key={i}>{part}</span>
  })
}

export default function ConnectPage({ setPage, floatingPanel = false }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { currentSiteId } = useSite()
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
  const [isMobile, setIsMobile] = useState(floatingPanel || (typeof window !== 'undefined' && window.innerWidth < 768))

  const [newChatOpen, setNewChatOpen] = useState(false)
  const [newChatType, setNewChatType] = useState('dm')
  const [newChatName, setNewChatName] = useState('')
  const [newChatUserSearch, setNewChatUserSearch] = useState('')
  const [newChatDeptFilter, setNewChatDeptFilter] = useState('')
  const [newChatSelected, setNewChatSelected] = useState([])
  const [creating, setCreating] = useState(false)

  const [input, setInput] = useState('')
  const [replyTo, setReplyTo] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)

  const [showMembers, setShowMembers] = useState(false)
  const [members, setMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)

  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashEntityResults, setSlashEntityResults] = useState([])
  const slashDebounceRef = useRef(null)

  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showAttachMenu, setShowAttachMenu] = useState(false)

  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const imageInputRef = useRef(null)
  const docInputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const channelRef = useRef(null)
  const selectedIdRef = useRef(null)
  const entitySearchIdRef = useRef(0)
  const emojiRef = useRef(null)
  const attachRef = useRef(null)

  useEffect(() => {
    function onResize() { setIsMobile(floatingPanel || window.innerWidth < 768) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Close emoji/attach menus on outside click
  useEffect(() => {
    function onClick(e) {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmojiPicker(false)
      if (attachRef.current && !attachRef.current.contains(e.target)) setShowAttachMenu(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
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
        .select('id, conversation_id, content, created_at, sender_id, is_deleted, file_name, file_type, sender:profiles(id, full_name)')
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
        if (!lastByConvo[m.conversation_id] && !m.is_deleted) lastByConvo[m.conversation_id] = m
        if (m.is_deleted) continue
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
    if (selectedIdRef.current !== convoId) return
    if (error) { console.error(error); showToast('Failed to load messages', 'red'); setLoadingMessages(false); return }
    setMessages(data || [])
    setLoadingMessages(false)
    await supabase.from('chat_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', convoId)
      .eq('user_id', profile?.id)
    setUnreadCounts(u => ({ ...u, [convoId]: 0 }))
  }, [profile?.id])

  useEffect(() => {
    if (selectedId) loadMessages(selectedId)
  }, [selectedId, loadMessages])

  const prevSelectedIdRef = useRef(null)
  useEffect(() => {
    const isConvoSwitch = prevSelectedIdRef.current !== selectedId
    prevSelectedIdRef.current = selectedId
    messagesEndRef.current?.scrollIntoView({ behavior: isConvoSwitch ? 'auto' : 'smooth' })
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

  const loadMembers = useCallback(async (convoId) => {
    if (!convoId) return
    setLoadingMembers(true)
    const { data } = await supabase
      .from('chat_participants')
      .select('user_id, profile:profiles(full_name, username)')
      .eq('conversation_id', convoId)
    setMembers((data || []).map(p => ({
      id: p.user_id,
      name: p.profile?.full_name || p.profile?.username || 'Unknown',
    })))
    setLoadingMembers(false)
  }, [])

  const visibleConvos = useMemo(() => {
    const q = convoSearch.trim().toLowerCase()
    return conversations
      .filter(c => convoFilter === 'all' || convoFilter === 'unread' || c.type === convoFilter)
      .filter(c => convoFilter !== 'unread' || (unreadCounts[c.id] || 0) > 0)
      .filter(c => !q || convoName(c).toLowerCase().includes(q))
      .sort((a, b) => {
        const ta = lastMessages[a.id]?.created_at || a.created_at
        const tb = lastMessages[b.id]?.created_at || b.created_at
        return new Date(tb) - new Date(ta)
      })
  }, [conversations, convoSearch, convoFilter, lastMessages, unreadCounts])

  const selectedConvo = conversations.find(c => c.id === selectedId) || null

  const filteredMessages = useMemo(() => {
    const q = msgSearch.trim().toLowerCase()
    if (!q) return messages
    return messages.filter(m => (m.content || '').toLowerCase().includes(q))
  }, [messages, msgSearch])

  const messageById = useMemo(() => {
    const map = new Map()
    for (const m of filteredMessages) map.set(m.id, m)
    return map
  }, [filteredMessages])

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
    setNewChatType('dm'); setNewChatName(''); setNewChatUserSearch(''); setNewChatDeptFilter(''); setNewChatSelected([])
    setNewChatOpen(true)
  }

  const departments = useMemo(() => {
    const depts = new Set()
    siteUsers.forEach(u => { if (u.department) depts.add(u.department) })
    return [...depts].sort()
  }, [siteUsers])

  const filteredNewChatUsers = useMemo(() => {
    const q = newChatUserSearch.trim().toLowerCase()
    return siteUsers.filter(u => u.id !== profile?.id && (!q || u.full_name.toLowerCase().includes(q)) && (!newChatDeptFilter || u.department === newChatDeptFilter))
  }, [siteUsers, newChatUserSearch, newChatDeptFilter, profile?.id])

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
    if (newChatType === 'dm') {
      const otherId = newChatSelected[0].id
      const { data: myParts } = await supabase
        .from('chat_participants')
        .select('conversation_id')
        .eq('user_id', profile.id)
      const myConvoIds = (myParts || []).map(p => p.conversation_id)
      if (myConvoIds.length) {
        const { data: theirParts } = await supabase
          .from('chat_participants')
          .select('conversation_id')
          .eq('user_id', otherId)
          .in('conversation_id', myConvoIds)
        const sharedIds = (theirParts || []).map(p => p.conversation_id)
        if (sharedIds.length) {
          const { data: existingDm } = await supabase
            .from('chat_conversations')
            .select('id')
            .in('id', sharedIds)
            .eq('type', 'dm')
            .eq('site_id', currentSiteId)
            .limit(1)
            .maybeSingle()
          if (existingDm) {
            setCreating(false)
            setNewChatOpen(false)
            await loadConversations()
            setSelectedId(existingDm.id)
            if (isMobile) setMobileShowThread(true)
            showToast('Opened existing conversation', 'green')
            return
          }
        }
      }
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
    const replaced = upToCaret.replace(/@([\w .]*)$/, () => `@${user.full_name} `)
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

  function insertEmoji(emoji) {
    const ta = textareaRef.current
    const start = ta?.selectionStart ?? input.length
    setInput(input.slice(0, start) + emoji + input.slice(start))
    setShowEmojiPicker(false)
    setTimeout(() => { ta?.focus(); ta?.setSelectionRange(start + emoji.length, start + emoji.length) }, 0)
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

  useEffect(() => {
    if (!slashOpen || slashQuery.trim().length < 2) { setSlashEntityResults([]); return }
    clearTimeout(slashDebounceRef.current)
    const requestId = ++entitySearchIdRef.current
    slashDebounceRef.current = setTimeout(async () => {
      const results = await searchEntities(slashQuery, currentSiteId)
      if (entitySearchIdRef.current !== requestId) return
      setSlashEntityResults(results.slice(0, 5))
    }, 300)
    return () => clearTimeout(slashDebounceRef.current)
  }, [slashQuery, slashOpen, currentSiteId])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !mentionOpen && !slashOpen) {
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
    if (file.size > 10 * 1024 * 1024) { showToast('File too large — 10 MB limit', 'red'); return }
    const allowed = ['image/', 'application/pdf', 'text/']
    if (!allowed.some(t => file.type.startsWith(t))) { showToast('File type not allowed', 'red'); return }
    setUploading(true)
    setShowAttachMenu(false)
    const safeName = crypto.randomUUID() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${currentSiteId}/${selectedId}/${safeName}`
    const { error: upErr } = await supabase.storage.from('connect-files').upload(path, file)
    if (upErr) { setUploading(false); showToast(upErr.message, 'red'); return }
    const { data: urlData } = supabase.storage.from('connect-files').getPublicUrl(path)
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: selectedId,
      sender_id: profile?.id || null,
      content: input.trim() || file.name,
      file_url: urlData?.publicUrl || null,
      file_name: file.name,
      file_type: file.type || null,
      reply_to: replyTo?.id || null,
    })
    setUploading(false)
    if (error) { showToast(error.message, 'red'); return }
    setInput(''); setReplyTo(null)
    loadMessages(selectedId)
    loadConversations()
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (imageInputRef.current) imageInputRef.current.value = ''
    if (docInputRef.current) docInputRef.current.value = ''
  }

  function selectConvo(id) {
    setMessages([])
    selectedIdRef.current = id
    setSelectedId(id)
    setEditingId(null); setReplyTo(null); setInput(''); setMsgSearch(''); setShowMembers(false)
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

  // ── Swipe to reply (touch events) ───────────────────────────────────────
  const touchStartRef = useRef(null)
  function handleTouchStart(e, m) {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, msg: m }
  }
  function handleTouchEnd(e) {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y)
    if (dx > 60 && dy < 40) {
      setReplyTo(touchStartRef.current.msg)
    }
    touchStartRef.current = null
  }

  if (!can('connect.view')) return <Denied />

  const showList = !isMobile || !mobileShowThread
  const showThread = !isMobile || mobileShowThread

  // Preview text for conversation list
  function lastMsgPreview(c) {
    const last = lastMessages[c.id]
    if (!last) return 'No messages yet'
    if (last.is_deleted) return 'Message deleted'
    const prefix = last.sender_id === profile?.id ? 'You: ' : ''
    if (last.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(last.file_name || '')) {
      return prefix + '📷 Photo'
    }
    if (last.file_name) return prefix + '📎 ' + last.file_name
    return prefix + (last.content || '')
  }

  return (
    <div style={{ height: floatingPanel ? '100%' : 'calc(100dvh - 96px)', minHeight: floatingPanel ? 0 : 480, display: 'flex', borderRadius: floatingPanel ? 0 : '14px', overflow: 'hidden', background: MR_CHAT_BG }}>
      {/* ── Left: conversation list ── */}
      {showList && (
        <div style={{
          width: isMobile ? '100%' : 340, flexShrink: 0,
          borderRight: isMobile ? 'none' : `1px solid ${THEME.outlineVar}`,
          display: 'flex', flexDirection: 'column', background: THEME.surface,
        }}>
          {/* Header bar — WhatsApp teal */}
          <div style={{ padding: '10px 14px', background: MR_HEADER_BG, color: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="chat" style={{ color: '#fff' }} />
                Connect
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {can('connect.create') && (
                  <button onClick={openNewChat} style={{
                    background: MR_PRIMARY, border: 'none', borderRadius: '50%', width: 36, height: 36,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff',
                    boxShadow: '0 2px 8px rgba(0,0,0,.25)',
                  }} title="New chat">
                    <Icon name="add" size={20} />
                  </button>
                )}
              </div>
            </div>
            <input
              style={{ ...inputStyle, padding: '8px 12px', fontSize: '13px', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: '20px' }}
              placeholder="Search conversations…"
              value={convoSearch}
              onChange={e => setConvoSearch(e.target.value)}
            />
          </div>
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: '6px', padding: '8px 14px', flexWrap: 'wrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>
            {[['all', 'All'], ['unread', 'Unread'], ['dm', 'DMs'], ['group', 'Groups'], ['department', 'Depts']].map(([k, label]) => (
              <button key={k} onClick={() => setConvoFilter(k)} style={{
                padding: '4px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                border: 'none',
                background: convoFilter === k ? MR_LIGHT : THEME.surfaceVar,
                color: convoFilter === k ? '#fff' : THEME.textMed,
                cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingConvos ? (
              <div style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>Loading…</div>
            ) : visibleConvos.length === 0 ? (
              <div style={{ padding: '48px 20px', textAlign: 'center', color: THEME.textLow }}>
                <Icon name="forum" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                <div style={{ fontSize: '13px', marginBottom: '12px' }}>Start a conversation</div>
                {can('connect.create') && (
                  <button onClick={openNewChat} style={{
                    background: MR_PRIMARY, border: 'none', borderRadius: '24px', padding: '8px 20px',
                    color: '#fff', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                  }}>
                    <Icon name="add" size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    New Chat
                  </button>
                )}
              </div>
            ) : visibleConvos.map(c => {
              const last = lastMessages[c.id]
              const unread = unreadCounts[c.id] || 0
              const active = c.id === selectedId
              return (
                <div key={c.id} onClick={() => selectConvo(c.id)} style={{
                  display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px',
                  cursor: 'pointer', background: active ? '#F0F2F5' : 'transparent',
                  borderBottom: `1px solid ${THEME.outlineVar}`,
                }}>
                  <Avatar name={convoName(c)} size={48} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                      <div style={{ fontSize: '15px', fontWeight: unread ? 700 : 500, color: THEME.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {convoName(c)}
                      </div>
                      <div style={{ fontSize: '11px', color: unread ? MR_PRIMARY : MR_TIME, flexShrink: 0, fontWeight: unread ? 600 : 400 }}>{timeAgo(last?.created_at || c.created_at)}</div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '2px', alignItems: 'center' }}>
                      <div style={{
                        fontSize: '13px', color: unread ? THEME.text : MR_TIME, fontWeight: unread ? 500 : 400,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        display: 'flex', alignItems: 'center', gap: '2px',
                      }}>
                        {last?.sender_id === profile?.id && (
                          <ReadReceipt mine isRead={!unread} />
                        )}
                        {lastMsgPreview(c)}
                      </div>
                      {unread > 0 && (
                        <div style={{
                          background: MR_PRIMARY, color: '#fff', borderRadius: '50%', fontSize: '11px', fontWeight: 700,
                          minWidth: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0,
                        }}>{unread > 99 ? '99+' : unread}</div>
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
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: THEME.textLow, background: '#F0F2F5' }}>
              <div style={{ textAlign: 'center' }}>
                <Icon name="forum" size={44} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                <div style={{ fontSize: '14px', color: THEME.textMed }}>Select a conversation or start a new one</div>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div style={{ padding: '10px 16px', background: MR_HEADER_BG, color: '#fff', display: 'flex', alignItems: 'center', gap: '10px' }}>
                {isMobile && (
                  <button onClick={() => setMobileShowThread(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff' }}>
                    <Icon name="arrow_back" />
                  </button>
                )}
                <Avatar name={convoName(selectedConvo)} size={38} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff' }}>{convoName(selectedConvo)}</div>
                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,.7)' }}>
                    {selectedConvo.type === 'dm' ? 'Direct message' : `${selectedConvo.type} conversation`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {!floatingPanel && (
                    <input
                      style={{ ...inputStyle, width: 140, padding: '6px 10px', fontSize: '12px', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', borderRadius: '16px' }}
                      placeholder="Search…"
                      value={msgSearch}
                      onChange={e => setMsgSearch(e.target.value)}
                    />
                  )}
                  {selectedConvo && selectedConvo.type !== 'dm' && (
                    <button onClick={() => { setShowMembers(v => !v); if (!showMembers) loadMembers(selectedConvo.id) }} style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: '#fff', padding: '4px',
                    }}>
                      <Icon name="group" size={20} />
                    </button>
                  )}
                </div>
              </div>

              {/* Members panel */}
              {showMembers && selectedConvo && selectedConvo.type !== 'dm' && (
                <div style={{
                  borderBottom: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
                  padding: '10px 16px', maxHeight: '180px', overflowY: 'auto',
                }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textLow, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {loadingMembers ? 'Loading…' : `${members.length} member${members.length !== 1 ? 's' : ''}`}
                  </div>
                  {members.map(m => (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0' }}>
                      <Avatar name={m.name} size={26} />
                      <span style={{ fontSize: '13px', color: THEME.text, fontWeight: m.id === profile?.id ? 700 : 500 }}>
                        {m.name}{m.id === profile?.id ? ' (you)' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pinned messages */}
              {messages.some(m => m.is_pinned) && (
                <div style={{ padding: '8px 16px', background: THEME.surface, borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '11px', color: THEME.textMed, display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <Icon name="push_pin" size={14} style={{ color: ACCENT }} />
                  {messages.filter(m => m.is_pinned).slice(0, 3).map(m => (
                    <span key={m.id} style={{ background: THEME.surfaceVar, borderRadius: '8px', padding: '2px 8px', border: `1px solid ${THEME.outlineVar}` }}>
                      {(m.content || '').slice(0, 40)}
                    </span>
                  ))}
                </div>
              )}

              {/* Messages area — WhatsApp-style chat wallpaper */}
              <div style={{
                flex: 1, overflowY: 'auto', padding: '14px 60px', display: 'flex', flexDirection: 'column', gap: '2px',
                background: `${MR_CHAT_BG} url("data:image/svg+xml,%3Csvg width='400' height='400' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='p' width='60' height='60' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='30' cy='30' r='1.5' fill='%23c8c3ba' opacity='.3'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='400' height='400' fill='url(%23p)'/%3E%3C/svg%3E")`,
              }}>
                {loadingMessages ? (
                  <div style={{ textAlign: 'center', color: THEME.textLow, padding: '32px' }}>Loading…</div>
                ) : filteredMessages.length === 0 ? (
                  <div style={{ textAlign: 'center', color: THEME.textLow, padding: '48px 20px' }}>
                    <Icon name="waving_hand" size={36} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                    No messages yet — say hello!
                  </div>
                ) : groupedMessages.map(group => (
                  <div key={group.day}>
                    {/* Date divider */}
                    <div style={{ textAlign: 'center', margin: '12px 0 8px' }}>
                      <span style={{
                        fontSize: '12px', fontWeight: 500, color: THEME.text, background: '#F2D5DC',
                        padding: '5px 14px', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,.08)',
                      }}>
                        {group.label}
                      </span>
                    </div>
                    {group.items.map((m, idx) => {
                      const mine = m.sender_id === profile?.id
                      const reactions = reactionSummary(m)
                      const replied = m.reply_to ? messageById.get(m.reply_to) || null : null
                      const showSenderName = !mine && selectedConvo?.type !== 'dm'
                      const prevMsg = idx > 0 ? group.items[idx - 1] : null
                      const sameSender = prevMsg && prevMsg.sender_id === m.sender_id
                      const isLastRead = mine && idx === group.items.length - 1
                      return (
                        <div
                          key={m.id}
                          onTouchStart={e => handleTouchStart(e, m)}
                          onTouchEnd={handleTouchEnd}
                          style={{
                            display: 'flex', gap: '0', marginBottom: sameSender ? '2px' : '8px',
                            flexDirection: mine ? 'row-reverse' : 'row',
                            paddingLeft: mine ? '48px' : 0,
                            paddingRight: mine ? 0 : '48px',
                          }}
                        >
                          <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                            {showSenderName && !sameSender && (
                              <div style={{ fontSize: '12px', fontWeight: 600, color: avatarColor(m.sender?.full_name), marginBottom: '1px', marginLeft: '8px' }}>
                                {m.sender?.full_name || 'Unknown'}
                              </div>
                            )}
                            {replied && (
                              <div style={{
                                fontSize: '12px', color: THEME.textMed, borderLeft: `3px solid ${MR_LIGHT}`, paddingLeft: '8px',
                                marginBottom: '2px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                background: mine ? '#f0d0d8' : '#f0f0f0', borderRadius: '6px', padding: '4px 8px 4px 10px',
                              }}>
                                {replied.is_deleted ? 'Message deleted' : replied.content}
                              </div>
                            )}
                            <div style={{
                              padding: '6px 8px 4px 10px', position: 'relative',
                              borderRadius: mine
                                ? (sameSender ? '8px' : '8px 0 8px 8px')
                                : (sameSender ? '8px' : '0 8px 8px 8px'),
                              background: mine ? MR_SENT_BG : MR_RECV_BG,
                              color: '#303030',
                              fontSize: '14px', lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                              boxShadow: '0 1px 1px rgba(0,0,0,.06)',
                              minWidth: '80px',
                            }}>
                              {m.is_pinned && <Icon name="push_pin" size={12} style={{ position: 'absolute', top: -6, right: mine ? 'auto' : -6, left: mine ? -6 : 'auto', color: ACCENT }} />}
                              <RenderContent text={m.content} navigate={navigate} />
                              {m.file_url && (
                                <div style={{ marginTop: '4px' }}>
                                  {(m.file_type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(m.file_name || '')) ? (
                                    <a href={m.file_url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                      <img src={m.file_url} alt={m.file_name || 'Image'} style={{ maxWidth: '260px', maxHeight: '300px', borderRadius: '6px', objectFit: 'cover', display: 'block', cursor: 'pointer' }} />
                                    </a>
                                  ) : (
                                    <a href={m.file_url} target="_blank" rel="noreferrer" style={{
                                      color: MR_LIGHT, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px',
                                      textDecoration: 'none', background: mine ? '#e8bfc7' : '#f5f5f5', padding: '8px 10px', borderRadius: '6px',
                                    }}>
                                      <Icon name="description" size={20} style={{ color: MR_LIGHT }} />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#303030', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.file_name || 'Document'}</div>
                                        <div style={{ fontSize: '11px', color: MR_TIME }}>PDF · Download</div>
                                      </div>
                                      <Icon name="download" size={18} style={{ color: MR_TIME }} />
                                    </a>
                                  )}
                                </div>
                              )}
                              {/* Timestamp + ticks row inside bubble */}
                              <div style={{
                                display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '2px',
                                marginTop: '2px',
                              }}>
                                {m.is_edited && <span style={{ fontSize: '10px', color: MR_TIME, marginRight: '2px' }}>edited</span>}
                                <span style={{ fontSize: '11px', color: MR_TIME }}>{formatTime(m.created_at)}</span>
                                {mine && <ReadReceipt mine isRead />}
                              </div>
                            </div>

                            {/* Reactions bar */}
                            {Object.keys(reactions).length > 0 && (
                              <div style={{ display: 'flex', gap: '4px', marginTop: '2px', flexWrap: 'wrap' }}>
                                {Object.entries(reactions).map(([emoji, info]) => (
                                  <button key={emoji} onClick={() => toggleReaction(m, emoji)} style={{
                                    fontSize: '12px', padding: '1px 6px', borderRadius: '999px', cursor: 'pointer',
                                    border: `1px solid ${info.mine ? MR_LIGHT : THEME.outline}`,
                                    background: info.mine ? `${MR_LIGHT}22` : '#fff',
                                  }}>
                                    {emoji} {info.count}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Row actions — compact, appears below bubble */}
                            <div style={{ display: 'flex', gap: '6px', marginTop: '1px', fontSize: '10px', color: MR_TIME, alignItems: 'center', opacity: 0.8 }}>
                              <div style={{ display: 'flex', gap: '1px' }}>
                                {REACTIONS.slice(0, 3).map(emo => (
                                  <button key={emo} onClick={() => toggleReaction(m, emo)} title="React" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', padding: '1px 2px' }}>{emo}</button>
                                ))}
                              </div>
                              <button onClick={() => setReplyTo(m)} title="Reply" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MR_TIME, padding: 0 }}>
                                <Icon name="reply" size={14} />
                              </button>
                              {can('connect.edit') && (
                                <button onClick={() => togglePin(m)} title="Pin" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MR_TIME, padding: 0 }}>
                                  <Icon name="push_pin" size={14} />
                                </button>
                              )}
                              {mine && (
                                <>
                                  <button onClick={() => startEdit(m)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MR_TIME, padding: 0 }}>
                                    <Icon name="edit" size={14} />
                                  </button>
                                  <button onClick={() => deleteMessage(m)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: MR_TIME, padding: 0 }}>
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
                <div style={{ padding: '8px 16px', background: THEME.surface, borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: THEME.textMed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <div style={{ width: 3, height: 28, background: MR_LIGHT, borderRadius: 2, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: MR_LIGHT }}>{editingId ? 'Edit message' : 'Reply'}</div>
                      <div style={{ fontSize: '12px', color: THEME.textLow }}>{editingId ? '' : replyTo?.content?.slice(0, 60)}</div>
                    </div>
                  </div>
                  <button onClick={() => { setReplyTo(null); setEditingId(null); setInput('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow }}>
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}

              {/* Input area — WhatsApp style */}
              <div style={{ padding: '6px 10px', background: '#F0F0F0', position: 'relative' }}>
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
                {slashOpen && (slashMatches.length > 0 || slashEntityResults.length > 0) && (
                  <div style={{ position: 'absolute', bottom: '100%', left: 14, marginBottom: 4, background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', boxShadow: THEME.shadow2, zIndex: 20, width: 300, maxHeight: 280, overflowY: 'auto' }}>
                    {slashMatches.length > 0 && (
                      <>
                        <div style={{ padding: '6px 12px 2px', fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.06em' }}>Screens</div>
                        {slashMatches.map(t => (
                          <div key={t.code} onClick={() => insertTxnCode(t)} style={{ padding: '7px 12px', cursor: 'pointer', fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}
                            onMouseDown={e => e.preventDefault()}>
                            <span style={{ fontWeight: 700, color: MODULE_COLORS[t.module] || ACCENT }}>{t.code}</span>
                            <span style={{ color: THEME.textMed, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {slashEntityResults.length > 0 && (
                      <>
                        <div style={{ padding: '6px 12px 2px', fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.06em', borderTop: slashMatches.length ? `1px solid ${THEME.outlineVar}` : 'none', marginTop: slashMatches.length ? 4 : 0 }}>Records</div>
                        {slashEntityResults.map((r, i) => {
                          const cat = SEARCH_CATEGORIES.find(c => c.type === r.type) || {}
                          return (
                            <div key={r.type + '-' + i} onClick={() => { navigate(r.path); setSlashOpen(false) }} style={{ padding: '7px 12px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}
                              onMouseDown={e => e.preventDefault()}>
                              <Icon name={r.icon || cat.icon || 'search'} size={14} style={{ color: r.color || cat.color || THEME.textLow }} />
                              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: THEME.text }}>{r.label}</span>
                              <span style={{ fontSize: '10px', color: r.color || cat.color || THEME.textLow, fontWeight: 600 }}>{cat.label}</span>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}

                {/* Emoji picker popup */}
                {showEmojiPicker && (
                  <div ref={emojiRef} style={{
                    position: 'absolute', bottom: '100%', left: 10, marginBottom: 6,
                    background: '#fff', borderRadius: '12px', boxShadow: '0 4px 16px rgba(0,0,0,.15)',
                    padding: '10px', width: '260px', zIndex: 30,
                  }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px' }}>
                      {EMOJI_QUICK.map(e => (
                        <button key={e} onClick={() => insertEmoji(e)} style={{
                          background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', padding: '4px',
                          borderRadius: '6px', lineHeight: 1,
                        }}
                          onMouseOver={ev => ev.target.style.background = '#f0f0f0'}
                          onMouseOut={ev => ev.target.style.background = 'none'}
                        >{e}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Attachment menu popup */}
                {showAttachMenu && (
                  <div ref={attachRef} style={{
                    position: 'absolute', bottom: '100%', left: 50, marginBottom: 6,
                    background: '#fff', borderRadius: '14px', boxShadow: '0 4px 20px rgba(0,0,0,.18)',
                    padding: '14px', zIndex: 30, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px',
                  }}>
                    {[
                      { icon: 'image', label: 'Photo', color: '#7C3AED', accept: 'image/*', ref: 'image' },
                      { icon: 'description', label: 'Document', color: '#5C6BC0', accept: 'application/pdf,text/*', ref: 'doc' },
                      { icon: 'attach_file', label: 'File', color: '#0D7377', accept: 'image/*,application/pdf,text/*', ref: 'file' },
                    ].map(item => (
                      <button key={item.ref} onClick={() => {
                        const inputEl = item.ref === 'image' ? imageInputRef.current : item.ref === 'doc' ? docInputRef.current : fileInputRef.current
                        if (inputEl) { inputEl.accept = item.accept; inputEl.click() }
                        setShowAttachMenu(false)
                      }} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', border: 'none',
                        background: 'none', cursor: 'pointer', padding: '8px',
                      }}>
                        <div style={{
                          width: 48, height: 48, borderRadius: '50%', background: item.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                        }}>
                          <Icon name={item.icon} size={22} />
                        </div>
                        <span style={{ fontSize: '12px', color: THEME.text, fontWeight: 500 }}>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                  {can('connect.create') && (
                    <>
                      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileUpload} />
                      <input ref={imageInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileUpload} />
                      <input ref={docInputRef} type="file" accept="application/pdf,text/*" style={{ display: 'none' }} onChange={handleFileUpload} />
                      {/* Emoji button */}
                      <button onClick={() => { setShowEmojiPicker(v => !v); setShowAttachMenu(false) }} title="Emoji" style={{
                        background: 'none', border: 'none', width: 38, height: 38,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: MR_TIME, flexShrink: 0,
                      }}>
                        <Icon name="emoji_emotions" size={24} />
                      </button>
                      {/* Attach button */}
                      <button onClick={() => { setShowAttachMenu(v => !v); setShowEmojiPicker(false) }} disabled={uploading} title="Attach" style={{
                        background: 'none', border: 'none', width: 38, height: 38,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: MR_TIME, flexShrink: 0,
                        transform: 'rotate(45deg)',
                      }}>
                        <Icon name={uploading ? 'hourglass_empty' : 'attach_file'} size={24} />
                      </button>
                    </>
                  )}
                  <textarea
                    ref={textareaRef}
                    style={{
                      ...inputStyle, minHeight: 40, maxHeight: 120, resize: 'none', flex: 1,
                      borderRadius: '20px', padding: '10px 16px', background: '#fff',
                    }}
                    placeholder={can('connect.create') ? 'Type a message' : 'You do not have permission to send messages'}
                    value={input}
                    disabled={!can('connect.create')}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    rows={1}
                  />
                  {can('connect.create') && (
                    <button onClick={sendMessage} disabled={sending || !input.trim()} style={{
                      background: MR_LIGHT, border: 'none', borderRadius: '50%', width: 42, height: 42,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: '#fff', flexShrink: 0,
                      opacity: (sending || !input.trim()) ? 0.5 : 1,
                    }}>
                      <Icon name={editingId ? 'check' : 'send'} size={20} />
                    </button>
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
                  border: `1px solid ${newChatType === k ? MR_LIGHT : THEME.outline}`,
                  background: newChatType === k ? `${MR_LIGHT}18` : 'transparent',
                  color: newChatType === k ? MR_LIGHT : THEME.textMed,
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
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input style={{ ...inputStyle, flex: 1 }} value={newChatUserSearch} onChange={e => setNewChatUserSearch(e.target.value)} placeholder="Search people…" />
              <select value={newChatDeptFilter} onChange={e => setNewChatDeptFilter(e.target.value)} style={{
                ...inputStyle, width: 'auto', minWidth: 120, padding: '8px 10px', fontSize: '12px',
                color: newChatDeptFilter ? THEME.text : THEME.textLow,
              }}>
                <option value="">All Depts</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px' }}>
              {filteredNewChatUsers.length === 0 ? (
                <div style={{ padding: '16px', textAlign: 'center', color: THEME.textLow, fontSize: '12px' }}>No users found</div>
              ) : filteredNewChatUsers.map(u => {
                const sel = newChatSelected.some(s => s.id === u.id)
                return (
                  <div key={u.id} onClick={() => toggleNewChatUser(u)} style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', cursor: 'pointer',
                    background: sel ? `${MR_LIGHT}14` : 'transparent', borderBottom: `1px solid ${THEME.outlineVar}`,
                  }}>
                    <Avatar name={u.full_name} size={26} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', color: THEME.text }}>{u.full_name}</div>
                      {u.department && <div style={{ fontSize: '11px', color: THEME.textLow }}>{u.department}</div>}
                    </div>
                    {sel && <Icon name="check_circle" size={18} style={{ color: MR_LIGHT }} />}
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
