import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
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
        {(result.meter_start != null || result.meter_end != null) && (
          <div style={{ borderBottom: '1px solid black', padding: '8px 0', margin: '8px 0' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {result.meter_start != null && (
                  <tr>
                    <td style={{ padding: '3px 0', fontWeight: 'bold', width: '40%' }}>Meter Start:</td>
                    <td style={{ padding: '3px 0' }}>{Number(result.meter_start).toLocaleString(undefined, { minimumFractionDigits: 1 })} L</td>
                  </tr>
                )}
                {result.meter_end != null && (
                  <tr>
                    <td style={{ padding: '3px 0', fontWeight: 'bold', width: '40%' }}>Meter End:</td>
                    <td style={{ padding: '3px 0' }}>{Number(result.meter_end).toLocaleString(undefined, { minimumFractionDigits: 1 })} L</td>
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
        background: THEME.surface, borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`,
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
          padding: '10px 24px', borderRadius: '6px', border: `1px solid ${THEME.outline}`,
          background: 'transparent', color: THEME.textMed, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <Icon name="print" size={16} style={{ color: THEME.textMed }} />
          Print Docket
        </button>
        <button onClick={onViewLedger} style={{
          padding: '10px 24px', borderRadius: '6px', border: `1px solid ${THEME.outline}`,
          background: 'transparent', color: THEME.textMed, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
        }}>View Ledger</button>
        <button onClick={onIssueAnother} style={{
          padding: '10px 24px', borderRadius: '6px', border: 'none',
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
  odometer_km:      '',    // vehicle odometer at fill time — required for vehicles
  litres_manual:    '',
  docket_number:    '',
  notes:            '',
  // Manual/emergency authorisation — captured when there is no linked
  // approved fuel request. Approvers acknowledge these post-hoc.
  authorised_by_name:   '',
  authorisation_reason: '',
}

export default function FuelIssuance({ setPage }) {
  const { can }        = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const {
    tanks, pumps, vehicles, equipment, operators, employees,
    transactions, addTransaction, updatePump, refresh: refreshFuel,
  } = useFuel()

  const [form,          setFormState]   = useState(BLANK)
  const [saving,        setSaving]      = useState(false)
  const [result,        setResult]      = useState(null)
  const [resultMeta,    setResultMeta]  = useState(null)
  const [linkedRequest, setLinkedRequest] = useState(null)   // prefilled from FuelRequests
  const [requireApproval, setRequireApproval] = useState(false)

  // ── Bulk issuance mode ─────────────────────────────────────────────────────
  const [bulkMode, setBulkMode] = useState(false)
  const nowTime = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const todayStr = new Date().toISOString().slice(0, 10)
  const makeBulkRow = useCallback(() => ({
    time: nowTime(), transaction_date: todayStr,
    asset_type: 'vehicle', vehicle_id: '', equipment_id: '',
    litres: '', operator_id: '', notes: '',
  }), [todayStr])
  const [bulkRows, setBulkRows] = useState(() => Array.from({ length: 5 }, () => makeBulkRow()))
  const [bulkTankId, setBulkTankId] = useState('')
  const [bulkAuth, setBulkAuth] = useState('')
  const [bulkReason, setBulkReason] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkResults, setBulkResults] = useState(null)
  const gridRef = useRef(null)

  // Load fuel settings and check require_approval flag
  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('fuel_settings')
      .select('require_approval')
      .eq('site_id', currentSiteId)
      .maybeSingle()
      .then(({ data }) => setRequireApproval(Boolean(data?.require_approval)))
  }, [currentSiteId])

  // Check sessionStorage for a request prefill (set by FuelRequests "Issue" button).
  // The request carries fleet_asset_id — wait until assets have loaded so we can
  // classify it as vehicle vs equipment, then consume the prefill exactly once.
  useEffect(() => {
    const raw = sessionStorage.getItem('fuel_request_prefill')
    if (!raw) return
    if (vehicles.length === 0 && equipment.length === 0) return   // assets still loading
    sessionStorage.removeItem('fuel_request_prefill')
    try {
      const req = JSON.parse(raw)
      setLinkedRequest(req)
      const assetId = req.fleet_asset_id || req.vehicle_id || req.equipment_id || ''
      const isVehicle = assetId ? vehicles.some(v => v.id === assetId) : true
      setFormState(prev => ({
        ...prev,
        asset_type:    isVehicle ? 'vehicle' : 'equipment',
        vehicle_id:    isVehicle ? assetId : '',
        equipment_id:  isVehicle ? '' : assetId,
        litres_manual: req.quantity_requested ? String(req.quantity_requested) : '',
        use_meter:     false,
      }))
    } catch { /* ignore malformed data */ }
  }, [vehicles, equipment])

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
  const activeGenerators = useMemo(
    () => activeEquipment.filter(e => e.fleet_asset_types?.category === 'generator'),
    [activeEquipment])
  const activeNonGenEquipment = useMemo(
    () => activeEquipment.filter(e => e.fleet_asset_types?.category !== 'generator'),
    [activeEquipment])
  // Generators are stored in equipment_id / fleet_asset_id like any equipment
  const isEquipmentLike = t => t === 'equipment' || t === 'generator'
  // Equipment rows are fleet_assets — label from fleet/asset number + description
  const eqLabel = eq => {
    if (!eq) return '—'
    const num = eq.fleet_number || eq.asset_number || ''
    const desc = eq.description || ''
    return num && desc ? `${num} · ${desc}` : (num || desc || '—')
  }
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

  // Last known odometer for the selected vehicle — the max of the asset's
  // headline current_odometer_km and any odometer captured on a previous
  // fuel issuance. Used to catch typos before they poison the analytics.
  const lastKnownOdometer = useMemo(() => {
    if (form.asset_type !== 'vehicle' || !form.vehicle_id) return null
    const v = vehicles.find(x => x.id === form.vehicle_id)
    let last = v?.current_odometer_km != null && Number(v.current_odometer_km) > 0
      ? Number(v.current_odometer_km) : null
    for (const t of transactions) {
      if (t.fleet_asset_id === form.vehicle_id && t.odometer_km != null) {
        const o = Number(t.odometer_km)
        if (last == null || o > last) last = o
      }
    }
    return last
  }, [form.asset_type, form.vehicle_id, vehicles, transactions])

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
    if (form.asset_type === 'generator' && !form.equipment_id) { showToast('Select a generator', 'red'); return }
    // Odometer is required for vehicles so the L/100km analytics have a
    // valid distance signal. Equipment doesn't have km — hours would apply
    // there but that's a follow-up.
    if (form.asset_type === 'vehicle' && !form.odometer_km) {
      showToast('Enter the vehicle odometer reading (km)', 'red'); return
    }
    // Sanity-check the reading against the vehicle's last known odometer:
    // below it = almost certainly a typo (block); an implausible jump
    // (> 5,000 km since the last fill) needs an explicit confirm.
    if (form.asset_type === 'vehicle' && form.odometer_km) {
      const entered = Number(form.odometer_km)
      const last = lastKnownOdometer
      if (last != null && entered < last) {
        showToast(`Odometer ${entered.toLocaleString()} km is LOWER than the last recorded ${last.toLocaleString()} km — check for a typo`, 'red')
        return
      }
      if (last != null && entered - last > 5000) {
        const ok = window.confirm(
          `This reading is ${(entered - last).toLocaleString()} km above the last recorded ${last.toLocaleString()} km. ` +
          `That is unusually far for one fill. Save anyway?`
        )
        if (!ok) return
      }
    }
    if (!form.operator_id) { showToast('Select an operator', 'red'); return }
    if (wouldOverdraw) { showToast(`Insufficient stock — only ${tankLevel.toFixed(1)} L available`, 'red'); return }

    // Manual / emergency issuance (no linked request) — require the
    // "authorised by" name + a reason so there's a clear audit trail
    // and the approver has something to acknowledge against.
    const isManual = !linkedRequest
    if (isManual) {
      if (!form.authorised_by_name.trim()) { showToast('Enter who authorised this issuance', 'red'); return }
      if (!form.authorisation_reason.trim()) { showToast('Enter the reason / justification', 'red'); return }
    }

    setSaving(true)
    try {
      const row = await addTransaction({
        transaction_type:  'issuance',
        transaction_date:  form.transaction_date,
        tank_id:           form.tank_id,
        pump_id:           form.pump_id || null,
        litres:            litres,
        // vehicles/equipment are fleet_assets rows now — write the bridge
        // column, NOT the legacy vehicle_id/equipment_id FKs (those point at
        // fuel_vehicles/fuel_equipment and would reject newly created assets).
        fleet_asset_id:    form.asset_type === 'vehicle' ? (form.vehicle_id || null)
                         : isEquipmentLike(form.asset_type) ? (form.equipment_id || null)
                         : null,
        operator_id:       form.operator_id || null,
        meter_start: form.use_meter && form.meter_start ? Number(form.meter_start) : null,
        meter_end:   form.use_meter && form.meter_end   ? Number(form.meter_end)   : null,
        odometer_km: form.asset_type === 'vehicle' && form.odometer_km ? Number(form.odometer_km) : null,
        docket_number:     form.docket_number.trim() || null,
        notes:             form.notes.trim() || null,
        // Acknowledgement fields — pending review when unlinked.
        authorised_by_name:     isManual ? form.authorised_by_name.trim() : null,
        authorisation_reason:   isManual ? form.authorisation_reason.trim() : null,
        acknowledgement_status: isManual ? 'pending' : 'not_required',
      })

      // If this issuance was raised against a fuel request, mark it as issued
      if (linkedRequest?.request_id) {
        await supabase
          .from('fuel_requests')
          .update({
            status:               'issued',
            issued_transaction_id: row.id,
            issued_at:            new Date().toISOString(),
          })
          .eq('id', linkedRequest.request_id)
      }

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
          : isEquipmentLike(form.asset_type)
          ? (selEquipment ? eqLabel(selEquipment) : null)
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

  // ── Bulk helpers ───────────────────────────────────────────────────────────

  function addBulkRow() {
    setBulkRows(prev => [...prev, makeBulkRow()])
  }

  function updateBulkRow(idx, field, value) {
    setBulkRows(prev => prev.map((r, i) => {
      if (i !== idx) return r
      const next = { ...r, [field]: value }
      if (field === 'asset_type') { next.vehicle_id = ''; next.equipment_id = '' }
      return next
    }))
  }

  function removeBulkRow(idx) {
    setBulkRows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx))
  }

  // Keyboard navigation: Tab/Enter moves to next cell in grid
  function handleBulkKeyDown(e, rowIdx, colIdx) {
    if (e.key !== 'Tab' && e.key !== 'Enter') return
    if (e.key === 'Enter' && e.target.tagName === 'SELECT') return
    const COLS = 5 // time, date, asset, litres, operator
    const isShift = e.shiftKey
    let nextRow = rowIdx
    let nextCol = colIdx

    if (isShift) {
      nextCol--
      if (nextCol < 0) { nextCol = COLS - 1; nextRow-- }
    } else {
      nextCol++
      if (nextCol >= COLS) { nextCol = 0; nextRow++ }
    }

    if (nextRow >= bulkRows.length && !isShift) {
      addBulkRow()
      nextRow = bulkRows.length
      nextCol = 0
    }
    if (nextRow < 0 || nextRow >= bulkRows.length + (isShift ? 0 : 1)) return

    e.preventDefault()
    setTimeout(() => {
      const grid = gridRef.current
      if (!grid) return
      const row = grid.querySelectorAll('tr[data-bulk-row]')[nextRow]
      if (!row) return
      const inputs = row.querySelectorAll('input, select')
      if (inputs[nextCol]) inputs[nextCol].focus()
    }, 30)
  }

  // Excel paste: detect TSV/CSV and populate rows
  function handleBulkPaste(e) {
    const text = e.clipboardData?.getData('text/plain')
    if (!text || !text.includes('\t') && !text.includes(',')) return
    e.preventDefault()
    const sep = text.includes('\t') ? '\t' : ','
    const lines = text.trim().split('\n').map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')))
    if (lines.length === 0) return

    const vehicleMap = new Map()
    activeVehicles.forEach(v => {
      vehicleMap.set(v.fleet_number?.toLowerCase(), v.id)
      if (v.registration) vehicleMap.set(v.registration.toLowerCase(), v.id)
    })
    const equipMap = new Map()
    activeEquipment.forEach(eq => {
      if (eq.fleet_number)  equipMap.set(eq.fleet_number.toLowerCase(), eq.id)
      if (eq.asset_number)  equipMap.set(eq.asset_number.toLowerCase(), eq.id)
      if (eq.description)   equipMap.set(eq.description.toLowerCase(), eq.id)
      if (eq.serial_number) equipMap.set(eq.serial_number.toLowerCase(), eq.id)
    })
    const opMap = new Map()
    activeOperators.forEach(op => {
      const name = op.employees?.name?.toLowerCase()
      if (name) opMap.set(name, op.id)
    })

    const newRows = lines.map(cols => {
      // Expected columns: Time, Date, Vehicle/Equipment, Litres, Operator
      const row = makeBulkRow()
      if (cols[0]) row.time = cols[0]
      if (cols[1]) {
        const d = new Date(cols[1])
        if (!isNaN(d.getTime())) row.transaction_date = d.toISOString().slice(0, 10)
      }
      if (cols[2]) {
        const lookup = cols[2].toLowerCase()
        const vid = vehicleMap.get(lookup)
        const eid = equipMap.get(lookup)
        if (vid) { row.asset_type = 'vehicle'; row.vehicle_id = vid }
        else if (eid) {
          row.asset_type = activeGenerators.some(g => g.id === eid) ? 'generator' : 'equipment'
          row.equipment_id = eid
        }
      }
      if (cols[3]) row.litres = cols[3].replace(/[^\d.]/g, '')
      if (cols[4]) {
        const oid = opMap.get(cols[4].toLowerCase())
        if (oid) row.operator_id = oid
      }
      return row
    })

    setBulkRows(prev => {
      const hasData = prev.some(r => r.vehicle_id || r.equipment_id || Number(r.litres) > 0)
      return hasData ? [...prev, ...newRows] : newRows
    })
    showToast(`Pasted ${newRows.length} row${newRows.length > 1 ? 's' : ''} from clipboard`, 'green')
  }

  // ── Bulk submit (atomic via RPC) ──────────────────────────────────────────

  async function submitBulk(e) {
    e.preventDefault()
    if (!bulkTankId) { showToast('Select a tank for bulk issuance', 'red'); return }
    if (!bulkAuth.trim()) { showToast('Enter who authorised this bulk issuance', 'red'); return }
    if (!bulkReason.trim()) { showToast('Enter the reason / justification', 'red'); return }

    const valid = bulkRows.filter(r => (r.vehicle_id || r.equipment_id) && Number(r.litres) > 0)
    if (valid.length === 0) { showToast('Add at least one row with a vehicle/equipment and litres', 'red'); return }

    const tank = tanks.find(t => t.id === bulkTankId)
    const totalLitres = valid.reduce((s, r) => s + Number(r.litres), 0)
    if (tank && totalLitres > Number(tank.current_level_litres)) {
      showToast(`Total ${totalLitres.toFixed(1)} L exceeds tank level (${Number(tank.current_level_litres).toFixed(1)} L)`, 'red'); return
    }

    setBulkSaving(true)
    try {
      const batchId = crypto.randomUUID()
      const rpcRows = valid.map(r => ({
        transaction_date: r.transaction_date,
        fleet_asset_id:   r.asset_type === 'vehicle' ? (r.vehicle_id || null)
                        : isEquipmentLike(r.asset_type) ? (r.equipment_id || null)
                        : null,
        litres:           Number(r.litres),
        operator_id:      r.operator_id || null,
        notes:            r.time ? `Bulk issuance at ${r.time}` : 'Bulk issuance',
      }))

      const { data, error } = await supabase.rpc('rpc_bulk_fuel_issuance', {
        p_site_id:       currentSiteId,
        p_tank_id:       bulkTankId,
        p_batch_id:      batchId,
        p_authorised_by: bulkAuth.trim(),
        p_reason:        bulkReason.trim(),
        p_rows:          rpcRows,
      })

      if (error) throw error

      // Refresh all fuel data so tank levels, transactions etc. reflect the bulk insert
      refreshFuel()

      setBulkResults({
        batchId,
        totalLitres: data.total_litres,
        rowCount:    data.row_count,
        rows:        data.rows,
        tankName:    tank?.name || '—',
        tankLevelAfter: data.tank_level_after,
      })
      showToast(`${data.row_count} issuance${data.row_count > 1 ? 's' : ''} recorded atomically`, 'green')
    } catch (err) {
      // Fallback: if RPC doesn't exist yet, do sequential inserts
      if (err.message?.includes('rpc_bulk_fuel_issuance') || err.code === '42883') {
        const results = []
        try {
          for (const r of valid) {
            const row = await addTransaction({
              transaction_type:  'issuance',
              transaction_date:  r.transaction_date,
              tank_id:           bulkTankId,
              litres:            Number(r.litres),
              fleet_asset_id:    r.asset_type === 'vehicle' ? (r.vehicle_id || null)
                               : isEquipmentLike(r.asset_type) ? (r.equipment_id || null)
                               : null,
              operator_id:       r.operator_id || null,
              notes:             r.time ? `Bulk issuance at ${r.time}` : 'Bulk issuance',
              authorised_by_name:     bulkAuth.trim(),
              authorisation_reason:   bulkReason.trim(),
              acknowledgement_status: 'pending',
            })
            results.push(row)
          }
          setBulkResults({
            batchId:    null,
            totalLitres: results.reduce((s, r) => s + Number(r.litres), 0),
            rowCount:   results.length,
            rows:       results.map(r => ({
              id:                r.id,
              transaction_number: r.transaction_number,
              litres:            Number(r.litres),
              fleet_asset_id:    r.fleet_asset_id,
              operator_id:       r.operator_id,
              transaction_date:  r.transaction_date,
            })),
            tankName:   tank?.name || '—',
            tankLevelAfter: null,
          })
          showToast(`${results.length} issuance${results.length > 1 ? 's' : ''} recorded`, 'green')
        } catch (fallbackErr) {
          showToast(fallbackErr.message || 'Failed during bulk issuance', 'red')
        }
      } else {
        showToast(err.message || 'Failed during bulk issuance', 'red')
      }
    } finally {
      setBulkSaving(false)
    }
  }


  // ── Success state ─────────────────────────────────────────────────────────

  if (bulkResults) {
    const br = bulkResults
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '40px 24px' }}>
        {/* Print-only consolidated docket */}
        <style>{`
          @media print {
            body > * { display: none !important; }
            #bulk-docket-print { display: block !important; }
          }
          #bulk-docket-print { display: none; }
          @media print {
            #bulk-docket-print {
              position: fixed; top: 0; left: 0; right: 0; bottom: 0;
              background: white; color: black; font-family: monospace;
              font-size: 11pt; padding: 15mm;
            }
          }
        `}</style>
        <div id="bulk-docket-print">
          <div style={{ borderBottom: '2px solid black', paddingBottom: '6px', marginBottom: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: '15pt', fontWeight: 'bold' }}>BULK FUEL ISSUANCE DOCKET</div>
            <div>{currentSite?.name || 'Bravura Zimbabwe'}</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '8px' }}>
            <tbody>
              {[
                ['Tank', br.tankName],
                ['Date', new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })],
                ['Authorised By', bulkAuth],
                ['Reason', bulkReason],
                ['Total', `${Number(br.totalLitres).toFixed(1)} L across ${br.rowCount} vehicle${br.rowCount > 1 ? 's' : ''}`],
                br.batchId && ['Batch Ref', br.batchId.slice(0, 8).toUpperCase()],
              ].filter(Boolean).map(([k, v]) => (
                <tr key={k}><td style={{ padding: '2px 0', fontWeight: 'bold', width: '35%' }}>{k}:</td><td>{v}</td></tr>
              ))}
            </tbody>
          </table>
          <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid black', marginBottom: '12px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid black', fontWeight: 'bold' }}>
                <td style={{ padding: '4px 6px', borderRight: '1px solid black' }}>#</td>
                <td style={{ padding: '4px 6px', borderRight: '1px solid black' }}>Vehicle / Equipment</td>
                <td style={{ padding: '4px 6px', borderRight: '1px solid black', textAlign: 'right' }}>Litres</td>
                <td style={{ padding: '4px 6px' }}>Txn #</td>
              </tr>
            </thead>
            <tbody>
              {br.rows.map((r, i) => {
                const assetId = r.fleet_asset_id || r.vehicle_id || r.equipment_id
                const v = vehicles.find(x => x.id === assetId)
                const eq = equipment.find(x => x.id === assetId)
                const label = v ? `${v.fleet_number}${v.registration ? ' (' + v.registration + ')' : ''}` : eq ? (eq.description || eq.fleet_number || eq.asset_number) : '—'
                return (
                  <tr key={r.id || i} style={{ borderBottom: '1px solid black' }}>
                    <td style={{ padding: '3px 6px', borderRight: '1px solid black' }}>{i + 1}</td>
                    <td style={{ padding: '3px 6px', borderRight: '1px solid black' }}>{label}</td>
                    <td style={{ padding: '3px 6px', borderRight: '1px solid black', textAlign: 'right' }}>{Number(r.litres).toFixed(1)}</td>
                    <td style={{ padding: '3px 6px', fontFamily: 'monospace', fontSize: '9pt' }}>{r.transaction_number}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid black', fontWeight: 'bold' }}>
                <td colSpan={2} style={{ padding: '4px 6px', borderRight: '1px solid black' }}>TOTAL</td>
                <td style={{ padding: '4px 6px', borderRight: '1px solid black', textAlign: 'right' }}>{Number(br.totalLitres).toFixed(1)} L</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '30px' }}>
            <div><div style={{ fontWeight: 'bold', marginBottom: '20px' }}>Authorised By:</div><div style={{ borderBottom: '1px solid black', width: '200px' }}>&nbsp;</div></div>
            <div><div style={{ fontWeight: 'bold', marginBottom: '20px' }}>Fuel Attendant:</div><div style={{ borderBottom: '1px solid black', width: '200px' }}>&nbsp;</div></div>
          </div>
        </div>

        {/* On-screen success */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '72px', height: '72px', borderRadius: '50%', margin: '0 auto 20px',
            background: THEME.statusSuccessBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="check_circle" size={40} style={{ color: THEME.success }} />
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>Bulk Issuance Complete</div>
          <div style={{ fontSize: '15px', color: THEME.textMed }}>
            {br.rowCount} issuance{br.rowCount > 1 ? 's' : ''} · {Number(br.totalLitres).toFixed(1)} L total from {br.tankName}
          </div>
          {br.batchId && (
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px', fontFamily: 'monospace' }}>
              Batch: {br.batchId.slice(0, 8).toUpperCase()}
            </div>
          )}
        </div>

        <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', marginBottom: '24px', boxShadow: THEME.shadow1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>#</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Vehicle / Equipment</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Litres</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Transaction #</th>
              </tr>
            </thead>
            <tbody>
              {br.rows.map((r, i) => {
                const v = vehicles.find(x => x.id === r.vehicle_id)
                const eq = equipment.find(x => x.id === r.equipment_id)
                const label = v ? `${v.fleet_number}${v.registration ? ' · ' + v.registration : ''}` : eq ? eqLabel(eq) : '—'
                return (
                  <tr key={r.id || i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '10px 14px', color: THEME.textLow, fontWeight: 600 }}>{i + 1}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{label}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: FUEL_CLR }}>{Number(r.litres).toFixed(1)} L</td>
                    <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: '11px', color: THEME.textMed }}>{r.transaction_number}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: `2px solid ${THEME.outlineVar}`, background: THEME.surfaceVar }}>
                <td colSpan={2} style={{ padding: '11px 14px', fontWeight: 700, color: THEME.text }}>TOTAL</td>
                <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: 700, color: FUEL_CLR }}>{Number(br.totalLitres).toFixed(1)} L</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button onClick={() => window.print()} style={{
            padding: '10px 24px', borderRadius: '6px', border: `1px solid ${THEME.outline}`,
            background: 'transparent', color: THEME.textMed, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <Icon name="print" size={16} style={{ color: THEME.textMed }} /> Print Docket
          </button>
          <button onClick={() => setPage('fuel_issues')} style={{
            padding: '10px 24px', borderRadius: '6px', border: `1px solid ${THEME.outline}`,
            background: 'transparent', color: THEME.textMed, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          }}>View History</button>
          <button onClick={() => { setBulkResults(null); setBulkRows(Array.from({ length: 5 }, () => makeBulkRow())); setBulkAuth(''); setBulkReason('') }} style={{
            padding: '10px 24px', borderRadius: '6px', border: 'none',
            background: FUEL_CLR, color: '#fff', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: '6px',
          }}>
            <Icon name="add" size={16} style={{ color: '#fff' }} /> Issue Another Batch
          </button>
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <SuccessScreen
        result={result}
        siteName={currentSite?.name}
        tankName={resultMeta?.tankName}
        pumpName={resultMeta?.pumpName}
        assetLabel={resultMeta?.assetLabel}
        operatorName={resultMeta?.operatorName}
        onIssueAnother={() => { setResult(null); setResultMeta(null); setLinkedRequest(null); setFormState(BLANK) }}
        onViewLedger={() => setPage('fuel_transactions')}
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

  // ── Bulk issuance UI ────────────────────────────────────────────────────

  if (bulkMode) {
    const bulkTank = tanks.find(t => t.id === bulkTankId)
    const bulkTotal = bulkRows.reduce((s, r) => s + (Number(r.litres) || 0), 0)
    const bulkOverdraw = bulkTank && bulkTotal > Number(bulkTank.current_level_litres)
    const bulkTankLevel = bulkTank ? Number(bulkTank.current_level_litres) : 0
    const bulkTankCap = bulkTank?.capacity_litres ? Number(bulkTank.capacity_litres) : 0
    const bulkPctBefore = bulkTankCap ? Math.min(100, (bulkTankLevel / bulkTankCap) * 100) : null
    const bulkPctAfter = bulkTankCap ? Math.min(100, (Math.max(0, bulkTankLevel - bulkTotal) / bulkTankCap) * 100) : null
    const bulkFuelType = bulkTank?.fuel_types?.name || 'Diesel'
    const validCount = bulkRows.filter(r => (r.vehicle_id || r.equipment_id) && Number(r.litres) > 0).length

    return (
      <div style={{ maxWidth: '1100px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Bulk Fuel Issuance</div>
            <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>Record multiple vehicle/equipment issuances at once. Paste from Excel or type directly.</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: THEME.textMed, background: THEME.surfaceVar, padding: '8px 14px', borderRadius: '10px', border: `1px solid ${THEME.outlineVar}` }}>
            <input type="checkbox" checked={bulkMode} onChange={() => setBulkMode(false)} style={{ accentColor: FUEL_CLR }} />
            Bulk Mode
          </label>
        </div>

        <form onSubmit={submitBulk}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '20px' }}>
            <FieldWrap label="Tank" required>
              <select value={bulkTankId} onChange={e => setBulkTankId(e.target.value)} style={inp()}>
                <option value="">— Select tank —</option>
                {activeTanks.map(t => (
                  <option key={t.id} value={t.id}>{t.name} — {Number(t.current_level_litres).toFixed(0)} L</option>
                ))}
              </select>
            </FieldWrap>
            <FieldWrap label="Authorised By" required>
              <select value={bulkAuth} onChange={e => setBulkAuth(e.target.value)} style={inp()}>
                <option value="">— Select —</option>
                {employees.filter(e => e.status === 'active').map(e => (
                  <option key={e.id} value={e.name}>{e.name}</option>
                ))}
              </select>
            </FieldWrap>
            <FieldWrap label="Reason" required>
              <input type="text" value={bulkReason} onChange={e => setBulkReason(e.target.value)} placeholder="e.g. Morning diesel run" style={inp()} />
            </FieldWrap>
          </div>

          {/* Tank level bar */}
          {bulkTank && (
            <div style={{ marginBottom: '20px', padding: '14px 16px', borderRadius: '12px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px', color: THEME.textMed }}>
                <span>{bulkFuelType} · {bulkTank.tank_type || 'Above Ground'}</span>
                <span>{bulkTankLevel.toFixed(0)} L / {bulkTankCap.toFixed(0)} L capacity</span>
              </div>
              <LevelBar pct={bulkPctBefore} color={levelColor(bulkPctBefore)} label="Current" />
              {bulkTotal > 0 && (
                <div style={{ marginTop: '6px' }}>
                  <LevelBar pct={bulkPctAfter} color={bulkOverdraw ? THEME.error : levelColor(bulkPctAfter)} label="After issue" />
                </div>
              )}
            </div>
          )}

          <div ref={gridRef} onPaste={handleBulkPaste} style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1, marginBottom: '20px' }}>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '900px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, width: '40px' }}>#</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, width: '100px' }}>Time</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, width: '130px' }}>Date</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, width: '90px' }}>Fuel Type</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Vehicle / Equipment</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, width: '100px' }}>Litres</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>Operator</th>
                  <th style={{ padding: '10px 12px', width: '40px' }} />
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, idx) => (
                  <tr key={idx} data-bulk-row style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 12px', color: THEME.textLow, fontWeight: 600 }}>{idx + 1}</td>
                    <td style={{ padding: '8px 4px' }}>
                      <input type="time" value={row.time} onChange={e => updateBulkRow(idx, 'time', e.target.value)}
                        onKeyDown={e => handleBulkKeyDown(e, idx, 0)}
                        style={{ ...inp({ padding: '7px 8px', fontSize: '12px' }) }} />
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <input type="date" value={row.transaction_date} onChange={e => updateBulkRow(idx, 'transaction_date', e.target.value)}
                        onKeyDown={e => handleBulkKeyDown(e, idx, 1)}
                        style={{ ...inp({ padding: '7px 8px', fontSize: '12px' }) }} />
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <span style={{ fontSize: '12px', color: THEME.textLow, padding: '7px 8px', display: 'block' }}>{bulkFuelType}</span>
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <select value={row.asset_type} onChange={e => updateBulkRow(idx, 'asset_type', e.target.value)}
                          style={{ ...inp({ padding: '7px 6px', fontSize: '11px', width: '70px', flexShrink: 0 }) }}>
                          <option value="vehicle">Veh</option>
                          <option value="equipment">Eqp</option>
                          <option value="generator">Gen</option>
                        </select>
                        {row.asset_type === 'vehicle' ? (
                          <select value={row.vehicle_id} onChange={e => updateBulkRow(idx, 'vehicle_id', e.target.value)}
                            onKeyDown={e => handleBulkKeyDown(e, idx, 2)}
                            style={{ ...inp({ padding: '7px 8px', fontSize: '12px', flex: 1 }) }}>
                            <option value="">— Vehicle —</option>
                            {activeVehicles.map(v => (
                              <option key={v.id} value={v.id}>{v.fleet_number}{v.registration ? ' · ' + v.registration : ''}</option>
                            ))}
                          </select>
                        ) : (
                          <select value={row.equipment_id} onChange={e => updateBulkRow(idx, 'equipment_id', e.target.value)}
                            onKeyDown={e => handleBulkKeyDown(e, idx, 2)}
                            style={{ ...inp({ padding: '7px 8px', fontSize: '12px', flex: 1 }) }}>
                            <option value="">{row.asset_type === 'generator' ? '— Generator —' : '— Equipment —'}</option>
                            {(row.asset_type === 'generator' ? activeGenerators : activeNonGenEquipment).map(eq => (
                              <option key={eq.id} value={eq.id}>{eqLabel(eq)}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <input type="number" step="0.1" min="0" value={row.litres} onChange={e => updateBulkRow(idx, 'litres', e.target.value)}
                        onKeyDown={e => handleBulkKeyDown(e, idx, 3)}
                        placeholder="0" style={{ ...inp({ padding: '7px 8px', fontSize: '12px' }) }} />
                    </td>
                    <td style={{ padding: '8px 4px' }}>
                      <select value={row.operator_id} onChange={e => updateBulkRow(idx, 'operator_id', e.target.value)}
                        onKeyDown={e => handleBulkKeyDown(e, idx, 4)}
                        style={{ ...inp({ padding: '7px 8px', fontSize: '12px' }) }}>
                        <option value="">— Operator —</option>
                        {activeOperators.map(op => (
                          <option key={op.id} value={op.id}>{op.employees?.name || op.id}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '8px 4px', textAlign: 'center' }}>
                      {bulkRows.length > 1 && (
                        <button type="button" onClick={() => removeBulkRow(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: '4px' }}>
                          <Icon name="close" size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button type="button" onClick={addBulkRow} style={{
                  background: 'none', border: `1px dashed ${THEME.outline}`, borderRadius: '8px',
                  padding: '6px 14px', cursor: 'pointer', fontSize: '12px', color: FUEL_CLR, fontWeight: 600, fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <Icon name="add" size={14} style={{ color: FUEL_CLR }} /> Add Row
                </button>
                <button type="button" onClick={() => setBulkRows(Array.from({ length: 5 }, () => makeBulkRow()))} style={{
                  background: 'none', border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px',
                  padding: '6px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textLow, fontWeight: 500, fontFamily: 'inherit',
                }}>
                  Reset
                </button>
              </div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: bulkOverdraw ? THEME.error : FUEL_CLR }}>
                Total: {bulkTotal.toFixed(1)} L
                {bulkTank && <span style={{ fontSize: '11px', color: THEME.textLow, marginLeft: '8px' }}>of {bulkTankLevel.toFixed(0)} L available</span>}
              </div>
            </div>
          </div>

          {bulkOverdraw && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderRadius: '12px', background: THEME.statusErrorBg, border: `1px solid ${THEME.error}55`, marginBottom: '16px' }}>
              <Icon name="warning" size={18} style={{ color: THEME.error, flexShrink: 0 }} />
              <span style={{ fontSize: '13px', color: THEME.statusErrorText, fontWeight: 500 }}>
                Total ({bulkTotal.toFixed(1)} L) exceeds tank level ({bulkTankLevel.toFixed(1)} L).
              </span>
            </div>
          )}

          <button type="submit" disabled={bulkSaving || bulkOverdraw} style={{
            width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
            background: (bulkSaving || bulkOverdraw) ? THEME.outline : FUEL_CLR,
            color: '#fff', fontSize: '15px', fontWeight: 700, cursor: (bulkSaving || bulkOverdraw) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
          }}>
            {bulkSaving ? (
              <><Icon name="progress_activity" size={18} style={{ color: '#fff', animation: 'spin 1s linear infinite' }} /> Recording…</>
            ) : (
              <><Icon name="output" size={18} style={{ color: '#fff' }} /> Issue {validCount} Issuance{validCount !== 1 ? 's' : ''}</>
            )}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', maxWidth: '1000px', alignItems: 'start' }}>

      {/* ── Left: form ────────────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text }}>Issue Fuel</div>
            <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>Fill in all required fields and submit to record the issuance.</div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: THEME.textMed, background: THEME.surfaceVar, padding: '8px 14px', borderRadius: '10px', border: `1px solid ${THEME.outlineVar}` }}>
            <input type="checkbox" checked={bulkMode} onChange={() => setBulkMode(true)} style={{ accentColor: FUEL_CLR }} />
            Bulk Mode
          </label>
        </div>

        <form onSubmit={submit}>
          {/* Request reference banner — shown when prefilled from FuelRequests or required by settings */}
          {(linkedRequest || requireApproval) && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              padding: '14px 16px', borderRadius: '12px', marginBottom: '20px',
              background: linkedRequest ? FUEL_CLR + '14' : THEME.statusWarningBg,
              border: `1px solid ${linkedRequest ? FUEL_CLR + '44' : THEME.warning + '55'}`,
            }}>
              <Icon name={linkedRequest ? 'link' : 'warning'} size={18} style={{ color: linkedRequest ? FUEL_CLR : THEME.warning, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                {linkedRequest ? (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: FUEL_CLR }}>
                      Issuing against Request {linkedRequest.request_number}
                    </div>
                    <div style={{ fontSize: '11px', color: THEME.textMed, marginTop: '2px' }}>
                      Vehicle/equipment and quantity pre-filled from the approved request. Adjust if needed.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.warning }}>
                      Approval required
                    </div>
                    <div style={{ fontSize: '11px', color: THEME.textMed, marginTop: '2px' }}>
                      This site requires an approved fuel request before issuing.{' '}
                      <span
                        onClick={() => setPage('fuel_requests_list')}
                        style={{ color: FUEL_CLR, cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        View requests
                      </span>
                    </div>
                  </>
                )}
              </div>
              {linkedRequest && (
                <button
                  type="button"
                  onClick={() => { setLinkedRequest(null); setFormState(BLANK) }}
                  title="Clear request link"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: '4px' }}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          )}

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
                { v: 'generator', icon: 'bolt',           label: 'Generator' },
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
              <>
                <SearchSelect
                  items={activeVehicles}
                  value={form.vehicle_id}
                  onSelect={id => set('vehicle_id', id)}
                  placeholder="Search by fleet # or registration…"
                  renderItem={v => `${v.fleet_number}${v.registration ? ' · ' + v.registration : ''}${v.fuel_types?.name ? ' · ' + v.fuel_types.name : ''}`}
                  renderSelected={v => `${v.fleet_number}${v.registration ? ' (' + v.registration + ')' : ''}`}
                />
                <div style={{ marginTop: '10px' }}>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px' }}>
                    Vehicle odometer reading (km) <span style={{ color: THEME.error }}>*</span>
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min="0"
                    value={form.odometer_km}
                    onChange={e => set('odometer_km', e.target.value)}
                    placeholder="e.g. 128450"
                    style={inp({ borderColor:
                      (form.vehicle_id && !form.odometer_km) ||
                      (lastKnownOdometer != null && form.odometer_km && Number(form.odometer_km) < lastKnownOdometer)
                        ? THEME.error : THEME.outline })}
                  />
                  {lastKnownOdometer != null && form.odometer_km && Number(form.odometer_km) < lastKnownOdometer ? (
                    <div style={{ fontSize: '11px', color: THEME.error, marginTop: '4px', fontWeight: 600 }}>
                      Below the last recorded reading ({lastKnownOdometer.toLocaleString()} km) — check for a typo.
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>
                      {lastKnownOdometer != null
                        ? `Last recorded: ${lastKnownOdometer.toLocaleString()} km. `
                        : ''}
                      Read directly from the dashboard cluster. Used for L/100km monitoring.
                    </div>
                  )}
                </div>
              </>
            )}
            {form.asset_type === 'equipment' && (
              <SearchSelect
                items={activeNonGenEquipment}
                value={form.equipment_id}
                onSelect={id => set('equipment_id', id)}
                placeholder="Search by fleet # or description…"
                renderItem={eqLabel}
                renderSelected={eqLabel}
              />
            )}
            {form.asset_type === 'generator' && (
              <SearchSelect
                items={activeGenerators}
                value={form.equipment_id}
                onSelect={id => set('equipment_id', id)}
                placeholder="Search generators…"
                renderItem={eqLabel}
                renderSelected={eqLabel}
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

          {/* ── 8. Manual-authorisation fields (no linked request) ───────── */}
          {!linkedRequest && (
            <>
              <InfoPanel icon="verified_user" color={THEME.warning}>
                No fuel request linked. Record who authorised this issuance and the reason —
                an approver will acknowledge it after the fact.
              </InfoPanel>
              <FieldWrap label="Authorised By" required>
                <select
                  value={form.authorised_by_name}
                  onChange={e => set('authorised_by_name', e.target.value)}
                  style={inp()}
                >
                  <option value="">— Select —</option>
                  {employees.filter(emp => emp.status === 'active').map(emp => (
                    <option key={emp.id} value={emp.name}>{emp.name}</option>
                  ))}
                </select>
              </FieldWrap>
              <FieldWrap label="Reason / Emergency Justification" required>
                <textarea
                  value={form.authorisation_reason}
                  onChange={e => set('authorisation_reason', e.target.value)}
                  placeholder="e.g. Emergency medivac — Manager approved verbally over radio."
                  rows={2}
                  style={{ ...inp(), resize: 'vertical' }}
                />
              </FieldWrap>
            </>
          )}

          {/* ── 9. Notes ─────────────────────────────────────────────────── */}
          <FieldWrap label="Notes">
            <textarea
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              placeholder="Purpose, destination, additional info…"
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
          borderRadius: '10px', padding: '20px', boxShadow: THEME.shadow1,
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
