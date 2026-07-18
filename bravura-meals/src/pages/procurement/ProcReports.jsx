import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast } from '../../components/ui'
import { DashCard, SectionTitle, ProgressRow } from '../../components/dash'
import QuickNav from '../../components/QuickNav'
import { PROCUREMENT_PILLS } from './ProcDashboard'

const CLR = MODULE_COLORS.procurement

export default function ProcReports({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [poRes, supRes] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, supplier_id, total_amount, status, delivery_status, priority, created_at, delivered_at, shipped_at').eq('site_id', currentSiteId),
      supabase.from('procurement_suppliers').select('id, supplier_name').eq('site_id', currentSiteId),
    ])
    setOrders(poRes.data || [])
    setSuppliers(supRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetch() }, [currentSiteId, fetch])

  const stats = useMemo(() => {
    const supMap = Object.fromEntries(suppliers.map(s => [s.id, s.supplier_name]))
    const bySupplier = {}
    orders.forEach(o => {
      const name = supMap[o.supplier_id] || 'Unknown'
      bySupplier[name] = (bySupplier[name] || 0) + (o.total_amount || 0)
    })
    const supplierSpend = Object.entries(bySupplier).sort((a, b) => b[1] - a[1]).slice(0, 10)
    const totalSpend = orders.reduce((s, o) => s + (o.total_amount || 0), 0)

    const byMonth = {}
    orders.forEach(o => {
      const m = o.created_at?.slice(0, 7)
      if (m) byMonth[m] = (byMonth[m] || 0) + (o.total_amount || 0)
    })
    const monthlySpend = Object.entries(byMonth).sort((a, b) => a[0].localeCompare(b[0])).slice(-6)

    let avgLeadDays = 0
    const delivered = orders.filter(o => o.shipped_at && o.delivered_at)
    if (delivered.length) {
      const totalDays = delivered.reduce((s, o) => s + (new Date(o.delivered_at) - new Date(o.shipped_at)) / 86400000, 0)
      avgLeadDays = Math.round(totalDays / delivered.length)
    }

    const byPriority = {}
    orders.forEach(o => { byPriority[o.priority || 'normal'] = (byPriority[o.priority || 'normal'] || 0) + 1 })

    return { supplierSpend, totalSpend, monthlySpend, avgLeadDays, byPriority, totalOrders: orders.length }
  }, [orders, suppliers])

  if (!can('procurement.view')) return <Card style={{ textAlign: 'center', padding: 40 }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /></Card>

  const fmt = v => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

  return (
    <div>
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_reports" />
      <PageHeader title="Procurement Reports" site={currentSite} />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 18 }}>
            <Card style={{ padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: CLR }}>{fmt(stats.totalSpend)}</div>
              <div style={{ fontSize: 12, color: THEME.textMed }}>Total Spend</div>
            </Card>
            <Card style={{ padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: THEME.text }}>{stats.totalOrders}</div>
              <div style={{ fontSize: 12, color: THEME.textMed }}>Total Orders</div>
            </Card>
            <Card style={{ padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#E65100' }}>{stats.avgLeadDays}</div>
              <div style={{ fontSize: 12, color: THEME.textMed }}>Avg Lead Time (days)</div>
            </Card>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 18, marginBottom: 18 }}>
            <DashCard>
              <SectionTitle title="Spend by Supplier (Top 10)" />
              {stats.supplierSpend.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.supplierSpend.map(([name, val]) => (
                    <ProgressRow key={name} label={name} value={fmt(val)} pct={stats.totalSpend > 0 ? (val / stats.totalSpend) * 100 : 0} color={CLR} />
                  ))}
                </div>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Monthly Spend (Last 6 Months)" />
              {stats.monthlySpend.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: THEME.textLow, fontSize: 13 }}>No data</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.monthlySpend.map(([month, val]) => {
                    const max = Math.max(...stats.monthlySpend.map(m => m[1]))
                    return <ProgressRow key={month} label={month} value={fmt(val)} pct={max > 0 ? (val / max) * 100 : 0} color={CLR} />
                  })}
                </div>
              )}
            </DashCard>

            <DashCard>
              <SectionTitle title="Orders by Priority" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(stats.byPriority).map(([p, count]) => (
                  <ProgressRow key={p} label={p} value={count} pct={stats.totalOrders > 0 ? (count / stats.totalOrders) * 100 : 0} color={p === 'urgent' ? THEME.error : p === 'high' ? '#E65100' : CLR} />
                ))}
              </div>
            </DashCard>
          </div>
        </>
      )}
    </div>
  )
}
