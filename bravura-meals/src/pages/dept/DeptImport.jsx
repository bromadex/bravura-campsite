import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'

const color = MODULE_COLORS.dept || '#1565C0'

export default function DeptImport({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [projects, setProjects] = useState([])
  const [selectedProject, setSelectedProject] = useState('')
  const [csvText, setCsvText] = useState('')
  const [preview, setPreview] = useState([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase.from('dept_projects').select('id, name, department:departments(name)')
      .eq('site_id', currentSiteId).eq('is_archived', false).order('name')
    setProjects(data || [])
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setCsvText(ev.target.result)
      parseCSV(ev.target.result)
    }
    reader.readAsText(file)
  }

  function parseCSV(text) {
    const lines = text.trim().split('\n')
    if (lines.length < 2) { setPreview([]); return }
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''))
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim())
      const obj = {}
      headers.forEach((h, i) => { obj[h] = vals[i] || '' })
      return obj
    }).filter(r => r.title)
    setPreview(rows)
  }

  function handlePaste() {
    parseCSV(csvText)
  }

  async function handleImport() {
    if (!selectedProject || preview.length === 0 || !can('dept.create')) return
    setImporting(true)
    const rows = preview.map((r, i) => ({
      project_id: selectedProject,
      title: r.title,
      bucket: r.bucket || 'Initiating',
      priority: ['urgent', 'important', 'medium', 'low'].includes(r.priority) ? r.priority : 'medium',
      description: r.description || null,
      due_date: r.due_date && !isNaN(Date.parse(r.due_date)) ? r.due_date : null,
      sort_order: i,
    }))
    const { data, error } = await supabase.from('dept_tasks').insert(rows).select('id')
    setImporting(false)
    setResult({ count: data?.length || 0, error: error?.message })
  }

  const inp = { padding: '8px 12px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, fontSize: '13px', background: THEME.surface, color: THEME.text, width: '100%' }

  return (
    <div style={{ padding: '24px', maxWidth: '900px' }}>
      <div style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, marginBottom: '20px' }}>Import Tasks</div>

      <div style={{ background: THEME.surface, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '10px' }}>1. Select Project</div>
        <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)} style={{ ...inp, marginBottom: '16px' }}>
          <option value="">Choose a project…</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name} ({p.department?.name})</option>)}
        </select>

        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '10px' }}>2. Upload CSV or paste data</div>
        <div style={{ fontSize: '11px', color: THEME.textLow, marginBottom: '8px' }}>
          Columns: title (required), bucket, priority, description, due_date
        </div>
        <input type="file" accept=".csv" onChange={handleFile} style={{ marginBottom: '10px', fontSize: '13px' }} />
        <textarea placeholder="Or paste CSV here…" value={csvText} onChange={e => setCsvText(e.target.value)} rows={5} style={{ ...inp, resize: 'vertical', marginBottom: '8px', fontFamily: 'monospace' }} />
        <button onClick={handlePaste} style={{ padding: '6px 14px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '12px', cursor: 'pointer', marginBottom: '16px' }}>Parse</button>

        {preview.length > 0 && (
          <>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '10px' }}>3. Preview ({preview.length} tasks)</div>
            <div style={{ overflowX: 'auto', marginBottom: '16px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '500px' }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${THEME.outline}` }}>
                    {['Title', 'Bucket', 'Priority', 'Due Date'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 20).map((r, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '6px 10px', color: THEME.text }}>{r.title}</td>
                      <td style={{ padding: '6px 10px', color: THEME.textMed }}>{r.bucket || 'Initiating'}</td>
                      <td style={{ padding: '6px 10px', color: THEME.textMed }}>{r.priority || 'medium'}</td>
                      <td style={{ padding: '6px 10px', color: THEME.textLow }}>{r.due_date || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 20 && <div style={{ fontSize: '11px', color: THEME.textLow, padding: '6px 10px' }}>…and {preview.length - 20} more</div>}
            </div>

            {can('dept.create') && (
              <button onClick={handleImport} disabled={importing || !selectedProject}
                style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: color, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: (importing || !selectedProject) ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="upload" size={16} style={{ color: '#fff' }} />
                {importing ? 'Importing…' : `Import ${preview.length} Tasks`}
              </button>
            )}
          </>
        )}

        {result && (
          <div style={{ marginTop: '14px', padding: '12px 16px', borderRadius: '10px', background: result.error ? '#FFEBEE' : '#E8F5E9', color: result.error ? '#C62828' : '#2E7D32', fontSize: '13px' }}>
            {result.error ? `Error: ${result.error}` : `Successfully imported ${result.count} tasks.`}
          </div>
        )}
      </div>
    </div>
  )
}
