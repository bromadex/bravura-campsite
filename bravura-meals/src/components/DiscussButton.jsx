import { useState } from 'react'
import { supabase } from '../supabaseClient'
import { THEME } from '../utils/permissions'
import { usePermissions } from '../contexts/PermissionsContext'
import { useAuth } from '../auth/AuthContext'

export default function DiscussButton({ linkedTable, linkedId, label, setPage }) {
  const { can } = usePermissions()
  const { profile } = useAuth()
  const [loading, setLoading] = useState(false)

  if (!can('connect.view') || !setPage) return null

  async function handleClick() {
    if (!linkedTable || !linkedId || !profile?.id) return
    setLoading(true)
    try {
      // Look for existing conversation linked to this record
      const { data: existing } = await supabase
        .from('chat_conversations')
        .select('id')
        .eq('linked_table', linkedTable)
        .eq('linked_id', linkedId)
        .limit(1)
        .maybeSingle()

      let conversationId = existing?.id

      if (!conversationId) {
        // Create a new group conversation linked to this record
        const title = label || `${linkedTable.replace(/_/g, ' ')} discussion`
        const { data: conv } = await supabase
          .from('chat_conversations')
          .insert({
            type: 'group',
            name: title,
            linked_table: linkedTable,
            linked_id: linkedId,
            created_by: profile.id,
          })
          .select('id')
          .single()

        if (conv) {
          conversationId = conv.id
          // Add creator as participant
          await supabase.from('chat_participants').insert({
            conversation_id: conversationId,
            user_id: profile.id,
          })
        }
      }

      // Navigate to Connect page — the page will pick up conversation from URL state
      if (conversationId) {
        setPage('connect_chat:' + conversationId)
      } else {
        setPage('connect_chat')
      }
    } catch (err) {
      console.error('DiscussButton error:', err)
      setPage('connect_chat')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '5px 12px', borderRadius: 6, border: `1px solid ${THEME.outline}`,
        background: THEME.surface, cursor: loading ? 'wait' : 'pointer',
        fontSize: 11, fontWeight: 600, color: THEME.primary, fontFamily: 'inherit',
        opacity: loading ? 0.6 : 1,
      }}
    >
      <span className="material-symbols-rounded" style={{ fontSize: 15 }}>chat</span>
      {loading ? 'Opening...' : 'Discuss'}
    </button>
  )
}
