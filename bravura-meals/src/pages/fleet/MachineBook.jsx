import { useState, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { ModalOverlay, showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'

// Fleet A2 (#63): a machine's specifications, book value (from Fixed Assets) and site moves, on the machine itself.
const CLR = MODULE_COLORS.fleet
const money = v => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const card = { background: THEME.surface, border: `1px solid ${THEME.outline}`, borderRadius: 10, padding: 16, marginTop: 20 }
const lbl = { fontSize: 11, color: THEME.textLow, fontWeight: 600 }
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 14, boxSizing: 'border-box' }
const btn = { padding: '8px 14px', borderRadius: 8, border: 'none', background: CLR, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }
const btn2 = { ...btn, background: 'transparent', color: THEME.text, border: `1px solid ${THEME.outline}` }
const panel = { background: THEME.surface, color: THEME.text, borderRadius: 14, padding: 20, width: 'min(560px, calc(100vw - 32px))', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }

export function useTypeSpecs() {
  const [specs, setSpecs] = useState([])
  useEffect(() => {
    supabase.from('fleet_type_specs').select('category, key, label, unit, input, sort_order').eq('is_archived', false).order('sort_order')
      .then(({ data }) => setSpecs(data || []))
  }, [])
  return specs
}

export default function MachineBook({ asset, onMoved }) {
  const { can } = usePermissions()
  const specs = useTypeSpecs()
  const [book, setBook] = useState(null)
  const [modal, setModal] = useState(null)   // 'cap' | 'move'
  const load = useCallback(() => {
    supabase.rpc('fleet_machine_book', { p_asset_id: asset.id }).then(({ data }) => setBook(data || {}))
  }, [asset.id])
  useEffect(() => { load() }, [load])

  const cat = asset.fleet_asset_types?.category
  const mySpecs = specs.filter(s => s.category === cat && asset.specs?.[s.key] != null && asset.specs[s.key] !== '')
  const fa = book?.fixed_asset

  return (
    <div style={card}>
      {mySpecs.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Specifications</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            {mySpecs.map(s => (
              <div key={s.key}><div style={lbl}>{s.label}</div><div style={{ fontSize: 14 }}>{asset.specs[s.key]}{s.unit ? ` ${s.unit}` : ''}</div></div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700 }}>Book value</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!fa && can('assets.create') && <button style={btn} onClick={() => setModal('cap')}>Add to fixed assets</button>}
          {can('fleet.edit') && <button style={btn2} onClick={() => setModal('move')}>Move to another site</button>}
        </div>
      </div>
      {book && (fa ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
          <div><div style={lbl}>Fixed asset</div><div>{fa.code} · {fa.status}</div></div>
          <div><div style={lbl}>Cost</div><div>{money(fa.cost)}</div></div>
          <div><div style={lbl}>Depreciated</div><div>{money(fa.accumulated)}</div></div>
          <div><div style={lbl}>Book value</div><div style={{ fontWeight: 700 }}>{money(fa.book_value)}</div></div>
          <div><div style={lbl}>Method</div><div>{fa.method === 'straight_line' ? `Straight line, ${fa.useful_life_months} months` : `Reducing balance ${fa.rate_pct}%`}</div></div>
          <div><div style={lbl}>Last depreciation</div><div>{fa.last_period || 'None yet'}</div></div>
          {fa.grn && <div><div style={lbl}>Received on</div><div>{fa.grn}</div></div>}
        </div>
      ) : <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 6 }}>Not in the fixed asset register yet — no cost or depreciation is tracked.</div>)}

      {book?.transfers?.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={lbl}>Site moves</div>
          {book.transfers.map((t, i) => (
            <div key={i} style={{ fontSize: 13, marginTop: 4 }}>{t.date}: {t.from} → {t.to}{Number(t.book_value) ? ` · book value ${money(t.book_value)}` : ''}{t.notes ? ` · ${t.notes}` : ''}</div>
          ))}
        </div>
      )}

      {modal === 'cap' && <CapitaliseModal asset={asset} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'move' && <MoveModal asset={asset} book={fa} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); onMoved?.() }} />}
    </div>
  )
}

