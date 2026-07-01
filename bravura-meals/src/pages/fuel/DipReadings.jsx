import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useFuel } from '../../contexts/FuelContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'

const COLOR = MODULE_COLORS.fuel

const Icon = ({ name, size = 18, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', color: 'inherit', ...style }}>{name}</span>
)

const btn = (extra = {}) => ({
  border: 'none', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 600, fontSize: '13px', padding: '8px 16px',
  display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'opacity .15s',
  ...extra,
})

function interpolate(calibration, mm) {
  if (!calibration || calibration.length === 0) return null
  const sorted = [...calibration].sort((a, b) => a.dip_mm - b.dip_mm)
  if (mm <= sorted[0].dip_mm) return sorted[0].level_litres
  if (mm >= sorted[sorted.length - 1].dip_mm) return sorted[sorted.length - 1].level_litres
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1]
    if (mm >= lo.dip_mm && mm <= hi.dip_mm) {
      const t = (mm - lo.dip_mm) / (hi.dip_mm - lo.dip_mm)
      return lo.level_litres + t * (hi.level_litres - lo.level_litres)
    }
  }
  return null
}

// ── Calibration Panel ─────────────────────────────────────────────────────────
function TankCalibrationPanel({ tank, onClose }) {
  const [rows, setRows] = useState([])
  const [unit, setUnit] = useState('mm')
  const [depthInput, setDepthInput] = useState('')
  const [litresInput, setLitresInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const fileRef = useRef()

  const toMm = v => {
    const n = parseFloat(v)
    if (isNaN(n)) return null
    if (unit === 'cm') return n * 10
    if (unit === 'm') return n * 1000
    return n
  }
  const fromMm = mm => {
    if (unit === 'cm') return (mm / 10).toFixed(3)
    if (unit === 'm') return (mm / 1000).toFixed(4)
    return Number(mm).toFixed(1)
  }

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('tank_calibrations')
      .select('*')
      .eq('tank_id', tank.id)
      .order('dip_mm', { ascending: true })
    setRows(data || [])
  }, [tank.id])

  useEffect(() => { load() }, [load])

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const addRow = async () => {
    const mm = toMm(depthInput)
    const litres = parseFloat(litresInput)
    if (!mm || mm <= 0 || isNaN(litres) || litres < 0) {
      showToast('Enter valid depth and litres', 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('tank_calibrations').upsert(
      { tank_id: tank.id, dip_mm: mm, level_litres: litres },
      { onConflict: 'tank_id,dip_mm' }
    )
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }
    setDepthInput(''); setLitresInput('')
    load()
  }

  const deleteRow = async (id) => {
    await supabase.from('tank_calibrations').delete().eq('id', id)
    load()
  }

  const handleCsv = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    let dataLines = lines
    let csvUnit = unit

    const header = lines[0].toLowerCase()
    if (/[a-z]/.test(header)) {
      dataLines = lines.slice(1)
      if (header.includes('_m,') || header.startsWith('m,')) csvUnit = 'm'
      else if (header.includes('cm')) csvUnit = 'cm'
      else csvUnit = 'mm'
    }

    const convert = v => {
      const n = parseFloat(v)
      if (isNaN(n)) return null
      if (csvUnit === 'cm') return n * 10
      if (csvUnit === 'm') return n * 1000
      return n
    }

    const upserts = []
    for (const line of dataLines) {
      const [d, l] = line.split(',')
      const mm = convert(d)
      const litres = parseFloat(l)
      if (mm && !isNaN(litres)) upserts.push({ tank_id: tank.id, dip_mm: mm, level_litres: litres })
    }
    if (!upserts.length) { showToast('No valid rows found in CSV', 'error'); return }

    const { error } = await supabase.from('tank_calibrations').upsert(upserts, { onConflict: 'tank_id,dip_mm' })
    if (error) { showToast(error.message, 'error'); return }
    showToast(`Imported ${upserts.length} calibration points`)
    load()
    e.target.value = ''
  }

  const unitLabel = unit

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: THEME.surface, borderRadius: '10px', width: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: THEME.shadow3, position: 'relative' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Calibration Table</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{tank.tank_name} — depth → litres</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed, borderRadius: '8px', padding: '4px' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '12px 24px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 500 }}>Display unit:</span>
          {['mm', 'cm', 'm'].map(u => (
            <button key={u} onClick={() => setUnit(u)} style={{
              ...btn({ padding: '4px 12px', fontSize: '12px' }),
              background: unit === u ? COLOR : THEME.surfaceVar,
              color: unit === u ? '#fff' : THEME.textMed,
            }}>{u}</button>
          ))}
          <div style={{ flex: 1 }} />
          <label style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed, cursor: 'pointer', fontSize: '12px' }) }}>
            <Icon name="upload_file" size={14} /> Import CSV
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCsv} />
          </label>
        </div>

        <div style={{ padding: '12px 24px', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Depth ({unitLabel})</label>
            <input
              value={depthInput}
              onChange={e => setDepthInput(e.target.value)}
              placeholder={unit === 'mm' ? '500' : unit === 'cm' ? '50' : '0.5'}
              type="number" step="any"
              style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Litres</label>
            <input
              value={litresInput}
              onChange={e => setLitresInput(e.target.value)}
              placeholder="1200"
              type="number" step="any"
              style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', boxSizing: 'border-box' }}
            />
          </div>
          <button onClick={addRow} disabled={saving} style={{ ...btn({ background: COLOR, color: '#fff' }), flexShrink: 0 }}>
            <Icon name="add" size={15} /> Add
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 24px 20px' }}>
          {rows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow, fontSize: '13px' }}>No calibration points yet. Add rows manually or import a CSV.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 0', color: THEME.textMed, fontWeight: 600, fontSize: '11px' }}>Depth ({unitLabel})</th>
                  <th style={{ textAlign: 'right', padding: '8px 0', color: THEME.textMed, fontWeight: 600, fontSize: '11px' }}>Litres</th>
                  <th style={{ width: '32px' }} />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '7px 0', color: THEME.text }}>{fromMm(r.dip_mm)}</td>
                    <td style={{ padding: '7px 0', color: THEME.text, textAlign: 'right' }}>{Number(r.level_litres).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                    <td style={{ padding: '7px 0', textAlign: 'right' }}>
                      <button onClick={() => deleteRow(r.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textLow, borderRadius: '6px', padding: '2px' }}>
                        <Icon name="delete" size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {toast && (
          <div style={{
            position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            background: toast.type === 'error' ? THEME.error : THEME.success,
            color: '#fff', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 500,
            boxShadow: THEME.shadow2, whiteSpace: 'nowrap',
          }}>{toast.msg}</div>
        )}
      </div>
    </div>
  )
}

