import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { THEME } from '../utils/permissions'
import { usePermissions } from '../contexts/PermissionsContext'
import { useAuth } from '../auth/AuthContext'
import { useSite } from '../contexts/SiteContext'

export default function DiscussButton({ linkedTable, linkedId, label, setPage }) {
  const { can } = usePermissions()
  const { profile } = useAuth()
  const { currentSiteId } = useSite()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  if (!can('connect.view')) return null

  async function handleClick() {
    if (!linkedTable || !linkedId || !profile?.id || !currentSiteId) return
    setLoading(true)
    try {
      // Find-or-create the record's thread and join it (server-side; RLS hides threads you're not in).
      const { data: conversationId, error } = await supabase.rpc('connect_open_record_thread', {
        p_site_id: currentSiteId, p_module: linkedTable, p_record_id: linkedId, p_label: label || null,
      })
      if (error) throw error

      // Navigate to Connect page — the page will pick up conversation from URL state
      if (conversationId) {
        navigate('/connect/connect_chat:' + conversationId)
      } else {
        navigate('/connect/connect_chat')
      }
    } catch (err) {
      console.error('DiscussButton error:', err)
      navigate('/connect/connect_chat')
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
