import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useSite } from '../contexts/SiteContext'
import { THEME } from '../utils/permissions'

// Cost centre + project selects for any document that posts to the ledger.
// value: { cost_centre_id, project_id }  onChange(next)
const cache = {}

export default function DimensionPicker({ value = {}, onChange, idPrefix = 'dim', inputStyle, labelStyle }) {
  const { currentSiteId } = useSite()
  const [opts, setOpts] = useState(cache[currentSiteId] || { centres: [], projects: [] })

  useEffect(() => {
    if (!currentSiteId || cache[currentSiteId]) { if (cache[currentSiteId]) setOpts(cache[currentSiteId]); return }
    Promise.all([
      supabase.from('cost_centres').select('id, code, name').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
      supabase.from('projects').select('id, project_code, name').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
    ]).then(([cc, pj]) => {
      cache[currentSiteId] = { centres: cc.data || [], projects: pj.data || [] }
      setOpts(cache[currentSiteId])
    })
  }, [currentSiteId])

  const inp = inputStyle || { width: '100%', minHeight: '40px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box' }
  const lbl = labelStyle || { fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-cc`} style={lbl}>Cost centre</label>
        <select id={`${idPrefix}-cc`} style={inp} value={value.cost_centre_id || ''} onChange={e => onChange({ ...value, cost_centre_id: e.target.value || null })}>
          <option value="">—</option>
          {opts.centres.map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-pj`} style={lbl}>Project</label>
        <select id={`${idPrefix}-pj`} style={inp} value={value.project_id || ''} onChange={e => onChange({ ...value, project_id: e.target.value || null })}>
          <option value="">—</option>
          {opts.projects.map(p => <option key={p.id} value={p.id}>{p.project_code ? `${p.project_code} ` : ''}{p.name}</option>)}
        </select>
      </div>
    </>
  )
}
