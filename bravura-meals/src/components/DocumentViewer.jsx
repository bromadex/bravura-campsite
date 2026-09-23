import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
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
  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('Loading CAD file...')
  const [error, setError] = useState(null)
  const [layers, setLayers] = useState([])
  const [hiddenLayers, setHiddenLayers] = useState(new Set())
  const [showLayers, setShowLayers] = useState(false)

  useEffect(() => {
    let cancelled = false
    let blobUrl = null

    async function render() {
      try {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error('Failed to fetch file')
        const buf = await resp.arrayBuffer()
        const ext = (fileName || '').split('.').pop().toLowerCase()

        let dxfUrl = url
        if (ext === 'dwg') {
          setStatus('Loading DWG converter...')
          const wasmResp = await fetch('/libredwg-web.wasm')
          if (!wasmResp.ok) throw new Error('Failed to load DWG converter')
          const wasmBinary = await wasmResp.arrayBuffer()
          setStatus('Converting DWG to DXF...')
          const glueUrl = new URL('/libredwg-web.js', window.location.origin).href
          const glue = await import(/* @vite-ignore */ glueUrl)
          const createMod = glue.default || glue.createModule || glue
          const wasmInstance = await createMod({
            wasmBinary,
            locateFile: (path) => '/' + path,
          })
          wasmInstance.FS.writeFile('in.dwg', new Uint8Array(buf))
          const err = wasmInstance.dwg_write_dxf('in.dwg', 'out.dxf')
          if (err !== 0) {
            try { wasmInstance.FS.unlink('in.dwg') } catch {}
            throw new Error('Failed to convert DWG — file may be corrupted or unsupported version')
          }
          const dxfData = wasmInstance.FS.readFile('out.dxf')
          try { wasmInstance.FS.unlink('in.dwg') } catch {}
          try { wasmInstance.FS.unlink('out.dxf') } catch {}
          if (!dxfData) throw new Error('Failed to convert DWG — file may be corrupted or unsupported version')
          const blob = new Blob([dxfData], { type: 'text/plain' })
          blobUrl = URL.createObjectURL(blob)
          dxfUrl = blobUrl
        }

        if (cancelled) return
        setStatus('Rendering drawing...')
        const { DxfViewer } = await import('dxf-viewer')
        if (cancelled || !containerRef.current) return

        const viewer = new DxfViewer(containerRef.current, {
          canvasWidth: containerRef.current.clientWidth,
          canvasHeight: containerRef.current.clientHeight,
          autoResize: true,
          colorCorrection: true,
        })
        viewerRef.current = viewer

        await viewer.Load({ url: dxfUrl })
        if (cancelled) return

        const lyrs = viewer.GetLayers() || []
        setLayers(lyrs.map(l => typeof l === 'string' ? l : l.name || String(l)))
        setLoading(false)
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    }
    render()
    return () => {
      cancelled = true
      if (viewerRef.current) {
        try { viewerRef.current.Destroy() } catch {}
        viewerRef.current = null
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [url, fileName])

  function toggleLayer(name) {
    const viewer = viewerRef.current
    if (!viewer) return
    const next = new Set(hiddenLayers)
    if (next.has(name)) {
      next.delete(name)
      viewer.ShowLayer(name, true)
    } else {
      next.add(name)
      viewer.ShowLayer(name, false)
    }
    setHiddenLayers(next)
  }

  if (error) return <ViewerError message={error} />

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1a2e' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: '#ccc', background: '#1a1a2e' }}>
          <span className="material-symbols-rounded" style={{ fontSize: 24, animation: 'spin 1s linear infinite' }}>progress_activity</span>
          <span style={{ fontSize: 13 }}>{status}</span>
        </div>
      )}
      {!loading && layers.length > 0 && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}>
          <button onClick={() => setShowLayers(s => !s)}
            style={{ padding: '6px 10px', background: 'rgba(0,0,0,.6)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>layers</span>
            Layers ({layers.length})
          </button>
          {showLayers && (
            <div style={{ marginTop: 4, background: 'rgba(0,0,0,.8)', borderRadius: 6, padding: 8, maxHeight: 300, overflowY: 'auto', minWidth: 180 }}>
              {layers.map(name => (
                <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer', fontSize: 11, color: hiddenLayers.has(name) ? '#666' : '#ddd' }}>
                  <input type="checkbox" checked={!hiddenLayers.has(name)} onChange={() => toggleLayer(name)} style={{ accentColor: THEME.primary }} />
                  {name}
                </label>
              ))}
            </div>
          )}
        </div>
      )}
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
