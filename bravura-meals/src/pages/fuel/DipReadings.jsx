import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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
  border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 600, fontSize: '13px', padding: '8px 16px',
  display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'opacity .15s',
  ...extra,
})

const inputStyle = { padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '13px', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' }

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

const fmtNum = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'

const Field = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{label}</label>
    {children}
  </div>
)

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
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{tank.name} — depth → litres</div>
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

// ── Dip Form Modal (shared by Record + Edit) ─────────────────────────────────
function DipFormModal({ title, reading, tanks, operators, currentSiteId, onClose, onSave, onDelete }) {
  const isEdit = !!reading

  const [tankId, setTankId] = useState(reading?.tank_id || tanks[0]?.id || '')
  const [date, setDate] = useState(reading?.reading_date || new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState(reading?.reading_time || (isEdit ? '' : new Date().toTimeString().slice(0, 5)))
  const [dipStartMm, setDipStartMm] = useState(reading?.dip_start_mm != null ? String(reading.dip_start_mm) : '')
  const [dipEndMm, setDipEndMm] = useState(
    reading?.dip_end_mm != null ? String(reading.dip_end_mm)
      : reading?.dip_mm != null ? String(reading.dip_mm) : ''
  )
  const [readBy, setReadBy] = useState(reading?.read_by || '')
  const [notes, setNotes] = useState(reading?.notes || '')
  const [calibration, setCalibration] = useState([])
  const [saving, setSaving] = useState(false)

  const calcedStartLitres = calibration.length > 0 && dipStartMm !== '' ? interpolate(calibration, parseFloat(dipStartMm)) : null
  const calcedEndLitres = calibration.length > 0 && dipEndMm !== '' ? interpolate(calibration, parseFloat(dipEndMm)) : null

  useEffect(() => {
    if (!tankId) return
    supabase.from('tank_calibrations').select('dip_mm,level_litres').eq('tank_id', tankId)
      .then(({ data }) => setCalibration(data || []))
  }, [tankId])

  const hasEndMm = dipEndMm !== '' && !isNaN(parseFloat(dipEndMm))
  const canSave = tankId && date && hasEndMm

  const save = async () => {
    setSaving(true)
    try {
      const levelEnd = calcedEndLitres
      const levelStart = calcedStartLitres

      const payload = {
        tank_id: tankId,
        reading_date: date,
        reading_time: time || null,
        dip_mm: dipEndMm !== '' ? parseFloat(dipEndMm) : null,
        level_litres: levelEnd ?? (dipEndMm !== '' ? parseFloat(dipEndMm) : null),
        dip_start_mm: dipStartMm !== '' ? parseFloat(dipStartMm) : null,
        dip_end_mm: dipEndMm !== '' ? parseFloat(dipEndMm) : null,
        level_start_litres: levelStart,
        level_end_litres: levelEnd ?? (dipEndMm !== '' ? parseFloat(dipEndMm) : null),
        read_by: readBy || null,
        notes: notes || null,
      }

      if (isEdit) {
        await onSave(reading.id, payload)
      } else {
        payload.site_id = currentSiteId
        const { error } = await supabase.from('fuel_dip_readings').insert(payload)
        if (error) throw error
        onSave()
      }
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Permanently delete this dip reading? This action is logged in the audit trail and cannot be undone.')) return
    setSaving(true)
    try {
      await onDelete(reading.id)
      onClose()
    } catch (err) {
      alert(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: THEME.surface, borderRadius: '10px', width: '500px', maxHeight: '90vh', overflowY: 'auto', boxShadow: THEME.shadow3 }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: THEME.surface, zIndex: 1 }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>{title}</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {isEdit && (
            <div style={{ padding: '10px 14px', borderRadius: '10px', background: THEME.statusWarningBg, fontSize: '12px', color: THEME.statusWarningText, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="info" size={14} style={{ color: 'inherit', flexShrink: 0 }} />
              Changes are recorded in the audit log with before/after snapshots.
            </div>
          )}

          <Field label="Tank">
            <select value={tankId} onChange={e => setTankId(e.target.value)} style={inputStyle}>
              {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
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

          {/* Dip Start & End — user enters mm, litres auto-calc from calibration */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ padding: '12px 14px', borderRadius: '10px', background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}` }}>
              <Field label="Dip Start (mm)">
                <input type="number" step="0.1" value={dipStartMm}
                  onChange={e => setDipStartMm(e.target.value)}
                  placeholder="e.g. 920" style={inputStyle} />
              </Field>
              {calcedStartLitres != null && (
                <div style={{ fontSize: '12px', color: THEME.success, marginTop: '8px', fontWeight: 500 }}>
                  = {fmtNum(calcedStartLitres, 1)} litres
                </div>
              )}
              {calibration.length === 0 && dipStartMm && (
                <div style={{ fontSize: '11px', color: THEME.warning, marginTop: '6px' }}>No calibration table</div>
              )}
            </div>

            <div style={{ padding: '12px 14px', borderRadius: '10px', background: THEME.surfaceVar, border: `1px solid ${COLOR}33` }}>
              <Field label="Dip End (mm)">
                <input type="number" step="0.1" value={dipEndMm}
                  onChange={e => setDipEndMm(e.target.value)}
                  placeholder="e.g. 850" style={inputStyle} />
              </Field>
              {calcedEndLitres != null && (
                <div style={{ fontSize: '12px', color: THEME.success, marginTop: '8px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Icon name="local_gas_station" size={13} style={{ color: THEME.success }} />
                  = {fmtNum(calcedEndLitres, 1)} litres → new tank level
                </div>
              )}
              {calibration.length === 0 && dipEndMm && (
                <div style={{ fontSize: '11px', color: THEME.warning, marginTop: '6px' }}>No calibration table</div>
              )}
            </div>
          </div>

          <Field label="Read By">
            <select value={readBy} onChange={e => setReadBy(e.target.value)} style={inputStyle}>
              <option value="">— Select operator —</option>
              {operators.map(o => <option key={o.id} value={o.id}>{o.employees?.name || o.id}</option>)}
            </select>
          </Field>

          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Optional notes"
              style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
        </div>

        <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', bottom: 0, background: THEME.surface }}>
          {isEdit && onDelete ? (
            <button onClick={handleDelete} disabled={saving} style={{ ...btn({ background: 'transparent', color: THEME.error, border: `1px solid ${THEME.error}` }) }}>
              <Icon name="delete_forever" size={15} style={{ color: THEME.error }} /> Delete
            </button>
          ) : <div />}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>Cancel</button>
            <button onClick={save} disabled={!canSave || saving} style={{ ...btn({ background: COLOR, color: '#fff', opacity: (!canSave || saving) ? 0.5 : 1 }) }}>
              <Icon name="save" size={15} /> {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Save Reading'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DipReadings() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { tanks, operators, updateDipReading, deleteDipReading, refresh: refreshFuel } = useFuel()

  const [readings, setReadings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterTank, setFilterTank] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [showRecord, setShowRecord] = useState(false)
  const [calibTank, setCalibTank] = useState(null)
  const [editDip, setEditDip] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('fuel_dip_readings')
      .select('*, tank:fuel_tanks(name), operator:fuel_operators(employees(name))')
      .eq('site_id', currentSiteId)
      .order('reading_date', { ascending: false })
      .order('reading_time', { ascending: false })
    if (filterTank) q = q.eq('tank_id', filterTank)
    if (filterFrom) q = q.gte('reading_date', filterFrom)
    if (filterTo) q = q.lte('reading_date', filterTo)
    const { data } = await q
    setReadings(data || [])
    setLoading(false)
  }, [currentSiteId, filterTank, filterFrom, filterTo])

  useEffect(() => { load() }, [load])

  const derived = useMemo(() => {
    return readings.map(r => {
      const dipStartMm = r.dip_start_mm != null ? Number(r.dip_start_mm) : null
      const dipEndMm = r.dip_end_mm != null ? Number(r.dip_end_mm) : (r.dip_mm != null ? Number(r.dip_mm) : null)
      const fuelStart = r.level_start_litres != null ? Number(r.level_start_litres) : null
      const fuelEnd = r.level_end_litres != null ? Number(r.level_end_litres) : (r.level_litres != null ? Number(r.level_litres) : null)
      return { r, dipStartMm, dipEndMm, fuelStart, fuelEnd }
    })
  }, [readings])

  const exportCsv = () => {
    const headers = ['Date', 'Time', 'Tank', 'Dip Start (mm)', 'Dip End (mm)', 'Start Level (L)', 'End Level (L)', 'Done By', 'Notes']
    const lines = derived.map(({ r, dipStartMm, dipEndMm, fuelStart, fuelEnd }) => [
      r.reading_date,
      r.reading_time || '',
      r.tank?.name || '',
      dipStartMm != null ? dipStartMm : '',
      dipEndMm != null ? dipEndMm : '',
      fuelStart != null ? fuelStart.toFixed(1) : '',
      fuelEnd != null ? fuelEnd.toFixed(1) : '',
      r.operator?.employees?.name || '',
      (r.notes || '').replace(/,/g, ';'),
    ].map(v => `"${v}"`).join(','))
    const csv = [headers.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dip-readings-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  const filterStyle = { padding: '7px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '12px', fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Dipstick Log</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>
            Manual tank dip measurements
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {can('fuel.edit') && (
            <select value={calibTank?.id || ''} onChange={e => setCalibTank(tanks.find(t => t.id === e.target.value) || null)} style={filterStyle}>
              <option value="">Calibration Table…</option>
              {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <button onClick={exportCsv} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>
            <Icon name="download" size={15} /> Export
          </button>
          {can('fuel.create') && (
            <button onClick={() => setShowRecord(true)} style={{ ...btn({ background: COLOR, color: '#fff' }) }}>
              <Icon name="add" size={15} /> Record Dip
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '10px', border: `1px solid ${THEME.outlineVar}` }}>
        <select value={filterTank} onChange={e => setFilterTank(e.target.value)} style={filterStyle}>
          <option value="">All Tanks</option>
          {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={filterStyle} placeholder="From" />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={filterStyle} placeholder="To" />
        {(filterTank || filterFrom || filterTo) && (
          <button onClick={() => { setFilterTank(''); setFilterFrom(''); setFilterTo('') }}
            style={{ ...btn({ background: 'transparent', color: THEME.textMed, border: `1px solid ${THEME.outline}`, fontSize: '12px', padding: '6px 12px' }) }}>
            <Icon name="close" size={13} /> Clear
          </button>
        )}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '12px', color: THEME.textMed, alignSelf: 'center' }}>
          {derived.length} reading{derived.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div style={{ background: THEME.surface, borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1 }}>
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
                <tr style={{ background: THEME.surfaceVar, borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Date', 'Tank', 'Dip Start (mm)', 'Dip End (mm)', 'Start Level (L)', 'End Level (L)', 'Done By'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: h.includes('(') ? 'right' : 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {derived.map(({ r, dipStartMm, dipEndMm, fuelStart, fuelEnd }) => (
                    <tr key={r.id}
                      style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: can('fuel.edit') ? 'pointer' : 'default' }}
                      onClick={() => can('fuel.edit') && setEditDip(r)}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>
                        {r.reading_date}
                        {r.reading_time && <span style={{ color: THEME.textMed, marginLeft: '6px', fontSize: '11px' }}>{r.reading_time.slice(0, 5)}</span>}
                        {r.notes?.startsWith('Auto-recorded from delivery') && (
                          <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 600, background: '#FFF3E0', color: '#E65100', letterSpacing: '.03em' }}>DELIVERY</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', color: THEME.text, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.tank?.name || '—'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed, textAlign: 'right' }}>{dipStartMm != null ? fmtNum(dipStartMm, 1) : '—'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed, textAlign: 'right' }}>{dipEndMm != null ? fmtNum(dipEndMm, 1) : '—'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.text, textAlign: 'right' }}>{fuelStart != null ? fmtNum(fuelStart, 0) : '—'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.text, textAlign: 'right', fontWeight: 600 }}>{fuelEnd != null ? fmtNum(fuelEnd, 0) : '—'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.operator?.employees?.name || '—'}</td>
                    </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Modal */}
      {showRecord && (
        <DipFormModal
          title="Record Dip Reading"
          tanks={tanks}
          operators={operators}
          currentSiteId={currentSiteId}
          onClose={() => setShowRecord(false)}
          onSave={() => { setShowRecord(false); load(); refreshFuel() }}
        />
      )}

      {/* Edit Modal */}
      {editDip && (
        <DipFormModal
          title="Edit Dip Reading"
          reading={editDip}
          tanks={tanks}
          operators={operators}
          currentSiteId={currentSiteId}
          onClose={() => setEditDip(null)}
          onSave={async (id, data) => { await updateDipReading(id, data); load(); refreshFuel() }}
          onDelete={async (id) => { await deleteDipReading(id); load(); refreshFuel() }}
        />
      )}

      {/* Calibration Panel */}
      {calibTank && (
        <TankCalibrationPanel
          tank={calibTank}
          onClose={() => setCalibTank(null)}
        />
      )}
    </div>
  )
}
