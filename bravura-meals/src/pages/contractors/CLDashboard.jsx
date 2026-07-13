import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'

const color = MODULE_COLORS.contractors

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 600, color: THEME.textLow,
      letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '10px',
    }}>{children}</div>
  )
}

function KpiTile({ icon, label, value, sub, accent }) {
  const c = accent || color
  return (
    <div style={{
      background: THEME.surface, borderRadius: '14px', padding: '16px',
      border: `1px solid ${THEME.outlineVar}`, flex: '1 1 200px', minWidth: '180px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%',
          background: c + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '18px', color: c }}>{icon}</span>
        </div>
        <div style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: THEME.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '6px' }}>{sub}</div>}
    </div>
  )
}

export default function CLDashboard({ setPage }) {
  const { currentSiteId } = useSite()
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
        supabase.from('contractors').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('is_archived', false),
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
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
      <SectionLabel>Contract & Contractor Management</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
        <KpiTile icon="business_center" label="Active Contractors" value={kpis.contractors} />
        <KpiTile icon="description" label="Active Contracts" value={kpis.contracts} />
        <KpiTile icon="engineering" label="Casuals Working Today" value={kpis.casualsWorking} />
        <KpiTile icon="local_shipping" label="Hired Vehicles" value={kpis.vehicles} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
        <KpiTile icon="construction" label="Hired Equipment" value={kpis.equipment} />
        <KpiTile icon="event_busy" label="Contracts Expiring Soon" value={kpis.expiringContracts} accent={kpis.expiringContracts > 0 ? '#D97706' : color} sub="Within 30 days" />
        <KpiTile icon="pending_actions" label="Pending Timesheet Approvals" value={kpis.pendingTimesheets} accent={kpis.pendingTimesheets > 0 ? '#D97706' : color} />
      </div>

      <SectionLabel>Recent Contracts</SectionLabel>
      <div style={{
        background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
        overflow: 'hidden',
      }}>
        {recentContracts.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No contracts yet</div>
        ) : (
          <>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 100px 100px',
              padding: '10px 16px', fontSize: '11px', fontWeight: 600, color: THEME.textLow,
              textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: `1px solid ${THEME.outlineVar}`,
            }}>
              <div>Contractor</div><div>Contract</div><div>Start</div><div>End</div><div>Status</div>
            </div>
            {recentContracts.map((c, i) => (
              <div key={c.id} style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 100px 100px',
                padding: '10px 16px', fontSize: '12px', alignItems: 'center',
                borderBottom: i < recentContracts.length - 1 ? `1px solid ${THEME.outlineVar}` : 'none',
              }}>
                <div style={{ fontWeight: 600, color: THEME.text }}>{c.contractor?.name || '-'}</div>
                <div style={{ color: THEME.textMed }}>{c.contract_number || c.title || '-'}</div>
                <div style={{ color: THEME.textMed }}>{c.start_date || '-'}</div>
                <div style={{ color: THEME.textMed }}>{c.end_date || '-'}</div>
                <div>
                  <span style={{
                    fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '999px',
                    background: color + '18', color, textTransform: 'uppercase',
                  }}>{c.status || '-'}</span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
