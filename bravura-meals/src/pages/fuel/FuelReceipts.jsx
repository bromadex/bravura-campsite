import { useState, useMemo, useEffect, useCallback } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import {
  PageHeader, Card, Button, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'
import { supabase } from '../../supabaseClient'

const FUEL_CLR = MODULE_COLORS.fuel

function interpolate(calibration, mm) {
  if (!calibration || calibration.length === 0) return null
  const sorted = [...calibration].sort((a, b) => a.dip_mm - b.dip_mm)
  if (mm <= sorted[0].dip_mm) return sorted[0].level_litres
  if (mm >= sorted[sorted.length - 1].dip_mm) return sorted[sorted.length - 1].level_litres
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i], hi = sorted[i + 1]
    if (mm >= lo.dip_mm && mm <= hi.dip_mm) {
      const t = (mm - lo.dip_mm) / (hi.dip_mm - lo.dip_mm)
      return lo.level_litres + t * (hi.level_litres - lo.level_litres)
    }
  }
  return null
}

const BLANK_FORM = {
  delivery_date:        new Date().toISOString().slice(0, 10),
  delivery_time:        new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  supplier_name:        '',
  delivery_note_number: '',
  tank_id:              '',
  quantity_ordered:     '',
  quantity_delivered:   '',
  unit_price:           '',
  total_cost:           '',
  dip_before_mm:        '',
  dip_before:           '',
  dip_after_mm:         '',
  dip_after:            '',
  receiving_officer:    '',
  notes:                '',
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, display: 'block',
}

const filterInputStyle = {
  padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', background: THEME.surface,
}

function FieldWrap({ label, required, children, span }) {
  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}{required && <span style={{ color: THEME.error, marginLeft: '3px' }}>*</span>}
      </div>
      {children}
    </div>
  )
}

const STATUS_MAP = {
  pending:   { bg: THEME.statusWarningBg,  text: THEME.statusWarningText,  label: 'Pending' },
  confirmed: { bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  label: 'Confirmed' },
  queried:   { bg: THEME.statusErrorBg,    text: THEME.statusErrorText,    label: 'Queried' },
  cancelled: { bg: '#f5f5f5',              text: THEME.textLow,            label: 'Cancelled' },
}

