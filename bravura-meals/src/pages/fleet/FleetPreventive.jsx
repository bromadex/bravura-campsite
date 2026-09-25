import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { Card, Button, Icon, Modal, PageHeader, showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.fleet
const inp = { width: '100%', minHeight: '40px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', border: `1px solid ${THEME.outlineVar}`,
  background: THEME.surface, color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box' }
const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }
const th = { padding: '8px 10px', textAlign: 'left', whiteSpace: 'nowrap' }
const td = { padding: '8px 10px' }
const tdn = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const STATE = {
  overdue:  { label: 'Overdue',  fg: THEME.statusErrorText,   bg: THEME.statusErrorBg },
  due_soon: { label: 'Due soon', fg: THEME.statusWarningText, bg: THEME.statusWarningBg },
  ok:       { label: 'OK',       fg: THEME.statusSuccessText, bg: THEME.statusSuccessBg },
}
const num = n => n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

export default function FleetPreventive({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const [tab, setTab] = useState('due')
  const [due, setDue] = useState(null)
  const [plans, setPlans] = useState([])
  const [assets, setAssets] = useState([])
  const [types, setTypes] = useState([])
  const [down, setDown] = useState(null)
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0, 10) })
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10))
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const [d, p, a, t] = await Promise.all([
      supabase.rpc('fleet_pm_due', { p_site_id: currentSiteId }),
      supabase.from('fleet_pm_plans').select('*, asset:fleet_assets(fleet_number, asset_number, make, model), type:fleet_asset_types(name)')
        .eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
      supabase.from('fleet_assets').select('id, fleet_number, asset_number, make, model, registration').eq('site_id', currentSiteId).eq('is_archived', false).order('asset_number'),
      supabase.from('fleet_asset_types').select('id, name').eq('is_active', true).order('sort_order'),
    ])
    if (d.error) showToast(d.error.message, 'red')
    setDue(d.data || []); setPlans(p.data || []); setAssets(a.data || []); setTypes(t.data || [])
  }, [currentSiteId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!currentSiteId || tab !== 'downtime') return
    setDown(null)
    supabase.rpc('fleet_downtime', { p_site_id: currentSiteId, p_from: from, p_to: to }).then(({ data, error }) => { if (error) showToast(error.message, 'red'); setDown(data || []) })
  }, [currentSiteId, tab, from, to])

  async function generate() {
    setBusy(true)
    const { data: n, error } = await supabase.rpc('fleet_pm_generate', { p_site_id: currentSiteId })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(n ? `${n} work order${n > 1 ? 's' : ''} created` : 'Everything due already has a work order', 'green'); load()
  }
  async function createOne(r) {
    const { error } = await supabase.rpc('fleet_pm_create_wo', { p_asset_id: r.asset_id, p_plan_id: r.plan_id })
    if (error) { showToast(error.message, 'red'); return }
    showToast('Work order created', 'green'); load()
  }
  async function markDone(r) {
    if (!window.confirm(`Record "${r.plan_name}" as done today on ${r.asset_label} at its current reading?`)) return
    const { error } = await supabase.rpc('fleet_pm_record_done', { p_asset_id: r.asset_id, p_plan_id: r.plan_id, p_date: null, p_km: null, p_hours: null })
    if (error) { showToast(error.message, 'red'); return }
    load()
  }
  async function savePlan() {
    if (!form.name?.trim()) { showToast('Name the plan', 'red'); return }
    if (!form.asset_id && !form.asset_type_id) { showToast('Choose an asset or an asset type', 'red'); return }
    if (!form.interval_km && !form.interval_hours && !form.interval_days) { showToast('Set at least one interval', 'red'); return }
    setBusy(true)
    const { error } = await supabase.from('fleet_pm_plans').insert({
      site_id: currentSiteId, name: form.name.trim(), asset_id: form.asset_id || null, asset_type_id: form.asset_id ? null : form.asset_type_id || null,
      interval_km: Number(form.interval_km) || null, interval_hours: Number(form.interval_hours) || null, interval_days: Number(form.interval_days) || null,
      tasks: form.tasks || null, estimated_cost: Number(form.estimated_cost) || null, created_by: profile?.id,
    })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    setModal(false); load()
  }
  async function archivePlan(p) {
    if (!window.confirm(`Stop the "${p.name}" plan?`)) return
    const { error } = await supabase.from('fleet_pm_plans').update({ is_archived: true }).eq('id', p.id)
    if (error) { showToast(error.message, 'red'); return }
    load()
  }

  const tabBtn = k => ({ minHeight: '40px', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', fontWeight: 600,
    border: `1px solid ${tab === k ? ACCENT : THEME.outline}`, background: tab === k ? ACCENT : THEME.surface, color: tab === k ? '#fff' : THEME.textMed })
  const overdue = (due || []).filter(d => d.state === 'overdue').length
  const soon = (due || []).filter(d => d.state === 'due_soon').length
  const totalDown = (down || []).reduce((s, r) => s + Number(r.hours_down), 0)
  const fleetAvail = down?.length ? down.reduce((s, r) => s + Number(r.availability_pct ?? 100), 0) / down.length : null

  return (
    <div>
      <PageHeader title="Preventive Maintenance & Downtime" />
      <div role="tablist" style={{ display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <button role="tab" aria-selected={tab === 'due'} style={tabBtn('due')} onClick={() => setTab('due')}>Due{overdue + soon ? ` (${overdue + soon})` : ''}</button>
        <button role="tab" aria-selected={tab === 'plans'} style={tabBtn('plans')} onClick={() => setTab('plans')}>Service plans</button>
        <button role="tab" aria-selected={tab === 'downtime'} style={tabBtn('downtime')} onClick={() => setTab('downtime')}>Downtime</button>
      </div>

      {tab === 'due' && (
        <>
          <Card style={{ padding: '12px 14px', marginBottom: '12px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '14px', color: THEME.text }}><b style={{ color: THEME.error }}>{overdue}</b> overdue · <b style={{ color: THEME.statusWarningText }}>{soon}</b> due soon</span>
            <span style={{ fontSize: '12px', color: THEME.textLow, flex: '1 1 240px' }}>Measured by km, engine hours or days since the last service — whichever comes first. Completing a PM work order resets the plan.</span>
            {can('fleet.create') && <Button icon="build" onClick={generate} disabled={busy || !(overdue + soon)}>Create work orders for all due</Button>}
          </Card>
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            {!due ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : due.length === 0 ? (
              <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No service plans yet. Add one under Service plans.</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '860px' }}>
                <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed }}>
                  <th style={th}>Asset</th><th style={th}>Service</th><th style={th}>Status</th><th style={{ ...th, textAlign: 'right' }}>Now</th>
                  <th style={{ ...th, textAlign: 'right' }}>Next due</th><th style={th}>Used</th><th style={th}></th></tr></thead>
                <tbody>{due.map(r => {
                  const s = STATE[r.state]
                  return (
                    <tr key={r.asset_id + r.plan_id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                      <td style={td}>{r.asset_label}</td><td style={td}>{r.plan_name}</td>
                      <td style={td}><span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: s.bg, color: s.fg }}>{s.label}</span></td>
                      <td style={tdn}>{r.next_km != null ? `${num(r.current_km)} km` : ''}{r.next_hours != null ? ` ${num(r.current_hours)} h` : ''}</td>
                      <td style={tdn}>{[r.next_km != null && `${num(r.next_km)} km`, r.next_hours != null && `${num(r.next_hours)} h`, r.next_date].filter(Boolean).join(' · ')}</td>
                      <td style={{ ...td, minWidth: '110px' }}>
                        <div style={{ height: '8px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(100, Number(r.pct_used))}%`, height: '100%', background: s.fg }} />
                        </div>
                        <div style={{ fontSize: '11px', color: THEME.textLow }}>{r.pct_used}%</div>
                      </td>
                      <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {r.open_wo_id ? <button onClick={() => setPage?.('fleet_maintenance')} style={{ background: 'none', border: 'none', color: ACCENT, cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px' }}>{r.open_wo_number}</button>
                          : can('fleet.create') && r.state !== 'ok' && <Button size="sm" onClick={() => createOne(r)}>Work order</Button>}
                        {can('fleet.edit') && <button onClick={() => markDone(r)} title="Record as done now" aria-label="Record as done now" style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, padding: '6px' }}><Icon name="task_alt" size={18} /></button>}
                      </td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </Card>
        </>
      )}

      {tab === 'plans' && (
        <>
          {can('fleet.edit') && <div style={{ marginBottom: '12px' }}><Button icon="add" onClick={() => { setForm({}); setModal(true) }}>Add service plan</Button></div>}
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {plans.length === 0 ? <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No plans yet — e.g. "A-service every 10,000 km or 250 hours or 180 days" for all LDVs.</div>
              : plans.map((p, i) => (
                <div key={p.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 240px' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{p.name}</div>
                    <div style={{ fontSize: '12px', color: THEME.textMed }}>
                      {p.asset ? `${p.asset.fleet_number || p.asset.asset_number} ${p.asset.make || ''} ${p.asset.model || ''}` : `All ${p.type?.name || 'assets of this type'}`}
                      {' · every '}{[p.interval_km && `${num(p.interval_km)} km`, p.interval_hours && `${num(p.interval_hours)} h`, p.interval_days && `${p.interval_days} days`].filter(Boolean).join(' or ')}
                    </div>
                    {p.tasks && <div style={{ fontSize: '12px', color: THEME.textLow }}>{p.tasks}</div>}
                  </div>
                  {can('fleet.edit') && <button onClick={() => archivePlan(p)} aria-label={`Stop ${p.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="close" size={18} /></button>}
                </div>
              ))}
          </Card>
        </>
      )}

      {tab === 'downtime' && (
        <>
          <Card style={{ padding: '12px 14px', marginBottom: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="dt-from" style={{ fontSize: '13px', color: THEME.textMed }}>From</label>
            <input id="dt-from" type="date" style={{ ...inp, width: 'auto' }} value={from} onChange={e => e.target.value && setFrom(e.target.value)} />
            <label htmlFor="dt-to" style={{ fontSize: '13px', color: THEME.textMed }}>to</label>
            <input id="dt-to" type="date" style={{ ...inp, width: 'auto' }} value={to} onChange={e => e.target.value && setTo(e.target.value)} />
            <span style={{ fontSize: '14px', color: THEME.text, marginLeft: 'auto' }}>
              {down && <>Fleet availability <b>{fleetAvail != null ? `${fleetAvail.toFixed(1)}%` : '—'}</b> · <b>{num(totalDown)}</b> hours down</>}
            </span>
            {down?.length > 0 && <Button variant="outlined" icon="download" onClick={() => exportCsv(`fleet_downtime_${from}_${to}.csv`,
              ['Asset', 'Status now', 'Hours down', 'Maintenance h', 'Grounded h', 'Awaiting parts h', 'Breakdowns', 'MTTR h', 'MTBF h', 'Availability %'],
              down.map(r => [r.asset_label, r.status_now, r.hours_down, r.hours_maintenance, r.hours_grounded, r.hours_awaiting_parts, r.failures, r.mttr_hours, r.mtbf_hours, r.availability_pct]))}>CSV</Button>}
          </Card>
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            {!down ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '820px' }}>
                <thead><tr style={{ background: THEME.surfaceVar, color: THEME.textMed }}>
                  <th style={th}>Asset</th><th style={{ ...th, textAlign: 'right' }}>Availability</th><th style={{ ...th, textAlign: 'right' }}>Hours down</th>
                  <th style={th}>Why</th><th style={{ ...th, textAlign: 'right' }}>Times down</th><th style={{ ...th, textAlign: 'right' }}>MTTR</th><th style={{ ...th, textAlign: 'right' }}>MTBF</th></tr></thead>
                <tbody>{down.map(r => {
                  const a = r.availability_pct == null ? null : Number(r.availability_pct)
                  const parts = [['Maintenance', r.hours_maintenance, THEME.statusWarningText], ['Grounded', r.hours_grounded, THEME.error], ['Awaiting parts', r.hours_awaiting_parts, THEME.statusInfoText || THEME.textMed]]
                  return (
                    <tr key={r.asset_id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                      <td style={td}>{r.asset_label}</td>
                      <td style={{ ...tdn, fontWeight: 700, color: a == null ? THEME.textLow : a >= 95 ? THEME.statusSuccessText : a >= 85 ? THEME.statusWarningText : THEME.error }}>{a == null ? '—' : `${a.toFixed(1)}%`}</td>
                      <td style={tdn}>{num(r.hours_down)}</td>
                      <td style={{ ...td, minWidth: '160px' }}>
                        {Number(r.hours_down) > 0 ? (
                          <div style={{ display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: THEME.surfaceVar }} title={parts.map(([l, h]) => `${l}: ${num(h)} h`).join(' · ')}>
                            {parts.map(([l, h, c]) => Number(h) > 0 && <div key={l} style={{ width: `${Number(h) / Number(r.hours_down) * 100}%`, background: c }} />)}
                          </div>
                        ) : <span style={{ color: THEME.textLow }}>—</span>}
                      </td>
                      <td style={tdn}>{r.failures}</td>
                      <td style={tdn}>{r.mttr_hours != null ? `${num(r.mttr_hours)} h` : '—'}</td>
                      <td style={tdn}>{r.mtbf_hours != null ? `${num(r.mtbf_hours)} h` : '—'}</td>
                    </tr>
                  )
                })}</tbody>
              </table>
            )}
          </Card>
          <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '8px' }}>
            Down = time in Maintenance, Grounded or Awaiting parts, from each asset's status history (recorded automatically from now on).
            MTTR = average hours down per breakdown; MTBF = average hours running between breakdowns.
            Bar colours: <span style={{ color: THEME.statusWarningText }}>maintenance</span>, <span style={{ color: THEME.error }}>grounded</span>, awaiting parts.
          </div>
        </>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="Add service plan" maxWidth={560}
        footer={<><Button variant="text" onClick={() => setModal(false)}>Cancel</Button><Button onClick={savePlan} disabled={busy}>Save plan</Button></>}>
        <div style={{ display: 'grid', gap: '12px' }}>
          <div><label htmlFor="pm-name" style={lbl}>Name</label><input id="pm-name" style={inp} placeholder="e.g. A-service" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div><label htmlFor="pm-type" style={lbl}>For all assets of type</label>
              <select id="pm-type" style={inp} value={form.asset_type_id || ''} disabled={!!form.asset_id} onChange={e => setForm({ ...form, asset_type_id: e.target.value })}>
                <option value="">—</option>{types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
            <div><label htmlFor="pm-asset" style={lbl}>…or one asset</label>
              <select id="pm-asset" style={inp} value={form.asset_id || ''} onChange={e => setForm({ ...form, asset_id: e.target.value })}>
                <option value="">—</option>{assets.map(a => <option key={a.id} value={a.id}>{a.fleet_number || a.asset_number} {a.make} {a.model}</option>)}</select></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
            <div><label htmlFor="pm-km" style={lbl}>Every … km</label><input id="pm-km" type="number" style={inp} value={form.interval_km || ''} onChange={e => setForm({ ...form, interval_km: e.target.value })} /></div>
            <div><label htmlFor="pm-hr" style={lbl}>… engine hours</label><input id="pm-hr" type="number" style={inp} value={form.interval_hours || ''} onChange={e => setForm({ ...form, interval_hours: e.target.value })} /></div>
            <div><label htmlFor="pm-days" style={lbl}>… days</label><input id="pm-days" type="number" style={inp} value={form.interval_days || ''} onChange={e => setForm({ ...form, interval_days: e.target.value })} /></div>
          </div>
          <div><label htmlFor="pm-tasks" style={lbl}>Tasks (copied onto the work order)</label><input id="pm-tasks" style={inp} placeholder="Oil & filter, grease, brakes check…" value={form.tasks || ''} onChange={e => setForm({ ...form, tasks: e.target.value })} /></div>
          <div><label htmlFor="pm-cost" style={lbl}>Estimated cost (USD)</label><input id="pm-cost" type="number" step="0.01" style={inp} value={form.estimated_cost || ''} onChange={e => setForm({ ...form, estimated_cost: e.target.value })} /></div>
        </div>
      </Modal>
    </div>
  )
}
