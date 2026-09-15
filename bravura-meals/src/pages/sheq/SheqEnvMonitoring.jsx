import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const PARAMETERS = {
  dust_pm10: 'Dust (PM10)', dust_pm2_5: 'Dust (PM2.5)', noise_db: 'Noise (dB)',
  water_ph: 'Water pH', water_tss: 'Water TSS', water_cod: 'Water COD',
  water_bod: 'Water BOD', air_so2: 'Air SO₂', air_nox: 'Air NOₓ', air_co: 'Air CO',
  vibration: 'Vibration', temperature: 'Temperature', humidity: 'Humidity',
  wind_speed: 'Wind Speed', radiation: 'Radiation', other: 'Other',
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const textareaStyle = { ...inputStyle, minHeight: '70px', resize: 'vertical' }

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

function StatusBadge({ exceedance }) {
  if (exceedance) return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: '#FFEBEE', color: '#D32F2F' }}>
      <Icon name="warning" size={11} style={{ color: 'inherit' }} /> Exceedance
    </span>
  )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: '#E8F5E9', color: '#2E7D32' }}>
      <Icon name="check_circle" size={11} style={{ color: 'inherit' }} /> Normal
    </span>
  )
}

function MonitoringModal({ record, siteId, userId, onClose, onSaved }) {
  const isEdit = !!record
  const [form, setForm] = useState(() => {
    if (record) return {
      monitoring_date: record.monitoring_date || '', monitoring_time: record.monitoring_time || '',
      parameter: record.parameter || '', location: record.location || '',
      station_id: record.station_id || '', value: record.value ?? '',
      unit: record.unit || '', limit_value: record.limit_value ?? '',
      limit_source: record.limit_source || '', exceedance_action: record.exceedance_action || '',
      instrument: record.instrument || '', calibration_date: record.calibration_date || '',
      notes: record.notes || '',
    }
    return {
      monitoring_date: new Date().toISOString().slice(0, 10), monitoring_time: '',
      parameter: '', location: '', station_id: '', value: '', unit: '',
      limit_value: '', limit_source: '', exceedance_action: '',
      instrument: '', calibration_date: '', notes: '',
    }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  const isExceedance = form.value !== '' && form.limit_value !== '' && Number(form.value) > Number(form.limit_value)

  async function handleSave() {
    if (!form.parameter || !form.location || form.value === '' || !form.unit) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        monitoring_date: form.monitoring_date, monitoring_time: form.monitoring_time || null,
        parameter: form.parameter, location: form.location,
        station_id: form.station_id || null, value: Number(form.value),
        unit: form.unit, limit_value: form.limit_value !== '' ? Number(form.limit_value) : null,
        limit_source: form.limit_source || null, is_exceedance: isExceedance,
        exceedance_action: isExceedance ? (form.exceedance_action || null) : null,
        instrument: form.instrument || null, calibration_date: form.calibration_date || null,
        notes: form.notes || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_env_monitoring').update(payload).eq('id', record.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Reading updated')
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'MON', p_table: 'sheq_env_monitoring' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.reading_number = num
        payload.recorded_by = userId
        const { error } = await supabase.from('sheq_env_monitoring').insert(payload)
        if (error) throw error
        showToast(`Reading ${num} created`)
      }
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '620px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${record.reading_number}` : 'New Monitoring Reading'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <SectionLabel>Reading Details</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Date" required><input style={inputStyle} type="date" value={form.monitoring_date} onChange={e => set('monitoring_date', e.target.value)} /></Field>
            <Field label="Time"><input style={inputStyle} type="time" value={form.monitoring_time} onChange={e => set('monitoring_time', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Parameter" required>
              <select style={selectStyle} value={form.parameter} onChange={e => set('parameter', e.target.value)}>
                <option value="">Select...</option>
                {Object.entries(PARAMETERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Location" required><input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="Monitoring point" /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Station ID"><input style={inputStyle} value={form.station_id} onChange={e => set('station_id', e.target.value)} /></Field>
            <Field label="Instrument"><input style={inputStyle} value={form.instrument} onChange={e => set('instrument', e.target.value)} /></Field>
          </div>

          <SectionLabel>Measurement</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Value" required><input style={inputStyle} type="number" step="any" value={form.value} onChange={e => set('value', e.target.value)} /></Field>
            <Field label="Unit" required><input style={inputStyle} value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="e.g. µg/m³" /></Field>
            <Field label="Limit Value"><input style={inputStyle} type="number" step="any" value={form.limit_value} onChange={e => set('limit_value', e.target.value)} /></Field>
          </div>
          <Field label="Limit Source"><input style={inputStyle} value={form.limit_source} onChange={e => set('limit_source', e.target.value)} placeholder="e.g. EMA Licence Condition" /></Field>
          {isExceedance && (
            <div style={{ background: '#FFF3E0', borderRadius: '10px', padding: '12px', border: '1px solid #FFB74D' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#E65100', marginBottom: '6px' }}>
                <Icon name="warning" size={14} style={{ color: '#E65100', verticalAlign: 'middle', marginRight: '4px' }} />
                Exceedance Detected — Value exceeds limit
              </div>
              <Field label="Corrective Action"><textarea style={textareaStyle} value={form.exceedance_action} onChange={e => set('exceedance_action', e.target.value)} placeholder="Describe corrective action taken..." /></Field>
            </div>
          )}
          <Field label="Calibration Date"><input style={inputStyle} type="date" value={form.calibration_date} onChange={e => set('calibration_date', e.target.value)} /></Field>
          <Field label="Notes"><textarea style={textareaStyle} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqEnvMonitoring({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [filterParam, setFilterParam] = useState('all')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('sheq_env_monitoring')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('monitoring_date', { ascending: false })
      .limit(500)
    if (error) showToast(error.message, 'error')
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const filtered = rows.filter(r => {
    if (filterParam !== 'all' && r.parameter !== filterParam) return false
    if (search) {
      const s = search.toLowerCase()
      return (r.reading_number || '').toLowerCase().includes(s) || (r.location || '').toLowerCase().includes(s)
    }
    return true
  })

  async function handleArchive(r) {
    if (!confirm(`Archive reading ${r.reading_number}?`)) return
    const { error } = await supabase.from('sheq_env_monitoring').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view environmental monitoring.</div>

  const exceedanceCount = rows.filter(r => r.is_exceedance).length

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_env_monitoring" />
      <PageHeader title="Environmental Monitoring" subtitle={`${rows.length} readings · ${exceedanceCount} exceedances`} icon="monitor_heart" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search readings..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...selectStyle, width: 'auto', minWidth: '150px' }} value={filterParam} onChange={e => setFilterParam(e.target.value)}>
          <option value="all">All Parameters</option>
          {Object.entries(PARAMETERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {can('sheq.create') && <Button style={{ background: ACCENT, color: '#fff' }} onClick={() => setModal('new')}><Icon name="add" size={16} style={{ color: '#fff' }} /> New Reading</Button>}
        <Button variant="ghost" onClick={() => exportCsv(filtered, `env_monitoring_${currentSiteId}`)}>
          <Icon name="download" size={16} /> Export
        </Button>
      </div>

      <Card style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Reading #', 'Date', 'Parameter', 'Location', 'Value', 'Limit', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No readings found</td></tr>
              ) : filtered.map(r => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}`, background: r.is_exceedance ? '#FFF8F8' : 'transparent' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.reading_number}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.monitoring_date}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{PARAMETERS[r.parameter] || r.parameter}</td>
                  <td style={{ padding: '10px 12px', color: THEME.text }}>{r.location}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: r.is_exceedance ? '#D32F2F' : THEME.text }}>{r.value} {r.unit}</td>
                  <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.limit_value != null ? `${r.limit_value} ${r.unit}` : '--'}</td>
                  <td style={{ padding: '10px 12px' }}><StatusBadge exceedance={r.is_exceedance} /></td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {can('sheq.edit') && <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                      {can('sheq.delete') && <button onClick={() => handleArchive(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="archive" size={16} style={{ color: THEME.textMed }} /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <MonitoringModal
          record={modal === 'new' ? null : modal}
          siteId={currentSiteId}
          userId={user?.id}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
