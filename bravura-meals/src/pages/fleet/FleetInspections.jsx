import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'

const color = MODULE_COLORS.fleet

const RESULT_MAP = {
  pass:        { label: 'Pass',        bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  fail:        { label: 'Fail',        bg: THEME.statusErrorBg,   text: THEME.statusErrorText },
  conditional: { label: 'Conditional', bg: THEME.statusWarningBg, text: THEME.statusWarningText },
}

function ResultBadge({ result }) {
  const s = RESULT_MAP[result] || RESULT_MAP.pass
  return (
    <span style={{
      display: 'inline-block', fontSize: '11px', fontWeight: 600,
      padding: '2px 10px', borderRadius: '999px',
      background: s.bg, color: s.text,
    }}>
      {s.label}
    </span>
  )
}

const EMPTY_FORM = {
  asset_id: '', inspector_id: '', inspection_date: '', odometer_km: '',
  hours: '', result: 'pass', overall_score: '', notes: '', next_due_date: '',
}

export default function FleetInspections({ setPage }) {
  const { can } = usePermissions()
  const { assets, employees, inspections, loading, fetchAll } = useFleet()
  const { currentSiteId } = useSite()

  const [search, setSearch] = useState('')
  const [filterResult, setFilterResult] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filtered = useMemo(() => {
    let list = inspections || []
    if (filterResult !== 'all') list = list.filter(i => i.result === filterResult)
    if (dateFrom) list = list.filter(i => i.inspection_date >= dateFrom)
    if (dateTo) list = list.filter(i => i.inspection_date <= dateTo)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        (i.fleet_assets?.asset_number || '').toLowerCase().includes(q) ||
        (i.fleet_assets?.description || '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => (b.inspection_date || '').localeCompare(a.inspection_date || ''))
  }, [inspections, filterResult, dateFrom, dateTo, search])

  const kpis = useMemo(() => {
    const all = inspections || []
    return {
      total: all.length,
      pass: all.filter(i => i.result === 'pass').length,
      fail: all.filter(i => i.result === 'fail').length,
      conditional: all.filter(i => i.result === 'conditional').length,
    }
  }, [inspections])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(insp) {
    setEditId(insp.id)
    setForm({
      asset_id: insp.asset_id || '',
      inspector_id: insp.inspector_id || '',
      inspection_date: insp.inspection_date || '',
      odometer_km: insp.odometer_km ?? '',
      hours: insp.hours ?? '',
      result: insp.result || 'pass',
      overall_score: insp.overall_score ?? '',
      notes: insp.notes || '',
      next_due_date: insp.next_due_date || '',
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.asset_id || !form.inspection_date || !form.result) {
      setError('Asset, inspection date, and result are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        asset_id: form.asset_id,
        inspector_id: form.inspector_id || null,
        inspection_date: form.inspection_date,
        odometer_km: form.odometer_km ? Number(form.odometer_km) : null,
        hours: form.hours ? Number(form.hours) : null,
        result: form.result,
        overall_score: form.overall_score !== '' ? Number(form.overall_score) : null,
        notes: form.notes || null,
        next_due_date: form.next_due_date || null,
        site_id: currentSiteId,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_inspections').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_inspections').insert(payload)
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
    { label: 'Total Inspections', value: kpis.total, icon: 'checklist', bg: color + '14', fg: color },
    { label: 'Passed', value: kpis.pass, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Failed', value: kpis.fail, icon: 'cancel', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
    { label: 'Conditional', value: kpis.conditional, icon: 'warning', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
  ]

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
      <FleetQuickNav setPage={setPage} current="fleet_inspections" />

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
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Inspections</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} inspection{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        {can('fleet.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Add Inspection
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search by asset..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '220px' }}
        />
        <select value={filterResult} onChange={e => setFilterResult(e.target.value)} style={{ ...inp, maxWidth: '150px' }}>
          <option value="all">All Results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="conditional">Conditional</option>
        </select>
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
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>checklist</span>
          <div style={{ fontSize: '14px' }}>No inspections found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new inspection</div>
        </div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Asset</th>
                  <th style={thStyle}>Inspector</th>
                  <th style={thStyle}>Odometer / Hours</th>
                  <th style={thStyle}>Result</th>
                  <th style={thStyle}>Score</th>
                  <th style={thStyle}>Next Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(i => (
                  <tr
                    key={i.id}
                    onClick={() => can('fleet.edit') ? openEdit(i) : null}
                    style={{ cursor: can('fleet.edit') ? 'pointer' : 'default', transition: 'background .1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={tdStyle}>{i.inspection_date || '-'}</td>
                    <td style={tdStyle}>{i.fleet_assets?.asset_number || '-'}</td>
                    <td style={tdStyle}>{i.employees?.name || '-'}</td>
                    <td style={tdStyle}>
                      {i.odometer_km != null ? Number(i.odometer_km).toLocaleString() + ' km' : '-'}
                      {i.hours != null ? ' / ' + Number(i.hours).toLocaleString() + ' hrs' : ''}
                    </td>
                    <td style={tdStyle}><ResultBadge result={i.result} /></td>
                    <td style={tdStyle}>{i.overall_score != null ? i.overall_score : '-'}</td>
                    <td style={tdStyle}>{i.next_due_date || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '560px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Inspection' : 'Add Inspection'}
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
                      <option key={a.id} value={a.id}>{a.asset_number} - {a.description}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Inspector</label>
                  <select style={inp} value={form.inspector_id} onChange={e => set('inspector_id', e.target.value)}>
                    <option value="">-- Select Inspector --</option>
                    {(employees || []).map(e => (
                      <option key={e.id} value={e.id}>{e.name}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Inspection Date *</label>
                  <input style={inp} type="date" value={form.inspection_date} onChange={e => set('inspection_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Result *</label>
                  <select style={inp} value={form.result} onChange={e => set('result', e.target.value)}>
                    <option value="pass">Pass</option>
                    <option value="fail">Fail</option>
                    <option value="conditional">Conditional</option>
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Odometer (km)</label>
                  <input style={inp} type="number" value={form.odometer_km} onChange={e => set('odometer_km', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Hours</label>
                  <input style={inp} type="number" value={form.hours} onChange={e => set('hours', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Overall Score (0-100)</label>
                  <input style={inp} type="number" min="0" max="100" value={form.overall_score} onChange={e => set('overall_score', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Next Due Date</label>
                  <input style={inp} type="date" value={form.next_due_date} onChange={e => set('next_due_date', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea
                    style={{ ...inp, minHeight: '70px', resize: 'vertical' }}
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
        </div>
      )}
    </div>
  )
}
