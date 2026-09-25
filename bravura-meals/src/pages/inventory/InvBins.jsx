import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'

// IN17 — shelves / bins inside each store, with printable labels (issue #59, I2). Plain text labels — no scanning.
export default function InvBins({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [stores, setStores] = useState([])
  const [store, setStore] = useState('')
  const [bins, setBins] = useState([])
  const [counts, setCounts] = useState({})
  const [picked, setPicked] = useState(new Set())
  const [form, setForm] = useState({ code: '', name: '' })
  const [bulk, setBulk] = useState({ prefix: 'A', from: 1, to: 10 })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('warehouses').select('id, code, name').eq('site_id', currentSiteId).eq('is_active', true).order('name')
      .then(({ data }) => { setStores(data || []); setStore(s => s || data?.[0]?.id || '') })
  }, [currentSiteId])

  const load = useCallback(async () => {
    if (!store) return
    const [b, s] = await Promise.all([
      supabase.from('warehouse_bins').select('id, code, name').eq('warehouse_id', store).eq('is_archived', false).order('code'),
      supabase.from('item_store_settings').select('bin_id').eq('warehouse_id', store).not('bin_id', 'is', null),
    ])
    setBins(b.data || [])
    const c = {}; for (const r of s.data || []) c[r.bin_id] = (c[r.bin_id] || 0) + 1
    setCounts(c); setPicked(new Set())
  }, [store])
  useEffect(() => { load() }, [load])

  const storeRow = useMemo(() => stores.find(s => s.id === store), [stores, store])

  async function addBins(codes) {
    const rows = codes.map(c => ({ warehouse_id: store, code: c.code.trim().toUpperCase(), name: c.name?.trim() || null })).filter(r => r.code)
    if (!rows.length) return showToast('Enter a bin code', 'red')
    setBusy(true)
    const { error } = await supabase.from('warehouse_bins').upsert(rows, { onConflict: 'warehouse_id,code' })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(`${rows.length} bin${rows.length > 1 ? 's' : ''} saved`, 'green')
    setForm({ code: '', name: '' }); load()
  }

  function addRange() {
    const from = parseInt(bulk.from, 10), to = parseInt(bulk.to, 10)
    if (!(from > 0) || !(to >= from) || to - from > 200) return showToast('Use a range of up to 200 numbers', 'red')
    const codes = []
    for (let i = from; i <= to; i++) codes.push({ code: `${bulk.prefix}${String(i).padStart(2, '0')}` })
    addBins(codes)
  }

  async function archive(b) {
    if (counts[b.id] && !confirm(`${counts[b.id]} item(s) are placed in ${b.code}. Archive the bin anyway?`)) return
    const { error } = await supabase.from('warehouse_bins').update({ is_archived: true }).eq('id', b.id)
    if (error) return showToast(friendlyError(error), 'red')
    load()
  }

  async function printLabels() {
    const list = bins.filter(b => picked.size === 0 || picked.has(b.id))
    if (!list.length) return
    const w = window.open('', '_blank')
    if (!w) return showToast('Allow pop-ups to print labels', 'red')
    const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    w.document.write(`<!doctype html><title>Bin labels — ${esc(storeRow?.name)}</title>
      <style>body{font-family:Arial,sans-serif;margin:12mm}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:6mm}
      .l{border:1px solid #999;border-radius:3mm;padding:4mm;text-align:center;break-inside:avoid}
      .c{font-size:20pt;font-weight:700;letter-spacing:1px}.s{font-size:9pt;color:#444}</style>
      <div class="g">${list.map(b => `<div class="l"><div class="c">${esc(b.code)}</div><div class="s">${esc(b.name || '')}</div><div class="s">${esc(storeRow?.name)}</div></div>`).join('')}</div>
      <script>window.onload=()=>window.print()</script>`)
    w.document.close()
  }

  if (!can('inventory.view')) return <Denied />
  const edit = can('inventory.edit')
  const th = { textAlign: 'left', padding: '10px 12px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}` }
  const td = { padding: '10px 12px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 14 }

  return (
    <FinShell module="Inventory" homePage="inv_dashboard" setPage={setPage} title="Bins & labels"
      subtitle="Shelves and bins inside each store. Print labels to stick on them."
      actions={<>
        <select aria-label="Store" value={store} onChange={e => setStore(e.target.value)} style={finInput}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button style={finBtn} onClick={printLabels} disabled={!bins.length}>
          Print {picked.size ? `${picked.size} label${picked.size > 1 ? 's' : ''}` : 'all labels'}
        </button>
      </>}>
      {edit && (
        <div style={{ ...finCard, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: FIN.muted }}>Bin code<br /><input id="bin-code" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="A1-03" style={{ ...finInput, width: 120 }} /></label>
            <label style={{ fontSize: 12, color: FIN.muted }}>Description<br /><input id="bin-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Rack A, shelf 1" style={{ ...finInput, width: 200 }} /></label>
            <button style={finBtn2} disabled={busy} onClick={() => addBins([form])}>Add bin</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: FIN.muted }}>Prefix<br /><input id="bin-prefix" value={bulk.prefix} onChange={e => setBulk({ ...bulk, prefix: e.target.value.toUpperCase() })} style={{ ...finInput, width: 70 }} /></label>
            <label style={{ fontSize: 12, color: FIN.muted }}>From<br /><input id="bin-from" type="number" value={bulk.from} onChange={e => setBulk({ ...bulk, from: e.target.value })} style={{ ...finInput, width: 80 }} /></label>
            <label style={{ fontSize: 12, color: FIN.muted }}>To<br /><input id="bin-to" type="number" value={bulk.to} onChange={e => setBulk({ ...bulk, to: e.target.value })} style={{ ...finInput, width: 80 }} /></label>
            <button style={finBtn2} disabled={busy} onClick={addRange}>Add range ({bulk.prefix}{String(bulk.from).padStart(2, '0')}–{bulk.prefix}{String(bulk.to).padStart(2, '0')})</button>
          </div>
        </div>
      )}
      <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, width: 36 }}><input type="checkbox" aria-label="Select all" checked={bins.length > 0 && picked.size === bins.length}
              onChange={e => setPicked(e.target.checked ? new Set(bins.map(b => b.id)) : new Set())} /></th>
            <th style={th}>Bin</th><th style={th}>Description</th><th style={{ ...th, textAlign: 'right' }}>Items placed</th><th style={th} />
          </tr></thead>
          <tbody>
            {bins.length === 0 ? <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: FIN.faint, padding: 32 }}>No bins in this store yet</td></tr>
              : bins.map(b => (
                <tr key={b.id}>
                  <td style={td}><input type="checkbox" aria-label={`Select ${b.code}`} checked={picked.has(b.id)}
                    onChange={() => setPicked(p => { const n = new Set(p); n.has(b.id) ? n.delete(b.id) : n.add(b.id); return n })} /></td>
                  <td style={{ ...td, fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace' }}>{b.code}</td>
                  <td style={{ ...td, color: FIN.muted }}>{b.name || '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{counts[b.id] || 0}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{edit && <button onClick={() => archive(b)} style={{ background: 'none', border: 'none', color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Archive</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 13, color: FIN.muted }}>Place items in bins on <button onClick={() => setPage('inv_levels')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Store levels (IN18)</button>.</div>
    </FinShell>
  )
}
