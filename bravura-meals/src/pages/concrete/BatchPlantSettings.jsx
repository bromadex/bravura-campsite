import { useState, useEffect, useCallback } from 'react'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'

const color = '#546E7A'

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

const GROUPS = [
  {
    key: 'plant_info',
    title: 'Plant Info',
    icon: 'factory',
    settings: [
      { key: 'plant_name', label: 'Plant Name', type: 'text', default: '' },
      { key: 'plant_capacity_m3_per_hour', label: 'Plant Capacity (m³/hour)', type: 'number', default: '' },
      { key: 'number_of_silos', label: 'Number of Silos', type: 'number', default: '' },
      { key: 'number_of_stockpiles', label: 'Number of Stockpiles', type: 'number', default: '' },
    ],
  },
  {
    key: 'batch_defaults',
    title: 'Batch Defaults',
    icon: 'settings',
    settings: [
      { key: 'default_batch_number_prefix', label: 'Batch Number Prefix', type: 'text', default: 'B' },
      { key: 'auto_calculate_aggregates', label: 'Auto-Calculate Aggregates', type: 'toggle', default: 'true' },
      { key: 'require_dispatch_truck', label: 'Require Dispatch Truck', type: 'toggle', default: 'true' },
    ],
  },
  {
    key: 'quality_control',
    title: 'Quality Control',
    icon: 'verified',
    settings: [
      { key: 'cube_test_target_7day_pct', label: '7-Day Target (% of 28-day)', type: 'number', default: '65' },
      { key: 'cube_test_samples_per_batch', label: 'Samples per Batch', type: 'number', default: '3' },
      { key: 'auto_fail_threshold_pct', label: 'Auto-Fail Threshold (%)', type: 'number', default: '' },
    ],
  },
  {
    key: 'tolerances',
    title: 'Tolerances',
    icon: 'tune',
    settings: [
      { key: 'cement_tolerance_pct', label: 'Cement Tolerance (%)', type: 'number', default: '5' },
      { key: 'water_tolerance_pct', label: 'Water Tolerance (%)', type: 'number', default: '3' },
      { key: 'aggregate_tolerance_pct', label: 'Aggregate Tolerance (%)', type: 'number', default: '5' },
    ],
  },
]

export default function BatchPlantSettings({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [dbValues, setDbValues] = useState({})
  const [formValues, setFormValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState(null)

  const fetchSettings = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('batch_plant_settings')
      .select('id, setting_key, setting_value')
      .eq('site_id', currentSiteId)
    if (error) {
      showToast(error.message, 'red')
    } else {
      const map = {}
      ;(data || []).forEach(r => { map[r.setting_key] = r.setting_value })
      setDbValues(map)
      const form = {}
      GROUPS.forEach(g => g.settings.forEach(s => {
        form[s.key] = map[s.key] !== undefined ? map[s.key] : s.default
      }))
      setFormValues(form)
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  function setVal(key, value) {
    setFormValues(prev => ({ ...prev, [key]: value }))
  }

  function groupDirty(group) {
    return group.settings.some(s => {
      const db = dbValues[s.key] !== undefined ? dbValues[s.key] : s.default
      return formValues[s.key] !== db
    })
  }

  async function saveGroup(group) {
    if (!can('concrete.edit')) return
    setSavingGroup(group.key)
    try {
      for (const s of group.settings) {
        const value = formValues[s.key] ?? s.default
        const { error } = await supabase
          .from('batch_plant_settings')
          .upsert({
            site_id: currentSiteId,
            setting_key: s.key,
            setting_value: String(value),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'site_id,setting_key' })
        if (error) throw error
      }
      showToast(`${group.title} saved`, 'green')
      await fetchSettings()
    } catch (err) {
      showToast(err.message || 'Save failed', 'red')
    } finally {
      setSavingGroup(null)
    }
  }

  if (!can('concrete.view')) {
    return (
      <div style={{ padding: '0' }}>
        <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_settings" />
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>lock</span>
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            You do not have permission to view batch plant settings.
          </p>
        </div>
      </div>
    )
  }

  const canEdit = can('concrete.edit')

  return (
    <div style={{ padding: '0' }}>
      <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_settings" />

      <div style={{ padding: '8px 16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '28px', color }}>precision_manufacturing</span>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: THEME.text }}>Batch Plant Settings</h2>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '36px', color: THEME.textLow, animation: 'spin 1s linear infinite' }}>progress_activity</span>
            <p style={{ color: THEME.textLow, fontSize: '13px', marginTop: '8px' }}>Loading settings...</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }}>
            {GROUPS.map(group => {
              const isSaving = savingGroup === group.key
              const dirty = groupDirty(group)
              return (
                <div key={group.key} style={{
                  background: THEME.cardBg, border: '1px solid ' + THEME.border,
                  borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '22px', color }}>{group.icon}</span>
                    <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: THEME.text }}>{group.title}</h3>
                  </div>

                  <div style={{ flex: 1 }}>
                    {group.settings.map(s => (
                      <div key={s.key} style={fieldWrap}>
                        <label style={lbl}>{s.label}</label>
                        {s.type === 'toggle' ? (
                          <button
                            disabled={!canEdit}
                            onClick={() => setVal(s.key, formValues[s.key] === 'true' ? 'false' : 'true')}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '10px',
                              background: 'none', border: 'none', cursor: canEdit ? 'pointer' : 'default',
                              padding: '4px 0', fontFamily: 'inherit',
                            }}
                          >
                            <div style={{
                              width: '40px', height: '22px', borderRadius: '11px',
                              background: formValues[s.key] === 'true' ? color : THEME.outlineVar,
                              position: 'relative', transition: 'background 0.2s',
                            }}>
                              <div style={{
                                width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                                position: 'absolute', top: '3px',
                                left: formValues[s.key] === 'true' ? '21px' : '3px',
                                transition: 'left 0.2s',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                              }} />
                            </div>
                            <span style={{ fontSize: '13px', color: THEME.textMed }}>
                              {formValues[s.key] === 'true' ? 'Yes' : 'No'}
                            </span>
                          </button>
                        ) : (
                          <input
                            style={{ ...inp, opacity: canEdit ? 1 : 0.7 }}
                            type={s.type}
                            value={formValues[s.key] ?? ''}
                            onChange={e => setVal(s.key, e.target.value)}
                            readOnly={!canEdit}
                            min={s.type === 'number' ? '0' : undefined}
                            step={s.type === 'number' ? 'any' : undefined}
                          />
                        )}
                      </div>
                    ))}
                  </div>

                  {canEdit && (
                    <button
                      onClick={() => saveGroup(group)}
                      disabled={isSaving || !dirty}
                      style={{
                        marginTop: '8px', padding: '8px 20px', borderRadius: '8px',
                        fontSize: '13px', fontWeight: 600, cursor: (isSaving || !dirty) ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', border: 'none',
                        background: dirty ? color : THEME.outlineVar,
                        color: dirty ? '#fff' : THEME.textLow,
                        opacity: isSaving ? 0.6 : 1,
                        alignSelf: 'flex-end',
                        transition: 'background 0.2s, color 0.2s',
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
