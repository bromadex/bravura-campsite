import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, Modal, Icon, showToast, PageHeader } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const MODULE_COLOR = '#5C6BC0'

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

export default function SystemSettings({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [tick, setTick] = useState(0)
  useRealtimeSubscription('module_settings', { column: 'site_id', value: currentSiteId }, () => setTick(t => t + 1))
  const canView = can('users.view')
  const canEdit = can('users.edit')

  const [settings, setSettings] = useState([])
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)

  const [filterModule, setFilterModule] = useState('')
  const [filterSite, setFilterSite] = useState('')

  const [form, setForm] = useState({ site_id: '', module: '', key: '', value: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [tick])

  async function fetchAll() {
    setLoading(true)
    const [sRes, stRes] = await Promise.all([
      supabase.from('module_settings').select('*, site:sites(id, name), updater:profiles!module_settings_updated_by_fkey(full_name)').order('module').order('key'),
      supabase.from('sites').select('id, name').eq('is_active', true).order('name'),
    ])
    setSettings(sRes.data || [])
    setSites(stRes.data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let list = settings
    if (filterModule) list = list.filter(s => s.module.toLowerCase().includes(filterModule.toLowerCase()))
    if (filterSite) list = list.filter(s => s.site_id === filterSite)
    return list
  }, [settings, filterModule, filterSite])

  const grouped = useMemo(() => {
    const map = {}
    filtered.forEach(s => {
      if (!map[s.module]) map[s.module] = []
      map[s.module].push(s)
    })
    return map
  }, [filtered])

  function formatValue(val) {
    if (val === null || val === undefined) return '—'
    if (typeof val === 'object') return JSON.stringify(val, null, 2)
    return String(val)
  }

  function openAdd() {
    setEditItem(null)
    setForm({ site_id: '', module: '', key: '', value: '' })
    setShowModal(true)
  }

  function openEdit(item) {
    setEditItem(item)
    setForm({
      site_id: item.site_id || '',
      module: item.module,
      key: item.key,
      value: typeof item.value === 'object' ? JSON.stringify(item.value, null, 2) : String(item.value ?? ''),
    })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.site_id || !form.module.trim() || !form.key.trim()) {
      showToast('Site, Module, and Key are required', 'red')
      return
    }
    let parsedValue
    try {
      parsedValue = JSON.parse(form.value)
    } catch {
      showToast('Invalid JSON in Value field. Wrap strings in quotes, e.g. "hello"', 'red')
      return
    }
    setSaving(true)
    try {
      const row = {
        site_id: form.site_id,
        module: form.module.trim(),
        key: form.key.trim(),
        value: parsedValue,
      }
      const { error } = await supabase.from('module_settings').upsert(row, { onConflict: 'site_id,module,key' })
      if (error) throw error
      showToast('Setting saved', 'green')
      setShowModal(false)
      fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  if (!canView) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_settings" />
      <PageHeader
        title={<>System Settings <span style={{ marginLeft: '6px', padding: '1px 9px', borderRadius: '6px', fontSize: '13px', fontWeight: 400, background: THEME.surfaceVar, color: THEME.textMed, verticalAlign: 'middle' }}>{settings.length}</span></>}
        action={canEdit && <Button onClick={openAdd} icon="add" style={{ background: MODULE_COLOR, color: '#fff' }}>Add Setting</Button>}
      />

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          style={{ ...inp, maxWidth: '220px' }}
          placeholder="Filter by module..."
          value={filterModule}
          onChange={e => setFilterModule(e.target.value)}
        />
        <select style={{ ...inp, maxWidth: '220px' }} value={filterSite} onChange={e => setFilterSite(e.target.value)}>
          <option value="">All Sites</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: MODULE_COLOR }} />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="settings" size={32} style={{ color: THEME.outlineVar, marginBottom: '8px' }} />
          <div style={{ fontSize: '13px' }}>No settings found</div>
        </Card>
      ) : (
        Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([mod, items]) => (
          <Card key={mod} style={{ marginBottom: '16px', padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: MODULE_COLOR, color: '#fff', fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="settings" size={18} />
              {mod}
              <span style={{ marginLeft: 'auto', fontSize: '11px', fontWeight: 400, opacity: 0.8 }}>{items.length} setting{items.length !== 1 ? 's' : ''}</span>
            </div>
            <div style={{ padding: '4px 0' }}>
              {items.map(item => (
                <div key={item.id} style={{
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
                  padding: '10px 16px', borderBottom: `1px solid ${THEME.outlineVar}`,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: THEME.text }}>{item.key}</div>
                    <pre style={{
                      margin: '4px 0 0', padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
                      background: THEME.surfaceVar, color: THEME.textMed, whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word', fontFamily: 'monospace', overflowX: 'auto',
                    }}>{formatValue(item.value)}</pre>
                    <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>
                      {item.site?.name || '—'} {item.updater?.full_name ? `· Updated by ${item.updater.full_name}` : ''} {item.updated_at ? `· ${new Date(item.updated_at).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  {canEdit && (
                    <Button onClick={() => openEdit(item)} variant="outlined" size="sm" icon="edit">Edit</Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      {/* Add/Edit Modal */}
      <Modal dirty={true}
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editItem ? 'Edit Setting' : 'Add Setting'}
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <Button onClick={() => setShowModal(false)} variant="text">Cancel</Button>
            <Button onClick={handleSave} disabled={saving} style={{ background: MODULE_COLOR, color: '#fff' }}>
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        }
      >
        <div style={fieldWrap}>
          <label style={lbl}>Site *</label>
          <select style={inp} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })}>
            <option value="">Select a site...</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div style={fieldWrap}>
          <label style={lbl}>Module *</label>
          <input style={inp} value={form.module} onChange={e => setForm({ ...form, module: e.target.value })} placeholder="e.g. hr, meals, fuel" />
        </div>
        <div style={fieldWrap}>
          <label style={lbl}>Key *</label>
          <input style={inp} value={form.key} onChange={e => setForm({ ...form, key: e.target.value })} placeholder="e.g. employee_prefix" />
        </div>
        <div style={fieldWrap}>
          <label style={lbl}>Value (JSON) *</label>
          <textarea
            style={{ ...inp, minHeight: '80px', resize: 'vertical' }}
            value={form.value}
            onChange={e => setForm({ ...form, value: e.target.value })}
            placeholder={'"BRA" or {"enabled": true}'}
          />
          <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>
            Must be valid JSON. Wrap strings in quotes, e.g. "hello". Objects: {"{"}"key": "value"{"}"}.
          </div>
        </div>
      </Modal>
    </div>
  )
}