export default function FuelReceipts() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { tanks, addTransaction, refresh: refreshFuel } = useFuel()

  const canCreate  = can('fuel.create')
  const canView    = can('fuel.view')
  const canApprove = can('fuel.approve')

  const [showForm,   setShowForm]   = useState(false)
  const [form,       setForm]       = useState(BLANK_FORM)
  const [saving,     setSaving]     = useState(false)
  const [calibration, setCalibration] = useState([])

  // Delivery history from fuel_deliveries table
  const [deliveries, setDeliveries] = useState([])
  const [loadingDel, setLoadingDel] = useState(true)

  // Filters
  const [search,   setSearch]   = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [tankFilter, setTankFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Edit row
  const [editId, setEditId] = useState(null)

  const activeTanks = useMemo(() => tanks.filter(t => t.status === 'active' && !t.is_archived), [tanks])

  // Load calibration table when tank changes
  useEffect(() => {
    if (!form.tank_id) { setCalibration([]); return }
    supabase.from('tank_calibrations').select('dip_mm,level_litres').eq('tank_id', form.tank_id)
      .then(({ data }) => setCalibration(data || []))
  }, [form.tank_id])

  const fetchDeliveries = useCallback(async () => {
    if (!currentSiteId) return
    setLoadingDel(true)

    // Try fuel_deliveries table first (rich records)
    const { data: rich, error: richErr } = await supabase
      .from('fuel_deliveries')
      .select('*, fuel_tanks(id, name, fuel_types(name)), confirmed_profile:profiles!fuel_deliveries_confirmed_by_fkey(id, full_name), created_profile:profiles!fuel_deliveries_created_by_fkey(id, full_name)')
      .eq('site_id', currentSiteId)
      .order('delivery_date', { ascending: false })
      .order('created_at', { ascending: false })
    const richRows = (!richErr && rich) ? rich : []

    // Also load delivery transactions (legacy records not in fuel_deliveries)
    const { data: txns } = await supabase
      .from('fuel_transactions')
      .select('*, fuel_tanks:tank_id(id, name, fuel_types(name))')
      .eq('site_id', currentSiteId)
      .eq('transaction_type', 'delivery')
      .order('transaction_date', { ascending: false })

    // Merge: rich rows take priority; add txn-based rows that aren't already
    // covered by a fuel_deliveries record (match on tank_id + date + litres)
    const richKeys = new Set(richRows.map(r => `${r.tank_id}|${r.delivery_date}|${Number(r.quantity_delivered).toFixed(1)}`))
    const txnRows = (txns || [])
      .filter(t => !richKeys.has(`${t.tank_id}|${t.transaction_date}|${Number(t.litres).toFixed(1)}`))
      .map(t => ({
        id:                  t.id,
        _from_txn:           true,
        delivery_date:       t.transaction_date,
        supplier_name:       t.supplier || '',
        delivery_note_number: t.docket_number || '',
        tank_id:             t.tank_id,
        fuel_tanks:          t.fuel_tanks,
        quantity_delivered:   t.litres,
        unit_price:          t.unit_price,
        total_cost:          t.total_cost,
        dip_before:          null,
        dip_after:           null,
        status:              'confirmed',
        notes:               t.notes,
        created_at:          t.created_at,
        created_profile:     null,
        confirmed_profile:   null,
      }))

    setDeliveries([...richRows, ...txnRows].sort((a, b) => {
      const da = a.delivery_date || ''; const db = b.delivery_date || ''
      return da < db ? 1 : da > db ? -1 : 0
    }))
    setLoadingDel(false)
  }, [currentSiteId])

  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])

  if (!canView) return null

  function set(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value }
      if ((field === 'unit_price' || field === 'quantity_delivered') && next.unit_price && next.quantity_delivered) {
        next.total_cost = (Number(next.unit_price) * Number(next.quantity_delivered)).toFixed(2)
      }
      // Auto-calculate litres from dip mm using calibration table
      if (field === 'dip_before_mm' && value !== '') {
        const litres = interpolate(calibration, parseFloat(value))
        if (litres != null) next.dip_before = litres.toFixed(1)
      }
      if (field === 'dip_after_mm' && value !== '') {
        const litres = interpolate(calibration, parseFloat(value))
        if (litres != null) next.dip_after = litres.toFixed(1)
      }
      return next
    })
  }

  function openAdd() {
    setEditId(null)
    setForm({ ...BLANK_FORM, delivery_date: new Date().toISOString().slice(0, 10), delivery_time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) })
    setShowForm(true)
  }

  function openEdit(del) {
    if (del._from_txn) return
    if (!canCreate && !canApprove) return
    setEditId(del.id)
    setForm({
      delivery_date:        del.delivery_date || '',
      delivery_time:        '',
      supplier_name:        del.supplier_name || '',
      delivery_note_number: del.delivery_note_number || '',
      tank_id:              del.tank_id || '',
      quantity_ordered:     del.quantity_ordered != null ? String(del.quantity_ordered) : '',
      quantity_delivered:   del.quantity_delivered != null ? String(del.quantity_delivered) : '',
      unit_price:           del.unit_price != null ? String(del.unit_price) : '',
      total_cost:           del.total_cost != null ? String(del.total_cost) : '',
      dip_before_mm:        del.dip_before_mm != null ? String(del.dip_before_mm) : '',
      dip_before:           del.dip_before != null ? String(del.dip_before) : '',
      dip_after_mm:         del.dip_after_mm != null ? String(del.dip_after_mm) : '',
      dip_after:            del.dip_after != null ? String(del.dip_after) : '',
      receiving_officer:    del.receiving_officer || '',
      notes:                del.notes || '',
    })
    setShowForm(true)
  }

  async function save() {
    if (!form.tank_id) { showToast('Select a receiving tank', 'red'); return }
    if (!form.supplier_name.trim()) { showToast('Enter the supplier name', 'red'); return }
    if (!form.quantity_delivered || isNaN(form.quantity_delivered) || Number(form.quantity_delivered) <= 0) {
      showToast('Enter a valid quantity delivered', 'red'); return
    }

    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const deliveryNumber = 'DEL-' + Date.now()

      const payload = {
        site_id:              currentSiteId,
        delivery_date:        form.delivery_date,
        supplier_name:        form.supplier_name.trim(),
        delivery_note_number: form.delivery_note_number.trim() || null,
        tank_id:              form.tank_id,
        quantity_ordered:     form.quantity_ordered ? Number(form.quantity_ordered) : null,
        quantity_delivered:   Number(form.quantity_delivered),
        unit_price:           form.unit_price ? Number(form.unit_price) : null,
        total_cost:           form.total_cost ? Number(form.total_cost) : null,
        dip_before_mm:        form.dip_before_mm ? Number(form.dip_before_mm) : null,
        dip_before:           form.dip_before ? Number(form.dip_before) : null,
        dip_after_mm:         form.dip_after_mm ? Number(form.dip_after_mm) : null,
        dip_after:            form.dip_after ? Number(form.dip_after) : null,
        notes:                form.notes.trim() || null,
        created_by:           user?.id || null,
      }

      if (editId) {
        const { error } = await supabase
          .from('fuel_deliveries')
          .update({
            delivery_date:        payload.delivery_date,
            supplier_name:        payload.supplier_name,
            delivery_note_number: payload.delivery_note_number,
            tank_id:              payload.tank_id,
            quantity_ordered:     payload.quantity_ordered,
            quantity_delivered:   payload.quantity_delivered,
            unit_price:           payload.unit_price,
            total_cost:           payload.total_cost,
            dip_before_mm:        payload.dip_before_mm,
            dip_before:           payload.dip_before,
            dip_after_mm:         payload.dip_after_mm,
            dip_after:            payload.dip_after,
            receiving_officer:    form.receiving_officer?.trim() || null,
            notes:                payload.notes,
            updated_by:           user?.id || null,
          })
          .eq('id', editId)
          .eq('site_id', currentSiteId)
        if (error) throw error
        showToast('Delivery updated — audit log entry created', 'green')
      } else {
        payload.delivery_number = deliveryNumber

        const { error } = await supabase
          .from('fuel_deliveries')
          .insert([payload])
        if (error) throw error

        // Also record in fuel_transactions to update tank level
        await addTransaction({
          transaction_type:  'delivery',
          transaction_date:  form.delivery_date,
          tank_id:           form.tank_id,
          litres:            Number(form.quantity_delivered),
          unit_price:        form.unit_price ? Number(form.unit_price) : null,
          total_cost:        form.total_cost ? Number(form.total_cost) : null,
          supplier:          form.supplier_name.trim(),
          docket_number:     form.delivery_note_number.trim() || null,
          notes:             form.receiving_officer ? `Received by: ${form.receiving_officer.trim()}${form.notes ? ' | ' + form.notes.trim() : ''}` : (form.notes.trim() || null),
        })

        showToast('Delivery recorded', 'green')
      }

      setShowForm(false)
      setEditId(null)
      fetchDeliveries()
      refreshFuel()
    } catch (err) {
      showToast(err.message || 'Failed to save delivery', 'red')
    } finally {
      setSaving(false)
    }
  }

  async function cancelDelivery() {
    if (!editId) return
    if (!confirm('Cancel this delivery? This will mark it as cancelled (it will not be deleted).')) return
    setSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('fuel_deliveries')
        .update({ status: 'cancelled', updated_by: user?.id || null })
        .eq('id', editId)
        .eq('site_id', currentSiteId)
      if (error) throw error
      showToast('Delivery cancelled', 'green')
      setShowForm(false)
      setEditId(null)
      fetchDeliveries()
      refreshFuel()
    } catch (err) {
      showToast(err.message || 'Failed to cancel delivery', 'red')
    } finally {
      setSaving(false)
    }
  }

  // ── Filtering ────────────────────────────────────────────────────────────────

  const q = search.toLowerCase().trim()
  const filtered = useMemo(() => deliveries.filter(r => {
    if (dateFrom && r.delivery_date < dateFrom) return false
    if (dateTo   && r.delivery_date > dateTo)   return false
    if (tankFilter && r.tank_id !== tankFilter) return false
    if (statusFilter && r.status !== statusFilter) return false
    if (q) {
      const hay = `${r.supplier_name || ''} ${r.delivery_note_number || ''} ${r.notes || ''} ${r.fuel_tanks?.name || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [deliveries, dateFrom, dateTo, tankFilter, statusFilter, q])

  // ── Export ───────────────────────────────────────────────────────────────────

  function exportCsv() {
    const headers = ['Date', 'Tank', 'Fuel Type', 'Supplier', 'Qty Delivered (L)', 'Unit Price', 'Total Cost', 'Delivery Note', 'Dip Before (L)', 'Dip After (L)', 'Status', 'Recorded By', 'Notes']
    const lines = filtered.map(r => [
      r.delivery_date,
      r.fuel_tanks?.name || '',
      r.fuel_tanks?.fuel_types?.name || 'Diesel',
      r.supplier_name || '',
      Number(r.quantity_delivered).toFixed(1),
      r.unit_price != null ? Number(r.unit_price).toFixed(4) : '',
      r.total_cost != null ? Number(r.total_cost).toFixed(2) : '',
      r.delivery_note_number || '',
      r.dip_before != null ? Number(r.dip_before).toFixed(1) : '',
      r.dip_after != null ? Number(r.dip_after).toFixed(1) : '',
      r.status || '',
      r.created_profile?.full_name || '',
      r.notes || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[headers.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `tank-deliveries-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  function printTable() {
    const w = window.open('', '_blank', 'width=900,height=700')
    if (!w) return
    const rows = filtered.map((r, i) => `<tr>
      <td>${i + 1}</td><td>${r.delivery_date}</td><td>${r.fuel_tanks?.name || ''}</td>
      <td>${r.supplier_name || ''}</td><td>${r.fuel_tanks?.fuel_types?.name || 'Diesel'}</td>
      <td style="text-align:right">${Number(r.quantity_delivered).toFixed(1)}</td>
      <td style="text-align:right">${r.unit_price != null ? Number(r.unit_price).toFixed(4) : '—'}</td>
      <td style="text-align:right">${r.total_cost != null ? Number(r.total_cost).toFixed(2) : '—'}</td>
      <td>${r.delivery_note_number || '—'}</td>
      <td>${(STATUS_MAP[r.status] || STATUS_MAP.pending).label}</td>
    </tr>`).join('')
    w.document.write(`<html><head><title>Tank Deliveries</title><style>body{font:11pt monospace;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}</style></head><body>
      <h2>Tank Deliveries — ${currentSite?.name || ''}</h2><p>${filtered.length} records · Printed ${new Date().toLocaleString()}</p>
      <table><thead><tr><th>#</th><th>Date</th><th>Tank</th><th>Supplier</th><th>Fuel</th><th>Qty (L)</th><th>Unit Price</th><th>Total</th><th>Del Note</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></body></html>`)
    w.document.close()
    setTimeout(() => w.print(), 300)
  }

  // ── KPIs ─────────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const monthStart = new Date().toISOString().slice(0, 8) + '01'
    let totalL = 0, totalCost = 0, monthL = 0, monthCount = 0
    const suppliers = new Set()
    for (const r of deliveries) {
      const l = Number(r.quantity_delivered) || 0
      totalL += l
      if (r.total_cost) totalCost += Number(r.total_cost)
      if (r.supplier_name) suppliers.add(r.supplier_name.trim().toLowerCase())
      if (r.delivery_date >= monthStart) { monthL += l; monthCount++ }
    }
    return { totalL, totalCost, monthL, monthCount, suppliers: suppliers.size, count: deliveries.length }
  }, [deliveries])

  if (loadingDel) return null

  return (
    <div style={{ maxWidth: '1100px' }}>
      <PageHeader
        title="Tank Deliveries"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {filtered.length > 0 && (
              <>
                <button onClick={exportCsv} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: THEME.surfaceVar, color: FUEL_CLR, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Icon name="download" size={15} style={{ color: FUEL_CLR }} /> Export
                </button>
                <button onClick={printTable} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '6px', fontSize: '13px', fontWeight: 500, background: THEME.surfaceVar, color: THEME.textMed, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Icon name="print" size={15} style={{ color: THEME.textMed }} /> Print
                </button>
              </>
            )}
            {canCreate && !showForm && <Button onClick={openAdd} icon="local_shipping">Record Delivery</Button>}
          </div>
        }
      />

      {/* ── KPI strip ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <KpiCard icon="water_drop" label="Total delivered" value={`${kpis.totalL.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} color={THEME.success} sub={`${kpis.count} deliver${kpis.count === 1 ? 'y' : 'ies'}`} />
        <KpiCard icon="bar_chart" label="This month" value={`${kpis.monthL.toLocaleString(undefined, { maximumFractionDigits: 0 })} L`} color={FUEL_CLR} sub={kpis.monthCount ? `${kpis.monthCount} deliver${kpis.monthCount === 1 ? 'y' : 'ies'}` : 'None yet'} />
        <KpiCard icon="payments" label="Total cost" value={kpis.totalCost ? `$${kpis.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'} color={THEME.info} />
        <KpiCard icon="storefront" label="Suppliers" value={kpis.suppliers || '—'} color="#5E35B1" />
      </div>

      {/* ── Delivery Form (inline, collapsible) ── */}
      {showForm && canCreate && (
        <Card style={{ marginBottom: '20px', padding: '24px', borderLeft: `4px solid ${FUEL_CLR}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>
              {editId ? 'Edit Delivery' : 'Record New Delivery'}
            </div>
            <button onClick={() => { setShowForm(false); setEditId(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: '4px' }}>
              <Icon name="close" size={20} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '14px' }}>
            <FieldWrap label="Delivery Date" required>
              <input type="date" value={form.delivery_date} onChange={e => set('delivery_date', e.target.value)} style={inputStyle} />
            </FieldWrap>
            <FieldWrap label="Time">
              <input type="time" value={form.delivery_time} onChange={e => set('delivery_time', e.target.value)} style={inputStyle} />
            </FieldWrap>
            <FieldWrap label="Supplier" required>
              <input value={form.supplier_name} onChange={e => set('supplier_name', e.target.value)} placeholder="e.g. NOIC, Zuva" style={inputStyle} />
            </FieldWrap>
            <FieldWrap label="Delivery Note Number">
              <input value={form.delivery_note_number} onChange={e => set('delivery_note_number', e.target.value)} placeholder="e.g. DN-12345" style={inputStyle} />
            </FieldWrap>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '14px' }}>
            <FieldWrap label="Receiving Tank" required>
              <select value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={inputStyle}>
                <option value="">— Select tank —</option>
                {activeTanks.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.fuel_types?.name || 'Diesel'})</option>
                ))}
              </select>
            </FieldWrap>
            <FieldWrap label="Fuel Type">
              <input value={form.tank_id ? (tanks.find(t => t.id === form.tank_id)?.fuel_types?.name || 'Diesel') : ''} disabled style={{ ...inputStyle, opacity: 0.6 }} />
            </FieldWrap>
            <FieldWrap label="Qty Ordered (L)">
              <input type="number" min="0" step="0.1" value={form.quantity_ordered} onChange={e => set('quantity_ordered', e.target.value)} placeholder="Optional" style={inputStyle} />
            </FieldWrap>
            <FieldWrap label="Qty Delivered (L)" required>
              <input type="number" min="0.1" step="0.1" value={form.quantity_delivered} onChange={e => set('quantity_delivered', e.target.value)} placeholder="e.g. 5000" style={inputStyle} />
            </FieldWrap>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '14px' }}>
            <FieldWrap label="Unit Price (per litre)">
              <input type="number" min="0" step="0.01" value={form.unit_price} onChange={e => set('unit_price', e.target.value)} placeholder="e.g. 1.85" style={inputStyle} />
            </FieldWrap>
            <FieldWrap label="Total Cost (USD)">
              <input type="number" min="0" step="0.01" value={form.total_cost} onChange={e => set('total_cost', e.target.value)} placeholder="Auto-calculated" style={inputStyle} />
            </FieldWrap>
            <FieldWrap label="Dip Before (mm)">
              <input type="number" min="0" step="0.1" value={form.dip_before_mm} onChange={e => set('dip_before_mm', e.target.value)} placeholder="e.g. 850" style={inputStyle} />
              {form.dip_before && <div style={{ fontSize: '11px', color: THEME.textMed, marginTop: '4px' }}>{Number(form.dip_before).toLocaleString(undefined, { maximumFractionDigits: 1 })} L</div>}
              {calibration.length === 0 && form.dip_before_mm && <div style={{ fontSize: '11px', color: THEME.warning, marginTop: '2px' }}>No calibration table</div>}
            </FieldWrap>
            <FieldWrap label="Dip After (mm)">
              <input type="number" min="0" step="0.1" value={form.dip_after_mm} onChange={e => set('dip_after_mm', e.target.value)} placeholder="e.g. 1200" style={inputStyle} />
              {form.dip_after && <div style={{ fontSize: '11px', color: THEME.success, marginTop: '4px', fontWeight: 600 }}>{Number(form.dip_after).toLocaleString(undefined, { maximumFractionDigits: 1 })} L → new tank level</div>}
              {calibration.length === 0 && form.dip_after_mm && <div style={{ fontSize: '11px', color: THEME.warning, marginTop: '2px' }}>No calibration table</div>}
            </FieldWrap>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <FieldWrap label="Receiving Officer">
              <input value={form.receiving_officer} onChange={e => set('receiving_officer', e.target.value)} placeholder="Name of person receiving" style={inputStyle} />
            </FieldWrap>
            <FieldWrap label="Notes">
              <input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional notes…" style={inputStyle} />
            </FieldWrap>
          </div>

          {/* Dip variance info */}
          {form.dip_before && form.dip_after && form.quantity_delivered && (() => {
            const actualGain = Number(form.dip_after) - Number(form.dip_before)
            const expected = Number(form.quantity_delivered)
            const variance = actualGain - expected
            const pct = expected ? ((variance / expected) * 100).toFixed(1) : 0
            return (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '10px',
                background: Math.abs(variance) > expected * 0.02 ? THEME.statusWarningBg : THEME.statusSuccessBg,
                border: `1px solid ${Math.abs(variance) > expected * 0.02 ? THEME.warning + '55' : THEME.success + '55'}`,
                marginBottom: '14px', fontSize: '12px',
              }}>
                <Icon name={Math.abs(variance) > expected * 0.02 ? 'warning' : 'check_circle'} size={16} style={{ color: Math.abs(variance) > expected * 0.02 ? THEME.warning : THEME.success }} />
                <span>
                  Dip variance: {actualGain.toFixed(1)} L measured vs {expected.toFixed(1)} L delivered = <strong>{variance >= 0 ? '+' : ''}{variance.toFixed(1)} L ({pct}%)</strong>
                </span>
              </div>
            )
          })()}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', alignItems: 'center' }}>
            {editId && (
              <button onClick={cancelDelivery} disabled={saving} style={{
                padding: '10px 20px', borderRadius: '6px', border: `1px solid ${THEME.error}`,
                background: 'transparent', color: THEME.error, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                <Icon name="delete" size={15} style={{ color: THEME.error }} /> Cancel Delivery
              </button>
            )}
            <button onClick={() => { setShowForm(false); setEditId(null) }} style={{
              padding: '10px 20px', borderRadius: '6px', border: `1px solid ${THEME.outline}`,
              background: 'transparent', color: THEME.textMed, fontSize: '14px', fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
            }}>Cancel</button>
            <button onClick={save} disabled={saving} style={{
              padding: '10px 24px', borderRadius: '6px', border: 'none',
              background: saving ? THEME.outline : FUEL_CLR, color: '#fff',
              fontSize: '14px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              {saving ? 'Saving…' : editId ? 'Update Delivery' : 'Record Delivery'}
            </button>
          </div>
        </Card>
      )}

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Search</div>
          <div style={{ position: 'relative' }}>
            <Icon name="search" size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Supplier, note, tank…" style={{ ...filterInputStyle, paddingLeft: '32px', width: '100%', boxSizing: 'border-box' }} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInputStyle} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInputStyle} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Tank</div>
          <select value={tankFilter} onChange={e => setTankFilter(e.target.value)} style={filterInputStyle}>
            <option value="">All tanks</option>
            {activeTanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>Status</div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={filterInputStyle}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="queried">Queried</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        {(dateFrom || dateTo || search || tankFilter || statusFilter) && (
          <button onClick={() => { setDateFrom(''); setDateTo(''); setSearch(''); setTankFilter(''); setStatusFilter('') }} style={{ background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '8px', padding: '9px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textMed, fontFamily: 'inherit', alignSelf: 'flex-end' }}>Clear</button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: THEME.textLow, alignSelf: 'flex-end', paddingBottom: '2px' }}>
          {filtered.length} record{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* ── Delivery History Table ── */}
      <Card style={{ padding: 0 }}>
        {deliveries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="local_shipping" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No fuel deliveries recorded yet.</p>
            {canCreate && <p style={{ fontSize: '13px', color: FUEL_CLR, cursor: 'pointer', marginTop: '8px' }} onClick={openAdd}>Record your first delivery</p>}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="search_off" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>No deliveries match your filters.</p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Tank</Th>
              <Th>Supplier</Th>
              <Th>Fuel Type</Th>
              <Th align="right">Quantity</Th>
              <Th align="right">Unit Price</Th>
              <Th align="right">Total Cost</Th>
              <Th>Delivery Note</Th>
              <Th>Status</Th>
              <Th>Recorded By</Th>
            </THead>
            <tbody>
              {filtered.map((r, idx) => {
                const st = STATUS_MAP[r.status] || STATUS_MAP.pending
                return (
                  <TRow key={r.id} last={idx === filtered.length - 1}
                    onClick={() => openEdit(r)}
                    style={{ cursor: (!r._from_txn && (canCreate || canApprove)) ? 'pointer' : 'default' }}
                  >
                    <Td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.delivery_date)}</Td>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Icon name="propane_tank" size={15} style={{ color: FUEL_CLR }} />
                        <span style={{ fontWeight: 500 }}>{r.fuel_tanks?.name || '—'}</span>
                      </div>
                    </Td>
                    <Td>
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: THEME.statusInfoBg, color: THEME.statusInfoText }}>
                        {r.supplier_name}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ padding: '2px 9px', borderRadius: '6px', fontSize: '10px', fontWeight: 700, background: THEME.surfaceVar, color: THEME.textMed, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                        {r.fuel_tanks?.fuel_types?.name || 'Diesel'}
                      </span>
                    </Td>
                    <Td align="right" style={{ fontWeight: 700, color: THEME.success, whiteSpace: 'nowrap' }}>
                      +{Number(r.quantity_delivered).toLocaleString(undefined, { maximumFractionDigits: 1 })} L
                    </Td>
                    <Td align="right" style={{ color: THEME.textMed, whiteSpace: 'nowrap' }}>
                      {r.unit_price != null ? `$${Number(r.unit_price).toFixed(4)}` : '—'}
                    </Td>
                    <Td align="right" style={{ color: THEME.textMed, whiteSpace: 'nowrap' }}>
                      {r.total_cost != null ? `$${Number(r.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </Td>
                    <Td style={{ fontFamily: 'monospace', fontSize: '12px', color: THEME.textMed }}>
                      {r.delivery_note_number || '—'}
                    </Td>
                    <Td>
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, background: st.bg, color: st.text, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        {st.label}
                      </span>
                    </Td>
                    <Td style={{ fontSize: '12px', color: THEME.textMed }}>
                      {r.created_profile?.full_name || '—'}
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  )
}

function KpiCard({ icon, label, value, sub, color }) {
  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '12px', padding: '14px 16px',
      display: 'flex', gap: '12px', alignItems: 'flex-start',
      boxShadow: '0 1px 2px rgba(0,0,0,.03)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '10px', flexShrink: 0,
        background: color + '16',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={18} style={{ color }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '3px' }}>{label}</div>
        <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
        {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{sub}</div>}
      </div>
    </div>
  )
}
