import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { friendlyError } from '../../utils/friendlyError'
import { exportCsv } from '../../utils/csv'
import FinShell from '../../components/FinShell'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'

// CL14 Vehicle usage (0269): daily km / hours per hired vehicle. Approving a day accrues its cost (Dr hired plant / Cr accruals)
// at the vehicle's km rate, else hourly, else daily rate — so the cost shows before the contractor's bill, and the bill is
// matched to these days in Pay Suppliers.
const today = () => new Date().toISOString().slice(0, 10)

export default function CLVehicleUsage({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [vehicles, setVehicles] = useState([])
  const [rows, setRows] = useState(null)
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('hired_vehicles').select('id, registration, description, daily_rate, hourly_rate, km_rate, status, contractor:contractors(name)')
      .eq('site_id', currentSiteId).eq('is_archived', false).order('registration').then(({ data }) => setVehicles(data || []))
  }, [currentSiteId])

  const load = useCallback(() => {
    if (!currentSiteId) return
    supabase.from('vehicle_usage_log').select('*').eq('site_id', currentSiteId).eq('is_archived', false).gte('usage_date', from)
      .order('usage_date', { ascending: false }).then(({ data, error }) => {
        if (error) showToast(friendlyError(error), 'error')
        setRows(data || [])
      })
  }, [currentSiteId, from])
  useEffect(() => { load() }, [load])

  const vmap = useMemo(() => Object.fromEntries(vehicles.map(v => [v.id, v])), [vehicles])
  const cost = r => {
    const v = vmap[r.vehicle_id]; if (!v) return 0
    if (Number(v.km_rate) > 0 && Number(r.km) > 0) return v.km_rate * r.km
    if (Number(v.hourly_rate) > 0 && Number(r.hours_worked) > 0) return v.hourly_rate * r.hours_worked
    return Number(v.daily_rate) || 0
  }
  const vname = v => v ? (v.registration || v.description) + (v.contractor?.name ? ` · ${v.contractor.name}` : '') : '—'

  async function save() {
    const { error } = await supabase.from('vehicle_usage_log').insert({
      site_id: currentSiteId, vehicle_id: form.vehicle_id, usage_date: form.usage_date,
      hours_worked: form.hours_worked === '' ? null : Number(form.hours_worked),
      km_start: form.km_start === '' ? null : Number(form.km_start), km_end: form.km_end === '' ? null : Number(form.km_end),
      driver_name: form.driver_name || null, task_description: form.task_description || null,
    })
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Day logged'); setForm(null); load()
  }
  async function approve(r) {
    const { error } = await supabase.from('vehicle_usage_log').update({ approved: true, approved_at: new Date().toISOString() })
      .eq('id', r.id).eq('site_id', currentSiteId)
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Approved — cost accrued'); load()
  }

  const total = (rows || []).filter(r => r.approved).reduce((s, r) => s + cost(r), 0)
  const v = form ? vmap[form.vehicle_id] : null
  return (
    <FinShell module="Contractors" homePage="cl_dashboard" setPage={setPage} title="Vehicle usage"
      subtitle="Daily km or hours for each hired vehicle. Approved days are costed straight away and matched to the bill later."
      actions={<>
        <button onClick={() => exportCsv('vehicle-usage.csv', ['Date', 'Vehicle', 'Hours', 'Km start', 'Km end', 'Km', 'Driver', 'Task', 'Approved', 'Cost'],
          (rows || []).map(r => [r.usage_date, vname(vmap[r.vehicle_id]), r.hours_worked ?? '', r.km_start ?? '', r.km_end ?? '', r.km ?? '', r.driver_name || '', r.task_description || '', r.approved ? 'Yes' : 'No', cost(r).toFixed(2)]))} style={finBtn2}>Download CSV</button>
        {(can('contractors.create') || can('contractors.edit')) && <button onClick={() => setForm({ vehicle_id: '', usage_date: today(), hours_worked: '', km_start: '', km_end: '', driver_name: '', task_description: '' })} style={finBtn}>Log a day</button>}
      </>}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, fontSize: 13, color: FIN.muted }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...finInput, minHeight: 34 }} /></label>
        <span>Approved cost in view: <b style={{ color: FIN.ink, fontVariantNumeric: 'tabular-nums' }}>${money(total)}</b></span>
      </div>

      {form && (
        <div style={{ ...finCard, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', marginBottom: 12 }}>
          <label style={lbl}>Vehicle<select value={form.vehicle_id} onChange={e => setForm({ ...form, vehicle_id: e.target.value })} style={finInput}>
            <option value="">Choose…</option>{vehicles.filter(x => x.status !== 'returned').map(x => <option key={x.id} value={x.id}>{vname(x)}</option>)}</select></label>
          <label style={lbl}>Date<input type="date" value={form.usage_date} onChange={e => setForm({ ...form, usage_date: e.target.value })} style={finInput} /></label>
          <label style={lbl}>Km start<input type="number" min="0" value={form.km_start} onChange={e => setForm({ ...form, km_start: e.target.value })} style={finInput} /></label>
          <label style={lbl}>Km end<input type="number" min="0" value={form.km_end} onChange={e => setForm({ ...form, km_end: e.target.value })} style={finInput} /></label>
          <label style={lbl}>Hours<input type="number" min="0" max="24" step="0.5" value={form.hours_worked} onChange={e => setForm({ ...form, hours_worked: e.target.value })} style={finInput} /></label>
          <label style={lbl}>Driver<input value={form.driver_name} onChange={e => setForm({ ...form, driver_name: e.target.value })} style={finInput} /></label>
          <label style={{ ...lbl, flex: '2 1 220px' }}>Work done<input value={form.task_description} onChange={e => setForm({ ...form, task_description: e.target.value })} style={finInput} /></label>
          {v && <div style={{ fontSize: 12, color: Number(v.km_rate) || Number(v.hourly_rate) || Number(v.daily_rate) ? FIN.muted : FIN.bad, flexBasis: '100%' }}>
            {Number(v.km_rate) || Number(v.hourly_rate) || Number(v.daily_rate)
              ? `Rates: ${v.km_rate ? '$' + v.km_rate + '/km ' : ''}${v.hourly_rate ? '$' + v.hourly_rate + '/h ' : ''}${v.daily_rate ? '$' + v.daily_rate + '/day' : ''}`
              : 'This vehicle has no rate on its hire record, so approved days will cost $0. Add the rate under Hired vehicles.'}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setForm(null)} style={finBtn2}>Cancel</button>
            <button onClick={save} disabled={!form.vehicle_id || !form.usage_date} style={finBtn}>Save</button>
          </div>
        </div>
      )}

      <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{['Date', 'Vehicle', 'Km', 'Hours', 'Driver', 'Work done', 'Cost', ''].map((h, i) => <th key={i} style={{ ...th, textAlign: [2, 3, 6].includes(i) ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
          <tbody>
            {!rows ? <tr><td colSpan={8} style={td}>Loading…</td></tr> : rows.length === 0 ? <tr><td colSpan={8} style={{ ...td, color: FIN.muted }}>No days logged in this period.</td></tr> :
              rows.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${FIN.line}` }}>
                  <td style={td}>{r.usage_date}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{vname(vmap[r.vehicle_id])}</td>
                  <td style={tdn}>{r.km ?? '—'}</td>
                  <td style={tdn}>{r.hours_worked ?? '—'}</td>
                  <td style={td}>{r.driver_name || '—'}</td>
                  <td style={td}>{r.task_description || '—'}</td>
                  <td style={tdn}>${money(cost(r))}</td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>{r.approved
                    ? <span style={{ color: FIN.good }}>Approved</span>
                    : can('contractors.edit') ? <button onClick={() => approve(r)} style={{ ...finBtn2, minHeight: 32, fontSize: 12 }}>Approve</button> : <span style={{ color: FIN.faint }}>Waiting</span>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </FinShell>
  )
}
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: FIN.muted, flex: '1 1 130px' }
const th = { padding: '10px 12px', fontSize: 11, color: FIN.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const td = { padding: '10px 12px' }
const tdn = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
