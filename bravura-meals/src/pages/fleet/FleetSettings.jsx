import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.fleet

const DEFAULTS = {
  pm_reminder_days: 14,
  inspection_frequency: 'daily',
  odometer_regression_pct: 5.0,
  hours_regression_pct: 5.0,
  fuel_variance_pct: 15.0,
  min_tread_depth_mm: 3.0,
  auto_ground_on_fail: true,
  auto_create_wo_on_fail: true,
}

export default function FleetSettings({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('fleet_settings', { column: 'site_id', value: currentSiteId })
  const [form, setForm] = useState({ ...DEFAULTS })
  const [existingId, setExistingId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    if (!currentSiteId) return
    setLoading(true)
    supabase.from('fleet_settings').select('*').eq('site_id', currentSiteId).maybeSingle()
      .then(({ data, error }) => {
        if (data) {
          setForm({
            pm_reminder_days: data.pm_reminder_days ?? DEFAULTS.pm_reminder_days,
            inspection_frequency: data.inspection_frequency ?? DEFAULTS.inspection_frequency,
            odometer_regression_pct: data.odometer_regression_pct ?? DEFAULTS.odometer_regression_pct,
            hours_regression_pct: data.hours_regression_pct ?? DEFAULTS.hours_regression_pct,
            fuel_variance_pct: data.fuel_variance_pct ?? DEFAULTS.fuel_variance_pct,
            min_tread_depth_mm: data.min_tread_depth_mm ?? DEFAULTS.min_tread_depth_mm,
            auto_ground_on_fail: data.auto_ground_on_fail ?? DEFAULTS.auto_ground_on_fail,
            auto_create_wo_on_fail: data.auto_create_wo_on_fail ?? DEFAULTS.auto_create_wo_on_fail,
          })
          setExistingId(data.id)
        }
        setLoading(false)
      })
  }, [currentSiteId, rt])

  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const handleSave = async () => {
    setSaving(true)
    const payload = { site_id: currentSiteId, ...form, updated_at: new Date().toISOString() }
    if (existingId) payload.id = existingId
    const { data, error } = await supabase.from('fleet_settings').upsert(payload, { onConflict: 'site_id' }).select().single()
    if (error) {
      showToast('Error saving settings')
    } else {
      if (data) setExistingId(data.id)
      showToast('Settings saved successfully')
    }
    setSaving(false)
  }

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }
  const hint = { fontSize: '11px', color: THEME.textLow, marginTop: '2px' }
  const sectionHeader = {
    fontSize: '14px', fontWeight: 700, color: THEME.text, marginBottom: '12px', marginTop: '24px',
    display: 'flex', alignItems: 'center', gap: '6px',
  }

  if (!can('fleet.edit')) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <FleetQuickNav setPage={setPage} current="fleet_settings" />
        <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>lock</span>
        <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You don't have permission to view fleet settings.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '0' }}>
      <FleetQuickNav setPage={setPage} current="fleet_settings" />

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', top: '16px', left: '50%', transform: 'translateX(-50%)',
          background: toast.includes('Error') ? THEME.statusErrorBg : '#16a34a',
          color: toast.includes('Error') ? THEME.statusErrorText : '#fff',
          padding: '10px 24px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
          zIndex: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          animation: 'fadeIn 0.2s ease',
        }}>
          {toast}
        </div>
      )}

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '8px 16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '28px', color }}>settings</span>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: THEME.text }}>Fleet Settings</h2>
        </div>
        <p style={{ fontSize: '13px', color: THEME.textMed, marginTop: '0', marginBottom: '16px' }}>
          Configure thresholds, automation and maintenance parameters for this site.
        </p>

        {loading ? (
          <p style={{ color: THEME.textLow, fontSize: '13px' }}>Loading settings...</p>
        ) : (
          <>
            {/* Preventive Maintenance */}
            <div style={sectionHeader}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px', color }}>build</span>
              Preventive Maintenance
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>PM Reminder Days</label>
              <input style={inp} type="number" min="1" value={form.pm_reminder_days}
                onChange={e => set('pm_reminder_days', parseInt(e.target.value) || 0)} />
              <div style={hint}>Days before PM is due to trigger reminder</div>
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Inspection Frequency</label>
              <select style={inp} value={form.inspection_frequency}
                onChange={e => set('inspection_frequency', e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            {/* Threshold Settings */}
            <div style={sectionHeader}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px', color }}>tune</span>
              Threshold Settings
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Odometer Regression %</label>
              <input style={inp} type="number" min="0" step="0.1" value={form.odometer_regression_pct}
                onChange={e => set('odometer_regression_pct', parseFloat(e.target.value) || 0)} />
              <div style={hint}>Flag readings that decrease by more than this %</div>
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Hours Regression %</label>
              <input style={inp} type="number" min="0" step="0.1" value={form.hours_regression_pct}
                onChange={e => set('hours_regression_pct', parseFloat(e.target.value) || 0)} />
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Fuel Variance %</label>
              <input style={inp} type="number" min="0" step="0.1" value={form.fuel_variance_pct}
                onChange={e => set('fuel_variance_pct', parseFloat(e.target.value) || 0)} />
              <div style={hint}>Flag consumption exceeding expected by this %</div>
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Min Tread Depth (mm)</label>
              <input style={inp} type="number" min="0" step="0.1" value={form.min_tread_depth_mm}
                onChange={e => set('min_tread_depth_mm', parseFloat(e.target.value) || 0)} />
              <div style={hint}>Minimum tyre tread depth before alert</div>
            </div>

            {/* Automation */}
            <div style={sectionHeader}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px', color }}>smart_toy</span>
              Automation
            </div>
            <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={form.auto_ground_on_fail}
                onChange={e => set('auto_ground_on_fail', e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: color }} />
              <label style={{ fontSize: '13px', color: THEME.text, cursor: 'pointer' }}
                onClick={() => set('auto_ground_on_fail', !form.auto_ground_on_fail)}>
                Auto-ground vehicle on inspection fail
              </label>
            </div>
            <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <input type="checkbox" checked={form.auto_create_wo_on_fail}
                onChange={e => set('auto_create_wo_on_fail', e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: color }} />
              <label style={{ fontSize: '13px', color: THEME.text, cursor: 'pointer' }}
                onClick={() => set('auto_create_wo_on_fail', !form.auto_create_wo_on_fail)}>
                Auto-create work order on inspection fail
              </label>
            </div>

            {/* Save */}
            <button onClick={handleSave} disabled={saving} style={{
              marginTop: '24px', padding: '10px 32px', borderRadius: '8px', border: 'none',
              background: color, color: '#fff', fontSize: '14px', fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
              fontFamily: 'inherit',
            }}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
