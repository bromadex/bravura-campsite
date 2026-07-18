import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Icon, PageHeader } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const MODULE_COLOR = '#5C6BC0'

const ACTION_COLORS = {
  View:    { bg: '#E3F2FD', text: '#1565C0' },
  Create:  { bg: '#E8F5E9', text: '#2E7D32' },
  Edit:    { bg: '#FFF8E1', text: '#F57F17' },
  Delete:  { bg: '#FFEBEE', text: '#C62828' },
  Approve: { bg: '#F3E5F5', text: '#6A1B9A' },
}

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function PermissionsCatalogue({ setPage }) {
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('permissions', null)
  const canView = can('users.view')

  const [permissions, setPermissions] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    async function fetch() {
      setLoading(true)
      const { data } = await supabase.from('permissions').select('*').order('code')
      setPermissions(data || [rt])
      setLoading(false)
    }
    fetch()
  }, [])

  const filtered = useMemo(() => {
    if (!search) return permissions
    const q = search.toLowerCase()
    return permissions.filter(p => p.code.toLowerCase().includes(q))
  }, [permissions, search])

  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(p => {
      const mod = p.code.split('.')[0] || p.module || 'unknown'
      if (!map[mod]) map[mod] = []
      map[mod].push(p)
    })
    return map
  }, [filtered])

  if (!canView) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div>
      <PageHeader title="Permissions Catalogue" />

      {/* KPI */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{
          background: THEME.surface, borderRadius: '14px', padding: '18px', flex: '0 0 auto',
          display: 'flex', alignItems: 'center', gap: '14px', border: `1px solid ${THEME.outlineVar}`,
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: MODULE_COLOR + '22',
          }}>
            <Icon name="shield" size={20} style={{ color: MODULE_COLOR }} />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{permissions.length}</div>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>Total Permissions</div>
          </div>
        </div>
        <div style={{
          background: THEME.surface, borderRadius: '14px', padding: '18px', flex: '0 0 auto',
          display: 'flex', alignItems: 'center', gap: '14px', border: `1px solid ${THEME.outlineVar}`,
        }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%', display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: MODULE_COLOR + '22',
          }}>
            <Icon name="category" size={20} style={{ color: MODULE_COLOR }} />
          </div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{Object.keys(grouped).length}</div>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>Modules</div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px', maxWidth: '320px' }}>
        <input
          style={inp}
          placeholder="Search permissions..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: MODULE_COLOR }} />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="shield" size={32} style={{ color: THEME.outlineVar, marginBottom: '8px' }} />
          <div style={{ fontSize: '13px' }}>No permissions found</div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([mod, perms]) => (
            <Card key={mod} style={{ padding: '0', overflow: 'hidden' }}>
              <div style={{
                padding: '12px 16px', background: MODULE_COLOR, color: '#fff',
                fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px',
                textTransform: 'capitalize',
              }}>
                <Icon name="folder" size={18} />
                {mod}
                <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 400, opacity: 0.8 }}>
                  {perms.length} permission{perms.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ padding: '8px 12px' }}>
                {perms.map(p => {
                  const ac = ACTION_COLORS[p.action] || { bg: THEME.surfaceVar, text: THEME.textMed }
                  return (
                    <div key={p.id || p.code} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 4px', borderBottom: `1px solid ${THEME.outlineVar}`,
                    }}>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_permissions" />
                      <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text, fontFamily: 'monospace' }}>
                        {p.code}
                      </span>
                      <span style={{
                        padding: '2px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                        background: ac.bg, color: ac.text,
                      }}>
                        {p.action}
                      </span>
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
