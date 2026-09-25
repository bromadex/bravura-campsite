import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { FIN } from '../../utils/financeTheme'
import { useFinEmbedded } from '../../components/finEmbed'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, Icon, Modal, PageHeader, showToast, fmtDate, today } from '../../components/ui'
import Denied from '../../components/Denied'
import { exportCsv } from '../../utils/csv'

const FI = FIN.maroon  // finance design: maroon actions (issue #49)
const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inp = {
  width: '100%', minHeight: '40px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', border: `1px solid ${THEME.outlineVar}`,
  background: THEME.surface, color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }
const STATUS = {
  draft:       { label: 'Draft',       bg: THEME.surfaceVar,      fg: THEME.textMed },
  active:      { label: 'In use',      bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
  disposed:    { label: 'Disposed',    bg: THEME.statusInfoBg,    fg: THEME.statusInfoText || THEME.textMed },
  written_off: { label: 'Written off', bg: THEME.statusErrorBg,   fg: THEME.statusErrorText },
}
const MOVE = { created: 'Added', capitalised: 'Capitalised', reclassified: 'Reclassified', transferred: 'Moved', verified: 'Counted', disposed: 'Disposed', written_off: 'Written off' }
const EMPTY = { name: '', category_id: '', serial_number: '', location: '', cost_centre_id: '', project_id: '', custodian_employee_id: '',
  acquisition_date: '', cost: '', salvage_value: '0', method: 'straight_line', useful_life_months: '', rate_pct: '', notes: '' }

function Field({ id, label, children }) {
  return <div><label htmlFor={id} style={lbl}>{label}</label>{children}</div>
}

export default function FixedAssets() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [rows, setRows] = useState(null)
  const [cats, setCats] = useState([])
  const [ref, setRef] = useState({ centres: [], projects: [], employees: [] })
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [modal, setModal] = useState(null)   // {edit: asset|null} | {dispose: asset} | {history: asset} | 'cats' | 'import'
  const [form, setForm] = useState(EMPTY)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const [a, c] = await Promise.all([
      supabase.from('fixed_assets').select('*, category:asset_categories(name), fleet:fleet_assets(fleet_number, registration)')
        .eq('site_id', currentSiteId).eq('is_archived', false).order('asset_code'),
      supabase.from('asset_categories').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
    ])
    if (a.error) showToast(a.error.message, 'red')
    setRows(a.data || []); setCats(c.data || [])
  }, [currentSiteId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!currentSiteId) return
    Promise.all([
      supabase.from('cost_centres').select('id, code, name').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
      supabase.from('projects').select('id, project_code, name').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ]).then(([cc, pj, em]) => setRef({ centres: cc.data || [], projects: pj.data || [], employees: em.data || [] }))
  }, [currentSiteId])

  const shown = useMemo(() => (rows || [])
    .filter(r => filter === 'all' || r.status === filter)
    .filter(r => !q || `${r.asset_code} ${r.name} ${r.serial_number || ''} ${r.location || ''}`.toLowerCase().includes(q.toLowerCase())), [rows, filter, q])
  const totals = useMemo(() => {
    const act = (rows || []).filter(r => r.status === 'active')
    const cost = act.reduce((s, r) => s + Number(r.cost), 0)
    const acc = act.reduce((s, r) => s + Number(r.accumulated_depreciation), 0)
    return { count: act.length, cost, acc, book: cost - acc, drafts: (rows || []).filter(r => r.status === 'draft').length }
  }, [rows])

  if (!can('assets.view')) return <Denied />

  function openEdit(asset) {
    setForm(asset ? Object.fromEntries(Object.keys(EMPTY).map(k => [k, asset[k] ?? ''])) : EMPTY)
    setModal({ edit: asset || null })
  }
  async function save() {
    setBusy(true)
    const payload = { ...form }
    let error
    if (modal.edit) {
      const upd = Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, v === '' ? null : v]))
      if (modal.edit.status !== 'draft') for (const k of ['cost', 'salvage_value', 'method', 'useful_life_months', 'rate_pct', 'acquisition_date']) delete upd[k]
      else { upd.cost = upd.cost ?? 0; upd.salvage_value = upd.salvage_value ?? 0 }
      ;({ error } = await supabase.from('fixed_assets').update(upd).eq('id', modal.edit.id))
    } else {
      ;({ error } = await supabase.rpc('fa_create_asset', { p_site_id: currentSiteId, p_data: payload }))
    }
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Saved', 'green'); setModal(null); load()
  }
  async function capitalise(a) {
    if (!window.confirm(`Capitalise ${a.asset_code}? Its cost and depreciation settings are then locked.`)) return
    const { error } = await supabase.rpc('fa_capitalise', { p_asset_id: a.id })
    if (error) { showToast(error.message, 'red'); return }
    showToast('Capitalised — it will be depreciated from next run', 'green'); load()
  }
  async function dispose() {
    setBusy(true)
    const { error } = await supabase.rpc('fa_dispose', { p_asset_id: modal.dispose.id, p_date: form.date, p_proceeds: Number(form.proceeds || 0),
      p_write_off: form.write_off, p_notes: form.notes })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Done', 'green'); setModal(null); load()
  }
  async function importFleet() {
    setBusy(true)
    const { data: n, error } = await supabase.rpc('fa_import_from_fleet', { p_site_id: currentSiteId, p_category_id: form.category_id || null })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(n ? `${n} fleet asset${n > 1 ? 's' : ''} added as drafts — enter their cost, then capitalise` : 'Every fleet asset is already on the register', 'green')
    setModal(null); load()
  }
  async function openHistory(a) {
    setModal({ history: a }); setHistory(null)
    const [m, d] = await Promise.all([
      supabase.from('asset_movements').select('*').eq('asset_id', a.id).order('created_at', { ascending: false }),
      supabase.from('asset_depreciation').select('*').eq('asset_id', a.id).order('period', { ascending: false }),
    ])
    setHistory({ moves: m.data || [], dep: d.data || [] })
  }
  async function saveCategory() {
    if (!form.name?.trim()) return
    const { error } = await supabase.from('asset_categories').insert({ site_id: currentSiteId, name: form.name.trim(), method: form.method,
      useful_life_months: form.method === 'straight_line' ? Number(form.useful_life_months) || null : null,
      rate_pct: form.method === 'reducing_balance' ? Number(form.rate_pct) || null : null })
    if (error) { showToast(error.message, 'red'); return }
    setForm({ ...form, name: '', useful_life_months: '', rate_pct: '' }); load()
  }
  async function archiveCategory(c) {
    const { error } = await supabase.from('asset_categories').update({ is_archived: true }).eq('id', c.id)
    if (error) { showToast(error.message, 'red'); return }
    load()
  }

  const isDraft = !modal?.edit || modal.edit.status === 'draft'
  return (
    <div>
      <PageHeader title="Fixed Asset Register" actions={
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {can('assets.edit') && <Button variant="outlined" icon="category" onClick={() => { setForm({ ...EMPTY }); setModal('cats') }}>Categories</Button>}
          {can('assets.create') && <Button variant="outlined" icon="local_shipping" onClick={() => { setForm({ category_id: '' }); setModal('import') }}>Import fleet</Button>}
          {rows?.length > 0 && <Button variant="outlined" icon="download" onClick={() => exportCsv('fixed_assets.csv',
            ['Code', 'Name', 'Category', 'Status', 'Acquired', 'Cost', 'Accumulated depreciation', 'Book value', 'Location', 'Last counted'],
            shown.map(r => [r.asset_code, r.name, r.category?.name, r.status, r.acquisition_date, r.cost, r.accumulated_depreciation,
              Number(r.cost) - Number(r.accumulated_depreciation), r.location, r.last_verified_at?.slice(0, 10)]))}>CSV</Button>}
          {can('assets.create') && <Button icon="add" onClick={() => openEdit(null)}>Add asset</Button>}
        </div>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '14px' }}>
        {[['Assets in use', totals.count], ['Cost', usd(totals.cost)], ['Accumulated depreciation', usd(totals.acc)], ['Book value', usd(totals.book)]].map(([l, v]) => (
          <Card key={l} style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: '12px', color: THEME.textMed }}>{l}</div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
          </Card>
        ))}
      </div>
      {totals.drafts > 0 && (
        <Card style={{ padding: '10px 14px', marginBottom: '12px', background: THEME.statusWarningBg, color: THEME.statusWarningText, fontSize: '13px' }}>
          {totals.drafts} draft asset{totals.drafts > 1 ? 's' : ''} need a cost, acquisition date and useful life before they can be capitalised and depreciated.
        </Card>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[['all', 'All'], ['draft', 'Draft'], ['active', 'In use'], ['disposed', 'Disposed'], ['written_off', 'Written off']].map(([k, t]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} style={{ padding: '6px 12px', borderRadius: '999px', border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: '12px', fontWeight: 600, background: filter === k ? FI : THEME.surfaceVar, color: filter === k ? '#fff' : THEME.textMed }}>{t}</button>
        ))}
        <input id="fa-search" aria-label="Search assets" placeholder="Search code, name, serial, location" value={q} onChange={e => setQ(e.target.value)} style={{ ...inp, maxWidth: '280px', marginLeft: 'auto' }} />
      </div>

      <Card style={{ padding: 0, overflowX: 'auto' }}>
        {!rows ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : shown.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No assets. Add one, or import your fleet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '860px' }}>
            <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed, textAlign: 'left' }}>
              {['Code', 'Asset', 'Category', 'Status', 'Cost', 'Book value', 'Last counted', ''].map((h, i) => (
                <th key={h || i} style={{ padding: '8px 10px', textAlign: ['Cost', 'Book value'].includes(h) ? 'right' : 'left' }}>{h}</th>))}
            </tr></thead>
            <tbody>
              {shown.map(r => {
                const st = STATUS[r.status]
                return (
                  <tr key={r.id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{r.asset_code}</td>
                    <td style={{ padding: '8px 10px' }}>{r.name}
                      <div style={{ fontSize: '11px', color: THEME.textLow }}>{[r.fleet && 'Fleet', r.serial_number, r.location].filter(Boolean).join(' · ')}</div></td>
                    <td style={{ padding: '8px 10px' }}>{r.category?.name || '—'}</td>
                    <td style={{ padding: '8px 10px' }}><span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: st.bg, color: st.fg }}>{st.label}</span></td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{usd(r.cost)}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{usd(Number(r.cost) - Number(r.accumulated_depreciation))}</td>
                    <td style={{ padding: '8px 10px', color: THEME.textMed }}>{r.last_verified_at ? fmtDate(r.last_verified_at.slice(0, 10)) : 'Never'}</td>
                    <td style={{ padding: '6px 10px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <IconBtn icon="history" label="History" onClick={() => openHistory(r)} />
                      {can('assets.edit') && ['draft', 'active'].includes(r.status) && <IconBtn icon="edit" label="Edit" onClick={() => openEdit(r)} />}
                      {can('assets.approve') && r.status === 'draft' && <IconBtn icon="task_alt" label="Capitalise" onClick={() => capitalise(r)} />}
                      {can('assets.delete') && ['draft', 'active'].includes(r.status) && <IconBtn icon="delete_sweep" label="Dispose / write off"
                        onClick={() => { setForm({ date: today(), proceeds: '', write_off: false, notes: '' }); setModal({ dispose: r }) }} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!modal?.hasOwnProperty?.('edit')} onClose={() => setModal(null)} title={modal?.edit ? `Edit ${modal.edit.asset_code}` : 'Add asset'} maxWidth={640}
        footer={<><Button variant="text" onClick={() => setModal(null)}>Cancel</Button><Button onClick={save} disabled={busy}>Save</Button></>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          <Field id="fa-name" label="Name"><input id="fa-name" style={inp} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field id="fa-cat" label="Category"><select id="fa-cat" style={inp} value={form.category_id || ''} onChange={e => {
            const c = cats.find(x => x.id === e.target.value)
            setForm({ ...form, category_id: e.target.value, ...(c && isDraft ? { method: c.method, useful_life_months: c.useful_life_months ?? '', rate_pct: c.rate_pct ?? '' } : {}) })
          }}><option value="">—</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field id="fa-serial" label="Serial number"><input id="fa-serial" style={inp} value={form.serial_number || ''} onChange={e => setForm({ ...form, serial_number: e.target.value })} /></Field>
          <Field id="fa-loc" label="Location"><input id="fa-loc" style={inp} value={form.location || ''} onChange={e => setForm({ ...form, location: e.target.value })} /></Field>
          <Field id="fa-cc" label="Cost centre"><select id="fa-cc" style={inp} value={form.cost_centre_id || ''} onChange={e => setForm({ ...form, cost_centre_id: e.target.value })}>
            <option value="">—</option>{ref.centres.map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>
          <Field id="fa-pj" label="Project"><select id="fa-pj" style={inp} value={form.project_id || ''} onChange={e => setForm({ ...form, project_id: e.target.value })}>
            <option value="">—</option>{ref.projects.map(p => <option key={p.id} value={p.id}>{p.project_code ? `${p.project_code} ` : ''}{p.name}</option>)}</select></Field>
          <Field id="fa-cust" label="Custodian"><select id="fa-cust" style={inp} value={form.custodian_employee_id || ''} onChange={e => setForm({ ...form, custodian_employee_id: e.target.value })}>
            <option value="">—</option>{ref.employees.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field id="fa-acq" label="Acquisition date"><input id="fa-acq" type="date" style={inp} disabled={!isDraft} value={form.acquisition_date || ''} onChange={e => setForm({ ...form, acquisition_date: e.target.value })} /></Field>
          <Field id="fa-cost" label="Cost (USD)"><input id="fa-cost" type="number" step="0.01" style={inp} disabled={!isDraft} value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} /></Field>
          <Field id="fa-salv" label="Salvage value"><input id="fa-salv" type="number" step="0.01" style={inp} disabled={!isDraft} value={form.salvage_value} onChange={e => setForm({ ...form, salvage_value: e.target.value })} /></Field>
          <Field id="fa-meth" label="Depreciation method"><select id="fa-meth" style={inp} disabled={!isDraft} value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
            <option value="straight_line">Straight line</option><option value="reducing_balance">Reducing balance</option></select></Field>
          {form.method === 'straight_line'
            ? <Field id="fa-life" label="Useful life (months)"><input id="fa-life" type="number" style={inp} disabled={!isDraft} value={form.useful_life_months} onChange={e => setForm({ ...form, useful_life_months: e.target.value })} /></Field>
            : <Field id="fa-rate" label="Rate per year (%)"><input id="fa-rate" type="number" step="0.01" style={inp} disabled={!isDraft} value={form.rate_pct} onChange={e => setForm({ ...form, rate_pct: e.target.value })} /></Field>}
        </div>
        {!isDraft && <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '10px' }}>Cost and depreciation are locked after capitalisation. Changing location, custodian, category, cost centre or project is logged in the asset's history.</div>}
      </Modal>

      <Modal open={!!modal?.dispose} onClose={() => setModal(null)} title={`Dispose of ${modal?.dispose?.asset_code || ''}`}
        footer={<><Button variant="text" onClick={() => setModal(null)}>Cancel</Button><Button onClick={dispose} disabled={busy}>{form.write_off ? 'Write off' : 'Dispose'}</Button></>}>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div style={{ fontSize: '13px', color: THEME.textMed }}>Book value today: <b style={{ color: THEME.text }}>{usd(Number(modal?.dispose?.cost || 0) - Number(modal?.dispose?.accumulated_depreciation || 0))}</b></div>
          <label htmlFor="fa-wo" style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '14px', color: THEME.text }}>
            <input id="fa-wo" type="checkbox" checked={!!form.write_off} onChange={e => setForm({ ...form, write_off: e.target.checked })} /> Lost, stolen or destroyed (write off)</label>
          <Field id="fa-dd" label="Date"><input id="fa-dd" type="date" style={inp} value={form.date || ''} onChange={e => setForm({ ...form, date: e.target.value })} /></Field>
          {!form.write_off && <Field id="fa-pr" label="Scrap proceeds received (USD, if any)"><input id="fa-pr" type="number" step="0.01" style={inp} value={form.proceeds || ''} onChange={e => setForm({ ...form, proceeds: e.target.value })} /></Field>}
          <Field id="fa-dn" label="Reason"><input id="fa-dn" style={inp} value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={modal === 'import'} onClose={() => setModal(null)} title="Import fleet assets"
        footer={<><Button variant="text" onClick={() => setModal(null)}>Cancel</Button><Button onClick={importFleet} disabled={busy}>Import</Button></>}>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '12px' }}>Adds every fleet vehicle and machine that isn't on the register yet, as a draft linked to its fleet record.</div>
        <Field id="fa-icat" label="Put them in category"><select id="fa-icat" style={inp} value={form.category_id || ''} onChange={e => setForm({ ...form, category_id: e.target.value })}>
          <option value="">— (set later)</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </Modal>

      <Modal open={modal === 'cats'} onClose={() => setModal(null)} title="Asset categories" maxWidth={600}>
        <div style={{ display: 'grid', gap: '6px', marginBottom: '14px' }}>
          {cats.length === 0 && <div style={{ fontSize: '13px', color: THEME.textLow }}>No categories yet.</div>}
          {cats.map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: THEME.text }}>
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ fontSize: '12px', color: THEME.textMed }}>{c.method === 'straight_line' ? `Straight line · ${c.useful_life_months || '?'} months` : `Reducing balance · ${c.rate_pct}%/yr`}</span>
              <IconBtn icon="close" label={`Remove ${c.name}`} onClick={() => archiveCategory(c)} />
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr auto', gap: '8px', alignItems: 'end' }}>
          <Field id="fc-name" label="Name"><input id="fc-name" style={inp} placeholder="e.g. Earthmoving equipment" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field id="fc-meth" label="Method"><select id="fc-meth" style={inp} value={form.method || 'straight_line'} onChange={e => setForm({ ...form, method: e.target.value })}>
            <option value="straight_line">Straight line</option><option value="reducing_balance">Reducing balance</option></select></Field>
          {(form.method || 'straight_line') === 'straight_line'
            ? <Field id="fc-life" label="Months"><input id="fc-life" type="number" style={inp} value={form.useful_life_months || ''} onChange={e => setForm({ ...form, useful_life_months: e.target.value })} /></Field>
            : <Field id="fc-rate" label="% / year"><input id="fc-rate" type="number" style={inp} value={form.rate_pct || ''} onChange={e => setForm({ ...form, rate_pct: e.target.value })} /></Field>}
          <Button onClick={saveCategory}>Add</Button>
        </div>
      </Modal>

      <Modal open={!!modal?.history} onClose={() => setModal(null)} title={`${modal?.history?.asset_code || ''} history`} maxWidth={640}>
        {!history ? <div style={{ color: THEME.textLow }}>Loading…</div> : (
          <div style={{ display: 'grid', gap: '16px' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>Depreciation</div>
              {history.dep.length === 0 ? <div style={{ fontSize: '13px', color: THEME.textLow }}>None posted yet.</div> : (
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <tbody>{history.dep.map(d => (
                    <tr key={d.id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                      <td style={{ padding: '4px 0' }}>{new Date(d.period + 'T00:00:00').toLocaleDateString([], { month: 'short', year: 'numeric' })}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{usd(d.amount)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>book {usd(d.book_value_after)}</td>
                      <td style={{ textAlign: 'right', fontSize: '11px', color: d.journal_id ? THEME.statusSuccessText : THEME.statusWarningText }}>{d.journal_id ? 'Posted' : 'Not posted'}</td>
                    </tr>))}</tbody>
                </table>
              )}
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>Activity</div>
              {history.moves.map(m => (
                <div key={m.id} style={{ fontSize: '13px', color: THEME.textMed, padding: '4px 0', borderTop: `1px solid ${THEME.outlineVar}` }}>
                  <b style={{ color: THEME.text }}>{MOVE[m.change_type] || m.change_type}</b> · {new Date(m.created_at).toLocaleString()}
                  {m.notes && <> · {m.notes}</>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function IconBtn({ icon, label, onClick }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, padding: '6px', borderRadius: '6px' }}>
      <Icon name={icon} size={18} />
    </button>
  )
}