// ── Record Dip Modal ──────────────────────────────────────────────────────────
function RecordDipModal({ tanks, operators, currentSiteId, onClose, onSaved }) {
  const [tankId, setTankId] = useState(tanks[0]?.id || '')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState(new Date().toTimeString().slice(0, 5))
  const [shift, setShift] = useState('')
  const [dipMm, setDipMm] = useState('')
  const [levelLitres, setLevelLitres] = useState('')
  const [manualLitres, setManualLitres] = useState(false)
  const [notes, setNotes] = useState('')
  const [readBy, setReadBy] = useState('')
  const [calibration, setCalibration] = useState([])
  const [systemLevel, setSystemLevel] = useState(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [saving, setSaving] = useState(false)

  const calcedLitres = calibration.length > 0 && dipMm !== '' ? interpolate(calibration, parseFloat(dipMm)) : null

  useEffect(() => {
    if (!tankId) return
    supabase.from('tank_calibrations').select('dip_mm,level_litres').eq('tank_id', tankId)
      .then(({ data }) => setCalibration(data || []))
    supabase.from('fuel_tanks').select('current_level_litres').eq('id', tankId).single()
      .then(({ data }) => setSystemLevel(data?.current_level_litres ?? null))
  }, [tankId])

  useEffect(() => {
    if (!manualLitres && calcedLitres !== null) {
      setLevelLitres(calcedLitres.toFixed(1))
    }
  }, [calcedLitres, manualLitres])

  const displayLitres = parseFloat(levelLitres)
  const variance = (!isNaN(displayLitres) && systemLevel != null) ? displayLitres - systemLevel : null
  const variancePct = (variance != null && systemLevel > 0) ? (variance / systemLevel) * 100 : null
  const highVariance = variancePct != null && Math.abs(variancePct) > 5

  const canSave = tankId && date && levelLitres !== '' && !isNaN(displayLitres) && (!highVariance || (acknowledged && notes.trim()))

  const save = async () => {
    setSaving(true)
    const level = parseFloat(levelLitres)
    const varL = systemLevel != null ? level - systemLevel : null
    const varP = (varL != null && systemLevel > 0) ? (varL / systemLevel) * 100 : null
    const { error } = await supabase.from('fuel_dip_readings').insert({
      site_id: currentSiteId,
      tank_id: tankId,
      reading_date: date,
      reading_time: time || null,
      shift: shift || null,
      dip_mm: dipMm !== '' ? parseFloat(dipMm) : null,
      level_litres: level,
      system_level_litres: systemLevel,
      variance_litres: varL,
      variance_percent: varP,
      read_by: readBy || null,
      notes: notes || null,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  const inputStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }
  const selectStyle = { ...inputStyle }

  const Field = ({ label, children }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{label}</label>
      {children}
    </div>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: THEME.surface, borderRadius: '10px', width: '500px', maxHeight: '90vh', overflowY: 'auto', boxShadow: THEME.shadow3 }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: THEME.surface, zIndex: 1 }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Record Dip Reading</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Tank">
            <select value={tankId} onChange={e => setTankId(e.target.value)} style={selectStyle}>
              {tanks.map(t => <option key={t.id} value={t.id}>{t.tank_name}</option>)}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Date">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Time">
              <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field label="Shift">
            <select value={shift} onChange={e => setShift(e.target.value)} style={selectStyle}>
              <option value="">— Select shift (optional) —</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="night">Night</option>
            </select>
          </Field>

          <Field label="Dip Reading (mm)">
            <input
              type="number" step="0.1" value={dipMm}
              onChange={e => setDipMm(e.target.value)}
              placeholder="e.g. 850"
              style={inputStyle}
            />
            {calibration.length === 0 && dipMm && (
              <div style={{ fontSize: '11px', color: THEME.warning, marginTop: '2px' }}>No calibration table — litres will not auto-calculate</div>
            )}
          </Field>

          <Field label="Level (litres)">
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="number" step="0.001" value={levelLitres}
                onChange={e => setLevelLitres(e.target.value)}
                readOnly={!manualLitres && calcedLitres !== null}
                style={{ ...inputStyle, flex: 1, background: !manualLitres && calcedLitres !== null ? THEME.surfaceVar : undefined }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: THEME.textMed, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <input type="checkbox" checked={manualLitres} onChange={e => { setManualLitres(e.target.checked); if (!e.target.checked && calcedLitres !== null) setLevelLitres(calcedLitres.toFixed(1)) }} />
                Manual
              </label>
            </div>
            {!manualLitres && calcedLitres !== null && (
              <div style={{ fontSize: '11px', color: THEME.textMed, marginTop: '2px' }}>Auto-calculated from calibration table</div>
            )}
          </Field>

          {variance !== null && (
            <div style={{
              background: highVariance ? THEME.statusErrorBg : THEME.statusSuccessBg,
              border: `1px solid ${highVariance ? THEME.error + '44' : THEME.success + '44'}`,
              borderRadius: '10px', padding: '12px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: highVariance ? THEME.error : THEME.success }}>
                  Variance vs system level
                </div>
                <div style={{ fontSize: '13px', fontWeight: 700, color: highVariance ? THEME.error : THEME.success }}>
                  {variance >= 0 ? '+' : ''}{Number(variance).toFixed(1)} L &nbsp;({variancePct >= 0 ? '+' : ''}{Number(variancePct).toFixed(1)}%)
                </div>
              </div>
              <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '4px' }}>
                System level: {Number(systemLevel).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L
              </div>
              {highVariance && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: THEME.error, fontWeight: 500 }}>
                  Variance exceeds ±5% — notes and acknowledgment required before saving.
                </div>
              )}
            </div>
          )}

          <Field label="Read By">
            <select value={readBy} onChange={e => setReadBy(e.target.value)} style={selectStyle}>
              <option value="">— Select operator —</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            </select>
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder={highVariance ? 'Required — explain the variance' : 'Optional notes'}
              style={{ ...inputStyle, resize: 'vertical', border: `1px solid ${highVariance && !notes.trim() ? THEME.error : THEME.outline}` }}
            />
          </Field>

          {highVariance && (
            <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer', fontSize: '13px', color: THEME.text }}>
              <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} style={{ marginTop: '2px', flexShrink: 0 }} />
              I acknowledge this variance is outside the ±5% threshold and have provided an explanation in the notes.
            </label>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', position: 'sticky', bottom: 0, background: THEME.surface }}>
          <button onClick={onClose} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>Cancel</button>
          <button onClick={save} disabled={!canSave || saving} style={{ ...btn({ background: COLOR, color: '#fff', opacity: (!canSave || saving) ? 0.5 : 1 }) }}>
            <Icon name="save" size={15} /> Save Reading
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DipReadings() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { tanks, operators } = useFuel()

  const [readings, setReadings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterTank, setFilterTank] = useState('')
  const [filterShift, setFilterShift] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [showRecord, setShowRecord] = useState(false)
  const [calibTank, setCalibTank] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('fuel_dip_readings')
      .select('*, tank:fuel_tanks(tank_name), operator:fuel_operators(full_name)')
      .eq('site_id', currentSiteId)
      .order('reading_date', { ascending: false })
      .order('reading_time', { ascending: false })
    if (filterTank) q = q.eq('tank_id', filterTank)
    if (filterShift) q = q.eq('shift', filterShift)
    if (filterFrom) q = q.gte('reading_date', filterFrom)
    if (filterTo) q = q.lte('reading_date', filterTo)
    const { data } = await q
    setReadings(data || [])
    setLoading(false)
  }, [currentSiteId, filterTank, filterShift, filterFrom, filterTo])

  useEffect(() => { load() }, [load])

  const fmtNum = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'
  const varianceColor = pct => {
    if (pct == null) return THEME.textLow
    if (Math.abs(pct) > 5) return THEME.error
    if (Math.abs(pct) > 2) return THEME.warning
    return THEME.success
  }

  const filterSelectStyle = { padding: '7px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '12px', fontFamily: 'inherit' }
  const filterInputStyle = { ...filterSelectStyle }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Dip Readings</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>Manual tank dip measurements by shift</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {can('fuel.edit') && (
            <select
              value={calibTank?.id || ''}
              onChange={e => setCalibTank(tanks.find(t => t.id === e.target.value) || null)}
              style={filterSelectStyle}
            >
              <option value="">Calibration Table…</option>
              {tanks.map(t => <option key={t.id} value={t.id}>{t.tank_name}</option>)}
            </select>
          )}
          {can('fuel.create') && (
            <button onClick={() => setShowRecord(true)} style={{ ...btn({ background: COLOR, color: '#fff' }) }}>
              <Icon name="add" size={15} /> Record Dip
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
        <select value={filterTank} onChange={e => setFilterTank(e.target.value)} style={filterSelectStyle}>
          <option value="">All Tanks</option>
          {tanks.map(t => <option key={t.id} value={t.id}>{t.tank_name}</option>)}
        </select>
        <select value={filterShift} onChange={e => setFilterShift(e.target.value)} style={filterSelectStyle}>
          <option value="">All Shifts</option>
          <option value="morning">Morning</option>
          <option value="afternoon">Afternoon</option>
          <option value="night">Night</option>
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={filterInputStyle} />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={filterInputStyle} />
        {(filterTank || filterShift || filterFrom || filterTo) && (
          <button onClick={() => { setFilterTank(''); setFilterShift(''); setFilterFrom(''); setFilterTo('') }}
            style={{ ...btn({ background: 'transparent', color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="close" size={13} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1 }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
        ) : readings.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <Icon name="straighten" size={40} style={{ color: THEME.textLow, display: 'block', margin: '0 auto 12px' }} />
            <div style={{ fontSize: '14px', color: THEME.textMed }}>No dip readings recorded</div>
            {can('fuel.create') && (
              <button onClick={() => setShowRecord(true)} style={{ ...btn({ background: COLOR, color: '#fff', marginTop: '16px' }) }}>
                <Icon name="add" size={15} /> Record First Dip
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  {['Tank', 'Date', 'Shift', 'Dip (mm)', 'Level (L)', 'System (L)', 'Variance', 'Read By', 'Notes'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readings.map(r => {
                  const pct = r.variance_percent
                  const clr = varianceColor(pct)
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{r.tank?.tank_name || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, whiteSpace: 'nowrap' }}>
                        {new Date(r.reading_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        {r.reading_time && <span style={{ color: THEME.textMed, marginLeft: '6px', fontSize: '11px' }}>{r.reading_time.slice(0, 5)}</span>}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {r.shift ? (
                          <span style={{
                            padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                            background: r.shift === 'morning' ? '#FEF3C7' : r.shift === 'afternoon' ? '#DBEAFE' : '#1e293b',
                            color: r.shift === 'morning' ? '#92400E' : r.shift === 'afternoon' ? '#1E40AF' : '#94a3b8',
                          }}>{r.shift.charAt(0).toUpperCase() + r.shift.slice(1)}</span>
                        ) : <span style={{ color: THEME.textLow }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.text }}>{r.dip_mm != null ? fmtNum(r.dip_mm, 1) : <span style={{ color: THEME.textLow }}>—</span>}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{fmtNum(r.level_litres, 1)}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{r.system_level_litres != null ? fmtNum(r.system_level_litres, 1) : <span style={{ color: THEME.textLow }}>—</span>}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {pct != null ? (
                          <span style={{ color: clr, fontWeight: 600, fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            {pct >= 0 ? '+' : ''}{Number(pct).toFixed(1)}%
                            {Math.abs(pct) > 5 && <Icon name="warning" size={13} style={{ color: clr }} />}
                          </span>
                        ) : <span style={{ color: THEME.textLow }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{r.operator?.full_name || <span style={{ color: THEME.textLow }}>—</span>}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.notes || ''}>{r.notes || <span style={{ color: THEME.textLow }}>—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showRecord && (
        <RecordDipModal
          tanks={tanks}
          operators={operators}
          currentSiteId={currentSiteId}
          onClose={() => setShowRecord(false)}
          onSaved={() => { setShowRecord(false); load() }}
        />
      )}

      {calibTank && (
        <TankCalibrationPanel
          tank={calibTank}
          onClose={() => setCalibTank(null)}
        />
      )}
    </div>
  )
}
