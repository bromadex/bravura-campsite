import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import {
  Card, Icon, Button, PageHeader, SectionLabel, showToast,
  Modal, Chip, TableWrap, THead, Th, TRow, Td, fmtDate, StatCard,
} from '../../components/ui'
import QuickNav, { CONCRETE_PILLS } from '../../components/QuickNav'
import { createDeliveryJournal } from '../../utils/financeIntegration'

const CLR = MODULE_COLORS.concrete

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, display: 'block',
}

function FieldWrap({ label, required, children, span }) {
  return (
    <div style={{ gridColumn: span ? `span ${span}` : undefined }}>
      <div style={{
        fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px',
        textTransform: 'uppercase', letterSpacing: '.05em',
      }}>
        {label}{required && <span style={{ color: THEME.error, marginLeft: '3px' }}>*</span>}
      </div>
      {children}
    </div>
  )
}

const BLANK_DELIVERY = {
  aggregate_type_id: '',
  supplier: '',
  delivery_note_number: '',
  quantity_kg: '',
  unit_cost: '',
  stockpile_location: '',
  delivery_date: new Date().toISOString().slice(0, 10),
  notes: '',
}

const BLANK_TYPE = { name: '', unit: 'kg' }

// Days-remaining color coding (same logic as cement)
function reorderColor(daysRemaining) {
  if (daysRemaining == null) return { bg: THEME.surfaceVar, text: THEME.textLow, label: 'No data' }
  if (daysRemaining <= 3)  return { bg: THEME.statusErrorBg,   text: THEME.statusErrorText,   label: 'Critical' }
  if (daysRemaining <= 7)  return { bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'Low' }
  return { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'OK' }
}

