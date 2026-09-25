import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finInput } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'

// IN18 — per-store stock levels: bin, min, max, reorder level and reorder qty (issue #59, I2).
// Store levels win over the item's own levels; Procurement's reorder → draft POs uses them.
const FIELDS = ['min_qty', 'max_qty', 'reorder_level', 'reorder_qty']
const num = v => (v === '' || v === null || v === undefined ? null : Number(v))

export default function InvLevels({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [stores, setStores] = useState([])
  const [store, setStore] = useState('')
  const [rows, setRows] = useState([])
  const [bins, setBins] = useState([])
  const [dirty, setDirty] = useState({})
  const [search, setSearch] = useState('')
  const [show, setShow] = useState('all')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('warehouses').select('id, name').eq('site_id', currentSiteId).eq('is_active', true).order('name')
      .then(({ data }) => { setStores(data || []); setStore(s => s || data?.[0]?.id || '') })
  }, [currentSiteId])

  const load = useCallback(async () => {
    if (!store) return
    setLoading(true)
    const [it, st, bal, bn] = await Promise.all([
      supabase.from('items').select('id, item_code, description, reorder_level, reorder_qty, min_stock, max_stock, uom:units_of_measure!items_uom_id_fkey(abbreviation)').eq('is_archived', false).order('description').limit(5000),
      supabase.from('item_store_settings').select('*').eq('warehouse_id', store),
      supabase.from('stock_balances').select('item_id, on_hand_qty').eq('warehouse_id', store),
      supabase.from('warehouse_bins').select('id, code').eq('warehouse_id', store).eq('is_archived', false).order('code'),
    ])
    if (it.error) { showToast(friendlyError(it.error), 'red'); setLoading(false); return }
    const s = Object.fromEntries((st.data || []).map(r => [r.item_id, r]))
    const b = Object.fromEntries((bal.data || []).map(r => [r.item_id, Number(r.on_hand_qty)]))
    setRows((it.data || []).map(i => ({ ...i, on_hand: b[i.id] ?? 0, set: s[i.id] || null })))
    setBins(bn.data || [])
    setDirty({})
    setLoading(false)
  }, [store])
  useEffect(() => { load() }, [load])

  const val = (r, f) => (dirty[r.id] && f in dirty[r.id] ? dirty[r.id][f] : r.set?.[f] ?? '')
  const change = (id, f, v) => setDirty(d => ({ ...d, [id]: { ...d[id], [f]: v } }))

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (q && !`${r.item_code} ${r.description}`.toLowerCase().includes(q)) return false
      const rl = num(r.set?.reorder_level ?? r.set?.min_qty ?? r.reorder_level)
      if (show === 'set') return !!r.set
      if (show === 'low') return rl > 0 && r.on_hand <= rl
      if (show === 'held') return r.on_hand > 0
      return true
    })
  }, [rows, search, show])

  async function save() {
    const ids = Object.keys(dirty)
    if (!ids.length) return
    const payload = ids.map(id => {
      const r = rows.find(x => x.id === id), d = dirty[id]
      const pick = f => num(f in d ? d[f] : r.set?.[f])
      const out = { item_id: id, warehouse_id: store, bin_id: ('bin_id' in d ? d.bin_id : r.set?.bin_id) || null, updated_at: new Date().toISOString() }
      for (const f of FIELDS) out[f] = pick(f)
      return out
    })
    const bad = payload.find(p => p.min_qty != null && p.max_qty != null && p.max_qty < p.min_qty)
    if (bad) return showToast('Max must be at least Min', 'red')
    setSaving(true)
    const { error } = await supabase.from('item_store_settings').upsert(payload, { onConflict: 'item_id,warehouse_id' })
    setSaving(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(`${payload.length} item${payload.length > 1 ? 's' : ''} saved`, 'green')
    load()
  }

  if (!can('inventory.view')) return <Denied />
  const edit = can('inventory.edit')
  const th = { textAlign: 'left', padding: '10px 10px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
  const td = { padding: '6px 10px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 14 }
  const cell = { ...finInput, minHeight: 34, width: 84, padding: '4px 8px', textAlign: 'right' }
  const changed = Object.keys(dirty).length

  return (
    <FinShell module="Stores" homePage="inv_dashboard" setPage={setPage} title="Store levels"
      subtitle="Where each item sits and when to reorder it — for this store. Blank uses the item's own levels."
      actions={<>
        <select aria-label="Store" value={store} onChange={e => setStore(e.target.value)} style={finInput}>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {edit && <button style={{ ...finBtn, opacity: changed ? 1 : 0.5 }} disabled={!changed || saving} onClick={save}>{saving ? 'Saving…' : `Save ${changed || ''} change${changed === 1 ? '' : 's'}`}</button>}
      </>}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input id="levels-search" aria-label="Search items" placeholder="Search code or description" value={search} onChange={e => setSearch(e.target.value)} style={{ ...finInput, width: 260 }} />
        {[['all', 'All items'], ['held', 'In this store'], ['set', 'Levels set'], ['low', 'At or below reorder']].map(([k, l]) => (
          <button key={k} onClick={() => setShow(k)} style={{ minHeight: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${show === k ? FIN.maroon : FIN.field}`,
            background: show === k ? FIN.maroonTint : '#fff', color: show === k ? FIN.maroon : FIN.ink, cursor: 'pointer', font: 'inherit', fontSize: 13 }}>{l}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: FIN.muted }}>{list.length} items</span>
      </div>
      <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Item</th><th style={{ ...th, textAlign: 'right' }}>On hand</th><th style={th}>Bin</th>
            <th style={{ ...th, textAlign: 'right' }}>Min</th><th style={{ ...th, textAlign: 'right' }}>Max</th>
            <th style={{ ...th, textAlign: 'right' }}>Reorder at</th><th style={{ ...th, textAlign: 'right' }}>Reorder qty</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} style={{ ...td, padding: 32, textAlign: 'center', color: FIN.faint }}>Loading…</td></tr>
              : list.length === 0 ? <tr><td colSpan={7} style={{ ...td, padding: 32, textAlign: 'center', color: FIN.faint }}>No items — add them on Items (IN02) or Import items (IN19)</td></tr>
              : list.slice(0, 400).map(r => {
                const rl = num(val(r, 'reorder_level')) ?? num(val(r, 'min_qty')) ?? num(r.reorder_level)
                const low = rl > 0 && r.on_hand <= rl
                return (
                  <tr key={r.id} style={{ background: dirty[r.id] ? FIN.blueTint : undefined }}>
                    <td style={td}><span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: FIN.muted }}>{r.item_code}</span><br />{r.description}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: low ? FIN.bad : FIN.ink }}>{r.on_hand} <span style={{ fontWeight: 400, color: FIN.faint, fontSize: 12 }}>{r.uom?.abbreviation || ''}</span></td>
                    <td style={td}>
                      <select aria-label={`Bin for ${r.item_code}`} disabled={!edit} value={val(r, 'bin_id') || ''} onChange={e => change(r.id, 'bin_id', e.target.value)} style={{ ...finInput, minHeight: 34, padding: '4px 6px' }}>
                        <option value="">—</option>
                        {bins.map(b => <option key={b.id} value={b.id}>{b.code}</option>)}
                      </select>
                    </td>
                    {FIELDS.map(f => (
                      <td key={f} style={{ ...td, textAlign: 'right' }}>
                        <input aria-label={`${f} for ${r.item_code}`} type="number" min="0" disabled={!edit} value={val(r, f)}
                          placeholder={f === 'reorder_level' ? (r.reorder_level ?? '') : f === 'reorder_qty' ? (r.reorder_qty ?? '') : f === 'min_qty' ? (r.min_stock ?? '') : (r.max_stock ?? '')}
                          onChange={e => change(r.id, f, e.target.value)} style={cell} />
                      </td>
                    ))}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
      {list.length > 400 && <div style={{ fontSize: 13, color: FIN.muted }}>Showing the first 400 — search to narrow down.</div>}
    </FinShell>
  )
}
