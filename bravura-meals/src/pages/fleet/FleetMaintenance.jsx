import { useState, useMemo, useEffect, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { StatusBadge } from '../../components/ui'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'

const color = MODULE_COLORS.fleet

const PRIORITY_MAP = {
  critical: { label: 'Critical', bg: '#fde8e8', text: '#dc2626' },
  high:     { label: 'High',     bg: '#fff3e0', text: '#ea580c' },
  medium:   { label: 'Medium',   bg: '#fffbeb', text: '#d97706' },
  low:      { label: 'Low',      bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const STATUS_MAP = {
  scheduled:          { label: 'Scheduled',          bg: '#e0f2fe', text: '#0369a1' },
  awaiting_approval:  { label: 'Awaiting Approval',  bg: '#ede9fe', text: '#7c3aed' },
  waiting_for_parts:  { label: 'Waiting for Parts',  bg: '#fffbeb', text: '#d97706' },
  in_progress:        { label: 'In Progress',        bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  completed:          { label: 'Completed',          bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
  cancelled:          { label: 'Cancelled',          bg: '#fde8e8', text: '#dc2626' },
}


const EMPTY_FORM = {
  work_order_number: '', asset_id: '', fault_description: '',
  priority: 'medium', assigned_technician: '', parts_required: '',
  labour_hours_est: '', cost_est: '', status: 'scheduled', notes: '',
  // Close WO fields
  findings: '', labour_hours_actual: '', labour_rate: '',
  parts_cost: '', other_cost: '',
}

function generateWONumber() {
  const d = new Date()
  const ds = d.getFullYear().toString() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  const seq = String(Math.floor(Math.random() * 900) + 100)
  return `WO-${ds}-${seq}`
}

function pmUrgency(asset) {
  const alerts = []
  if (asset.current_odometer_km && asset.next_service_due_km) {
    const km = Number(asset.current_odometer_km)
    const due = Number(asset.next_service_due_km)
    const pct = due > 0 ? ((km / due) * 100) : 0
    if (km > due * 1.1) alerts.push({ type: 'critical', label: `Odometer ${km.toLocaleString()} km > service due ${due.toLocaleString()} km (+10% past)`, asset })
    else if (km > due) alerts.push({ type: 'overdue', label: `Odometer ${km.toLocaleString()} km past service due ${due.toLocaleString()} km`, asset })
    else if (km > due * 0.8) alerts.push({ type: 'due_soon', label: `Odometer ${km.toLocaleString()} km approaching service at ${due.toLocaleString()} km`, asset })
  }
  if (asset.current_hours && asset.next_service_due_hours) {
    const hrs = Number(asset.current_hours)
    const due = Number(asset.next_service_due_hours)
    if (hrs > due * 1.1) alerts.push({ type: 'critical', label: `Hours ${hrs.toLocaleString()} > service due ${due.toLocaleString()} (+10% past)`, asset })
    else if (hrs > due) alerts.push({ type: 'overdue', label: `Hours ${hrs.toLocaleString()} past service due ${due.toLocaleString()}`, asset })
    else if (hrs > due * 0.8) alerts.push({ type: 'due_soon', label: `Hours ${hrs.toLocaleString()} approaching service at ${due.toLocaleString()}`, asset })
  }
  return alerts
}

const URGENCY_COLORS = {
  critical: { bg: '#fde8e8', text: '#dc2626', icon: 'error' },
  overdue:  { bg: '#fff3e0', text: '#ea580c', icon: 'warning' },
  due_soon: { bg: '#fffbeb', text: '#d97706', icon: 'schedule' },
}

export default function FleetMaintenance({ setPage }) {
  const { can } = usePermissions()
  const { assets, workOrders, loading, fetchAll } = useFleet()
  const { currentSiteId } = useSite()

  const [search, setSearch] = useState('')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [activeTab, setActiveTab] = useState('work_orders')
  const [modalOpen, setModalOpen] = useState(false)
  const [closeMode, setCloseMode] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [maintenance, setMaintenance] = useState([])
  const [maintLoading, setMaintLoading] = useState(false)

  // Parts from stock
  const [allItems, setAllItems] = useState([])
  const [siteStockMap, setSiteStockMap] = useState({}) // { item_id: { on_hand_qty, warehouse_id, valuation_rate } }
  const [stockParts, setStockParts] = useState([]) // [{ item_id, item_code, description, qty, unit_cost, available }]
  const [itemSearch, setItemSearch] = useState('')
  const [showItemPicker, setShowItemPicker] = useState(false)
  const [existingWoParts, setExistingWoParts] = useState([]) // for viewing completed WO parts

  const fetchMaintenance = useCallback(async () => {
    if (!currentSiteId) return
    setMaintLoading(true)
    const { data } = await supabase
      .from('fleet_maintenance')
      .select('*, fleet_assets(id, asset_number, description), fleet_work_orders(id, work_order_number)')
      .eq('site_id', currentSiteId)
      .order('service_date', { ascending: false })
      .limit(200)
    setMaintenance(data || [])
    setMaintLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (activeTab === 'history') fetchMaintenance() }, [activeTab, fetchMaintenance])

  // Fetch all items once (global, usually <500)
  const fetchItems = useCallback(async () => {
    if (allItems.length > 0) return
    const { data } = await supabase
      .from('items')
      .select('id, item_code, description, standard_cost, average_cost')
      .eq('is_active', true)
      .order('item_code')
      .limit(500)
    setAllItems(data || [])
  }, [allItems.length])

  // Fetch stock balances for current site
  const fetchSiteStock = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase
      .from('stock_balances')
      .select('item_id, on_hand_qty, warehouse_id, valuation_rate, warehouses!inner(site_id)')
      .eq('warehouses.site_id', currentSiteId)
    const map = {}
    ;(data || []).forEach(sb => {
      if (!map[sb.item_id] || sb.on_hand_qty > map[sb.item_id].on_hand_qty) {
        map[sb.item_id] = { on_hand_qty: Number(sb.on_hand_qty), warehouse_id: sb.warehouse_id, valuation_rate: Number(sb.valuation_rate || 0) }
      }
    })
    setSiteStockMap(map)
  }, [currentSiteId])

  // Fetch parts for an existing maintenance record (via work order)
  const fetchWoParts = useCallback(async (woId) => {
    const { data: maintRows } = await supabase
      .from('fleet_maintenance')
      .select('id')
      .eq('work_order_id', woId)
      .limit(1)
    if (!maintRows || maintRows.length === 0) { setExistingWoParts([]); return }
    const { data: parts } = await supabase
      .from('fleet_maintenance_parts')
      .select('*')
      .eq('maintenance_id', maintRows[0].id)
    setExistingWoParts(parts || [])
  }, [])

  const kpis = useMemo(() => {
    const all = workOrders || []
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
    return {
      open: all.filter(w => w.status !== 'completed' && w.status !== 'cancelled').length,
      scheduled: all.filter(w => w.status === 'scheduled').length,
      inProgress: all.filter(w => w.status === 'in_progress').length,
      completed: all.filter(w => w.status === 'completed' && w.completed_at && new Date(w.completed_at) >= thirtyDaysAgo).length,
    }
  }, [workOrders])

  const filtered = useMemo(() => {
    let list = workOrders || []
    if (filterPriority !== 'all') list = list.filter(w => w.priority === filterPriority)
    if (filterStatus !== 'all') list = list.filter(w => w.status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(w =>
        (w.work_order_number || '').toLowerCase().includes(q) ||
        (w.fault_description || '').toLowerCase().includes(q) ||
        (w.assigned_technician || '').toLowerCase().includes(q) ||
        (w.fleet_assets?.asset_number || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [workOrders, filterPriority, filterStatus, search])

  const pmAlerts = useMemo(() => {
    return (assets || []).flatMap(a => pmUrgency(a))
      .sort((a, b) => {
        const ord = { critical: 0, overdue: 1, due_soon: 2 }
        return (ord[a.type] || 9) - (ord[b.type] || 9)
      })
  }, [assets])

  function openAdd() {
    setEditId(null); setCloseMode(false)
    setForm({ ...EMPTY_FORM, work_order_number: generateWONumber() })
    setStockParts([]); setItemSearch(''); setShowItemPicker(false); setExistingWoParts([])
    setError(''); setModalOpen(true)
    fetchItems(); fetchSiteStock()
  }

  function openEdit(wo) {
    setEditId(wo.id); setCloseMode(false)
    setForm({
      ...EMPTY_FORM,
      work_order_number: wo.work_order_number || '',
      asset_id: wo.asset_id || '',
      fault_description: wo.fault_description || '',
      priority: wo.priority || 'medium',
      assigned_technician: wo.assigned_technician || '',
      parts_required: wo.parts_required || '',
      labour_hours_est: wo.labour_hours_est ?? '',
      cost_est: wo.cost_est ?? '',
      status: wo.status || 'scheduled',
      notes: wo.notes || '',
    })
    setStockParts([]); setItemSearch(''); setShowItemPicker(false); setExistingWoParts([])
    setError(''); setModalOpen(true)
    fetchItems(); fetchSiteStock()
    if (wo.status === 'completed') fetchWoParts(wo.id)
  }

  function openClose(wo) {
    setEditId(wo.id); setCloseMode(true)
    setForm({
      ...EMPTY_FORM,
      work_order_number: wo.work_order_number || '',
      asset_id: wo.asset_id || '',
      fault_description: wo.fault_description || '',
      priority: wo.priority || 'medium',
      assigned_technician: wo.assigned_technician || '',
      parts_required: wo.parts_required || '',
      labour_hours_est: wo.labour_hours_est ?? '',
      cost_est: wo.cost_est ?? '',
      status: 'completed',
      notes: wo.notes || '',
      findings: '', labour_hours_actual: '', labour_rate: '',
      parts_cost: '', other_cost: '',
    })
    setStockParts([]); setItemSearch(''); setShowItemPicker(false); setExistingWoParts([])
    setError(''); setModalOpen(true)
    fetchItems(); fetchSiteStock()
  }

  const stockPartsCost = stockParts.reduce((sum, p) => sum + (Number(p.qty) || 0) * (Number(p.unit_cost) || 0), 0)
  const labourTotal = Number(form.labour_hours_actual || 0) * Number(form.labour_rate || 0)
  const totalCost = labourTotal + Number(form.parts_cost || 0) + Number(form.other_cost || 0) + stockPartsCost

  const filteredItems = useMemo(() => {
    if (!itemSearch.trim()) return allItems.slice(0, 20)
    const q = itemSearch.toLowerCase()
    return allItems.filter(it =>
      it.item_code.toLowerCase().includes(q) || it.description.toLowerCase().includes(q)
    ).slice(0, 20)
  }, [allItems, itemSearch])

  function addStockPart(item) {
    if (stockParts.some(p => p.item_id === item.id)) return
    const stock = siteStockMap[item.id]
    setStockParts(prev => [...prev, {
      item_id: item.id,
      item_code: item.item_code,
      description: item.description,
      qty: 1,
      unit_cost: item.average_cost || item.standard_cost || 0,
      available: stock ? stock.on_hand_qty : 0,
      warehouse_id: stock ? stock.warehouse_id : null,
    }])
    setItemSearch(''); setShowItemPicker(false)
  }

  function updateStockPartQty(item_id, qty) {
    setStockParts(prev => prev.map(p => p.item_id === item_id ? { ...p, qty } : p))
  }

  function removeStockPart(item_id) {
    setStockParts(prev => prev.filter(p => p.item_id !== item_id))
  }

  async function handleSave() {
    if (!form.work_order_number || !form.fault_description) {
      setError('Work order number and fault description are required'); return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        work_order_number: form.work_order_number,
        asset_id: form.asset_id || null,
        fault_description: form.fault_description,
        priority: form.priority,
        assigned_technician: form.assigned_technician || null,
        parts_required: form.parts_required || null,
        labour_hours_est: form.labour_hours_est ? Number(form.labour_hours_est) : null,
        cost_est: form.cost_est ? Number(form.cost_est) : null,
        status: form.status,
        notes: form.notes || null,
        site_id: currentSiteId,
      }
      if (form.status === 'completed') payload.completed_at = new Date().toISOString()

      if (editId) {
        const { error: err } = await supabase.from('fleet_work_orders').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_work_orders').insert(payload)
        if (err) throw err
      }

      // If closing, also create a maintenance record
      if (closeMode && form.asset_id) {
        const maintPayload = {
          site_id: currentSiteId,
          asset_id: form.asset_id,
          work_order_id: editId,
          maintenance_type: 'corrective',
          description: form.findings || form.fault_description,
          technician: form.assigned_technician || null,
          estimated_cost: form.cost_est ? Number(form.cost_est) : null,
          actual_cost: totalCost > 0 ? totalCost : null,
          labour_hours: form.labour_hours_actual ? Number(form.labour_hours_actual) : null,
          service_date: new Date().toISOString().slice(0, 10),
          completion_date: new Date().toISOString().slice(0, 10),
          notes: form.notes || null,
        }
        const { data: maintData } = await supabase.from('fleet_maintenance').insert(maintPayload).select('id').single()

        // Insert stock parts into fleet_maintenance_parts and create inventory movements
        if (maintData && stockParts.length > 0) {
          const partsRows = stockParts.map(p => ({
            maintenance_id: maintData.id,
            part_name: p.description,
            part_number: p.item_code,
            quantity: Number(p.qty) || 0,
            unit_cost: Number(p.unit_cost) || 0,
            total_cost: (Number(p.qty) || 0) * (Number(p.unit_cost) || 0),
          }))
          await supabase.from('fleet_maintenance_parts').insert(partsRows)

          // Create inventory issue movements for parts with a warehouse
          const movements = stockParts
            .filter(p => p.warehouse_id && Number(p.qty) > 0)
            .map(p => ({
              item_id: p.item_id,
              warehouse_id: p.warehouse_id,
              movement_type: 'issue',
              quantity: -(Number(p.qty)),
              unit_cost: Number(p.unit_cost) || 0,
              value: -(Number(p.qty) * (Number(p.unit_cost) || 0)),
              voucher_type: 'fleet_wo',
              voucher_no: form.work_order_number,
              source_module: 'fleet',
            }))
          if (movements.length > 0) {
            await supabase.from('inventory_movements').insert(movements)
            // Update stock balances
            for (const p of stockParts.filter(sp => sp.warehouse_id && Number(sp.qty) > 0)) {
              const newQty = p.available - Number(p.qty)
              await supabase.from('stock_balances')
                .update({ on_hand_qty: newQty, updated_at: new Date().toISOString() })
                .eq('item_id', p.item_id)
                .eq('warehouse_id', p.warehouse_id)
            }
          }
        }
      } else if (stockParts.length > 0 && !closeMode) {
        // For non-close saves (creating/editing WO), find or create a maintenance record to attach parts
        // Parts are only saved when closing a WO, so we skip here
      }

      await fetchAll()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function createWOFromPM(asset) {
    const woNum = generateWONumber()
    await supabase.from('fleet_work_orders').insert({
      site_id: currentSiteId,
      work_order_number: woNum,
      asset_id: asset.id,
      fault_description: `Scheduled preventive maintenance for ${asset.asset_number}`,
      priority: 'medium',
      status: 'scheduled',
    })
    await fetchAll()
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Open Work Orders', value: kpis.open, icon: 'assignment', bg: color + '14', fg: color },
    { label: 'Scheduled', value: kpis.scheduled, icon: 'schedule', bg: '#e0f2fe', fg: '#0369a1' },
    { label: 'In Progress', value: kpis.inProgress, icon: 'engineering', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Completed (30d)', value: kpis.completed, icon: 'task_alt', bg: THEME.statusNeutralBg, fg: THEME.statusNeutralText },
  ]

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_maintenance" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '18px',
            border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: k.fg }}>{k.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
        {[
          { key: 'work_orders', label: 'Work Orders' },
          { key: 'pm', label: 'Preventive Maintenance' },
          { key: 'history', label: 'Maintenance History' },
        ].map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
            padding: '10px 18px', fontSize: '13px', fontWeight: 600,
            background: 'none', border: 'none', cursor: 'pointer',
            color: activeTab === t.key ? color : THEME.textMed,
            borderBottom: activeTab === t.key ? `2px solid ${color}` : '2px solid transparent',
            marginBottom: '-1px', fontFamily: 'inherit',
          }}>
            {t.label}
            {t.key === 'pm' && pmAlerts.length > 0 && (
              <span style={{
                marginLeft: '6px', background: '#dc2626', color: '#fff', fontSize: '10px',
                fontWeight: 700, padding: '1px 6px', borderRadius: '999px',
              }}>{pmAlerts.length}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === 'pm' && (
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text, marginBottom: '4px' }}>
            Preventive Maintenance Alerts
          </div>
          <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '16px' }}>
            Assets approaching or past scheduled service intervals
          </div>
          {pmAlerts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
              <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>check_circle</span>
              <div style={{ fontSize: '14px' }}>All assets are within service intervals</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {pmAlerts.map((alert, i) => {
                const uc = URGENCY_COLORS[alert.type]
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 16px', borderRadius: '10px',
                    background: uc.bg, border: `1px solid ${uc.text}20`,
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '20px', color: uc.text }}>{uc.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>
                        {alert.asset.asset_number} — {alert.asset.description || alert.asset.make}
                      </div>
                      <div style={{ fontSize: '12px', color: uc.text }}>{alert.label}</div>
                    </div>
                    <span style={{
                      fontSize: '10px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                      background: uc.text, color: '#fff', textTransform: 'uppercase',
                    }}>{alert.type.replace('_', ' ')}</span>
                    {can('fleet.create') && (
                      <button onClick={() => createWOFromPM(alert.asset)} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '4px',
                        padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                        background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>add</span>
                        Create WO
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text, marginBottom: '4px' }}>
            Maintenance History
          </div>
          <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '16px' }}>
            Completed service records
          </div>
          {maintLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
              <span className="material-symbols-rounded" style={{ fontSize: '24px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
            </div>
          ) : maintenance.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
              <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>history</span>
              <div style={{ fontSize: '14px' }}>No maintenance records yet</div>
              <div style={{ fontSize: '12px', marginTop: '4px' }}>Records are created when work orders are closed</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px',
                background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden',
              }}>
                <thead>
                  <tr style={{ background: THEME.surfaceVar }}>
                    {['Date', 'Asset', 'Type', 'WO #', 'Description', 'Technician', 'Cost', 'Hours'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {maintenance.map(m => (
                    <tr key={m.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '10px 14px', color: THEME.text, whiteSpace: 'nowrap' }}>{m.service_date}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: THEME.text }}>{m.fleet_assets?.asset_number || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '999px', background: color + '14', color }}>{m.maintenance_type}</span>
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{m.fleet_work_orders?.work_order_number || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.description || '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{m.technician || '—'}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: THEME.text }}>{m.actual_cost ? `R ${Number(m.actual_cost).toLocaleString()}` : '—'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{m.labour_hours || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'work_orders' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Work Orders</div>
              <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} work order{filtered.length !== 1 ? 's' : ''}</div>
            </div>
            {can('fleet.create') && (
              <button onClick={openAdd} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
                Add Work Order
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <input placeholder="Search work orders..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '260px' }} />
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
              <option value="all">All Priorities</option>
              {Object.entries(PRIORITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '180px' }}>
              <option value="all">All Statuses</option>
              {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
              <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>assignment</span>
              <div style={{ fontSize: '14px' }}>No work orders found</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px',
                background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden',
              }}>
                <thead>
                  <tr style={{ background: THEME.surfaceVar }}>
                    {['WO #', 'Asset', 'Fault', 'Priority', 'Technician', 'Status', 'Created', ''].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(wo => (
                    <tr key={wo.id}
                      onClick={() => can('fleet.edit') ? openEdit(wo) : null}
                      style={{ cursor: can('fleet.edit') ? 'pointer' : 'default', transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: THEME.text, whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{wo.work_order_number}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}`, maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.fleet_assets?.asset_number || '-'}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}`, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wo.fault_description || '-'}</td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${THEME.outlineVar}` }}><StatusBadge status={wo.priority} /></td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}` }}>{wo.assigned_technician || '-'}</td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${THEME.outlineVar}` }}><StatusBadge status={wo.status} /></td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }}>{wo.created_at ? new Date(wo.created_at).toLocaleDateString() : '-'}</td>
                      <td style={{ padding: '10px 14px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        {can('fleet.edit') && wo.status !== 'completed' && wo.status !== 'cancelled' && (
                          <button onClick={e => { e.stopPropagation(); openClose(wo) }} style={{
                            padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                            background: THEME.statusSuccessBg, color: THEME.statusSuccessText,
                            border: `1px solid ${THEME.statusSuccessText}30`, cursor: 'pointer', fontFamily: 'inherit',
                          }}>Close</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Add/Edit/Close Modal */}
      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '660px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {closeMode ? 'Close Work Order' : editId ? 'Edit Work Order' : 'Add Work Order'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              {!closeMode ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                  <div style={fieldWrap}>
                    <label style={lbl}>Work Order Number *</label>
                    <input style={inp} value={form.work_order_number} onChange={e => set('work_order_number', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Asset</label>
                    <select style={inp} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                      <option value="">-- Select Asset --</option>
                      {(assets || []).map(a => <option key={a.id} value={a.id}>{a.asset_number} - {a.description}</option>)}
                    </select>
                  </div>
                  <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                    <label style={lbl}>Fault Description *</label>
                    <textarea style={{ ...inp, minHeight: '70px', resize: 'vertical' }} value={form.fault_description} onChange={e => set('fault_description', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Priority</label>
                    <select style={inp} value={form.priority} onChange={e => set('priority', e.target.value)}>
                      {Object.entries(PRIORITY_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Assigned Technician</label>
                    <input style={inp} value={form.assigned_technician} onChange={e => set('assigned_technician', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Parts Required</label>
                    <input style={inp} value={form.parts_required} onChange={e => set('parts_required', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Labour Hours (est)</label>
                    <input style={inp} type="number" step="0.5" value={form.labour_hours_est} onChange={e => set('labour_hours_est', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Cost Estimate</label>
                    <input style={inp} type="number" step="0.01" value={form.cost_est} onChange={e => set('cost_est', e.target.value)} />
                  </div>
                  <div style={fieldWrap}>
                    <label style={lbl}>Status</label>
                    <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                      {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </select>
                  </div>
                  {/* Parts from Stock section */}
                  <div style={{ gridColumn: '1 / -1', marginBottom: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text, marginBottom: '8px', marginTop: '4px' }}>
                      Parts from Stock
                    </div>

                    {/* Existing WO parts (read-only for completed) */}
                    {editId && existingWoParts.length > 0 && form.status === 'completed' && (
                      <div style={{ marginBottom: '12px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                          <thead>
                            <tr style={{ background: THEME.surfaceVar }}>
                              <th style={{ padding: '6px 10px', textAlign: 'left', color: THEME.textMed, fontWeight: 600 }}>Code</th>
                              <th style={{ padding: '6px 10px', textAlign: 'left', color: THEME.textMed, fontWeight: 600 }}>Description</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Qty</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Unit Cost</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {existingWoParts.map(p => (
                              <tr key={p.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                                <td style={{ padding: '6px 10px', color: THEME.text, fontWeight: 600 }}>{p.part_number || '-'}</td>
                                <td style={{ padding: '6px 10px', color: THEME.text }}>{p.part_name}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', color: THEME.text }}>{p.quantity}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed }}>R {Number(p.unit_cost || 0).toFixed(2)}</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: THEME.text }}>R {Number(p.total_cost || 0).toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Item search and picker (not for completed WOs) */}
                    {form.status !== 'completed' && (
                      <>
                        <div style={{ position: 'relative', marginBottom: '8px' }}>
                          <input
                            style={inp}
                            placeholder="Search items by code or description..."
                            value={itemSearch}
                            onChange={e => { setItemSearch(e.target.value); setShowItemPicker(true) }}
                            onFocus={() => setShowItemPicker(true)}
                          />
                          {showItemPicker && filteredItems.length > 0 && (
                            <div style={{
                              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                              background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
                              borderRadius: '8px', boxShadow: THEME.shadow2, maxHeight: '200px', overflowY: 'auto',
                            }}>
                              {filteredItems.map(it => {
                                const stock = siteStockMap[it.id]
                                const already = stockParts.some(p => p.item_id === it.id)
                                return (
                                  <div key={it.id}
                                    onClick={() => !already && addStockPart(it)}
                                    style={{
                                      padding: '8px 12px', cursor: already ? 'default' : 'pointer',
                                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                      borderBottom: `1px solid ${THEME.outlineVar}`,
                                      opacity: already ? 0.5 : 1,
                                      background: already ? THEME.surfaceVar : 'transparent',
                                    }}
                                    onMouseEnter={e => { if (!already) e.currentTarget.style.background = THEME.surfaceVar }}
                                    onMouseLeave={e => { if (!already) e.currentTarget.style.background = 'transparent' }}
                                  >
                                    <div>
                                      <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.text }}>{it.item_code}</span>
                                      <span style={{ fontSize: '12px', color: THEME.textMed, marginLeft: '8px' }}>{it.description}</span>
                                    </div>
                                    <span style={{ fontSize: '11px', color: stock && stock.on_hand_qty > 0 ? THEME.statusSuccessText : THEME.textLow }}>
                                      Stock: {stock ? stock.on_hand_qty : 0}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>

                        {/* Selected parts table */}
                        {stockParts.length > 0 && (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', marginTop: '4px' }}>
                            <thead>
                              <tr style={{ background: THEME.surfaceVar }}>
                                <th style={{ padding: '6px 10px', textAlign: 'left', color: THEME.textMed, fontWeight: 600 }}>Code</th>
                                <th style={{ padding: '6px 10px', textAlign: 'left', color: THEME.textMed, fontWeight: 600 }}>Description</th>
                                <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Stock</th>
                                <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Qty</th>
                                <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Cost</th>
                                <th style={{ padding: '6px 10px', width: '36px' }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {stockParts.map(p => (
                                <tr key={p.item_id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                                  <td style={{ padding: '6px 10px', fontWeight: 600, color: THEME.text }}>{p.item_code}</td>
                                  <td style={{ padding: '6px 10px', color: THEME.text, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', color: Number(p.qty) > p.available ? '#dc2626' : THEME.textMed }}>{p.available}</td>
                                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                                    <input type="number" min="1" step="1" value={p.qty}
                                      onChange={e => updateStockPartQty(p.item_id, e.target.value)}
                                      style={{ ...inp, width: '60px', padding: '4px 6px', textAlign: 'right' }}
                                    />
                                  </td>
                                  <td style={{ padding: '6px 10px', textAlign: 'right', color: THEME.text, whiteSpace: 'nowrap' }}>
                                    R {((Number(p.qty) || 0) * (Number(p.unit_cost) || 0)).toFixed(2)}
                                  </td>
                                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                    <button onClick={() => removeStockPart(p.item_id)} style={{
                                      background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                                    }}>
                                      <span className="material-symbols-rounded" style={{ fontSize: '16px', color: '#dc2626' }}>close</span>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr>
                                <td colSpan="4" style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontSize: '12px', color: THEME.text }}>Stock Parts Total:</td>
                                <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontSize: '12px', color: THEME.text }}>R {stockPartsCost.toFixed(2)}</td>
                                <td></td>
                              </tr>
                            </tfoot>
                          </table>
                        )}
                      </>
                    )}
                  </div>

                  <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                    <label style={lbl}>Notes</label>
                    <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                  </div>
                </div>
              ) : (
                /* Close WO Form with cost breakdown */
                <div>
                  <div style={{
                    background: THEME.statusSuccessBg, border: `1px solid ${THEME.statusSuccessText}30`,
                    borderRadius: '10px', padding: '12px 16px', marginBottom: '16px',
                    display: 'flex', alignItems: 'center', gap: '8px',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.statusSuccessText }}>check_circle</span>
                    <span style={{ fontSize: '13px', color: THEME.statusSuccessText, fontWeight: 600 }}>
                      Closing {form.work_order_number}
                    </span>
                  </div>

                  <div style={fieldWrap}>
                    <label style={lbl}>Findings / Work Done *</label>
                    <textarea style={{ ...inp, minHeight: '80px', resize: 'vertical' }} value={form.findings} onChange={e => set('findings', e.target.value)} placeholder="Describe what was found and what work was performed..." />
                  </div>

                  <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text, marginBottom: '12px', marginTop: '8px' }}>
                    Cost Breakdown
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                    <div style={fieldWrap}>
                      <label style={lbl}>Labour Hours (actual)</label>
                      <input style={inp} type="number" step="0.5" value={form.labour_hours_actual} onChange={e => set('labour_hours_actual', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Labour Rate (R/hr)</label>
                      <input style={inp} type="number" step="0.01" value={form.labour_rate} onChange={e => set('labour_rate', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Parts Cost (R)</label>
                      <input style={inp} type="number" step="0.01" value={form.parts_cost} onChange={e => set('parts_cost', e.target.value)} />
                    </div>
                    <div style={fieldWrap}>
                      <label style={lbl}>Other Cost (R)</label>
                      <input style={inp} type="number" step="0.01" value={form.other_cost} onChange={e => set('other_cost', e.target.value)} />
                    </div>
                  </div>

                  {/* Parts from Stock (close mode) */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: THEME.text, marginBottom: '8px' }}>
                      Parts from Stock
                    </div>
                    <div style={{ position: 'relative', marginBottom: '8px' }}>
                      <input
                        style={inp}
                        placeholder="Search items by code or description..."
                        value={itemSearch}
                        onChange={e => { setItemSearch(e.target.value); setShowItemPicker(true) }}
                        onFocus={() => setShowItemPicker(true)}
                      />
                      {showItemPicker && filteredItems.length > 0 && (
                        <div style={{
                          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
                          borderRadius: '8px', boxShadow: THEME.shadow2, maxHeight: '200px', overflowY: 'auto',
                        }}>
                          {filteredItems.map(it => {
                            const stock = siteStockMap[it.id]
                            const already = stockParts.some(p => p.item_id === it.id)
                            return (
                              <div key={it.id}
                                onClick={() => !already && addStockPart(it)}
                                style={{
                                  padding: '8px 12px', cursor: already ? 'default' : 'pointer',
                                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  borderBottom: `1px solid ${THEME.outlineVar}`,
                                  opacity: already ? 0.5 : 1,
                                  background: already ? THEME.surfaceVar : 'transparent',
                                }}
                                onMouseEnter={e => { if (!already) e.currentTarget.style.background = THEME.surfaceVar }}
                                onMouseLeave={e => { if (!already) e.currentTarget.style.background = 'transparent' }}
                              >
                                <div>
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.text }}>{it.item_code}</span>
                                  <span style={{ fontSize: '12px', color: THEME.textMed, marginLeft: '8px' }}>{it.description}</span>
                                </div>
                                <span style={{ fontSize: '11px', color: stock && stock.on_hand_qty > 0 ? THEME.statusSuccessText : THEME.textLow }}>
                                  Stock: {stock ? stock.on_hand_qty : 0}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                    {stockParts.length > 0 && (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                          <tr style={{ background: THEME.surfaceVar }}>
                            <th style={{ padding: '6px 10px', textAlign: 'left', color: THEME.textMed, fontWeight: 600 }}>Code</th>
                            <th style={{ padding: '6px 10px', textAlign: 'left', color: THEME.textMed, fontWeight: 600 }}>Description</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Stock</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Qty</th>
                            <th style={{ padding: '6px 10px', textAlign: 'right', color: THEME.textMed, fontWeight: 600 }}>Cost</th>
                            <th style={{ padding: '6px 10px', width: '36px' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockParts.map(p => (
                            <tr key={p.item_id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600, color: THEME.text }}>{p.item_code}</td>
                              <td style={{ padding: '6px 10px', color: THEME.text, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', color: Number(p.qty) > p.available ? '#dc2626' : THEME.textMed }}>{p.available}</td>
                              <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                                <input type="number" min="1" step="1" value={p.qty}
                                  onChange={e => updateStockPartQty(p.item_id, e.target.value)}
                                  style={{ ...inp, width: '60px', padding: '4px 6px', textAlign: 'right' }}
                                />
                              </td>
                              <td style={{ padding: '6px 10px', textAlign: 'right', color: THEME.text, whiteSpace: 'nowrap' }}>
                                R {((Number(p.qty) || 0) * (Number(p.unit_cost) || 0)).toFixed(2)}
                              </td>
                              <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                                <button onClick={() => removeStockPart(p.item_id)} style={{
                                  background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
                                }}>
                                  <span className="material-symbols-rounded" style={{ fontSize: '16px', color: '#dc2626' }}>close</span>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan="4" style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontSize: '12px', color: THEME.text }}>Stock Parts Total:</td>
                            <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, fontSize: '12px', color: THEME.text }}>R {stockPartsCost.toFixed(2)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    )}
                  </div>

                  {/* Cost summary */}
                  <div style={{
                    background: THEME.surfaceVar, borderRadius: '10px', padding: '14px 16px', marginTop: '4px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                      <span>Labour ({form.labour_hours_actual || 0} hrs x R{form.labour_rate || 0})</span>
                      <span>R {labourTotal.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                      <span>Parts (manual)</span>
                      <span>R {Number(form.parts_cost || 0).toFixed(2)}</span>
                    </div>
                    {stockPartsCost > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                        <span>Parts from stock ({stockParts.length} item{stockParts.length !== 1 ? 's' : ''})</span>
                        <span>R {stockPartsCost.toFixed(2)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '8px' }}>
                      <span>Other</span>
                      <span>R {Number(form.other_cost || 0).toFixed(2)}</span>
                    </div>
                    <div style={{ borderTop: `1px solid ${THEME.outlineVar}`, paddingTop: '8px', display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700, color: THEME.text }}>
                      <span>Total</span>
                      <span>R {totalCost.toFixed(2)}</span>
                    </div>
                  </div>

                  <div style={{ ...fieldWrap, marginTop: '16px' }}>
                    <label style={lbl}>Notes</label>
                    <textarea style={{ ...inp, minHeight: '50px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>{error}</div>
            )}

            <div style={{
              padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px',
            }}>
              <button onClick={() => setModalOpen(false)} style={{
                padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: THEME.surfaceVar, color: THEME.textMed,
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
              }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{
                padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: closeMode ? THEME.statusSuccessText : color, color: '#fff',
                border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
              }}>
                {saving ? 'Saving...' : closeMode ? 'Close Work Order' : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
