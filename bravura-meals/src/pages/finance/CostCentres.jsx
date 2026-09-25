import { useState, useEffect } from 'react'
import { THEME } from '../../utils/permissions'
import { useFinEmbedded } from '../../components/finEmbed'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'

export default function CostCentres({ setPage }) {
  const embedded = useFinEmbedded()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [centres, setCentres] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ code: '', name: '', description: '', module: '' })

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase.from('cost_centres').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('code')
    if (error) showToast('Failed to load cost centres', 'error')
    setCentres(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const filtered = centres.filter(c => {
    const q = search.toLowerCase()
    return !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
  })

  function openAdd() {
    setEditing(null)
    setForm({ code: '', name: '', description: '', module: '' })
    setShowModal(true)
  }

  function openEdit(c) {
    setEditing(c)
    setForm({ code: c.code, name: c.name, description: c.description || '', module: c.module || '' })
    setShowModal(true)
  }

  async function save() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and name required', 'error'); return }
    const payload = { code: form.code.trim(), name: form.name.trim(), description: form.description.trim() || null, module: form.module.trim() || null, site_id: currentSiteId }

    if (editing) {
      const { error } = await supabase.from('cost_centres').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id)
      if (error) { showToast('Failed to update', 'error'); return }
      showToast('Cost centre updated')
    } else {
      const { error } = await supabase.from('cost_centres').insert(payload)
      if (error) { showToast(error.message?.includes('duplicate') ? 'Code already exists' : 'Failed to create', 'error'); return }
      showToast('Cost centre created')
    }
    setShowModal(false)
    load()
  }

  async function archive(c) {
    if (!confirm(`Archive "${c.name}"?`)) return
    const { error } = await supabase.from('cost_centres').update({ is_archived: true, updated_at: new Date().toISOString() }).eq('id', c.id)
    if (error) { showToast('Failed to archive', 'error'); return }
    showToast('Archived')
    load()
  }

  const inputStyle = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, width: '100%', boxSizing: 'border-box' }

  return (
    <div style={embedded ? {} : { padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          {!embedded && <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Cost Centres</h1>}
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{centres.length} cost centres</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setPage('fi_cost_report')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>bar_chart</span>Report
          </button>
          <button onClick={openAdd} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: THEME.primary, color: THEME.onPrimary, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</span>Add Centre
          </button>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <input placeholder="Search cost centres…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, maxWidth: 320 }} />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', marginBottom: 12 }}>category</span>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No cost centres found</div>
        </div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Code</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Name</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Module</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Description</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{c.code}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{c.name}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed, fontSize: 12 }}>{c.module || '—'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed, fontSize: 12 }}>{c.description || '—'}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      <button onClick={() => openEdit(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, padding: 4 }} title="Edit">
                        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>edit</span>
                      </button>
                      <button onClick={() => archive(c)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.error, padding: 4 }} title="Archive">
                        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>archive</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowModal(false)}>
          <div style={{ background: THEME.surface, borderRadius: 14, padding: 24, width: 420, maxWidth: '90vw', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: THEME.text }}>{editing ? 'Edit Cost Centre' : 'New Cost Centre'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Code</label>
                <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} style={inputStyle} placeholder="CC-XXX" />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Module (optional)</label>
                <select value={form.module} onChange={e => setForm(f => ({ ...f, module: e.target.value }))} style={inputStyle}>
                  <option value="">None</option>
                  <option value="fuel">Fuel</option>
                  <option value="fleet">Fleet</option>
                  <option value="meals">Meals</option>
                  <option value="campsite">Campsite</option>
                  <option value="hr">HR</option>
                  <option value="procurement">Procurement</option>
                  <option value="contractors">Contractors</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={save} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: THEME.primary, color: THEME.onPrimary, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>{editing ? 'Update' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
