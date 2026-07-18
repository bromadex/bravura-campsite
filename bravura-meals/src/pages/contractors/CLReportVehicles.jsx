import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { supabase } from '../../supabaseClient'
import { showToast, StatusBadge } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { DashCard, KpiCard, DonutGauge, SectionTitle } from '../../components/dash'

const color = MODULE_COLORS.contractors

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const daysActive = (start, end) => { if (!start) return 0; const s = new Date(start); const e = end ? new Date(end) : new Date(); return Math.max(0, Math.round((e - s) / 86400000)) }

export default function CLReportVehicles({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [rows, setRows] = useState([])
  const [contractors, setContractors] = useState([])
  const [filterContractor, setFilterContractor] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('contractors').select('id,name').eq('is_archived', false).order('name')
      .then(({ data }) => setContractors(data || []))
  }, [])

  useEffect(() => {
    if (!currentSiteId) return
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('hired_vehicles')
        .select('id, description, contractor_id, registration, daily_rate, status, start_date, end_date, is_archived')
        .eq('site_id', currentSiteId)
        .eq('is_archived', false)
      if (error) { showToast(error.message, 'red'); setLoading(false); return }

      const cMap = {}
      ;(contractors || []).forEach(c => { cMap[c.id] = c.name })

      setRows((data || []).map(r => {
        const days = daysActive(r.start_date, r.end_date)
        return { ...r, contractorName: cMap[r.contractor_id] || '-', daysActive: days, estimatedCost: days * Number(r.daily_rate || 0) }
      }))
      setLoading(false)
    })()
  }, [currentSiteId, contractors])

  const filtered = useMemo(() => rows.filter(r =>
    (!filterContractor || r.contractor_id === filterContractor) &&
    (!filterStatus || r.status === filterStatus)
  ), [rows, filterContractor, filterStatus])

  const kpis = useMemo(() => ({
    total: filtered.length,
    active: filtered.filter(r => r.status === 'active').length,
    totalCost: filtered.reduce((s, r) => s + r.estimatedCost, 0),
    avgRate: filtered.length ? filtered.reduce((s, r) => s + Number(r.daily_rate || 0), 0) / filtered.length : 0,
  }), [filtered])

  if (!can('contractors.view')) return null

  const inp = {
    padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const th = { padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textLow, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }
  const td = { padding: '10px 12px', fontSize: '13px', color: THEME.text, borderBottom: `1px solid ${THEME.outlineVar}` }

  const activePct = kpis.total > 0 ? (kpis.active / kpis.total) * 100 : null

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <button onClick={() => setPage?.('cl_reports')} style={{ background: 'none', border: 'none', color: color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px', padding: 0, fontFamily: 'inherit' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>arrow_back</span>
        Back to Reports
      </button>
      <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text, marginBottom: '16px' }}>Vehicle Hire Report</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <KpiCard label="Total Vehicles" value={kpis.total} icon="local_shipping" accent={color} />
        <KpiCard label="Active" value={kpis.active} icon="check_circle" accent={THEME.success} progress={activePct} sub={activePct !== null ? `${activePct.toFixed(0)}% of fleet` : undefined} />
        <KpiCard label="Est. Total Cost" value={fmtMoney(kpis.totalCost)} icon="payments" accent={color} />
        <KpiCard label="Avg Daily Rate" value={fmtMoney(kpis.avgRate)} icon="analytics" accent={color} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', alignItems: 'center' }}>
        <select value={filterContractor} onChange={e => setFilterContractor(e.target.value)} style={inp}>
          <option value="">All Contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={inp}>
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="returned">Returned</option>
          <option value="maintenance">Maintenance</option>
        </select>
        <button onClick={() => exportCsv('vehicle-hire-report.csv',
          ['Description', 'Contractor', 'Registration', 'Daily Rate', 'Days Active', 'Est. Cost', 'Status'],
          filtered.map(r => [r.description, r.contractorName, r.registration || '', r.daily_rate, r.daysActive, r.estimatedCost.toFixed(2), r.status])
        )} style={{ ...inp, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Export CSV
        </button>
      </div>

      {kpis.total > 0 && (
        <DashCard style={{ marginBottom: '16px' }}>
          <SectionTitle title="Active Vehicles" subtitle="Share of hired vehicles currently active" />
          <DonutGauge
            pct={activePct}
            color={color}
            label="active"
            legend={[[color, `Active ${kpis.active}`], [THEME.surfaceVar, `Other ${kpis.total - kpis.active}`]]}
          />
        </DashCard>
      )}

      <DashCard style={{ padding: '12px 16px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Description</th><th style={th}>Contractor</th><th style={th}>Registration</th>
              <th style={{ ...th, textAlign: 'right' }}>Daily Rate</th><th style={{ ...th, textAlign: 'right' }}>Days Active</th>
              <th style={{ ...th, textAlign: 'right' }}>Est. Cost</th><th style={th}>Status</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: THEME.textMed }}>No data found</td></tr>
              ) : filtered.map((r, i) => (
                <tr key={r.id || i}>
                  <td style={td}>{r.description}</td><td style={td}>{r.contractorName}</td><td style={td}>{r.registration || '-'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{fmtMoney(r.daily_rate)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{r.daysActive}</td>
                  <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(r.estimatedCost)}</td>
                  <td style={td}>
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DashCard>
    </div>
  )
}
