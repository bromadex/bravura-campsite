import { useState } from 'react'
import { usePermissions } from '../../contexts/PermissionsContext'
import { THEME } from '../../utils/permissions'
import Denied from '../../components/Denied'

const DEFAULT_CATEGORIES = ['General','Policy','SOP','Manual','Certificate','Report','Contract','Drawing','Other']
const ALLOWED_TYPES = [
  { label: 'PDF', mime: 'application/pdf' },
  { label: 'PNG', mime: 'image/png' },
  { label: 'JPEG', mime: 'image/jpeg' },
  { label: 'GIF', mime: 'image/gif' },
  { label: 'WebP', mime: 'image/webp' },
  { label: 'SVG', mime: 'image/svg+xml' },
  { label: 'DOCX', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { label: 'XLSX', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { label: 'XLS', mime: 'application/vnd.ms-excel' },
  { label: 'DWG', mime: 'application/x-dwg' },
  { label: 'Plain Text', mime: 'text/plain' },
  { label: 'CSV', mime: 'text/csv' },
]
const MAX_FILE_SIZE_MB = 10

export default function DocShareSettings({ setPage }) {
  const { can } = usePermissions()
  if (!can('ds.view')) return <Denied />

  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [newCategory, setNewCategory] = useState('')
  const [toast, setToast] = useState('')
  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  function handleAddCategory() {
    const name = newCategory.trim()
    if (!name) return
    if (categories.some(c => c.toLowerCase() === name.toLowerCase())) return showToast('Category already exists')
    if (!can('ds.edit')) return showToast('No permission')
    setCategories([...categories, name])
    setNewCategory('')
    showToast('Category added')
  }

  function handleRemoveCategory(cat) {
    if (!can('ds.edit')) return showToast('No permission')
    if (DEFAULT_CATEGORIES.includes(cat)) return showToast('Cannot remove default category')
    setCategories(categories.filter(c => c !== cat))
    showToast('Category removed')
  }

  const inputStyle = { width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${THEME.outline}`, borderRadius: 6, background: THEME.surface, color: THEME.text }
  const cardStyle = { background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 8, padding: 20, marginBottom: 16 }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 16px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text }}>DocVault Settings</div>
        <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 2 }}>Manage document categories, file limits, and allowed types</div>
      </div>

      {/* Categories */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18, color: THEME.primary }}>category</span>
          Document Categories
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {categories.map(cat => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', background: THEME.surfaceVar, borderRadius: 20, fontSize: 12, color: THEME.text, border: `1px solid ${THEME.outline}` }}>
              {cat}
              {can('ds.edit') && !DEFAULT_CATEGORIES.includes(cat) && (
                <button onClick={() => handleRemoveCategory(cat)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.error, padding: 0, marginLeft: 2, display: 'flex', alignItems: 'center' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
                </button>
              )}
              {DEFAULT_CATEGORIES.includes(cat) && (
                <span style={{ fontSize: 10, color: THEME.textLow, marginLeft: 2 }}>default</span>
              )}
            </div>
          ))}
        </div>
        {can('ds.edit') && (
          <div style={{ display: 'flex', gap: 8, maxWidth: 360 }}>
            <input value={newCategory} onChange={e => setNewCategory(e.target.value)}
              style={inputStyle} placeholder="New category name"
              onKeyDown={e => e.key === 'Enter' && handleAddCategory()} />
            <button onClick={handleAddCategory}
              style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: THEME.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Add
            </button>
          </div>
        )}
      </div>

      {/* File Size Limit */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18, color: THEME.primary }}>upload_file</span>
          File Size Limit
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ padding: '10px 16px', background: THEME.surfaceVar, borderRadius: 8, fontSize: 20, fontWeight: 700, color: THEME.text }}>
            {MAX_FILE_SIZE_MB} MB
          </div>
          <div style={{ fontSize: 12, color: THEME.textLow }}>
            Maximum file size per upload. Files exceeding this limit will be rejected.
          </div>
        </div>
      </div>

      {/* Allowed File Types */}
      <div style={cardStyle}>
        <div style={{ fontSize: 14, fontWeight: 700, color: THEME.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="material-symbols-rounded" style={{ fontSize: 18, color: THEME.primary }}>file_present</span>
          Allowed File Types
        </div>
        <div style={{ border: `1px solid ${THEME.outline}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>Format</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.text, borderBottom: `1px solid ${THEME.outline}` }}>MIME Type</th>
              </tr>
            </thead>
            <tbody>
              {ALLOWED_TYPES.map(t => (
                <tr key={t.mime} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  <td style={{ padding: '8px 12px', color: THEME.text, fontWeight: 500 }}>{t.label}</td>
                  <td style={{ padding: '8px 12px', color: THEME.textLow, fontFamily: 'monospace', fontSize: 11 }}>{t.mime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#333', color: '#fff', padding: '10px 20px', borderRadius: 8, fontSize: 13, zIndex: 9999 }}>
          {toast}
        </div>
      )}
    </div>
  )
}
