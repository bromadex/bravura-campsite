import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import Denied from '../../components/Denied'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { Icon } from '../../components/ui'
import { DashCard, KpiCard, ActivityRow, SectionTitle } from '../../components/dash'
import QuickNav, { CONTRACTOR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.contractors

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

const TYPE_COLORS = ['#1565C0', '#2E7D32', '#E65100', '#7B1FA2', '#C62828', '#00897B', '#4E342E', '#D97706']

function Section({ title, sub, children, style }) {
  return (
    <DashCard style={style}>
      <SectionTitle title={title} subtitle={sub} />
      {children}
    </DashCard>
  )
}

function DonutChart({ slices, size = 160, label }) {
  const [hover, setHover] = useState(null)
  const total = slices.reduce((s, sl) => s + sl.value, 0)
  if (!total) return null
  const cx = size / 2, cy = size / 2, r = size * 0.36, sw = size * 0.12
  let cumAngle = -Math.PI / 2
  const arcs = slices.map((sl, i) => {
    const pct = sl.value / total
    const startAngle = cumAngle
    const endAngle = cumAngle + pct * 2 * Math.PI
    cumAngle = endAngle
    const large = pct > 0.5 ? 1 : 0
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle - 0.001), y2 = cy + r * Math.sin(endAngle - 0.001)
    return { ...sl, d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, pct, idx: i }
  })
  return (
    <div style={{ position: 'relative' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map(a => (
          <path key={a.idx} d={a.d} fill="none" stroke={a.color} strokeWidth={hover === a.idx ? sw + 4 : sw}
            strokeLinecap="round" style={{ cursor: 'pointer', transition: 'stroke-width .15s' }}
            onMouseEnter={() => setHover(a.idx)} onMouseLeave={() => setHover(null)} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="22" fontWeight="700" fill={THEME.text}>{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" fill={THEME.textLow}>{label}</text>
      </svg>
      {hover !== null && (
        <div style={{ position: 'absolute', top: 0, left: size + 8, background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>
          {arcs[hover].label}: {arcs[hover].value} ({(arcs[hover].pct * 100).toFixed(0)}%)
        </div>
      )}
    </div>
  )
}

function BarChart({ bars, height = 160 }) {
  const [hover, setHover] = useState(null)
  const maxVal = Math.max(...bars.map(b => b.value), 1)
  const barW = Math.min(40, Math.max(16, 600 / bars.length - 8))
  const chartW = bars.length * (barW + 8)
  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={Math.max(chartW, 300)} height={height + 30} viewBox={`0 0 ${Math.max(chartW, 300)} ${height + 30}`}>
        {bars.map((b, i) => {
          const h = Math.max(4, (b.value / maxVal) * (height - 20))
          const x = i * (barW + 8) + 4
          const y = height - h
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
              <rect x={x} y={y} width={barW} height={h} rx={3} fill={hover === i ? b.color : b.color + 'CC'} style={{ transition: 'fill .15s' }} />
              <text x={x + barW / 2} y={height + 14} textAnchor="middle" fontSize="9" fill={THEME.textLow}
                style={{ fontFamily: 'inherit' }}>{b.label.length > 8 ? b.label.slice(0, 7) + '…' : b.label}</text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div style={{ position: 'absolute', top: 0, right: 0, background: THEME.text, color: THEME.surface, padding: '6px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 10 }}>
          {bars[hover].label}: ${bars[hover].value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      )}
    </div>
  )
}

function GaugeChart({ pct, color: gaugeColor, label, size = 130 }) {
  const r = size * 0.38, sw = size * 0.1
  const cx = size / 2, cy = size * 0.55
  const startAngle = Math.PI, endAngle = 0
  const clampedPct = Math.min(Math.max(pct || 0, 0), 100)
  const valAngle = Math.PI - (clampedPct / 100) * Math.PI
  const bgX1 = cx + r * Math.cos(startAngle), bgY1 = cy + r * Math.sin(startAngle)
  const bgX2 = cx + r * Math.cos(endAngle), bgY2 = cy + r * Math.sin(endAngle)
  const valX = cx + r * Math.cos(valAngle), valY = cy + r * Math.sin(valAngle)
  return (
    <svg width={size} height={size * 0.65} viewBox={`0 0 ${size} ${size * 0.65}`}>
      <path d={`M ${bgX1} ${bgY1} A ${r} ${r} 0 0 1 ${bgX2} ${bgY2}`} fill="none" stroke={THEME.outlineVar} strokeWidth={sw} strokeLinecap="round" />
      {clampedPct > 0 && (
        <path d={`M ${bgX1} ${bgY1} A ${r} ${r} 0 ${clampedPct > 50 ? 1 : 0} 1 ${valX} ${valY}`} fill="none" stroke={gaugeColor} strokeWidth={sw} strokeLinecap="round" />
      )}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="20" fontWeight="700" fill={THEME.text}>{clampedPct.toFixed(0)}%</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill={THEME.textLow}>{label}</text>
    </svg>
  )
}

export default function CLDashboard({ setPage }) {
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const [tick, setTick] = useState(0)
  useRealtimeSubscription('contractors', { column: 'site_id', value: currentSiteId }, () => setTick(t => t + 1))
  const [loading, setLoading] = useState(true)
  const [kpis, setKpis] = useState({
    contractors: 0, contracts: 0, casualsWorking: 0, vehicles: 0,
    equipment: 0, expiringContracts: 0, pendingTimesheets: 0, totalContractValue: 0,
  })
  const [recentContracts, setRecentContracts] = useState([])
  const [allContracts, setAllContracts] = useState([])
  const [contractorSpend, setContractorSpend] = useState([])
  const [timesheetSummary, setTimesheetSummary] = useState({ today: 0, week: 0, month: 0, pending: 0 })

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const today = new Date().toISOString().slice(0, 10)
      const in30 = new Date()
      in30.setDate(in30.getDate() + 30)
      const in30Str = in30.toISOString().slice(0, 10)

      const now = new Date()
      const weekStart = new Date(now)
      weekStart.setDate(weekStart.getDate() - weekStart.getDay())
      const weekStartStr = weekStart.toISOString().slice(0, 10)
      const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

      const [
        contractorsRes, contractsRes, casualsRes, vehiclesRes, equipmentRes,
        expiringRes, pendingRes, recentRes, allContractsRes,
        tsToday, tsWeek, tsMonth,
      ] = await Promise.all([
        supabase.from('contractors').select('id, name', { count: 'exact' }).eq('is_archived', false).or(`site_id.eq.${currentSiteId},site_id.is.null`),
        supabase.from('contractor_contracts').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active'),
        supabase.from('casual_workers').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'working'),
        supabase.from('hired_vehicles').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active'),
        supabase.from('hired_equipment').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active'),
        supabase.from('contractor_contracts').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('status', 'active').gte('end_date', today).lte('end_date', in30Str),
        supabase.from('casual_timesheets').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('approved', false),
        supabase.from('contractor_contracts').select('*, contractor:contractors(id, name)').eq('site_id', currentSiteId).order('created_at', { ascending: false }).limit(5),
        supabase.from('contractor_contracts').select('id, status, contract_type, contract_value, start_date, end_date, contractor_id, contractor:contractors(id, name)').eq('site_id', currentSiteId),
        supabase.from('casual_timesheets').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).eq('date', today),
        supabase.from('casual_timesheets').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).gte('date', weekStartStr),
        supabase.from('casual_timesheets').select('id', { count: 'exact', head: true }).eq('site_id', currentSiteId).gte('date', monthStart),
      ])

      if (cancelled) return

      const contracts = allContractsRes.data || []
      const totalValue = contracts.filter(c => c.status === 'active').reduce((s, c) => s + (Number(c.contract_value) || 0), 0)

      // Spend by contractor from contract values
      const spendMap = {}
      const contractors = contractorsRes.data || []
      for (const c of contracts.filter(ct => ct.status === 'active')) {
        const cId = c.contractor_id
        const cName = c.contractor?.name || 'Unknown'
        if (!spendMap[cId]) spendMap[cId] = { id: cId, name: cName, value: 0 }
        spendMap[cId].value += Number(c.contract_value) || 0
      }
      const spendArr = Object.values(spendMap).sort((a, b) => b.value - a.value).slice(0, 8)

      setKpis({
        contractors: contractorsRes.count || 0,
        contracts: contractsRes.count || 0,
        casualsWorking: casualsRes.count || 0,
        vehicles: vehiclesRes.count || 0,
        equipment: equipmentRes.count || 0,
        expiringContracts: expiringRes.count || 0,
        pendingTimesheets: pendingRes.count || 0,
        totalContractValue: totalValue,
      })
      setRecentContracts(recentRes.data || [])
      setAllContracts(contracts)
      setContractorSpend(spendArr)
      setTimesheetSummary({
        today: tsToday.count || 0,
        week: tsWeek.count || 0,
        month: tsMonth.count || 0,
        pending: pendingRes.count || 0,
      })
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId, tick])

  const contractTypeSlices = useMemo(() => {
    const typeMap = {}
    for (const c of allContracts) {
      const t = c.contract_type || 'unspecified'
      if (!typeMap[t]) typeMap[t] = { label: t.replace(/_/g, ' '), value: 0 }
      typeMap[t].value++
    }
    return Object.values(typeMap).sort((a, b) => b.value - a.value).map((s, i) => ({ ...s, color: TYPE_COLORS[i % TYPE_COLORS.length] }))
  }, [allContracts])

  const statusSlices = useMemo(() => {
    const map = {}
    for (const c of allContracts) {
      const s = c.status || 'unknown'
      if (!map[s]) map[s] = { label: s, value: 0, color: STATUS_CLR[s] || THEME.textMed }
      map[s].value++
    }
    return Object.values(map).sort((a, b) => b.value - a.value)
  }, [allContracts])

  const expiringContracts = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    const in30Str = in30.toISOString().slice(0, 10)
    return allContracts
      .filter(c => c.status === 'active' && c.end_date && c.end_date >= today && c.end_date <= in30Str)
      .sort((a, b) => a.end_date.localeCompare(b.end_date))
  }, [allContracts])

  const contractUtilPct = kpis.contractors > 0 ? Math.min(100, Math.round((kpis.contracts / kpis.contractors) * 100)) : 0

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
          progress={contractUtilPct}
        />
        <KpiCard
          icon="payments" label="Total Contract Value"
          value={`$${kpis.totalContractValue >= 1000 ? (kpis.totalContractValue / 1000).toFixed(0) + 'k' : kpis.totalContractValue.toLocaleString()}`}
          sub="Active contracts" accent={ACCENT.green}
          progress={kpis.totalContractValue > 0 ? 100 : 0}
        />
        <KpiCard
          icon="engineering" label="Casuals Working" value={kpis.casualsWorking}
          sub="On site today" accent={ACCENT.teal}
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
          sub="Within 30 days" accent={kpis.expiringContracts > 0 ? ACCENT.amber : color}
          progress={kpis.contracts > 0 ? Math.min(100, (kpis.expiringContracts / kpis.contracts) * 100) : 0}
        />
        <KpiCard
          icon="pending_actions" label="Pending Timesheets" value={kpis.pendingTimesheets}
          sub="Awaiting approval" accent={kpis.pendingTimesheets > 0 ? ACCENT.amber : color}
          progress={kpis.pendingTimesheets > 0 ? 100 : 0}
        />
      </div>

      {/* Charts row: Contract Status donut + Contract Type donut + Utilization gauge */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {statusSlices.length > 0 && (
          <Section title="Contract Status" sub="All contracts by status">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <DonutChart slices={statusSlices} label="contracts" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '100px' }}>
                {statusSlices.map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                    <span style={{ color: THEME.textMed, textTransform: 'capitalize' }}>{s.label}</span>
                    <span style={{ fontWeight: 600, color: THEME.text, marginLeft: 'auto' }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        {contractTypeSlices.length > 0 && (
          <Section title="Contract Types" sub="Breakdown by type">
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
              <DonutChart slices={contractTypeSlices} label="contracts" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '100px' }}>
                {contractTypeSlices.map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                    <span style={{ color: THEME.textMed, textTransform: 'capitalize' }}>{s.label}</span>
                    <span style={{ fontWeight: 600, color: THEME.text, marginLeft: 'auto' }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </Section>
        )}

        <Section title="Contractor Utilization" sub="Active contracts vs registered contractors">
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GaugeChart pct={contractUtilPct} color={contractUtilPct > 70 ? ACCENT.green : contractUtilPct > 40 ? ACCENT.amber : ACCENT.blue} label="utilization" />
          </div>
          <div style={{ textAlign: 'center', fontSize: '12px', color: THEME.textMed, marginTop: '4px' }}>
            {kpis.contracts} active of {kpis.contractors} registered
          </div>
        </Section>
      </div>

      {/* Spend by Contractor bar chart */}
      {contractorSpend.length > 0 && (
        <Section title="Contract Value by Contractor" sub="Active contract values — top 8" style={{ marginBottom: '16px' }}>
          <BarChart
            bars={contractorSpend.map((s, i) => ({ label: s.name, value: s.value, color: TYPE_COLORS[i % TYPE_COLORS.length] }))}
          />
        </Section>
      )}

      {/* Timesheet Summary */}
      <Section title="Timesheet Summary" sub="Casual worker timesheet activity" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
          {[
            { label: 'Today', value: timesheetSummary.today, icon: 'today', clr: ACCENT.blue },
            { label: 'This Week', value: timesheetSummary.week, icon: 'date_range', clr: ACCENT.teal },
            { label: 'This Month', value: timesheetSummary.month, icon: 'calendar_month', clr: ACCENT.green },
            { label: 'Pending', value: timesheetSummary.pending, icon: 'pending_actions', clr: timesheetSummary.pending > 0 ? ACCENT.amber : ACCENT.green },
          ].map(t => (
            <div key={t.label} style={{ background: t.clr + '10', borderRadius: '10px', padding: '14px', borderLeft: `3px solid ${t.clr}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <Icon name={t.icon} size={14} style={{ color: t.clr }} />
                <span style={{ fontSize: '11px', fontWeight: 600, color: t.clr }}>{t.label}</span>
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{t.value}</div>
              <div style={{ fontSize: '10px', color: THEME.textLow, marginTop: '2px' }}>timesheets</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Expiring Contracts Alert */}
      {expiringContracts.length > 0 && (
        <Section title="Expiring Contracts" sub="Active contracts ending within 30 days" style={{ marginBottom: '16px' }}>
          {expiringContracts.map((c, i) => {
            const daysLeft = Math.ceil((new Date(c.end_date) - new Date()) / 86400000)
            const urgentColor = daysLeft <= 7 ? '#E53935' : daysLeft <= 14 ? '#E65100' : ACCENT.amber
            return (
              <ActivityRow
                key={c.id}
                icon="event_busy" iconColor={urgentColor}
                title={c.contractor?.name || '—'}
                sub={`Ends ${c.end_date}${c.contract_type ? ` · ${c.contract_type.replace(/_/g, ' ')}` : ''}`}
                right={`${daysLeft}d left`}
                rightColor={urgentColor}
                isLast={i === expiringContracts.length - 1}
              />
            )
          })}
        </Section>
      )}

      {/* Recent Contracts */}
      <Section title="Recent Contracts" sub="Latest contracts for this site" style={{ marginBottom: '16px' }}>
        {recentContracts.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No contracts yet</div>
        ) : (
          recentContracts.map((c, i) => (
            <ActivityRow
              key={c.id}
              icon="description"
              iconColor={STATUS_CLR[c.status] || color}
              title={c.contractor?.name || '—'}
              sub={`${c.contract_number || c.description || '—'} · ${c.start_date || '—'} → ${c.end_date || 'open'}`}
              right={(c.status || '—').toUpperCase()}
              rightColor={STATUS_CLR[c.status] || color}
              isLast={i === recentContracts.length - 1}
            />
          ))
        )}
      </Section>
    </div>
  )
}
