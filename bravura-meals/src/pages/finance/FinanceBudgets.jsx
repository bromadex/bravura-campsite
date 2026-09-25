import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, useFinanceFonts } from '../../utils/financeTheme'

// FI22 — Budgets (Finance rewrite Phase 4, issue #49; migration 0207). One budget store shared with
// Procurement: yearly per cost centre or project (procurement_budgets), optional monthly split
// (budget_months). Plan vs actual (posted ledger costs) vs committed (approved POs not yet billed).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const usd = n => '$' + Math.round(Number(n || 0)).toLocaleString('en-US')

export default function FinanceBudgets({ setPage }) {
  useFinanceFonts()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [kind, setKind] = useState('cost_centre')
  const [rows, setRows] = useState([])
  const [centres, setCentres] = useState([])
  const [projects, setProjects] = useState([])
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const canEdit = can('finance.edit') || can('procurement.approve')
  const canView = can('finance.view') || can('procurement.view')

  const load = useCallback(async () => {
    if (!currentSiteId || !canView) return
    const [r, c, p] = await Promise.all([
      supabase.rpc('fin_budget_vs_actual', { p_site: currentSiteId, p_year: year, p_month: month }),
      supabase.from('cost_centres').select('id, code, name').eq('site_id', currentSiteId).order('code'),
      supabase.from('projects').select('id, project_code, name').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
    ])
    if (r.error) showToast(r.error.message, 'red')
    setRows(r.data || []); setCentres(c.data || []); setProjects(p.data || [])
  }, [currentSiteId, year, month, canView])
  useEffect(() => { load() }, [load])

  const shown = rows.filter(r => r.kind === kind)
  const t = useMemo(() => shown.reduce((a, r) => ({
    year: a.year + Number(r.year_budget), month: a.month + Number(r.month_budget), ytdB: a.ytdB + Number(r.ytd_budget),
    act: a.act + Number(r.month_actual), ytd: a.ytd + Number(r.ytd_actual), com: a.com + Number(r.committed), left: a.left + Number(r.remaining_year),
  }), { year: 0, month: 0, ytdB: 0, act: 0, ytd: 0, com: 0, left: 0 }), [shown])

  async function openEdit(r) {
    if (!r) { setEdit({ id: null, dim_id: '', amount: '', split: false, months: Array(12).fill('') }); return }
    const { data } = await supabase.from('budget_months').select('month, amount').eq('budget_id', r.budget_id)
    const months = Array(12).fill('')
    ;(data || []).forEach(m => { months[m.month - 1] = String(m.amount) })
    setEdit({ id: r.budget_id, dim_id: r.dim_id, amount: String(r.year_budget), split: !!r.has_split, months, name: r.dim_name })
  }
  async function save() {
    const amount = Number(edit.amount)
    if (!edit.dim_id) return showToast(`Choose a ${kind === 'cost_centre' ? 'cost centre' : 'project'}`, 'red')
    if (!(amount >= 0) || edit.amount === '') return showToast('Enter the budget for the year', 'red')
    if (edit.split) {
      const sum = edit.months.reduce((s, m) => s + Number(m || 0), 0)
      if (Math.abs(sum - amount) > 0.5) return showToast(`The months add up to ${usd(sum)}, not ${usd(amount)}`, 'red')
    }
    setBusy(true)
    let id = edit.id
    const dim = kind === 'cost_centre' ? { cost_centre_id: edit.dim_id, project_id: null } : { project_id: edit.dim_id, cost_centre_id: null }
    if (id) {
      const { error } = await supabase.from('procurement_budgets').update({ amount, monthly_split: edit.split }).eq('id', id).eq('site_id', currentSiteId)
      if (error) { setBusy(false); return showToast(error.message, 'red') }
    } else {
      const { data, error } = await supabase.from('procurement_budgets').insert({ site_id: currentSiteId, fiscal_year: year, amount, monthly_split: edit.split, ...dim }).select('id').single()
      if (error) { setBusy(false); return showToast(error.message.includes('uq_proc_budget') ? 'That already has a budget for this year — edit it instead' : error.message, 'red') }
      id = data.id
    }
    // Monthly plan rows are kept; monthly_split decides whether they are used.
    if (edit.split) {
      const { error } = await supabase.from('budget_months').upsert(edit.months.map((m, i) => ({ budget_id: id, month: i + 1, amount: Number(m || 0) })), { onConflict: 'budget_id,month' })
      if (error) { setBusy(false); return showToast(error.message, 'red') }
    }
    setBusy(false); setEdit(null); showToast('Budget saved'); load()
  }
  async function archive() {
    if (!window.confirm(`Remove the ${year} budget for ${edit.name}? It is archived, not deleted.`)) return
    const { error } = await supabase.from('procurement_budgets').update({ is_archived: true }).eq('id', edit.id).eq('site_id', currentSiteId)
    if (error) return showToast(error.message, 'red')
    setEdit(null); load()
  }

  if (!canView) return <Denied />
  const dims = kind === 'cost_centre' ? centres.map(c => ({ id: c.id, label: `${c.code} ${c.name}` })) : projects.map(p => ({ id: p.id, label: `${p.project_code ? p.project_code + ' ' : ''}${p.name}` }))
  const used = new Set(shown.map(r => r.dim_id))
  const Kpi = ({ label, value, color, sub }) => (
    <div style={{ ...finCard, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 13, color: FIN.muted }}>{label}</div>
      <div style={{ fontFamily: FIN.serif, fontSize: 28, fontWeight: 600, color: color || FIN.ink }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: FIN.muted }}>{sub}</div>}
    </div>
  )
  const seg = active => ({ minHeight: 38, padding: '0 14px', border: 'none', background: active ? FIN.ink : 'none', color: active ? '#fff' : FIN.muted, fontFamily: 'inherit', fontSize: 13, borderRadius: 8, cursor: 'pointer' })
  const grid = 'minmax(0, 1.4fr) 110px 110px 110px 110px minmax(120px, 1.2fr) 110px 84px'

  return (
    <div style={{ fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px', minHeight: '100%', fontVariantNumeric: 'tabular-nums', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, color: FIN.muted }}>
            <button onClick={() => setPage('fi_dashboard')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Finance</button> · {currentSite?.name}
          </div>
          <h1 style={{ margin: '4px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 30 }}>Budgets — {MONTHS[month - 1]} {year}</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select aria-label="Month" value={month} onChange={e => setMonth(Number(e.target.value))} style={finInput}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <select aria-label="Year" value={year} onChange={e => setYear(Number(e.target.value))} style={finInput}>{[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}</select>
          <div role="group" aria-label="View by" style={{ display: 'flex', background: '#fff', border: `1px solid ${FIN.line}`, borderRadius: 10, padding: 3 }}>
            <button aria-pressed={kind === 'cost_centre'} style={seg(kind === 'cost_centre')} onClick={() => setKind('cost_centre')}>Cost centre</button>
            <button aria-pressed={kind === 'project'} style={seg(kind === 'project')} onClick={() => setKind('project')}>Project</button>
          </div>
          {canEdit && <button style={finBtn} onClick={() => openEdit(null)}>Add budget</button>}
        </div>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
        <Kpi label={`Budget for ${year}`} value={usd(t.year)} sub={`${usd(t.month)} for ${MONTHS[month - 1]}`} />
        <Kpi label="Spent so far this year" value={usd(t.ytd)} sub={`${usd(t.act)} in ${MONTHS[month - 1]} · plan to date ${usd(t.ytdB)}`} color={t.ytd > t.ytdB && t.ytdB > 0 ? FIN.ochreText : FIN.ink} />
        <Kpi label="Committed (approved POs not yet billed)" value={usd(t.com)} />
        <Kpi label="Really left to spend" value={usd(t.left)} color={t.left < 0 ? FIN.bad : FIN.good} sub="Year budget − spent − committed" />
      </section>

      <section style={{ ...finCard, padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 980 }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '12px 18px', fontSize: 12, color: FIN.muted, background: '#F7F9F8' }}>
            <span>{kind === 'cost_centre' ? 'Cost centre' : 'Project'}</span><span style={{ textAlign: 'right' }}>{MONTHS[month - 1]} plan</span><span style={{ textAlign: 'right' }}>{MONTHS[month - 1]} spent</span>
            <span style={{ textAlign: 'right' }}>Year budget</span><span style={{ textAlign: 'right' }}>Committed</span><span>Year used (spent + committed)</span><span style={{ textAlign: 'right' }}>Left</span><span style={{ textAlign: 'right' }}>Status</span>
          </div>
          {shown.length === 0 && <div style={{ padding: 20, fontSize: 13, color: FIN.muted }}>No {kind === 'cost_centre' ? 'cost centre' : 'project'} budgets for {year} yet.{canEdit ? ' Press Add budget.' : ''}</div>}
          {shown.map(r => {
            const yb = Number(r.year_budget) || 0, spent = Number(r.ytd_actual), com = Number(r.committed)
            const usedPct = yb > 0 ? (spent + com) / yb : 0
            const col = usedPct > 1 ? FIN.bad : usedPct >= 0.9 ? FIN.ochre : FIN.good
            const pill = usedPct > 1 ? 'Over' : usedPct >= 0.9 ? 'Close' : 'On track'
            const monthOver = Number(r.month_actual) > Number(r.month_budget) && Number(r.month_budget) > 0
            return (
              <div key={r.budget_id} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 18px', borderTop: `1px solid ${FIN.lineSoft}`, alignItems: 'center', fontSize: 14 }}>
                <button onClick={() => canEdit && openEdit(r)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontFamily: 'inherit', fontSize: 14, fontWeight: 600, color: FIN.ink, cursor: canEdit ? 'pointer' : 'default' }}>
                  {r.dim_name}<span style={{ display: 'block', fontSize: 11, fontWeight: 400, color: FIN.muted }}>{r.dim_code}{r.has_split ? ' · monthly plan' : ' · even months'}</span>
                </button>
                <span style={{ textAlign: 'right' }}>{usd(r.month_budget)}</span>
                <span style={{ textAlign: 'right', color: monthOver ? FIN.bad : FIN.ink, fontWeight: monthOver ? 600 : 400 }}>{usd(r.month_actual)}</span>
                <span style={{ textAlign: 'right' }}>{usd(yb)}</span>
                <span style={{ textAlign: 'right', color: FIN.muted }}>{usd(com)}</span>
                <div title={`${Math.round(usedPct * 100)}% used`} style={{ height: 10, background: FIN.lineSoft, borderRadius: 5, display: 'flex', overflow: 'hidden' }}>
                  <div style={{ width: `${yb ? Math.min(100, (spent / yb) * 100) : 0}%`, background: col }} />
                  <div style={{ width: `${yb ? Math.max(0, Math.min(100, ((spent + com) / yb) * 100) - Math.min(100, (spent / yb) * 100)) : 0}%`, background: col, opacity: 0.4 }} />
                </div>
                <span style={{ textAlign: 'right', fontWeight: 600, color: Number(r.remaining_year) < 0 ? FIN.bad : FIN.ink }}>{Number(r.remaining_year) < 0 ? '−' : ''}{usd(Math.abs(r.remaining_year))}</span>
                <span style={{ justifySelf: 'end', fontSize: 12, fontWeight: 600, color: col === FIN.ochre ? FIN.ochreText : col, border: `1px solid ${col}`, borderRadius: 12, padding: '2px 9px' }}>{pill}</span>
              </div>
            )
          })}
        </div></div>
      </section>
      <div style={{ fontSize: 12, color: FIN.faint }}>Spent = costs posted to the ledger for that {kind === 'cost_centre' ? 'cost centre' : 'project'}. Committed = approved purchase orders not yet billed. These budgets are the same ones Procurement checks orders against.</div>

      {edit && (
        <div role="dialog" aria-modal="true" aria-label="Budget" style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ ...finCard, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <h2 style={{ margin: 0, fontFamily: FIN.serif, fontSize: 22 }}>{edit.id ? `Budget — ${edit.name}` : `New ${year} budget`}</h2>
            {!edit.id && (
              <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>{kind === 'cost_centre' ? 'Cost centre' : 'Project'}</span>
                <select value={edit.dim_id} onChange={e => setEdit({ ...edit, dim_id: e.target.value })} style={{ ...finInput, width: '100%' }}>
                  <option value="">Choose…</option>{dims.filter(x => !used.has(x.id)).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select></label>
            )}
            <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>Budget for {year} (USD)</span>
              <input type="number" min="0" step="100" inputMode="decimal" value={edit.amount} onChange={e => setEdit({ ...edit, amount: e.target.value })} style={{ ...finInput, width: '100%' }} placeholder="e.g. 180000" /></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={edit.split} onChange={e => setEdit({ ...edit, split: e.target.checked, months: e.target.checked && edit.months.every(m => m === '') ? Array(12).fill(edit.amount ? String(Math.round(Number(edit.amount) / 12 * 100) / 100) : '') : edit.months })} style={{ width: 18, height: 18, accentColor: FIN.maroon }} />
              Plan it month by month (otherwise each month is one twelfth)
            </label>
            {edit.split && (<>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
                {MONTHS.map((m, i) => (
                  <label key={m}><span style={{ display: 'block', fontSize: 11, color: FIN.muted, marginBottom: 2 }}>{m}</span>
                    <input type="number" min="0" inputMode="decimal" value={edit.months[i]} onChange={e => { const ms = [...edit.months]; ms[i] = e.target.value; setEdit({ ...edit, months: ms }) }} style={{ ...finInput, width: '100%', minHeight: 36 }} /></label>
                ))}
              </div>
              <div style={{ fontSize: 12, color: Math.abs(edit.months.reduce((s, m) => s + Number(m || 0), 0) - Number(edit.amount || 0)) > 0.5 ? FIN.ochreText : FIN.good }}>
                Months add up to {usd(edit.months.reduce((s, m) => s + Number(m || 0), 0))} of {usd(edit.amount)}
              </div>
            </>)}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>{edit.id && <button style={{ ...finBtn2, color: FIN.bad, borderColor: FIN.bad }} onClick={archive}>Remove budget</button>}</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button style={finBtn2} onClick={() => setEdit(null)}>Cancel</button>
                <button style={finBtn} disabled={busy} onClick={save}>Save budget</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
