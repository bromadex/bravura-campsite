import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast, ModalOverlay } from '../../components/ui'
import QuickNav, { PROJECT_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.projects

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled']
const TYPES = ['construction', 'mining', 'maintenance', 'infrastructure', 'exploration', 'other']
const PRIORITIES = ['low', 'medium', 'high', 'critical']
const PRIORITY_COLORS = { low: '#43A047', medium: '#1565C0', high: '#E65100', critical: '#C62828' }
const STATUS_COLORS = {
  planning:  { bg: '#E3F2FD', text: '#1565C0', label: 'Planning' },
  active:    { bg: '#E8F5E9', text: '#2E7D32', label: 'Active' },
  on_hold:   { bg: '#FFF3E0', text: '#E65100', label: 'On Hold' },
  completed: { bg: '#F3E5F5', text: '#6A1B9A', label: 'Completed' },
  cancelled: { bg: '#FFEBEE', text: '#B71C1C', label: 'Cancelled' },
}

const COVER_COLORS = ['#1B5E20', '#0D47A1', '#4A148C', '#BF360C', '#006064', '#3E2723', '#263238', '#880E4F', '#E65100', '#1A237E']

const EMPTY_FORM = {
  name: '', description: '', project_type: 'other', status: 'planning',
  priority: 'medium', start_date: '', target_end_date: '', budget: '',
  client: '', location: '', cover_color: '#1B5E20', notes: '',
}

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function PJList({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('projects', { column: 'site_id', value: currentSiteId }, fetchProjects)

  const [projects, setProjects] = useState([])
  const [phases, setPhases] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [viewMode, setViewMode] = useState('cards')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchProjects() {
    if (!currentSiteId) return
    setLoading(true)
    const [pRes, phRes, mRes] = await Promise.all([
      supabase.from('projects').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('project_phases').select('id, project_id, status, weight'),
      supabase.from('project_members').select('id, project_id, is_active'),
    ])
    if (pRes.error) showToast(pRes.error.message, 'red')
    setProjects(pRes.data || [])
    setPhases(phRes.data || [])
    setMembers(mRes.data || [])
    setLoading(false)
  }

  useEffect(() => { fetchProjects() }, [currentSiteId])

  const phaseProgress = useMemo(() => {
    const byProject = {}
    phases.forEach(ph => {
      if (!byProject[ph.project_id]) byProject[ph.project_id] = { total: 0, completed: 0 }
      byProject[ph.project_id].total += ph.weight || 1
      if (ph.status === 'completed') byProject[ph.project_id].completed += ph.weight || 1
    })
    return byProject
  }, [phases])

  const memberCounts = useMemo(() => {
    const counts = {}
    members.forEach(m => {
      if (m.is_active) counts[m.project_id] = (counts[m.project_id] || 0) + 1
    })
    return counts
  }, [members])

  const filtered = useMemo(() => {
    let list = projects
    if (filterStatus) list = list.filter(p => p.status === filterStatus)
    if (filterType) list = list.filter(p => p.project_type === filterType)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.project_code.toLowerCase().includes(q) ||
        (p.client || '').toLowerCase().includes(q) ||
        (p.location || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [projects, filterStatus, filterType, search])

  async function generateCode() {
    const { data } = await supabase.from('projects').select('project_code').eq('site_id', currentSiteId).like('project_code', 'PJ-%').order('project_code', { ascending: false }).limit(1)
    const last = data?.[0]?.project_code
    const next = last ? parseInt(last.replace('PJ-', ''), 10) + 1 : 1
    return `PJ-${String(next).padStart(3, '0')}`
  }

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(p) {
    setEditId(p.id)
    const f = {}
    for (const k of Object.keys(EMPTY_FORM)) f[k] = p[k] ?? EMPTY_FORM[k]
    setForm(f)
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Project name is required'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        name: form.name.trim(),
        description: form.description || null,
        project_type: form.project_type,
        status: form.status,
        priority: form.priority,
        start_date: form.start_date || null,
        target_end_date: form.target_end_date || null,
        budget: form.budget ? parseFloat(form.budget) : null,
        client: form.client || null,
        location: form.location || null,
        cover_color: form.cover_color,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('projects').update(payload).eq('id', editId)
        if (err) throw err
        showToast('Project updated', 'green')
      } else {
        payload.project_code = await generateCode()
        const { error: err } = await supabase.from('projects').insert(payload)
        if (err) throw err
        showToast('Project created', 'green')
      }
      await fetchProjects()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this project?')) return
    try {
      const { error: err } = await supabase.from('projects').update({ is_archived: true, archived_at: new Date().toISOString() }).eq('id', editId)
      if (err) throw err
      showToast('Project archived', 'green')
      await fetchProjects()
      setModalOpen(false)
    } catch (err) {
      showToast(err.message, 'red')
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

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={PROJECT_PILLS} setPage={setPage} current="pj_projects" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Projects</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} project{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={() => setViewMode(viewMode === 'cards' ? 'list' : 'cards')} style={{
            padding: '6px 10px', borderRadius: '8px', background: THEME.surfaceVar,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', color: THEME.textMed,
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>{viewMode === 'cards' ? 'view_list' : 'grid_view'}</span>
          </button>
          {can('projects.create') && (
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              New Project
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input placeholder="Search name, code, client..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '240px' }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '150px' }}>
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="">All Types</option>
          {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>engineering</span>
          <div style={{ fontSize: '14px' }}>No projects found</div>
          {can('projects.create') && (
            <button onClick={openAdd} style={{
              marginTop: '12px', padding: '8px 20px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              Create First Project
            </button>
          )}
        </div>
      ) : viewMode === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {filtered.map(p => {
            const sc = STATUS_COLORS[p.status] || STATUS_COLORS.planning
            const prog = phaseProgress[p.id]
            const pct = prog && prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0
            const mc = memberCounts[p.id] || 0
            const overdue = p.status === 'active' && p.target_end_date && new Date(p.target_end_date) < new Date()
            return (
              <div key={p.id}
                onClick={() => can('projects.edit') ? openEdit(p) : null}
                style={{
                  borderRadius: '14px', overflow: 'hidden', cursor: can('projects.edit') ? 'pointer' : 'default',
                  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
                  boxShadow: THEME.shadow1, transition: 'box-shadow .15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = THEME.shadow2}
                onMouseLeave={e => e.currentTarget.style.boxShadow = THEME.shadow1}
              >
                {/* Cover color stripe */}
                <div style={{ height: '6px', background: p.cover_color || color }} />

                <div style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <div style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 600 }}>{p.project_code}</div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: sc.bg, color: sc.text }}>{sc.label}</span>
                      <span style={{
                        fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px',
                        background: PRIORITY_COLORS[p.priority] + '18', color: PRIORITY_COLORS[p.priority],
                      }}>{p.priority}</span>
                    </div>
                  </div>

                  <div style={{ fontSize: '15px', fontWeight: 600, color: THEME.text, marginBottom: '4px', lineHeight: 1.3 }}>{p.name}</div>

                  {p.client && <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>{p.client}</div>}

                  {/* Progress bar */}
                  {prog && prog.total > 0 && (
                    <div style={{ marginBottom: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: THEME.textLow, marginBottom: '3px' }}>
                        <span>Progress</span>
                        <span style={{ fontWeight: 600 }}>{pct}%</span>
                      </div>
                      <div style={{ height: '4px', borderRadius: '2px', background: THEME.outlineVar }}>
                        <div style={{ height: '100%', borderRadius: '2px', background: p.cover_color || color, width: `${pct}%`, transition: 'width .3s' }} />
                      </div>
                    </div>
                  )}

                  {/* Footer */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: THEME.textLow }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {p.budget > 0 && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>payments</span>
                          {fmtMoney(p.budget)}
                        </span>
                      )}
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>group</span>
                        {mc}
                      </span>
                    </div>
                    {overdue && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: '#C62828', fontWeight: 600 }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>warning</span>
                        Overdue
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        /* List view */
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Code', 'Name', 'Type', 'Status', 'Priority', 'Budget', 'Progress', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const sc = STATUS_COLORS[p.status] || STATUS_COLORS.planning
                const prog = phaseProgress[p.id]
                const pct = prog && prog.total > 0 ? Math.round((prog.completed / prog.total) * 100) : 0
                return (
                  <tr key={p.id}
                    onClick={() => can('projects.edit') ? openEdit(p) : null}
                    style={{ cursor: can('projects.edit') ? 'pointer' : 'default', borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.textMed }}>{p.project_code}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>{p.name}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{p.project_type}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '6px', background: sc.bg, color: sc.text }}>{sc.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: PRIORITY_COLORS[p.priority] }}>{p.priority}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{p.budget ? fmtMoney(p.budget) : '-'}</td>
                    <td style={{ padding: '10px 12px', width: '100px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: THEME.outlineVar }}>
                          <div style={{ height: '100%', borderRadius: '2px', background: color, width: `${pct}%` }} />
                        </div>
                        <span style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 600 }}>{pct}%</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button onClick={e => { e.stopPropagation(); setPage('pj_detail_' + p.id) }} style={{
                        padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                        background: THEME.surfaceVar, color: THEME.textMed,
                        border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                        Open
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '640px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Project' : 'New Project'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {/* Cover color */}
              <div style={fieldWrap}>
                <label style={lbl}>Cover Color</label>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {COVER_COLORS.map(c => (
                    <div key={c} onClick={() => set('cover_color', c)} style={{
                      width: '28px', height: '28px', borderRadius: '8px', background: c, cursor: 'pointer',
                      border: form.cover_color === c ? '3px solid ' + THEME.text : '2px solid transparent',
                    }} />
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Project Name *</label>
                  <input style={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Transformer Installation Block A" />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Type</label>
                  <select style={inp} value={form.project_type} onChange={e => set('project_type', e.target.value)}>
                    {TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Priority</label>
                  <select style={inp} value={form.priority} onChange={e => set('priority', e.target.value)}>
                    {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                  </select>
                </div>
                {editId && (
                  <div style={fieldWrap}>
                    <label style={lbl}>Status</label>
                    <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                      {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
                    </select>
                  </div>
                )}
                <div style={fieldWrap}>
                  <label style={lbl}>Budget</label>
                  <input style={inp} type="number" step="0.01" value={form.budget} onChange={e => set('budget', e.target.value)} placeholder="0.00" />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Start Date</label>
                  <input style={inp} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Target End Date</label>
                  <input style={inp} type="date" value={form.target_end_date} onChange={e => set('target_end_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Client</label>
                  <input style={inp} value={form.client} onChange={e => set('client', e.target.value)} placeholder="Internal department or external" />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Location</label>
                  <input style={inp} value={form.location} onChange={e => set('location', e.target.value)} placeholder="Site area or coordinates" />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Description</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '50px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                {editId && can('projects.delete') && (
                  <button onClick={handleArchive} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Archive
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {editId && (
                  <button onClick={() => { setModalOpen(false); setPage('pj_detail_' + editId) }} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: color + '18', color: color,
                    border: `1px solid ${color}40`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Open Workspace
                  </button>
                )}
                <button onClick={() => setModalOpen(false)} style={{
                  padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff', border: 'none',
                  cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
                }}>
                  {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