export default function AggregateInventory({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { user } = useAuth()

  const canView   = can('concrete.view')
  const canCreate = can('concrete.create')
  const canEdit   = can('concrete.edit')

  // Data
  const [aggTypes, setAggTypes]       = useState([])
  const [deliveries, setDeliveries]   = useState([])
  const [consumed, setConsumed]       = useState({}) // { aggregate_type_id: total_actual_kg }
  const [loading, setLoading]         = useState(true)

  // Modals
  const [showDeliveryModal, setShowDeliveryModal] = useState(false)
  const [deliveryForm, setDeliveryForm]           = useState(BLANK_DELIVERY)
  const [saving, setSaving]                       = useState(false)
  const [showTypeModal, setShowTypeModal]         = useState(false)
  const [typeForm, setTypeForm]                   = useState(BLANK_TYPE)
  const [savingType, setSavingType]               = useState(false)

  // Filter
  const [filterTypeId, setFilterTypeId] = useState('')

  // ── Fetch aggregate types ──────────────────────────────────────────────────
  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('aggregate_types')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('name')
      .then(({ data, error }) => {
        if (error) console.error('aggregate_types:', error)
        setAggTypes(data || [])
      })
  }, [currentSiteId])

  // ── Fetch deliveries ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('aggregate_deliveries')
      .select('*, aggregate_types(name, unit)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('delivery_date', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('aggregate_deliveries:', error)
        setDeliveries(data || [])
        setLoading(false)
      })
  }, [currentSiteId])

  // ── Fetch consumed totals (batch_aggregates joined to concrete_batches) ────
  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('batch_aggregates')
      .select('aggregate_type_id, actual_qty_kg, concrete_batches!inner(site_id, is_archived)')
      .eq('concrete_batches.site_id', currentSiteId)
      .eq('concrete_batches.is_archived', false)
      .then(({ data, error }) => {
        if (error) console.error('batch_aggregates:', error)
        const map = {}
        ;(data || []).forEach(r => {
          const id = r.aggregate_type_id
          map[id] = (map[id] || 0) + (Number(r.actual_qty_kg) || 0)
        })
        setConsumed(map)
      })
  }, [currentSiteId])

  // ── Computed stock per type ─────────────────────────────────────────────────
  const stockByType = useMemo(() => {
    const delivered = {}
    deliveries.forEach(d => {
      delivered[d.aggregate_type_id] = (delivered[d.aggregate_type_id] || 0) + (Number(d.quantity_kg) || 0)
    })
    return aggTypes.map(t => {
      const totalDelivered = delivered[t.id] || 0
      const totalConsumed  = consumed[t.id] || 0
      const remaining      = totalDelivered - totalConsumed

      // avg daily consumption over last 30 days
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const recentDeliveries = deliveries.filter(d =>
        d.aggregate_type_id === t.id && new Date(d.delivery_date) >= thirtyDaysAgo
      )
      // approximate daily rate from total consumed / 30
      const dailyRate = totalConsumed > 0 ? totalConsumed / 30 : null
      const daysRemaining = dailyRate && dailyRate > 0 ? Math.round(remaining / dailyRate) : null

      return {
        ...t,
        totalDelivered,
        totalConsumed,
        remaining,
        dailyRate,
        daysRemaining,
      }
    })
  }, [aggTypes, deliveries, consumed])

  // ── Filtered deliveries ────────────────────────────────────────────────────
  const filteredDeliveries = useMemo(() => {
    if (!filterTypeId) return deliveries
    return deliveries.filter(d => d.aggregate_type_id === filterTypeId)
  }, [deliveries, filterTypeId])

  // ── Refresh helper ─────────────────────────────────────────────────────────
  function refresh() {
    setLoading(true)
    Promise.all([
      supabase.from('aggregate_types').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
      supabase.from('aggregate_deliveries').select('*, aggregate_types(name, unit)').eq('site_id', currentSiteId).eq('is_archived', false).order('delivery_date', { ascending: false }),
      supabase.from('batch_aggregates').select('aggregate_type_id, actual_qty_kg, concrete_batches!inner(site_id, is_archived)').eq('concrete_batches.site_id', currentSiteId).eq('concrete_batches.is_archived', false),
    ]).then(([typesRes, delRes, conRes]) => {
      setAggTypes(typesRes.data || [])
      setDeliveries(delRes.data || [])
      const map = {}
      ;(conRes.data || []).forEach(r => {
        const id = r.aggregate_type_id
        map[id] = (map[id] || 0) + (Number(r.actual_qty_kg) || 0)
      })
      setConsumed(map)
      setLoading(false)
    })
  }

  // ── Save delivery ──────────────────────────────────────────────────────────
  async function saveDelivery() {
    if (!deliveryForm.aggregate_type_id || !deliveryForm.quantity_kg) {
      showToast('Aggregate type and quantity are required', 'error')
      return
    }
    setSaving(true)
    const qty  = Number(deliveryForm.quantity_kg) || 0
    const unit = Number(deliveryForm.unit_cost) || 0
    const { error } = await supabase.from('aggregate_deliveries').insert({
      site_id: currentSiteId,
      aggregate_type_id: deliveryForm.aggregate_type_id,
      supplier: deliveryForm.supplier || null,
      delivery_note_number: deliveryForm.delivery_note_number || null,
      quantity_kg: qty,
      unit_cost: unit || null,
      total_cost: unit ? qty * unit : null,
      stockpile_location: deliveryForm.stockpile_location || null,
      delivery_date: deliveryForm.delivery_date || new Date().toISOString().slice(0, 10),
      notes: deliveryForm.notes || null,
      created_by: user?.id || null,
    })
    setSaving(false)
    if (error) {
      showToast('Failed to save delivery: ' + error.message, 'error')
      return
    }

    // Auto-create draft journal entry for the delivery
    const deliveryTotal = unit ? qty * unit : 0
    if (deliveryTotal > 0) {
      const typeName = aggTypes.find(t => t.id === deliveryForm.aggregate_type_id)?.name || 'Aggregate'
      const desc = `Aggregate delivery: ${typeName} from ${deliveryForm.supplier || 'unknown'} — ${qty}kg`
      const jr = await createDeliveryJournal({ supabase, siteId: currentSiteId, userId: user?.id, description: desc, totalCost: deliveryTotal })
      showToast(jr.success ? 'Delivery saved. Draft journal entry created.' : 'Delivery saved.', jr.success ? 'success' : undefined)
    } else {
      showToast('Delivery recorded', 'success')
    }
    setShowDeliveryModal(false)
    setDeliveryForm(BLANK_DELIVERY)
    refresh()
  }

  // ── Save aggregate type ────────────────────────────────────────────────────
  async function saveType() {
    if (!typeForm.name.trim()) {
      showToast('Name is required', 'error')
      return
    }
    setSavingType(true)
    const { error } = await supabase.from('aggregate_types').insert({
      site_id: currentSiteId,
      name: typeForm.name.trim(),
      unit: typeForm.unit || 'kg',
    })
    setSavingType(false)
    if (error) {
      showToast('Failed to add type: ' + error.message, 'error')
      return
    }
    showToast('Aggregate type added', 'success')
    setShowTypeModal(false)
    setTypeForm(BLANK_TYPE)
    refresh()
  }

  // ── Archive delivery ───────────────────────────────────────────────────────
  async function archiveDelivery(id) {
    const { error } = await supabase.from('aggregate_deliveries').update({ is_archived: true }).eq('id', id)
    if (error) {
      showToast('Archive failed: ' + error.message, 'error')
      return
    }
    showToast('Delivery archived', 'success')
    refresh()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_aggregates" />
        <Card style={{ textAlign: 'center', padding: '40px' }}>
          <Icon name="lock" size={40} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px' }}>You do not have permission to view aggregate inventory.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: '1200px' }}>
      <QuickNav pills={CONCRETE_PILLS} setPage={setPage} current="co_aggregates" />

      <PageHeader
        title="Aggregate Inventory"
        site={currentSite}
        actions={
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {canEdit && (
              <Button variant="outlined" size="sm" icon="category" onClick={() => setShowTypeModal(true)}>
                Manage Types
              </Button>
            )}
            {canCreate && (
              <Button icon="add" size="sm" onClick={() => {
                setDeliveryForm(BLANK_DELIVERY)
                setShowDeliveryModal(true)
              }}>
                Record Delivery
              </Button>
            )}
          </div>
        }
      />

      {/* ── Stock overview cards ─────────────────────────────────────────── */}
      <SectionLabel>Stock Overview</SectionLabel>
      {stockByType.length === 0 && !loading && (
        <Card style={{ textAlign: 'center', padding: '32px', marginBottom: '20px' }}>
          <Icon name="layers" size={36} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '8px', fontSize: '13px' }}>
            No aggregate types configured.{canEdit && ' Click "Manage Types" to add some.'}
          </p>
        </Card>
      )}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
        gap: '14px', marginBottom: '28px',
      }}>
        {stockByType.map(s => {
          const rc = reorderColor(s.daysRemaining)
          return (
            <Card key={s.id} style={{ padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
              {/* color accent bar */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '3px',
                background: CLR,
              }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{
                  fontSize: '13px', fontWeight: 600, color: THEME.text,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {s.name}
                </div>
                <div style={{
                  fontSize: '10px', fontWeight: 600, padding: '2px 8px',
                  borderRadius: '6px', background: rc.bg, color: rc.text,
                  whiteSpace: 'nowrap',
                }}>
                  {s.daysRemaining != null ? `${s.daysRemaining}d` : '—'}
                </div>
              </div>
              <div style={{ fontSize: '26px', fontWeight: 700, color: THEME.text, lineHeight: 1.1, marginBottom: '8px' }}>
                {s.remaining.toLocaleString()} <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.textMed }}>{s.unit || 'kg'}</span>
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: THEME.textLow }}>
                <span>In: {s.totalDelivered.toLocaleString()}</span>
                <span>Out: {s.totalConsumed.toLocaleString()}</span>
              </div>
              {s.dailyRate != null && (
                <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '4px' }}>
                  ~{Math.round(s.dailyRate).toLocaleString()} {s.unit || 'kg'}/day avg
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* ── Filter row ───────────────────────────────────────────────────── */}
      <SectionLabel>Deliveries Log</SectionLabel>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
        <Chip active={!filterTypeId} onClick={() => setFilterTypeId('')}>All</Chip>
        {aggTypes.map(t => (
          <Chip key={t.id} active={filterTypeId === t.id} onClick={() => setFilterTypeId(t.id)} color={CLR}>
            {t.name}
          </Chip>
        ))}
      </div>

      {/* ── Deliveries table ─────────────────────────────────────────────── */}
      {loading ? (
        <Card style={{ textAlign: 'center', padding: '32px' }}>
          <p style={{ color: THEME.textMed, fontSize: '13px' }}>Loading deliveries...</p>
        </Card>
      ) : filteredDeliveries.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '32px' }}>
          <Icon name="local_shipping" size={36} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '8px', fontSize: '13px' }}>No deliveries recorded yet.</p>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <Th>Date</Th>
            <Th>Type</Th>
            <Th>Supplier</Th>
            <Th>DN #</Th>
            <Th align="right">Qty (kg)</Th>
            <Th align="right">Unit Cost</Th>
            <Th align="right">Total</Th>
            <Th>Stockpile</Th>
            <Th>Notes</Th>
            {canEdit && <Th align="center">Actions</Th>}
          </THead>
          <tbody>
            {filteredDeliveries.map((d, i) => (
              <TRow key={d.id} last={i === filteredDeliveries.length - 1}>
                <Td>{fmtDate(d.delivery_date)}</Td>
                <Td style={{ fontWeight: 500 }}>{d.aggregate_types?.name || '—'}</Td>
                <Td>{d.supplier || '—'}</Td>
                <Td style={{ fontSize: '12px', fontFamily: 'monospace' }}>{d.delivery_note_number || '—'}</Td>
                <Td align="right" style={{ fontWeight: 600 }}>{Number(d.quantity_kg).toLocaleString()}</Td>
                <Td align="right">{d.unit_cost != null ? `$${Number(d.unit_cost).toFixed(2)}` : '—'}</Td>
                <Td align="right">{d.total_cost != null ? `$${Number(d.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</Td>
                <Td>{d.stockpile_location || '—'}</Td>
                <Td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.notes || '—'}
                </Td>
                {canEdit && (
                  <Td align="center">
                    <Button variant="ghost" size="sm" icon="archive" onClick={() => archiveDelivery(d.id)}>
                      Archive
                    </Button>
                  </Td>
                )}
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      {/* ── Add delivery modal ───────────────────────────────────────────── */}
      <Modal
        open={showDeliveryModal}
        onClose={() => setShowDeliveryModal(false)}
        title="Record Aggregate Delivery"
        maxWidth="620px"
        footer={
          <>
            <Button variant="outlined" onClick={() => setShowDeliveryModal(false)}>Cancel</Button>
            <Button icon="save" onClick={saveDelivery} disabled={saving}>
              {saving ? 'Saving...' : 'Save Delivery'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <FieldWrap label="Aggregate Type" required>
            <select
              value={deliveryForm.aggregate_type_id}
              onChange={e => setDeliveryForm(f => ({ ...f, aggregate_type_id: e.target.value }))}
              style={inputStyle}
            >
              <option value="">Select type...</option>
              {aggTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </FieldWrap>
          <FieldWrap label="Delivery Date" required>
            <input
              type="date"
              value={deliveryForm.delivery_date}
              onChange={e => setDeliveryForm(f => ({ ...f, delivery_date: e.target.value }))}
              style={inputStyle}
            />
          </FieldWrap>
          <FieldWrap label="Supplier">
            <input
              value={deliveryForm.supplier}
              onChange={e => setDeliveryForm(f => ({ ...f, supplier: e.target.value }))}
              placeholder="Supplier name"
              style={inputStyle}
            />
          </FieldWrap>
          <FieldWrap label="Delivery Note #">
            <input
              value={deliveryForm.delivery_note_number}
              onChange={e => setDeliveryForm(f => ({ ...f, delivery_note_number: e.target.value }))}
              placeholder="DN-0001"
              style={inputStyle}
            />
          </FieldWrap>
          <FieldWrap label="Quantity (kg)" required>
            <input
              type="number"
              min="0"
              step="0.01"
              value={deliveryForm.quantity_kg}
              onChange={e => setDeliveryForm(f => ({ ...f, quantity_kg: e.target.value }))}
              placeholder="0"
              style={inputStyle}
            />
          </FieldWrap>
          <FieldWrap label="Unit Cost ($)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={deliveryForm.unit_cost}
              onChange={e => setDeliveryForm(f => ({ ...f, unit_cost: e.target.value }))}
              placeholder="0.00"
              style={inputStyle}
            />
          </FieldWrap>
          {deliveryForm.quantity_kg && deliveryForm.unit_cost && (
            <FieldWrap label="Total Cost (auto)">
              <div style={{
                padding: '10px 14px', background: THEME.surfaceVar, borderRadius: '12px',
                fontSize: '14px', fontWeight: 600, color: THEME.text,
              }}>
                ${(Number(deliveryForm.quantity_kg) * Number(deliveryForm.unit_cost)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </FieldWrap>
          )}
          <FieldWrap label="Stockpile Location">
            <input
              value={deliveryForm.stockpile_location}
              onChange={e => setDeliveryForm(f => ({ ...f, stockpile_location: e.target.value }))}
              placeholder="e.g. Stockpile A"
              style={inputStyle}
            />
          </FieldWrap>
          <FieldWrap label="Notes" span={2}>
            <textarea
              value={deliveryForm.notes}
              onChange={e => setDeliveryForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes..."
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </FieldWrap>
        </div>
      </Modal>

      {/* ── Add aggregate type modal ─────────────────────────────────────── */}
      <Modal
        open={showTypeModal}
        onClose={() => setShowTypeModal(false)}
        title="Manage Aggregate Types"
        maxWidth="440px"
        footer={
          <>
            <Button variant="outlined" onClick={() => setShowTypeModal(false)}>Close</Button>
            <Button icon="add" onClick={saveType} disabled={savingType}>
              {savingType ? 'Adding...' : 'Add Type'}
            </Button>
          </>
        }
      >
        {/* Existing types */}
        {aggTypes.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Existing Types
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {aggTypes.map(t => (
                <span key={t.id} style={{
                  padding: '4px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 500,
                  background: CLR + '14', color: CLR, border: `1px solid ${CLR}30`,
                }}>
                  {t.name} ({t.unit || 'kg'})
                </span>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
          <FieldWrap label="Name" required>
            <input
              value={typeForm.name}
              onChange={e => setTypeForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. 20mm Stone"
              style={inputStyle}
            />
          </FieldWrap>
          <FieldWrap label="Unit">
            <select
              value={typeForm.unit}
              onChange={e => setTypeForm(f => ({ ...f, unit: e.target.value }))}
              style={inputStyle}
            >
              <option value="kg">kg</option>
              <option value="tonnes">tonnes</option>
              <option value="m3">m3</option>
            </select>
          </FieldWrap>
        </div>
      </Modal>
    </div>
  )
}
