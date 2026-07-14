import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { Card, Icon, PageHeader, Button, showToast } from '../../../components/ui'
import { DashCard, KpiCard, ProgressRow, SectionTitle } from '../../../components/dash'

const ACCENT = MODULE_COLORS.workforce
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export default function TurnoverReport({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const now = new Date()
  const [fromDate, setFromDate] = useState(iso(new Date(now.getFullYear(), 0, 1)))
  const [toDate, setToDate] = useState(iso(now))
  const [loading, setLoading] = useState(true)
  const [terminations, setTerminations] = useState([])
  const [employees, setEmployees] = useState([])

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [termRes, empRes] = await Promise.all([
        supabase
          .from('employee_status_history')
          .select('id, employee_id, old_status, new_status, reason, effective_date, created_at, employee:employees(id, name, employee_number, start_date)')
          .eq('site_id', currentSiteId)
          .eq('new_status', 'terminated')
          .gte('effective_date', fromDate)
          .lte('effective_date', toDate),
        supabase
          .from('employees')
          .select('id, name, employee_number, start_date, status, is_archived')
          .eq('site_id', currentSiteId),
      ])
      if (termRes.error) throw termRes.error
      if (empRes.error) throw empRes.error
      setTerminations(termRes.data || [])
      setEmployees((empRes.data || []).filter(e => !e.is_archived))
    } catch (err) {
      console.error('TurnoverReport fetch:', err)
      showToast('Failed to load turnover data', 'red')
    }
    setLoading(false)
  }, [currentSiteId, fromDate, toDate])

  useEffect(() => {
    if (currentSiteId && can('hr.view')) fetch()
  }, [currentSiteId, fromDate, toDate, fetch])

  const stats = useMemo(() => {
    const newHires = employees.filter(e => e.start_date && e.start_date >= fromDate && e.start_date <= toDate)
    const totalActive = employees.filter(e => e.status !== 'terminated').length
    const termCount = terminations.length
    const turnoverRate = totalActive > 0 ? ((termCount / totalActive) * 100).toFixed(1) : '0.0'

    // Average tenure of terminated employees
    const tenures = terminations
      .filter(t => t.employee?.start_date && t.effective_date)
      .map(t => {
        const start = new Date(t.employee.start_date)
        const end = new Date(t.effective_date)
        return (end - start) / (1000 * 60 * 60 * 24 * 365.25)
      })
    const avgTenure = tenures.length > 0 ? (tenures.reduce((s, v) => s + v, 0) / tenures.length).toFixed(1) : '-'

    // Reasons breakdown
    const byReason = {}
    terminations.forEach(t => {
      const reason = t.reason || 'Not specified'
      byReason[reason] = (byReason[reason] || 0) + 1
    })

    return { newHires: newHires.length, termCount, turnoverRate, avgTenure, byReason, totalActive }
  }, [terminations, employees, fromDate, toDate])

  const handleExport = useCallback(() => {
    const headers = ['Employee #', 'Name', 'Start Date', 'Termination Date', 'Tenure (yrs)', 'Reason']
    const rows = terminations.map(t => {
      const startDate = t.employee?.start_date || '-'
      let tenure = '-'
      if (t.employee?.start_date && t.effective_date) {
        tenure = ((new Date(t.effective_date) - new Date(t.employee.start_date)) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1)
      }
      return [t.employee?.employee_number || '-', t.employee?.name || '-', startDate, t.effective_date || '-', tenure, t.reason || '-']
    })
    exportCsv(`turnover_${fromDate}_${toDate}.csv`, headers, rows)
  }, [terminations, fromDate, toDate])

  if (!can('hr.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>
          You don't have permission to view HR reports.
        </div>
      </Card>
    )
  }

  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
  const reasonEntries = Object.entries(stats.byReason).sort((a, b) => b[1] - a[1])

  return (
    <div>
      <PageHeader title="Turnover Report" site={currentSite} />

      {/* Date range */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <label style={{ color: THEME.textMed, fontSize: '13px' }}>From</label>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px' }} />
        <label style={{ color: THEME.textMed, fontSize: '13px' }}>To</label>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: '13px' }} />
        {can('hr.edit') && (
          <Button icon="download" onClick={handleExport} style={{ marginLeft: 'auto' }}>Export CSV</Button>
        )}
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <>
          {/* KPI cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '18px' }}>
            <KpiCard label="Terminations" value={stats.termCount} icon="person_off" accent={THEME.error} />
            <KpiCard label="New Hires" value={stats.newHires} icon="person_add" accent={THEME.success} />
            <KpiCard label="Turnover Rate" value={stats.turnoverRate + '%'} icon="swap_vert" accent={ACCENT} progress={parseFloat(stats.turnoverRate)} />
            <KpiCard label="Avg Tenure" value={stats.avgTenure === '-' ? '-' : stats.avgTenure + ' yrs'} icon="schedule" accent={THEME.info} />
            <KpiCard label="Active Employees" value={stats.totalActive} icon="groups" accent={THEME.textMed} />
          </div>

          {/* Reasons breakdown */}
          <DashCard style={{ marginBottom: '18px' }}>
            <SectionTitle title="Termination Reasons" subtitle={`${fromDate} to ${toDate}`} />
            {reasonEntries.length === 0 ? (
              <div style={{ padding: '8px 0', color: THEME.textLow, fontSize: '13px' }}>No terminations in this period</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {reasonEntries.map(([reason, count]) => (
                  <ProgressRow key={reason} label={reason}
                    value={`${count} (${stats.termCount > 0 ? ((count / stats.termCount) * 100).toFixed(0) : 0}%)`}
                    pct={stats.termCount > 0 ? (count / stats.termCount) * 100 : 0}
                    color={THEME.error} />
                ))}
              </div>
            )}
          </DashCard>

          {/* Termination detail */}
          <DashCard>
            <SectionTitle title="Termination Details" subtitle={`${fromDate} to ${toDate}`} />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    {['Employee #', 'Name', 'Start Date', 'Termination Date', 'Tenure', 'Reason'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {terminations.map(t => {
                    let tenure = '-'
                    if (t.employee?.start_date && t.effective_date) {
                      tenure = ((new Date(t.effective_date) - new Date(t.employee.start_date)) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1) + ' yrs'
                    }
                    return (
                      <tr key={t.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{t.employee?.employee_number || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{t.employee?.name || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{t.employee?.start_date || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{t.effective_date || '-'}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{tenure}</td>
                        <td style={{ padding: '8px 10px', color: THEME.text }}>{t.reason || '-'}</td>
                      </tr>
                    )
                  })}
                  {terminations.length === 0 && (
                    <tr><td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: THEME.textLow }}>No terminations in this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </DashCard>
        </>
      )}
    </div>
  )
}
