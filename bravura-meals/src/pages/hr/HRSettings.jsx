import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Icon, PageHeader, Button, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { HR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce

const DEFAULTS = {
  employee_number_prefix:    'BRA',
  employee_number_padding:   4,
  default_employment_type:   '',
  require_emergency_contact: true,
  account_creation_enabled:  true,
  leave_approval_required:   true,
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

function Toggle({ value, onChange, disabled }) {
  return (
    <div onClick={() => !disabled && onChange(!value)} style={{
      width: '44px', height: '24px', borderRadius: '999px', position: 'relative',
      background: value ? ACCENT : THEME.outlineVar, cursor: disabled ? 'default' : 'pointer',
      transition: 'background .15s', flexShrink: 0, opacity: disabled ? .6 : 1,
    }}>
      <div style={{
        position: 'absolute', top: '3px', left: value ? '23px' : '3px',
        width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,.25)', transition: 'left .15s',
      }} />
    </div>
  )
}

export default function HRSettings({ setPage }) {
  const { profile } = useAuth()
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  useRealtimeSubscription('module_settings', { column: 'site_id', value: currentSiteId }, load)

  const [form, setForm] = useState(DEFAULTS)
  const [employmentTypes, setEmploymentTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const canEdit = can('hr.edit')

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const [setRes, etRes] = await Promise.all([
        supabase.from('module_settings').select('key, value')
          .eq('site_id', currentSiteId).eq('module', 'hr'),
        supabase.from('employment_types').select('id, name').eq('is_archived', false).order('name'),
      ])
      if (setRes.error) { console.error(setRes.error); showToast('Failed to load HR settings', 'red') }
      if (!cancelled) {
        const loaded = { ...DEFAULTS }
        for (const row of setRes.data || []) {
          if (row.key in loaded) loaded[row.key] = row.value
        }
        setForm(loaded)
        setEmploymentTypes(etRes.data || [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true)
    const rows = Object.entries(form).map(([key, value]) => ({
      site_id: currentSiteId, module: 'hr', key, value,
      updated_at: new Date().toISOString(), updated_by: profile?.id || null,
    }))
    const { error } = await supabase.from('module_settings')
      .upsert(rows, { onConflict: 'site_id,module,key' })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('HR settings saved', 'green')
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>

  return (
    <div style={{ maxWidth: '720px' }}>
      <QuickNav pills={HR_PILLS} setPage={setPage} current="wf_settings" />
      <PageHeader title="HR Settings" site={currentSite} />

      {!canEdit && (
        <div style={{ padding: '10px 14px', marginBottom: '16px', borderRadius: '10px', background: THEME.statusInfoBg, color: THEME.statusInfoText, fontSize: '13px' }}>
          Read-only — you need the HR settings permission to make changes.
        </div>
      )}

      <Card style={{ marginBottom: '16px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '14px', color: THEME.text }}>Employee Numbering</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <SectionLabel>Number Prefix</SectionLabel>
            <input style={inputStyle} value={form.employee_number_prefix} disabled={!canEdit}
              onChange={e => set('employee_number_prefix', e.target.value)} />
          </div>
          <div>
            <SectionLabel>Padding (digits)</SectionLabel>
            <input style={inputStyle} type="number" min="2" max="8" value={form.employee_number_padding} disabled={!canEdit}
              onChange={e => set('employee_number_padding', Number(e.target.value) || 4)} />
          </div>
        </div>
        <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '8px' }}>
          Preview: <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>
            {form.employee_number_prefix}{String(42).padStart(Number(form.employee_number_padding) || 4, '0')}
          </span>
        </div>
      </Card>

      <Card style={{ marginBottom: '16px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '14px', color: THEME.text }}>Defaults</div>
        <SectionLabel>Default Employment Type</SectionLabel>
        <select style={inputStyle} value={form.default_employment_type} disabled={!canEdit}
          onChange={e => set('default_employment_type', e.target.value)}>
          <option value="">— None —</option>
          {employmentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Card>

      <Card style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '14px', color: THEME.text }}>Policies</div>
        {[
          { key: 'require_emergency_contact', label: 'Require at least one emergency contact', sub: 'New employees cannot be saved without one' },
          { key: 'account_creation_enabled',  label: 'Allow HR to request system accounts',    sub: 'Shows the system-account section on the employee form' },
          { key: 'leave_approval_required',   label: 'Leave requests require approval',        sub: 'Used by the leave module (HR Phase 2)' },
        ].map(p => (
          <div key={p.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{p.label}</div>
              <div style={{ fontSize: '12px', color: THEME.textLow }}>{p.sub}</div>
            </div>
            <Toggle value={!!form[p.key]} disabled={!canEdit} onChange={v => set(p.key, v)} />
          </div>
        ))}
      </Card>

      {canEdit && (
        <Button icon="save" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      )}
    </div>
  )
}
