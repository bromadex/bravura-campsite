import { useState, useEffect, useCallback, useMemo } from 'react'
import { THEME } from '../utils/permissions'

const VIEWER_TYPES = {
  pdf:   ['application/pdf'],
  image: ['image/png','image/jpeg','image/gif','image/webp','image/svg+xml'],
  docx:  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx:  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel'],
  dwg:   ['application/acad','application/x-dwg','image/vnd.dwg'],
}

function getViewerType(fileType, fileName) {
  if (!fileType && !fileName) return 'unsupported'
  const ext = (fileName || '').split('.').pop().toLowerCase()
  if (fileType) {
    for (const [type, mimes] of Object.entries(VIEWER_TYPES)) {
      if (mimes.includes(fileType)) return type
    }
  }
  if (['pdf'].includes(ext)) return 'pdf'
  if (['png','jpg','jpeg','gif','webp','svg'].includes(ext)) return 'image'
  if (['docx'].includes(ext)) return 'docx'
  if (['xlsx','xls'].includes(ext)) return 'xlsx'
  if (['dwg','dxf'].includes(ext)) return 'dwg'
  return 'unsupported'
}

function PDFViewer({ url }) {
  return (
    <iframe
      src={url}
      style={{ width: '100%', height: '100%', border: 'none' }}
      title="PDF Viewer"
    />
  )
}

