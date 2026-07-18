import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, SectionLabel, PageHeader, showToast } from '../../components/ui'

const ACCENT = MODULE_COLORS.contractors

export default function CLSettings() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [settings, setSettings] = useState({
    daily_rate_default: 0,
    overtime_multiplier: 1.5,
    expiry_warning_days: 30,
    require_timesheet_approval: true,
    auto_generate_contract_numbers: true,
    contract_number_prefix: 'CON',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data, error } = await supabase.from('module_settings')
        .select('*')
        .eq('site_id', currentSiteId)
        .eq('module', 'contractors')
        .maybeSingle()
      if (error) throw error
      if (data?.settings) setSettings(prev => ({ ...prev, ...data.settings }))
    } catch (err) {
      console.error('CLSettings:', err)
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
          module: 'contractors',
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

  if (!can('contractors.edit')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div></Card>
  }

  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  if (loading) return <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>

  return (
    <div>
      <PageHeader title="Contractor Settings" site={currentSite} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
        {/* Rate Defaults */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="payments" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Rate Defaults</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <SectionLabel>Default Daily Rate (casual workers)</SectionLabel>
              <input type="number" min="0" step="0.01" value={settings.daily_rate_default} onChange={e => setSettings({ ...settings, daily_rate_default: parseFloat(e.target.value) || 0 })} style={inp} />
            </div>
            <div>
              <SectionLabel>Overtime Rate Multiplier</SectionLabel>
              <input type="number" min="1" step="0.1" value={settings.overtime_multiplier} onChange={e => setSettings({ ...settings, overtime_multiplier: parseFloat(e.target.value) || 1 })} style={inp} />
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>E.g. 1.5 means overtime hours are paid at 1.5x the daily rate.</div>
            </div>
          </div>
        </Card>

        {/* Contract Settings */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="description" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Contract Settings</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <SectionLabel>Contract Expiry Warning (days)</SectionLabel>
              <input type="number" min="1" value={settings.expiry_warning_days} onChange={e => setSettings({ ...settings, expiry_warning_days: parseInt(e.target.value) || 30 })} style={inp} />
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>Show warning this many days before contract expiry.</div>
            </div>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', color: THEME.text }}>
                <input type="checkbox" checked={settings.auto_generate_contract_numbers} onChange={e => setSettings({ ...settings, auto_generate_contract_numbers: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: ACCENT }} />
                Auto-generate Contract Numbers
              </label>
            </div>
            {settings.auto_generate_contract_numbers && (
              <div>
                <SectionLabel>Contract Number Prefix</SectionLabel>
                <input value={settings.contract_number_prefix} onChange={e => setSettings({ ...settings, contract_number_prefix: e.target.value.toUpperCase() })} placeholder="CON" style={inp} />
                <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>Contracts will be numbered as {settings.contract_number_prefix || 'CON'}-0001, etc.</div>
              </div>
            )}
          </div>
        </Card>

        {/* Approval Settings */}
        <Card style={{ padding: '24px', borderRadius: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="approval" size={20} style={{ color: ACCENT }} />
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text }}>Approval Settings</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', color: THEME.text }}>
            <input type="checkbox" checked={settings.require_timesheet_approval} onChange={e => setSettings({ ...settings, require_timesheet_approval: e.target.checked })} style={{ width: '16px', height: '16px', accentColor: ACCENT }} />
            Require Approval for Timesheets
          </label>
          <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '8px' }}>When enabled, timesheets must be approved before they count towards billing.</div>
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
            <div><strong>Module:</strong> Contract & Contractor Management</div>
            <div><strong>Phase:</strong> 2 (Timesheets, Hired Vehicles/Equipment)</div>
            <div><strong>Tables:</strong> contractors, contractor_contracts, contractor_employees, casual_workers, casual_timesheets, hired_vehicles, hired_equipment</div>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: '20px' }}>
        <Button variant="filled" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
      </div>
    </div>
  )
}
