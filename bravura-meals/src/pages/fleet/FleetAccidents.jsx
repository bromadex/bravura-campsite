import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'

const color = MODULE_COLORS.fleet

const SEVERITY_MAP = {
  minor:     { label: 'Minor',     bg: '#e3f2fd', text: '#1565c0' },
  moderate:  { label: 'Moderate',  bg: '#fff8e1', text: '#f57f17' },
  major:     { label: 'Major',     bg: '#fff3e0', text: '#e65100' },
  write_off: { label: 'Write-Off', bg: '#ffebee', text: '#c62828' },
}

const STATUS_MAP = {
  reported:      { label: 'Reported',      bg: '#e3f2fd', text: '#1565c0' },
  investigating: { label: 'Investigating', bg: '#fff8e1', text: '#f57f17' },
  resolved:      { label: 'Resolved',      bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  closed:        { label: 'Closed',        bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const INCIDENT_TYPES = [
  { value: 'collision', label: 'Collision' },
  { value: 'rollover', label: 'Rollover' },
  { value: 'mechanical', label: 'Mechanical' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'theft', label: 'Theft' },
  { value: 'vandalism', label: 'Vandalism' },
  { value: 'other', label: 'Other' },
]

const EMPTY_FORM = {
  asset_id: '', accident_date: '', accident_time: '', location: '',
  description: '', incident_type: 'collision', severity: 'minor',
  injuries: 0, fatalities: 0, police_case_no: '', insurance_claim: '',
  claim_amount: '', repair_cost: '', days_off_road: '',
  root_cause: '', corrective_action: '', status: 'reported',
  photos_url: '', notes: '',
}

export default function FleetAccidents({ setPage }) {
  const { can } = usePermissions()
  const { assets, loading: fleetLoading } = useFleet()
  const { currentSiteId } = useSite()

  const [accidents, setAccidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchAccidents() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('fleet_accidents')
      .select('*, fleet_assets(id, asset_number, description)')
      .eq('site_id', currentSiteId)
      .order('accident_date', { ascending: false })
    if (!err) setAccidents(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (currentSiteId) fetchAccidents()
  }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = accidents
    if (filterSeverity !== 'all') list = list.filter(a => a.severity === filterSeverity)
    if (filterStatus !== 'all') list = list.filter(a => a.status === filterStatus)
    if (dateFrom) list = list.filter(a => a.accident_date >= dateFrom)
    if (dateTo) list = list.filter(a => a.accident_date <= dateTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(a =>
        (a.fleet_assets?.asset_number || '').toLowerCase().includes(q) ||
        (a.location || '').toLowerCase().includes(q) ||
        (a.description || '').toLowerCase().includes(q) ||
        (a.police_case_no || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [accidents, filterSeverity, filterStatus, dateFrom, dateTo, search])

  const kpis = useMemo(() => {
    const all = accidents
    return {
      total: all.length,
      open: all.filter(a => a.status !== 'closed').length,
      repairCost: all.reduce((s, a) => s + (Number(a.repair_cost) || 0), 0),
      daysOff: all.reduce((s, a) => s + (Number(a.days_off_road) || 0), 0),
    }
  }, [accidents])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(acc) {
    setEditId(acc.id)
    setForm({
      asset_id: acc.asset_id || '',
      accident_date: acc.accident_date || '',
      accident_time: acc.accident_time || '',
      location: acc.location || '',
      description: acc.description || '',
      incident_type: acc.incident_type || 'collision',
      severity: acc.severity || 'minor',
      injuries: acc.injuries ?? 0,
      fatalities: acc.fatalities ?? 0,
      police_case_no: acc.police_case_no || '',
      insurance_claim: acc.insurance_claim || '',
      claim_amount: acc.claim_amount || '',
      repair_cost: acc.repair_cost || '',
      days_off_road: acc.days_off_road || '',
      root_cause: acc.root_cause || '',
      corrective_action: acc.corrective_action || '',
      status: acc.status || 'reported',
      photos_url: acc.photos_url || '',
      notes: acc.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_id || !form.accident_date) {
      setError('Asset and accident date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        site_id: currentSiteId,
        injuries: form.injuries ? Number(form.injuries) : 0,
        fatalities: form.fatalities ? Number(form.fatalities) : 0,
        claim_amount: form.claim_amount ? Number(form.claim_amount) : null,
        repair_cost: form.repair_cost ? Number(form.repair_cost) : null,
        days_off_road: form.days_off_road ? Number(form.days_off_road) : null,
        asset_id: form.asset_id || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_accidents').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_accidents').insert([payload])
        if (err) throw err
      }
      await fetchAccidents()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  const fmt = v => v != null && v !== '' ? Number(v).toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0 }) : '-'

  if (loading || fleetLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Incidents', value: kpis.total, icon: 'car_crash', bg: color + '14', fg: color },
    { label: 'Open', value: kpis.open, icon: 'pending', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Total Repair Cost', value: fmt(kpis.repairCost), icon: 'payments', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
    { label: 'Days Off Road', value: kpis.daysOff, icon: 'event_busy', bg: '#fff3e0', fg: '#e65100' },
  ]

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_accidents" />

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
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Accident Reports</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} incident{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Report Incident
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search incidents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '220px' }}
        />
        <select value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)} style={{ ...inp, maxWidth: '150px' }}>
          <option value="all">All Severities</option>
          {Object.entries(SEVERITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '150px' }}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, maxWidth: '150px' }} title="From date" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inp, maxWidth: '150px' }} title="To date" />
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>car_crash</span>
          <div style={{ fontSize: '14px' }}>No incidents found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or report a new incident</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, background: THEME.surface }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                {['Date', 'Asset', 'Type', 'Severity', 'Injuries', 'Status', 'Cost'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => {
                const sev = SEVERITY_MAP[a.severity] || SEVERITY_MAP.minor
                const st = STATUS_MAP[a.status] || STATUS_MAP.reported
                return (
                  <tr
                    key={a.id}
                    onClick={() => can('fleet.edit') ? openEdit(a) : null}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: can('fleet.edit') ? 'pointer' : 'default' }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: THEME.text }}>{a.accident_date || '-'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{a.fleet_assets?.asset_number || '-'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed, textTransform: 'capitalize' }}>{(a.incident_type || '').replace('_', ' ')}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ display: 'inline-block', fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '999px', background: sev.bg, color: sev.text }}>{sev.label}</span>
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{a.injuries ?? 0}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ display: 'inline-block', fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '999px', background: st.bg, color: st.text }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: THEME.text }}>{fmt(a.repair_cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '780px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Incident' : 'Report Incident'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
                {/* Left column */}
                <div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Asset *</label>
                    <select style={inp} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                      <option value="">-- Select Asset --</option>
                      {(assets || []).map(a => <option key={a.id} value={a.id}>{a.asset_number} - {a.description}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Date *</label>
                      <input style={inp} type="date" value={form.accident_date} onChange={e => set('accident_date', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Time</label>
                      <input style={inp} type="time" value={form.accident_time} onChange={e => set('accident_time', e.target.value)} />
                    </div>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Location</label>
                    <input style={inp} value={form.location} onChange={e => set('location', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Description</label>
                    <textarea style={{ ...inp, minHeight: '70px', resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Incident Type</label>
                      <select style={inp} value={form.incident_type} onChange={e => set('incident_type', e.target.value)}>
                        {INCIDENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Severity</label>
                      <select style={inp} value={form.severity} onChange={e => set('severity', e.target.value)}>
                        {Object.entries(SEVERITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Right column */}
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Injuries</label>
                      <input style={inp} type="number" min="0" value={form.injuries} onChange={e => set('injuries', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Fatalities</label>
                      <input style={inp} type="number" min="0" value={form.fatalities} onChange={e => set('fatalities', e.target.value)} />
                    </div>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Police Case #</label>
                    <input style={inp} value={form.police_case_no} onChange={e => set('police_case_no', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Insurance Claim #</label>
                    <input style={inp} value={form.insurance_claim} onChange={e => set('insurance_claim', e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Claim Amount</label>
                      <input style={inp} type="number" step="0.01" value={form.claim_amount} onChange={e => set('claim_amount', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Repair Cost</label>
                      <input style={inp} type="number" step="0.01" value={form.repair_cost} onChange={e => set('repair_cost', e.target.value)} />
                    </div>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Days Off Road</label>
                    <input style={inp} type="number" min="0" value={form.days_off_road} onChange={e => set('days_off_road', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Root Cause</label>
                    <textarea style={{ ...inp, minHeight: '50px', resize: 'vertical' }} value={form.root_cause} onChange={e => set('root_cause', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Corrective Action</label>
                    <textarea style={{ ...inp, minHeight: '50px', resize: 'vertical' }} value={form.corrective_action} onChange={e => set('corrective_action', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Status</label>
                    <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                      {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Notes</label>
                    <textarea style={{ ...inp, minHeight: '50px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                  </div>
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
                {saving ? 'Saving...' : editId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
