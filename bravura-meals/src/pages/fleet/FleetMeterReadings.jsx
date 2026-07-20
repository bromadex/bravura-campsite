import { useState, useMemo, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useAuth } from '../../auth/AuthContext'
import { ModalOverlay } from '../../components/ui'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.fleet

const SOURCE_LABELS = {
  manual: 'Manual',
  trip: 'Trip',
  inspection: 'Inspection',
  maintenance: 'Maintenance',
  fuel: 'Fuel',
}

export default function FleetMeterReadings({ setPage }) {
  const { can } = usePermissions()
  const { assets, loading } = useFleet()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  useRealtimeSubscription('fleet_meter_readings', { column: 'site_id', value: currentSiteId }, fetchReadings)
  const userId = profile?.id

  const [readings, setReadings] = useState([])
  const [loadingReadings, setLoadingReadings] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    asset_id: '', reading_type: 'odometer', reading_value: '', reading_date: '', reading_time: '', notes: '',
  })
  const [regression, setRegression] = useState(false)

  const assetMap = useMemo(() => {
    const m = {}
    ;(assets || []).forEach(a => { m[a.id] = a })
    return m
  }, [assets])

  async function fetchReadings() {
    if (!currentSiteId) return
    setLoadingReadings(true)
    const { data } = await supabase
      .from('fleet_meter_readings')
      .select('*')
      .eq('site_id', currentSiteId)
      .order('reading_date', { ascending: false })
      .limit(500)
    setReadings(data || [])
    setLoadingReadings(false)
  }

  useEffect(() => { fetchReadings() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = readings
    if (filterType !== 'all') list = list.filter(r => r.reading_type === filterType)
    if (flaggedOnly) list = list.filter(r => r.is_flagged)
    if (dateFrom) list = list.filter(r => r.reading_date >= dateFrom)
    if (dateTo) list = list.filter(r => r.reading_date <= dateTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r => {
        const asset = assetMap[r.asset_id]
        return (asset?.asset_number || '').toLowerCase().includes(q)
      })
    }
    return list
  }, [readings, filterType, flaggedOnly, dateFrom, dateTo, search, assetMap])

  const kpis = useMemo(() => ({
    total: readings.length,
    odometer: readings.filter(r => r.reading_type === 'odometer').length,
    hours: readings.filter(r => r.reading_type === 'hours').length,
    flagged: readings.filter(r => r.is_flagged).length,
  }), [readings])

  function openAdd() {
    setForm({ asset_id: '', reading_type: 'odometer', reading_value: '', reading_date: '', reading_time: '', notes: '' })
    setRegression(false)
    setError('')
    setModalOpen(true)
  }

  function handleValueChange(val) {
    setForm(f => ({ ...f, reading_value: val }))
    if (!form.asset_id || !val) { setRegression(false); return }
    const asset = assetMap[form.asset_id]
    if (!asset) { setRegression(false); return }
    const current = form.reading_type === 'odometer' ? asset.current_odometer_km : asset.current_hours
    setRegression(current != null && Number(val) < Number(current))
  }

  function handleTypeChange(type) {
    setForm(f => ({ ...f, reading_type: type }))
    // re-check regression
    if (!form.asset_id || !form.reading_value) { setRegression(false); return }
    const asset = assetMap[form.asset_id]
    if (!asset) { setRegression(false); return }
    const current = type === 'odometer' ? asset.current_odometer_km : asset.current_hours
    setRegression(current != null && Number(form.reading_value) < Number(current))
  }

  function handleAssetChange(assetId) {
    setForm(f => ({ ...f, asset_id: assetId }))
    if (!assetId || !form.reading_value) { setRegression(false); return }
    const asset = assetMap[assetId]
    if (!asset) { setRegression(false); return }
    const current = form.reading_type === 'odometer' ? asset.current_odometer_km : asset.current_hours
    setRegression(current != null && Number(form.reading_value) < Number(current))
  }

  async function handleSave() {
    if (!form.asset_id || !form.reading_value || !form.reading_date) {
      setError('Asset, reading value, and date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const asset = assetMap[form.asset_id]
      const current = form.reading_type === 'odometer' ? asset?.current_odometer_km : asset?.current_hours
      const isRegression = current != null && Number(form.reading_value) < Number(current)

      const { error: insertErr } = await supabase.from('fleet_meter_readings').insert({
        site_id: currentSiteId,
        asset_id: form.asset_id,
        reading_type: form.reading_type,
        reading_value: Number(form.reading_value),
        reading_date: form.reading_date,
        reading_time: form.reading_time || null,
        source: 'manual',
        is_flagged: isRegression,
        flag_reason: isRegression ? `Reading ${form.reading_value} is lower than current ${current}` : null,
        notes: form.notes || null,
        recorded_by: userId,
      })
      if (insertErr) throw insertErr

      // Update asset current value if reading is higher
      if (!isRegression && asset) {
        const updateField = form.reading_type === 'odometer' ? 'current_odometer_km' : 'current_hours'
        if (current == null || Number(form.reading_value) > Number(current)) {
          await supabase.from('fleet_assets').update({ [updateField]: Number(form.reading_value) }).eq('id', form.asset_id)
        }
      }

      setModalOpen(false)
      fetchReadings()
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  if (loading || loadingReadings) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Readings', value: kpis.total, icon: 'speed', bg: color + '14', fg: color },
    { label: 'Odometer Readings', value: kpis.odometer, icon: 'route', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Hours Readings', value: kpis.hours, icon: 'schedule', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Flagged Readings', value: kpis.flagged, icon: 'flag', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
  ]

  function formatValue(r) {
    if (r.reading_type === 'odometer') return Number(r.reading_value).toLocaleString() + ' km'
    return Number(r.reading_value).toLocaleString() + ' hrs'
  }

  function getCurrentForAsset() {
    if (!form.asset_id) return null
    const asset = assetMap[form.asset_id]
    if (!asset) return null
    return form.reading_type === 'odometer' ? asset.current_odometer_km : asset.current_hours
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_meter_readings" />

      {/* KPI Banner */}
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

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Meter Readings</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} reading{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Add Reading
          </button>
        )}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search by asset number..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '220px' }}
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Types</option>
          <option value="odometer">Odometer</option>
          <option value="hours">Hours</option>
        </select>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.textMed, cursor: 'pointer' }}>
          <input type="checkbox" checked={flaggedOnly} onChange={e => setFlaggedOnly(e.target.checked)} />
          Flagged Only
        </label>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, maxWidth: '150px' }} placeholder="From" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inp, maxWidth: '150px' }} placeholder="To" />
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>speed</span>
          <div style={{ fontSize: '14px' }}>No readings found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new reading</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Date', 'Asset', 'Type', 'Value', 'Source', 'Flagged', 'Notes'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const asset = assetMap[r.asset_id]
                return (
                  <tr key={r.id} style={{
                    borderTop: `1px solid ${THEME.outlineVar}`,
                    background: r.is_flagged ? 'rgba(220,38,38,0.06)' : 'transparent',
                  }}>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{r.reading_date}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{asset?.asset_number || r.asset_id}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{
                        display: 'inline-block', fontSize: '11px', fontWeight: 600,
                        padding: '2px 10px', borderRadius: '999px',
                        background: r.reading_type === 'odometer' ? THEME.statusSuccessBg : THEME.statusWarningBg,
                        color: r.reading_type === 'odometer' ? THEME.statusSuccessText : THEME.statusWarningText,
                      }}>
                        {r.reading_type === 'odometer' ? 'Odometer' : 'Hours'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 600 }}>{formatValue(r)}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>{SOURCE_LABELS[r.source] || r.source}</td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.is_flagged && (
                        <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.statusErrorText }} title={r.flag_reason || 'Flagged'}>warning</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes || ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Reading Modal */}
      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '500px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>Add Reading</div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={fieldWrap}>
                <label style={lbl}>Asset *</label>
                <select style={inp} value={form.asset_id} onChange={e => handleAssetChange(e.target.value)}>
                  <option value="">-- Select Asset --</option>
                  {(assets || []).map(a => (
                    <option key={a.id} value={a.id}>{a.asset_number} {a.description ? `- ${a.description}` : ''}</option>
                  ))}
                </select>
              </div>

              <div style={fieldWrap}>
                <label style={lbl}>Reading Type *</label>
                <div style={{ display: 'flex', gap: '16px' }}>
                  {['odometer', 'hours'].map(t => (
                    <label key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: THEME.text, cursor: 'pointer' }}>
                      <input type="radio" name="reading_type" checked={form.reading_type === t} onChange={() => handleTypeChange(t)} />
                      {t === 'odometer' ? 'Odometer (km)' : 'Hours'}
                    </label>
                  ))}
                </div>
              </div>

              <div style={fieldWrap}>
                <label style={lbl}>Reading Value *</label>
                <input style={inp} type="number" min="0" step="any" value={form.reading_value} onChange={e => handleValueChange(e.target.value)} />
              </div>

              {regression && (
                <div style={{
                  background: THEME.statusWarningBg, border: `1px solid ${THEME.statusWarningText}`,
                  borderRadius: '10px', padding: '10px 14px', marginBottom: '12px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.statusWarningText }}>warning</span>
                  <span style={{ fontSize: '12px', color: THEME.statusWarningText, fontWeight: 600 }}>
                    Reading is lower than current {getCurrentForAsset()?.toLocaleString()}. This may indicate an error.
                  </span>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={fieldWrap}>
                  <label style={lbl}>Date *</label>
                  <input style={inp} type="date" value={form.reading_date} onChange={e => setForm(f => ({ ...f, reading_date: e.target.value }))} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Time</label>
                  <input style={inp} type="time" value={form.reading_time} onChange={e => setForm(f => ({ ...f, reading_time: e.target.value }))} />
                </div>
              </div>

              <div style={fieldWrap}>
                <label style={lbl}>Notes</label>
                <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{
              padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`,
              display: 'flex', justifyContent: 'flex-end', gap: '8px',
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
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
