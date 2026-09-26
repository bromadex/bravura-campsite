import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import Denied from '../../components/Denied'

// FU22 — Allowances & recharges (issue #72, F4), the fuel manager's screen.
//  Allowances  — litres per machine or department per week / month (fuel_allowance_save / _list); alerts at 80/90/100%.
//  Recharges   — fills for hired plant whose contract says the contractor pays; mark as deducted on their bill (or waived).

const COLOR = MODULE_COLORS.fuel
const n0 = v => v == null ? '—' : Math.round(Number(v)).toLocaleString()
const money = v => v == null ? '—' : '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const input = { padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: 13, fontFamily: 'inherit' }
const btn = (bg = COLOR, fg = '#fff') => ({ border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, fontSize: 12, padding: '7px 12px', background: bg, color: fg })
const th = { textAlign: 'left', padding: '8px 10px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}` }
const td = { padding: '8px 10px', fontSize: 13, color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}` }
const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const box = { overflowX: 'auto', background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outlineVar}` }

function Allowances({ siteId, can }) {
  const [rows, setRows] = useState(null)
  const [machines, setMachines] = useState([])
  const [depts, setDepts] = useState([])
  const [f, setF] = useState({ kind: 'machine', target: '', period: 'week', litres: '' })
  const load = useCallback(() => {
    supabase.rpc('fuel_allowance_list', { p_site: siteId }).then(({ data, error }) => setRows(error ? [] : data || []))
  }, [siteId])
  useEffect(() => {
    load()
    supabase.from('fleet_assets').select('id, fleet_number, registration, description').eq('site_id', siteId).eq('is_archived', false).order('fleet_number')
      .then(({ data }) => setMachines(data || []))
    supabase.from('departments').select('id, name').eq('site_id', siteId).eq('is_archived', false).order('name').then(({ data }) => setDepts(data || []))
  }, [siteId, load])

  const add = async () => {
    if (!f.target || !(Number(f.litres) > 0)) return alert('Choose who and enter the litres')
    const { error } = await supabase.rpc('fuel_allowance_save', { p: { site_id: siteId, period: f.period, litres: Number(f.litres),
      fleet_asset_id: f.kind === 'machine' ? f.target : '', department_id: f.kind === 'department' ? f.target : '' } })
    if (error) return alert(error.message)
    setF({ ...f, target: '', litres: '' }); load()
  }
  const edit = async r => {
    const l = window.prompt(`Litres per ${r.period} for ${r.target}`, r.litres)
    if (l == null) return
    const { error } = await supabase.rpc('fuel_allowance_save', { p: { id: r.id, site_id: siteId, period: r.period, litres: Number(l), notes: r.notes || '' } })
    if (error) alert(error.message); else load()
  }
  const toggle = async r => {
    const { error } = await supabase.rpc('fuel_allowance_save', { p: { id: r.id, site_id: siteId, period: r.period, litres: r.litres, notes: r.notes || '', is_active: !r.is_active } })
    if (error) alert(error.message); else load()
  }

  return (
    <div>
      {can('fuel.approve') && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: 12, background: THEME.surface, borderRadius: 10 }}>
          <b style={{ fontSize: 13 }}>New allowance</b>
          <select id="al-kind" value={f.kind} onChange={e => setF({ ...f, kind: e.target.value, target: '' })} style={input}>
            <option value="machine">Machine</option><option value="department">Department</option>
          </select>
          <select id="al-target" value={f.target} onChange={e => setF({ ...f, target: e.target.value })} style={{ ...input, minWidth: 200 }}>
            <option value="">Choose…</option>
            {(f.kind === 'machine' ? machines.map(m => [m.id, [m.fleet_number, m.registration, m.description].filter(Boolean).join(' · ')]) : depts.map(d => [d.id, d.name]))
              .map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <input id="al-litres" type="number" placeholder="Litres" value={f.litres} onChange={e => setF({ ...f, litres: e.target.value })} style={{ ...input, width: 100 }} />
          <select id="al-period" value={f.period} onChange={e => setF({ ...f, period: e.target.value })} style={input}>
            <option value="week">per week</option><option value="month">per month</option>
          </select>
          <button style={btn()} onClick={add}>Add</button>
        </div>
      )}
      {rows == null ? <div style={{ color: THEME.textMed }}>Loading…</div> : !rows.length ? (
        <div style={{ padding: 24, textAlign: 'center', color: THEME.textMed, background: THEME.surface, borderRadius: 10 }}>No allowances yet.</div>
      ) : (
        <div style={box}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>For</th><th style={th}>Period</th><th style={{ ...th, textAlign: 'right' }}>Allowance (L)</th><th style={{ ...th, textAlign: 'right' }}>Used (L)</th><th style={th}>Used</th><th style={th}></th></tr></thead>
          <tbody>{rows.map(r => {
            const c = r.pct >= 100 ? THEME.error : r.pct >= 80 ? THEME.warning : COLOR
            return (
              <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.5 }}>
                <td style={td}>{r.target}<div style={{ fontSize: 11, color: THEME.textLow }}>{r.kind}</div></td>
                <td style={td}>{r.period === 'week' ? 'This week' : 'This month'}</td>
                <td style={num}>{n0(r.litres)}</td><td style={num}>{n0(r.used)}</td>
                <td style={{ ...td, minWidth: 140 }}>
                  <div style={{ height: 8, background: THEME.surfaceVar, borderRadius: 4 }}><div style={{ width: `${Math.min(100, r.pct || 0)}%`, height: '100%', borderRadius: 4, background: c }} /></div>
                  <div style={{ fontSize: 11, color: c, marginTop: 2 }}>{r.pct ?? 0}%</div>
                </td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{can('fuel.approve') && <>
                  <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => edit(r)}>Change</button>{' '}
                  <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => toggle(r)}>{r.is_active ? 'Stop' : 'Restart'}</button></>}</td>
              </tr>
            )
          })}</tbody>
        </table></div>
      )}
    </div>
  )
}

