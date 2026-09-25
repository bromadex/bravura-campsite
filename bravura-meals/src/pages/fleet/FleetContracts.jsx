import { useState, useEffect, useCallback, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useFleet } from '../../contexts/FleetContext'
import { supabase } from '../../supabaseClient'
import { ModalOverlay, showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'
import Denied from '../../components/Denied'
import FleetQuickNav from './FleetQuickNav'

// FL21 — fleet contracts (Fleet A4, #65): insurance, lease, service, warranty, tracking. Recurring cost is
// shown per year; a daily job reminds Fleet editors `remind_days` before the end date (fleet_contract_reminders).
const CLR = MODULE_COLORS.fleet
const TYPES = [['insurance', 'Insurance'], ['lease', 'Lease'], ['service', 'Service contract'], ['warranty', 'Warranty'], ['tracking', 'Tracking'], ['other', 'Other']]
const FREQ = [['monthly', 'per month'], ['quarterly', 'per quarter'], ['annually', 'per year'], ['once', 'once']]
const STATE = {
  ok: ['Active', THEME.statusSuccessText, THEME.statusSuccessBg], renew_soon: ['Renew soon', THEME.statusWarningText, THEME.statusWarningBg],
  expired: ['Expired', THEME.statusErrorText, THEME.statusErrorBg], 'open-ended': ['No end date', THEME.textMed, THEME.surfaceVar],
  ended: ['Ended', THEME.textMed, THEME.surfaceVar], cancelled: ['Cancelled', THEME.textMed, THEME.surfaceVar],
}
const money = v => '$' + Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 14, boxSizing: 'border-box' }
const lbl = { fontSize: 12, fontWeight: 600, color: THEME.textMed, marginBottom: 4, display: 'block' }
const btn = { padding: '8px 16px', borderRadius: 8, border: 'none', background: CLR, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 13 }
const btn2 = { ...btn, background: 'transparent', color: THEME.text, border: `1px solid ${THEME.outline}` }
const EMPTY = { contract_type: 'insurance', asset_id: '', supplier_id: '', provider_name: '', reference: '', description: '', start_date: '', end_date: '',
  amount: '', frequency: 'monthly', remind_days: 30, auto_renews: false, notes: '' }

