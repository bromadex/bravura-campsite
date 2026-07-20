import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { ModalOverlay } from '../../components/ui'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.fleet

const EMPTY_FORM = {
  asset_id: '', operator_id: '', trip_date: '', start_time: '', end_time: '',
  destination: '', purpose: '',
  start_km: '', end_km: '',
  notes: '',
}

export default function FleetTrips({ setPage }) {
  const { can } = usePermissions()
  const { assets, employees, trips, loading, fetchAll } = useFleet()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('fleet_trips', { column: 'site_id', value: currentSiteId })

  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filtered = useMemo(() => {
    let list = trips || []
    if (dateFrom) list = list.filter(t => t.trip_date >= dateFrom)
    if (dateTo) list = list.filter(t => t.trip_date <= dateTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t =>
        (t.destination || '').toLowerCase().includes(q) ||
        (t.purpose || '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => (b.trip_date || '').localeCompare(a.trip_date || ''))
  }, [trips, dateFrom, dateTo, search])

  const kpis = useMemo(() => {
    const all = trips || []
    const totalDist = all.reduce((s, t) => s + (t.distance_km || 0), 0)
    const tripsWithDist = all.filter(t => t.distance_km > 0)
    const avgDist = tripsWithDist.length ? totalDist / tripsWithDist.length : 0
    const completed = all.filter(t => t.end_time).length
    return {
      total: all.length,
      totalDist,
      avgDist,
      completed,
    }
  }, [trips])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(trip) {
    setEditId(trip.id)
    setForm({
      asset_id: trip.asset_id || '',
      operator_id: trip.operator_id || '',
      trip_date: trip.trip_date || '',
      start_time: trip.start_time || '',
      end_time: trip.end_time || '',
      destination: trip.destination || '',
      purpose: trip.purpose || '',
      start_km: trip.start_km ?? '',
      end_km: trip.end_km ?? '',
      notes: trip.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_id || !form.operator_id || !form.trip_date) {
      setError('Asset, operator, and trip date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        asset_id: form.asset_id,
        operator_id: form.operator_id,
        trip_date: form.trip_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        destination: form.destination || null,
        purpose: form.purpose || null,
        start_km: form.start_km !== '' ? Number(form.start_km) : null,
        end_km: form.end_km !== '' ? Number(form.end_km) : null,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_trips').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_trips').insert(payload)
        if (err) throw err
      }
      await fetchAll()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const calcDistance = useMemo(() => {
    const s = Number(form.start_km)
    const e = Number(form.end_km)
    if (s > 0 && e > 0 && e > s) return (e - s).toFixed(1)
    return null
  }, [form.start_km, form.end_km])

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Trips', value: kpis.total, icon: 'route', bg: color + '14', fg: color },
    { label: 'Total Distance', value: kpis.totalDist.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' km', icon: 'straighten', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Avg Distance', value: kpis.avgDist.toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' km', icon: 'speed', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Completed', value: kpis.completed, icon: 'check_circle', bg: THEME.statusTertiaryBg, fg: THEME.statusTertiaryText },
  ]

  function getAssetLabel(id) {
    const a = (assets || []).find(x => x.id === id)
    return a ? (a.asset_number || a.description || 'Unknown') : '—'
  }

  function getOperatorLabel(id) {
    const e = (employees || []).find(x => x.id === id)
    return e ? e.name : '—'
  }

  function getTripAsset(trip) {
    if (trip.fleet_assets) return trip.fleet_assets.asset_number || trip.fleet_assets.description || '—'
    return getAssetLabel(trip.asset_id)
  }

  function getTripOperator(trip) {
    if (trip.employees) return trip.employees.name || '—'
    return getOperatorLabel(trip.operator_id)
  }

  const thStyle = {
    padding: '10px 12px', fontSize: '11px', fontWeight: 600, color: THEME.textMed,
    textAlign: 'left', borderBottom: `1px solid ${THEME.outlineVar}`,
    whiteSpace: 'nowrap', background: THEME.surfaceVar,
  }
  const tdStyle = {
    padding: '10px 12px', fontSize: '13px', color: THEME.text,
    borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap',
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_trips" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '18px',
            border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: k.fg }}>{k.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Trip Log</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} trip{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Add Trip
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search destination, purpose..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '280px' }}
        />
        <input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          style={{ ...inp, maxWidth: '150px' }}
          title="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          style={{ ...inp, maxWidth: '150px' }}
          title="To date"
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>route</span>
          <div style={{ fontSize: '14px' }}>No trips found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new trip</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, background: THEME.surface }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Asset</th>
                <th style={thStyle}>Operator</th>
                <th style={thStyle}>Destination</th>
                <th style={thStyle}>Purpose</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Distance (km)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr
                  key={t.id}
                  onClick={() => can('fleet.edit') ? openEdit(t) : null}
                  style={{ cursor: can('fleet.edit') ? 'pointer' : 'default' }}
                  onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={tdStyle}>{t.trip_date || '—'}</td>
                  <td style={tdStyle}>{getTripAsset(t)}</td>
                  <td style={tdStyle}>{getTripOperator(t)}</td>
                  <td style={{ ...tdStyle, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.destination || '—'}
                  </td>
                  <td style={{ ...tdStyle, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.purpose || '—'}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    {t.distance_km != null ? Number(t.distance_km).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '620px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Trip' : 'Add Trip'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={fieldWrap}>
                  <label style={lbl}>Asset *</label>
                  <select style={inp} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                    <option value="">-- Select Asset --</option>
                    {(assets || []).map(a => (
                      <option key={a.id} value={a.id}>{a.asset_number || a.description}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Operator *</label>
                  <select style={inp} value={form.operator_id} onChange={e => set('operator_id', e.target.value)}>
                    <option value="">-- Select Operator --</option>
                    {(employees || []).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Trip Date *</label>
                  <input style={inp} type="date" value={form.trip_date} onChange={e => set('trip_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Destination</label>
                  <input style={inp} value={form.destination} onChange={e => set('destination', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Start Time</label>
                  <input style={inp} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>End Time</label>
                  <input style={inp} type="time" value={form.end_time} onChange={e => set('end_time', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Purpose</label>
                  <input style={inp} value={form.purpose} onChange={e => set('purpose', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Start Odometer (km)</label>
                  <input style={inp} type="number" value={form.start_km} onChange={e => set('start_km', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>End Odometer (km)</label>
                  <input style={inp} type="number" value={form.end_km} onChange={e => set('end_km', e.target.value)} />
                </div>
                {calcDistance && (
                  <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                    <div style={{
                      fontSize: '12px', fontWeight: 600, color: color,
                      background: color + '14', padding: '8px 12px', borderRadius: '8px',
                    }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>straighten</span>
                      Calculated distance: {calcDistance} km
                    </div>
                  </div>
                )}
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea
                    style={{ ...inp, minHeight: '60px', resize: 'vertical' }}
                    value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{
              padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
            }}>
              <button onClick={() => setModalOpen(false)} style={{
                padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: THEME.surfaceVar, color: THEME.textMed,
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: color, color: '#fff',
                border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
              }}>
                {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
