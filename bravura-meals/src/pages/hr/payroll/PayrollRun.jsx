import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { useAuth } from '../../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, SectionLabel, showToast } from '../../../components/ui'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce
const WORKING_DAYS = 22

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

const selectStyle = { ...inputStyle, background: THEME.surface }

const STATUS_STYLES = {
  draft:      { bg: THEME.statusNeutralBg,  color: THEME.statusNeutralText },
  processing: { bg: THEME.statusWarningBg,  color: THEME.statusWarningText },
  approved:   { bg: THEME.statusSuccessBg,  color: THEME.statusSuccessText },
  paid:       { bg: THEME.statusInfoBg,     color: THEME.statusInfoText },
}

function statusBadge(status) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.draft
  return (
    <span style={{
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: s.bg, color: s.color, textTransform: 'capitalize',
    }}>
      {status || 'draft'}
    </span>
  )
}

function fmt(n) {
  return n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function PayrollRun() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const { profile } = useAuth()
  const rt = useRealtimeRefresh('payroll_runs', { column: 'site_id', value: currentSiteId })

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [run, setRun] = useState(null)
  const [slips, setSlips] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [approving, setApproving] = useState(false)

  const fetchRun = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data: runs, error } = await supabase.from('payroll_runs').select('*')
        .eq('site_id', currentSiteId)
        .eq('period_month', month)
        .eq('period_year', year)
        .maybeSingle()
      if (error) throw error
      setRun(runs)
      if (runs) {
        const { data: slipData, error: slipErr } = await supabase.from('salary_slips')
          .select('*, employees(name, employee_number, departments(name), designations(name))')
          .eq('payroll_run_id', runs.id)
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('created_at')
        if (slipErr) throw slipErr
        setSlips(slipData || [])
      } else {
        setSlips([])
      }
    } catch (err) {
      console.error(err)
      showToast('Failed to load payroll run', 'red')
    } finally {
      setLoading(false)
    }
  }, [currentSiteId, month, year])

  useEffect(() => { fetchRun() }, [fetchRun, rt])

  // ── Gate (after all hooks) ────────────────────────────────────────────────
  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const canRunPayroll = can('hr.edit')
  const canApprove = can('hr.approve')
  const canRun = canRunPayroll && (!run || run.status === 'draft')

  async function runPayroll() {
    if (!canRunPayroll) return
    if (!window.confirm(`Run payroll for ${MONTHS[month - 1]} ${year}? PAYE, AIDS levy and NSSA are calculated for all active employees.`)) return
    setProcessing(true)
    try {
      const { data, error } = await supabase.rpc('hr_run_payroll', {
        p_site_id: currentSiteId, p_month: month, p_year: year, p_working_days: WORKING_DAYS,
      })
      if (error) throw error
      if (!data?.employees) showToast('No active employees found', 'red')
      else showToast(`Payroll generated for ${data.employees} employees`, 'green')
      fetchRun()
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Payroll run failed', 'red')
    } finally {
      setProcessing(false)
    }
  }

  async function markPaid() {
    if (!canApprove || !run) return
    if (!window.confirm('Mark this payroll as paid? Net pay and IMTT on the transfers are posted to the ledger.')) return
    setApproving(true)
    try {
      const { error } = await supabase.from('payroll_runs').update({
        status: 'paid',
        paid_at: new Date().toISOString(),
      }).eq('id', run.id).eq('site_id', currentSiteId)
      if (error) throw error
      showToast('Payroll marked as paid', 'green')
      fetchRun()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setApproving(false)
    }
  }

  async function approvePayroll() {
    if (!canApprove || !run) return
    if (!window.confirm('Approve this payroll run? This cannot be undone.')) return
    setApproving(true)
    try {
      const { error } = await supabase.from('payroll_runs').update({
        status: 'approved',
        approved_by: profile?.id || null,
        approved_at: new Date().toISOString(),
      }).eq('id', run.id).eq('site_id', currentSiteId)
      if (error) throw error
      showToast('Payroll approved', 'green')
      fetchRun()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setApproving(false)
    }
  }

  function handleExport() {
    const headers = ['Employee', 'Emp #', 'Basic', 'Gross', 'Taxable', 'PAYE', 'AIDS Levy', 'NSSA', 'Deductions', 'Net', 'Days Worked', 'Days Absent']
    const rows = slips.map(s => [
      s.employees?.name || '—',
      s.employees?.employee_number || '—',
      fmt(s.basic_salary),
      fmt(s.gross_salary),
      fmt(s.taxable_income),
      fmt(s.paye),
      fmt(s.aids_levy),
      fmt(s.nssa_employee),
      fmt(s.total_deductions),
      fmt(s.net_salary),
      s.days_worked,
      s.days_absent,
    ])
    exportCsv(`payroll_${year}_${String(month).padStart(2, '0')}.csv`, headers, rows)
  }

  const summary = useMemo(() => {
    if (!run) return null
    return {
      gross: Number(run.total_gross || 0),
      deductions: Number(run.total_deductions || 0),
      net: Number(run.total_net || 0),
      paye: Number(run.total_paye || 0) + Number(run.total_aids_levy || 0),
      nssa: Number(run.total_nssa_employee || 0) + Number(run.total_nssa_employer || 0),
      count: run.employee_count || slips.length,
    }
  }, [run, slips.length])

  return (
    <div>
      <PageHeader
        title="Payroll Run"
        site={currentSite?.name}
      >
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Process monthly payroll for all active employees at this site.</div>
      </PageHeader>

      {/* Period selector */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div>
          <SectionLabel>Month</SectionLabel>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...selectStyle, width: '160px' }}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <SectionLabel>Year</SectionLabel>
          <select value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...selectStyle, width: '100px' }}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', paddingTop: '20px' }}>
          {canRun && (
            <Button onClick={runPayroll} variant="filled" disabled={processing} icon="play_arrow">
              {processing ? 'Processing...' : 'Run Payroll'}
            </Button>
          )}
          {run && run.status === 'draft' && canApprove && (
            <Button onClick={approvePayroll} variant="filled" disabled={approving} icon="check_circle" style={{ background: THEME.success }}>
              {approving ? 'Approving...' : 'Approve'}
            </Button>
          )}
          {run && run.status === 'approved' && canApprove && (
            <Button onClick={markPaid} variant="filled" disabled={approving} icon="paid">
              {approving ? 'Saving...' : 'Mark as Paid'}
            </Button>
          )}
          {slips.length > 0 && (
            <Button onClick={handleExport} variant="text" icon="download">Export CSV</Button>
          )}
        </div>
      </div>

      {/* Status + summary */}
      {run && (
        <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <Card>
            <div style={{ padding: '16px', minWidth: '140px' }}>
              <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>Status</div>
              {statusBadge(run.status)}
            </div>
          </Card>
          {summary && <>
            <Card>
              <div style={{ padding: '16px', minWidth: '140px' }}>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>Employees</div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{summary.count}</div>
              </div>
            </Card>
            <Card>
              <div style={{ padding: '16px', minWidth: '140px' }}>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>Gross</div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>${fmt(summary.gross)}</div>
              </div>
            </Card>
            <Card>
              <div style={{ padding: '16px', minWidth: '140px' }}>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>Deductions</div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.error }}>${fmt(summary.deductions)}</div>
              </div>
            </Card>
            <Card>
              <div style={{ padding: '16px', minWidth: '140px' }}>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>PAYE + AIDS levy</div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>${fmt(summary.paye)}</div>
              </div>
            </Card>
            <Card>
              <div style={{ padding: '16px', minWidth: '140px' }}>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>NSSA (employee + employer)</div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>${fmt(summary.nssa)}</div>
              </div>
            </Card>
            <Card>
              <div style={{ padding: '16px', minWidth: '140px' }}>
                <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>Net Pay</div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: ACCENT }}>${fmt(summary.net)}</div>
              </div>
            </Card>
          </>}
        </div>
      )}

      {/* Slips table */}
      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: ACCENT }} />
        </div>
      ) : !run ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
            <Icon name="payments" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
            <p>No payroll run for {MONTHS[month - 1]} {year}.</p>
            {canRunPayroll && <p style={{ fontSize: '13px' }}>Click "Run Payroll" to generate salary slips.</p>}
          </div>
        </Card>
      ) : slips.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
            No salary slips in this run.
          </div>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <Th>Employee</Th>
            <Th>Emp #</Th>
            <Th align="right">Basic</Th>
            <Th align="right">Gross</Th>
            <Th align="right">PAYE</Th>
            <Th align="right">NSSA</Th>
            <Th align="right">Deductions</Th>
            <Th align="right">Net Pay</Th>
            <Th align="right">Days Worked</Th>
            <Th align="right">Days Absent</Th>
          </THead>
          {slips.map((s, i) => (
            <TRow key={s.id} last={i === slips.length - 1}>
              <Td><span style={{ fontWeight: 600, color: THEME.text }}>{s.employees?.name || '—'}</span></Td>
              <Td>{s.employees?.employee_number || '—'}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(s.basic_salary)}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(s.gross_salary)}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(Number(s.paye || 0) + Number(s.aids_levy || 0))}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>${fmt(s.nssa_employee)}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', color: THEME.error }}>${fmt(s.total_deductions)}</Td>
              <Td align="right" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>${fmt(s.net_salary)}</Td>
              <Td align="right">{s.days_worked}</Td>
              <Td align="right">{s.days_absent > 0 ? <span style={{ color: THEME.error }}>{s.days_absent}</span> : '0'}</Td>
            </TRow>
          ))}
        </TableWrap>
      )}
    </div>
  )
}
