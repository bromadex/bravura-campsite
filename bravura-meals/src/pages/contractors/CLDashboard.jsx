import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard, KpiCard, ActivityRow, SectionTitle } from '../../components/dash'
import QuickNav, { CONTRACTOR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.contractors

// Accent hexes for KPI chips (literal hexes so the accent+'18' tint pattern works)
const ACCENT = {
  green:  '#2E7D32',
  blue:   '#1E88E5',
  violet: '#7C4DFF',
  amber:  '#D97706',
  teal:   '#00897B',
}

const STATUS_CLR = {
  active: '#2E7D32',
  expired: '#E53935',
  terminated: '#E53935',
  draft: '#D97706',
  completed: '#0277BD',
}

export default function CLDashboard({ setPage }) {
  const { currentSiteId } = useSite()
  useRealtimeSubscription('contractors', { column: 'site_id', value: currentSiteId }, load)
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState({
    contractors: 0, contracts: 0, casualsWorking: 0, vehicles: 0,
    equipment: 0, expiringContracts: 0, pendingTimesheets: 0,
  })
  const [recentContracts, setRecentContracts] = useState([])

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const today = new Date().toISOString().slice(0, 10)
      const in30 = new Date()
      in30.setDate(in30.getDate() + 30)
      const in30Str = in30.toISOString().slice(0, 10)

      const [
        contractorsRes, contractsRes, casualsRes, vehiclesRes, equipmentRes,
        timesheetsTodayRes, expiringRes, pendingRes, recentRes,
      ] = await Promise.all([
        supabase.from('contractors').select('id', { count: 'exact', head: true }).eq('is_archived', false).or(`site_id.eq.${currentSiteId},site_id.is.null`),
        supabase.from('contractor_contracts').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active'),
        supabase.from('casual_workers').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'working'),
        supabase.from('hired_vehicles').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active'),
        supabase.from('hired_equipment').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active'),
        supabase.from('casual_timesheets').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('date', today),
        supabase.from('contractor_contracts').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active').gte('end_date', today).lte('end_date', in30Str),
        supabase.from('casual_timesheets').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('approved', false),
        supabase.from('contractor_contracts').select('*, contractor:contractors(id, name)').eq('site_id', currentSiteId).order('created_at', { ascending: false }).limit(5),
      ])

      if (cancelled) return
      setKpis({
        contractors: contractorsRes.count || 0,
        contracts: contractsRes.count || 0,
        casualsWorking: casualsRes.count || 0,
        vehicles: vehiclesRes.count || 0,
        equipment: equipmentRes.count || 0,
        expiringContracts: expiringRes.count || 0,
        pendingTimesheets: pendingRes.count || 0,
      })
      setRecentContracts(recentRes.data || [])
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId])

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <Icon name="progress_activity" size={32} style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <QuickNav pills={CONTRACTOR_PILLS} setPage={setPage} current="cl_dashboard" />
      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <KpiCard
          icon="business_center" label="Active Contractors" value={kpis.contractors}
          sub="Registered, not archived" accent={color}
          progress={kpis.contractors > 0 ? 100 : 0}
        />
        <KpiCard
          icon="description" label="Active Contracts" value={kpis.contracts}
          sub="Currently running" accent={ACCENT.blue}
          progress={kpis.contractors > 0 ? Math.min(100, (kpis.contracts / kpis.contractors) * 100) : 0}
        />
        <KpiCard
          icon="engineering" label="Casuals Working Today" value={kpis.casualsWorking}
          sub="On site now" accent={ACCENT.teal}
          progress={kpis.casualsWorking > 0 ? 100 : 0}
        />
        <KpiCard
          icon="local_shipping" label="Hired Vehicles" value={kpis.vehicles}
          sub="Active hires" accent={ACCENT.violet}
          progress={kpis.vehicles > 0 ? 100 : 0}
        />
        <KpiCard
          icon="construction" label="Hired Equipment" value={kpis.equipment}
          sub="Active hires" accent={ACCENT.green}
          progress={kpis.equipment > 0 ? 100 : 0}
        />
        <KpiCard
          icon="event_busy" label="Expiring Soon" value={kpis.expiringContracts}
          sub="Contracts ending within 30 days" accent={kpis.expiringContracts > 0 ? ACCENT.amber : color}
          progress={kpis.contracts > 0 ? Math.min(100, (kpis.expiringContracts / kpis.contracts) * 100) : 0}
        />
        <KpiCard
          icon="pending_actions" label="Pending Timesheets" value={kpis.pendingTimesheets}
          sub="Awaiting approval" accent={kpis.pendingTimesheets > 0 ? ACCENT.amber : color}
          progress={kpis.pendingTimesheets > 0 ? 100 : 0}
        />
      </div>

      <DashCard>
        <SectionTitle title="Recent Contracts" subtitle="Latest contracts for this site" />
        {recentContracts.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No contracts yet</div>
        ) : (
          recentContracts.map((c, i) => (
            <ActivityRow
              key={c.id}
              icon="description"
              iconColor={STATUS_CLR[c.status] || color}
              title={c.contractor?.name || '—'}
              sub={`${c.contract_number || c.title || '—'} · ${c.start_date || '—'} → ${c.end_date || 'open'}`}
              right={(c.status || '—').toUpperCase()}
              rightColor={STATUS_CLR[c.status] || color}
              isLast={i === recentContracts.length - 1}
            />
          ))
        )}
      </DashCard>
    </div>
  )
}
