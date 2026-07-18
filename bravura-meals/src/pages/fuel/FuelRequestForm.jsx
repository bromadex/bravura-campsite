import { useState, useMemo, useEffect } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, showToast } from '../../components/ui'
import { supabase } from '../../supabaseClient'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const FUEL_CLR = MODULE_COLORS.fuel

const PRIORITY_OPTIONS = [
  { value: 'normal',    label: 'Normal',    icon: 'circle',          color: THEME.textMed },
  { value: 'urgent',    label: 'Urgent',    icon: 'warning',         color: THEME.warning },
  { value: 'emergency', label: 'Emergency', icon: 'emergency_home',  color: THEME.error   },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function inpStyle(extra = {}) {
  return {
    width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
    borderRadius: '12px', fontSize: '14px', color: THEME.text,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
    background: THEME.surface, display: 'block',
    ...extra,
  }
}

function FieldWrap({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <label style={{
        display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed,
        marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em',
      }}>
        {label}{required && <span style={{ color: THEME.error, marginLeft: '3px' }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>{hint}</div>}
    </div>
  )
}

function InfoPanel({ icon, color, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '8px',
      padding: '10px 14px', borderRadius: '10px',
      background: color + '14', border: `1px solid ${color}33`,
      fontSize: '12px', color, marginBottom: '10px',
    }}>
      <Icon name={icon} size={15} style={{ color, flexShrink: 0, marginTop: '1px' }} />
      <div>{children}</div>
    </div>
  )
}