export default function FleetContracts({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { assets } = useFleet()
  const [rows, setRows] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [filter, setFilter] = useState('active')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!currentSiteId) return
    supabase.rpc('fleet_contract_list', { p_site_id: currentSiteId }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'red')
      setRows(data || [])
    })
  }, [currentSiteId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('procurement_suppliers').select('id, supplier_name').order('supplier_name').then(({ data }) => setSuppliers(data || []))
  }, [])

  const shown = useMemo(() => (rows || []).filter(r => filter === 'all' || (filter === 'active' ? r.status === 'active' : ['renew_soon', 'expired'].includes(r.state))), [rows, filter])
  const active = (rows || []).filter(r => r.status === 'active')
  const yearly = active.reduce((s, r) => s + Number(r.annual_cost || 0), 0)
  const soon = active.filter(r => r.state === 'renew_soon').length
  const expired = active.filter(r => r.state === 'expired').length

  if (!can('fleet.view')) return <Denied />

  async function save() {
    if (!form.provider_name && !form.supplier_id) return showToast('Enter who the contract is with', 'red')
    setBusy(true)
    const payload = { ...form, site_id: currentSiteId, asset_id: form.asset_id || null, supplier_id: form.supplier_id || null,
      start_date: form.start_date || null, end_date: form.end_date || null, amount: Number(form.amount || 0), remind_days: Number(form.remind_days || 0),
      updated_at: new Date().toISOString() }
    delete payload.id
    // A new end date means a new reminder.
    if (form.id && form._old_end !== form.end_date) payload.reminded_for = null
    delete payload._old_end
    const { error } = await (form.id ? supabase.from('fleet_contracts').update(payload).eq('id', form.id).eq('site_id', currentSiteId)
      : supabase.from('fleet_contracts').insert(payload))
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'red')
    showToast('Contract saved', 'green'); setForm(null); load()
  }
  async function setStatus(r, status) {
    const { error } = await supabase.from('fleet_contracts').update({ status, updated_at: new Date().toISOString() }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) return showToast(friendlyError(error), 'red')
    load()
  }
  function edit(r) {
    setForm({ id: r.id, _old_end: r.end_date, contract_type: r.contract_type, asset_id: r.asset_id || '', supplier_id: r.supplier_id || '',
      provider_name: r.supplier_id ? '' : (r.provider || ''), reference: r.reference || '', description: r.description || '', start_date: r.start_date || '',
      end_date: r.end_date || '', amount: r.amount, frequency: r.frequency, remind_days: r.remind_days, auto_renews: r.auto_renews, notes: r.notes || '' })
  }
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gap: 14 }}>
      <FleetQuickNav setPage={setPage} current="fleet_contracts" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 500, color: THEME.text }}>Contracts</div>
          <div style={{ fontSize: 12, color: THEME.textMed }}>Insurance, leases and service contracts for the fleet</div>
        </div>
        {(can('fleet.create') || can('fleet.edit')) && <button style={btn} onClick={() => setForm({ ...EMPTY })}>Add contract</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        {[['Active contracts', active.length], ['Cost per year', money(yearly)], ['Renew within reminder', soon], ['Expired, still active', expired]].map(([l, v]) => (
          <div key={l} style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 12, color: THEME.textMed }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: THEME.text }}>{v}</div>
          </div>
        ))}
      </div>

      <div role="tablist" style={{ display: 'flex', gap: 6 }}>
        {[['active', 'Active'], ['attention', 'Needs renewing'], ['all', 'All']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} style={{ padding: '6px 14px', borderRadius: 16, cursor: 'pointer', fontSize: 13,
            border: `1px solid ${filter === k ? CLR : THEME.outline}`, background: filter === k ? CLR : THEME.surface, color: filter === k ? '#fff' : THEME.text }}>{l}</button>
        ))}
      </div>

      <div style={{ overflowX: 'auto', border: `1px solid ${THEME.outlineVar}`, borderRadius: 12, background: THEME.surface }}>
        {!rows ? <div style={{ padding: 20, color: THEME.textLow }}>Loading…</div> : shown.length === 0 ? <div style={{ padding: 20, color: THEME.textLow }}>No contracts here.</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 820 }}>
            <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed, textAlign: 'left' }}>
              {['Type', 'With', 'Machine', 'Reference', 'Ends', 'Cost', 'Per year', 'State', ''].map(h => <th key={h} style={{ padding: '10px 12px', fontSize: 11 }}>{h}</th>)}
            </tr></thead>
            <tbody>{shown.map(r => {
              const [sl, fg, bg] = STATE[r.state] || STATE.ok
              return (
                <tr key={r.id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                  <td style={{ padding: '10px 12px' }}>{(TYPES.find(t => t[0] === r.contract_type) || [])[1]}</td>
                  <td style={{ padding: '10px 12px' }}>{r.provider || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{r.machine}</td>
                  <td style={{ padding: '10px 12px' }}>{r.reference || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>{r.end_date || '—'}{r.status === 'active' && r.days_left != null ? <div style={{ fontSize: 11, color: THEME.textLow }}>{r.days_left < 0 ? `${-r.days_left} days ago` : `in ${r.days_left} days`}</div> : null}</td>
                  <td style={{ padding: '10px 12px' }}>{money(r.amount)} {(FREQ.find(f => f[0] === r.frequency) || [])[1]}</td>
                  <td style={{ padding: '10px 12px' }}>{r.frequency === 'once' ? '—' : money(r.annual_cost)}</td>
                  <td style={{ padding: '10px 12px' }}><span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 6, color: fg, background: bg }}>{sl}</span></td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                    {can('fleet.edit') && <>
                      <button style={{ ...btn2, padding: '4px 10px' }} onClick={() => edit(r)}>Edit</button>{' '}
                      {r.status === 'active' && <button style={{ ...btn2, padding: '4px 10px' }} onClick={() => setStatus(r, 'ended')}>End</button>}
                    </>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </div>

      {form && (
        <ModalOverlay onClose={() => setForm(null)} dirty>
          <div style={{ background: THEME.surface, color: THEME.text, borderRadius: 14, padding: 20, width: 'min(600px, calc(100vw - 32px))', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
            <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 14 }}>{form.id ? 'Edit contract' : 'Add contract'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div><label htmlFor="fc-type" style={lbl}>Type</label>
                <select id="fc-type" style={inp} value={form.contract_type} onChange={e => set('contract_type', e.target.value)}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label htmlFor="fc-asset" style={lbl}>Machine</label>
                <select id="fc-asset" style={inp} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                  <option value="">All machines / fleet policy</option>
                  {(assets || []).map(a => <option key={a.id} value={a.id}>{a.fleet_number || a.asset_number} {a.description || ''}</option>)}
                </select></div>
              <div><label htmlFor="fc-sup" style={lbl}>Supplier</label>
                <select id="fc-sup" style={inp} value={form.supplier_id} onChange={e => set('supplier_id', e.target.value)}>
                  <option value="">Not in the supplier list</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}
                </select></div>
              <div><label htmlFor="fc-prov" style={lbl}>…or name</label>
                <input id="fc-prov" style={inp} disabled={!!form.supplier_id} value={form.provider_name} onChange={e => set('provider_name', e.target.value)} placeholder="e.g. Old Mutual Insurance" /></div>
              <div><label htmlFor="fc-ref" style={lbl}>Policy / contract number</label><input id="fc-ref" style={inp} value={form.reference} onChange={e => set('reference', e.target.value)} /></div>
              <div><label htmlFor="fc-desc" style={lbl}>What it covers</label><input id="fc-desc" style={inp} value={form.description} onChange={e => set('description', e.target.value)} /></div>
              <div><label htmlFor="fc-start" style={lbl}>Starts</label><input id="fc-start" type="date" style={inp} value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
              <div><label htmlFor="fc-end" style={lbl}>Ends / renews</label><input id="fc-end" type="date" style={inp} value={form.end_date} onChange={e => set('end_date', e.target.value)} /></div>
              <div><label htmlFor="fc-amt" style={lbl}>Cost (USD)</label><input id="fc-amt" type="number" step="0.01" style={inp} value={form.amount} onChange={e => set('amount', e.target.value)} /></div>
              <div><label htmlFor="fc-freq" style={lbl}>Paid</label>
                <select id="fc-freq" style={inp} value={form.frequency} onChange={e => set('frequency', e.target.value)}>{FREQ.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div><label htmlFor="fc-rem" style={lbl}>Remind this many days before</label><input id="fc-rem" type="number" style={inp} value={form.remind_days} onChange={e => set('remind_days', e.target.value)} /></div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginTop: 20 }}>
                <input type="checkbox" checked={form.auto_renews} onChange={e => set('auto_renews', e.target.checked)} /> Renews automatically</label>
              <div style={{ gridColumn: '1 / -1' }}><label htmlFor="fc-notes" style={lbl}>Notes</label><input id="fc-notes" style={inp} value={form.notes} onChange={e => set('notes', e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={btn2} onClick={() => setForm(null)}>Cancel</button>
              <button style={btn} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
