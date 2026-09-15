import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

const SEVERITY_OPTIONS = ['low', 'medium', 'high', 'critical']

const GENERAL_SETTINGS = [
  { key: 'company_name', label: 'Company Name', type: 'text', default: '' },
  { key: 'man_hours_monthly', label: 'Man-Hours Monthly (TRIR/LTIFR)', type: 'number', default: '' },
  { key: 'lti_start_date', label: 'LTI Start Date (Days Without LTI)', type: 'date', default: '' },
  { key: 'default_severity', label: 'Default Severity', type: 'select', options: SEVERITY_OPTIONS, default: 'medium' },
]

const NOTIFICATION_SETTINGS = [
  { key: 'capa_reminder_days', label: 'CAPA Reminder (days before due)', type: 'number', default: '7' },
  { key: 'escalation_days', label: 'Escalation (days overdue)', type: 'number', default: '14' },
  { key: 'incident_auto_notify', label: 'Auto-Notify on New Incident', type: 'toggle', default: 'true' },
]

// ── Toggle component ────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }) {
  const on = value === 'true' || value === true
  return (
    <button
      disabled={disabled}
      onClick={() => onChange(on ? 'false' : 'true')}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer',
        padding: '4px 0', fontFamily: 'inherit',
      }}
    >
      <div style={{
        width: '40px', height: '22px', borderRadius: '11px',
        background: on ? ACCENT : THEME.outlineVar,
        position: 'relative', transition: 'background 0.2s',
      }}>
        <div style={{
          width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
          position: 'absolute', top: '3px',
          left: on ? '21px' : '3px',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span style={{ fontSize: '13px', color: THEME.textMed }}>{on ? 'Yes' : 'No'}</span>
    </button>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function SheqSettings({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const canEdit = can('sheq.edit')

  // Settings state
  const [dbValues, setDbValues] = useState({})
  const [formValues, setFormValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState(null)

  // Categories state
  const [categories, setCategories] = useState([])
  const [newCat, setNewCat] = useState({ name: '', description: '', severity_default: 'medium' })
  const [editCatId, setEditCatId] = useState(null)
  const [editCatForm, setEditCatForm] = useState({})
  const [savingCat, setSavingCat] = useState(false)

  const fetchSettings = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('sheq_settings')
      .select('id, key, value')
      .eq('site_id', currentSiteId)
    if (error) {
      showToast(error.message, 'error')
    } else {
      const map = {}
      ;(data || []).forEach(r => { map[r.key] = r.value })
      setDbValues(map)
      const form = {}
      ;[...GENERAL_SETTINGS, ...NOTIFICATION_SETTINGS].forEach(s => {
        form[s.key] = map[s.key] !== undefined ? map[s.key] : s.default
      })
      setFormValues(form)
    }
    setLoading(false)
  }, [currentSiteId])

  const fetchCategories = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase
      .from('sheq_incident_categories')
      .select('*')
      .eq('site_id', currentSiteId)
      .order('name')
    if (error) showToast(error.message, 'error')
    else setCategories(data || [])
  }, [currentSiteId])

  useEffect(() => { fetchSettings(); fetchCategories() }, [fetchSettings, fetchCategories])

  function setVal(key, value) {
    setFormValues(prev => ({ ...prev, [key]: value }))
  }

  function groupDirty(settings) {
    return settings.some(s => {
      const db = dbValues[s.key] !== undefined ? dbValues[s.key] : s.default
      return formValues[s.key] !== db
    })
  }

  async function saveGroup(groupKey, settings) {
    if (!canEdit) return
    setSavingGroup(groupKey)
    try {
      for (const s of settings) {
        const value = formValues[s.key] ?? s.default
        const { error } = await supabase
          .from('sheq_settings')
          .upsert({
            site_id: currentSiteId,
            key: s.key,
            value: String(value),
          }, { onConflict: 'site_id,key' })
        if (error) throw error
      }
      showToast('Settings saved', 'green')
      await fetchSettings()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSavingGroup(null)
    }
  }

  // Category handlers
  async function addCategory() {
    if (!newCat.name.trim()) { showToast('Category name is required', 'error'); return }
    setSavingCat(true)
    try {
      const { error } = await supabase.from('sheq_incident_categories').insert({
        site_id: currentSiteId,
        name: newCat.name.trim(),
        description: newCat.description || null,
        severity_default: newCat.severity_default,
        is_active: true,
      })
      if (error) throw error
      showToast('Category added')
      setNewCat({ name: '', description: '', severity_default: 'medium' })
      fetchCategories()
    } catch (err) {
      showToast(err.message || 'Failed to add', 'error')
    } finally {
      setSavingCat(false)
    }
  }

  async function saveCategory(cat) {
    setSavingCat(true)
    try {
      const { error } = await supabase.from('sheq_incident_categories').update({
        name: editCatForm.name,
        description: editCatForm.description || null,
        severity_default: editCatForm.severity_default,
      }).eq('id', cat.id).eq('site_id', currentSiteId)
      if (error) throw error
      showToast('Category updated')
      setEditCatId(null)
      fetchCategories()
    } catch (err) {
      showToast(err.message || 'Update failed', 'error')
    } finally {
      setSavingCat(false)
    }
  }

  async function toggleCategoryActive(cat) {
    const { error } = await supabase.from('sheq_incident_categories')
      .update({ is_active: !cat.is_active })
      .eq('id', cat.id)
      .eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast(cat.is_active ? 'Category deactivated' : 'Category activated')
    fetchCategories()
  }

  if (!can('sheq.view')) {
    return (
      <div style={{ padding: '0' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_settings" />
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>lock</span>
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            You do not have permission to view SHEQ settings.
          </p>
        </div>
      </div>
    )
  }

  function renderSettingsCard(title, icon, groupKey, settings) {
    const isSaving = savingGroup === groupKey
    const dirty = groupDirty(settings)
    return (
      <div style={{
        background: THEME.cardBg, border: '1px solid ' + THEME.border,
        borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '22px', color: ACCENT }}>{icon}</span>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: THEME.text }}>{title}</h3>
        </div>
        <div style={{ flex: 1 }}>
          {settings.map(s => (
            <div key={s.key} style={fieldWrap}>
              <label style={lbl}>{s.label}</label>
              {s.type === 'toggle' ? (
                <Toggle value={formValues[s.key]} onChange={v => setVal(s.key, v)} disabled={!canEdit} />
              ) : s.type === 'select' ? (
                <select style={{ ...selectStyle, opacity: canEdit ? 1 : 0.7 }} value={formValues[s.key] ?? ''} onChange={e => setVal(s.key, e.target.value)} disabled={!canEdit}>
                  {(s.options || []).map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
                </select>
              ) : (
                <input
                  style={{ ...inputStyle, opacity: canEdit ? 1 : 0.7 }}
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
            onClick={() => saveGroup(groupKey, settings)}
            disabled={isSaving || !dirty}
            style={{
              marginTop: '8px', padding: '8px 20px', borderRadius: '8px',
              fontSize: '13px', fontWeight: 600, cursor: (isSaving || !dirty) ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', border: 'none',
              background: dirty ? ACCENT : THEME.outlineVar,
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
  }

  return (
    <div style={{ padding: '0' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_settings" />

      <div style={{ padding: '8px 16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '28px', color: ACCENT }}>settings</span>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: THEME.text }}>SHEQ Settings</h2>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '36px', color: THEME.textLow, animation: 'spin 1s linear infinite' }}>progress_activity</span>
            <p style={{ color: THEME.textLow, fontSize: '13px', marginTop: '8px' }}>Loading settings...</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }}>
            {/* Card 1 — General Settings */}
            {renderSettingsCard('General Settings', 'tune', 'general', GENERAL_SETTINGS)}

            {/* Card 2 — Incident Categories */}
            <div style={{
              background: THEME.cardBg, border: '1px solid ' + THEME.border,
              borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: ACCENT }}>category</span>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: THEME.text }}>Incident Categories</h3>
              </div>

              {/* Existing categories */}
              <div style={{ flex: 1, marginBottom: '12px' }}>
                {categories.length === 0 && (
                  <p style={{ color: THEME.textLow, fontSize: '13px', fontStyle: 'italic' }}>No categories yet.</p>
                )}
                {categories.map(cat => (
                  <div key={cat.id} style={{
                    padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}`,
                    display: 'flex', alignItems: 'center', gap: '10px',
                  }}>
                    {editCatId === cat.id ? (
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <input style={inputStyle} value={editCatForm.name} onChange={e => setEditCatForm(p => ({ ...p, name: e.target.value }))} placeholder="Name" />
                        <input style={inputStyle} value={editCatForm.description} onChange={e => setEditCatForm(p => ({ ...p, description: e.target.value }))} placeholder="Description" />
                        <select style={selectStyle} value={editCatForm.severity_default} onChange={e => setEditCatForm(p => ({ ...p, severity_default: e.target.value }))}>
                          {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                        </select>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button onClick={() => saveCategory(cat)} disabled={savingCat} style={{
                            padding: '4px 12px', borderRadius: '6px', border: 'none', background: ACCENT, color: '#fff',
                            fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                          }}>{savingCat ? 'Saving...' : 'Save'}</button>
                          <button onClick={() => setEditCatId(null)} style={{
                            padding: '4px 12px', borderRadius: '6px', border: `1px solid ${THEME.outlineVar}`, background: 'none',
                            fontSize: '12px', color: THEME.textMed, cursor: 'pointer', fontFamily: 'inherit',
                          }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, opacity: cat.is_active ? 1 : 0.5 }}>{cat.name}</div>
                          {cat.description && <div style={{ fontSize: '12px', color: THEME.textMed, opacity: cat.is_active ? 1 : 0.5 }}>{cat.description}</div>}
                          <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
                            Default severity: {cat.severity_default}
                          </div>
                        </div>
                        {canEdit && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <button onClick={() => { setEditCatId(cat.id); setEditCatForm({ name: cat.name, description: cat.description || '', severity_default: cat.severity_default }) }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Edit">
                              <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textMed }}>edit</span>
                            </button>
                            <Toggle value={cat.is_active} onChange={() => toggleCategoryActive(cat)} />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              {/* Add new category */}
              {canEdit && (
                <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '12px', border: `1px solid ${THEME.outlineVar}` }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', marginBottom: '8px' }}>Add Category</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <input style={inputStyle} placeholder="Category name" value={newCat.name} onChange={e => setNewCat(p => ({ ...p, name: e.target.value }))} />
                    <input style={inputStyle} placeholder="Description (optional)" value={newCat.description} onChange={e => setNewCat(p => ({ ...p, description: e.target.value }))} />
                    <select style={selectStyle} value={newCat.severity_default} onChange={e => setNewCat(p => ({ ...p, severity_default: e.target.value }))}>
                      {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
                    </select>
                    <button onClick={addCategory} disabled={savingCat} style={{
                      padding: '8px 20px', borderRadius: '8px', border: 'none',
                      background: ACCENT, color: '#fff', fontSize: '13px', fontWeight: 600,
                      cursor: savingCat ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      alignSelf: 'flex-end', opacity: savingCat ? 0.6 : 1,
                    }}>
                      {savingCat ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Card 3 — Notification Settings */}
            {renderSettingsCard('Notification Settings', 'notifications', 'notifications', NOTIFICATION_SETTINGS)}
          </div>
        )}
      </div>
    </div>
  )
}