function CapitaliseModal({ asset, onClose, onDone }) {
  const [sources, setSources] = useState([])
  const [cats, setCats] = useState([])
  const [f, setF] = useState({ grn_line_id: '', cost: asset.purchase_cost || '', acquisition_date: asset.purchase_date || '', category_id: '', useful_life_months: '', salvage_value: asset.salvage_value || '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.rpc('fleet_capitalise_sources', { p_asset_id: asset.id }).then(({ data }) => setSources(data || []))
    supabase.from('asset_categories').select('id, name, method, useful_life_months').eq('site_id', asset.site_id).eq('is_archived', false).order('name')
      .then(({ data }) => setCats(data || []))
  }, [asset.id, asset.site_id])
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  function pickSource(id) {
    const s = sources.find(x => x.grn_line_id === id)
    setF(p => ({ ...p, grn_line_id: id, cost: s ? s.amount : p.cost, acquisition_date: s ? s.received_date : p.acquisition_date }))
  }
  function pickCat(id) {
    const c = cats.find(x => x.id === id)
    setF(p => ({ ...p, category_id: id, useful_life_months: c?.useful_life_months || p.useful_life_months }))
  }
  async function save() {
    if (!(Number(f.cost) > 0)) return showToast('Enter the cost', 'red')
    if (!f.acquisition_date) return showToast('Enter the date it was bought', 'red')
    setBusy(true)
    const { error } = await supabase.rpc('fleet_capitalise', { p_asset_id: asset.id, p: f })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast('Added to fixed assets and capitalised', 'green')
    onDone()
  }
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ ...panel, display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Add to fixed assets</div>
        <div>
          <div style={lbl}>Received on (optional)</div>
          <select id="cap-source" style={inp} value={f.grn_line_id} onChange={e => pickSource(e.target.value)}>
            <option value="">Not received through Procurement — enter the cost</option>
            {sources.map(s => <option key={s.grn_line_id} value={s.grn_line_id}>{s.grn_number}{s.po_number ? ` · ${s.po_number}` : ''} · {s.supplier || ''} · {s.description} · {money(s.amount)}</option>)}
          </select>
          <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 4 }}>Picking the receipt moves its value from stock (1320) to plant (1610). Otherwise it posts to asset clearing (1650).</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><div style={lbl}>Cost</div><input id="cap-cost" type="number" style={inp} value={f.cost} onChange={e => set('cost', e.target.value)} /></div>
          <div><div style={lbl}>Bought on</div><input id="cap-date" type="date" style={inp} value={f.acquisition_date} onChange={e => set('acquisition_date', e.target.value)} /></div>
          <div><div style={lbl}>Asset category</div>
            <select id="cap-cat" style={inp} value={f.category_id} onChange={e => pickCat(e.target.value)}>
              <option value="">—</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><div style={lbl}>Useful life (months)</div><input id="cap-life" type="number" style={inp} value={f.useful_life_months} onChange={e => set('useful_life_months', e.target.value)} /></div>
          <div><div style={lbl}>Salvage value</div><input id="cap-salvage" type="number" style={inp} value={f.salvage_value} onChange={e => set('salvage_value', e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btn2} onClick={onClose}>Cancel</button>
          <button style={btn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Capitalise'}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}

function MoveModal({ asset, book, onClose, onDone }) {
  const { accessibleSites } = useSite()
  const [to, setTo] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!to) return showToast('Choose the site', 'red')
    setBusy(true)
    const { error } = await supabase.rpc('fleet_transfer_site', { p_asset_id: asset.id, p_to_site: to, p_date: date, p_notes: notes })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast('Machine moved', 'green')
    onDone()
  }
  return (
    <ModalOverlay onClose={onClose}>
      <div style={{ ...panel, display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Move to another site</div>
        <div><div style={lbl}>To site</div>
          <select id="move-site" style={inp} value={to} onChange={e => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {(accessibleSites || []).filter(s => s.id !== asset.site_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><div style={lbl}>Date</div><input id="move-date" type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} /></div>
        <div><div style={lbl}>Notes</div><input id="move-notes" style={inp} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. low-bed, for the Selous road job" /></div>
        <div style={{ fontSize: 12, color: THEME.textMed }}>
          {book?.status === 'active'
            ? `Book value ${money(book.book_value)} moves with it through head office & inter-site (2500) in both sites' books.`
            : 'Not capitalised, so nothing posts to the books.'} Department, cost centre, project and operator are cleared — set them at the new site.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button style={btn2} onClick={onClose}>Cancel</button>
          <button style={btn} disabled={busy} onClick={save}>{busy ? 'Moving…' : 'Move'}</button>
        </div>
      </div>
    </ModalOverlay>
  )
}
