import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { Card, Button, showToast, PageHeader, Icon } from '../../components/ui'
import { THEME } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import QuickNav, { MEALS_PILLS } from '../../components/QuickNav'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const MEAL_MAPPING_META = [
  { type: 'meal_expense',     label: 'Meal Expense',     hint: 'Expense account debited when meals are consumed and billed' },
  { type: 'accounts_payable', label: 'Accounts Payable', hint: 'Liability account credited pending catering supplier payment' },
]

export default function Settings({ setPage }) {
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('meals_finance_mapping', { column: 'site_id', value: currentSiteId })
  const [cfg,     setCfg]     = useState({ company_name: '', site_name: '', supervisor_name: '', provider_name: '' })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [mappings, setMappings] = useState({ meal_expense: { code: '', name: '' }, accounts_payable: { code: '', name: '' } })

  useEffect(() => {
    supabase.from('config').select('*').then(({ data }) => {
      const obj = {}
      data?.forEach(row => { obj[row.key] = row.value })
      setCfg(c => ({ ...c, ...obj }))
      setLoading(false)
    })
  }, [rt])

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('meals_finance_mapping').select('*').eq('site_id', currentSiteId).then(({ data }) => {
      const seed = { meal_expense: { code: '', name: '' }, accounts_payable: { code: '', name: '' } }
      for (const m of (data || [])) seed[m.mapping_type] = { code: m.account_code || '', name: m.account_name || '' }
      setMappings(seed)
    })
  }, [currentSiteId])

  function setMap(type, key, val) {
    setMappings(prev => ({ ...prev, [type]: { ...prev[type], [key]: val } }))
  }

  async function saveSettings() {
    setSaving(true)
    try {
      const updates = Object.entries(cfg).map(([key, value]) => ({ key, value }))
      for (const u of updates) {
        const { error } = await supabase.from('config').upsert(u, { onConflict: 'key' })
        if (error) throw error
      }
      if (currentSiteId) {
        const mapRows = MEAL_MAPPING_META
          .filter(m => (mappings[m.type].code || '').trim())
          .map(m => ({
            site_id:      currentSiteId,
            mapping_type: m.type,
            account_code: mappings[m.type].code.trim(),
            account_name: (mappings[m.type].name || '').trim() || null,
          }))
        if (mapRows.length) {
          const { error: mapErr } = await supabase
            .from('meals_finance_mapping')
            .upsert(mapRows, { onConflict: 'site_id,mapping_type' })
          if (mapErr) throw mapErr
        }
      }
      showToast('Settings saved', 'green')
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    { key: 'company_name',    label: 'Company / Organisation Name', placeholder: 'e.g. Bravura Zimbabwe Ltd' },
    { key: 'site_name',       label: 'Site / Location',             placeholder: 'e.g. Kamativi Mine Site' },
    { key: 'supervisor_name', label: 'Supervisor Name',             placeholder: 'e.g. Eng. C. Katsande' },
    { key: 'provider_name',   label: 'Food Provider',               placeholder: 'e.g. Catering Company' },
  ]

  return (
    <div style={{ maxWidth: '540px' }}>
      <QuickNav pills={MEALS_PILLS} setPage={setPage} current="meals_settings" />
      <PageHeader title="Settings" />

      <Card style={{ marginBottom: '16px' }}>
        <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textMed, marginBottom: '16px' }}>
          Organisation
        </div>
        {loading ? (
          <div style={{ color: THEME.textMed }}>Loading…</div>
        ) : (
          fields.map(f => (
            <div key={f.key} style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                {f.label}
              </label>
              <input
                type="text"
                value={cfg[f.key]}
                onChange={e => setCfg(c => ({ ...c, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #dde2ea', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
            </div>
          ))
        )}
      </Card>

      {/* Finance Account Mapping */}
      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <Icon name="account_balance" size={15} style={{ color: THEME.info }} />
          <div style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.06em', color: THEME.textMed }}>
            Finance Account Mapping
          </div>
        </div>
        <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '16px' }}>
          Chart-of-accounts codes used by the Meal Finance Export when generating journal entries.
        </div>
        {MEAL_MAPPING_META.map(m => (
          <div key={m.type} style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>{m.label}</div>
            <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '6px' }}>{m.hint}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
              <input
                type="text"
                value={mappings[m.type].code}
                onChange={e => setMap(m.type, 'code', e.target.value)}
                placeholder="Account code"
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', height: '36px', boxSizing: 'border-box' }}
              />
              <input
                type="text"
                value={mappings[m.type].name}
                onChange={e => setMap(m.type, 'name', e.target.value)}
                placeholder="Account name (optional)"
                style={{ width: '100%', padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', height: '36px', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        ))}
      </Card>

      <div>
        <Button onClick={saveSettings} variant="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </div>
  )
}
