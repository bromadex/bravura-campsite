import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'

const color = '#C62828'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: '7day_tested', label: '7-Day Tested' },
  { value: '28day_tested', label: '28-Day Tested' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
]

const STATUS_COLORS = {
  pending: { bg: '#fff3e0', fg: '#e65100' },
  '7day_tested': { bg: '#e3f2fd', fg: '#1565c0' },
  '28day_tested': { bg: '#e8eaf6', fg: '#283593' },
  passed: { bg: '#e8f5e9', fg: '#2e7d32' },
  failed: { bg: '#fbe9e7', fg: '#c62828' },
}

const EMPTY_FORM = {
  batch_id: '',
  sample_number: '',
  test_date_7day: '',
  result_7day_mpa: '',
  test_date_28day: '',
  result_28day_mpa: '',
  target_strength_mpa: '',
  tested_by: '',
  notes: '',
}

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
const fieldWrap = { marginBottom: '12px' }

function deriveStatus(form) {
  const has7 = form.result_7day_mpa !== '' && form.result_7day_mpa !== null
  const has28 = form.result_28day_mpa !== '' && form.result_28day_mpa !== null
  const target = Number(form.target_strength_mpa) || 0
  if (has28) {
    const r28 = Number(form.result_28day_mpa)
    if (target > 0 && r28 >= target) return 'passed'
    if (target > 0 && r28 < target) return 'failed'
    return '28day_tested'
  }
  if (has7) return '7day_tested'
  return 'pending'
}

function generateSampleNumber() {
  const d = new Date()
  const ymd = d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')
  return `CT-${ymd}-${seq}`
}

function gradeToTarget(grade) {
  if (!grade) return ''
  const m = grade.match(/[Cc](\d+)/)
  return m ? m[1] : ''
}

function formatStatusLabel(status) {
  return (status || 'pending')
    .replace('7day_tested', '7-Day Tested')
    .replace('28day_tested', '28-Day Tested')
    .replace('pending', 'Pending')
    .replace('passed', 'Passed')
    .replace('failed', 'Failed')
}

