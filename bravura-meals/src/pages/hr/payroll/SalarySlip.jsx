import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { showToast } from '../../../components/ui'

const COLOR = MODULE_COLORS.workforce
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const fmtCurrency = n => n != null ? '$' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'

export default function SalarySlip() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const [runs, setRuns] = useState([])
  const [selectedRun, setSelectedRun] = useState(null)
  const [slips, setSlips] = useState([])
  const [selectedSlip, setSelectedSlip] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('payroll_runs')
        .select('*')
        .eq('site_id', currentSiteId)
        .order('period_year', { ascending: false })
        .order('period_month', { ascending: false })
      if (error) { console.error(error); showToast('Failed to load payroll runs', 'red') }
      if (!cancelled) { setRuns(data || []); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId])

  const loadSlips = useCallback(async (run) => {
    setSelectedRun(run)
    setSelectedSlip(null)
    const { data, error } = await supabase
      .from('salary_slips')
      .select('*, employee:employees!salary_slips_employee_id_fkey(id, name, employee_number, department:departments!employees_department_id_fkey(id, name), designation:designations(id, name))')
      .eq('payroll_run_id', run.id)
      .eq('site_id', currentSiteId)
      .order('created_at')
    if (error) { console.error(error); showToast('Failed to load slips', 'red') }
    setSlips(data || [])
  }, [currentSiteId])

  const doExport = () => {
    if (!slips.length) return
    const headers = ['Employee', 'Employee #', 'Department', 'Basic', 'Gross', 'Deductions', 'Net']
    const data = slips.map(s => [
      s.employee?.name || '', s.employee?.employee_number || '',
      s.employee?.department?.name || '',
      s.basic_salary, s.gross_salary, s.total_deductions, s.net_salary,
    ])
    const run = selectedRun
    exportCsv(`payslips-${MONTHS[run.period_month - 1]}-${run.period_year}.csv`, headers, data)
  }

  if (!can('hr.view')) return <div style={{ padding: 40, textAlign: 'center', color: THEME.textMed }}>Access denied</div>

  if (selectedSlip) {
    const s = selectedSlip
    const comps = s.components || []
    const earnings = comps.filter(c => c.type === 'allowance')
    const deductions = comps.filter(c => c.type === 'deduction')
    return (
      <div style={{ maxWidth: 700, margin: '0 auto' }}>
        <style>{`@media print { .no-print { display: none !important; } }`}</style>
        <div className="no-print" style={{ marginBottom: 16 }}>
          <button onClick={() => setSelectedSlip(null)} style={{ background: 'none', border: 'none', color: COLOR, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'inherit' }}>← Back to Slips</button>
          <button onClick={() => window.print()} style={{ marginLeft: 12, background: COLOR, color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Print</button>
        </div>
        <div style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: 12, padding: 32 }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: THEME.text }}>Bravura Zimbabwe</h2>
            <div style={{ fontSize: 13, color: THEME.textMed }}>{currentSite?.name || 'Site'}</div>
            <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>Payslip — {MONTHS[selectedRun.period_month - 1]} {selectedRun.period_year}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20, fontSize: 13 }}>
            <div><span style={{ color: THEME.textLow }}>Name:</span> <strong style={{ color: THEME.text }}>{s.employee?.name}</strong></div>
            <div><span style={{ color: THEME.textLow }}>Employee #:</span> <strong style={{ color: THEME.text }}>{s.employee?.employee_number || '—'}</strong></div>
            <div><span style={{ color: THEME.textLow }}>Department:</span> <span style={{ color: THEME.text }}>{s.employee?.department?.name || '—'}</span></div>
            <div><span style={{ color: THEME.textLow }}>Designation:</span> <span style={{ color: THEME.text }}>{s.employee?.designation?.name || '—'}</span></div>
            <div><span style={{ color: THEME.textLow }}>Days Worked:</span> <span style={{ color: THEME.text }}>{s.days_worked ?? '—'}</span></div>
            <div><span style={{ color: THEME.textLow }}>Days Absent:</span> <span style={{ color: THEME.text }}>{s.days_absent ?? '—'}</span></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: THEME.success }}>Earnings</h4>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <tbody>
                  <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '6px 0', color: THEME.text }}>Basic Salary</td>
                    <td style={{ padding: '6px 0', textAlign: 'right', color: THEME.text }}>{fmtCurrency(s.basic_salary)}</td>
                  </tr>
                  {earnings.map((c, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '6px 0', color: THEME.text }}>{c.name}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: THEME.text }}>{fmtCurrency(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h4 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: THEME.error }}>Deductions</h4>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <tbody>
                  {deductions.map((c, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '6px 0', color: THEME.text }}>{c.name}</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', color: THEME.text }}>{fmtCurrency(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ marginTop: 20, borderTop: `2px solid ${THEME.outlineVar}`, paddingTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span style={{ color: THEME.textMed }}>Gross Salary</span>
              <span style={{ fontWeight: 600, color: THEME.text }}>{fmtCurrency(s.gross_salary)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: THEME.textMed }}>Total Deductions</span>
              <span style={{ fontWeight: 600, color: THEME.error }}>{fmtCurrency(s.total_deductions)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, borderTop: `2px solid ${COLOR}`, paddingTop: 8 }}>
              <span style={{ fontWeight: 700, color: THEME.text }}>NET PAY</span>
              <span style={{ fontWeight: 800, color: COLOR }}>{fmtCurrency(s.net_salary)}</span>
            </div>
          </div>
          <div style={{ marginTop: 24, textAlign: 'center', fontSize: 11, color: THEME.textLow }}>This is a computer-generated payslip</div>
        </div>
      </div>
    )
  }

  if (selectedRun) {
    return (
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <button onClick={() => { setSelectedRun(null); setSlips([]) }} style={{ background: 'none', border: 'none', color: COLOR, cursor: 'pointer', fontWeight: 600, fontSize: 14, fontFamily: 'inherit' }}>← Back to Runs</button>
            <h2 style={{ margin: '8px 0 0', fontSize: 20, fontWeight: 400, color: THEME.text }}>
              Payslips — {MONTHS[selectedRun.period_month - 1]} {selectedRun.period_year}
            </h2>
          </div>
          {slips.length > 0 && can('hr.edit') && (
            <button onClick={doExport} style={{ background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outline}`, borderRadius: 10, padding: '8px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Export CSV</button>
          )}
        </div>
        <div style={{ background: THEME.surface, borderRadius: 12, border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                {['Employee', 'Employee #', 'Department', 'Basic', 'Gross', 'Deductions', 'Net', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: ['Basic','Gross','Deductions','Net'].includes(h) ? 'right' : 'left', fontSize: 11, fontWeight: 600, color: THEME.textMed }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slips.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: THEME.textLow }}>No slips found.</td></tr>
              ) : slips.map(s => (
                <tr key={s.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => setSelectedSlip(s)}>
                  <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{s.employee?.name || '—'}</td>
                  <td style={{ padding: '10px 14px', color: COLOR, fontWeight: 600 }}>{s.employee?.employee_number || '—'}</td>
                  <td style={{ padding: '10px 14px', color: THEME.textMed }}>{s.employee?.department?.name || '—'}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.textMed }}>{fmtCurrency(s.basic_salary)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.text }}>{fmtCurrency(s.gross_salary)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.error }}>{fmtCurrency(s.total_deductions)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: COLOR }}>{fmtCurrency(s.net_salary)}</td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ color: COLOR, fontSize: 12, fontWeight: 600 }}>View →</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 400, color: THEME.text }}>Salary Slips</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textMed }}>Select a payroll run to view individual employee payslips</p>
      </div>
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: THEME.textLow }}>Loading…</div>
      ) : runs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: THEME.textLow }}>No payroll runs found. Run payroll first.</div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: 12, border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                {['Period', 'Status', 'Employees', 'Total Gross', 'Total Net', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: ['Total Gross','Total Net','Employees'].includes(h) ? 'right' : 'left', fontSize: 11, fontWeight: 600, color: THEME.textMed }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map(r => {
                const sc = { draft: { bg: THEME.surfaceVar, text: THEME.textMed }, processing: { bg: THEME.statusWarningBg, text: THEME.statusWarningText }, approved: { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText }, paid: { bg: '#e3f2fd', text: '#1565c0' } }[r.status] || { bg: THEME.surfaceVar, text: THEME.textMed }
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onClick={() => loadSlips(r)}>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 600 }}>{MONTHS[r.period_month - 1]} {r.period_year}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text }}>{r.status}</span>
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.textMed }}>{r.employee_count ?? '—'}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: THEME.text }}>{fmtCurrency(r.total_gross)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: COLOR }}>{fmtCurrency(r.total_net)}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ color: COLOR, fontSize: 12, fontWeight: 600 }}>View Slips →</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
