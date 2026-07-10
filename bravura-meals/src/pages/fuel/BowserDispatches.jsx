import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../hooks/usePermissions'
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

const inputStyle = {
  padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
  background: THEME.surfaceVar, color: THEME.text, fontSize: '13px',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

const STATUS_META = {
  dispatched: { label: 'Dispatched', bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  returned:   { label: 'Returned',   bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  cancelled:  { label: 'Cancelled',  bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.dispatched
  return (
    <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: m.bg, color: m.text }}>
      {m.label}
    </span>
  )
}

const Field = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{label}</label>
    {children}
  </div>
)

// ── Dispatch Modal ────────────────────────────────────────────────────────────
function DispatchModal({ bowsers, currentSiteId, profileId, onClose, onSaved }) {
  const [bowserId, setBowserId] = useState(bowsers[0]?.id || '')
  const [destination, setDestination] = useState('')
  const [gpsLat, setGpsLat] = useState('')
  const [gpsLng, setGpsLng] = useState('')
  const [driverId, setDriverId] = useState('')
  const [dispatchDate, setDispatchDate] = useState(new Date().toISOString().slice(0, 10))
  const [dispatchTime, setDispatchTime] = useState(new Date().toTimeString().slice(0, 5))
  const [litresAtDispatch, setLitresAtDispatch] = useState('')
  const [notes, setNotes] = useState('')
  const [employees, setEmployees] = useState([])
  const [saving, setSaving] = useState(false)
  const [dispatchNo, setDispatchNo] = useState('')

  useEffect(() => {
    supabase.from('employees').select('id, name')
      .eq('site_id', currentSiteId).eq('status', 'active').order('name')
      .then(({ data }) => setEmployees(data || []))

    // Generate dispatch number
    supabase.from('bowser_dispatches').select('dispatch_number')
      .eq('site_id', currentSiteId).order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.length) {
          const last = data[0].dispatch_number
          const num = parseInt(last.replace(/\D/g, ''), 10)
          setDispatchNo(`BD-${String(num + 1).padStart(4, '0')}`)
        } else {
          setDispatchNo('BD-0001')
        }
      })

    // Pre-fill litres from selected bowser current level
    if (bowserId) {
      const b = bowsers.find(b => b.id === bowserId)
      if (b?.current_level_litres != null) setLitresAtDispatch(String(b.current_level_litres))
    }
  }, [currentSiteId])

  useEffect(() => {
    const b = bowsers.find(b => b.id === bowserId)
    if (b?.current_level_litres != null) setLitresAtDispatch(String(b.current_level_litres))
  }, [bowserId, bowsers])

  const canSave = bowserId && destination.trim() && dispatchDate

  const save = async () => {
    setSaving(true)
    const { error } = await supabase.from('bowser_dispatches').insert({
      site_id: currentSiteId,
      bowser_id: bowserId,
      dispatch_number: dispatchNo,
      dispatched_to: destination.trim(),
      dispatched_to_gps_lat: gpsLat ? parseFloat(gpsLat) : null,
      dispatched_to_gps_lng: gpsLng ? parseFloat(gpsLng) : null,
      driver_id: driverId || null,
      dispatch_date: dispatchDate,
      dispatch_time: dispatchTime || null,
      litres_at_dispatch: litresAtDispatch ? parseFloat(litresAtDispatch) : null,
      notes: notes || null,
      status: 'dispatched',
      created_by: profileId,
    })
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: THEME.surface, borderRadius: '10px', width: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: THEME.shadow3 }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: THEME.surface, zIndex: 1 }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Dispatch Bowser</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>Ref: {dispatchNo}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="close" size={20} /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <Field label="Bowser">
            <select value={bowserId} onChange={e => setBowserId(e.target.value)} style={inputStyle}>
              {bowsers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>

          <Field label="Destination / Location">
            <input value={destination} onChange={e => setDestination(e.target.value)} placeholder="e.g. North Pit" style={inputStyle} />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="GPS Latitude (optional)">
              <input type="number" step="any" value={gpsLat} onChange={e => setGpsLat(e.target.value)} placeholder="-17.8252" style={inputStyle} />
            </Field>
            <Field label="GPS Longitude (optional)">
              <input type="number" step="any" value={gpsLng} onChange={e => setGpsLng(e.target.value)} placeholder="31.0335" style={inputStyle} />
            </Field>
          </div>

          <Field label="Driver">
            <select value={driverId} onChange={e => setDriverId(e.target.value)} style={inputStyle}>
              <option value="">— Select driver (optional) —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Dispatch Date">
              <input type="date" value={dispatchDate} onChange={e => setDispatchDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Dispatch Time">
              <input type="time" value={dispatchTime} onChange={e => setDispatchTime(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field label="Litres at Dispatch">
            <input type="number" step="0.001" value={litresAtDispatch} onChange={e => setLitresAtDispatch(e.target.value)} placeholder="Current tank level" style={inputStyle} />
          </Field>

          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
        </div>

        <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px', position: 'sticky', bottom: 0, background: THEME.surface }}>
          <button onClick={onClose} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>Cancel</button>
          <button onClick={save} disabled={!canSave || saving} style={{ ...btn({ background: COLOR, color: '#fff', opacity: (!canSave || saving) ? 0.5 : 1 }) }}>
            <Icon name="local_shipping" size={15} /> Dispatch
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Return Modal ──────────────────────────────────────────────────────────────
function ReturnModal({ dispatch, onClose, onSaved }) {
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10))
  const [returnTime, setReturnTime] = useState(new Date().toTimeString().slice(0, 5))
  const [litresAtReturn, setLitresAtReturn] = useState('')
  const [notes, setNotes] = useState(dispatch.notes || '')
  const [saving, setSaving] = useState(false)

  const litresIssued = (dispatch.litres_at_dispatch != null && litresAtReturn !== '')
    ? dispatch.litres_at_dispatch - parseFloat(litresAtReturn)
    : null

  const save = async () => {
    if (!returnDate || litresAtReturn === '') return
    setSaving(true)
    const issued = litresIssued != null && litresIssued >= 0 ? litresIssued : null
    const { error } = await supabase.from('bowser_dispatches').update({
      return_date: returnDate,
      return_time: returnTime || null,
      litres_at_return: parseFloat(litresAtReturn),
      litres_issued_onsite: issued,
      status: 'returned',
      notes: notes || null,
    }).eq('id', dispatch.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: THEME.surface, borderRadius: '10px', width: '460px', boxShadow: THEME.shadow3 }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Record Return</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{dispatch.dispatch_number} — {dispatch.dispatched_to}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="close" size={20} /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '12px', fontSize: '13px' }}>
            <div style={{ color: THEME.textMed, fontSize: '11px', fontWeight: 600, marginBottom: '6px' }}>DISPATCH INFO</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: THEME.textMed }}>Litres at dispatch</span>
              <span style={{ color: THEME.text, fontWeight: 600 }}>
                {dispatch.litres_at_dispatch != null ? Number(dispatch.litres_at_dispatch).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' L' : '—'}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Return Date">
              <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Return Time">
              <input type="time" value={returnTime} onChange={e => setReturnTime(e.target.value)} style={inputStyle} />
            </Field>
          </div>

          <Field label="Litres at Return">
            <input type="number" step="0.001" value={litresAtReturn} onChange={e => setLitresAtReturn(e.target.value)} placeholder="Current tank level on return" style={inputStyle} />
          </Field>

          {litresIssued !== null && (
            <div style={{
              background: litresIssued >= 0 ? THEME.statusSuccessBg : THEME.statusErrorBg,
              border: `1px solid ${litresIssued >= 0 ? THEME.success + '44' : THEME.error + '44'}`,
              borderRadius: '10px', padding: '12px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: litresIssued >= 0 ? THEME.success : THEME.error }}>
                Litres issued onsite
              </span>
              <span style={{ fontSize: '18px', fontWeight: 700, color: litresIssued >= 0 ? THEME.success : THEME.error }}>
                {Number(litresIssued).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L
              </span>
            </div>
          )}

          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
          </Field>
        </div>

        <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>Cancel</button>
          <button onClick={save} disabled={!returnDate || litresAtReturn === '' || saving} style={{ ...btn({ background: COLOR, color: '#fff', opacity: (!returnDate || litresAtReturn === '' || saving) ? 0.5 : 1 }) }}>
            <Icon name="check_circle" size={15} /> Record Return
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function BowserDispatches() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { tanks, profile, employees: fuelEmployees } = useFuel()

  const bowsers = tanks.filter(t => t.tank_type === 'bowser')

  const [dispatches, setDispatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterBowser, setFilterBowser] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [showDispatch, setShowDispatch] = useState(false)
  const [returnTarget, setReturnTarget] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('bowser_dispatches')
      .select('*, bowser:fuel_tanks(name)')
      .eq('site_id', currentSiteId)
      .order('dispatch_date', { ascending: false })
      .order('dispatch_time', { ascending: false })
    if (filterBowser) q = q.eq('bowser_id', filterBowser)
    if (filterStatus) q = q.eq('status', filterStatus)
    if (filterFrom) q = q.gte('dispatch_date', filterFrom)
    if (filterTo) q = q.lte('dispatch_date', filterTo)
    const { data } = await q
    setDispatches(data || [])
    setLoading(false)
  }, [currentSiteId, filterBowser, filterStatus, filterFrom, filterTo])

  useEffect(() => { load() }, [load])

  const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'
  const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const selStyle = { padding: '7px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '12px', fontFamily: 'inherit' }

  if (bowsers.length === 0) {
    return (
      <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center', padding: '80px 0' }}>
        <Icon name="local_shipping" size={48} style={{ color: THEME.textLow, display: 'block', margin: '0 auto 16px' }} />
        <div style={{ fontSize: '18px', fontWeight: 500, color: THEME.textMed, marginBottom: '8px' }}>No bowsers configured</div>
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Add a tank with type "bowser" in the Tanks section to start tracking dispatches.</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Bowser Dispatches</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>Track bowser deployments, drivers and litres issued onsite</p>
        </div>
        {can('fuel.create') && (
          <button onClick={() => setShowDispatch(true)} style={{ ...btn({ background: COLOR, color: '#fff' }) }}>
            <Icon name="local_shipping" size={15} /> Dispatch Bowser
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Currently Dispatched', value: dispatches.filter(d => d.status === 'dispatched').length, icon: 'directions_car', color: THEME.warning },
          { label: 'Returned This Month', value: dispatches.filter(d => d.status === 'returned' && d.return_date?.startsWith(new Date().toISOString().slice(0, 7))).length, icon: 'check_circle', color: THEME.success },
          { label: 'Total Issued (filtered)', value: dispatches.reduce((s, d) => s + (d.litres_issued_onsite || 0), 0).toFixed(0) + ' L', icon: 'local_gas_station', color: COLOR },
        ].map(c => (
          <div key={c.label} style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, padding: '16px 20px', boxShadow: THEME.shadow1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 500 }}>{c.label}</div>
              <Icon name={c.icon} size={18} style={{ color: c.color }} />
            </div>
            <div style={{ fontSize: '24px', fontWeight: 600, color: THEME.text, marginTop: '8px' }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
        <select value={filterBowser} onChange={e => setFilterBowser(e.target.value)} style={selStyle}>
          <option value="">All Bowsers</option>
          {bowsers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
          <option value="">All Statuses</option>
          <option value="dispatched">Dispatched</option>
          <option value="returned">Returned</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={selStyle} />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={selStyle} />
        {(filterBowser || filterStatus || filterFrom || filterTo) && (
          <button onClick={() => { setFilterBowser(''); setFilterStatus(''); setFilterFrom(''); setFilterTo('') }}
            style={{ ...btn({ background: 'transparent', color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="close" size={13} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1 }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
        ) : dispatches.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <Icon name="local_shipping" size={40} style={{ color: THEME.textLow, display: 'block', margin: '0 auto 12px' }} />
            <div style={{ fontSize: '14px', color: THEME.textMed }}>No dispatches found</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  {['Ref #', 'Bowser', 'Destination', 'Driver', 'Date Out', 'Date In', 'At Dispatch', 'At Return', 'Issued Onsite', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dispatches.map(d => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 14px', color: COLOR, fontWeight: 600 }}>{d.dispatch_number}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{d.bowser?.name || '—'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>
                      {d.dispatched_to}
                      {d.dispatched_to_gps_lat && (
                        <div style={{ fontSize: '10px', color: THEME.textLow }}>
                          {Number(d.dispatched_to_gps_lat).toFixed(4)}, {Number(d.dispatched_to_gps_lng).toFixed(4)}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>{(fuelEmployees || []).find(e => e.id === d.driver_id)?.name || '—'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, whiteSpace: 'nowrap' }}>{fmtDate(d.dispatch_date)}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, whiteSpace: 'nowrap' }}>{fmtDate(d.return_date)}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{fmt(d.litres_at_dispatch)} L</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{d.litres_at_return != null ? fmt(d.litres_at_return) + ' L' : '—'}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 600, color: d.litres_issued_onsite != null ? THEME.text : THEME.textLow }}>
                      {d.litres_issued_onsite != null ? fmt(d.litres_issued_onsite) + ' L' : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}><StatusBadge status={d.status} /></td>
                    <td style={{ padding: '10px 14px' }}>
                      {d.status === 'dispatched' && can('fuel.approve') && (
                        <button onClick={() => setReturnTarget(d)} style={{ ...btn({ background: THEME.statusSuccessBg, color: THEME.success, padding: '5px 10px', fontSize: '11px' }) }}>
                          <Icon name="keyboard_return" size={13} /> Return
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showDispatch && (
        <DispatchModal
          bowsers={bowsers}
          currentSiteId={currentSiteId}
          profileId={profile?.id}
          onClose={() => setShowDispatch(false)}
          onSaved={() => { setShowDispatch(false); load() }}
        />
      )}

      {returnTarget && (
        <ReturnModal
          dispatch={returnTarget}
          onClose={() => setReturnTarget(null)}
          onSaved={() => { setReturnTarget(null); load() }}
        />
      )}
    </div>
  )
}
