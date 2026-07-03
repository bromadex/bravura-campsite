import { useState, useEffect } from 'react'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { useFuel } from '../../contexts/FuelContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, Modal, Button, SectionLabel, ConfirmModal, showToast } from '../../components/ui'
import { supabase } from '../../supabaseClient'

const FUEL_CLR = MODULE_COLORS.fuel

const DEFAULTS = {
  docket_prefix:                'FD-',
  docket_padding:               4,
  require_approval:             false,
  alert_threshold_pct:          20,
  default_price_per_litre:      '',
  allow_manual_litres:          true,
  fleet_integration_enabled:    false,
  auto_create_requisition:      false,
}

const MAPPING_META = [
  { type: 'fuel_stock',       label: 'Fuel Stock',       hint: 'Asset account debited when fuel is delivered' },
  { type: 'fuel_expense',     label: 'Fuel Expense',     hint: 'Expense account debited when fuel is consumed at period close' },
  { type: 'accounts_payable', label: 'Accounts Payable', hint: 'Liability account credited on delivery until supplier is paid' },
]

const SWATCHES = [
  '#FF8C00', '#1A6B52', '#D97706', '#0EA5E9',
  '#9333EA', '#DC2626', '#0891B2', '#65A30D',
  '#475569', '#F59E0B',
]

