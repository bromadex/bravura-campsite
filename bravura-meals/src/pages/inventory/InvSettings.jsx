import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, SectionLabel, PageHeader, showToast } from '../../components/ui'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.inventory

export default function InvSettings({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const rt = useRealtimeRefresh('module_settings', { column: 'site_id', value: currentSiteId })
  const [settings, setSettings] = useState({
    auto_code_prefix: 'ITM',
    next_code_seq: 1,
    low_stock_threshold: 10,
    reorder_point: 5,
    grn_prefix: 'GRN',
    grn_next_seq: 1,
    require_adjustment_approval: true,
    default_warehouse_id: '',
  })
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [settingsRes, whRes] = await Promise.all([
        supabase.from('module_settings')
          .select('*')
          .eq('site_id', currentSiteId)
          .eq('module', 'inventory')
          .maybeSingle(),
        supabase.from('warehouses')
          .select('id, name')
          .eq('site_id', currentSiteId)
          .order('name'),
      ])
      if (settingsRes.error) throw settingsRes.error
      if (settingsRes.data?.settings) setSettings(prev => ({ ...prev, ...settingsRes.data.settings }))
      if (!whRes.error) setWarehouses(whRes.data || [])
    } catch (err) {
      console.error('InvSettings:', err)
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch, rt])

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

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  if (loading) return <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_settings" />
      <PageHeader title="Inventory Settings" site={currentSite} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
        {/* Item Code Settings */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
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

        {/* Low Stock & Reorder */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="warning" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Stock Thresholds</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <SectionLabel>Low Stock Threshold (default)</SectionLabel>
              <input type="number" min="0" value={settings.low_stock_threshold} onChange={e => setSettings({ ...settings, low_stock_threshold: parseInt(e.target.value) || 0 })} style={inp} />
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>Default minimum quantity before a low-stock alert is triggered for new items.</div>
            </div>
            <div>
              <SectionLabel>Reorder Point (default)</SectionLabel>
              <input type="number" min="0" value={settings.reorder_point} onChange={e => setSettings({ ...settings, reorder_point: parseInt(e.target.value) || 0 })} style={inp} />
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>Default reorder point for newly created items.</div>
            </div>
          </div>
        </Card>

        {/* GRN Auto-numbering */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="receipt" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>GRN Auto-numbering</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <SectionLabel>GRN Prefix</SectionLabel>
              <input value={settings.grn_prefix || ''} onChange={e => setSettings({ ...settings, grn_prefix: e.target.value.toUpperCase() })} placeholder="GRN" style={inp} />
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>Vouchers will be numbered as {settings.grn_prefix || 'GRN'}-0001, etc.</div>
            </div>
            <div>
              <SectionLabel>Next GRN Sequence</SectionLabel>
              <input type="number" min="1" value={settings.grn_next_seq || 1} onChange={e => setSettings({ ...settings, grn_next_seq: parseInt(e.target.value) || 1 })} style={inp} />
            </div>
          </div>
        </Card>

        {/* Approval & Defaults */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="tune" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Defaults & Approval</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', color: THEME.text }}>
              <input type="checkbox" checked={settings.require_adjustment_approval} onChange={e => setSettings({ ...settings, require_adjustment_approval: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: ACCENT }} />
              Require Approval for Adjustments
            </label>
            <div>
              <SectionLabel>Default Warehouse</SectionLabel>
              <select value={settings.default_warehouse_id || ''} onChange={e => setSettings({ ...settings, default_warehouse_id: e.target.value })} style={inp}>
                <option value="">-- None --</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
        </Card>

        {/* Module Info */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
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
