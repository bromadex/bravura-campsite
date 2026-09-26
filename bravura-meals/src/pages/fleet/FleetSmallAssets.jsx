import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'
import { ModalOverlay, showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import { exportCsv } from '../../utils/csv'
import { useAskContext } from '../../components/AskBravura'

// FL22 — Small assets issued to people (issue #67, A6): radios, tools, laptops, phones, gas detectors.
// Every change goes through small_asset_save / _issue / _return / _count. The exit checklist blocks while someone holds items.
const CATS = [['tool', 'Tool'], ['power_tool', 'Power tool'], ['radio', 'Radio'], ['laptop', 'Laptop'], ['phone', 'Phone'], ['gas_detector', 'Gas detector'],
  ['ppe', 'PPE (reusable)'], ['measuring', 'Measuring'], ['other', 'Other']]
const CONDS = ['new', 'good', 'fair', 'damaged', 'unserviceable']
const STATUS = { in_store: ['In store', FIN.good], issued: ['Issued', FIN.blue], in_repair: ['In repair', FIN.ochreText], lost: ['Lost', FIN.bad], retired: ['Retired', FIN.faint] }
const catName = c => (CATS.find(x => x[0] === c) || [c, c])[1]
const th = { textAlign: 'left', padding: '8px', fontSize: 12, color: FIN.muted, fontWeight: 600, borderBottom: `1px solid ${FIN.line}`, whiteSpace: 'nowrap' }
const td = { padding: '8px', borderBottom: `1px solid ${FIN.lineSoft}`, fontSize: 13, verticalAlign: 'top' }
const lbl = { fontSize: 12, fontWeight: 600, color: FIN.muted, display: 'block', marginBottom: 4 }
const inp = { ...finInput, width: '100%' }
const panel = { background: FIN.card, color: FIN.ink, fontFamily: FIN.sans, borderRadius: 14, padding: 20, width: 'min(560px, calc(100vw - 32px))', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', display: 'grid', gap: 12 }

export default function FleetSmallAssets({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState('all')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null)   // { kind: 'edit'|'issue'|'return'|'count'|'history', row }
  const canWrite = can('fleet.create') || can('fleet.edit') || can('assets.create') || can('assets.edit')
  const canEdit = can('fleet.edit') || can('assets.edit')

  const load = useCallback(() => {
    if (!currentSiteId) return
    supabase.rpc('small_assets_list', { p_site_id: currentSiteId }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'red')
      setRows(data || [])
    })
  }, [currentSiteId])
  useEffect(() => { load() }, [load])

  const all = rows || []
  const totals = { items: all.length, out: all.filter(r => r.status === 'issued').length, overdue: all.filter(r => r.overdue).length,
    lost: all.filter(r => r.status === 'lost').length, value: all.filter(r => !['lost', 'retired'].includes(r.status)).reduce((s, r) => s + Number(r.value || 0), 0),
    uncounted: all.filter(r => !r.last_counted_at || (Date.now() - new Date(r.last_counted_at)) > 180 * 864e5).length }
  const shown = useMemo(() => all.filter(r =>
    (tab === 'all' || (tab === 'out' && r.status === 'issued') || (tab === 'overdue' && r.overdue) || (tab === 'store' && r.status === 'in_store') || (tab === 'problem' && ['lost', 'in_repair'].includes(r.status)))
    && (!q || `${r.tag_number} ${r.name} ${r.serial_number || ''} ${r.holder || ''} ${r.category}`.toLowerCase().includes(q.toLowerCase()))), [all, tab, q])
  const byPerson = useMemo(() => {
    const m = {}
    for (const r of all.filter(x => x.status === 'issued')) (m[r.holder] ||= []).push(r)
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length)
  }, [all])

  useAskContext(rows ? { screen: 'Small assets', totals, holders: byPerson.slice(0, 30).map(([p, items]) => ({ person: p, items: items.map(i => `${i.tag_number} ${i.name}`) })),
    overdue: all.filter(r => r.overdue).map(r => ({ tag: r.tag_number, name: r.name, person: r.holder, due_back: r.due_back })) } : { screen: 'Small assets' })

  if (!(can('fleet.view') || can('assets.view'))) return <Denied />
  const done = () => { setModal(null); load() }

  return (
    <FinShell module="Fleet" homePage="fleet_dashboard" setPage={setPage} title="Small assets"
      subtitle="Radios, tools, laptops and other equipment signed out to people"
      tabs={[{ key: 'all', label: 'All', count: 0 }, { key: 'out', label: 'Issued', count: totals.out }, { key: 'overdue', label: 'Overdue', count: totals.overdue },
        { key: 'store', label: 'In store' }, { key: 'problem', label: 'Lost / repair', count: totals.lost }, { key: 'people', label: 'Who has what' }]}
      tab={tab} onTab={setTab}
      actions={<>
        {shown.length > 0 && <button style={finBtn2} onClick={() => exportCsv('small_assets.csv', ['Tag', 'Item', 'Category', 'Serial', 'Value', 'Condition', 'Status', 'Holder', 'Since', 'Due back', 'Last counted'],
          shown.map(r => [r.tag_number, r.name, catName(r.category), r.serial_number, r.value, r.condition, r.status, r.holder, r.issued_at?.slice(0, 10), r.due_back, r.last_counted_at?.slice(0, 10)]))}>CSV</button>}
        {canWrite && <button style={finBtn} onClick={() => setModal({ kind: 'edit', row: null })}>Add item</button>}
      </>}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {[['Items', totals.items], ['Signed out', totals.out], ['Overdue', totals.overdue, totals.overdue > 0], ['Value in use', `$${money(totals.value)}`],
          ['Not counted in 6 months', totals.uncounted, totals.uncounted > 0]].map(([l, v, warn]) => (
          <div key={l} style={{ ...finCard, padding: '12px 14px' }}>
            <div style={{ fontSize: 12, color: FIN.muted }}>{l}</div>
            <div style={{ fontFamily: FIN.serif, fontSize: 24, fontWeight: 600, color: warn ? FIN.ochreText : FIN.ink }}>{v}</div>
          </div>
        ))}
      </div>

      {tab === 'people' ? (
        <div style={finCard}>
          {byPerson.length === 0 ? <div style={{ color: FIN.faint }}>Nothing is signed out.</div> : byPerson.map(([person, items]) => (
            <div key={person} style={{ padding: '10px 0', borderBottom: `1px solid ${FIN.lineSoft}` }}>
              <strong>{person}</strong> <span style={{ color: FIN.muted, fontSize: 13 }}>· {items.length} item{items.length === 1 ? '' : 's'}</span>
              <div style={{ fontSize: 13, color: FIN.muted, marginTop: 2 }}>{items.map(i => `${i.tag_number} ${i.name}${i.overdue ? ' (overdue)' : ''}`).join(' · ')}</div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <input id="sa-q" aria-label="Search small assets" placeholder="Search tag, item, serial or person…" style={{ ...finInput, maxWidth: 360 }} value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
            {!rows ? <div style={{ padding: 16, color: FIN.faint }}>Loading…</div> : shown.length === 0 ? <div style={{ padding: 16, color: FIN.faint }}>{all.length ? 'Nothing here.' : 'No small assets yet — add radios, tools and laptops with “Add item”.'}</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
                <thead><tr><th style={th}>Tag</th><th style={th}>Item</th><th style={th}>Status</th><th style={th}>With</th><th style={th}>Condition</th><th style={{ ...th, textAlign: 'right' }}>Value</th><th style={th} /></tr></thead>
                <tbody>{shown.map(r => {
                  const [sl, sc] = STATUS[r.status] || [r.status, FIN.muted]
                  return (
                    <tr key={r.id}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.tag_number}</td>
                      <td style={td}>{r.name}<div style={{ fontSize: 12, color: FIN.faint }}>{catName(r.category)}{r.serial_number ? ` · ${r.serial_number}` : ''}{r.fixed_asset_id ? ' · in Fixed Assets' : ''}</div></td>
                      <td style={{ ...td, color: sc }}>{sl}</td>
                      <td style={td}>{r.holder ? <>{r.holder}<div style={{ fontSize: 12, color: r.overdue ? FIN.bad : FIN.faint }}>since {new Date(r.issued_at).toLocaleDateString()}{r.due_back ? ` · due ${r.due_back}` : ''}</div></> : <span style={{ color: FIN.faint }}>{r.location || '—'}</span>}</td>
                      <td style={td}>{r.condition}</td>
                      <td style={{ ...td, textAlign: 'right' }}>${money(r.value)}</td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {canWrite && r.status === 'in_store' && <button style={small} onClick={() => setModal({ kind: 'issue', row: r })}>Issue</button>}
                        {canWrite && r.status === 'issued' && <button style={small} onClick={() => setModal({ kind: 'return', row: r })}>Take back</button>}
                        {canEdit && <button style={small2} onClick={() => setModal({ kind: 'count', row: r })}>Count</button>}
                        <button style={small2} onClick={() => setModal({ kind: 'history', row: r })}>History</button>
                        {canEdit && <button style={small2} onClick={() => setModal({ kind: 'edit', row: r })}>Edit</button>}
                      </td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </div>
        </>
      )}

      {modal?.kind === 'edit' && <EditModal row={modal.row} siteId={currentSiteId} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'issue' && <IssueModal row={modal.row} siteId={currentSiteId} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'return' && <ReturnModal row={modal.row} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'count' && <CountModal row={modal.row} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === 'history' && <HistoryModal row={modal.row} onClose={() => setModal(null)} />}
    </FinShell>
  )
}
const small = { ...finBtn, minHeight: 32, padding: '0 10px', fontSize: 13, marginLeft: 6 }
const small2 = { ...finBtn2, minHeight: 32, padding: '0 10px', fontSize: 13, marginLeft: 6 }

function Buttons({ busy, onClose, onSave, label }) {
  return <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
    <button style={finBtn2} onClick={onClose}>Cancel</button>
    <button style={finBtn} disabled={busy} onClick={onSave}>{busy ? 'Saving…' : label}</button>
  </div>
}

function EditModal({ row, siteId, onClose, onDone }) {
  const [f, setF] = useState(row ? { ...row, value: row.value ?? '', purchase_date: row.purchase_date || '' } : { name: '', category: 'tool', tag_number: '', serial_number: '', make: '', model: '', value: '', purchase_date: '', condition: 'good', location: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  async function save(extra = {}) {
    if (!f.name?.trim()) return showToast('Name the item', 'red')
    setBusy(true)
    const p = { id: row?.id || '', site_id: siteId, tag_number: f.tag_number, name: f.name, category: f.category, serial_number: f.serial_number, make: f.make, model: f.model,
      value: f.value, purchase_date: f.purchase_date, condition: f.condition, location: f.location, notes: f.notes, fixed_asset_id: f.fixed_asset_id || '', ...extra }
    const { error } = await supabase.rpc('small_asset_save', { p })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(extra.is_archived ? 'Item archived' : 'Saved', 'green'); onDone()
  }
  return (
    <ModalOverlay onClose={onClose} dirty>
      <div style={panel}>
        <div style={{ fontFamily: FIN.serif, fontSize: 20, fontWeight: 600 }}>{row ? `Edit ${row.tag_number}` : 'Add small asset'}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}><label htmlFor="sa-name" style={lbl}>Item</label><input id="sa-name" style={inp} value={f.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Motorola DP4400 radio" /></div>
          <div><label htmlFor="sa-cat" style={lbl}>Kind</label><select id="sa-cat" style={inp} value={f.category} onChange={e => set('category', e.target.value)}>{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label htmlFor="sa-tag" style={lbl}>Tag number</label><input id="sa-tag" style={inp} value={f.tag_number} disabled={!!row} onChange={e => set('tag_number', e.target.value)} placeholder={row ? '' : 'blank = next number'} /></div>
          <div><label htmlFor="sa-serial" style={lbl}>Serial</label><input id="sa-serial" style={inp} value={f.serial_number || ''} onChange={e => set('serial_number', e.target.value)} /></div>
          <div><label htmlFor="sa-make" style={lbl}>Make / model</label><input id="sa-make" style={inp} value={[f.make, f.model].filter(Boolean).join(' ')} onChange={e => { const [mk, ...md] = e.target.value.split(' '); setF(p => ({ ...p, make: mk, model: md.join(' ') })) }} /></div>
          <div><label htmlFor="sa-value" style={lbl}>Value (USD)</label><input id="sa-value" type="number" step="0.01" style={inp} value={f.value} onChange={e => set('value', e.target.value)} /></div>
          <div><label htmlFor="sa-date" style={lbl}>Bought on</label><input id="sa-date" type="date" style={inp} value={f.purchase_date} onChange={e => set('purchase_date', e.target.value)} /></div>
          <div><label htmlFor="sa-cond" style={lbl}>Condition</label><select id="sa-cond" style={inp} value={f.condition} onChange={e => set('condition', e.target.value)}>{CONDS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label htmlFor="sa-loc" style={lbl}>Kept at</label><input id="sa-loc" style={inp} value={f.location || ''} onChange={e => set('location', e.target.value)} placeholder="e.g. Container 2, radio rack" /></div>
          <div style={{ gridColumn: '1 / -1' }}><label htmlFor="sa-notes" style={lbl}>Notes</label><input id="sa-notes" style={inp} value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
        </div>
        <div style={{ fontSize: 12, color: FIN.faint }}>High-value items can also go into Fixed Assets (Finance → Fixed Assets) for depreciation.</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          {row && row.status !== 'issued' ? <div style={{ display: 'flex', gap: 8 }}>
            {row.status !== 'retired' && <button style={finBtn2} onClick={() => save({ status: 'retired' })}>Retire</button>}
            {row.status === 'in_repair' && <button style={finBtn2} onClick={() => save({ status: 'in_store' })}>Back in store</button>}
            <button style={finBtn2} onClick={() => save({ is_archived: true })}>Archive</button>
          </div> : <span />}
          <Buttons busy={busy} onClose={onClose} onSave={() => save()} label="Save" />
        </div>
      </div>
    </ModalOverlay>
  )
}

function IssueModal({ row, siteId, onClose, onDone }) {
  const [emps, setEmps] = useState([])
  const [empId, setEmpId] = useState('')
  const [signed, setSigned] = useState('')
  const [due, setDue] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    supabase.from('employees').select('id, name, employee_number').eq('site_id', siteId).eq('status', 'active').eq('is_archived', false).order('name')
      .then(({ data }) => setEmps(data || []))
  }, [siteId])
  const emp = emps.find(e => e.id === empId)
  async function save() {
    if (!empId) return showToast('Choose who gets it', 'red')
    if (!signed.trim()) return showToast('The person types their name to sign for it', 'red')
    setBusy(true)
    const { error } = await supabase.rpc('small_asset_issue', { p_asset_id: row.id, p_employee_id: empId, p_signed_name: signed, p_due_back: due || null, p_notes: notes || null })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(`${row.tag_number} signed out to ${emp?.name}`, 'green'); onDone()
  }
  return (
    <ModalOverlay onClose={onClose}>
      <div style={panel}>
        <div style={{ fontFamily: FIN.serif, fontSize: 20, fontWeight: 600 }}>Issue {row.tag_number} {row.name}</div>
        <div><label htmlFor="sa-emp" style={lbl}>To</label>
          <select id="sa-emp" style={inp} value={empId} onChange={e => setEmpId(e.target.value)}>
            <option value="">Choose a person…</option>{emps.map(e => <option key={e.id} value={e.id}>{e.name}{e.employee_number ? ` (${e.employee_number})` : ''}</option>)}
          </select></div>
        <div><label htmlFor="sa-due" style={lbl}>Back by (leave blank if it stays with them)</label><input id="sa-due" type="date" style={inp} value={due} onChange={e => setDue(e.target.value)} /></div>
        <div><label htmlFor="sa-inotes" style={lbl}>Notes</label><input id="sa-inotes" style={inp} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. with charger and spare battery" /></div>
        <div style={{ ...finCard, background: FIN.blueTint, padding: 12 }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>I, <strong>{emp?.name || '…'}</strong>, received {row.tag_number} {row.name} in <strong>{row.condition}</strong> condition and will return it when asked or when I leave.</div>
          <label htmlFor="sa-sign" style={lbl}>Signature — the person types their full name</label>
          <input id="sa-sign" style={{ ...inp, fontFamily: FIN.serif, fontStyle: 'italic', fontSize: 16 }} value={signed} onChange={e => setSigned(e.target.value)} />
        </div>
        <Buttons busy={busy} onClose={onClose} onSave={save} label="Issue" />
      </div>
    </ModalOverlay>
  )
}

function ReturnModal({ row, onClose, onDone }) {
  const [cond, setCond] = useState(row.condition || 'good')
  const [lost, setLost] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('small_asset_return', { p_asset_id: row.id, p_condition: lost ? null : cond, p_notes: notes || null, p_lost: lost })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast(lost ? `${row.tag_number} marked lost` : `${row.tag_number} back in ${['damaged', 'unserviceable'].includes(cond) ? 'repair' : 'store'}`, 'green'); onDone()
  }
  return (
    <ModalOverlay onClose={onClose}>
      <div style={panel}>
        <div style={{ fontFamily: FIN.serif, fontSize: 20, fontWeight: 600 }}>Take back {row.tag_number} from {row.holder}</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={lost} onChange={e => setLost(e.target.checked)} /> Not returned — lost or stolen</label>
        {!lost && <div><label htmlFor="sa-rcond" style={lbl}>Condition it came back in</label>
          <select id="sa-rcond" style={inp} value={cond} onChange={e => setCond(e.target.value)}>{CONDS.map(c => <option key={c} value={c}>{c}</option>)}</select>
          {['damaged', 'unserviceable'].includes(cond) && <div style={{ fontSize: 12, color: FIN.ochreText, marginTop: 4 }}>It goes to “in repair” until someone puts it back in store.</div>}</div>}
        <div><label htmlFor="sa-rnotes" style={lbl}>{lost ? 'What happened (required)' : 'Notes'}</label><input id="sa-rnotes" style={inp} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <Buttons busy={busy} onClose={onClose} onSave={save} label={lost ? 'Mark lost' : 'Take back'} />
      </div>
    </ModalOverlay>
  )
}

function CountModal({ row, onClose, onDone }) {
  const [found, setFound] = useState(true)
  const [cond, setCond] = useState(row.condition)
  const [loc, setLoc] = useState(row.location || '')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('small_asset_count', { p_asset_id: row.id, p_found: found, p_condition: cond, p_location: loc || null })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast('Count recorded', 'green'); onDone()
  }
  return (
    <ModalOverlay onClose={onClose}>
      <div style={panel}>
        <div style={{ fontFamily: FIN.serif, fontSize: 20, fontWeight: 600 }}>Count {row.tag_number} {row.name}</div>
        <div style={{ fontSize: 13, color: FIN.muted }}>{row.holder ? `Should be with ${row.holder}.` : `Should be at ${row.location || 'the store'}.`} Last counted {row.last_counted_at ? new Date(row.last_counted_at).toLocaleDateString() : 'never'}.</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {[[true, 'Seen'], [false, 'Not found']].map(([v, l]) => <button key={l} onClick={() => setFound(v)} style={{ ...(found === v ? finBtn : finBtn2), flex: 1 }}>{l}</button>)}
        </div>
        {found && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div><label htmlFor="sa-ccond" style={lbl}>Condition</label><select id="sa-ccond" style={inp} value={cond} onChange={e => setCond(e.target.value)}>{CONDS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          <div><label htmlFor="sa-cloc" style={lbl}>Where</label><input id="sa-cloc" style={inp} value={loc} onChange={e => setLoc(e.target.value)} /></div>
        </div>}
        <Buttons busy={busy} onClose={onClose} onSave={save} label="Save count" />
      </div>
    </ModalOverlay>
  )
}

function HistoryModal({ row, onClose }) {
  const [h, setH] = useState(null)
  useEffect(() => { supabase.rpc('small_asset_history', { p_asset_id: row.id }).then(({ data }) => setH(data || [])) }, [row.id])
  return (
    <ModalOverlay onClose={onClose}>
      <div style={panel}>
        <div style={{ fontFamily: FIN.serif, fontSize: 20, fontWeight: 600 }}>{row.tag_number} {row.name} — who had it</div>
        {!h ? <div style={{ color: FIN.faint }}>Loading…</div> : h.length === 0 ? <div style={{ color: FIN.faint }}>Never issued.</div> : h.map((x, i) => (
          <div key={i} style={{ borderBottom: `1px solid ${FIN.lineSoft}`, paddingBottom: 8, fontSize: 13 }}>
            <strong>{x.employee}</strong> <span style={{ color: FIN.muted }}>· signed “{x.signed_name}”</span>
            <div style={{ color: FIN.muted }}>{new Date(x.issued_at).toLocaleDateString()} ({x.condition_out}) → {x.status === 'out' ? 'still has it' : x.status === 'lost' ? `lost ${new Date(x.returned_at).toLocaleDateString()}` : `${new Date(x.returned_at).toLocaleDateString()} (${x.condition_in})`}{x.due_back ? ` · was due ${x.due_back}` : ''}</div>
            {x.notes && <div style={{ color: FIN.faint }}>{x.notes}</div>}
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={finBtn2} onClick={onClose}>Close</button></div>
      </div>
    </ModalOverlay>
  )
}
