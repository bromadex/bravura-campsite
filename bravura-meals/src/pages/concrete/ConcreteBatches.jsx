import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const CO_CLR = '#EF6C00'

const STATUS_META = {
  mixing:     { label: 'Mixing',     bg: '#E3F2FD', color: '#1565C0', icon: 'blender' },
  dispatched: { label: 'Dispatched', bg: '#FFF3E0', color: '#E65100', icon: 'local_shipping' },
  delivered:  { label: 'Delivered',  bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  cancelled:  { label: 'Cancelled',  bg: '#FFEBEE', color: '#E53935', icon: 'cancel' },
}

const STATUS_TABS = ['all', 'mixing', 'dispatched', 'delivered', 'cancelled']

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}

const selectStyle = {
  ...inputStyle, cursor: 'pointer',
}

// ── Status badge ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, bg: THEME.surfaceVar, color: THEME.textMed, icon: 'help' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: m.bg, color: m.color,
    }}>
      <Icon name={m.icon} size={11} style={{ color: 'inherit' }} />
      {m.label}
    </span>
  )
}

// ── Variance helper ─────────────────────────────────────────────────────────

function varianceColor(theoretical, actual) {
  if (actual == null || theoretical == null || theoretical === 0) return null
  const pct = Math.abs((actual - theoretical) / theoretical) * 100
  if (pct <= 5) return '#2E7D32'
  if (pct <= 10) return '#E65100'
  return '#E53935'
}

function VarianceCell({ theoretical, actual, unit }) {
  if (actual == null) return <span style={{ color: THEME.textLow }}>--</span>
  const diff = actual - theoretical
  const clr = varianceColor(theoretical, actual)
  return (
    <span style={{ color: clr, fontWeight: 500, fontSize: '13px' }}>
      {Number(actual).toFixed(1)} {unit}
      {theoretical > 0 && (
        <span style={{ fontSize: '11px', marginLeft: '6px', opacity: 0.8 }}>
          ({diff >= 0 ? '+' : ''}{diff.toFixed(1)})
        </span>
      )}
    </span>
  )
}

// ── Field wrapper ───────────────────────────────────────────────────────────

function Field({ label, children, required }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}{required && <span style={{ color: THEME.error }}> *</span>}
      </div>
      {children}
    </div>
  )
}

// ── Batch number generator ──────────────────────────────────────────────────

function generateBatchNumber(existingBatches) {
  const today = new Date()
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, '')
  const prefix = `BP-${ymd}-`
  const todayBatches = existingBatches
    .filter(b => b.batch_number?.startsWith(prefix))
    .map(b => parseInt(b.batch_number.slice(prefix.length), 10))
    .filter(n => !isNaN(n))
  const next = todayBatches.length > 0 ? Math.max(...todayBatches) + 1 : 1
  return prefix + String(next).padStart(3, '0')
}

// ── Create/Edit Modal ───────────────────────────────────────────────────────

