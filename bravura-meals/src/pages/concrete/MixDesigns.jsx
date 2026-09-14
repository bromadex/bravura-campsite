import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'

const color = '#1565C0'

const EMPTY_FORM = {
  grade: '', name: '', description: '',
  cement_kg_per_m3: '', water_litres_per_m3: '',
  is_active: true,
}

const EMPTY_AGG_ROW = { aggregate_type_id: '', quantity_kg_per_m3: '' }

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

export default function MixDesigns({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [designs, setDesigns] = useState([])
  const [aggregateTypes, setAggregateTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [aggRows, setAggRows] = useState([])
  const [saving, setSaving] = useState(false)
  const [usedDesignIds, setUsedDesignIds] = useState(new Set())

  const fetchDesigns = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('mix_designs')
      .select('*, mix_design_aggregates(id, aggregate_type_id, quantity_kg_per_m3)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('grade', { ascending: true })
    if (error) {
      showToast(error.message, 'red')
    } else {
      setDesigns(data || [])
    }
    setLoading(false)
  }, [currentSiteId])

  const fetchAggregateTypes = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase
      .from('aggregate_types')
      .select('id, name, unit')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('name')
    setAggregateTypes(data || [])
  }, [currentSiteId])

  const fetchUsedDesigns = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase
      .from('concrete_batches')
      .select('mix_design_id')
      .eq('site_id', currentSiteId)
    if (data) {
      setUsedDesignIds(new Set(data.map(r => r.mix_design_id)))
    }
  }, [currentSiteId])

  useEffect(() => {
    fetchDesigns()
    fetchAggregateTypes()
    fetchUsedDesigns()
  }, [fetchDesigns, fetchAggregateTypes, fetchUsedDesigns])

  const filtered = useMemo(() => {
    if (!search.trim()) return designs
    const q = search.toLowerCase()
    return designs.filter(d =>
      (d.grade || '').toLowerCase().includes(q) ||
      (d.name || '').toLowerCase().includes(q)
    )
  }, [designs, search])

  // Aggregate type lookup
  const aggTypeMap = useMemo(() => {
    const m = {}
    aggregateTypes.forEach(t => { m[t.id] = t })
    return m
  }, [aggregateTypes])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setAggRows([{ ...EMPTY_AGG_ROW }])
    setModalOpen(true)
  }

  function openEdit(design) {
    setEditId(design.id)
    setForm({
      grade: design.grade || '',
      name: design.name || '',
      description: design.description || '',
      cement_kg_per_m3: design.cement_kg_per_m3 ?? '',
      water_litres_per_m3: design.water_litres_per_m3 ?? '',
      is_active: design.is_active !== false,
    })
    const rows = (design.mix_design_aggregates || []).map(a => ({
      aggregate_type_id: a.aggregate_type_id,
      quantity_kg_per_m3: a.quantity_kg_per_m3 ?? '',
    }))
    setAggRows(rows.length ? rows : [{ ...EMPTY_AGG_ROW }])
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.grade.trim()) { showToast('Grade is required', 'red'); return }
    if (!form.cement_kg_per_m3 || Number(form.cement_kg_per_m3) <= 0) {
      showToast('Cement kg/m³ must be greater than 0', 'red'); return
    }
    if (!form.water_litres_per_m3 || Number(form.water_litres_per_m3) <= 0) {
      showToast('Water L/m³ must be greater than 0', 'red'); return
    }
    // Validate aggregate rows that have data
    const validAggs = aggRows.filter(r => r.aggregate_type_id && r.quantity_kg_per_m3)
    for (const r of validAggs) {
      if (Number(r.quantity_kg_per_m3) <= 0) {
        showToast('Aggregate quantities must be greater than 0', 'red'); return
      }
    }

    setSaving(true)
    try {
      const payload = {
        site_id: currentSiteId,
        grade: form.grade.trim(),
        name: form.name.trim() || null,
        description: form.description.trim() || null,
        cement_kg_per_m3: Number(form.cement_kg_per_m3),
        water_litres_per_m3: Number(form.water_litres_per_m3),
        is_active: form.is_active,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      }

      let designId = editId
      if (editId) {
        const { error: err } = await supabase.from('mix_designs').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        payload.created_by = user.id
        const { data, error: err } = await supabase.from('mix_designs').insert(payload).select('id').single()
        if (err) throw err
        designId = data.id
      }

      // Replace aggregate rows: delete existing, insert new
      if (editId) {
        const { error: delErr } = await supabase
          .from('mix_design_aggregates')
          .delete()
          .eq('mix_design_id', editId)
        if (delErr) throw delErr
      }
      if (validAggs.length > 0) {
        const aggPayload = validAggs.map(r => ({
          mix_design_id: designId,
          aggregate_type_id: r.aggregate_type_id,
          quantity_kg_per_m3: Number(r.quantity_kg_per_m3),
        }))
        const { error: aggErr } = await supabase.from('mix_design_aggregates').insert(aggPayload)
        if (aggErr) throw aggErr
      }

      showToast(editId ? 'Mix design updated' : 'Mix design created', 'green')
      setModalOpen(false)
      await fetchDesigns()
    } catch (err) {
      showToast(err.message || 'Save failed', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!editId) return
    if (usedDesignIds.has(editId)) {
      if (!confirm('This mix design has been used in concrete batches. Archive anyway?')) return
    } else {
      if (!confirm('Archive this mix design?')) return
    }
    try {
      const { error: err } = await supabase
        .from('mix_designs')
        .update({ is_archived: true, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', editId)
      if (err) throw err
      showToast('Mix design archived', 'green')
      setModalOpen(false)
      await fetchDesigns()
    } catch (err) {
      showToast(err.message || 'Archive failed', 'red')
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function setAggRow(idx, field, value) {
    setAggRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }
  function addAggRow() { setAggRows(prev => [...prev, { ...EMPTY_AGG_ROW }]) }
  function removeAggRow(idx) { setAggRows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)) }

  // Permission gate
  if (!can('concrete.view')) {
    return (
      <div style={{ padding: '0' }}>
        <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_mix_designs" />
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>lock</span>
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            You do not have permission to view mix designs.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0' }}>
      <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_mix_designs" />

      <div style={{ padding: '8px 16px 40px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '28px', color }}>science</span>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: THEME.text }}>Mix Designs</h2>
            <span style={{
              background: color + '18', color, fontSize: '12px', fontWeight: 600,
              padding: '2px 10px', borderRadius: '12px',
            }}>
              {filtered.length}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search grade or name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                ...inp, width: '220px',
                background: THEME.cardBg,
              }}
            />
            {can('concrete.create') && (
              <button
                onClick={openAdd}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: '8px', border: 'none',
                  background: color, color: '#fff', fontSize: '13px',
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
                New Design
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '36px', color: THEME.textLow, animation: 'spin 1s linear infinite' }}>progress_activity</span>
            <p style={{ color: THEME.textLow, fontSize: '13px', marginTop: '8px' }}>Loading mix designs...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            background: THEME.cardBg, border: '1px solid ' + THEME.border,
            borderRadius: '12px', padding: '40px', textAlign: 'center',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>science</span>
            <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
              {search ? 'No mix designs match your search.' : 'No mix designs yet. Create your first one.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{
              width: '100%', borderCollapse: 'separate', borderSpacing: 0,
              fontSize: '13px', background: THEME.cardBg,
              border: '1px solid ' + THEME.border, borderRadius: '12px',
              overflow: 'hidden',
            }}>
              <thead>
                <tr style={{ background: THEME.surface }}>
                  {['Grade', 'Name', 'Cement (kg/m³)', 'Water (L/m³)', 'Aggregates', 'Status', ''].map((h, i) => (
                    <th key={i} style={{
                      padding: '10px 14px', textAlign: 'left', fontSize: '11px',
                      fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase',
                      letterSpacing: '0.5px', borderBottom: '1px solid ' + THEME.border,
                      whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((d, idx) => {
                  const aggSummary = (d.mix_design_aggregates || [])
                    .map(a => {
                      const t = aggTypeMap[a.aggregate_type_id]
                      return t ? `${t.name}: ${a.quantity_kg_per_m3} kg` : `${a.quantity_kg_per_m3} kg`
                    })
                    .join(', ')
                  const isUsed = usedDesignIds.has(d.id)
                  return (
                    <tr
                      key={d.id}
                      onClick={() => can('concrete.edit') ? openEdit(d) : null}
                      style={{
                        cursor: can('concrete.edit') ? 'pointer' : 'default',
                        borderBottom: idx < filtered.length - 1 ? '1px solid ' + THEME.border : 'none',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surface}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: THEME.text, whiteSpace: 'nowrap' }}>
                        {d.grade}
                        {isUsed && (
                          <span title="Used in batches" style={{ marginLeft: '6px', fontSize: '14px', verticalAlign: 'middle', color: '#EF6C00' }}>
                            <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>link</span>
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{d.name || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{d.cement_kg_per_m3}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{d.water_litres_per_m3}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {aggSummary || '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px', borderRadius: '12px',
                          fontSize: '11px', fontWeight: 600,
                          background: d.is_active ? '#e8f5e9' : '#fbe9e7',
                          color: d.is_active ? '#2e7d32' : '#c62828',
                        }}>
                          {d.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        {can('concrete.edit') && (
                          <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textLow }}>edit</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div
          onClick={() => setModalOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '16px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: THEME.cardBg, borderRadius: '16px', width: '100%',
              maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto',
              boxShadow: '0 16px 48px rgba(0,0,0,0.2)', padding: '24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: THEME.text }}>
                {editId ? 'Edit Mix Design' : 'New Mix Design'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            {/* Version warning */}
            {editId && usedDesignIds.has(editId) && (
              <div style={{
                background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: '8px',
                padding: '10px 14px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px', color: '#e65100' }}>warning</span>
                <span style={{ fontSize: '12px', color: '#e65100', fontWeight: 500 }}>
                  This design has been used in concrete batches. Changes will not affect existing batches.
                </span>
              </div>
            )}

            {/* Grade + Name */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={fieldWrap}>
                <label style={lbl}>Grade *</label>
                <input style={inp} value={form.grade} onChange={e => set('grade', e.target.value)} placeholder="e.g. C25/30" />
              </div>
              <div style={fieldWrap}>
                <label style={lbl}>Name</label>
                <input style={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Foundation Mix" />
              </div>
            </div>

            {/* Description */}
            <div style={fieldWrap}>
              <label style={lbl}>Description</label>
              <textarea
                style={{ ...inp, minHeight: '60px', resize: 'vertical' }}
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Optional notes about this mix design"
              />
            </div>

            {/* Cement + Water */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={fieldWrap}>
                <label style={lbl}>Cement (kg/m³) *</label>
                <input style={inp} type="number" min="0" step="0.1" value={form.cement_kg_per_m3}
                  onChange={e => set('cement_kg_per_m3', e.target.value)} placeholder="0.0" />
              </div>
              <div style={fieldWrap}>
                <label style={lbl}>Water (L/m³) *</label>
                <input style={inp} type="number" min="0" step="0.1" value={form.water_litres_per_m3}
                  onChange={e => set('water_litres_per_m3', e.target.value)} placeholder="0.0" />
              </div>
            </div>

            {/* W/C Ratio display */}
            {form.cement_kg_per_m3 > 0 && form.water_litres_per_m3 > 0 && (
              <div style={{
                background: color + '10', borderRadius: '8px', padding: '8px 14px',
                marginBottom: '12px', fontSize: '12px', color, fontWeight: 600,
              }}>
                W/C Ratio: {(Number(form.water_litres_per_m3) / Number(form.cement_kg_per_m3)).toFixed(3)}
              </div>
            )}

            {/* Aggregates */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <label style={{ ...lbl, margin: 0 }}>Aggregates</label>
                <button
                  onClick={addAggRow}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '4px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '12px', color, fontWeight: 600, fontFamily: 'inherit',
                  }}
                >
                  <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>
                  Add Row
                </button>
              </div>
              {aggRows.map((row, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                  <select
                    style={{ ...inp, flex: 2 }}
                    value={row.aggregate_type_id}
                    onChange={e => setAggRow(idx, 'aggregate_type_id', e.target.value)}
                  >
                    <option value="">Select aggregate...</option>
                    {aggregateTypes.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.unit || 'kg'})</option>
                    ))}
                  </select>
                  <input
                    style={{ ...inp, flex: 1 }}
                    type="number" min="0" step="0.1"
                    placeholder="kg/m³"
                    value={row.quantity_kg_per_m3}
                    onChange={e => setAggRow(idx, 'quantity_kg_per_m3', e.target.value)}
                  />
                  <button
                    onClick={() => removeAggRow(idx)}
                    disabled={aggRows.length <= 1}
                    style={{
                      background: 'none', border: 'none', cursor: aggRows.length <= 1 ? 'default' : 'pointer',
                      opacity: aggRows.length <= 1 ? 0.3 : 1, padding: '4px',
                    }}
                  >
                    <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textLow }}>delete</span>
                  </button>
                </div>
              ))}
              {aggregateTypes.length === 0 && (
                <p style={{ fontSize: '11px', color: THEME.textLow, margin: '4px 0 0' }}>
                  No aggregate types defined. Add them in Aggregate Inventory first.
                </p>
              )}
            </div>

            {/* Active toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <label style={{ ...lbl, margin: 0 }}>Active</label>
              <button
                onClick={() => set('is_active', !form.is_active)}
                style={{
                  width: '40px', height: '22px', borderRadius: '11px', border: 'none',
                  background: form.is_active ? '#2e7d32' : THEME.outlineVar,
                  position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: '3px',
                  left: form.is_active ? '21px' : '3px',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
              <span style={{ fontSize: '12px', color: THEME.textMed }}>
                {form.is_active ? 'Available for batching' : 'Hidden from batch selection'}
              </span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
              <div>
                {editId && can('concrete.edit') && (
                  <button
                    onClick={handleArchive}
                    style={{
                      padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
                      fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      background: '#fbe9e7', color: '#c62828', border: '1px solid #ef9a9a',
                    }}
                  >
                    Archive
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setModalOpen(false)}
                  style={{
                    padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
                    fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                    background: THEME.surface, color: THEME.textMed, border: '1px solid ' + THEME.border,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{
                    padding: '8px 20px', borderRadius: '8px', fontSize: '13px',
                    fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', background: color, color: '#fff',
                    border: 'none', opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
