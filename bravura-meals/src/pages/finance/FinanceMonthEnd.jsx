import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finBtn2, finInput, useFinanceFonts } from '../../utils/financeTheme'

// FI25 — Month-end close (Finance rewrite Phase 6, issue #49; migration 0209).
// Checklist per month → close (finance.approve). A closed month is locked in the database:
// nothing can be posted, changed or voided with a date inside it until it is reopened with a reason.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export default function FinanceMonthEnd({ setPage }) {
  useFinanceFonts()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const now = new Date()
  const [sel, setSel] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 })
  const [periods, setPeriods] = useState([])
  const [checks, setChecks] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const loadPeriods = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase.from('finance_periods').select('*').eq('site_id', currentSiteId).order('year', { ascending: false }).order('month', { ascending: false })
    setPeriods(data || [])
  }, [currentSiteId])
  const loadChecks = useCallback(async () => {
    if (!currentSiteId) return
    setChecks(null)
    const { data, error } = await supabase.rpc('fin_close_checklist', { p_site: currentSiteId, p_year: sel.y, p_month: sel.m })
    if (error) return showToast(error.message, 'red')
    setChecks(data || [])
  }, [currentSiteId, sel])
  useEffect(() => { loadPeriods() }, [loadPeriods])
  useEffect(() => { loadChecks(); setNote('') }, [loadChecks])

  if (!can('finance.view')) return <Denied />
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return { y: d.getFullYear(), m: d.getMonth() + 1 } })
  const status = (y, m) => periods.find(p => p.year === y && p.month === m)
  const cur = status(sel.y, sel.m)
  const closed = cur?.status === 'closed'
  const reqFail = (checks || []).filter(c => c.required && !c.ok).length
  const advFail = (checks || []).filter(c => !c.required && !c.ok).length

  async function close() {
    if (!window.confirm(`Close ${MONTHS[sel.m - 1]} ${sel.y}? Nothing can then be posted into it until it is reopened.`)) return
    setBusy(true)
    const { error } = await supabase.rpc('fin_close_period', { p_site: currentSiteId, p_year: sel.y, p_month: sel.m, p_note: note || null })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(`${MONTHS[sel.m - 1]} closed`); loadPeriods()
  }
  async function reopen() {
    const reason = window.prompt(`Why reopen ${MONTHS[sel.m - 1]} ${sel.y}?`)
    if (!reason) return
    setBusy(true)
    const { error } = await supabase.rpc('fin_reopen_period', { p_site: currentSiteId, p_year: sel.y, p_month: sel.m, p_reason: reason })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast('Month reopened'); loadPeriods()
  }

  return (
    <div style={{ fontFamily: FIN.sans, color: FIN.ink, background: FIN.ground, margin: -24, padding: '28px 32px', minHeight: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <div style={{ fontSize: 13, color: FIN.muted }}>
          <button onClick={() => setPage('fi_dashboard')} style={{ background: 'none', border: 'none', padding: 0, color: FIN.blue, cursor: 'pointer', font: 'inherit' }}>Finance</button> · {currentSite?.name}
        </div>
        <h1 style={{ margin: '4px 0 0', fontFamily: FIN.serif, fontWeight: 600, fontSize: 30 }}>Month-end</h1>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, alignItems: 'start' }}>
        <section style={{ ...finCard, maxWidth: 320, padding: '12px 10px' }} aria-label="Months">
          {months.map(({ y, m }) => {
            const p = status(y, m); const active = sel.y === y && sel.m === m
            return (
              <button key={`${y}-${m}`} onClick={() => setSel({ y, m })} aria-current={active ? 'true' : undefined}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', minHeight: 44, padding: '0 12px', border: 'none', borderRadius: 8,
                  background: active ? FIN.maroonTint : 'transparent', fontFamily: 'inherit', fontSize: 14, color: FIN.ink, cursor: 'pointer', fontWeight: active ? 600 : 400 }}>
                <span>{MONTHS[m - 1]} {y}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: p?.status === 'closed' ? FIN.good : FIN.muted }}>{p?.status === 'closed' ? 'Closed 🔒' : 'Open'}</span>
              </button>
            )
          })}
        </section>

        <section style={{ ...finCard, gridColumn: 'span 2', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>{MONTHS[sel.m - 1]} {sel.y}</h2>
            <span style={{ fontSize: 13, fontWeight: 600, color: closed ? FIN.good : FIN.ochreText }}>
              {closed ? `Closed ${new Date(cur.closed_at).toLocaleDateString('en-GB')}` : 'Open — journals can still be posted'}
            </span>
          </div>
          {closed && cur.close_note && <div style={{ fontSize: 13, color: FIN.muted }}>Note when closed: {cur.close_note}</div>}
          {!closed && cur?.reopen_reason && <div style={{ fontSize: 13, color: FIN.ochreText }}>Reopened: {cur.reopen_reason}</div>}

          <div>
            {checks === null ? <div style={{ color: FIN.muted }}>Checking…</div> : checks.map(c => (
              <div key={c.key} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '11px 0', borderTop: `1px solid ${FIN.lineSoft}` }}>
                <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 11, background: c.ok ? FIN.good : c.required ? FIN.bad : FIN.ochre, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.ok ? '✓' : '!'}</span>
                <span><b style={{ fontSize: 14 }}>{c.label}</b>{c.required && <span style={{ fontSize: 11, color: FIN.muted, marginLeft: 6 }}>required</span>}
                  <span style={{ display: 'block', fontSize: 12, color: FIN.muted }}>{c.detail}</span></span>
                {!c.ok && <button onClick={() => setPage(c.link)} style={{ background: 'none', border: 'none', color: FIN.blue, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 600 }}>Go there →</button>}
              </div>
            ))}
          </div>

          {!closed && can('finance.approve') && checks && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: `1px solid ${FIN.lineSoft}`, paddingTop: 14 }}>
              {reqFail > 0 && <div style={{ fontSize: 13, color: FIN.bad }}>Finish the required checks before closing.</div>}
              {reqFail === 0 && advFail > 0 && <label><span style={{ display: 'block', fontSize: 12, color: FIN.muted, marginBottom: 4 }}>{advFail} check{advFail === 1 ? ' is' : 's are'} not done — note why you are closing anyway</span>
                <input value={note} onChange={e => setNote(e.target.value)} style={{ ...finInput, width: '100%' }} placeholder="e.g. Bank statement for 30th arrives next week; reconciled in October" /></label>}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button style={finBtn} disabled={busy || reqFail > 0 || (advFail > 0 && !note.trim())} onClick={close}>Close {MONTHS[sel.m - 1]}</button>
              </div>
            </div>
          )}
          {closed && can('finance.approve') && <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={finBtn2} disabled={busy} onClick={reopen}>Reopen month</button></div>}
          {!can('finance.approve') && <div style={{ fontSize: 12, color: FIN.muted }}>Closing and reopening a month needs finance approval permission.</div>}
          <div style={{ fontSize: 12, color: FIN.faint }}>Months are closed in order. A closed month is locked: approvals dated in it (fuel, GRNs, payroll) wait in Posting Rules until the month is reopened or they are re-dated.</div>
        </section>
      </div>
    </div>
  )
}
