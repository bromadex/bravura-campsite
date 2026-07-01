import { useState, useEffect } from 'react'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, showToast } from '../../components/ui'
import { supabase } from '../../supabaseClient'

const FUEL_CLR = MODULE_COLORS.fuel

const DEFAULTS = {
  docket_prefix:           'FD-',
  docket_padding:          4,
  require_approval:        false,
  alert_threshold_pct:     20,
  default_price_per_litre: '',
  allow_manual_litres:     true,
}

function FieldWrap({ label, hint, children }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>{hint}</div>}
    </div>
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <div
      onClick={() => onChange(!value)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none',
      }}
    >
      <div style={{
        width: '44px', height: '24px', borderRadius: '12px',
        background: value ? FUEL_CLR : THEME.outline,
        position: 'relative', transition: 'background .2s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: '3px',
          left: value ? '23px' : '3px',
          width: '18px', height: '18px', borderRadius: '50%',
          background: '#fff', transition: 'left .2s',
          boxShadow: '0 1px 3px rgba(0,0,0,.2)',
        }} />
      </div>
      {label && <span style={{ fontSize: '13px', color: THEME.text }}>{label}</span>}
    </div>
  )
}

const inp = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, display: 'block',
}

export default function FuelSettings() {
  const { can }             = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const [cfg,     setCfg]     = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [rowExists, setRowExists] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    setLoading(true)
    supabase
      .from('fuel_settings')
      .select('*')
      .eq('site_id', currentSiteId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRowExists(true)
          setCfg({
            docket_prefix:           data.docket_prefix           ?? DEFAULTS.docket_prefix,
            docket_padding:          data.docket_padding           ?? DEFAULTS.docket_padding,
            require_approval:        data.require_approval         ?? DEFAULTS.require_approval,
            alert_threshold_pct:     data.alert_threshold_pct      ?? DEFAULTS.alert_threshold_pct,
            default_price_per_litre: data.default_price_per_litre  != null ? String(data.default_price_per_litre) : '',
            allow_manual_litres:     data.allow_manual_litres      ?? DEFAULTS.allow_manual_litres,
          })
        } else {
          setRowExists(false)
          setCfg(DEFAULTS)
        }
        setLoading(false)
      })
  }, [currentSiteId])

  if (!can('fuel.edit')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p style={{ fontSize: '14px' }}>You need Fuel Edit permission to manage settings.</p>
    </div>
  )

  function set(key, value) { setCfg(prev => ({ ...prev, [key]: value })) }

  async function save() {
    if (!currentSiteId) return
    setSaving(true)
    try {
      const payload = {
        site_id:                 currentSiteId,
        docket_prefix:           cfg.docket_prefix.trim() || 'FD-',
        docket_padding:          Math.max(1, Math.min(8, Number(cfg.docket_padding) || 4)),
        require_approval:        Boolean(cfg.require_approval),
        alert_threshold_pct:     Math.max(1, Math.min(99, Number(cfg.alert_threshold_pct) || 20)),
        default_price_per_litre: cfg.default_price_per_litre ? Number(cfg.default_price_per_litre) : null,
        allow_manual_litres:     Boolean(cfg.allow_manual_litres),
      }
      const { error } = rowExists
        ? await supabase.from('fuel_settings').update(payload).eq('site_id', currentSiteId)
        : await supabase.from('fuel_settings').insert([payload])
      if (error) throw error
      setRowExists(true)
      showToast('Fuel settings saved', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to save settings', 'red')
    } finally {
      setSaving(false)
    }
  }

  const docketPreview = `${cfg.docket_prefix}${'1'.padStart(Number(cfg.docket_padding) || 4, '0')}`

  return (
    <div style={{ maxWidth: '600px' }}>
      <PageHeader title="Fuel Settings" site={currentSite} />

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <>
          {/* Docket numbering */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '16px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="confirmation_number" size={15} style={{ color: FUEL_CLR }} />
              Docket Numbering
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FieldWrap label="Prefix" hint="Prepended to every docket number">
                <input
                  type="text" value={cfg.docket_prefix} maxLength={10}
                  onChange={e => set('docket_prefix', e.target.value)}
                  placeholder="FD-"
                  style={inp}
                />
              </FieldWrap>
              <FieldWrap label="Padding (digits)" hint="Number of digits after the prefix">
                <input
                  type="number" min={1} max={8} value={cfg.docket_padding}
                  onChange={e => set('docket_padding', e.target.value)}
                  style={inp}
                />
              </FieldWrap>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderRadius: '10px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}` }}>
              <Icon name="preview" size={15} style={{ color: THEME.textLow, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: THEME.textMed }}>Preview:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '14px', color: FUEL_CLR }}>{docketPreview}</span>
            </div>
          </section>

          {/* Alerts */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '16px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="warning" size={15} style={{ color: THEME.warning }} />
              Alerts
            </div>

            <FieldWrap label="Low-Fuel Alert Threshold (%)" hint="Tanks at or below this level are flagged red on the dashboard">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input
                  type="number" min={1} max={99} value={cfg.alert_threshold_pct}
                  onChange={e => set('alert_threshold_pct', e.target.value)}
                  style={{ ...inp, width: '120px' }}
                />
                <div style={{
                  flex: 1, height: '8px', borderRadius: '6px', background: THEME.outlineVar, position: 'relative', overflow: 'hidden',
                }}>
                  <div style={{ height: '100%', width: `${cfg.alert_threshold_pct}%`, background: THEME.error, borderRadius: '6px', transition: 'width .2s' }} />
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.error, minWidth: '36px' }}>{cfg.alert_threshold_pct}%</span>
              </div>
            </FieldWrap>
          </section>

          {/* Cost Tracking */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '16px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="monitoring" size={15} style={{ color: THEME.success }} />
              Cost Tracking
            </div>

            <FieldWrap label="Internal Rate Per Litre ($)" hint="Used to estimate internal cost on the issuance form when no delivery rate is available. Leave blank to disable.">
              <input
                type="number" min={0} step={0.0001} value={cfg.default_price_per_litre}
                onChange={e => set('default_price_per_litre', e.target.value)}
                placeholder="e.g. 1.4500"
                style={{ ...inp, width: '200px' }}
              />
            </FieldWrap>
          </section>

          {/* Issuance behaviour */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '16px', padding: '20px 24px', marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="output" size={15} style={{ color: FUEL_CLR }} />
              Issuance Behaviour
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>Allow Manual Litres Entry</div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                    When enabled, operators can enter litres directly instead of using pump meter readings.
                  </div>
                </div>
                <Toggle value={cfg.allow_manual_litres} onChange={v => set('allow_manual_litres', v)} />
              </div>

              <div style={{ borderTop: `1px solid ${THEME.outlineVar}`, paddingTop: '16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>Require Approval for Issuance</div>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: THEME.statusInfoBg, color: THEME.statusInfoText, letterSpacing: '.04em' }}>
                      PHASE 2
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                    Issuances will enter a pending state until approved by a supervisor. Activates in Phase 2.
                  </div>
                </div>
                <Toggle value={cfg.require_approval} onChange={v => set('require_approval', v)} />
              </div>
            </div>
          </section>

          {/* Save */}
          <button
            onClick={save}
            disabled={saving}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '12px 28px', borderRadius: '14px', border: 'none',
              background: saving ? THEME.outline : FUEL_CLR, color: '#fff',
              fontSize: '14px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {saving
              ? <><Icon name="progress_activity" size={16} style={{ color: '#fff', animation: 'spin 1s linear infinite' }} /> Saving…</>
              : <><Icon name="save" size={16} style={{ color: '#fff' }} /> Save Settings</>
            }
          </button>
        </>
      )}
    </div>
  )
}
