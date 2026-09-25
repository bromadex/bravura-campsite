import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'

// IN19 — add / update items from Excel and post opening stock in one go (issue #59, I2).
// Headings are matched loosely ("Item code", "Code", "SKU" …). Opening stock posts Dr 1320 / Cr 3900 in Finance.
const COLS = [
  ['item_code', 'Item code', ['item code', 'code', 'sku', 'item no', 'part code'], 'BOLT-M12'],
  ['description', 'Description', ['description', 'item', 'name', 'item name'], 'Hex bolt M12 x 50'],
  ['category', 'Category', ['category', 'group'], 'Mechanical'],
  ['unit', 'Unit', ['unit', 'uom', 'unit of measure'], 'ea'],
  ['purchase_unit', 'Purchase unit', ['purchase unit', 'buy unit', 'pack'], 'box'],
  ['purchase_factor', 'Units per purchase unit', ['units per purchase unit', 'pack size', 'factor', 'per box'], 50],
  ['part_number', 'Part number', ['part number', 'part no', 'oem'], ''],
  ['barcode', 'Barcode', ['barcode', 'ean'], ''],
  ['standard_cost', 'Standard cost', ['standard cost', 'std cost'], 0.35],
  ['bin', 'Bin', ['bin', 'location', 'shelf'], 'A1-03'],
  ['min', 'Min', ['min', 'minimum'], 100],
  ['max', 'Max', ['max', 'maximum'], 600],
  ['reorder_level', 'Reorder at', ['reorder at', 'reorder level', 'rol'], 150],
  ['reorder_qty', 'Reorder qty', ['reorder qty', 'reorder quantity', 'eoq'], 500],
  ['qty', 'Opening qty', ['opening qty', 'qty', 'quantity', 'on hand', 'balance'], 240],
  ['unit_cost', 'Opening unit cost', ['opening unit cost', 'unit cost', 'cost', 'price'], 0.32],
]
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export default function InvImport({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [stores, setStores] = useState([])
  const [store, setStore] = useState('')
  const [rows, setRows] = useState([])
  const [mapped, setMapped] = useState([])
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name')
      .then(({ data }) => { setStores(data || []); setStore(s => s || data?.[0]?.id || '') })
  }, [currentSiteId])

  function template() {
    const ws = XLSX.utils.aoa_to_sheet([COLS.map(c => c[1]), COLS.map(c => c[3])])
    ws['!cols'] = COLS.map(c => ({ wch: Math.max(12, c[1].length + 2) }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Items')
    XLSX.writeFile(wb, 'bravura-items-template.xlsx')
  }

  async function onFile(e) {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setResult(null)
    try {
      const wb = XLSX.read(await f.arrayBuffer())
      const raw = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true })
      if (!raw.length) return showToast('The first sheet is empty', 'red')
      const heads = Object.keys(raw[0])
      const map = {}
      for (const [key, , aliases] of COLS) {
        const h = heads.find(x => aliases.includes(norm(x)))
        if (h) map[key] = h
      }
      if (!map.item_code || !map.description) return showToast('The sheet needs "Item code" and "Description" columns — download the template', 'red')
      setMapped(COLS.filter(c => map[c[0]]).map(c => [c[1], map[c[0]]]))
      setRows(raw.map(r => Object.fromEntries(Object.entries(map).map(([k, h]) => [k, String(r[h] ?? '').trim()])))
        .filter(r => r.item_code || r.description))
      setFileName(f.name)
    } catch (err) {
      showToast('Could not read that file — save it as .xlsx or .csv', 'red')
    }
  }

  async function run() {
    if (!store) return showToast('Choose the store', 'red')
    setBusy(true)
    const { data, error } = await supabase.rpc('inv_import_items', { p_rows: rows, p_warehouse_id: store })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    setResult(data)
    showToast(`${data.added} added, ${data.updated} updated`, 'green')
  }

  if (!can('inventory.create')) return <Denied />
  const openingValue = rows.reduce((s, r) => s + (Number(r.qty) || 0) * (Number(r.unit_cost || r.standard_cost) || 0), 0)
  const th = { textAlign: 'left', padding: '8px 10px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
  const td = { padding: '6px 10px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 13, whiteSpace: 'nowrap' }

  return (
    <FinShell module="Stores" homePage="inv_dashboard" setPage={setPage} title="Import items"
      subtitle="Add or update items from a spreadsheet, place them in bins, set store levels and post opening stock."
      actions={<button style={finBtn2} onClick={template}>Download template</button>}>
      <div style={{ ...finCard, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 12, color: FIN.muted }}>Store<br />
          <select id="import-store" value={store} onChange={e => setStore(e.target.value)} style={{ ...finInput, minWidth: 200 }}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label style={{ ...finBtn2, display: 'inline-flex', alignItems: 'center' }}>
          {fileName ? `Change file (${fileName})` : 'Choose Excel or CSV file'}
          <input id="import-file" type="file" accept=".xlsx,.xls,.csv" onChange={onFile} style={{ display: 'none' }} />
        </label>
        {rows.length > 0 && <button style={finBtn} disabled={busy} onClick={run}>{busy ? 'Importing…' : `Import ${rows.length} row${rows.length > 1 ? 's' : ''}`}</button>}
      </div>

      {result && (
        <div style={{ ...finCard, background: FIN.goodTint, borderColor: '#CFE6D7' }}>
          <strong>{result.added} added · {result.updated} updated</strong>
          {result.opening_lines > 0 && <> · opening stock {result.voucher}: {result.opening_lines} lines, ${money(result.opening_value)} (posted to Finance as Dr 1320 Stock / Cr 3900 Opening equity)</>}
          {result.errors?.length > 0 && <div style={{ marginTop: 8, color: FIN.bad }}>{result.errors.length} row(s) skipped: {result.errors.slice(0, 10).map(e => `row ${e.row}`).join(', ')} — {result.errors[0].error}</div>}
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setPage('inv_levels')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Check store levels →</button>
          </div>
        </div>
      )}

      {rows.length > 0 && !result && (
        <>
          <div style={{ fontSize: 13, color: FIN.muted }}>
            Matched columns: {mapped.map(([a, b]) => `${a} ← “${b}”`).join(' · ')}.
            {openingValue > 0 && <> Opening stock worth about <strong style={{ color: FIN.ink }}>${money(openingValue)}</strong> will post to Finance.</>}
          </div>
          <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{COLS.filter(c => mapped.some(m => m[0] === c[1])).map(c => <th key={c[0]} style={th}>{c[1]}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 25).map((r, i) => (
                <tr key={i}>{COLS.filter(c => mapped.some(m => m[0] === c[1])).map(c => <td key={c[0]} style={{ ...td, color: !r.item_code && c[0] === 'item_code' ? FIN.bad : FIN.ink }}>{r[c[0]] || (c[0] === 'item_code' ? 'missing' : '')}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          {rows.length > 25 && <div style={{ fontSize: 13, color: FIN.muted }}>Showing 25 of {rows.length} rows.</div>}
        </>
      )}

      {!rows.length && !result && (
        <div style={{ ...finCard, color: FIN.muted, fontSize: 14, lineHeight: 1.6 }}>
          Existing item codes are updated — blank cells keep what is already there. New categories, units and bins are created as needed.
          An opening quantity posts opening stock into the chosen store at the opening unit cost (or the standard cost).
          Up to 5,000 rows at a time.
        </div>
      )}
    </FinShell>
  )
}
