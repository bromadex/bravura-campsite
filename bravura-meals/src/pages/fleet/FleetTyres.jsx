import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { StatusBadge } from '../../components/ui'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'

const color = MODULE_COLORS.fleet

const STATUS_MAP = {
  fitted:    { label: 'Fitted',    bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  stock:     { label: 'Stock',     bg: '#e3f2fd', text: '#1565c0' },
  retreaded: { label: 'Retreaded', bg: '#fff8e1', text: '#f57f17' },
  scrapped:  { label: 'Scrapped',  bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const POSITIONS = [
  { value: 'FL', label: 'Front Left' },
  { value: 'FR', label: 'Front Right' },
  { value: 'RL', label: 'Rear Left' },
  { value: 'RR', label: 'Rear Right' },
  { value: 'spare', label: 'Spare' },
  { value: 'inner_RL', label: 'Inner Rear Left' },
  { value: 'inner_RR', label: 'Inner Rear Right' },
]

const EMPTY_FORM = {
  serial_number: '', brand: '', size: '', position: 'FL',
  status: 'fitted', asset_id: '', tread_depth_mm: '',
  min_tread_mm: '3.0', fitment_date: '', fitment_km: '',
  removal_date: '', removal_km: '', removal_reason: '',
  purchase_cost: '', retread_count: '0', notes: '',
}

function treadColor(depth) {
  const d = Number(depth)
  if (isNaN(d)) return THEME.textLow
  if (d >= 5) return '#2e7d32'
  if (d >= 3) return '#f57f17'
  return '#c62828'
}

function TreadGauge({ depth, min }) {
  const d = Number(depth) || 0
  const m = Number(min) || 3
  const max = Math.max(d, m, 12)
  const pct = Math.min((d / max) * 100, 100)
  const clr = treadColor(d)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: clr, minWidth: '38px' }}>
        {d > 0 ? `${d}mm` : '-'}
      </span>
      <div style={{
        width: '60px', height: '8px', borderRadius: '4px',
        background: THEME.outlineVar, position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', borderRadius: '4px', background: clr,
          width: `${pct}%`, transition: 'width .3s',
        }} />
        {m > 0 && (
          <div style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${Math.min((m / max) * 100, 100)}%`,
            width: '2px', background: '#c62828',
          }} />
        )}
      </div>
    </div>
  )
}

export default function FleetTyres({ setPage }) {
  const { can } = usePermissions()
  const { assets, loading: fleetLoading } = useFleet()
  const { currentSiteId } = useSite()

  const [tyres, setTyres] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterAsset, setFilterAsset] = useState('all')
  const [searchBrand, setSearchBrand] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchTyres() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('fleet_tyres')
      .select('*, fleet_assets(id, asset_number, description, current_odometer_km)')
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    if (!err) setTyres(data || [])
    setLoading(false)
  }

  useEffect(() => {
    if (currentSiteId) fetchTyres()
  }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = tyres
    if (filterStatus !== 'all') list = list.filter(t => t.status === filterStatus)
    if (filterAsset !== 'all') list = list.filter(t => t.asset_id === filterAsset)
    if (searchBrand.trim()) {
      const q = searchBrand.toLowerCase()
      list = list.filter(t =>
        (t.brand || '').toLowerCase().includes(q) ||
        (t.serial_number || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [tyres, filterStatus, filterAsset, searchBrand])

  const kpis = useMemo(() => {
    return {
      total: tyres.length,
      fitted: tyres.filter(t => t.status === 'fitted').length,
      stock: tyres.filter(t => t.status === 'stock').length,
      lowTread: tyres.filter(t => {
        const d = Number(t.tread_depth_mm)
        const m = Number(t.min_tread_mm) || 3
        return !isNaN(d) && d > 0 && d < m
      }).length,
    }
  }, [tyres])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(tyre) {
    setEditId(tyre.id)
    setForm({
      serial_number: tyre.serial_number || '',
      brand: tyre.brand || '',
      size: tyre.size || '',
      position: tyre.position || 'FL',
      status: tyre.status || 'fitted',
      asset_id: tyre.asset_id || '',
      tread_depth_mm: tyre.tread_depth_mm ?? '',
      min_tread_mm: tyre.min_tread_mm ?? '3.0',
      fitment_date: tyre.fitment_date || '',
      fitment_km: tyre.fitment_km ?? '',
      removal_date: tyre.removal_date || '',
      removal_km: tyre.removal_km ?? '',
      removal_reason: tyre.removal_reason || '',
      purchase_cost: tyre.purchase_cost ?? '',
      retread_count: tyre.retread_count ?? '0',
      notes: tyre.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.serial_number.trim()) {
      setError('Serial number is required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        serial_number: form.serial_number.trim(),
        brand: form.brand.trim() || null,
        size: form.size.trim() || null,
        position: form.position || null,
        status: form.status || 'fitted',
        asset_id: form.asset_id || null,
        tread_depth_mm: form.tread_depth_mm !== '' ? Number(form.tread_depth_mm) : null,
        min_tread_mm: form.min_tread_mm !== '' ? Number(form.min_tread_mm) : 3.0,
        fitment_date: form.fitment_date || null,
        fitment_km: form.fitment_km !== '' ? Number(form.fitment_km) : null,
        removal_date: form.removal_date || null,
        removal_km: form.removal_km !== '' ? Number(form.removal_km) : null,
        removal_reason: form.removal_reason.trim() || null,
        purchase_cost: form.purchase_cost !== '' ? Number(form.purchase_cost) : null,
        retread_count: form.retread_count !== '' ? Number(form.retread_count) : 0,
        notes: form.notes.trim() || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_tyres').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_tyres').insert([payload])
        if (err) throw err
      }
      await fetchTyres()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function exportCSV() {
    const headers = ['Serial Number', 'Brand', 'Size', 'Position', 'Asset', 'Status', 'Tread (mm)', 'Min Tread (mm)', 'Fitment Date', 'Fitment KM', 'Removal Date', 'Removal KM', 'Removal Reason', 'Purchase Cost', 'Retread Count', 'Notes']
    const rows = filtered.map(t => [
      t.serial_number || '', t.brand || '', t.size || '', t.position || '',
      t.fleet_assets?.asset_number || '', t.status || '',
      t.tread_depth_mm ?? '', t.min_tread_mm ?? '',
      t.fitment_date || '', t.fitment_km ?? '',
      t.removal_date || '', t.removal_km ?? '',
      t.removal_reason || '', t.purchase_cost ?? '',
      t.retread_count ?? '', t.notes || '',
    ])
    const escape = v => {
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = '﻿' + [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fleet_tyres_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  function kmTravelled(t) {
    if (t.removal_km && t.fitment_km) return Math.max(0, Number(t.removal_km) - Number(t.fitment_km))
    if (t.fitment_km && t.fleet_assets?.current_odometer_km) return Math.max(0, Number(t.fleet_assets.current_odometer_km) - Number(t.fitment_km))
    return null
  }

  if (loading || fleetLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Tyres', value: kpis.total, icon: 'tire_repair', bg: color + '14', fg: color },
    { label: 'Fitted', value: kpis.fitted, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'In Stock', value: kpis.stock, icon: 'inventory_2', bg: '#e3f2fd', fg: '#1565c0' },
    { label: 'Low Tread', value: kpis.lowTread, icon: 'warning', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
  ]

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_tyres" />

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
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Tyre Management</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} tyre{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={exportCSV} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: THEME.surfaceVar, color: THEME.textMed,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>download</span>
            CSV
          </button>
          {can('fleet.create') && (
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              Add Tyre
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search brand / serial..."
          value={searchBrand}
          onChange={e => setSearchBrand(e.target.value)}
          style={{ ...inp, maxWidth: '220px' }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '150px' }}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterAsset} onChange={e => setFilterAsset(e.target.value)} style={{ ...inp, maxWidth: '200px' }}>
          <option value="all">All Assets</option>
          {(assets || []).map(a => <option key={a.id} value={a.id}>{a.asset_number}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>tire_repair</span>
          <div style={{ fontSize: '14px' }}>No tyres found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new tyre</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, background: THEME.surface }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                {['Serial #', 'Brand', 'Size', 'Position', 'Asset', 'Status', 'Tread', 'Fitment Date', 'KM Travelled'].map(h => (
                  <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const st = STATUS_MAP[t.status] || STATUS_MAP.fitted
                const km = kmTravelled(t)
                return (
                  <tr
                    key={t.id}
                    onClick={() => can('fleet.edit') ? openEdit(t) : null}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: can('fleet.edit') ? 'pointer' : 'default' }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: THEME.text, fontWeight: 500 }}>{t.serial_number || '-'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{t.brand || '-'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>{t.size || '-'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>{t.position || '-'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{t.fleet_assets?.asset_number || '-'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <StatusBadge status={t.status} />
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <TreadGauge depth={t.tread_depth_mm} min={t.min_tread_mm} />
                    </td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: THEME.text }}>{t.fitment_date || '-'}</td>
                    <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: THEME.text }}>{km != null ? km.toLocaleString() : '-'}</td>
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
                {editId ? 'Edit Tyre' : 'Add Tyre'}
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
                    <label style={lbl}>Serial Number *</label>
                    <input style={inp} value={form.serial_number} onChange={e => set('serial_number', e.target.value)} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Brand</label>
                      <input style={inp} value={form.brand} onChange={e => set('brand', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Size</label>
                      <input style={inp} value={form.size} onChange={e => set('size', e.target.value)} placeholder="e.g. 265/70R17" />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Position</label>
                      <select style={inp} value={form.position} onChange={e => set('position', e.target.value)}>
                        {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                      </select>
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Status</label>
                      <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                        {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Asset</label>
                    <select style={inp} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                      <option value="">-- No Asset --</option>
                      {(assets || []).map(a => <option key={a.id} value={a.id}>{a.asset_number} - {a.description}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Tread Depth (mm)</label>
                      <input style={inp} type="number" step="0.01" min="0" value={form.tread_depth_mm} onChange={e => set('tread_depth_mm', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Min Tread (mm)</label>
                      <input style={inp} type="number" step="0.01" min="0" value={form.min_tread_mm} onChange={e => set('min_tread_mm', e.target.value)} />
                    </div>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Purchase Cost</label>
                    <input style={inp} type="number" step="0.01" min="0" value={form.purchase_cost} onChange={e => set('purchase_cost', e.target.value)} />
                  </div>
                </div>

                {/* Right column */}
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Fitment Date</label>
                      <input style={inp} type="date" value={form.fitment_date} onChange={e => set('fitment_date', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Fitment KM</label>
                      <input style={inp} type="number" step="0.01" min="0" value={form.fitment_km} onChange={e => set('fitment_km', e.target.value)} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Removal Date</label>
                      <input style={inp} type="date" value={form.removal_date} onChange={e => set('removal_date', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Removal KM</label>
                      <input style={inp} type="number" step="0.01" min="0" value={form.removal_km} onChange={e => set('removal_km', e.target.value)} />
                    </div>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Removal Reason</label>
                    <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.removal_reason} onChange={e => set('removal_reason', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Retread Count</label>
                    <input style={inp} type="number" min="0" value={form.retread_count} onChange={e => set('retread_count', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Notes</label>
                    <textarea style={{ ...inp, minHeight: '70px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
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