const BLANK_FT = { name: '', code: '', colour: SWATCHES[0], density: '' }

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
    <div onClick={() => onChange(!value)} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
      <div style={{
        width: '44px', height: '24px', borderRadius: '12px',
        background: value ? FUEL_CLR : THEME.outline,
        position: 'relative', transition: 'background .2s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: '3px', left: value ? '23px' : '3px',
          width: '18px', height: '18px', borderRadius: '50%',
          background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
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

const modalInputStyle = {
  ...inp, marginBottom: '14px',
}

export default function FuelSettings() {
  const { can }             = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { fuelTypes, addFuelType, updateFuelType, deactivateFuelType } = useFuel()

  const [cfg,     setCfg]     = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [rowExists, setRowExists] = useState(false)
  const [mappings, setMappings] = useState({ fuel_stock: { code: '', name: '' }, fuel_expense: { code: '', name: '' }, accounts_payable: { code: '', name: '' } })

  // Fuel type modal state
  const [ftModal,   setFtModal]   = useState(false)
  const [ftEdit,    setFtEdit]    = useState(null)
  const [ftForm,    setFtForm]    = useState(BLANK_FT)
  const [ftSaving,  setFtSaving]  = useState(false)
  const [ftRemove,  setFtRemove]  = useState(null)

  useEffect(() => {
    if (!currentSiteId) return
    setLoading(true)
    Promise.all([
      supabase.from('fuel_settings').select('*').eq('site_id', currentSiteId).maybeSingle(),
      supabase.from('fuel_finance_mapping').select('*').eq('site_id', currentSiteId),
    ]).then(([{ data }, { data: maps }]) => {
      if (data) {
        setRowExists(true)
        setCfg({
          docket_prefix:             data.docket_prefix              ?? DEFAULTS.docket_prefix,
          docket_padding:            data.docket_padding             ?? DEFAULTS.docket_padding,
          require_approval:          data.require_approval           ?? DEFAULTS.require_approval,
          alert_threshold_pct:       data.alert_threshold_pct        ?? DEFAULTS.alert_threshold_pct,
          default_price_per_litre:   data.default_price_per_litre    != null ? String(data.default_price_per_litre) : '',
          allow_manual_litres:       data.allow_manual_litres        ?? DEFAULTS.allow_manual_litres,
          fleet_integration_enabled: data.fleet_integration_enabled  ?? DEFAULTS.fleet_integration_enabled,
          auto_create_requisition:   data.auto_create_requisition    ?? DEFAULTS.auto_create_requisition,
        })
      } else {
        setRowExists(false)
        setCfg(DEFAULTS)
      }
      const seed = { fuel_stock: { code: '', name: '' }, fuel_expense: { code: '', name: '' }, accounts_payable: { code: '', name: '' } }
      for (const m of (maps || [])) seed[m.mapping_type] = { code: m.account_code || '', name: m.account_name || '' }
      setMappings(seed)
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
        site_id:                   currentSiteId,
        docket_prefix:             cfg.docket_prefix.trim() || 'FD-',
        docket_padding:            Math.max(1, Math.min(8, Number(cfg.docket_padding) || 4)),
        require_approval:          Boolean(cfg.require_approval),
        alert_threshold_pct:       Math.max(1, Math.min(99, Number(cfg.alert_threshold_pct) || 20)),
        default_price_per_litre:   cfg.default_price_per_litre ? Number(cfg.default_price_per_litre) : null,
        allow_manual_litres:       Boolean(cfg.allow_manual_litres),
        fleet_integration_enabled: Boolean(cfg.fleet_integration_enabled),
        auto_create_requisition:   Boolean(cfg.auto_create_requisition),
      }
      const { error } = rowExists
        ? await supabase.from('fuel_settings').update(payload).eq('site_id', currentSiteId)
        : await supabase.from('fuel_settings').insert([payload])
      if (error) throw error

      const mapRows = MAPPING_META
        .filter(m => (mappings[m.type].code || '').trim())
        .map(m => ({
          site_id:      currentSiteId,
          mapping_type: m.type,
          account_code: mappings[m.type].code.trim(),
          account_name: (mappings[m.type].name || '').trim() || null,
        }))
      if (mapRows.length) {
        const { error: mapErr } = await supabase
          .from('fuel_finance_mapping')
          .upsert(mapRows, { onConflict: 'site_id,mapping_type' })
        if (mapErr) throw mapErr
      }

      setRowExists(true)
      showToast('Fuel settings saved', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to save settings', 'red')
    } finally {
      setSaving(false)
    }
  }

  function setMap(type, key, val) {
    setMappings(prev => ({ ...prev, [type]: { ...prev[type], [key]: val } }))
  }

  // ── Fuel type helpers ────────────────────────────────────────────────────────

  function openAddFt() {
    setFtEdit(null); setFtForm(BLANK_FT); setFtModal(true)
  }
  function openEditFt(ft) {
    setFtEdit(ft)
    setFtForm({ name: ft.name, code: ft.code, colour: ft.colour || SWATCHES[0], density: ft.density != null ? String(ft.density) : '' })
    setFtModal(true)
  }
  function setFt(field, value) { setFtForm(prev => ({ ...prev, [field]: value })) }

  async function saveFt() {
    if (!ftForm.name.trim()) { showToast('Enter a fuel name', 'red'); return }
    if (!ftForm.code.trim()) { showToast('Enter a fuel code (e.g. DIESEL)', 'red'); return }
    setFtSaving(true)
    try {
      const data = {
        name: ftForm.name.trim(),
        code: ftForm.code.trim().toUpperCase(),
        colour: ftForm.colour,
        density: ftForm.density ? Number(ftForm.density) : null,
      }
      if (ftEdit) {
        await updateFuelType(ftEdit.id, data)
        showToast('Fuel type updated', 'green')
      } else {
        await addFuelType(data)
        showToast('Fuel type added', 'green')
      }
      setFtModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to save', 'red')
    } finally {
      setFtSaving(false)
    }
  }

  async function confirmRemoveFt() {
    try {
      await deactivateFuelType(ftRemove.id)
      showToast('Fuel type archived', 'green')
    } catch (err) {
      showToast(err.message || 'Failed to archive', 'red')
    } finally {
      setFtRemove(null)
    }
  }

  const docketPreview = `${cfg.docket_prefix}${'1'.padStart(Number(cfg.docket_padding) || 4, '0')}`

  return (
    <div style={{ maxWidth: '700px' }}>
      <PageHeader title="Fuel Settings" site={currentSite} />

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={28} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <>
          {/* ═══════════════════════════════════════════════════════════════════
               FUEL TYPES — Master list referenced by tanks, reports, etc.
             ═══════════════════════════════════════════════════════════════════ */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="oil_barrel" size={15} style={{ color: FUEL_CLR }} />
                Fuel Types
              </div>
              <button onClick={openAddFt} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                padding: '6px 14px', borderRadius: '8px', border: `1px dashed ${THEME.outline}`,
                background: 'transparent', color: FUEL_CLR, fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <Icon name="add" size={14} style={{ color: FUEL_CLR }} /> Add Type
              </button>
            </div>

            <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '14px' }}>
              Master fuel type list referenced by tanks, deliveries, and reports across all modules.
            </div>

            {fuelTypes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: THEME.textLow, fontSize: '13px' }}>
                No fuel types configured yet. Add your first fuel type (e.g. Diesel, Petrol).
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                {fuelTypes.map((ft, idx) => (
                  <div
                    key={ft.id}
                    onClick={() => openEditFt(ft)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '12px 14px', cursor: 'pointer',
                      borderBottom: idx < fuelTypes.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
                      borderRadius: idx === 0 ? '8px 8px 0 0' : idx === fuelTypes.length - 1 ? '0 0 8px 8px' : '0',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Colour swatch */}
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                      background: ft.colour || THEME.outline,
                      border: `1px solid ${THEME.outline}`,
                    }} />

                    {/* Name + code */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{ft.name}</div>
                      <div style={{ fontSize: '11px', color: THEME.textLow, fontFamily: 'monospace' }}>{ft.code}</div>
                    </div>

                    {/* Density */}
                    <div style={{ fontSize: '12px', color: THEME.textMed, textAlign: 'right', minWidth: '80px' }}>
                      {ft.density != null ? `${Number(ft.density).toFixed(4)} kg/L` : '—'}
                    </div>

                    {/* Status badge */}
                    <span style={{
                      padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
                      background: ft.is_active !== false ? THEME.statusSuccessBg : THEME.statusNeutralBg,
                      color: ft.is_active !== false ? THEME.statusSuccessText : THEME.statusNeutralText,
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>
                      {ft.is_active !== false ? 'Active' : 'Archived'}
                    </span>

                    {/* Archive button */}
                    {ft.is_active !== false && (
                      <button
                        onClick={e => { e.stopPropagation(); setFtRemove(ft) }}
                        title="Archive fuel type"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', opacity: .5 }}
                      >
                        <Icon name="archive" size={16} style={{ color: THEME.error }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Docket numbering */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="confirmation_number" size={15} style={{ color: FUEL_CLR }} />
              Docket Numbering
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FieldWrap label="Prefix" hint="Prepended to every docket number">
                <input type="text" value={cfg.docket_prefix} maxLength={10} onChange={e => set('docket_prefix', e.target.value)} placeholder="FD-" style={inp} />
              </FieldWrap>
              <FieldWrap label="Padding (digits)" hint="Number of digits after the prefix">
                <input type="number" min={1} max={8} value={cfg.docket_padding} onChange={e => set('docket_padding', e.target.value)} style={inp} />
              </FieldWrap>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderRadius: '10px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}` }}>
              <Icon name="preview" size={15} style={{ color: THEME.textLow, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', color: THEME.textMed }}>Preview:</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '14px', color: FUEL_CLR }}>{docketPreview}</span>
            </div>
          </section>

          {/* Alerts */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="warning" size={15} style={{ color: THEME.warning }} />
              Alerts
            </div>

            <FieldWrap label="Low-Fuel Alert Threshold (%)" hint="Tanks at or below this level are flagged red on the dashboard">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <input type="number" min={1} max={99} value={cfg.alert_threshold_pct} onChange={e => set('alert_threshold_pct', e.target.value)} style={{ ...inp, width: '120px' }} />
                <div style={{ flex: 1, height: '8px', borderRadius: '6px', background: THEME.outlineVar, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${cfg.alert_threshold_pct}%`, background: THEME.error, borderRadius: '6px', transition: 'width .2s' }} />
                </div>
                <span style={{ fontSize: '13px', fontWeight: 600, color: THEME.error, minWidth: '36px' }}>{cfg.alert_threshold_pct}%</span>
              </div>
            </FieldWrap>
          </section>

          {/* Cost Tracking */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="monitoring" size={15} style={{ color: THEME.success }} />
              Cost Tracking
            </div>

            <FieldWrap label="Internal Rate Per Litre ($)" hint="Used to estimate internal cost on the issuance form when no delivery rate is available. Leave blank to disable.">
              <input type="number" min={0} step={0.0001} value={cfg.default_price_per_litre} onChange={e => set('default_price_per_litre', e.target.value)} placeholder="e.g. 1.4500" style={{ ...inp, width: '200px' }} />
            </FieldWrap>
          </section>

          {/* Issuance behaviour */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' }}>
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
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: THEME.statusInfoBg, color: THEME.statusInfoText, letterSpacing: '.04em' }}>PHASE 2</span>
                  </div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                    Issuances will enter a pending state until approved by a supervisor. Activates in Phase 2.
                  </div>
                </div>
                <Toggle value={cfg.require_approval} onChange={v => set('require_approval', v)} />
              </div>
            </div>
          </section>

          {/* Module Integrations */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '16px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="hub" size={15} style={{ color: THEME.info }} />
              Module Integrations
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>Fleet Module Integration</div>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: THEME.statusInfoBg, color: THEME.statusInfoText, letterSpacing: '.04em' }}>PENDING</span>
                  </div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                    When enabled, vehicle consumption reports will pull maintenance status from the Fleet module.
                  </div>
                </div>
                <Toggle value={cfg.fleet_integration_enabled} onChange={v => set('fleet_integration_enabled', v)} />
              </div>

              <div style={{ borderTop: `1px solid ${THEME.outlineVar}`, paddingTop: '16px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>Auto-create Purchase Requisition</div>
                  <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>
                    When a tank falls below its alert threshold, automatically create a pending requisition for the Procurement module.
                  </div>
                </div>
                <Toggle value={cfg.auto_create_requisition} onChange={v => set('auto_create_requisition', v)} />
              </div>
            </div>
          </section>

          {/* Finance Account Mapping */}
          <section style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px', padding: '20px 24px', marginBottom: '24px' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="account_balance" size={15} style={{ color: THEME.info }} />
              Finance Account Mapping
            </div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '18px' }}>
              Chart-of-accounts codes used by the Finance Export page when generating journal entries.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {MAPPING_META.map(m => (
                <div key={m.type}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>{m.label}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '6px' }}>{m.hint}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px' }}>
                    <input type="text" value={mappings[m.type].code} onChange={e => setMap(m.type, 'code', e.target.value)} placeholder="Account code" style={inp} />
                    <input type="text" value={mappings[m.type].name} onChange={e => setMap(m.type, 'name', e.target.value)} placeholder="Account name (optional)" style={inp} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Save */}
          <button onClick={save} disabled={saving} style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '12px 28px', borderRadius: '14px', border: 'none',
            background: saving ? THEME.outline : FUEL_CLR, color: '#fff',
            fontSize: '14px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          }}>
            {saving
              ? <><Icon name="progress_activity" size={16} style={{ color: '#fff', animation: 'spin 1s linear infinite' }} /> Saving…</>
              : <><Icon name="save" size={16} style={{ color: '#fff' }} /> Save Settings</>
            }
          </button>
        </>
      )}

      {/* ── Fuel Type Modal ── */}
      <Modal
        open={ftModal}
        onClose={() => setFtModal(false)}
        title={ftEdit ? 'Edit Fuel Type' : 'Add Fuel Type'}
        footer={
          <>
            <Button onClick={() => setFtModal(false)} variant="text">Cancel</Button>
            <Button onClick={saveFt} disabled={ftSaving}>{ftSaving ? 'Saving…' : ftEdit ? 'Update' : 'Add'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input value={ftForm.name} onChange={e => setFt('name', e.target.value)} placeholder="e.g. Diesel" style={modalInputStyle} autoFocus />
          </div>
          <div>
            <SectionLabel>Code *</SectionLabel>
            <input value={ftForm.code} onChange={e => setFt('code', e.target.value)} placeholder="e.g. DIESEL" style={modalInputStyle} />
          </div>
        </div>

        <div>
          <SectionLabel>Colour</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
            {SWATCHES.map(c => (
              <button key={c} type="button" onClick={() => setFt('colour', c)} style={{
                width: '32px', height: '32px', borderRadius: '8px', background: c,
                border: ftForm.colour === c ? `3px solid ${THEME.text}` : `1px solid ${THEME.outline}`,
                cursor: 'pointer', padding: 0,
              }} title={c} />
            ))}
            <input type="color" value={ftForm.colour} onChange={e => setFt('colour', e.target.value)}
              style={{ width: '32px', height: '32px', padding: 0, border: `1px solid ${THEME.outline}`, borderRadius: '8px', cursor: 'pointer' }} title="Custom colour" />
          </div>
        </div>

        <div>
          <SectionLabel>Default Density (kg per litre, optional)</SectionLabel>
          <input type="number" min="0" step="0.0001" value={ftForm.density} onChange={e => setFt('density', e.target.value)} placeholder="e.g. 0.832 for diesel" style={modalInputStyle} />
        </div>
      </Modal>

      <ConfirmModal
        open={!!ftRemove}
        onClose={() => setFtRemove(null)}
        onConfirm={confirmRemoveFt}
        title="Archive Fuel Type"
        message={ftRemove
          ? `Archive "${ftRemove.name}"? It will be hidden from new tank dropdowns but existing tanks keep their assignment. Historical data is preserved.`
          : ''}
      />
    </div>
  )
}