export default function CubeTests({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [tests, setTests] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)

  const fetchTests = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('cube_tests')
      .select('*, concrete_batches(id, batch_number, grade)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    if (error) {
      showToast(error.message, 'red')
    } else {
      setTests(data || [])
    }
    setLoading(false)
  }, [currentSiteId])

  const fetchBatches = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase
      .from('concrete_batches')
      .select('id, batch_number, grade')
      .eq('site_id', currentSiteId)
      .order('batch_number', { ascending: false })
    setBatches(data || [])
  }, [currentSiteId])

  useEffect(() => {
    fetchTests()
    fetchBatches()
  }, [fetchTests, fetchBatches])

  const batchMap = useMemo(() => {
    const m = {}
    batches.forEach(b => { m[b.id] = b })
    return m
  }, [batches])

  const filtered = useMemo(() => {
    let list = tests
    if (statusFilter !== 'all') {
      list = list.filter(t => t.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t => {
        const b = t.concrete_batches
        return (t.sample_number || '').toLowerCase().includes(q) ||
          (b?.batch_number || '').toLowerCase().includes(q) ||
          (b?.grade || '').toLowerCase().includes(q)
      })
    }
    return list
  }, [tests, statusFilter, search])

  // KPIs
  const kpis = useMemo(() => {
    const total = tests.length
    const pending = tests.filter(t => t.status === 'pending').length
    const with28 = tests.filter(t => t.result_28day_mpa != null && t.target_strength_mpa != null && t.target_strength_mpa > 0)
    const passed28 = with28.filter(t => Number(t.result_28day_mpa) >= Number(t.target_strength_mpa)).length
    const passRate = with28.length > 0 ? Math.round((passed28 / with28.length) * 100) : null
    const failed = tests.filter(t => t.status === 'failed').length
    return { total, pending, passRate, failed }
  }, [tests])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM, sample_number: generateSampleNumber() })
    setModalOpen(true)
  }

  function openEdit(t) {
    setEditId(t.id)
    setForm({
      batch_id: t.batch_id || '',
      sample_number: t.sample_number || '',
      test_date_7day: t.test_date_7day || '',
      result_7day_mpa: t.result_7day_mpa ?? '',
      test_date_28day: t.test_date_28day || '',
      result_28day_mpa: t.result_28day_mpa ?? '',
      target_strength_mpa: t.target_strength_mpa ?? '',
      tested_by: t.tested_by || '',
      notes: t.notes || '',
    })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.batch_id) { showToast('Batch is required', 'red'); return }
    if (!form.sample_number.trim()) { showToast('Sample number is required', 'red'); return }

    const status = deriveStatus(form)
    setSaving(true)
    try {
      const payload = {
        site_id: currentSiteId,
        batch_id: form.batch_id,
        sample_number: form.sample_number.trim(),
        test_date_7day: form.test_date_7day || null,
        result_7day_mpa: form.result_7day_mpa !== '' ? Number(form.result_7day_mpa) : null,
        test_date_28day: form.test_date_28day || null,
        result_28day_mpa: form.result_28day_mpa !== '' ? Number(form.result_28day_mpa) : null,
        target_strength_mpa: form.target_strength_mpa !== '' ? Number(form.target_strength_mpa) : null,
        status,
        tested_by: form.tested_by.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      }

      if (editId) {
        const { error: err } = await supabase.from('cube_tests').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('cube_tests').insert(payload)
        if (err) throw err
      }

      showToast(editId ? 'Cube test updated' : 'Cube test created', 'green')
      setModalOpen(false)
      await fetchTests()
    } catch (err) {
      showToast(err.message || 'Save failed', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!editId) return
    if (!confirm('Archive this cube test?')) return
    try {
      const { error: err } = await supabase
        .from('cube_tests')
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .eq('id', editId)
      if (err) throw err
      showToast('Cube test archived', 'green')
      setModalOpen(false)
      await fetchTests()
    } catch (err) {
      showToast(err.message || 'Archive failed', 'red')
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function onBatchChange(batchId) {
    set('batch_id', batchId)
    const b = batchMap[batchId]
    if (b) {
      const target = gradeToTarget(b.grade)
      if (target) set('target_strength_mpa', target)
    }
  }

  function resultColor(result, target) {
    if (result == null || result === '') return THEME.textLow
    if (!target || target <= 0) return THEME.text
    return Number(result) >= Number(target) ? '#2e7d32' : '#c62828'
  }

  // Permission gate
  if (!can('concrete.view')) {
    return (
      <div style={{ padding: '0' }}>
        <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_cube_tests" />
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>lock</span>
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            You do not have permission to view cube tests.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '0' }}>
      <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_cube_tests" />

      <div style={{ padding: '8px 16px 40px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '28px', color }}>verified</span>
            <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: THEME.text }}>Cube Tests</h2>
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
              placeholder="Search sample, batch, grade..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...inp, width: '220px', background: THEME.cardBg }}
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
                New Test
              </button>
            )}
          </div>
        </div>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          {[
            { label: 'Total Samples', value: kpis.total, icon: 'science', iconColor: '#1565c0' },
            { label: 'Pending', value: kpis.pending, icon: 'hourglass_empty', iconColor: '#e65100' },
            { label: 'Pass Rate (28d)', value: kpis.passRate != null ? `${kpis.passRate}%` : '—', icon: 'check_circle', iconColor: '#2e7d32' },
            { label: 'Failed', value: kpis.failed, icon: 'cancel', iconColor: '#c62828' },
          ].map((kpi, i) => (
            <div key={i} style={{
              background: THEME.cardBg, border: '1px solid ' + THEME.border,
              borderRadius: '12px', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '28px', color: kpi.iconColor }}>{kpi.icon}</span>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{kpi.label}</div>
                <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{kpi.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Status filter pills */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {STATUS_OPTIONS.map(s => {
            const active = statusFilter === s.value
            return (
              <button
                key={s.value}
                onClick={() => setStatusFilter(s.value)}
                style={{
                  padding: '6px 14px', borderRadius: '20px', fontSize: '12px',
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  border: active ? 'none' : '1px solid ' + THEME.border,
                  background: active ? color : THEME.cardBg,
                  color: active ? '#fff' : THEME.textMed,
                  transition: 'all 0.15s',
                }}
              >
                {s.label}
              </button>
            )
          })}
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <span className="material-symbols-rounded" style={{ fontSize: '36px', color: THEME.textLow, animation: 'spin 1s linear infinite' }}>progress_activity</span>
            <p style={{ color: THEME.textLow, fontSize: '13px', marginTop: '8px' }}>Loading cube tests...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{
            background: THEME.cardBg, border: '1px solid ' + THEME.border,
            borderRadius: '12px', padding: '40px', textAlign: 'center',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '48px', color: THEME.textLow }}>verified</span>
            <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
              {search || statusFilter !== 'all' ? 'No cube tests match your filters.' : 'No cube tests yet. Create your first one.'}
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
                  {['Sample #', 'Batch #', 'Grade', 'Target MPa', '7-Day Result', '28-Day Result', 'Status', ''].map((h, i) => (
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
                {filtered.map((t, idx) => {
                  const b = t.concrete_batches
                  const sc = STATUS_COLORS[t.status] || STATUS_COLORS.pending
                  return (
                    <tr
                      key={t.id}
                      onClick={() => can('concrete.edit') ? openEdit(t) : null}
                      style={{
                        cursor: can('concrete.edit') ? 'pointer' : 'default',
                        borderBottom: idx < filtered.length - 1 ? '1px solid ' + THEME.border : 'none',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surface}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: THEME.text, whiteSpace: 'nowrap' }}>
                        {t.sample_number}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{b?.batch_number || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 600 }}>{b?.grade || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>
                        {t.target_strength_mpa != null ? t.target_strength_mpa : '—'}
                      </td>
                      <td style={{
                        padding: '10px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                        color: resultColor(t.result_7day_mpa, t.target_strength_mpa),
                      }}>
                        {t.result_7day_mpa != null ? `${t.result_7day_mpa} MPa` : '—'}
                      </td>
                      <td style={{
                        padding: '10px 14px', fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                        color: resultColor(t.result_28day_mpa, t.target_strength_mpa),
                      }}>
                        {t.result_28day_mpa != null ? `${t.result_28day_mpa} MPa` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 10px', borderRadius: '12px',
                          fontSize: '11px', fontWeight: 600, background: sc.bg, color: sc.fg,
                          whiteSpace: 'nowrap',
                        }}>
                          {formatStatusLabel(t.status)}
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
                {editId ? 'Edit Cube Test' : 'New Cube Test'}
              </h3>
              <button
                onClick={() => setModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}
              >
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            {/* Batch dropdown */}
            <div style={fieldWrap}>
              <label style={lbl}>Batch *</label>
              <select
                style={inp}
                value={form.batch_id}
                onChange={e => onBatchChange(e.target.value)}
              >
                <option value="">Select batch...</option>
                {batches.map(b => (
                  <option key={b.id} value={b.id}>{b.batch_number} — {b.grade}</option>
                ))}
              </select>
            </div>

            {/* Sample number + Target */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={fieldWrap}>
                <label style={lbl}>Sample Number *</label>
                <input style={inp} value={form.sample_number} onChange={e => set('sample_number', e.target.value)} />
              </div>
              <div style={fieldWrap}>
                <label style={lbl}>Target Strength (MPa)</label>
                <input style={inp} type="number" min="0" step="0.1" value={form.target_strength_mpa}
                  onChange={e => set('target_strength_mpa', e.target.value)} placeholder="e.g. 25" />
              </div>
            </div>

            {/* 7-day */}
            <div style={{
              background: color + '08', borderRadius: '10px', padding: '12px 14px',
              marginBottom: '12px', border: '1px solid ' + color + '20',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color, marginBottom: '8px' }}>7-Day Test</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={lbl}>Test Date</label>
                  <input style={inp} type="date" value={form.test_date_7day}
                    onChange={e => set('test_date_7day', e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Result (MPa)</label>
                  <input style={inp} type="number" min="0" step="0.1" value={form.result_7day_mpa}
                    onChange={e => set('result_7day_mpa', e.target.value)} placeholder="0.0" />
                </div>
              </div>
            </div>

            {/* 28-day */}
            <div style={{
              background: color + '08', borderRadius: '10px', padding: '12px 14px',
              marginBottom: '12px', border: '1px solid ' + color + '20',
            }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color, marginBottom: '8px' }}>28-Day Test</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={lbl}>Test Date</label>
                  <input style={inp} type="date" value={form.test_date_28day}
                    onChange={e => set('test_date_28day', e.target.value)} />
                </div>
                <div>
                  <label style={lbl}>Result (MPa)</label>
                  <input style={inp} type="number" min="0" step="0.1" value={form.result_28day_mpa}
                    onChange={e => set('result_28day_mpa', e.target.value)} placeholder="0.0" />
                </div>
              </div>
            </div>

            {/* Status preview */}
            {(() => {
              const st = deriveStatus(form)
              const sc = STATUS_COLORS[st] || STATUS_COLORS.pending
              return (
                <div style={{
                  background: sc.bg, borderRadius: '8px', padding: '8px 14px',
                  marginBottom: '12px', fontSize: '12px', fontWeight: 600, color: sc.fg,
                }}>
                  Status: {formatStatusLabel(st)}
                </div>
              )
            })()}

            {/* Tested by + Notes */}
            <div style={fieldWrap}>
              <label style={lbl}>Tested By</label>
              <input style={inp} value={form.tested_by} onChange={e => set('tested_by', e.target.value)} placeholder="Name of tester" />
            </div>
            <div style={fieldWrap}>
              <label style={lbl}>Notes</label>
              <textarea
                style={{ ...inp, minHeight: '60px', resize: 'vertical' }}
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Optional notes"
              />
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