function Recharges({ siteId, can }) {
  const [status, setStatus] = useState('pending')
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState([])
  const load = useCallback(() => {
    setSel([])
    supabase.rpc('fuel_recharge_list', { p_site: siteId, p_status: status || null }).then(({ data, error }) => setRows(error ? [] : data || []))
  }, [siteId, status])
  useEffect(() => { load() }, [load])

  const mark = async st => {
    const ref = window.prompt(st === 'deducted' ? 'Bill number the fuel was deducted on' : 'Why is this not charged back?')
    if (!ref) return
    const { error } = await supabase.rpc('fuel_recharge_mark', { p_ids: sel, p_status: st, p_ref: ref })
    if (error) alert(error.message); else load()
  }
  const byContractor = {}
  ;(rows || []).forEach(r => { const k = r.contractor || '—'; byContractor[k] = byContractor[k] || { l: 0, v: 0 }; byContractor[k].l += Number(r.litres || 0); byContractor[k].v += Number(r.value || 0) })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select id="rc-status" value={status} onChange={e => setStatus(e.target.value)} style={input}>
          <option value="pending">To charge back</option><option value="deducted">Deducted</option><option value="waived">Waived</option><option value="">All</option>
        </select>
        {Object.entries(byContractor).map(([c, t]) => <span key={c} style={{ fontSize: 13, color: THEME.textMed }}><b style={{ color: THEME.text }}>{c}</b> {n0(t.l)} L · {money(t.v)}</span>)}
        {(can('fuel.approve') || can('finance.approve')) && sel.length > 0 && <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={btn()} onClick={() => mark('deducted')}>Deducted on bill ({sel.length})</button>
          <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => mark('waived')}>Waive</button></span>}
      </div>
      {rows == null ? <div style={{ color: THEME.textMed }}>Loading…</div> : !rows.length ? (
        <div style={{ padding: 24, textAlign: 'center', color: THEME.textMed, background: THEME.surface, borderRadius: 10 }}>
          Nothing here. Fills are charged back when the hire contract (Contractors → hired vehicles / equipment) says the contractor pays for fuel.</div>
      ) : (
        <div style={box}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}></th><th style={th}>Date</th><th style={th}>Fill</th><th style={th}>Contractor</th><th style={th}>Machine</th>
            <th style={{ ...th, textAlign: 'right' }}>Litres</th><th style={{ ...th, textAlign: 'right' }}>Value</th><th style={th}>State</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id}>
              <td style={td}><input type="checkbox" checked={sel.includes(r.id)} onChange={e => setSel(s => e.target.checked ? [...s, r.id] : s.filter(x => x !== r.id))} /></td>
              <td style={td}>{r.transaction_date}</td><td style={td}>{r.transaction_number}</td><td style={td}>{r.contractor}</td><td style={td}>{r.machine}</td>
              <td style={num}>{n0(r.litres)}</td><td style={num}>{money(r.value)}</td>
              <td style={td}>{r.status}{r.ref ? ` · ${r.ref}` : ''}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  )
}

const TABS = [['allow', 'Allowances', Allowances], ['recharge', 'Hired plant recharges', Recharges]]

export default function FuelAllowances() {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const [tab, setTab] = useState('allow')
  if (!can('fuel.view') && !can('fuel.create')) return <Denied />
  if (!currentSite?.id) return null
  const Comp = TABS.find(t => t[0] === tab)[2]
  return (
    <div>
      <h2 style={{ margin: '4px 0 2px', fontSize: 22, color: THEME.text }}>Allowances & recharges</h2>
      <div style={{ fontSize: 13, color: THEME.textMed, marginBottom: 12 }}>Fuel limits per machine or department, and hired-plant fuel to charge back.</div>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${THEME.outlineVar}`, marginBottom: 14 }}>
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          padding: '8px 14px', color: tab === k ? COLOR : THEME.textMed, borderBottom: `2px solid ${tab === k ? COLOR : 'transparent'}` }}>{l}</button>)}
      </div>
      <Comp siteId={currentSite.id} can={can} />
    </div>
  )
}