function SearchSelect({ items, value, onSelect, placeholder, renderItem, renderSelected, disabled }) {
  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return items.slice(0, 40)
    return items.filter(i => renderItem(i).toLowerCase().includes(q)).slice(0, 40)
  }, [items, query])

  const selected = value ? items.find(i => i.id === value) : null

  function pick(item) { onSelect(item.id); setQuery(''); setOpen(false) }
  function clear(e)   { e.stopPropagation(); onSelect(null); setQuery('') }

  return (
    <div style={{ position: 'relative' }}>
      <div
        onClick={() => { if (!disabled) setOpen(o => !o) }}
        style={{
          ...inpStyle(),
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {selected
          ? <span style={{ fontSize: '14px', color: THEME.text }}>{renderSelected(selected)}</span>
          : <span style={{ color: THEME.textLow }}>{placeholder}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {selected && !disabled && (
            <span onClick={clear} style={{ cursor: 'pointer', color: THEME.textLow, lineHeight: 1 }}>
              <Icon name="close" size={15} />
            </span>
          )}
          <Icon name={open ? 'expand_less' : 'expand_more'} size={18} style={{ color: THEME.textLow }} />
        </div>
      </div>

      {open && (
        <div style={{
          position: 'absolute', zIndex: 100, top: 'calc(100% + 4px)', left: 0, right: 0,
          background: THEME.surface, border: `1px solid ${THEME.outline}`,
          borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,.12)',
          maxHeight: '260px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '8px' }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search…"
              style={{ ...inpStyle(), padding: '8px 12px', fontSize: '13px' }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0
              ? <div style={{ padding: '12px 16px', fontSize: '13px', color: THEME.textLow }}>No results</div>
              : filtered.map(item => (
                <div
                  key={item.id}
                  onClick={() => pick(item)}
                  style={{
                    padding: '9px 14px', fontSize: '13px', cursor: 'pointer',
                    background: item.id === value ? FUEL_CLR + '18' : 'transparent',
                    color: item.id === value ? FUEL_CLR : THEME.text,
                  }}
                  onMouseEnter={e => { if (item.id !== value) e.currentTarget.style.background = THEME.surfaceVar }}
                  onMouseLeave={e => { if (item.id !== value) e.currentTarget.style.background = 'transparent' }}
                >
                  {renderItem(item)}
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({ requestNumber, priority, onAnother, setPage }) {
  const priorityMeta = PRIORITY_OPTIONS.find(p => p.value === priority)
  return (
    <div style={{ maxWidth: '520px', margin: '60px auto', textAlign: 'center', padding: '0 24px' }}>
      <div style={{
        width: '72px', height: '72px', borderRadius: '50%',
        background: FUEL_CLR + '18', border: `2px solid ${FUEL_CLR}44`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px',
      }}>
        <Icon name="check_circle" size={36} style={{ color: FUEL_CLR }} />
      </div>
      <div style={{ fontSize: '22px', fontWeight: 300, color: THEME.text, marginBottom: '8px' }}>
        Request Submitted
      </div>
      <div style={{ fontSize: '14px', color: THEME.textMed, marginBottom: '6px' }}>
        Request <span style={{ fontFamily: 'monospace', fontWeight: 700, color: FUEL_CLR }}>{requestNumber}</span> is pending approval.
      </div>
      {priority !== 'normal' && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '4px 12px', borderRadius: '6px', marginBottom: '6px',
          background: priorityMeta.color + '18', border: `1px solid ${priorityMeta.color}44`,
          fontSize: '12px', fontWeight: 600, color: priorityMeta.color,
        }}>
          <Icon name={priorityMeta.icon} size={13} style={{ color: priorityMeta.color }} />
          {priorityMeta.label} priority — approvers will be notified
        </div>
      )}
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '28px', flexWrap: 'wrap' }}>
        <button
          onClick={onAnother}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '11px 22px', borderRadius: '12px', border: `1px solid ${THEME.outline}`,
            background: THEME.surface, color: THEME.text,
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Icon name="add" size={16} /> New Request
        </button>
        <button
          onClick={() => setPage('fuel_requests_list')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            padding: '11px 22px', borderRadius: '12px', border: 'none',
            background: FUEL_CLR, color: '#fff',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          <Icon name="list" size={16} /> View All Requests
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const EMPTY = {
  asset_type:         'vehicle',
  vehicle_id:         null,
  equipment_id:       null,
  fuel_type_id:       null,
  quantity_requested: '',
  intended_use:       '',
  priority:           'normal',
  notes:              '',
}

export default function FuelRequestForm({ setPage }) {
  const { can }                          = usePermissions()
  const { currentSiteId }                = useSite()
  const { profile }                      = useAuth()
  const rt = useRealtimeRefresh('fuel_requests', { column: 'site_id', value: currentSiteId })
  const { vehicles, equipment, fuelTypes, loading: fuelLoading } = useFuel()

  const [form,       setForm]       = useState(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [done,       setDone]       = useState(null)   // { requestNumber, priority }
  const [settings,   setSettings]   = useState(null)

  // Load fuel settings for request number prefix
  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('fuel_settings')
      .select('docket_prefix, docket_padding')
      .eq('site_id', currentSiteId)
      .maybeSingle()
      .then(({ data }) => setSettings(data))
  }, [currentSiteId, rt])

  if (!can('fuel.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p style={{ fontSize: '14px' }}>You do not have access to Fuel.</p>
    </div>
  )

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })) }

  // Derive fuel type from selected vehicle/equipment
  const selectedAsset = useMemo(() => {
    if (form.asset_type === 'vehicle'   && form.vehicle_id)   return vehicles.find(v => v.id === form.vehicle_id)
    if (form.asset_type === 'equipment' && form.equipment_id) return equipment.find(e => e.id === form.equipment_id)
    return null
  }, [form.asset_type, form.vehicle_id, form.equipment_id, vehicles, equipment])

  const derivedFuelTypeId = selectedAsset?.fuel_type_id ?? selectedAsset?.fuel_types?.id ?? null
  const derivedFuelType   = derivedFuelTypeId ? fuelTypes.find(f => f.id === derivedFuelTypeId) : null

  // Validation
  const errors = useMemo(() => {
    const e = {}
    if (form.asset_type === 'vehicle'   && !form.vehicle_id)   e.asset = 'Select a vehicle'
    if (form.asset_type === 'equipment' && !form.equipment_id) e.asset = 'Select equipment'
    if (!derivedFuelTypeId) e.fuel_type = 'Asset fuel type not set — contact admin'
    const qty = Number(form.quantity_requested)
    if (!form.quantity_requested || isNaN(qty) || qty <= 0) e.qty = 'Enter a quantity greater than 0'
    if (!form.intended_use.trim()) e.intended_use = 'Briefly describe the intended use'
    return e
  }, [form, derivedFuelTypeId])

  const isValid = Object.keys(errors).length === 0

  async function submit() {
    if (!isValid || submitting || !currentSiteId) return
    setSubmitting(true)
    try {
      // Generate next request number
      const prefix  = settings ? settings.docket_prefix.replace(/^FD-/, 'FR-') : 'FR-'
      const padding = settings?.docket_padding ?? 4

      const { count } = await supabase
        .from('fuel_requests')
        .select('id', { count: 'exact', head: true })
        .eq('site_id', currentSiteId)

      const seq    = (count ?? 0) + 1
      const reqNum = `${prefix}${String(seq).padStart(padding, '0')}`

      const payload = {
        site_id:            currentSiteId,
        request_number:     reqNum,
        requested_by:       profile.id,
        created_by:         profile.id,
        // Pickers are backed by fleet_assets — write the bridge column, not
        // the legacy FKs (those point at fuel_vehicles/fuel_equipment and
        // reject assets created after the fleet migration).
        fleet_asset_id:     form.asset_type === 'vehicle' ? form.vehicle_id
                          : form.asset_type === 'equipment' ? form.equipment_id
                          : null,
        fuel_type_id:       derivedFuelTypeId,
        quantity_requested: Number(form.quantity_requested),
        intended_use:       form.intended_use.trim(),
        priority:           form.priority,
        notes:              form.notes.trim() || null,
        status:             'pending',
      }

      const { error } = await supabase.from('fuel_requests').insert([payload])
      if (error) throw error

      setDone({ requestNumber: reqNum, priority: form.priority })
    } catch (err) {
      showToast(err.message || 'Failed to submit request', 'red')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) return (
    <SuccessScreen
      requestNumber={done.requestNumber}
      priority={done.priority}
      onAnother={() => { setDone(null); setForm(EMPTY) }}
      setPage={setPage}
    />
  )

  const activeVehicles  = vehicles.filter(v => !v.is_archived)
  const activeEquipment = equipment.filter(e => !e.is_archived)

  return (
    <div style={{ maxWidth: '860px' }}>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '22px', fontWeight: 300, color: THEME.text, marginBottom: '4px' }}>Fuel Request</div>
        <div style={{ fontSize: '13px', color: THEME.textMed }}>Submit a request for fuel — an approver will review before fuel is issued.</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '20px', alignItems: 'start' }}>

        {/* ── Left: form ── */}
        <div>

          {/* Asset type toggle */}
          <div style={{
            background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
            borderRadius: '10px', padding: '20px 24px', marginBottom: '16px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="local_gas_station" size={15} style={{ color: FUEL_CLR }} />
              Asset & Fuel
            </div>

            {/* Vehicle / Equipment toggle */}
            <FieldWrap label="Asset Type" required>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                {['vehicle', 'equipment'].map(t => (
                  <button
                    key={t}
                    onClick={() => { set('asset_type', t); set('vehicle_id', null); set('equipment_id', null) }}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: '10px', border: `1px solid`,
                      borderColor: form.asset_type === t ? FUEL_CLR : THEME.outline,
                      background: form.asset_type === t ? FUEL_CLR + '18' : THEME.surface,
                      color: form.asset_type === t ? FUEL_CLR : THEME.textMed,
                      fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    }}
                  >
                    <Icon name={t === 'vehicle' ? 'directions_car' : 'construction'} size={15} style={{ color: 'inherit' }} />
                    {t === 'vehicle' ? 'Vehicle' : 'Equipment'}
                  </button>
                ))}
              </div>
            </FieldWrap>

            {form.asset_type === 'vehicle' ? (
              <FieldWrap label="Vehicle" required hint="Only active vehicles are shown">
                <SearchSelect
                  items={activeVehicles}
                  value={form.vehicle_id}
                  onSelect={v => set('vehicle_id', v)}
                  placeholder="Search by fleet number or description…"
                  renderItem={v => `${v.fleet_number} — ${v.description || v.make || ''} ${v.model || ''}`.trim()}
                  renderSelected={v => `${v.fleet_number} — ${v.description || v.make || ''} ${v.model || ''}`.trim()}
                />
                {errors.asset && <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px' }}>{errors.asset}</div>}
              </FieldWrap>
            ) : (
              <FieldWrap label="Equipment" required hint="Only active equipment is shown">
                <SearchSelect
                  items={activeEquipment}
                  value={form.equipment_id}
                  onSelect={e => set('equipment_id', e)}
                  placeholder="Search by unit number or description…"
                  renderItem={e => `${e.unit_number || e.name} — ${e.description || e.make || ''}`.trim()}
                  renderSelected={e => `${e.unit_number || e.name} — ${e.description || e.make || ''}`.trim()}
                />
                {errors.asset && <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px' }}>{errors.asset}</div>}
              </FieldWrap>
            )}

            {/* Fuel type — derived, read-only */}
            {selectedAsset && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 14px', borderRadius: '10px',
                background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
              }}>
                <Icon name="oil_barrel" size={15} style={{ color: THEME.textLow }} />
                <span style={{ fontSize: '12px', color: THEME.textMed }}>Fuel Type:</span>
                {derivedFuelType
                  ? <span style={{ fontSize: '13px', fontWeight: 600, color: FUEL_CLR }}>{derivedFuelType.name}</span>
                  : <span style={{ fontSize: '12px', color: THEME.error }}>Not configured — contact admin</span>
                }
              </div>
            )}
          </div>

          {/* Quantity & use */}
          <div style={{
            background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
            borderRadius: '10px', padding: '20px 24px', marginBottom: '16px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="water_drop" size={15} style={{ color: FUEL_CLR }} />
              Quantity & Purpose
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '14px' }}>
              <FieldWrap label="Quantity (L)" required>
                <input
                  type="number" min={0.001} step={0.001}
                  value={form.quantity_requested}
                  onChange={e => set('quantity_requested', e.target.value)}
                  placeholder="0.000"
                  style={inpStyle()}
                />
                {errors.qty && <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px' }}>{errors.qty}</div>}
              </FieldWrap>

              <FieldWrap label="Intended Use" required hint="e.g. Site inspection, underground haulage, generator">
                <input
                  type="text"
                  value={form.intended_use}
                  onChange={e => set('intended_use', e.target.value)}
                  placeholder="Brief description of intended use"
                  maxLength={200}
                  style={inpStyle()}
                />
                {errors.intended_use && <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px' }}>{errors.intended_use}</div>}
              </FieldWrap>
            </div>

            <FieldWrap label="Notes" hint="Optional — any additional context for the approver">
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Additional notes…"
                maxLength={500}
                rows={2}
                style={{ ...inpStyle(), resize: 'vertical', minHeight: '60px' }}
              />
            </FieldWrap>
          </div>

          {/* Priority */}
          <div style={{
            background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
            borderRadius: '10px', padding: '20px 24px', marginBottom: '24px',
          }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="priority_high" size={15} style={{ color: THEME.warning }} />
              Priority
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              {PRIORITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => set('priority', opt.value)}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: '12px',
                    border: `1px solid ${form.priority === opt.value ? opt.color : THEME.outline}`,
                    background: form.priority === opt.value ? opt.color + '18' : THEME.surface,
                    color: form.priority === opt.value ? opt.color : THEME.textMed,
                    fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                  }}
                >
                  <Icon name={opt.icon} size={15} style={{ color: 'inherit' }} />
                  {opt.label}
                </button>
              ))}
            </div>
            {form.priority === 'emergency' && (
              <div style={{ marginTop: '10px' }}>
                <InfoPanel icon="emergency_home" color={THEME.error}>
                  Emergency requests are escalated immediately. Use only for production-critical situations.
                </InfoPanel>
              </div>
            )}
            {form.priority === 'urgent' && (
              <div style={{ marginTop: '10px' }}>
                <InfoPanel icon="warning" color={THEME.warning}>
                  Urgent requests flag the approver dashboard for same-day action.
                </InfoPanel>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            onClick={submit}
            disabled={!isValid || submitting}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '13px 32px', borderRadius: '14px', border: 'none',
              background: !isValid || submitting ? THEME.outline : FUEL_CLR,
              color: '#fff', fontSize: '14px', fontWeight: 700,
              cursor: !isValid || submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {submitting
              ? <><Icon name="progress_activity" size={16} style={{ color: '#fff', animation: 'spin 1s linear infinite' }} /> Submitting…</>
              : <><Icon name="send" size={16} style={{ color: '#fff' }} /> Submit Request</>
            }
          </button>
        </div>

        {/* ── Right: summary panel ── */}
        <div style={{
          position: 'sticky', top: '24px',
          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
          borderRadius: '10px', padding: '20px',
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '16px' }}>
            Request Summary
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { label: 'Asset', value: selectedAsset
                  ? (form.asset_type === 'vehicle'
                      ? `${selectedAsset.fleet_number}`
                      : `${selectedAsset.unit_number || selectedAsset.name}`)
                  : null
              },
              { label: 'Fuel Type', value: derivedFuelType?.name },
              { label: 'Quantity', value: form.quantity_requested ? `${Number(form.quantity_requested).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} L` : null },
              { label: 'Intended Use', value: form.intended_use.trim() || null },
              { label: 'Priority', value: form.priority.charAt(0).toUpperCase() + form.priority.slice(1) },
            ].map(({ label, value }) => (
              <div key={label}>
                <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: '13px', color: value ? THEME.text : THEME.textLow, fontStyle: value ? 'normal' : 'italic' }}>
                  {value || '—'}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: '20px', padding: '12px', borderRadius: '10px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}` }}>
            <div style={{ fontSize: '11px', color: THEME.textLow, lineHeight: 1.6 }}>
              <Icon name="info" size={13} style={{ color: THEME.textLow, verticalAlign: 'middle', marginRight: '4px' }} />
              Requests are reviewed by an approver before fuel is issued. You will be notified when the status changes.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
