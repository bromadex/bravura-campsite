import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Button, showToast, PageHeader } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'

// AD12 — Ask Bravura admin (B8 guardrails, issue #58): how the assistant is used, answers that need a look
// (errors, 👎, figures it couldn't trace, "couldn't answer"), every action proposed and confirmed, usage caps
// per site, and the register of AI features with their risk notes and human sign-off.
const ACCENT = '#982329'
const WHEN = { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
const when = t => t ? new Date(t).toLocaleString('en-GB', WHEN) : '—'
const TABS = [['overview', 'Usage'], ['review', 'Needs a look'], ['actions', 'Actions'], ['limits', 'Limits'], ['register', 'AI register']]

// The register (EU AI Act-style inventory): what each feature does, what could go wrong, and the human control.
const REGISTER = [
  { f: 'Answers about records (B1–B2)', does: 'Reads records through read-only functions that run as the person asking; every figure must come from a tool or the calculate tool.', risk: 'Wrong or made-up figures; showing data the person should not see.', control: 'Tools only, permissions and sites enforced in the database; figure check flags untraced numbers; 👍/👎 and review list below.', level: 'Limited' },
  { f: 'Reading the screen (B1)', does: 'Uses what is visible on the current screen to explain it.', risk: 'Misreading a table.', control: '"Using this screen" can be switched off per question; answers name the records they used.', level: 'Minimal' },
  { f: 'Reading attached files (B3)', does: 'Reads invoices, delivery notes, quotes and receipts (OCR / AI) and matches them to suppliers and POs.', risk: 'Misread numbers on poor photos.', control: 'Nothing is saved from reading alone; OCR answers say so; duplicate-bill and price checks.', level: 'Limited' },
  { f: 'Actions with confirmation (B4)', does: 'Proposes receiving a delivery, a draft bill, a petty cash spend or a draft request.', risk: 'A wrong record created.', control: 'A person must press Confirm; runs the same functions as the screens (approvals, locks, holds, budgets still apply); proposals expire after 2 hours; logged in Actions.', level: 'Limited — human sign-off' },
  { f: 'Documents on records (B5)', does: 'Keeps the attached file on the record it created.', risk: 'Wrong file on a record.', control: 'Only after Confirm; files can be removed from a record (kept in DocShare).', level: 'Minimal' },
  { f: 'Daily brief, alerts, report commentary (B6)', does: 'Summarises what needs attention; flags unusual fuel draws, price jumps, duplicate or mismatched bills; writes a short note on report emails.', risk: 'Missed or false alerts; a misleading summary.', control: 'Alerts are rules in the database (not AI); commentary may only quote figures in the report; the full report is always below it.', level: 'Minimal' },
  { f: 'Voice notes (B7)', does: 'Turns speech into text (Whisper on Groq).', risk: 'Misheard words or numbers.', control: 'The text goes into the question box for the person to check before sending.', level: 'Minimal' },
]

export default function AskBravuraAdmin({ setPage }) {
  const { can } = usePermissions()
  const [days, setDays] = useState(30)
  const [d, setD] = useState(null)
  const [tab, setTab] = useState('overview')
  const [err, setErr] = useState(null)
  const load = useCallback(() => {
    setD(null); setErr(null)
    supabase.rpc('ai_admin_overview', { p_days: days }).then(({ data, error }) => { if (error) setErr(error.message); else setD(data) })
  }, [days])
  useEffect(() => { load() }, [load])
  if (!can('users.view')) return <div style={{ padding: 48, textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  const t = d?.totals || {}

  return (
    <div>
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_ask" />
      <PageHeader title="Ask Bravura admin" actions={
        <select value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period"
          style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }}>
          {[7, 30, 90, 365].map(n => <option key={n} value={n}>Last {n} days</option>)}
        </select>} />
      {err && <Card style={{ padding: 14, color: '#C62828', marginBottom: 12 }}>{err}</Card>}

      <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            style={{ padding: '7px 14px', borderRadius: 16, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer', fontWeight: 600,
              border: tab === k ? 'none' : `1px solid ${THEME.outlineVar}`, background: tab === k ? ACCENT : THEME.surface, color: tab === k ? '#fff' : THEME.textMed }}>
            {l}{k === 'review' && d?.needs_review?.length ? ` (${d.needs_review.length})` : ''}
          </button>
        ))}
      </div>

      {!d && !err && <Card style={{ padding: 24, color: THEME.textLow }}>Loading…</Card>}

      {d && tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
            {[['Questions', t.questions], ['People', t.people], ['👍 Helpful', t.helpful], ['👎 Not helpful', t.not_helpful, t.not_helpful > 0],
              ['Figures not traced', t.unchecked_figures, t.unchecked_figures > 0], ['Errors', t.errors, t.errors > 0], ['With files', t.with_files], ['Voice notes', t.voice],
              ['AI tokens used', Number(t.tokens || 0).toLocaleString()]].map(([l, v, warn]) => (
              <Card key={l} style={{ padding: '12px 14px' }}>
                <div style={{ fontSize: 12, color: THEME.textLow }}>{l}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: warn ? '#B26A00' : THEME.text, fontVariantNumeric: 'tabular-nums' }}>{v ?? 0}</div>
              </Card>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <ListCard title="By person" rows={(d.by_person || []).map(x => [x.person, `${x.questions} · last ${when(x.last)}`])} />
            <ListCard title="By site" rows={(d.by_site || []).map(x => [x.site, x.questions])} />
            <ListCard title="What it looked up" rows={(d.tools || []).map(x => [x.tool.replace(/_/g, ' '), x.uses])} />
          </div>
        </>
      )}

      {d && tab === 'review' && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          {!(d.needs_review || []).length ? <div style={{ padding: 20, color: THEME.textLow }}>Nothing needs a look in this period.</div> : d.needs_review.map((r, i) => (
            <div key={i} style={{ padding: '12px 16px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12, color: THEME.textLow }}>
                <span>{r.person} · {when(r.at)}</span><span style={{ color: '#B26A00', fontWeight: 600 }}>{r.why}</span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: THEME.text, margin: '4px 0' }}>{r.question}</div>
              <div style={{ fontSize: 12.5, color: THEME.textMed, whiteSpace: 'pre-wrap' }}>{r.answer}</div>
            </div>
          ))}
        </Card>
      )}

      {d && tab === 'actions' && (
        <Card style={{ padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '10px 16px', fontSize: 12.5, color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}` }}>
            {Object.entries(d.action_totals || {}).map(([k, v]) => `${v} ${k}`).join(' · ') || 'No actions yet.'}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: THEME.textLow }}>{['When', 'Person', 'What', 'Status', 'Done'].map(h => <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{(d.actions || []).map((a, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${THEME.outlineVar}` }}>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{when(a.at)}</td>
                <td style={{ padding: '8px 12px' }}>{a.person}</td>
                <td style={{ padding: '8px 12px' }}>{a.summary}{a.error && <div style={{ color: '#C62828' }}>{a.error}</div>}</td>
                <td style={{ padding: '8px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 10, fontWeight: 600, fontSize: 11.5,
                  background: a.status === 'done' ? '#E8F5E9' : a.status === 'failed' ? '#FFEBEE' : THEME.surfaceVar, color: a.status === 'done' ? '#2E7D32' : a.status === 'failed' ? '#C62828' : THEME.textMed }}>{a.status}</span></td>
                <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{when(a.done_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}

      {d && tab === 'limits' && (
        <Card style={{ padding: 16 }}>
          <div style={{ fontSize: 12.5, color: THEME.textMed, marginBottom: 12 }}>
            Questions per person and per site in any 24 hours. When a limit is reached Ask Bravura says so and stops answering until the next day. Switching a site off hides answers for that site.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(d.settings || []).map(s => <LimitRow key={s.site_id} s={s} onSaved={load} />)}
          </div>
        </Card>
      )}

      {tab === 'register' && (
        <Card style={{ padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '12px 16px', fontSize: 12.5, color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}` }}>
            Register of AI features (provider: Groq; models: Qwen / GPT-OSS for answers, Whisper for voice). Nothing is changed without a person confirming, and every question, answer, tool call and action is logged.
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead><tr style={{ textAlign: 'left', color: THEME.textLow }}>{['Feature', 'What it does', 'What could go wrong', 'Human control', 'Risk'].map(h => <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
            <tbody>{REGISTER.map(r => (
              <tr key={r.f} style={{ borderTop: `1px solid ${THEME.outlineVar}`, verticalAlign: 'top' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600, color: THEME.text }}>{r.f}</td>
                <td style={{ padding: '8px 12px' }}>{r.does}</td><td style={{ padding: '8px 12px' }}>{r.risk}</td>
                <td style={{ padding: '8px 12px' }}>{r.control}</td><td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{r.level}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function ListCard({ title, rows }) {
  return (
    <Card style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: THEME.text, marginBottom: 8 }}>{title}</div>
      {!rows.length ? <div style={{ fontSize: 12.5, color: THEME.textLow }}>Nothing yet.</div> : rows.map(([a, b], i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '4px 0', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none' }}>
          <span style={{ color: THEME.text }}>{a}</span><span style={{ color: THEME.textMed, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{b}</span>
        </div>
      ))}
    </Card>
  )
}

function LimitRow({ s, onSaved }) {
  const [f, setF] = useState({ enabled: s.enabled, per_user: s.daily_per_user, per_site: s.daily_per_site })
  const [busy, setBusy] = useState(false)
  const inp = { width: 90, padding: '6px 8px', borderRadius: 8, border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }
  async function save() {
    setBusy(true)
    const { error } = await supabase.rpc('ai_settings_save', { p_site: s.site_id, p_enabled: f.enabled, p_per_user: Number(f.per_user), p_per_site: Number(f.per_site) })
    setBusy(false)
    if (error) return showToast(error.message, 'red')
    showToast(`Saved for ${s.site}`, 'green'); onSaved()
  }
  const id = k => `ask-${k}-${s.site_id}`
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderTop: `1px solid ${THEME.outlineVar}` }}>
      <div style={{ minWidth: 120, fontWeight: 600, color: THEME.text }}>{s.site}</div>
      <label htmlFor={id('on')} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
        <input id={id('on')} type="checkbox" disabled={!s.can_edit} checked={f.enabled} onChange={e => setF({ ...f, enabled: e.target.checked })} /> On</label>
      <label htmlFor={id('u')} style={{ fontSize: 13, color: THEME.textMed }}>Per person / day <input id={id('u')} type="number" min="0" max="1000" disabled={!s.can_edit} value={f.per_user} onChange={e => setF({ ...f, per_user: e.target.value })} style={inp} /></label>
      <label htmlFor={id('s')} style={{ fontSize: 13, color: THEME.textMed }}>Whole site / day <input id={id('s')} type="number" min="0" max="20000" disabled={!s.can_edit} value={f.per_site} onChange={e => setF({ ...f, per_site: e.target.value })} style={inp} /></label>
      {s.can_edit && <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>}
    </div>
  )
}