function BatchModal({ batch, mixDesigns, fleetAssets, drivers, allBatches, siteId, userId, onClose, onSaved }) {
  const isEdit = !!batch

  const [form, setForm] = useState(() => {
    if (batch) return {
      mix_design_id: batch.mix_design_id || '',
      grade: batch.grade || '',
      quantity_m3: batch.quantity_m3 != null ? String(batch.quantity_m3) : '',
      fleet_asset_id: batch.fleet_asset_id || '',
      driver_id: batch.driver_id || '',
      delivery_location: batch.delivery_location || '',
      customer_notes: batch.customer_notes || '',
      actual_cement_kg: batch.actual_cement_kg != null ? String(batch.actual_cement_kg) : '',
      actual_water_litres: batch.actual_water_litres != null ? String(batch.actual_water_litres) : '',
      status: batch.status || 'mixing',
    }
    return {
      mix_design_id: '', grade: '', quantity_m3: '',
      fleet_asset_id: '', driver_id: '',
      delivery_location: '', customer_notes: '',
      actual_cement_kg: '', actual_water_litres: '',
      status: 'mixing',
    }
  })

  const [aggregateActuals, setAggregateActuals] = useState({})
  const [saving, setSaving] = useState(false)
  const [loadingAggs, setLoadingAggs] = useState(false)
  const [batchAggregates, setBatchAggregates] = useState([])
  const [mixDesignAggregates, setMixDesignAggregates] = useState([])
  const [aggregateTypes, setAggregateTypes] = useState([])

  const selectedDesign = useMemo(
    () => mixDesigns.find(d => d.id === form.mix_design_id),
    [mixDesigns, form.mix_design_id]
  )

  const qty = parseFloat(form.quantity_m3) || 0

  const theoreticalCement = selectedDesign ? selectedDesign.cement_kg_per_m3 * qty : 0
  const theoreticalWater = selectedDesign ? selectedDesign.water_litres_per_m3 * qty : 0

  // Load mix design aggregates when design changes (for create mode)
  useEffect(() => {
    if (!form.mix_design_id) { setMixDesignAggregates([]); return }
    ;(async () => {
      const { data } = await supabase
        .from('mix_design_aggregates')
        .select('id, aggregate_type_id, quantity_kg_per_m3')
        .eq('mix_design_id', form.mix_design_id)
      setMixDesignAggregates(data || [])
    })()
  }, [form.mix_design_id])

  // Load aggregate types
  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('aggregate_types').select('id, name').eq('site_id', siteId)
      setAggregateTypes(data || [])
    })()
  }, [siteId])

  // Load existing batch aggregates when editing
  useEffect(() => {
    if (!batch) return
    setLoadingAggs(true)
    ;(async () => {
      const { data } = await supabase
        .from('batch_aggregates')
        .select('id, aggregate_type_id, theoretical_qty_kg, actual_qty_kg')
        .eq('batch_id', batch.id)
      setBatchAggregates(data || [])
      const actuals = {}
      ;(data || []).forEach(a => {
        if (a.actual_qty_kg != null) actuals[a.aggregate_type_id] = String(a.actual_qty_kg)
      })
      setAggregateActuals(actuals)
      setLoadingAggs(false)
    })()
  }, [batch])

  // Aggregates to display (theoretical calculations)
  const aggregateRows = useMemo(() => {
    if (isEdit && batchAggregates.length > 0) {
      return batchAggregates.map(a => {
        const aggType = aggregateTypes.find(t => t.id === a.aggregate_type_id)
        return { ...a, name: aggType?.name || 'Unknown', theoretical: Number(a.theoretical_qty_kg) }
      })
    }
    return mixDesignAggregates.map(mda => {
      const aggType = aggregateTypes.find(t => t.id === mda.aggregate_type_id)
      return {
        aggregate_type_id: mda.aggregate_type_id,
        name: aggType?.name || 'Unknown',
        theoretical: mda.quantity_kg_per_m3 * qty,
      }
    })
  }, [isEdit, batchAggregates, mixDesignAggregates, aggregateTypes, qty])

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  function onDesignChange(designId) {
    const design = mixDesigns.find(d => d.id === designId)
    set('mix_design_id', designId)
    if (design) set('grade', design.grade)
  }

  async function handleSave() {
    if (!form.mix_design_id || !form.quantity_m3 || !form.grade) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const { error } = await supabase
          .from('concrete_batches')
          .update({
            mix_design_id: form.mix_design_id,
            grade: form.grade,
            quantity_m3: parseFloat(form.quantity_m3),
            fleet_asset_id: form.fleet_asset_id || null,
            driver_id: form.driver_id || null,
            delivery_location: form.delivery_location || null,
            customer_notes: form.customer_notes || null,
            actual_cement_kg: form.actual_cement_kg ? parseFloat(form.actual_cement_kg) : null,
            actual_water_litres: form.actual_water_litres ? parseFloat(form.actual_water_litres) : null,
            status: form.status,
            dispatch_time: form.status === 'dispatched' && !batch.dispatch_time ? new Date().toISOString() : batch.dispatch_time,
            return_time: form.status === 'delivered' && !batch.return_time ? new Date().toISOString() : batch.return_time,
          })
          .eq('id', batch.id)
          .eq('site_id', siteId)
        if (error) throw error

        // Update aggregate actuals
        for (const agg of batchAggregates) {
          const actualVal = aggregateActuals[agg.aggregate_type_id]
          if (actualVal !== undefined) {
            await supabase
              .from('batch_aggregates')
              .update({ actual_qty_kg: actualVal ? parseFloat(actualVal) : null })
              .eq('id', agg.id)
          }
        }

        showToast('Batch updated')
      } else {
        const batchNumber = generateBatchNumber(allBatches)
        const { data: newBatch, error } = await supabase
          .from('concrete_batches')
          .insert({
            site_id: siteId,
            batch_number: batchNumber,
            mix_design_id: form.mix_design_id,
            grade: form.grade,
            quantity_m3: parseFloat(form.quantity_m3),
            fleet_asset_id: form.fleet_asset_id || null,
            driver_id: form.driver_id || null,
            delivery_location: form.delivery_location || null,
            customer_notes: form.customer_notes || null,
            status: 'mixing',
            created_by: userId,
          })
          .select('id')
          .single()
        if (error) throw error

        // Insert batch aggregates
        if (mixDesignAggregates.length > 0) {
          const aggRows = mixDesignAggregates.map(mda => ({
            batch_id: newBatch.id,
            aggregate_type_id: mda.aggregate_type_id,
            theoretical_qty_kg: mda.quantity_kg_per_m3 * qty,
          }))
          const { error: aggErr } = await supabase.from('batch_aggregates').insert(aggRows)
          if (aggErr) throw aggErr
        }

        showToast(`Batch ${batchNumber} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Status transition options
  const statusOptions = isEdit ? (() => {
    const current = batch.status
    if (current === 'mixing') return ['mixing', 'dispatched', 'cancelled']
    if (current === 'dispatched') return ['dispatched', 'delivered', 'cancelled']
    return [current]
  })() : ['mixing']

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit Batch ${batch.batch_number}` : 'New Concrete Batch'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Mix design */}
          <Field label="Mix Design" required>
            <select
              style={selectStyle}
              value={form.mix_design_id}
              onChange={e => onDesignChange(e.target.value)}
              disabled={isEdit}
            >
              <option value="">Select mix design...</option>
              {mixDesigns.filter(d => d.is_active).map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.grade})</option>
              ))}
            </select>
          </Field>

          {/* Grade (auto-filled) */}
          <Field label="Grade" required>
            <input style={{ ...inputStyle, background: THEME.surfaceVar }} value={form.grade} readOnly />
          </Field>

          {/* Quantity */}
          <Field label="Quantity (m³)" required>
            <input
              style={inputStyle} type="number" step="0.1" min="0"
              value={form.quantity_m3}
              onChange={e => set('quantity_m3', e.target.value)}
            />
          </Field>

          {/* Theoretical materials preview */}
          {selectedDesign && qty > 0 && (
            <div style={{
              background: THEME.surfaceVar, borderRadius: '10px', padding: '14px',
              border: `1px solid ${THEME.outlineVar}`,
            }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', marginBottom: '8px' }}>
                Theoretical Materials
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
                <div>
                  <span style={{ color: THEME.textMed }}>Cement: </span>
                  <span style={{ fontWeight: 600, color: THEME.text }}>{theoreticalCement.toFixed(1)} kg</span>
                </div>
                <div>
                  <span style={{ color: THEME.textMed }}>Water: </span>
                  <span style={{ fontWeight: 600, color: THEME.text }}>{theoreticalWater.toFixed(1)} L</span>
                </div>
                {aggregateRows.map(a => (
                  <div key={a.aggregate_type_id}>
                    <span style={{ color: THEME.textMed }}>{a.name}: </span>
                    <span style={{ fontWeight: 600, color: THEME.text }}>{a.theoretical.toFixed(1)} kg</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actuals (edit mode) */}
          {isEdit && (
            <>
              <SectionLabel>Actual Materials</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Field label="Actual Cement (kg)">
                  <input style={inputStyle} type="number" step="0.1"
                    value={form.actual_cement_kg}
                    onChange={e => set('actual_cement_kg', e.target.value)}
                  />
                  {form.actual_cement_kg && (
                    <div style={{ marginTop: '2px' }}>
                      <VarianceCell theoretical={theoreticalCement} actual={parseFloat(form.actual_cement_kg)} unit="kg" />
                    </div>
                  )}
                </Field>
                <Field label="Actual Water (L)">
                  <input style={inputStyle} type="number" step="0.1"
                    value={form.actual_water_litres}
                    onChange={e => set('actual_water_litres', e.target.value)}
                  />
                  {form.actual_water_litres && (
                    <div style={{ marginTop: '2px' }}>
                      <VarianceCell theoretical={theoreticalWater} actual={parseFloat(form.actual_water_litres)} unit="L" />
                    </div>
                  )}
                </Field>
              </div>

              {!loadingAggs && aggregateRows.map(a => (
                <Field key={a.aggregate_type_id} label={`Actual ${a.name} (kg)`}>
                  <input style={inputStyle} type="number" step="0.1"
                    value={aggregateActuals[a.aggregate_type_id] || ''}
                    onChange={e => setAggregateActuals(prev => ({ ...prev, [a.aggregate_type_id]: e.target.value }))}
                  />
                  {aggregateActuals[a.aggregate_type_id] && (
                    <div style={{ marginTop: '2px' }}>
                      <VarianceCell theoretical={a.theoretical} actual={parseFloat(aggregateActuals[a.aggregate_type_id])} unit="kg" />
                    </div>
                  )}
                </Field>
              ))}
            </>
          )}

          <SectionLabel>Dispatch Details</SectionLabel>

          {/* Fleet asset */}
          <Field label="Mixer Truck">
            <select style={selectStyle} value={form.fleet_asset_id} onChange={e => set('fleet_asset_id', e.target.value)}>
              <option value="">None</option>
              {fleetAssets.map(a => (
                <option key={a.id} value={a.id}>
                  {a.fleet_number || a.asset_number}{a.registration ? ` (${a.registration})` : ''}
                </option>
              ))}
            </select>
          </Field>

          {/* Driver */}
          <Field label="Driver">
            <select style={selectStyle} value={form.driver_id} onChange={e => set('driver_id', e.target.value)}>
              <option value="">None</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>{d.full_name}</option>
              ))}
            </select>
          </Field>

          {/* Delivery location */}
          <Field label="Delivery Location">
            <input style={inputStyle} value={form.delivery_location} onChange={e => set('delivery_location', e.target.value)} placeholder="e.g. Block A Foundation" />
          </Field>

          {/* Customer notes */}
          <Field label="Customer Notes">
            <textarea
              style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
              value={form.customer_notes}
              onChange={e => set('customer_notes', e.target.value)}
            />
          </Field>

          {/* Status (edit only) */}
          {isEdit && (
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {statusOptions.map(s => (
                  <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                ))}
              </select>
            </Field>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update Batch' : 'Create Batch'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Detail side panel ───────────────────────────────────────────────────────

function DetailPanel({ batch, mixDesigns, fleetAssets, drivers, siteId, canEdit, onClose, onEdit }) {
  if (!batch) return null

  const [aggregates, setAggregates] = useState([])
  const [aggregateTypes, setAggregateTypes] = useState([])

  useEffect(() => {
    ;(async () => {
      const [{ data: aggs }, { data: types }] = await Promise.all([
        supabase.from('batch_aggregates').select('*').eq('batch_id', batch.id),
        supabase.from('aggregate_types').select('id, name').eq('site_id', siteId),
      ])
      setAggregates(aggs || [])
      setAggregateTypes(types || [])
    })()
  }, [batch.id, siteId])

  const design = mixDesigns.find(d => d.id === batch.mix_design_id)
  const asset = fleetAssets.find(a => a.id === batch.fleet_asset_id)
  const driver = drivers.find(d => d.id === batch.driver_id)
  const qty = Number(batch.quantity_m3) || 0
  const theoreticalCement = design ? design.cement_kg_per_m3 * qty : 0
  const theoreticalWater = design ? design.water_litres_per_m3 * qty : 0

  const rows = [
    ['Batch #', batch.batch_number, true],
    ['Grade', batch.grade],
    ['Quantity', `${qty} m³`],
    ['Mix Design', design?.name || '--'],
    ['Status', null],
    asset && ['Mixer Truck', `${asset.fleet_number || asset.asset_number}${asset.registration ? ' (' + asset.registration + ')' : ''}`],
    driver && ['Driver', driver.full_name],
    batch.delivery_location && ['Location', batch.delivery_location],
    batch.dispatch_time && ['Dispatched', new Date(batch.dispatch_time).toLocaleString()],
    batch.return_time && ['Returned', new Date(batch.return_time).toLocaleString()],
    batch.customer_notes && ['Notes', batch.customer_notes],
  ].filter(Boolean)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', justifyContent: 'flex-end',
    }} onClick={onClose}>
      <div
        style={{
          width: '400px', height: '100vh', background: THEME.surface,
          borderLeft: `1px solid ${THEME.outlineVar}`, overflowY: 'auto',
          padding: '24px', boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Batch Detail</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px', fontFamily: 'monospace' }}>{batch.batch_number}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ marginBottom: '16px' }}><StatusBadge status={batch.status} /></div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
          {rows.map(([k, v, mono]) => (
            k === 'Status' ? null :
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px', gap: '12px' }}>
              <span style={{ color: THEME.textMed, flexShrink: 0 }}>{k}</span>
              <span style={{ fontWeight: 500, color: THEME.text, textAlign: 'right', fontFamily: mono ? 'monospace' : 'inherit', wordBreak: 'break-all' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Materials section */}
        <div style={{ marginTop: '20px' }}>
          <SectionLabel>Materials (Theoretical vs Actual)</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px' }}>
              <span style={{ color: THEME.textMed }}>Cement</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: THEME.textLow, fontSize: '11px' }}>Theo: {theoreticalCement.toFixed(1)} kg</div>
                <VarianceCell theoretical={theoreticalCement} actual={batch.actual_cement_kg != null ? Number(batch.actual_cement_kg) : null} unit="kg" />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px' }}>
              <span style={{ color: THEME.textMed }}>Water</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: THEME.textLow, fontSize: '11px' }}>Theo: {theoreticalWater.toFixed(1)} L</div>
                <VarianceCell theoretical={theoreticalWater} actual={batch.actual_water_litres != null ? Number(batch.actual_water_litres) : null} unit="L" />
              </div>
            </div>
            {aggregates.map(a => {
              const aggType = aggregateTypes.find(t => t.id === a.aggregate_type_id)
              return (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px' }}>
                  <span style={{ color: THEME.textMed }}>{aggType?.name || 'Aggregate'}</span>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: THEME.textLow, fontSize: '11px' }}>Theo: {Number(a.theoretical_qty_kg).toFixed(1)} kg</div>
                    <VarianceCell theoretical={Number(a.theoretical_qty_kg)} actual={a.actual_qty_kg != null ? Number(a.actual_qty_kg) : null} unit="kg" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {canEdit && batch.status !== 'cancelled' && batch.status !== 'delivered' && (
          <button onClick={() => onEdit(batch)} style={{
            marginTop: '20px', width: '100%', padding: '10px', borderRadius: '10px',
            background: CO_CLR, color: '#fff', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '13px', fontWeight: 600,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}>
            <Icon name="edit" size={15} style={{ color: '#fff' }} /> Edit Batch
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function ConcreteBatches({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editBatch, setEditBatch] = useState(null)
  const [detailBatch, setDetailBatch] = useState(null)

  // Reference data
  const [mixDesigns, setMixDesigns] = useState([])
  const [fleetAssets, setFleetAssets] = useState([])
  const [drivers, setDrivers] = useState([])

  const canView = can('concrete.view')
  const canCreate = can('concrete.create')
  const canEdit = can('concrete.edit')

  // Fetch batches
  async function fetchBatches() {
    if (!currentSiteId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('concrete_batches')
        .select('*')
        .eq('site_id', currentSiteId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
      if (err) throw err
      setBatches(data || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Fetch reference data
  async function fetchRefData() {
    if (!currentSiteId) return
    const [designs, assets, profiles] = await Promise.all([
      supabase.from('mix_designs').select('*').eq('site_id', currentSiteId).eq('is_active', true),
      supabase.from('fleet_assets').select('id, fleet_number, asset_number, registration, serial_number').eq('site_id', currentSiteId).eq('status', 'operational'),
      supabase.from('profiles').select('id, full_name'),
    ])
    setMixDesigns(designs.data || [])
    setFleetAssets(assets.data || [])
    setDrivers(profiles.data || [])
  }

  useEffect(() => { fetchBatches(); fetchRefData() }, [currentSiteId])

  // Filtered batches
  const filtered = useMemo(() => {
    let list = batches
    if (statusFilter !== 'all') list = list.filter(b => b.status === statusFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(b =>
        b.batch_number?.toLowerCase().includes(q) ||
        b.grade?.toLowerCase().includes(q) ||
        b.delivery_location?.toLowerCase().includes(q)
      )
    }
    return list
  }, [batches, statusFilter, search])

  // Status counts
  const counts = useMemo(() => {
    const c = { all: batches.length, mixing: 0, dispatched: 0, delivered: 0, cancelled: 0 }
    batches.forEach(b => { if (c[b.status] !== undefined) c[b.status]++ })
    return c
  }, [batches])

  // CSV export
  function handleExport() {
    const headers = ['Batch #', 'Grade', 'Quantity (m³)', 'Status', 'Delivery Location', 'Dispatch Time', 'Return Time', 'Created']
    const rows = filtered.map(b => [
      b.batch_number, b.grade, b.quantity_m3, b.status,
      b.delivery_location || '', b.dispatch_time || '', b.return_time || '',
      b.created_at ? new Date(b.created_at).toLocaleDateString() : '',
    ])
    exportCsv(`concrete-batches-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  // Archive
  async function handleArchive(batch) {
    if (!confirm(`Archive batch ${batch.batch_number}?`)) return
    const { error: err } = await supabase
      .from('concrete_batches')
      .update({ is_archived: true })
      .eq('id', batch.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Batch archived')
    fetchBatches()
  }

  function onSaved() {
    setShowCreate(false)
    setEditBatch(null)
    fetchBatches()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_batches" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view concrete batches.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_batches" />

      <PageHeader
        title="Concrete Batches"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && (
              <Button onClick={() => setShowCreate(true)} icon="add">New Batch</Button>
            )}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {STATUS_TABS.map(tab => {
          const active = statusFilter === tab
          const meta = STATUS_META[tab]
          return (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
                background: active ? (meta?.color || CO_CLR) : THEME.surfaceVar,
                color: active ? '#fff' : THEME.textMed,
                transition: 'all .15s',
              }}
            >
              {tab === 'all' ? 'All' : meta?.label || tab} ({counts[tab] || 0})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px', maxWidth: '320px' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            style={{ ...inputStyle, paddingLeft: '32px' }}
            placeholder="Search batches..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Content */}
      {error && (
        <Card style={{ padding: '20px', borderColor: THEME.error }}>
          <div style={{ color: THEME.error, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="error" size={18} style={{ color: THEME.error }} />
            {error}
          </div>
        </Card>
      )}

      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading batches...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="factory" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {batches.length === 0 ? 'No batches yet. Create your first concrete batch.' : 'No batches match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Batch #', 'Grade', 'Qty (m³)', 'Status', 'Mixer', 'Location', 'Date', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const asset = fleetAssets.find(a => a.id === b.fleet_asset_id)
                  return (
                    <tr
                      key={b.id}
                      style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                      onClick={() => setDetailBatch(b)}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{b.batch_number}</td>
                      <td style={{ padding: '10px 12px', color: THEME.text }}>{b.grade}</td>
                      <td style={{ padding: '10px 12px', color: THEME.text, fontWeight: 500 }}>{Number(b.quantity_m3).toFixed(1)}</td>
                      <td style={{ padding: '10px 12px' }}><StatusBadge status={b.status} /></td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>
                        {asset ? (asset.fleet_number || asset.asset_number) : '--'}
                      </td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {b.delivery_location || '--'}
                      </td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>
                        {b.created_at ? new Date(b.created_at).toLocaleDateString() : '--'}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {canEdit && b.status !== 'cancelled' && b.status !== 'delivered' && (
                            <button
                              onClick={e => { e.stopPropagation(); setEditBatch(b) }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                              title="Edit"
                            >
                              <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={e => { e.stopPropagation(); handleArchive(b) }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
                              title="Archive"
                            >
                              <Icon name="archive" size={16} style={{ color: THEME.textLow }} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Modals */}
      {(showCreate || editBatch) && (
        <BatchModal
          batch={editBatch}
          mixDesigns={mixDesigns}
          fleetAssets={fleetAssets}
          drivers={drivers}
          allBatches={batches}
          siteId={currentSiteId}
          userId={user?.id}
          onClose={() => { setShowCreate(false); setEditBatch(null) }}
          onSaved={onSaved}
        />
      )}

      {detailBatch && !editBatch && (
        <DetailPanel
          batch={detailBatch}
          mixDesigns={mixDesigns}
          fleetAssets={fleetAssets}
          drivers={drivers}
          siteId={currentSiteId}
          canEdit={canEdit}
          onClose={() => setDetailBatch(null)}
          onEdit={b => { setDetailBatch(null); setEditBatch(b) }}
        />
      )}
    </div>
  )
}
