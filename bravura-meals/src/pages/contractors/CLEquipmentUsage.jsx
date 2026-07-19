import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { KpiCard, DashCard, SectionTitle } from '../../components/dash'
import QuickNav, { CONTRACTOR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.contractors

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const EMPTY_FORM = {
  equipment_id: '', usage_date: '', hours_worked: '', operator_name: '',
  task_description: '', location: '', fuel_litres: '', downtime_hours: '', notes: '',
}

export default function CLEquipmentUsage({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('equipment_usage_log', { column: 'site_id', value: currentSiteId }, fetchLogs)

  const [logs, setLogs] = useState([])
  const [equipment, setEquipment] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterEquip, setFilterEquip] = useState('')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('log')

  async function fetchLogs() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error: err } = await supabase
      .from('equipment_usage_log')
      .select('*, equipment:hired_equipment(id, description, contractor_id, hourly_rate, daily_rate, contractor:contractors(id, name))')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .gte('usage_date', dateFrom)
      .lte('usage_date', dateTo)
      .order('usage_date', { ascending: false })
    if (!err) setLogs(data || [])
    else showToast(err.message, 'red')
    setLoading(false)
  }

  const [fuelTxns, setFuelTxns] = useState([])
  const [fleetTrips, setFleetTrips] = useState([])

  async function fetchEquipment() {
    if (!currentSiteId) return
    const { data } = await supabase
      .from('hired_equipment')
      .select('id, description, serial_number, hourly_rate, daily_rate, fleet_asset_id, fuel_included, contractor:contractors(id, name)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .eq('status', 'active')
      .order('description')
    setEquipment(data || [])
  }

  async function fetchLinkedData() {
    if (!currentSiteId || !equipment.length) return
    const assetIds = equipment.filter(e => e.fleet_asset_id).map(e => e.fleet_asset_id)
    if (!assetIds.length) return

    const [fuelRes, tripRes] = await Promise.all([
      supabase.from('fuel_transactions')
        .select('id, transaction_date, equipment_id, litres, total_cost, docket_number, notes')
        .eq('site_id', currentSiteId)
        .in('equipment_id', assetIds)
        .gte('transaction_date', dateFrom)
        .lte('transaction_date', dateTo)
        .order('transaction_date', { ascending: false }),
      supabase.from('fleet_trips')
        .select('id, trip_date, asset_id, operator_id, start_hours, end_hours, operating_hours, purpose, destination')
        .eq('site_id', currentSiteId)
        .in('asset_id', assetIds)
        .gte('trip_date', dateFrom)
        .lte('trip_date', dateTo)
        .order('trip_date', { ascending: false }),
    ])
    setFuelTxns(fuelRes.data || [])
    setFleetTrips(tripRes.data || [])
  }

  useEffect(() => { fetchLogs(); fetchEquipment() }, [currentSiteId, dateFrom, dateTo])
  useEffect(() => { fetchLinkedData() }, [equipment, dateFrom, dateTo])

  const filtered = useMemo(() => {
    let list = logs
    if (filterEquip) list = list.filter(l => l.equipment_id === filterEquip)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(l =>
        (l.equipment?.description || '').toLowerCase().includes(q) ||
        (l.operator_name || '').toLowerCase().includes(q) ||
        (l.task_description || '').toLowerCase().includes(q) ||
        (l.equipment?.contractor?.name || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [logs, filterEquip, search])

  const assetToEquipMap = useMemo(() => {
    const m = {}
    equipment.forEach(e => { if (e.fleet_asset_id) m[e.fleet_asset_id] = e.id })
    return m
  }, [equipment])

  const costSummary = useMemo(() => {
    const byEquip = {}
    const initEquip = (eid, desc, contractor, hourlyRate, dailyRate) => {
      if (!byEquip[eid]) byEquip[eid] = {
        id: eid, description: desc, contractor,
        hourlyRate, dailyRate,
        totalHours: 0, totalDowntime: 0, totalFuelLitres: 0,
        fuelCost: 0, tripHours: 0, days: 0, hireCost: 0,
      }
    }
    filtered.forEach(l => {
      const eid = l.equipment_id
      initEquip(eid, l.equipment?.description || '-', l.equipment?.contractor?.name || '-',
        Number(l.equipment?.hourly_rate || 0), Number(l.equipment?.daily_rate || 0))
      const hrs = Number(l.hours_worked || 0)
      byEquip[eid].totalHours += hrs
      byEquip[eid].totalDowntime += Number(l.downtime_hours || 0)
      byEquip[eid].totalFuelLitres += Number(l.fuel_litres || 0)
      byEquip[eid].days += 1
      const rate = byEquip[eid].hourlyRate
      byEquip[eid].hireCost += rate > 0 ? hrs * rate : byEquip[eid].dailyRate
    })
    fuelTxns.forEach(ft => {
      const eid = assetToEquipMap[ft.equipment_id]
      if (!eid) return
      if (byEquip[eid]) byEquip[eid].fuelCost += Number(ft.total_cost || 0)
    })
    fleetTrips.forEach(tr => {
      const eid = assetToEquipMap[tr.asset_id]
      if (!eid) return
      if (byEquip[eid]) byEquip[eid].tripHours += Number(tr.operating_hours || 0)
    })
    return Object.values(byEquip).map(r => ({
      ...r, totalCost: r.hireCost + r.fuelCost,
    })).sort((a, b) => b.totalCost - a.totalCost)
  }, [filtered, fuelTxns, fleetTrips, assetToEquipMap])

  const kpis = useMemo(() => ({
    totalHours: filtered.reduce((s, l) => s + Number(l.hours_worked || 0), 0),
    totalCost: costSummary.reduce((s, e) => s + e.totalCost, 0),
    fuelCost: costSummary.reduce((s, e) => s + e.fuelCost, 0),
    entries: filtered.length,
    avgHoursPerDay: filtered.length > 0 ? (filtered.reduce((s, l) => s + Number(l.hours_worked || 0), 0) / filtered.length).toFixed(1) : '0',
    totalDowntime: filtered.reduce((s, l) => s + Number(l.downtime_hours || 0), 0),
    fuelTxnCount: fuelTxns.length,
    tripCount: fleetTrips.length,
  }), [filtered, costSummary, fuelTxns, fleetTrips])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM, usage_date: new Date().toISOString().slice(0, 10) })
    setError('')
    setModalOpen(true)
  }

  function openEdit(log) {
    setEditId(log.id)
    const f = {}
    for (const k of Object.keys(EMPTY_FORM)) f[k] = log[k] ?? EMPTY_FORM[k]
    setForm(f)
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.equipment_id || !form.usage_date || !form.hours_worked) {
      setError('Equipment, date and hours are required')
      return
    }
    const hrs = parseFloat(form.hours_worked)
    if (isNaN(hrs) || hrs < 0 || hrs > 24) {
      setError('Hours must be between 0 and 24')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        equipment_id: form.equipment_id,
        usage_date: form.usage_date,
        hours_worked: hrs,
        operator_name: form.operator_name || null,
        task_description: form.task_description || null,
        location: form.location || null,
        fuel_litres: form.fuel_litres ? parseFloat(form.fuel_litres) : null,
        downtime_hours: form.downtime_hours ? parseFloat(form.downtime_hours) : 0,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('equipment_usage_log').update(payload).eq('id', editId)
        if (err) throw err
        showToast('Usage log updated', 'green')
      } else {
        const { error: err } = await supabase.from('equipment_usage_log').insert(payload)
        if (err) throw err
        showToast('Usage log added', 'green')
      }
      await fetchLogs()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove(id) {
    try {
      const { error: err } = await supabase.from('equipment_usage_log').update({
        approved: true, approved_at: new Date().toISOString(),
      }).eq('id', id)
      if (err) throw err
      showToast('Usage approved', 'green')
      await fetchLogs()
    } catch (err) {
      showToast(err.message, 'red')
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this usage entry?')) return
    try {
      const { error: err } = await supabase.from('equipment_usage_log').update({ is_archived: true, archived_at: new Date().toISOString() }).eq('id', editId)
      if (err) throw err
      showToast('Entry archived', 'green')
      await fetchLogs()
      setModalOpen(false)
    } catch (err) {
      showToast(err.message, 'red')
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }
  const th = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textLow, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }
  const td = { padding: '10px 12px', fontSize: '13px', color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}` }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <QuickNav pills={CONTRACTOR_PILLS} setPage={setPage} current="cl_equipment_usage" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Equipment Usage & Costing</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>Track hours, calculate costs, approve usage</div>
        </div>
        {can('contractors.create') && (
          <button onClick={openAdd} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
            Log Usage
          </button>
        )}
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <KpiCard label="Total Hours" value={kpis.totalHours.toFixed(1)} icon="schedule" accent={color} />
        <KpiCard label="Hire Cost" value={fmtMoney(kpis.totalCost - kpis.fuelCost)} icon="payments" accent="#2E7D32" />
        <KpiCard label="Fuel Cost" value={fmtMoney(kpis.fuelCost)} icon="local_gas_station" accent="#E65100" sub={`${kpis.fuelTxnCount} transactions`} />
        <KpiCard label="Total Cost" value={fmtMoney(kpis.totalCost)} icon="account_balance" accent="#C62828" />
        <KpiCard label="Fleet Trips" value={kpis.tripCount} icon="route" accent="#1565C0" />
        <KpiCard label="Downtime" value={`${kpis.totalDowntime.toFixed(1)}h`} icon="pause_circle" accent="#6A1B9A" />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
        {[{ id: 'log', label: 'Usage Log', icon: 'list_alt' }, { id: 'costing', label: 'Cost Summary', icon: 'payments' }, { id: 'linked', label: 'Fuel & Trips', icon: 'link' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: tab === t.id ? color : THEME.surfaceVar,
            color: tab === t.id ? '#fff' : THEME.textMed,
            border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ ...inp, width: 'auto' }} />
        <span style={{ color: THEME.textLow, fontSize: '12px' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ ...inp, width: 'auto' }} />
        <select value={filterEquip} onChange={e => setFilterEquip(e.target.value)} style={{ ...inp, width: 'auto', minWidth: '180px' }}>
          <option value="">All Equipment</option>
          {equipment.map(e => <option key={e.id} value={e.id}>{e.description} {e.serial_number ? `(${e.serial_number})` : ''}</option>)}
        </select>
        {tab === 'log' && (
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, width: 'auto', minWidth: '180px' }} />
        )}
        <button onClick={() => exportCsv(
          tab === 'costing' ? 'equipment-cost-summary.csv' : 'equipment-usage-log.csv',
          tab === 'costing'
            ? ['Equipment', 'Contractor', 'Hours', 'Days', 'Downtime', 'Fuel (L)', 'Hourly Rate', 'Total Cost']
            : ['Date', 'Equipment', 'Contractor', 'Hours', 'Operator', 'Task', 'Location', 'Fuel (L)', 'Downtime', 'Approved'],
          tab === 'costing'
            ? costSummary.map(r => [r.description, r.contractor, r.totalHours.toFixed(1), r.days, r.totalDowntime.toFixed(1), r.totalFuel.toFixed(1), r.hourlyRate.toFixed(2), r.totalCost.toFixed(2)])
            : filtered.map(l => [l.usage_date, l.equipment?.description, l.equipment?.contractor?.name, l.hours_worked, l.operator_name || '', l.task_description || '', l.location || '', l.fuel_litres || '', l.downtime_hours || 0, l.approved ? 'Yes' : 'No'])
        )} style={{ ...inp, width: 'auto', background: color, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Export CSV
        </button>
      </div>

      {/* Tab Content */}
      {tab === 'log' && (
        <DashCard style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar }}>
                  <th style={th}>Date</th>
                  <th style={th}>Equipment</th>
                  <th style={th}>Contractor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Hours</th>
                  <th style={th}>Operator</th>
                  <th style={th}>Task</th>
                  <th style={{ ...th, textAlign: 'right' }}>Cost</th>
                  <th style={th}>Status</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={9} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>No usage logs found</td></tr>
                ) : filtered.map(l => {
                  const hrs = Number(l.hours_worked || 0)
                  const rate = Number(l.equipment?.hourly_rate || 0)
                  const cost = rate > 0 ? hrs * rate : Number(l.equipment?.daily_rate || 0)
                  return (
                    <tr key={l.id}
                      onClick={() => can('contractors.edit') ? openEdit(l) : null}
                      style={{ cursor: can('contractors.edit') ? 'pointer' : 'default' }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={td}>{l.usage_date}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{l.equipment?.description || '-'}</td>
                      <td style={td}>{l.equipment?.contractor?.name || '-'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{hrs.toFixed(1)}</td>
                      <td style={td}>{l.operator_name || '-'}</td>
                      <td style={{ ...td, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.task_description || '-'}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(cost)}</td>
                      <td style={td}>
                        <span style={{
                          fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '6px',
                          background: l.approved ? THEME.statusSuccessBg : THEME.statusWarningBg,
                          color: l.approved ? THEME.statusSuccessText : THEME.statusWarningText,
                        }}>
                          {l.approved ? 'Approved' : 'Pending'}
                        </span>
                      </td>
                      <td style={td}>
                        {!l.approved && can('contractors.edit') && (
                          <button onClick={e => { e.stopPropagation(); handleApprove(l.id) }} style={{
                            padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                            background: THEME.statusSuccessBg, color: THEME.statusSuccessText,
                            border: `1px solid ${THEME.statusSuccessText}`, cursor: 'pointer', fontFamily: 'inherit',
                          }}>
                            Approve
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </DashCard>
      )}

      {tab === 'costing' && (
        <DashCard style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar }}>
                  <th style={th}>Equipment</th>
                  <th style={th}>Contractor</th>
                  <th style={{ ...th, textAlign: 'right' }}>Hours</th>
                  <th style={{ ...th, textAlign: 'right' }}>Days</th>
                  <th style={{ ...th, textAlign: 'right' }}>Hire Cost</th>
                  <th style={{ ...th, textAlign: 'right' }}>Fuel Cost</th>
                  <th style={{ ...th, textAlign: 'right' }}>Trip Hrs</th>
                  <th style={{ ...th, textAlign: 'right' }}>Total Cost</th>
                </tr>
              </thead>
              <tbody>
                {costSummary.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>No data</td></tr>
                ) : costSummary.map(r => (
                  <tr key={r.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{r.description}</td>
                    <td style={td}>{r.contractor}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.totalHours.toFixed(1)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.days}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(r.hireCost)}</td>
                    <td style={{ ...td, textAlign: 'right', color: r.fuelCost > 0 ? '#E65100' : THEME.textMed }}>{fmtMoney(r.fuelCost)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.tripHours.toFixed(1)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: color }}>{fmtMoney(r.totalCost)}</td>
                  </tr>
                ))}
                {costSummary.length > 0 && (
                  <tr style={{ background: THEME.surfaceVar }}>
                    <td colSpan={2} style={{ ...td, fontWeight: 700 }}>TOTAL</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{costSummary.reduce((s, r) => s + r.totalHours, 0).toFixed(1)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{costSummary.reduce((s, r) => s + r.days, 0)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmtMoney(costSummary.reduce((s, r) => s + r.hireCost, 0))}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: '#E65100' }}>{fmtMoney(costSummary.reduce((s, r) => s + r.fuelCost, 0))}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{costSummary.reduce((s, r) => s + r.tripHours, 0).toFixed(1)}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: color }}>{fmtMoney(costSummary.reduce((s, r) => s + r.totalCost, 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </DashCard>
      )}

      {tab === 'linked' && (
        <>
          <SectionTitle title="Fuel Transactions" subtitle={`Fuel issued to linked equipment (${fuelTxns.length} records)`} style={{ marginBottom: '12px' }} />
          <DashCard style={{ padding: 0, marginBottom: '20px' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: THEME.surfaceVar }}>
                    <th style={th}>Date</th>
                    <th style={th}>Equipment</th>
                    <th style={{ ...th, textAlign: 'right' }}>Litres</th>
                    <th style={{ ...th, textAlign: 'right' }}>Cost</th>
                    <th style={th}>Docket</th>
                    <th style={th}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {fuelTxns.length === 0 ? (
                    <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>
                      {equipment.some(e => e.fleet_asset_id) ? 'No fuel transactions in this period' : 'No equipment linked to fleet assets — set fleet_asset_id on hired equipment to see fuel data'}
                    </td></tr>
                  ) : fuelTxns.map(ft => {
                    const eq = equipment.find(e => e.fleet_asset_id === ft.equipment_id)
                    return (
                      <tr key={ft.id}>
                        <td style={td}>{ft.transaction_date}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{eq?.description || '-'}</td>
                        <td style={{ ...td, textAlign: 'right' }}>{Number(ft.litres).toFixed(1)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: '#E65100' }}>{fmtMoney(ft.total_cost)}</td>
                        <td style={td}>{ft.docket_number || '-'}</td>
                        <td style={{ ...td, maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ft.notes || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </DashCard>

          <SectionTitle title="Fleet Trips" subtitle={`Trips logged against linked equipment (${fleetTrips.length} records)`} style={{ marginBottom: '12px' }} />
          <DashCard style={{ padding: 0 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: THEME.surfaceVar }}>
                    <th style={th}>Date</th>
                    <th style={th}>Equipment</th>
                    <th style={{ ...th, textAlign: 'right' }}>Hours</th>
                    <th style={th}>Purpose</th>
                    <th style={th}>Destination</th>
                  </tr>
                </thead>
                <tbody>
                  {fleetTrips.length === 0 ? (
                    <tr><td colSpan={5} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>
                      {equipment.some(e => e.fleet_asset_id) ? 'No fleet trips in this period' : 'No equipment linked to fleet assets'}
                    </td></tr>
                  ) : fleetTrips.map(tr => {
                    const eq = equipment.find(e => e.fleet_asset_id === tr.asset_id)
                    return (
                      <tr key={tr.id}>
                        <td style={td}>{tr.trip_date}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{eq?.description || '-'}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{Number(tr.operating_hours || 0).toFixed(1)}</td>
                        <td style={td}>{tr.purpose || '-'}</td>
                        <td style={td}>{tr.destination || '-'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </DashCard>
        </>
      )}

      {/* Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '580px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Usage Entry' : 'Log Equipment Usage'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Equipment *</label>
                  <select style={inp} value={form.equipment_id} onChange={e => set('equipment_id', e.target.value)}>
                    <option value="">-- Select Equipment --</option>
                    {equipment.map(eq => (
                      <option key={eq.id} value={eq.id}>
                        {eq.description} {eq.serial_number ? `(${eq.serial_number})` : ''} — {eq.contractor?.name || 'No contractor'}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Date *</label>
                  <input style={inp} type="date" value={form.usage_date} onChange={e => set('usage_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Hours Worked *</label>
                  <input style={inp} type="number" step="0.5" min="0" max="24" value={form.hours_worked} onChange={e => set('hours_worked', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Operator Name</label>
                  <input style={inp} value={form.operator_name} onChange={e => set('operator_name', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Location</label>
                  <input style={inp} value={form.location} onChange={e => set('location', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Fuel Used (litres)</label>
                  <input style={inp} type="number" step="0.1" min="0" value={form.fuel_litres} onChange={e => set('fuel_litres', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Downtime (hours)</label>
                  <input style={inp} type="number" step="0.5" min="0" max="24" value={form.downtime_hours} onChange={e => set('downtime_hours', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Task Description</label>
                  <input style={inp} value={form.task_description} onChange={e => set('task_description', e.target.value)} placeholder="What was the equipment used for?" />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '50px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                {editId && can('contractors.delete') && (
                  <button onClick={handleArchive} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Archive
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setModalOpen(false)} style={{
                  padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff',
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
                }}>
                  {saving ? 'Saving...' : editId ? 'Update' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
