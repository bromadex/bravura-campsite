import { useState, useMemo, useEffect } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Icon, SectionLabel, showToast } from '../../components/ui'
import { supabase } from '../../supabaseClient'

const FUEL_CLR = MODULE_COLORS.fuel
const LOW_PCT  = 20

// ── Helpers ──────────────────────────────────────────────────────────────────

function inp(extra = {}) {
  return {
    width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
    borderRadius: '12px', fontSize: '14px', color: THEME.text,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
    background: THEME.surface, display: 'block',
    ...extra,
  }
}

function FieldWrap({ label, required, children, hint }) {
  return (
    <div style={{ marginBottom: '18px' }}>
      <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}{required && <span style={{ color: THEME.error, marginLeft: '3px' }}>*</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>{hint}</div>}
    </div>
  )
}

function InfoPanel({ icon, color, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '10px 14px', borderRadius: '10px', background: color + '14', border: `1px solid ${color}33`, fontSize: '12px', color, marginBottom: '6px' }}>
      <Icon name={icon} size={15} style={{ color, flexShrink: 0, marginTop: '1px' }} />
      <div>{children}</div>
    </div>
  )
}

// Fuzzy search dropdown for vehicles / equipment
function SearchSelect({ items, value, onSelect, placeholder, renderItem, renderSelected, disabled }) {
  const [query, setQuery]   = useState('')
  const [open,  setOpen]    = useState(false)

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return items.slice(0, 40)
    return items.filter(i => renderItem(i).toLowerCase().includes(q)).slice(0, 40)
  }, [items, query])

  const selected = value ? items.find(i => i.id === value) : null

  function pick(item) { onSelect(item.id); setQuery(''); setOpen(false) }
  function clear(e) { e.stopPropagation(); onSelect(null); setQuery('') }

  return (
    <div style={{ position: 'relative' }}>
      {selected && !open ? (
        <div style={{
          ...inp(), display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer',
        }} onClick={() => { if (!disabled) setOpen(true) }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {renderSelected ? renderSelected(selected) : renderItem(selected)}
          </span>
          {!disabled && (
            <button type="button" onClick={clear} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0 8px', color: THEME.textLow }}>
              <Icon name="close" size={15} style={{ color: THEME.textLow }} />
            </button>
          )}
        </div>
      ) : (
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={open}
          style={inp({ opacity: disabled ? .5 : 1 })}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
      )}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: THEME.surface, border: `1px solid ${THEME.outline}`,
          borderRadius: '12px', boxShadow: THEME.shadow2, maxHeight: '220px', overflowY: 'auto', marginTop: '4px',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '12px 16px', fontSize: '13px', color: THEME.textLow }}>No results</div>
          ) : filtered.map(item => (
            <div key={item.id} onMouseDown={() => pick(item)} style={{
              padding: '10px 16px', fontSize: '13px', cursor: 'pointer', color: THEME.text,
              borderBottom: `1px solid ${THEME.outlineVar}`,
            }}
              onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceHover}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Printable docket ──────────────────────────────────────────────────────────

function PrintDocket({ result, siteName, tankName, pumpName, assetLabel, operatorName }) {
  const litres = Number(result.litres).toFixed(1)
  const now    = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const docketNo = result.docket_number || result.transaction_number

  return (
    <>
      {/* Print-only stylesheet injected into head via style tag */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #fuel-docket-print { display: block !important; }
        }
        #fuel-docket-print { display: none; }
        @media print {
          #fuel-docket-print {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: white; color: black; font-family: monospace;
            font-size: 12pt; padding: 20mm;
          }
        }
      `}</style>

      <div id="fuel-docket-print">
        <div style={{ borderBottom: '2px solid black', paddingBottom: '8px', marginBottom: '10px' }}>
          <div style={{ fontSize: '16pt', fontWeight: 'bold', textAlign: 'center' }}>FUEL ISSUANCE DOCKET</div>
          <div style={{ textAlign: 'center', marginTop: '4px' }}>{siteName || 'Bravura Zimbabwe'}</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '10px' }}>
          <tbody>
            {[
              ['Docket No', docketNo],
              ['Date', dateStr],
              ['Time', timeStr],
            ].map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: '3px 0', fontWeight: 'bold', width: '40%' }}>{k}:</td>
                <td style={{ padding: '3px 0' }}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ borderTop: '1px solid black', borderBottom: '1px solid black', padding: '8px 0', margin: '8px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['Tank',      tankName],
                ['Pump',      pumpName || '—'],
                ['Issued To', assetLabel || '—'],
                ['Operator',  operatorName || '—'],
              ].map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: '3px 0', fontWeight: 'bold', width: '40%' }}>{k}:</td>
                  <td style={{ padding: '3px 0' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(result.meter_reading_start != null || result.meter_reading_end != null) && (
          <div style={{ borderBottom: '1px solid black', padding: '8px 0', margin: '8px 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {result.meter_reading_start != null && (
                  <tr>
                    <td style={{ padding: '3px 0', fontWeight: 'bold', width: '40%' }}>Meter Start:</td>
                    <td style={{ padding: '3px 0' }}>{Number(result.meter_reading_start).toLocaleString(undefined, { minimumFractionDigits: 1 })} L</td>
                  </tr>
                )}
                {result.meter_reading_end != null && (
                  <tr>
                    <td style={{ padding: '3px 0', fontWeight: 'bold', width: '40%' }}>Meter End:</td>
                    <td style={{ padding: '3px 0' }}>{Number(result.meter_reading_end).toLocaleString(undefined, { minimumFractionDigits: 1 })} L</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ textAlign: 'center', padding: '10px 0', borderBottom: '2px solid black', marginBottom: '16px' }}>
          <div style={{ fontSize: '14pt', fontWeight: 'bold' }}>
            LITRES ISSUED: {Number(litres).toLocaleString(undefined, { minimumFractionDigits: 1 })} L
          </div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
          <tbody>
            {[
              'Authorised By',
              'Driver Signature',
            ].map(label => (
              <tr key={label}>
                <td style={{ padding: '20px 0 4px', fontWeight: 'bold', fontSize: '10pt' }}>{label}:</td>
                <td style={{ borderBottom: '1px solid black', padding: '20px 0 4px' }}></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: '20px', fontSize: '8pt', textAlign: 'center', color: '#666' }}>
          Ref: {result.transaction_number} · Printed {dateStr} {timeStr}
        </div>
      </div>
    </>
  )
}

// ── Success screen ────────────────────────────────────────────────────────────

function SuccessScreen({ result, onIssueAnother, onViewLedger, siteName, tankName, pumpName, assetLabel, operatorName }) {
  const litres = Number(result.litres).toFixed(1)
  return (
    <div style={{ maxWidth: '520px', margin: '0 auto', textAlign: 'center', padding: '60px 24px 40px' }}>
      <PrintDocket result={result} siteName={siteName} tankName={tankName} pumpName={pumpName} assetLabel={assetLabel} operatorName={operatorName} />

      <div style={{
        width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 20px',
        background: THEME.statusSuccessBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="check_circle" size={40} style={{ color: THEME.success }} />
      </div>
      <div style={{ fontSize: '24px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>Fuel Issued</div>
      <div style={{ fontSize: '15px', color: THEME.textMed, marginBottom: '28px' }}>
        {litres} L successfully recorded
      </div>
      <div style={{
        background: THEME.surface, borderRadius: '16px', border: `1px solid ${THEME.outlineVar}`,
        padding: '20px 24px', marginBottom: '28px', textAlign: 'left',
      }}>
        {[
          ['Transaction #', result.transaction_number],
          ['Docket',         result.docket_number || result.transaction_number],
          ['Quantity',       `${litres} L`],
          ['Date',           result.transaction_date],
        ].map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${THEME.outlineVar}`, fontSize: '13px' }}>
            <span style={{ color: THEME.textMed }}>{k}</span>
            <span style={{ fontWeight: 600, color: THEME.text, fontFamily: k === 'Transaction #' ? 'monospace' : 'inherit' }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
        <button onClick={() => window.print()} style={{
          padding: '10px 24px', borderRadius: '20px', border: `1px solid ${THEME.outline}`,
          background: 'transparent', color: THEME.textMed, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <Icon name="print" size={16} style={{ color: THEME.textMed }} />
          Print Docket
        </button>
        <button onClick={onViewLedger} style={{
          padding: '10px 24px', borderRadius: '20px', border: `1px solid ${THEME.outline}`,
          background: 'transparent', color: THEME.textMed, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>View Ledger</button>
        <button onClick={onIssueAnother} style={{
          padding: '10px 24px', borderRadius: '20px', border: 'none',
          background: FUEL_CLR, color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <Icon name="add" size={16} style={{ color: '#fff' }} />
          Issue Another
        </button>
      </div>
    </div>
  )
}

// ── Main form ─────────────────────────────────────────────────────────────────

const BLANK = {
  transaction_date: new Date().toISOString().slice(0, 10),
  tank_id:          '',
  pump_id:          '',
  asset_type:       'vehicle',
  vehicle_id:       '',
  equipment_id:     '',
  operator_id:      '',
  use_meter:        true,
  meter_start:      '',
  meter_end:        '',
  litres_manual:    '',
  docket_number:    '',
  notes:            '',
}

export default function FuelIssuance({ setPage }) {
  const { can }        = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const {
    tanks, pumps, vehicles, equipment, operators,
    transactions, addTransaction, updatePump,
  } = useFuel()

  const [form,       setFormState] = useState(BLANK)
  const [saving,     setSaving]    = useState(false)
  const [result,     setResult]    = useState(null)    // success screen
  const [resultMeta, setResultMeta] = useState(null)   // labels for docket

  if (!can('fuel.create')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have permission to issue fuel.</p>
    </div>
  )

  // ── Derived data ──────────────────────────────────────────────────────────

  const activeTanks     = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])
  const selectedTank    = useMemo(() => tanks.find(t => t.id === form.tank_id) || null, [tanks, form.tank_id])
  const tankPumps       = useMemo(() => pumps.filter(p => p.tank_id === form.tank_id && !p.is_archived && p.status !== 'decommissioned'), [pumps, form.tank_id])
  const selectedPump    = useMemo(() => pumps.find(p => p.id === form.pump_id) || null, [pumps, form.pump_id])
  const activeVehicles  = useMemo(() => vehicles.filter(v => v.status !== 'archived' && !v.is_archived), [vehicles])
  const activeEquipment = useMemo(() => equipment.filter(e => !e.is_archived), [equipment])
  const activeOperators = useMemo(() => operators.filter(o => o.is_active), [operators])

  // Licence expiry helpers
  function licenceStatus(op) {
    if (!op.licence_expiry_date) return null
    const today = new Date().toISOString().slice(0, 10)
    const diff  = Math.floor((new Date(op.licence_expiry_date) - new Date(today)) / 86400000)
    if (diff < 0)  return { label: 'EXPIRED',  color: THEME.error,   days: diff }
    if (diff <= 30) return { label: `${diff}d`,  color: THEME.warning, days: diff }
    return null
  }

  // Litres calculated
  const litresFromMeter = useMemo(() => {
    const s = Number(form.meter_start)
    const e = Number(form.meter_end)
    if (!form.use_meter || !form.meter_end || isNaN(s) || isNaN(e) || e <= s) return 0
    return e - s
  }, [form.use_meter, form.meter_start, form.meter_end])

  const litres = form.use_meter ? litresFromMeter : (Number(form.litres_manual) || 0)

  // Last delivery price per litre (from most recent delivery transaction for this tank's fuel type)
  const lastPricePerLitre = useMemo(() => {
    if (!selectedTank) return null
    const delivery = transactions.find(
      t => t.transaction_type === 'delivery' &&
           t.tank_id === selectedTank.id &&
           t.cost_total && t.litres
    )
    if (!delivery) return null
    return Number(delivery.cost_total) / Number(delivery.litres)
  }, [transactions, selectedTank])

  const tankLevel    = selectedTank ? Number(selectedTank.current_level_litres) : 0
  const levelAfter   = Math.max(0, tankLevel - litres)
  const pctBefore    = selectedTank?.capacity_litres ? Math.min(100, (tankLevel / Number(selectedTank.capacity_litres)) * 100) : null
  const pctAfter     = selectedTank?.capacity_litres ? Math.min(100, (levelAfter / Number(selectedTank.capacity_litres)) * 100) : null
  const estimatedCost = lastPricePerLitre && litres > 0 ? litres * lastPricePerLitre : null
  const wouldOverdraw = litres > 0 && litres > tankLevel

  // ── Field updater ─────────────────────────────────────────────────────────

  function set(field, value) {
    setFormState(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'tank_id') {
        next.pump_id     = ''
        next.meter_start = ''
        next.meter_end   = ''
      }
      if (field === 'pump_id') {
        const pump = pumps.find(p => p.id === value)
        next.meter_start = pump ? String(pump.current_meter_reading ?? '') : ''
        next.meter_end   = ''
      }
      if (field === 'asset_type') {
        next.vehicle_id   = ''
        next.equipment_id = ''
      }
      return next
    })
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submit(e) {
    e.preventDefault()
    if (!form.tank_id)     { showToast('Select a tank', 'red'); return }
    if (litres <= 0)       { showToast('Litres dispensed must be greater than 0', 'red'); return }
    if (form.use_meter && Number(form.meter_end) <= Number(form.meter_start)) {
      showToast('Meter end reading must be greater than start reading', 'red'); return
    }
    if (form.asset_type === 'vehicle'   && !form.vehicle_id)   { showToast('Select a vehicle', 'red'); return }
    if (form.asset_type === 'equipment' && !form.equipment_id) { showToast('Select equipment', 'red'); return }
    if (!form.operator_id) { showToast('Select an operator', 'red'); return }
    if (wouldOverdraw) { showToast(`Insufficient stock — only ${tankLevel.toFixed(1)} L available`, 'red'); return }

    setSaving(true)
    try {
      const row = await addTransaction({
        transaction_type:  'issuance',
        transaction_date:  form.transaction_date,
        tank_id:           form.tank_id,
        pump_id:           form.pump_id || null,
        litres:            litres,
        vehicle_id:        form.asset_type === 'vehicle'   ? form.vehicle_id || null   : null,
        equipment_id:      form.asset_type === 'equipment' ? form.equipment_id || null : null,
        operator_id:       form.operator_id || null,
        meter_reading_start: form.use_meter && form.meter_start ? Number(form.meter_start) : null,
        meter_reading_end:   form.use_meter && form.meter_end   ? Number(form.meter_end)   : null,
        docket_number:     form.docket_number.trim() || null,
        notes:             form.notes.trim() || null,
      })

      // Update pump meter reading if a pump was selected and meter mode used
      if (form.pump_id && form.use_meter && form.meter_end) {
        await updatePump(form.pump_id, { current_meter_reading: Number(form.meter_end) })
      }

      // Capture human-readable labels for the docket
      const selVehicle   = vehicles.find(v => v.id === form.vehicle_id)
      const selEquipment = equipment.find(e => e.id === form.equipment_id)
      const selOperator  = operators.find(o => o.id === form.operator_id)
      setResultMeta({
        tankName:     selectedTank?.name || '—',
        pumpName:     tankPumps.find(p => p.id === form.pump_id)?.name || null,
        assetLabel:   form.asset_type === 'vehicle'
          ? (selVehicle ? `Fleet No. ${selVehicle.fleet_number}${selVehicle.registration ? ' (' + selVehicle.registration + ')' : ''}` : null)
          : form.asset_type === 'equipment'
          ? (selEquipment ? `${selEquipment.name}${selEquipment.equipment_number ? ' (' + selEquipment.equipment_number + ')' : ''}` : null)
          : null,
        operatorName: selOperator?.employees?.name || null,
      })
      setResult(row)
    } catch (err) {
      showToast(err.message || 'Failed to record issuance', 'red')
    } finally {
      setSaving(false)
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────

  if (result) {
    return (
      <SuccessScreen
        result={result}
        siteName={currentSite?.name}
        tankName={resultMeta?.tankName}
        pumpName={resultMeta?.pumpName}
        assetLabel={resultMeta?.assetLabel}
        operatorName={resultMeta?.operatorName}
        onIssueAnother={() => { setResult(null); setResultMeta(null); setFormState(BLANK) }}
        onViewLedger={() => setPage('fuel_ledger')}
      />
    )
  }

  // ── Tank level bar ────────────────────────────────────────────────────────

  function LevelBar({ pct, color, label }) {
    if (pct === null) return null
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, height: '8px', borderRadius: '6px', background: THEME.outlineVar, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '6px', transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: '12px', fontWeight: 600, color, minWidth: '36px', textAlign: 'right' }}>{pct.toFixed(0)}%</span>
        <span style={{ fontSize: '12px', color: THEME.textMed }}>{label}</span>
      </div>
    )
  }

  const levelColor = (pct) => pct === null ? FUEL_CLR : pct <= LOW_PCT ? THEME.error : pct <= 40 ? THEME.warning : THEME.success

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', maxWidth: '1000px', alignItems: 'start' }}>

      {/* ── Left: form ────────────────────────────────────────────────────── */}
      <div>
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Issue Fuel</div>
          <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>Fill in all required fields and submit to record the issuance.</div>
        </div>

        <form onSubmit={submit}>

          {/* ── 1. Tank ─────────────────────────────────────────────────── */}
          <FieldWrap label="Tank" required>
            <select value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={inp()}>
              <option value="">— Select tank —</option>
              {activeTanks.map(t => {
                const lvl = Number(t.current_level_litres).toFixed(0)
                const pct = t.capacity_litres ? Math.min(100, (Number(t.current_level_litres) / Number(t.capacity_litres)) * 100) : null
                const warn = pct !== null && pct <= LOW_PCT ? ' ⚠' : ''
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}{warn} — {lvl} L{pct !== null ? ` (${pct.toFixed(0)}%)` : ''}
                  </option>
                )
              })}
            </select>

            {selectedTank && (
              <div style={{ marginTop: '8px', padding: '12px 14px', borderRadius: '10px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: THEME.textMed }}>
                  <span>{selectedTank.fuel_types?.name || 'Diesel'} · {selectedTank.tank_type || 'Above Ground'}</span>
                  <span>{Number(selectedTank.current_level_litres).toLocaleString()} L of {Number(selectedTank.capacity_litres || 0).toLocaleString()} L</span>
                </div>
                <LevelBar pct={pctBefore} color={levelColor(pctBefore)} label="current" />
                {pctBefore !== null && pctBefore <= LOW_PCT && (
                  <InfoPanel icon="warning" color={THEME.error}>
                    Tank is below the low-fuel threshold ({LOW_PCT}%). A delivery should be arranged.
                  </InfoPanel>
                )}
              </div>
            )}
          </FieldWrap>

          {/* ── 2. Pump ─────────────────────────────────────────────────── */}
          <FieldWrap label="Pump" hint="Optional — required for meter-based entry">
            <select
              value={form.pump_id}
              onChange={e => set('pump_id', e.target.value)}
              disabled={!form.tank_id || tankPumps.length === 0}
              style={inp({ opacity: (!form.tank_id || tankPumps.length === 0) ? .5 : 1 })}
            >
              <option value="">— None / Manual entry —</option>
              {tankPumps.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.current_meter_reading != null ? ` — meter: ${Number(p.current_meter_reading).toFixed(1)}` : ''}
                </option>
              ))}
            </select>
            {form.tank_id && tankPumps.length === 0 && (
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>No active pumps on this tank — use manual litres entry below.</div>
            )}
          </FieldWrap>

          {/* ── 3. Asset type toggle ─────────────────────────────────────── */}
          <FieldWrap label="Issue To" required>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {[
                { v: 'vehicle',   icon: 'directions_car', label: 'Vehicle' },
                { v: 'equipment', icon: 'construction',   label: 'Equipment' },
              ].map(opt => (
                <button
                  key={opt.v} type="button"
                  onClick={() => set('asset_type', opt.v)}
                  style={{
                    flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    padding: '10px', borderRadius: '12px', fontSize: '13px', fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                    border: `1.5px solid ${form.asset_type === opt.v ? FUEL_CLR : THEME.outline}`,
                    background: form.asset_type === opt.v ? FUEL_CLR + '14' : 'transparent',
                    color: form.asset_type === opt.v ? FUEL_CLR : THEME.textMed,
                  }}
                >
                  <Icon name={opt.icon} size={16} style={{ color: 'inherit' }} />
                  {opt.label}
                </button>
              ))}
            </div>

            {form.asset_type === 'vehicle' && (
              <SearchSelect
                items={activeVehicles}
                value={form.vehicle_id}
                onSelect={id => set('vehicle_id', id)}
                placeholder="Search by fleet # or registration…"
                renderItem={v => `${v.fleet_number}${v.registration ? ' · ' + v.registration : ''}${v.fuel_types?.name ? ' · ' + v.fuel_types.name : ''}`}
                renderSelected={v => `${v.fleet_number}${v.registration ? ' (' + v.registration + ')' : ''}`}
              />
            )}
            {form.asset_type === 'equipment' && (
              <SearchSelect
                items={activeEquipment}
                value={form.equipment_id}
                onSelect={id => set('equipment_id', id)}
                placeholder="Search by equipment # or name…"
                renderItem={e => `${e.equipment_number ? e.equipment_number + ' · ' : ''}${e.name}`}
                renderSelected={e => `${e.equipment_number ? e.equipment_number + ' · ' : ''}${e.name}`}
              />
            )}
          </FieldWrap>

          {/* ── 4. Operator ─────────────────────────────────────────────── */}
          <FieldWrap label="Operator" required>
            <select value={form.operator_id} onChange={e => set('operator_id', e.target.value)} style={inp()}>
              <option value="">— Select operator —</option>
              {activeOperators.map(op => {
                const ls = licenceStatus(op)
                const expLabel = ls ? ` [${ls.label}]` : ''
                return (
                  <option key={op.id} value={op.id}>
                    {op.employees?.name || op.id}{expLabel}
                  </option>
                )
              })}
            </select>
            {form.operator_id && (() => {
              const op = activeOperators.find(o => o.id === form.operator_id)
              const ls = op ? licenceStatus(op) : null
              if (!ls) return null
              return (
                <InfoPanel icon={ls.days < 0 ? 'dangerous' : 'warning'} color={ls.color}>
                  {ls.days < 0
                    ? `Licence EXPIRED ${Math.abs(ls.days)} day${Math.abs(ls.days) !== 1 ? 's' : ''} ago. Operator may not be authorised.`
                    : `Licence expires in ${ls.days} day${ls.days !== 1 ? 's' : ''} (${op.licence_expiry_date}).`
                  }
                </InfoPanel>
              )
            })()}
          </FieldWrap>

          {/* ── 5. Litres / Meter reading ────────────────────────────────── */}
          <FieldWrap label="Quantity">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              {[
                { v: true,  label: 'Use meter reading' },
                { v: false, label: 'Enter litres manually' },
              ].map(opt => (
                <button
                  key={String(opt.v)} type="button"
                  onClick={() => set('use_meter', opt.v)}
                  style={{
                    flex: 1, padding: '8px', borderRadius: '10px', fontSize: '12px', fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit',
                    border: `1.5px solid ${form.use_meter === opt.v ? FUEL_CLR : THEME.outline}`,
                    background: form.use_meter === opt.v ? FUEL_CLR + '14' : 'transparent',
                    color: form.use_meter === opt.v ? FUEL_CLR : THEME.textMed,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {form.use_meter ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>Meter Start</div>
                  <input
                    type="number" step="0.001" min="0"
                    value={form.meter_start}
                    onChange={e => set('meter_start', e.target.value)}
                    placeholder="0.000"
                    style={inp()}
                  />
                  {selectedPump && (
                    <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px' }}>
                      Pre-filled from pump: {Number(selectedPump.current_meter_reading).toFixed(1)}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>Meter End *</div>
                  <input
                    type="number" step="0.001" min="0"
                    value={form.meter_end}
                    onChange={e => set('meter_end', e.target.value)}
                    placeholder="Enter end reading"
                    style={inp({ borderColor: form.meter_end && Number(form.meter_end) <= Number(form.meter_start) ? THEME.error : THEME.outline })}
                  />
                </div>
              </div>
            ) : (
              <input
                type="number" step="0.1" min="0.1"
                value={form.litres_manual}
                onChange={e => set('litres_manual', e.target.value)}
                placeholder="Litres dispensed"
                style={inp()}
              />
            )}
          </FieldWrap>

          {/* ── 6. Docket number ─────────────────────────────────────────── */}
          <FieldWrap label="Docket Number" hint="Leave blank to use auto-generated transaction number">
            <input
              type="text"
              value={form.docket_number}
              onChange={e => set('docket_number', e.target.value)}
              placeholder="e.g. DOC-001 (auto-generated if blank)"
              style={inp()}
            />
          </FieldWrap>

          {/* ── 7. Date ──────────────────────────────────────────────────── */}
          <FieldWrap label="Date">
            <input
              type="date"
              value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)}
              style={inp()}
            />
          </FieldWrap>

          {/* ── 8. Notes ─────────────────────────────────────────────────── */}
          <FieldWrap label="Notes">
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Purpose, destination, authorised by…"
              rows={2}
              style={{ ...inp(), resize: 'vertical' }}
            />
          </FieldWrap>

          {/* ── Submit ───────────────────────────────────────────────────── */}
          {wouldOverdraw && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderRadius: '12px', background: THEME.statusErrorBg, border: `1px solid ${THEME.error}55`, marginBottom: '16px' }}>
              <Icon name="warning" size={18} style={{ color: THEME.error, flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: THEME.statusErrorText, fontWeight: 500 }}>
                Quantity ({litres.toFixed(1)} L) exceeds tank level ({tankLevel.toFixed(1)} L). Reduce the amount or select a different tank.
              </span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving || wouldOverdraw}
            style={{
              width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
              background: (saving || wouldOverdraw) ? THEME.outline : FUEL_CLR,
              color: '#fff', fontSize: '15px', fontWeight: 700, cursor: saving || wouldOverdraw ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'background .15s',
            }}
          >
            {saving ? (
              <><Icon name="progress_activity" size={18} style={{ color: '#fff', animation: 'spin 1s linear infinite' }} /> Recording…</>
            ) : (
              <><Icon name="output" size={18} style={{ color: '#fff' }} /> Issue Fuel</>
            )}
          </button>
        </form>
      </div>

      {/* ── Right: live summary ───────────────────────────────────────────── */}
      <div style={{ position: 'sticky', top: '24px' }}>
        <div style={{
          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
          borderRadius: '16px', padding: '20px', boxShadow: THEME.shadow1,
        }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '16px' }}>
            Summary
          </div>

          {/* Litres */}
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ fontSize: '48px', fontWeight: 300, color: litres > 0 ? FUEL_CLR : THEME.textLow, lineHeight: 1 }}>
              {litres > 0 ? litres.toFixed(1) : '—'}
            </div>
            <div style={{ fontSize: '13px', color: THEME.textLow, marginTop: '4px' }}>litres to be issued</div>
          </div>

          {estimatedCost && litres > 0 && (
            <div style={{ textAlign: 'center', marginBottom: '20px', padding: '12px', borderRadius: '10px', background: THEME.surfaceVar }}>
              <div style={{ fontSize: '20px', fontWeight: 600, color: THEME.text }}>
                ${estimatedCost.toFixed(2)}
              </div>
              <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>estimated cost @ ${lastPricePerLitre.toFixed(3)}/L</div>
            </div>
          )}

          {/* Level before / after */}
          {selectedTank && (
            <div style={{ borderTop: `1px solid ${THEME.outlineVar}`, paddingTop: '16px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '10px' }}>Tank Level</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>Before</div>
                  <LevelBar pct={pctBefore} color={levelColor(pctBefore)} label={`${tankLevel.toFixed(0)} L`} />
                </div>
                {litres > 0 && (
                  <div>
                    <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '4px' }}>After</div>
                    <LevelBar
                      pct={pctAfter}
                      color={levelColor(pctAfter)}
                      label={`${levelAfter.toFixed(0)} L`}
                    />
                    {wouldOverdraw && (
                      <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px', fontWeight: 500 }}>
                        ⚠ Insufficient stock
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick stats */}
          {selectedTank && (
            <div style={{ marginTop: '16px', borderTop: `1px solid ${THEME.outlineVar}`, paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { label: 'Tank', value: selectedTank.name },
                { label: 'Fuel Type', value: selectedTank.fuel_types?.name || 'Diesel' },
                form.pump_id && { label: 'Pump', value: tankPumps.find(p => p.id === form.pump_id)?.name },
              ].filter(Boolean).map(row => (
                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <span style={{ color: THEME.textLow }}>{row.label}</span>
                  <span style={{ color: THEME.text, fontWeight: 500 }}>{row.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* History link */}
        <button
          type="button"
          onClick={() => setPage('fuel_issues')}
          style={{
            width: '100%', marginTop: '10px', padding: '10px', borderRadius: '12px',
            border: `1px solid ${THEME.outlineVar}`, background: 'transparent',
            color: THEME.textMed, fontSize: '13px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          }}
        >
          <Icon name="history" size={15} style={{ color: THEME.textMed }} />
          View Issuance History
        </button>
      </div>
    </div>
  )
}
