import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const RESOURCE_TYPES = {
  electricity: 'Electricity', water: 'Water', diesel: 'Diesel', petrol: 'Petrol',
  lpg: 'LPG', coal: 'Coal', natural_gas: 'Natural Gas',
  compressed_air: 'Compressed Air', steam: 'Steam', other: 'Other',
}

const UNITS = ['kWh', 'MWh', 'litres', 'm3', 'kg', 'tonnes', 'GJ']

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }

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

function ResourceModal({ record, siteId, userId, onClose, onSaved }) {
  const isEdit = !!record
  const [form, setForm] = useState(() => {
    if (record) return {
      reading_date: record.reading_date || '', resource_type: record.resource_type || '',
      meter_id: record.meter_id || '', location: record.location || '',
      previous_reading: record.previous_reading ?? '', current_reading: record.current_reading ?? '',
      consumption: record.consumption ?? '', unit: record.unit || '',
      cost: record.cost ?? '', target: record.target ?? '', notes: record.notes || '',
    }
    return { reading_date: new Date().toISOString().slice(0, 10), resource_type: '', meter_id: '', location: '', previous_reading: '', current_reading: '', consumption: '', unit: '', cost: '', target: '', notes: '' }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  const autoConsumption = form.previous_reading !== '' && form.current_reading !== '' ? (Number(form.current_reading) - Number(form.previous_reading)).toFixed(2) : ''

  function handleCurrentChange(v) {
    set('current_reading', v)
    if (form.previous_reading !== '' && v !== '') {
      set('consumption', (Number(v) - Number(form.previous_reading)).toFixed(2))
    }
  }

  async function handleSave() {
    if (!form.resource_type || form.consumption === '' || !form.unit) { showToast('Please fill required fields', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        reading_date: form.reading_date, resource_type: form.resource_type,
        meter_id: form.meter_id || null, location: form.location || null,
        previous_reading: form.previous_reading !== '' ? Number(form.previous_reading) : null,
        current_reading: form.current_reading !== '' ? Number(form.current_reading) : null,
        consumption: Number(form.consumption), unit: form.unit,
        cost: form.cost !== '' ? Number(form.cost) : null,
        target: form.target !== '' ? Number(form.target) : null,
        notes: form.notes || null,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_resource_consumption').update(payload).eq('id', record.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Record updated')
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'RES', p_table: 'sheq_resource_consumption' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.record_number = num
        payload.recorded_by = userId
        const { error } = await supabase.from('sheq_resource_consumption').insert(payload)
        if (error) throw error
        showToast(`Record ${num} created`)
      }
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${record.record_number}` : 'New Resource Reading'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Date" required><input style={inputStyle} type="date" value={form.reading_date} onChange={e => set('reading_date', e.target.value)} /></Field>
            <Field label="Resource Type" required>
              <select style={selectStyle} value={form.resource_type} onChange={e => set('resource_type', e.target.value)}>
                <option value="">Select...</option>
                {Object.entries(RESOURCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Meter ID"><input style={inputStyle} value={form.meter_id} onChange={e => set('meter_id', e.target.value)} /></Field>
            <Field label="Location"><input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} /></Field>
          </div>

          <SectionLabel>Readings</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Previous Reading"><input style={inputStyle} type="number" step="any" value={form.previous_reading} onChange={e => set('previous_reading', e.target.value)} /></Field>
            <Field label="Current Reading"><input style={inputStyle} type="number" step="any" value={form.current_reading} onChange={e => handleCurrentChange(e.target.value)} /></Field>
            <Field label="Consumption" required><input style={inputStyle} type="number" step="any" value={form.consumption} onChange={e => set('consumption', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Unit" required>
              <select style={selectStyle} value={form.unit} onChange={e => set('unit', e.target.value)}>
                <option value="">Select...</option>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Cost ($)"><input style={inputStyle} type="number" step="0.01" value={form.cost} onChange={e => set('cost', e.target.value)} /></Field>
            <Field label="Target"><input style={inputStyle} type="number" step="any" value={form.target} onChange={e => set('target', e.target.value)} /></Field>
          </div>
          <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqResources({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_resource_consumption', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('sheq_resource_consumption')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('reading_date', { ascending: false })
      .limit(500)
    if (error) showToast(error.message, 'error')
    setRows(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId, rt])

  const filtered = rows.filter(r => {
    if (filterType !== 'all' && r.resource_type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      return (r.record_number || '').toLowerCase().includes(s) || (r.location || '').toLowerCase().includes(s) || (r.meter_id || '').toLowerCase().includes(s)
    }
    return true
  })

  async function handleArchive(r) {
    if (!confirm(`Archive record ${r.record_number}?`)) return
    const { error } = await supabase.from('sheq_resource_consumption').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view resource consumption.</div>

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_resources" />
      <PageHeader title="Resource Consumption" subtitle={`${rows.length} readings`} icon="bolt" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search records..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...selectStyle, width: 'auto', minWidth: '150px' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">All Resources</option>
          {Object.entries(RESOURCE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {can('sheq.create') && <Button style={{ background: ACCENT, color: '#fff' }} onClick={() => setModal('new')}><Icon name="add" size={16} style={{ color: '#fff' }} /> New Reading</Button>}
        <Button variant="ghost" onClick={() => exportCsv(filtered, `resource_consumption_${currentSiteId}`)}>
          <Icon name="download" size={16} /> Export
        </Button>
      </div>

      <Card style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Record #', 'Date', 'Resource', 'Meter', 'Location', 'Consumption', 'Target', 'Cost', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No records found</td></tr>
              ) : filtered.map(r => {
                const overTarget = r.target && Number(r.consumption) > Number(r.target)
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}`, background: overTarget ? '#FFF8F8' : 'transparent' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.record_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.reading_date}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{RESOURCE_TYPES[r.resource_type] || r.resource_type}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.meter_id || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.location || '--'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: overTarget ? '#D32F2F' : THEME.text }}>
                      {r.consumption} {r.unit}
                      {overTarget && <Icon name="trending_up" size={12} style={{ color: '#D32F2F', marginLeft: '4px', verticalAlign: 'middle' }} />}
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.target != null ? `${r.target} ${r.unit}` : '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.cost != null ? `$${Number(r.cost).toFixed(2)}` : '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {can('sheq.edit') && <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                        {can('sheq.delete') && <button onClick={() => handleArchive(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="archive" size={16} style={{ color: THEME.textMed }} /></button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <ResourceModal
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
