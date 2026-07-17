import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, SectionLabel, PageHeader, showToast } from '../../components/ui'

const ACCENT = MODULE_COLORS.inventory

export default function InvSettings() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [settings, setSettings] = useState({ auto_code_prefix: 'ITM', next_code_seq: 1 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data, error } = await supabase.from('module_settings')
        .select('*')
        .eq('site_id', currentSiteId)
        .eq('module', 'inventory')
        .maybeSingle()
      if (error) throw error
      if (data?.settings) setSettings(data.settings)
    } catch (err) {
      console.error('InvSettings:', err)
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch])

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase.from('module_settings')
        .upsert({
          site_id: currentSiteId,
          module: 'inventory',
          settings,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'site_id,module' })
      if (error) throw error
      showToast('Settings saved', 'green')
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  if (!can('inventory.edit')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  if (loading) return <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>

  return (
    <div>
      <PageHeader title="Inventory Settings" site={currentSite} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
        <Card style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="tag" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Item Code Settings</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <SectionLabel>Code Prefix</SectionLabel>
              <input value={settings.auto_code_prefix || ''} onChange={e => setSettings({ ...settings, auto_code_prefix: e.target.value.toUpperCase() })} placeholder="ITM" style={inp} />
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>Items will be numbered as {settings.auto_code_prefix || 'ITM'}-0001, {settings.auto_code_prefix || 'ITM'}-0002, etc.</div>
            </div>
            <div>
              <SectionLabel>Next Sequence Number</SectionLabel>
              <input type="number" min="1" value={settings.next_code_seq || 1} onChange={e => setSettings({ ...settings, next_code_seq: parseInt(e.target.value) || 1 })} style={inp} />
            </div>
          </div>
        </Card>

        <Card style={{ padding: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="info" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Module Info</div>
          </div>
          <div style={{ fontSize: '13px', color: THEME.textMed, lineHeight: 1.6 }}>
            <div><strong>Valuation:</strong> Weighted Average Cost (AVCO)</div>
            <div><strong>Movement types:</strong> Opening, GRN, Issue, Return, Transfer, Adjustment, Stock Take</div>
            <div><strong>Items:</strong> Global catalogue (shared across all sites)</div>
            <div><strong>Stock:</strong> Site-scoped via warehouses</div>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: '20px' }}>
        <Button variant="filled" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
      </div>
    </div>
  )
}