function ImageViewer({ url }) {
  const [zoom, setZoom] = useState(1)
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: THEME.surfaceVariant }}>
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6, zIndex: 2 }}>
        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} style={zoomBtnStyle} title="Zoom out">
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>remove</span>
        </button>
        <span style={{ fontSize: 12, color: THEME.text, padding: '4px 8px', background: THEME.surface, borderRadius: 4, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} style={zoomBtnStyle} title="Zoom in">
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>add</span>
        </button>
        <button onClick={() => setZoom(1)} style={zoomBtnStyle} title="Reset zoom">
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>fit_screen</span>
        </button>
      </div>
      <img src={url} alt="Document" style={{ maxWidth: `${zoom * 100}%`, transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.2s' }} />
    </div>
  )
}

function DocxViewer({ url }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function convert() {
      try {
        const mammoth = await import('mammoth')
        const resp = await fetch(url)
        if (!resp.ok) throw new Error('Failed to fetch document')
        const buf = await resp.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer: buf })
        if (!cancelled) setHtml(result.value)
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    convert()
    return () => { cancelled = true }
  }, [url])

  if (loading) return <ViewerLoading label="Converting DOCX..." />
  if (error) return <ViewerError message={error} />
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', padding: 32, background: '#fff' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', fontFamily: 'serif', fontSize: 14, lineHeight: 1.7, color: '#222' }} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function XlsxViewer({ url }) {
  const [sheets, setSheets] = useState(null)
  const [activeSheet, setActiveSheet] = useState(0)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function parse() {
      try {
        const XLSX = await import('xlsx')
        const resp = await fetch(url)
        if (!resp.ok) throw new Error('Failed to fetch spreadsheet')
        const buf = await resp.arrayBuffer()
        const wb = XLSX.read(buf, { type: 'array' })
        const parsed = wb.SheetNames.map(name => ({
          name,
          data: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 })
        }))
        if (!cancelled) { setSheets(parsed); setActiveSheet(0) }
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    parse()
    return () => { cancelled = true }
  }, [url])

  if (loading) return <ViewerLoading label="Parsing spreadsheet..." />
  if (error) return <ViewerError message={error} />
  if (!sheets || sheets.length === 0) return <ViewerError message="No sheets found" />

  const sheet = sheets[activeSheet]
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: THEME.surface }}>
      {sheets.length > 1 && (
        <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${THEME.outline}`, background: THEME.surfaceVariant, flexShrink: 0 }}>
          {sheets.map((s, i) => (
            <button key={s.name} onClick={() => setActiveSheet(i)}
              style={{ padding: '8px 16px', fontSize: 12, fontWeight: i === activeSheet ? 700 : 400, color: i === activeSheet ? THEME.primary : THEME.textLow, background: i === activeSheet ? THEME.surface : 'transparent', border: 'none', borderBottom: i === activeSheet ? `2px solid ${THEME.primary}` : '2px solid transparent', cursor: 'pointer' }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <tbody>
            {sheet.data.map((row, ri) => (
              <tr key={ri} style={{ background: ri === 0 ? THEME.surfaceVariant : ri % 2 === 0 ? THEME.surface : THEME.background }}>
                {(row || []).map((cell, ci) => {
                  const Tag = ri === 0 ? 'th' : 'td'
                  return (
                    <Tag key={ci} style={{ padding: '6px 10px', border: `1px solid ${THEME.outline}`, whiteSpace: 'nowrap', fontWeight: ri === 0 ? 600 : 400, color: THEME.text, textAlign: typeof cell === 'number' ? 'right' : 'left' }}>
                      {cell ?? ''}
                    </Tag>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DwgViewer({ url, fileName }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: THEME.textLow, background: THEME.surfaceVariant }}>
      <span className="material-symbols-rounded" style={{ fontSize: 56, color: THEME.outline }}>architecture</span>
      <div style={{ fontSize: 15, fontWeight: 600, color: THEME.text }}>CAD Drawing</div>
      <div style={{ fontSize: 13 }}>{fileName || 'DWG file'}</div>
      <div style={{ fontSize: 12, maxWidth: 360, textAlign: 'center', lineHeight: 1.5 }}>
        DWG viewer requires Autodesk Forge integration. Download the file to view in your CAD application.
      </div>
      <a href={url} download style={{ marginTop: 8, padding: '8px 20px', background: THEME.primary, color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
        Download DWG
      </a>
    </div>
  )
}

function UnsupportedViewer({ url, fileName, fileType }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: THEME.textLow, background: THEME.surfaceVariant }}>
      <span className="material-symbols-rounded" style={{ fontSize: 56, color: THEME.outline }}>description</span>
      <div style={{ fontSize: 15, fontWeight: 600, color: THEME.text }}>{fileName || 'Document'}</div>
      <div style={{ fontSize: 12 }}>{fileType || 'Unknown type'}</div>
      <a href={url} download style={{ marginTop: 8, padding: '8px 20px', background: THEME.primary, color: '#fff', borderRadius: 6, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
        Download File
      </a>
    </div>
  )
}

function ViewerLoading({ label }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, color: THEME.textLow }}>
      <span className="material-symbols-rounded" style={{ fontSize: 24, animation: 'spin 1s linear infinite' }}>progress_activity</span>
      <span style={{ fontSize: 13 }}>{label || 'Loading...'}</span>
    </div>
  )
}

function ViewerError({ message }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: THEME.error }}>
      <span className="material-symbols-rounded" style={{ fontSize: 40 }}>error</span>
      <div style={{ fontSize: 13 }}>{message}</div>
    </div>
  )
}

const zoomBtnStyle = {
  padding: '4px 6px', background: THEME.surface, border: `1px solid ${THEME.outline}`,
  borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', color: THEME.text,
}

const toolbarBtnStyle = {
  padding: '6px 10px', background: 'transparent', border: 'none',
  cursor: 'pointer', display: 'flex', alignItems: 'center', color: THEME.text, borderRadius: 4,
}

export default function DocumentViewer({ url, fileName, fileType, title, onClose, style }) {
  const viewerType = useMemo(() => getViewerType(fileType, fileName), [fileType, fileName])
  const [isFullscreen, setIsFullscreen] = useState(false)

  const handleDownload = useCallback(() => {
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'document'
    a.click()
  }, [url, fileName])

  const handlePrint = useCallback(() => {
    const win = window.open(url, '_blank')
    if (win) { win.onload = () => win.print() }
  }, [url])

  const wrapperStyle = isFullscreen
    ? { position: 'fixed', inset: 0, zIndex: 9999, background: THEME.surface, display: 'flex', flexDirection: 'column' }
    : { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: THEME.surface, borderRadius: 8, overflow: 'hidden', border: `1px solid ${THEME.outline}`, ...style }

  return (
    <div style={wrapperStyle}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${THEME.outline}`, background: THEME.surfaceVariant, flexShrink: 0 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 20, color: THEME.primary }}>description</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || fileName || 'Document'}</div>
          {fileType && <div style={{ fontSize: 11, color: THEME.textLow }}>{fileType}</div>}
        </div>
        <button onClick={handleDownload} style={toolbarBtnStyle} title="Download">
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>download</span>
        </button>
        {viewerType === 'pdf' && (
          <button onClick={handlePrint} style={toolbarBtnStyle} title="Print">
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>print</span>
          </button>
        )}
        <button onClick={() => setIsFullscreen(f => !f)} style={toolbarBtnStyle} title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
          <span className="material-symbols-rounded" style={{ fontSize: 18 }}>{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
        </button>
        {onClose && (
          <button onClick={onClose} style={toolbarBtnStyle} title="Close">
            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
          </button>
        )}
      </div>
      {/* Viewer content */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {viewerType === 'pdf' && <PDFViewer url={url} />}
        {viewerType === 'image' && <ImageViewer url={url} />}
        {viewerType === 'docx' && <DocxViewer url={url} />}
        {viewerType === 'xlsx' && <XlsxViewer url={url} />}
        {viewerType === 'dwg' && <DwgViewer url={url} fileName={fileName} />}
        {viewerType === 'unsupported' && <UnsupportedViewer url={url} fileName={fileName} fileType={fileType} />}
      </div>
    </div>
  )
}

export { getViewerType }
