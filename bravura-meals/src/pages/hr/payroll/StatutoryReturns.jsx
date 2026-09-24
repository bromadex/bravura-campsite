import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { exportCsv } from '../../../utils/csv'
import { Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, SectionLabel, showToast } from '../../../components/ui'
import Denied from '../../../components/Denied'

const ACCENT = MODULE_COLORS.workforce
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const TABS = [
  { id: 'paye', label: 'PAYE return (ZIMRA)' },
  { id: 'nssa', label: 'NSSA return (P4)' },
  { id: 'tables', label: 'Tax tables & rates' },
]

const sel = {
  padding: '8px 12px', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
  fontSize: '13px', fontFamily: 'inherit', background: THEME.surface, color: THEME.text,
}
const num = { ...sel, width: '100%', boxSizing: 'border-box', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
const fmt = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const tab = active => ({
  padding: '8px 14px', border: 'none', borderBottom: `2px solid ${active ? ACCENT : 'transparent'}`,
  background: 'transparent', color: active ? ACCENT : THEME.textMed, fontWeight: active ? 600 : 400,
  fontSize: '13px', fontFamily: 'inherit', cursor: 'pointer',
})

export default function StatutoryReturns() {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const canSettings = can('hr.settings')

  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [view, setView] = useState('paye')
  const [run, setRun] = useState(null)
  const [slips, setSlips] = useState([])
  const [loading, setLoading] = useState(true)

  const loadReturn = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data: r } = await supabase.from('payroll_runs').select('*')
      .eq('site_id', currentSiteId).eq('period_month', month).eq('period_year', year).maybeSingle()
    setRun(r || null)
    if (r) {
      const { data, error } = await supabase.from('salary_slips')
        .select('id, gross_salary, taxable_income, paye, aids_levy, nssa_insurable, nssa_employee, nssa_employer, employee:employees!salary_slips_employee_id_fkey(name, employee_number, national_id, nssa_number, zimra_tin)')
        .eq('payroll_run_id', r.id).eq('site_id', currentSiteId).eq('is_archived', false)
      if (error) showToast('Failed to load payroll slips', 'red')
      setSlips((data || []).sort((a, b) => (a.employee?.name || '').localeCompare(b.employee?.name || '')))
    } else {
      setSlips([])
    }
    setLoading(false)
  }, [currentSiteId, month, year])

  useEffect(() => { loadReturn() }, [loadReturn])

  const totals = useMemo(() => slips.reduce((t, s) => ({
    gross: t.gross + Number(s.gross_salary || 0),
    taxable: t.taxable + Number(s.taxable_income || 0),
    paye: t.paye + Number(s.paye || 0),
    levy: t.levy + Number(s.aids_levy || 0),
    insurable: t.insurable + Number(s.nssa_insurable || 0),
    ee: t.ee + Number(s.nssa_employee || 0),
    er: t.er + Number(s.nssa_employer || 0),
  }), { gross: 0, taxable: 0, paye: 0, levy: 0, insurable: 0, ee: 0, er: 0 }), [slips])

  const missing = useMemo(() => slips.filter(s =>
    view === 'nssa' ? !s.employee?.nssa_number : !s.employee?.zimra_tin && !s.employee?.national_id
  ).length, [slips, view])

  if (!can('hr.view')) return <Denied />

  const period = `${year}-${String(month).padStart(2, '0')}`

  function exportPaye() {
    exportCsv(`paye_return_${period}.csv`,
      ['Employee', 'Emp #', 'National ID', 'ZIMRA TIN', 'Gross', 'Taxable income', 'PAYE', 'AIDS levy', 'Total tax'],
      [...slips.map(s => [s.employee?.name, s.employee?.employee_number, s.employee?.national_id || '', s.employee?.zimra_tin || '',
        fmt(s.gross_salary), fmt(s.taxable_income), fmt(s.paye), fmt(s.aids_levy), fmt(Number(s.paye) + Number(s.aids_levy))]),
       ['TOTAL', '', '', '', fmt(totals.gross), fmt(totals.taxable), fmt(totals.paye), fmt(totals.levy), fmt(totals.paye + totals.levy)]])
  }

  function exportNssa() {
    exportCsv(`nssa_p4_${period}.csv`,
      ['Employee', 'Emp #', 'National ID', 'NSSA number', 'Gross', 'Insurable earnings', 'Employee 4.5%', 'Employer 4.5%', 'Total'],
      [...slips.map(s => [s.employee?.name, s.employee?.employee_number, s.employee?.national_id || '', s.employee?.nssa_number || '',
        fmt(s.gross_salary), fmt(s.nssa_insurable), fmt(s.nssa_employee), fmt(s.nssa_employer), fmt(Number(s.nssa_employee) + Number(s.nssa_employer))]),
       ['TOTAL', '', '', '', fmt(totals.gross), fmt(totals.insurable), fmt(totals.ee), fmt(totals.er), fmt(totals.ee + totals.er)]])
  }

  return (
    <div>
      <PageHeader title="Statutory Returns" site={currentSite?.name}>
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Monthly PAYE and NSSA schedules from the payroll run. USD.</div>
      </PageHeader>

      <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${THEME.outlineVar}`, marginBottom: '16px', flexWrap: 'wrap' }}>
        {TABS.map(t => <button key={t.id} style={tab(view === t.id)} onClick={() => setView(t.id)}>{t.label}</button>)}
      </div>

      {view === 'tables' ? <TaxTables siteId={currentSiteId} canEdit={canSettings} /> : (
        <>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div>
              <SectionLabel>Month</SectionLabel>
              <select id="sr-month" value={month} onChange={e => setMonth(Number(e.target.value))} style={{ ...sel, width: '150px' }}>
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>Year</SectionLabel>
              <select id="sr-year" value={year} onChange={e => setYear(Number(e.target.value))} style={{ ...sel, width: '100px' }}>
                {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {slips.length > 0 && (
              <Button variant="outlined" icon="download" onClick={view === 'paye' ? exportPaye : exportNssa}>Export CSV</Button>
            )}
          </div>

          {run && run.status === 'draft' && (
            <Card style={{ marginBottom: '12px', padding: '10px 14px', background: THEME.statusWarningBg, color: THEME.statusWarningText, fontSize: '12px' }}>
              This payroll is still a draft — figures change if it is re-run. File the return once payroll is approved.
            </Card>
          )}
          {missing > 0 && (
            <Card style={{ marginBottom: '12px', padding: '10px 14px', background: THEME.statusWarningBg, color: THEME.statusWarningText, fontSize: '12px' }}>
              {missing} employee{missing === 1 ? ' has' : 's have'} no {view === 'nssa' ? 'NSSA number' : 'ZIMRA TIN or national ID'} — add it on the employee record before filing.
            </Card>
          )}

          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: ACCENT }} /></div>
          ) : !run ? (
            <Card style={{ padding: '48px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
              No payroll run for {MONTHS[month - 1]} {year}. Run payroll first (HR27).
            </Card>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {(view === 'paye'
                  ? [['Taxable income', totals.taxable], ['PAYE', totals.paye], ['AIDS levy', totals.levy], ['Payable to ZIMRA', totals.paye + totals.levy]]
                  : [['Insurable earnings', totals.insurable], ['Employee share', totals.ee], ['Employer share', totals.er], ['Payable to NSSA', totals.ee + totals.er]]
                ).map(([label, v], i) => (
                  <Card key={label} style={{ padding: '14px 16px', minWidth: '150px', flex: '1 1 150px' }}>
                    <div style={{ fontSize: '12px', color: THEME.textLow, marginBottom: '4px' }}>{label}</div>
                    <div style={{ fontSize: '20px', fontWeight: 600, color: i === 3 ? ACCENT : THEME.text, fontVariantNumeric: 'tabular-nums' }}>${fmt(v)}</div>
                  </Card>
                ))}
              </div>

              <TableWrap>
                {view === 'paye' ? (
                  <>
                    <THead>
                      <Th>Employee</Th><Th>ZIMRA TIN / ID</Th>
                      <Th align="right">Gross</Th><Th align="right">Taxable</Th><Th align="right">PAYE</Th><Th align="right">AIDS levy</Th>
                    </THead>
                    {slips.map((s, i) => (
                      <TRow key={s.id} last={i === slips.length - 1}>
                        <Td><span style={{ fontWeight: 600, color: THEME.text }}>{s.employee?.name}</span> <span style={{ color: THEME.textLow, fontSize: '12px' }}>{s.employee?.employee_number}</span></Td>
                        <Td style={{ fontSize: '12px' }}>{s.employee?.zimra_tin || s.employee?.national_id || <span style={{ color: THEME.statusWarningText }}>missing</span>}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.gross_salary)}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.taxable_income)}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.paye)}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.aids_levy)}</Td>
                      </TRow>
                    ))}
                  </>
                ) : (
                  <>
                    <THead>
                      <Th>Employee</Th><Th>NSSA number</Th>
                      <Th align="right">Gross</Th><Th align="right">Insurable</Th><Th align="right">Employee</Th><Th align="right">Employer</Th>
                    </THead>
                    {slips.map((s, i) => (
                      <TRow key={s.id} last={i === slips.length - 1}>
                        <Td><span style={{ fontWeight: 600, color: THEME.text }}>{s.employee?.name}</span> <span style={{ color: THEME.textLow, fontSize: '12px' }}>{s.employee?.employee_number}</span></Td>
                        <Td style={{ fontSize: '12px' }}>{s.employee?.nssa_number || <span style={{ color: THEME.statusWarningText }}>missing</span>}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.gross_salary)}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.nssa_insurable)}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.nssa_employee)}</Td>
                        <Td align="right" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(s.nssa_employer)}</Td>
                      </TRow>
                    ))}
                  </>
                )}
              </TableWrap>
            </>
          )}
        </>
      )}
    </div>
  )
}

function TaxTables({ siteId, canEdit }) {
  const [settings, setSettings] = useState(null)
  const [bands, setBands] = useState([])
  const [draftBands, setDraftBands] = useState([])
  const [newFrom, setNewFrom] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!siteId) return
    const [st, bd] = await Promise.all([
      supabase.from('hr_statutory_settings').select('*').eq('site_id', siteId).maybeSingle(),
      supabase.from('hr_paye_bands').select('*').eq('site_id', siteId).eq('is_archived', false)
        .order('effective_from', { ascending: false }).order('lower_bound'),
    ])
    setSettings(st.data)
    const all = bd.data || []
    const latest = all[0]?.effective_from
    const current = all.filter(b => b.effective_from === latest)
    setBands(current)
    setDraftBands(current.map(b => ({ ...b })))
  }, [siteId])

  useEffect(() => { load() }, [load])

  async function saveSettings() {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('hr_statutory_settings').update({
      aids_levy_rate: Number(settings.aids_levy_rate),
      nssa_employee_rate: Number(settings.nssa_employee_rate),
      nssa_employer_rate: Number(settings.nssa_employer_rate),
      nssa_ceiling: Number(settings.nssa_ceiling),
      nssa_tax_deductible: settings.nssa_tax_deductible,
      updated_by: user?.id, updated_at: new Date().toISOString(),
    }).eq('id', settings.id).eq('site_id', siteId)
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Rates saved', 'green')
    load()
  }

  // A new band set is dated; older sets stay for re-running earlier months.
  async function saveBands() {
    if (!newFrom) { showToast('Pick the date the new bands take effect', 'red'); return }
    if (draftBands.some(b => b.rate === '' || b.lower_bound === '')) { showToast('Every band needs a floor and a rate', 'red'); return }
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    const rows = draftBands.map(b => ({
      site_id: siteId, effective_from: newFrom,
      lower_bound: Number(b.lower_bound), upper_bound: b.upper_bound === '' || b.upper_bound == null ? null : Number(b.upper_bound),
      rate: Number(b.rate), deduct_amount: Number(b.deduct_amount || 0), created_by: user?.id,
    }))
    const { error } = await supabase.from('hr_paye_bands').insert(rows)
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`New PAYE bands effective ${newFrom}`, 'green')
    setNewFrom('')
    load()
  }

  function setBand(i, key, value) {
    setDraftBands(d => d.map((b, j) => j === i ? { ...b, [key]: value } : b))
  }

  if (!settings) return <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: ACCENT }} /></div>

  const rate = (key, label, suffix) => (
    <div style={{ flex: '1 1 160px' }}>
      <label htmlFor={`st-${key}`}><SectionLabel>{label}</SectionLabel></label>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <input id={`st-${key}`} type="number" step="0.01" style={num} value={settings[key]} disabled={!canEdit}
          onChange={e => setSettings({ ...settings, [key]: e.target.value })} />
        <span style={{ fontSize: '12px', color: THEME.textLow }}>{suffix}</span>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <Card style={{ padding: '12px 16px', background: THEME.statusInfoBg, fontSize: '12px', color: THEME.textMed, lineHeight: 1.6 }}>
        Seeded with the USD monthly PAYE bands in force from 1 January 2025, a 3% AIDS levy, and NSSA at 4.5% + 4.5% on earnings up to $700.
        Confirm these against the current ZIMRA and NSSA notices — when they change, enter the new figures here with the date they take effect.
      </Card>

      <Card style={{ padding: '16px' }}>
        <div style={{ fontWeight: 600, color: THEME.text, marginBottom: '12px' }}>Rates</div>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {rate('aids_levy_rate', 'AIDS levy', '% of PAYE')}
          {rate('nssa_employee_rate', 'NSSA — employee', '%')}
          {rate('nssa_employer_rate', 'NSSA — employer', '%')}
          {rate('nssa_ceiling', 'NSSA insurable ceiling', 'USD / month')}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: THEME.textMed }}>
          <input id="st-nssa-deductible" type="checkbox" checked={settings.nssa_tax_deductible} disabled={!canEdit}
            onChange={e => setSettings({ ...settings, nssa_tax_deductible: e.target.checked })} />
          Employee NSSA reduces taxable income
        </label>
        {canEdit && <div style={{ marginTop: '12px' }}><Button onClick={saveSettings} disabled={saving} style={{ background: ACCENT, color: '#fff' }}>Save rates</Button></div>}
      </Card>

      <Card style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
          <div style={{ fontWeight: 600, color: THEME.text }}>PAYE bands (monthly, USD)</div>
          <div style={{ fontSize: '12px', color: THEME.textLow }}>In force from {bands[0]?.effective_from || '—'} · tax = income × rate − deduct</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '480px' }}>
            <thead>
              <tr style={{ color: THEME.textLow, fontSize: '12px', textAlign: 'right' }}>
                <th style={{ padding: '6px', fontWeight: 500 }}>From</th><th style={{ padding: '6px', fontWeight: 500 }}>To</th>
                <th style={{ padding: '6px', fontWeight: 500 }}>Rate %</th><th style={{ padding: '6px', fontWeight: 500 }}>Deduct</th>
              </tr>
            </thead>
            <tbody>
              {draftBands.map((b, i) => (
                <tr key={b.id || i}>
                  {['lower_bound', 'upper_bound', 'rate', 'deduct_amount'].map(k => (
                    <td key={k} style={{ padding: '4px 6px' }}>
                      <input id={`band-${i}-${k}`} aria-label={`Band ${i + 1} ${k}`} type="number" step="0.01" style={num}
                        value={b[k] ?? ''} placeholder={k === 'upper_bound' ? 'and above' : ''} disabled={!canEdit}
                        onChange={e => setBand(i, k, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '12px', flexWrap: 'wrap' }}>
            <div>
              <label htmlFor="st-new-from"><SectionLabel>New bands take effect from</SectionLabel></label>
              <input id="st-new-from" type="date" style={sel} value={newFrom} onChange={e => setNewFrom(e.target.value)} />
            </div>
            <Button onClick={saveBands} disabled={saving} style={{ background: ACCENT, color: '#fff' }}>Save as new band set</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
