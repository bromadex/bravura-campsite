import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, Modal, showToast } from '../../components/ui'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'
import { createDeliveryJournal } from '../../utils/financeIntegration'

const ACCENT = MODULE_COLORS.concrete
const LEAD_TIME_DAYS = 7

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: '8px', fontSize: '14px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text,
  fontFamily: 'inherit', boxSizing: 'border-box',
}
const labelStyle = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }

const emptyForm = {
  supplier: '', delivery_note_number: '', truck_registration: '',
  quantity_kg: '', unit_cost: '', silo_number: '', delivery_date: new Date().toISOString().slice(0, 10), notes: '',
}

export default function CementInventory({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [deliveries, setDeliveries] = useState([])
  const [totalConsumed, setTotalConsumed] = useState(0)
  const [avgDaily, setAvgDaily] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const canView = can('concrete.view')
  const canCreate = can('concrete.create')
  const canEdit = can('concrete.edit')

  // ── Fetch deliveries ──────────────────────────────────────────────────────
  async function fetchDeliveries() {
    if (!currentSiteId) return
    const { data, error } = await supabase
      .from('cement_deliveries')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('delivery_date', { ascending: false })
    if (error) { showToast(error.message, 'error'); return }
    setDeliveries(data || [])
  }

  // ── Fetch consumed total + avg daily (last 30 days) ───────────────────────
  async function fetchConsumption() {
    if (!currentSiteId) return
    // Total consumed (all time, non-archived batches)
    const { data: allBatches, error: e1 } = await supabase
      .from('concrete_batches')
      .select('actual_cement_kg')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
    if (e1) { showToast(e1.message, 'error'); return }
    const total = (allBatches || []).reduce((s, b) => s + (Number(b.actual_cement_kg) || 0), 0)
    setTotalConsumed(total)

    // Avg daily (last 30 days)
    const d30 = new Date()
    d30.setDate(d30.getDate() - 30)
    const { data: recent, error: e2 } = await supabase
      .from('concrete_batches')
      .select('actual_cement_kg')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .gte('created_at', d30.toISOString())
    if (e2) { showToast(e2.message, 'error'); return }
    const sum30 = (recent || []).reduce((s, b) => s + (Number(b.actual_cement_kg) || 0), 0)
    setAvgDaily(sum30 / 30)
  }

  useEffect(() => {
    if (!currentSiteId) return
    setLoading(true)
    Promise.all([fetchDeliveries(), fetchConsumption()]).finally(() => setLoading(false))
  }, [currentSiteId])

  // ── Computed ──────────────────────────────────────────────────────────────
  const totalDelivered = useMemo(() => deliveries.reduce((s, d) => s + (Number(d.quantity_kg) || 0), 0), [deliveries])
  const remaining = totalDelivered - totalConsumed
  const daysRemaining = avgDaily > 0 ? Math.floor(remaining / avgDaily) : remaining > 0 ? 999 : 0

  const stockColor = daysRemaining > 14 ? '#2E7D32' : daysRemaining >= 7 ? '#F9A825' : '#C62828'
  const stockLabel = daysRemaining > 14 ? 'Healthy' : daysRemaining >= 7 ? 'Low Stock' : 'Critical'
  const showOrderNow = daysRemaining <= LEAD_TIME_DAYS && avgDaily > 0

  const filtered = useMemo(() => {
    if (!search.trim()) return deliveries
    const q = search.toLowerCase()
    return deliveries.filter(d =>
      (d.supplier || '').toLowerCase().includes(q) ||
      (d.delivery_note_number || '').toLowerCase().includes(q)
    )
  }, [deliveries, search])

  // ── Add delivery ──────────────────────────────────────────────────────────
  const totalCost = (Number(form.quantity_kg) || 0) * (Number(form.unit_cost) || 0)

  async function handleSave() {
    if (!form.supplier.trim()) { showToast('Supplier is required', 'error'); return }
    if (!form.quantity_kg || Number(form.quantity_kg) <= 0) { showToast('Quantity must be > 0', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('cement_deliveries').insert({
      site_id: currentSiteId,
      supplier: form.supplier.trim(),
      delivery_note_number: form.delivery_note_number.trim() || null,
      truck_registration: form.truck_registration.trim() || null,
      quantity_kg: Number(form.quantity_kg),
      unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
      total_cost: totalCost || null,
      silo_number: form.silo_number.trim() || null,
      delivery_date: form.delivery_date || new Date().toISOString().slice(0, 10),
      notes: form.notes.trim() || null,
      created_by: user?.id || null,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'error'); return }

    // Auto-create draft journal entry for the delivery
    if (totalCost > 0) {
      const dn = form.delivery_note_number.trim()
      const desc = `Cement delivery: ${form.supplier.trim()} — ${Number(form.quantity_kg)}kg${dn ? ` — DN#${dn}` : ''}`
      const jr = await createDeliveryJournal({ supabase, siteId: currentSiteId, userId: user?.id, description: desc, totalCost })
      showToast(jr.success ? 'Delivery saved. Draft journal entry created.' : 'Delivery saved.', jr.success ? 'success' : undefined)
    } else {
      showToast('Delivery recorded')
    }
    setShowAdd(false)
    setForm(emptyForm)
    fetchDeliveries()
    fetchConsumption()
  }

  // ── Archive ───────────────────────────────────────────────────────────────
  async function handleArchive(id) {
    const { error } = await supabase.from('cement_deliveries').update({ is_archived: true }).eq('id', id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Delivery archived')
    fetchDeliveries()
    fetchConsumption()
  }

  // ── Denied ────────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_cement" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view cement inventory.</p>
        </Card>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '32px 24px', maxWidth: '1200px' }}>
      <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_cement" />

      <PageHeader
        title="Cement Inventory"
        actions={
          canCreate && (
            <Button icon="add" onClick={() => setShowAdd(true)}>Record Delivery</Button>
          )
        }
      />

      {/* ── Stock overview cards ─────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <Card style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px' }}>Total Delivered</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: THEME.text }}>{fmt(totalDelivered)} kg</div>
        </Card>
        <Card style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px' }}>Total Consumed</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: THEME.text }}>{fmt(totalConsumed)} kg</div>
        </Card>
        <Card style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px' }}>Remaining Stock</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: stockColor }}>{fmt(remaining)} kg</div>
        </Card>
        <Card style={{ padding: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px' }}>Days of Stock</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px', fontWeight: 700, color: stockColor }}>
              {avgDaily > 0 ? daysRemaining : '--'}
            </span>
            <span style={{
              fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px',
              background: stockColor + '18', color: stockColor,
            }}>{stockLabel}</span>
            {showOrderNow && (
              <span style={{
                fontSize: '11px', fontWeight: 700, padding: '3px 8px', borderRadius: '6px',
                background: '#C62828', color: '#fff', animation: 'pulse 1.5s infinite',
              }}>ORDER NOW</span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>
            Avg daily: {avgDaily > 0 ? fmt(avgDaily) : '0'} kg/day (30-day)
          </div>
        </Card>
      </div>

      {/* ── Search ───────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '16px', maxWidth: '360px' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={18} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            placeholder="Search supplier or delivery note..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ ...inputStyle, paddingLeft: '34px' }}
          />
        </div>
      </div>

      {/* ── Deliveries table ─────────────────────────────────────────────── */}
      <SectionLabel>Deliveries</SectionLabel>
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <p style={{ color: THEME.textMed, fontSize: '14px' }}>Loading...</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="inventory" size={40} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '10px', fontSize: '14px' }}>
            {search ? 'No deliveries match your search.' : 'No cement deliveries recorded yet.'}
          </p>
        </Card>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                {['Date', 'Supplier', 'Delivery Note', 'Truck', 'Silo', 'Qty (kg)', 'Unit Cost', 'Total', 'Notes', ''].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 8px', color: THEME.textMed, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => (
                <tr key={d.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <td style={cellStyle}>{d.delivery_date}</td>
                  <td style={{ ...cellStyle, fontWeight: 600, color: THEME.text }}>{d.supplier}</td>
                  <td style={cellStyle}>{d.delivery_note_number || '--'}</td>
                  <td style={cellStyle}>{d.truck_registration || '--'}</td>
                  <td style={cellStyle}>{d.silo_number || '--'}</td>
                  <td style={{ ...cellStyle, fontWeight: 600 }}>{fmt(d.quantity_kg)}</td>
                  <td style={cellStyle}>{d.unit_cost != null ? `$${Number(d.unit_cost).toFixed(2)}` : '--'}</td>
                  <td style={cellStyle}>{d.total_cost != null ? `$${fmt(d.total_cost)}` : '--'}</td>
                  <td style={{ ...cellStyle, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.notes || '--'}</td>
                  <td style={cellStyle}>
                    {canEdit && (
                      <button
                        onClick={() => handleArchive(d.id)}
                        title="Archive"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px' }}
                      >
                        <Icon name="archive" size={16} style={{ color: THEME.textLow }} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add delivery modal ───────────────────────────────────────────── */}
      <Modal
        open={showAdd}
        onClose={() => { setShowAdd(false); setForm(emptyForm) }}
        title="Record Cement Delivery"
        dirty={!!form.supplier || !!form.quantity_kg}
        footer={<>
          <Button variant="tonal" onClick={() => { setShowAdd(false); setForm(emptyForm) }}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Delivery'}</Button>
        </>}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderRadius: '8px', background: '#E3F2FD', marginBottom: '14px', fontSize: '12px', color: '#1565C0' }}>
          <Icon name="info" size={16} style={{ color: '#1565C0', flexShrink: 0 }} />
          A draft journal entry will be created in Finance for this delivery.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Supplier *</label>
            <input style={inputStyle} value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="e.g. PPC Cement" />
          </div>
          <div>
            <label style={labelStyle}>Delivery Note #</label>
            <input style={inputStyle} value={form.delivery_note_number} onChange={e => setForm(f => ({ ...f, delivery_note_number: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Truck Registration</label>
            <input style={inputStyle} value={form.truck_registration} onChange={e => setForm(f => ({ ...f, truck_registration: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Quantity (kg) *</label>
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.quantity_kg} onChange={e => setForm(f => ({ ...f, quantity_kg: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Unit Cost ($)</label>
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.unit_cost} onChange={e => setForm(f => ({ ...f, unit_cost: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle}>Total Cost</label>
            <div style={{ ...inputStyle, background: THEME.surfaceVar, color: THEME.textMed }}>
              {totalCost > 0 ? `$${fmt(totalCost)}` : '--'}
            </div>
          </div>
          <div>
            <label style={labelStyle}>Silo Number</label>
            <input style={inputStyle} value={form.silo_number} onChange={e => setForm(f => ({ ...f, silo_number: e.target.value }))} placeholder="e.g. Silo 1" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Delivery Date</label>
            <input style={inputStyle} type="date" value={form.delivery_date} onChange={e => setForm(f => ({ ...f, delivery_date: e.target.value }))} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={labelStyle}>Notes</label>
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </Modal>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.6} }`}</style>
    </div>
  )
}

const cellStyle = { padding: '10px 8px', color: THEME.textMed, whiteSpace: 'nowrap' }

function fmt(n) {
  return Number(n || 0).toLocaleString('en', { maximumFractionDigits: 2 })
}
