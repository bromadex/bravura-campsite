import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, StatusBadge, showToast } from '../../components/ui'
import { DashCard, KpiCard, ProgressRow, SectionTitle } from '../../components/dash'
import QuickNav, { PROCUREMENT_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.procurement

export { PROCUREMENT_PILLS }

export default function ProcDashboard({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [loading, setLoading] = useState(true)
  const [pos, setPos] = useState([])
  const [rfqs, setRfqs] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [events, setEvents] = useState([])

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [poRes, rfqRes, supRes, evRes] = await Promise.all([
        supabase.from('purchase_orders').select('id, po_number, supplier_id, total_amount, status, delivery_status, priority, created_at').eq('site_id', currentSiteId),
        supabase.from('rfqs').select('id, rfq_number, title, status, deadline, created_at').eq('site_id', currentSiteId),
        supabase.from('procurement_suppliers').select('id, supplier_name, status').eq('site_id', currentSiteId),
        supabase.from('po_tracking_events').select('id, po_id, event_type, location, notes, created_at').order('created_at', { ascending: false }).limit(20),
      ])
      setPos(poRes.data || [])
      setRfqs(rfqRes.data || [])
      setSuppliers(supRes.data || [])
      setEvents(evRes.data || [])
    } catch (err) {
      showToast('Failed to load procurement data', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetch() }, [currentSiteId, fetch])

  const stats = useMemo(() => {
    const activePOs = pos.filter(p => !['cancelled', 'completed'].includes(p.status))
    const inTransit = pos.filter(p => p.delivery_status === 'in_transit')
    const delayed = pos.filter(p => p.delivery_status === 'delayed')
    const atCustoms = pos.filter(p => p.delivery_status === 'at_customs')
    const delivered = pos.filter(p => p.delivery_status === 'delivered')
    const openRFQs = rfqs.filter(r => ['draft', 'sent', 'responses_received'].includes(r.status))
    const totalSpend = pos.filter(p => p.status !== 'cancelled').reduce((s, p) => s + (p.total_amount || 0), 0)
    const urgent = pos.filter(p => p.priority === 'urgent' && !['cancelled', 'completed'].includes(p.status))

    const byStatus = {}
    pos.forEach(p => { byStatus[p.delivery_status || 'pending'] = (byStatus[p.delivery_status || 'pending'] || 0) + 1 })

    return { activePOs: activePOs.length, inTransit: inTransit.length, delayed: delayed.length, atCustoms: atCustoms.length, delivered: delivered.length, openRFQs: openRFQs.length, totalSpend, urgent: urgent.length, supplierCount: suppliers.filter(s => s.status === 'active').length, byStatus }
  }, [pos, rfqs, suppliers])

  if (!can('procurement.view')) {
    return <Card style={{ textAlign: 'center', padding: '40px' }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /><div style={{ marginTop: 10, color: THEME.textMed, fontSize: 14 }}>No procurement access.</div></Card>
  }

  const fmt = v => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

  return (
    <div>
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_dashboard" />
      <PageHeader title="Procurement Dashboard" site={currentSite} />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          {(stats.delayed > 0 || stats.urgent > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, marginBottom: 16, background: THEME.statusErrorBg, border: `1px solid ${THEME.error}30` }}>
              <Icon name="warning" size={18} style={{ color: THEME.error }} />
              <span style={{ fontSize: 13, color: THEME.text }}>
                {stats.delayed > 0 && <strong>{stats.delayed} delayed orders. </strong>}
                {stats.urgent > 0 && <span>{stats.urgent} urgent orders pending.</span>}
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
            <KpiCard label="Active POs" value={stats.activePOs} icon="shopping_cart" accent={ACCENT} />
            <KpiCard label="In Transit" value={stats.inTransit} icon="local_shipping" accent="#E65100" />
            <KpiCard label="At Customs" value={stats.atCustoms} icon="gavel" accent="#D97706" />
            <KpiCard label="Delayed" value={stats.delayed} icon="schedule" accent={THEME.error} />
            <KpiCard label="Open RFQs" value={stats.openRFQs} icon="request_quote" accent="#00838F" />
            <KpiCard label="Total Spend" value={fmt(stats.totalSpend)} icon="payments" accent={THEME.success} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginBottom: 18 }}>
            <DashCard>
              <SectionTitle title="Delivery Status Breakdown" />
              {Object.entries(stats.byStatus).length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No orders yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(stats.byStatus).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                    <ProgressRow key={status} label={status.replace(/_/g, ' ')} value={count} pct={pos.length > 0 ? (count / pos.length) * 100 : 0} color={ACCENT} />
                  ))}
                </div>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Recent Tracking Events" />
              {events.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No tracking events yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {events.slice(0, 8).map(ev => (
                    <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${THEME.outline}` }}>
                      <Icon name="place" size={16} style={{ color: ACCENT }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: THEME.text }}>{ev.event_type.replace(/_/g, ' ')}</div>
                        {ev.location && <div style={{ fontSize: 11, color: THEME.textMed }}>{ev.location}</div>}
                      </div>
                      <span style={{ fontSize: 11, color: THEME.textLow, whiteSpace: 'nowrap' }}>{new Date(ev.created_at).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </DashCard>
          </div>

          <DashCard>
            <SectionTitle title="Quick Actions" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {[
                { icon: 'add_circle', label: 'New RFQ', page: 'proc_rfqs', color: '#00838F' },
                { icon: 'local_shipping', label: 'Track Orders', page: 'proc_tracking', color: '#E65100' },
                { icon: 'business', label: 'Suppliers', page: 'proc_suppliers', color: '#1565C0' },
                { icon: 'bar_chart', label: 'Reports', page: 'proc_reports', color: '#C62828' },
              ].map(q => (
                <div key={q.page} onClick={() => setPage(q.page)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderRadius: 12, cursor: 'pointer', border: `1px solid ${THEME.outline}`, background: THEME.surface }}>
                  <Icon name={q.icon} size={22} style={{ color: q.color }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: THEME.text }}>{q.label}</span>
                </div>
              ))}
            </div>
          </DashCard>
        </>
      )}
    </div>
  )
}
