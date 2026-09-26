import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { FIN, finCard, finBtn, finBtn2 } from '../../utils/financeTheme'

// Issue fuel → Import (issue #74, F6): paper slips typed into Excel, sent to fuel_import_issues. Each row goes through the
// same checks as the pump screen; importing the same sheet twice does not double up (each row has a fixed reference).
const COLS = [['date', 'Date', '2026-09-25'], ['time', 'Time', '07:30'], ['tank', 'Tank', 'Main Tank'], ['machine', 'Machine (fleet no. or registration)', 'AFG 6015'],
  ['driver', 'Driver (name or employee no.)', 'BRA0012'], ['litres', 'Litres', '120'], ['km', 'Km', ''], ['hours', 'Hours', '4512'],
  ['signed_by', 'Signed by', 'J Moyo'], ['slip', 'Slip no.', '1043'], ['notes', 'Notes', '']]
const th = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: FIN.muted, borderBottom: `1px solid ${FIN.line}` }
const td = { padding: '6px 8px', fontSize: 13, borderBottom: `1px solid ${FIN.lineSoft}` }

const cellDate = v => {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10)
  return String(v || '').trim()
}

export default function FuelImport() {
  const { currentSite } = useSite()
  const [rows, setRows] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)

  const template = () => {
    const ws = XLSX.utils.aoa_to_sheet([COLS.map(c => c[1]), COLS.map(c => c[2])])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Fuel issues')
    XLSX.writeFile(wb, 'bravura-fuel-issues-template.xlsx')
  }
  const read = async file => {
    setResult(null)
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
    const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }).slice(1)
    setRows(raw.filter(r => r.some(c => c !== undefined && c !== '')).map(r => {
      const o = {}; COLS.forEach(([k], i) => { o[k] = k === 'date' ? cellDate(r[i]) : r[i] == null ? '' : String(r[i]).trim() }); return o
    }))
  }
  const send = async () => {
    setBusy(true)
    const { data, error } = await supabase.rpc('fuel_import_issues', { p_site: currentSite.id, p_rows: rows })
    setBusy(false)
    setResult(error ? { error: error.message } : data)
  }
  const res = i => result?.rows?.find(x => x.row === i + 1)

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ ...finCard, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px', fontSize: 13, color: FIN.muted }}>
          Type the day's paper slips into the Excel template and import them. Each row gets the same checks as the pump screen;
          a sheet imported twice is only saved once.
        </div>
        <button style={finBtn2} onClick={template}>Download template</button>
        <label style={{ ...finBtn2, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          Choose file<input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => e.target.files[0] && read(e.target.files[0])} />
        </label>
        <button style={{ ...finBtn, opacity: rows.length && !busy ? 1 : 0.5 }} disabled={!rows.length || busy} onClick={send}>
          {busy ? 'Importing…' : `Import ${rows.length || ''} row${rows.length === 1 ? '' : 's'}`}
        </button>
      </div>
      {result && (
        <div style={{ ...finCard, color: result.error ? FIN.bad : FIN.good }}>
          {result.error || `Saved ${result.saved} of ${rows.length}. ${rows.length - result.saved ? 'Fix the rows marked in red and import again — saved rows will not repeat.' : ''}`}
        </div>
      )}
      {rows.length > 0 && (
        <div style={{ ...finCard, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>#</th>{COLS.map(c => <th key={c[0]} style={th}>{c[1]}</th>)}<th style={th}>Result</th></tr></thead>
            <tbody>{rows.map((r, i) => {
              const x = res(i)
              return (
                <tr key={i}><td style={td}>{i + 1}</td>{COLS.map(c => <td key={c[0]} style={td}>{r[c[0]]}</td>)}
                  <td style={{ ...td, color: !x ? FIN.faint : x.ok ? FIN.good : FIN.bad }}>{!x ? '—' : x.ok ? `${x.number}${x.duplicate ? ' (already in)' : ''}` : x.error}</td></tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
