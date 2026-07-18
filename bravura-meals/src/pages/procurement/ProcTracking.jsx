import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, StatusBadge, showToast } from '../../components/ui'
import QuickNav from '../../components/QuickNav'
import { PROCUREMENT_PILLS } from './ProcDashboard'

const CLR = MODULE_COLORS.procurement

const STATUS_COLORS = {
  pending: '#9E9E9E', ordered: '#1565C0', in_transit: '#E65100', at_customs: '#D97706',
  at_warehouse: '#2E7D32', delivered: '#4CAF50', delayed: '#C62828',
}

const EVENT_ICONS = {
  created: 'add_circle', sent_to_supplier: 'send', confirmed: 'check_circle',
  dispatched: 'local_shipping', in_transit: 'flight', at_customs: 'gavel',
  cleared_customs: 'verified', at_hub: 'warehouse', out_for_delivery: 'directions_car',
  delivered: 'inventory', delayed: 'schedule', note: 'sticky_note_2',
}

export default function ProcTracking({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { user } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedPO, setSelectedPO] = useState(null)
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('all')
  const [showAddEvent, setShowAddEvent] = useState(false)
  const [eventForm, setEventForm] = useState({ event_type: 'note', location: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const fetchOrders = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data } = await supabase
      .from('purchase_orders')
      .select('id, po_number, supplier:procurement_suppliers(supplier_name), total_amount, status, delivery_status, current_location, tracking_ref, priority, shipped_at, delivered_at, delivery_address, created_at')
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetchOrders() }, [currentSiteId, fetchOrders])

  async function loadEvents(poId) {
    setSelectedPO(poId)
    const { data } = await supabase
      .from('po_tracking_events')
      .select('*')
      .eq('po_id', poId)
      .order('created_at', { ascending: false })
    setEvents(data || [])
  }

  async function addEvent() {
    if (!eventForm.event_type) return
    setSaving(true)
    const { error } = await supabase.from('po_tracking_events').insert({
      po_id: selectedPO,
      event_type: eventForm.event_type,
      location: eventForm.location || null,
      notes: eventForm.notes || null,
      created_by: user.id,
    })
    if (error) { showToast(error.message, 'red'); setSaving(false); return }

    // Update PO delivery_status + current_location
    const statusMap = { dispatched: 'in_transit', in_transit: 'in_transit', at_customs: 'at_customs', cleared_customs: 'in_transit', at_hub: 'at_warehouse', out_for_delivery: 'in_transit', delivered: 'delivered', delayed: 'delayed' }
    const newStatus = statusMap[eventForm.event_type]
    const updates = {}
    if (newStatus) updates.delivery_status = newStatus
    if (eventForm.location) updates.current_location = eventForm.location
    if (eventForm.event_type === 'delivered') updates.delivered_at = new Date().toISOString()
    if (eventForm.event_type === 'dispatched') updates.shipped_at = new Date().toISOString()
    if (Object.keys(updates).length) await supabase.from('purchase_orders').update(updates).eq('id', selectedPO)

    showToast('Event recorded')
    setShowAddEvent(false)
    setEventForm({ event_type: 'note', location: '', notes: '' })
    setSaving(false)
    loadEvents(selectedPO)
    fetchOrders()
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return orders
    return orders.filter(o => o.delivery_status === filter)
  }, [orders, filter])

  if (!can('procurement.view')) return <Card style={{ textAlign: 'center', padding: 40 }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /></Card>

  return (
    <div>
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_tracking" />
      <PageHeader title="Order Tracking" site={currentSite} />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {['all', 'pending', 'ordered', 'in_transit', 'at_customs', 'at_warehouse', 'delivered', 'delayed'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, border: `1px solid ${filter === s ? CLR : THEME.outline}`, background: filter === s ? CLR : THEME.surface, color: filter === s ? '#fff' : THEME.text, cursor: 'pointer' }}>
            {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>Loading...</Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: selectedPO ? '1fr 1fr' : '1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.length === 0 ? (
              <Card style={{ textAlign: 'center', padding: 40, color: THEME.textLow }}>No orders found</Card>
            ) : filtered.map(o => (
              <Card key={o.id} onClick={() => loadEvents(o.id)} style={{ padding: 14, cursor: 'pointer', border: selectedPO === o.id ? `2px solid ${CLR}` : `1px solid ${THEME.outline}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: THEME.text }}>{o.po_number}</span>
                  <StatusBadge status={o.delivery_status || 'pending'} />
                </div>
                <div style={{ fontSize: 12, color: THEME.textMed, marginBottom: 4 }}>{o.supplier?.supplier_name}</div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: THEME.textLow }}>
                  {o.current_location && <span><Icon name="place" size={12} style={{ color: CLR }} /> {o.current_location}</span>}
                  {o.tracking_ref && <span>Ref: {o.tracking_ref}</span>}
                  {o.priority !== 'normal' && <StatusBadge status={o.priority} />}
                </div>
                {o.delivery_address && <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 4 }}>→ {o.delivery_address}</div>}
              </Card>
            ))}
          </div>

          {selectedPO && (
            <div>
              <Card style={{ padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: THEME.text }}>Tracking Timeline</span>
                  {can('procurement.edit') && (
                    <button onClick={() => setShowAddEvent(!showAddEvent)} style={{ padding: '6px 12px', borderRadius: 6, background: CLR, color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Event</button>
                  )}
                </div>

                {showAddEvent && (
                  <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: THEME.surface, border: `1px solid ${THEME.outline}` }}>
                    <select value={eventForm.event_type} onChange={e => setEventForm({ ...eventForm, event_type: e.target.value })} style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 12, marginBottom: 8 }}>
                      {Object.keys(EVENT_ICONS).map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                    </select>
                    <input value={eventForm.location} onChange={e => setEventForm({ ...eventForm, location: e.target.value })} placeholder="Location (e.g. Harare, Beitbridge, Durban Port)" style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 12, marginBottom: 8 }} />
                    <input value={eventForm.notes} onChange={e => setEventForm({ ...eventForm, notes: e.target.value })} placeholder="Notes" style={{ width: '100%', padding: '6px 10px', borderRadius: 6, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 12, marginBottom: 8 }} />
                    <button onClick={addEvent} disabled={saving} style={{ padding: '6px 14px', borderRadius: 6, background: CLR, color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Record Event'}</button>
                  </div>
                )}

                {events.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No events recorded</div>
                ) : (
                  <div style={{ position: 'relative', paddingLeft: 24 }}>
                    <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: THEME.outline }} />
                    {events.map(ev => (
                      <div key={ev.id} style={{ position: 'relative', marginBottom: 16 }}>
                        <div style={{ position: 'absolute', left: -20, top: 2, width: 20, height: 20, borderRadius: '50%', background: CLR + '20', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name={EVENT_ICONS[ev.event_type] || 'circle'} size={12} style={{ color: CLR }} />
                        </div>
                        <div style={{ paddingLeft: 8 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: THEME.text }}>{ev.event_type.replace(/_/g, ' ')}</div>
                          {ev.location && <div style={{ fontSize: 12, color: THEME.textMed }}><Icon name="place" size={12} style={{ color: CLR }} /> {ev.location}</div>}
                          {ev.notes && <div style={{ fontSize: 12, color: THEME.textLow, marginTop: 2 }}>{ev.notes}</div>}
                          <div style={{ fontSize: 11, color: THEME.textLow, marginTop: 2 }}>{new Date(ev.created_at).toLocaleString()}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
