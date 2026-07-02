import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { THEME } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, StatCard, StatusBadge, Icon, SortTh, useSortState, showToast, today, fmtDate, PageHeader } from '../../components/ui'

// Contractor colour pool — same as Reports
const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457','#00838F']
function coColor(contractors, id) {
  const idx = contractors.findIndex(c => c.id === id)
  return CO_COLORS[Math.max(idx, 0) % CO_COLORS.length]
}

export default function DailyEntry() {
  const { profile } = useAuth()
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()

  const [date,        setDate]        = useState(today())
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [entryState,  setEntryState]  = useState({})
  const [submission,  setSubmission]  = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [search,      setSearch]      = useState('')
  const [coFilter,    setCoFilter]    = useState('all')
  const [ineligible,  setIneligible]  = useState({})    // { on_leave: n, terminated: m, ... }
  const [focusIdx,    setFocusIdx]    = useState(0)     // keyboard row cursor
  const [showKbHelp,  setShowKbHelp]  = useState(false)

  // Sortable columns
  const [sortState, onSort] = useSortState('name', 'asc')

  // Load employees + contractors, re-fetched whenever the selected site
  // changes — same filtering pattern already used on the Employees page.
  useEffect(() => {
    if (!currentSiteId) return
    supabase
      .from('employees')
      .select('*, contractor:contractors(id,name,short_code)')
      .eq('status', 'active')
      .eq('site_id', currentSiteId)
      .order('name')
      .then(({ data }) => setEmployees(data || []))

    // HR link — count non-active employees at this site so meal officer knows
    // what's hidden. Uses head:true count query for speed.
    supabase
      .from('employees')
      .select('status', { count: 'exact', head: false })
      .eq('site_id', currentSiteId)
      .neq('status', 'active')
      .then(({ data }) => {
        const buckets = {}
        for (const r of (data || [])) buckets[r.status] = (buckets[r.status] || 0) + 1
        setIneligible(buckets)
      })

    supabase
      .from('contractors')
      .select('*')
      .order('name')
      .then(({ data }) => setContractors(data || []))
  }, [currentSiteId])

  // Load submission + meal logs for selected date AND site. A given date
  // can now have one daily_submissions row PER SITE, not one globally —
  // filtering by site_id is what keeps Kamativi's Tuesday separate from
  // Selous's Tuesday. meal_logs has no site_id of its own (it inherits
  // through employee_id), so it's scoped to the already site-filtered
  // employee list — guarded the same way as everywhere else in this
  // project: skip the query entirely rather than risk an empty .in() list
  // behaving ambiguously.
  const loadDate = useCallback(async (d) => {
    setLoading(true)
    const employeeIds = employees.map(e => e.id)
    const [{ data: sub }, logsRes] = await Promise.all([
      supabase.from('daily_submissions')
        .select(`
          *,
          submitted_by_profile:profiles!daily_submissions_submitted_by_fkey(full_name, username),
          approved_by_profile:profiles!daily_submissions_approved_by_fkey(full_name, username)
        `)
        .eq('date', d).eq('site_id', currentSiteId).maybeSingle(),
      employeeIds.length > 0
        ? supabase.from('meal_logs').select('*').eq('date', d).in('employee_id', employeeIds)
        : Promise.resolve({ data: [] }),
    ])

    // Resolve the reviewer who returned it, if any, so the audit trail
    // can show their name rather than a raw UUID.
    let returnedBy = null
    if (sub?.previous_counts?.actor) {
      const { data } = await supabase.from('profiles')
        .select('full_name, username')
        .eq('id', sub.previous_counts.actor)
        .maybeSingle()
      returnedBy = data
    }
    setSubmission(sub ? { ...sub, returned_by_profile: returnedBy } : sub)

    const state = {}
    logsRes.data?.forEach(log => {
      state[log.employee_id] = { b: log.had_breakfast, l: log.had_lunch, s: log.had_supper }
    })
    setEntryState(state)
    setLoading(false)
  }, [currentSiteId, employees])

  useEffect(() => { loadDate(date) }, [date, loadDate])

  // Editable check
  // meals.edit: matches the old editDraft list (System Admin + Meal Officer)
  // meals.approve: matches old editSubmitted — narrower for Camp Supervisor
  //   under the approved matrix, same tighten-now pattern used throughout
  //   this swap
  // meals.delete: proxy for "most trusted tier" — matches old editApproved
  //   (super_admin only), since only System/Group Admin hold Delete on Meals
  const isEditable = () => {
    if (!submission) return true
    if (submission.status === 'draft')     return can('meals.edit')
    if (submission.status === 'submitted') return can('meals.approve')
    if (submission.status === 'approved')  return can('meals.delete')
    return false
  }

  function toggleMeal(empId, meal) {
    if (!isEditable()) return
    setEntryState(prev => ({
      ...prev,
      [empId]: { b: false, l: false, s: false, ...(prev[empId] || {}), [meal]: !(prev[empId]?.[meal] || false) },
    }))
  }

  function toggleAllMeal(meal) {
    const visible = sortedFiltered
    const allOn = visible.every(e => entryState[e.id]?.[meal])
    setEntryState(prev => {
      const next = { ...prev }
      visible.forEach(e => {
        next[e.id] = { b: false, l: false, s: false, ...(prev[e.id] || {}), [meal]: !allOn }
      })
      return next
    })
  }

  // Filter + sort
  const sortedFiltered = useMemo(() => {
    const filtered = employees.filter(e => {
      const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase())
      const matchCo     = coFilter === 'all' || e.contractor_id === coFilter
      return matchSearch && matchCo
    })
    // sorting
    return [...filtered].sort((a, b) => {
      let av, bv
      if (sortState.key === 'name') {
        av = a.name; bv = b.name
        return sortState.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      if (sortState.key === 'contractor') {
        av = a.contractor?.name || ''; bv = b.contractor?.name || ''
        return sortState.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      }
      // numeric meal cols
      const ea = entryState[a.id] || {}
      const eb = entryState[b.id] || {}
      if (sortState.key === 'b') { av = ea.b?1:0; bv = eb.b?1:0 }
      if (sortState.key === 'l') { av = ea.l?1:0; bv = eb.l?1:0 }
      if (sortState.key === 's') { av = ea.s?1:0; bv = eb.s?1:0 }
      if (sortState.key === 'total') {
        av = (ea.b?1:0)+(ea.l?1:0)+(ea.s?1:0)
        bv = (eb.b?1:0)+(eb.l?1:0)+(eb.s?1:0)
      }
      return sortState.dir === 'asc' ? av - bv : bv - av
    })
  }, [employees, search, coFilter, sortState, entryState])

  // ── Keyboard-first data entry ───────────────────────────────────────────
  // ↑/↓ move the row cursor. B/L/S toggle that meal on the focused row.
  // Space toggles all three. Cmd/Ctrl+S saves, Cmd/Ctrl+Enter submits.
  // Shift+? opens the help overlay.
  useEffect(() => {
    function onKey(ev) {
      // Ignore when typing in a text input
      const t = ev.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return

      const visible = sortedFiltered
      const max = visible.length - 1

      if (ev.key === 'ArrowDown') { ev.preventDefault(); setFocusIdx(i => Math.min(max, i + 1)); return }
      if (ev.key === 'ArrowUp')   { ev.preventDefault(); setFocusIdx(i => Math.max(0,   i - 1)); return }
      if (ev.key === 'Home')      { ev.preventDefault(); setFocusIdx(0); return }
      if (ev.key === 'End')       { ev.preventDefault(); setFocusIdx(max); return }
      if (ev.key === '?')         { setShowKbHelp(v => !v); return }

      const emp = visible[focusIdx]
      if (!emp) return

      const k = ev.key.toLowerCase()
      if (k === 'b') { ev.preventDefault(); toggleMeal(emp.id, 'b'); return }
      if (k === 'l') { ev.preventDefault(); toggleMeal(emp.id, 'l'); return }
      if (k === 's' && !(ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); toggleMeal(emp.id, 's'); return }
      if (ev.key === ' ') {
        ev.preventDefault()
        const cur = entryState[emp.id] || {}
        const allOn = cur.b && cur.l && cur.s
        setEntryState(prev => ({ ...prev, [emp.id]: { b: !allOn, l: !allOn, s: !allOn } }))
        return
      }
      if ((ev.metaKey || ev.ctrlKey) && k === 's') { ev.preventDefault(); saveEntries(); return }
      if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); submitForApproval(); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdx, sortedFiltered, entryState])

  // Keep focusIdx in range if the filtered list shrinks
  useEffect(() => {
    if (focusIdx > sortedFiltered.length - 1) setFocusIdx(Math.max(0, sortedFiltered.length - 1))
  }, [sortedFiltered.length, focusIdx])

  async function saveEntries() {
    if (!isEditable()) { showToast('This day is locked', 'red'); return }
    setSaving(true)
    try {
      // Both writes go through SECURITY DEFINER RPCs so RLS on
      // daily_submissions / meal_logs can't silently reject a Meals
      // Officer's INSERT (the "new row violates row-level security"
      // toast). The RPCs verify meals.create for the site themselves.
      let subId = submission?.id
      if (!subId) {
        const { data: newId, error: ensureErr } = await supabase.rpc('ensure_meal_submission_draft', {
          p_date:    date,
          p_site_id: currentSiteId,
        })
        if (ensureErr) throw ensureErr
        subId = newId
      }
      const payload = employees.map(e => ({
        employee_id:   e.id,
        employee_name: e.name,
        had_breakfast: !!(entryState[e.id]?.b),
        had_lunch:     !!(entryState[e.id]?.l),
        had_supper:    !!(entryState[e.id]?.s),
      }))
      const { error: logsErr } = await supabase.rpc('save_meal_logs', {
        p_submission_id: subId,
        p_date:          date,
        p_logs:          payload,
      })
      if (logsErr) throw logsErr
      showToast('Entries saved', 'green')
      loadDate(date)
    } catch (err) {
      showToast('Error: ' + err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function submitForApproval() {
    if (!submission?.id) { showToast('Save entries first', 'red'); return }
    setSaving(true)
    // SECURITY DEFINER RPC — verifies meals.create on site and flips
    // status to submitted with auth.uid() as submitted_by, so RLS on
    // daily_submissions can't silently reject the change.
    const { error } = await supabase.rpc('submit_meal_submission', {
      p_submission_id: submission.id,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Submitted for approval', 'green')
    loadDate(date)
  }

  // Running totals (all employees, not just visible)
  const totals = { b: 0, l: 0, s: 0 }
  employees.forEach(e => {
    const m = entryState[e.id] || {}
    if (m.b) totals.b++
    if (m.l) totals.l++
    if (m.s) totals.s++
  })

  const editable = isEditable()

  // Unique contractors that have at least one active employee
  const activeCos = contractors.filter(c => employees.some(e => e.contractor_id === c.id))

  // Fiori-style light header — neutral surface bg + dark labels.
  const hStyle       = { background: THEME.surfaceVar, color: THEME.textMed, borderBottom: `1px solid ${THEME.outlineVar}` }
  const hStyleTintB  = { ...hStyle, background: THEME.breakfastClr + '18' }
  const hStyleTintL  = { ...hStyle, background: THEME.lunchClr     + '18' }
  const hStyleTintS  = { ...hStyle, background: THEME.supperClr    + '18' }

  return (
    <div>
      {/* ── Header ── */}
      <PageHeader
        title="Daily Meal Entry"
        site={currentSite}
        actions={<>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{
              padding: '9px 14px', border: `1px solid ${THEME.outline}`,
              borderRadius: '12px', fontSize: '13px', fontFamily: 'inherit',
              color: THEME.text, outline: 'none',
            }}
          />
          {editable && (
            <Button onClick={saveEntries} variant="filled" icon="save" disabled={saving}>
              {saving ? 'Saving…' : 'Save entries'}
            </Button>
          )}
          {submission?.status === 'draft' && can('meals.edit') && (
            <Button onClick={submitForApproval} variant="tonal" icon="send" disabled={saving}>
              Submit for approval
            </Button>
          )}
        </>}
      >
        {submission && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <StatusBadge status={submission.status} />
            {!editable && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: THEME.error, fontWeight: 500 }}>
                <Icon name="lock" size={14} style={{ color: THEME.error }} />
                Locked — {submission.status}
              </div>
            )}
          </div>
        )}
      </PageHeader>

      {/* ── Audit trail: submitted / returned / approved by whom, when ── */}
      {submission && (submission.submitted_at || submission.approved_at || submission.previous_counts) && (() => {
        const fmtWhen = ts => ts ? new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
        const nameOf  = p => p?.full_name || p?.username || '—'
        const rows = []
        if (submission.submitted_at || submission.submitted_by_profile) {
          rows.push({ icon: 'upload', color: THEME.info, label: 'Submitted', who: nameOf(submission.submitted_by_profile), when: submission.submitted_at })
        }
        if (submission.previous_counts) {
          rows.push({
            icon: 'undo', color: THEME.warning, label: 'Returned',
            who: nameOf(submission.returned_by_profile),
            when: submission.previous_counts.at,
            note: submission.previous_counts.note,
          })
        }
        if (submission.approved_at || submission.approved_by_profile) {
          rows.push({ icon: 'check_circle', color: THEME.success, label: 'Approved', who: nameOf(submission.approved_by_profile), when: submission.approved_at })
        }
        if (rows.length === 0) return null
        return (
          <div style={{
            marginBottom: '14px', padding: '10px 14px',
            background: THEME.surfaceVar, border: `1px solid ${THEME.outlineVar}`,
            borderRadius: '10px',
          }}>
            <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '8px' }}>
              Audit trail
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px' }}>
              {rows.map((r, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <div style={{ width: 26, height: 26, borderRadius: '8px', background: r.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon name={r.icon} size={14} style={{ color: r.color }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: '12px' }}>
                    <div>
                      <span style={{ fontWeight: 600, color: THEME.text }}>{r.label}</span>{' '}
                      <span style={{ color: THEME.textMed }}>by </span>
                      <span style={{ fontWeight: 500, color: THEME.text }}>{r.who}</span>
                    </div>
                    <div style={{ color: THEME.textLow, fontSize: '11px' }}>{fmtWhen(r.when)}</div>
                    {r.note && (
                      <div style={{ marginTop: '4px', padding: '5px 8px', background: THEME.surface, borderRadius: '6px', border: `1px solid ${THEME.outlineVar}`, color: THEME.textMed, fontStyle: 'italic' }}>
                        "{r.note}"
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── Keyboard shortcuts hint ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '10px' }}>
        <button
          onClick={() => setShowKbHelp(v => !v)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '5px 10px', borderRadius: '6px',
            border: `1px solid ${THEME.outlineVar}`,
            background: THEME.surface, color: THEME.textMed,
            fontSize: '11px', fontFamily: 'inherit', cursor: 'pointer',
          }}
          title="Keyboard shortcuts"
        >
          <Icon name="keyboard" size={13} />
          Keyboard <b style={{ color: THEME.text }}>?</b>
        </button>
      </div>
      {showKbHelp && (
        <div style={{
          padding: '14px 16px', marginBottom: '14px',
          background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '10px',
          fontSize: '12px', color: THEME.textMed, boxShadow: '0 1px 2px rgba(0,0,0,.03)',
        }}>
          <div style={{ fontWeight: 600, color: THEME.text, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: '11px' }}>Keyboard shortcuts</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px 20px' }}>
            {[
              ['↑ / ↓',    'Move cursor between rows'],
              ['Home / End','Jump to first / last row'],
              ['B / L / S', 'Toggle Breakfast / Lunch / Supper on the focused row'],
              ['Space',     'Toggle all three meals for the focused row'],
              ['Ctrl + S',  'Save entries'],
              ['Ctrl + ↵',  'Submit for approval'],
              ['?',         'Show / hide this panel'],
            ].map(([k, d]) => (
              <div key={k} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span style={{ background: THEME.surfaceVar, padding: '2px 8px', borderRadius: '4px', border: `1px solid ${THEME.outlineVar}`, fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: THEME.text, minWidth: '90px', textAlign: 'center' }}>{k}</span>
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── HR eligibility banner — non-active staff are excluded from entry ── */}
      {Object.keys(ineligible).length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '9px 14px', marginBottom: '14px',
          borderRadius: '8px',
          background: THEME.statusInfoBg,
          border: `1px solid ${THEME.info}22`,
          fontSize: '12px', color: THEME.statusInfoText,
        }}>
          <Icon name="badge" size={14} style={{ color: THEME.info, flexShrink: 0 }} />
          <span>Only <b>active</b> HR employees appear here.</span>
          {Object.entries(ineligible).map(([status, n]) => (
            <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '1px 7px', background: THEME.surface, borderRadius: '4px', color: THEME.textMed, fontWeight: 600 }}>
              {n} {status.replace(/_/g, ' ')}
            </span>
          ))}
          <span style={{ color: THEME.textLow }}>hidden</span>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Breakfasts"  value={totals.b}                     color={THEME.breakfastClr} icon="wb_sunny" />
        <StatCard label="Lunches"     value={totals.l}                     color={THEME.lunchClr}     icon="light_mode" />
        <StatCard label="Suppers"     value={totals.s}                     color={THEME.supperClr}    icon="bedtime" />
        <StatCard label="Total meals" value={totals.b + totals.l + totals.s} color={THEME.primary}   icon="groups" />
      </div>

      {/* ── Filter bar ── */}
      <Card style={{ marginBottom: '16px', padding: '14px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: '200px', maxWidth: '300px' }}>
            <Icon name="search" size={18} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
            <input
              type="text"
              placeholder="Search employee…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', padding: '8px 12px 8px 34px',
                border: `1px solid ${THEME.outline}`, borderRadius: '12px',
                fontSize: '13px', fontFamily: 'inherit', outline: 'none',
                color: THEME.text, boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Contractor filter chips */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setCoFilter('all')}
              style={{
                padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                cursor: 'pointer', border: `1px solid ${coFilter === 'all' ? THEME.primary : THEME.outline}`,
                fontFamily: 'inherit',
                background: coFilter === 'all' ? THEME.surfaceVar : 'transparent',
                color: coFilter === 'all' ? THEME.primary : THEME.textMed,
              }}
            >
              All contractors
            </button>
            {activeCos.map((c, i) => {
              const color = CO_COLORS[i % CO_COLORS.length]
              const isActive = coFilter === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setCoFilter(c.id)}
                  style={{
                    padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                    cursor: 'pointer', border: `1px solid ${isActive ? color : THEME.outline}`,
                    fontFamily: 'inherit',
                    background: isActive ? color + '18' : 'transparent',
                    color: isActive ? color : THEME.textMed,
                  }}
                >
                  {c.short_code || c.name}
                </button>
              )
            })}
          </div>

          {/* Toggle all buttons — only when editable */}
          {editable && (
            <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', flexWrap: 'wrap' }}>
              {[
                { meal: 'b', label: 'All Breakfast', color: THEME.breakfastClr },
                { meal: 'l', label: 'All Lunch',     color: THEME.lunchClr },
                { meal: 's', label: 'All Supper',    color: THEME.supperClr },
              ].map(({ meal, label, color }) => (
                <button
                  key={meal}
                  onClick={() => toggleAllMeal(meal)}
                  style={{
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
                    cursor: 'pointer', border: `1px solid ${color}`,
                    fontFamily: 'inherit', background: color + '14', color,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ── */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '48px', color: THEME.textLow }}>
          <Icon name="progress_activity" size={22} style={{ color: THEME.primary }} />
          Loading…
        </div>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr>
                  <th style={{ ...hStyle, padding: '10px 10px', width: '40px', textAlign: 'center', fontWeight: 600, fontSize: '11px', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                    #
                  </th>
                  <SortTh label="Employee"   sortKey="name"       sortState={sortState} onSort={onSort} style={hStyle} />
                  <SortTh label="Contractor" sortKey="contractor" sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
                  <SortTh label="Breakfast"  sortKey="b"          sortState={sortState} onSort={onSort} style={{ ...hStyleTintB, textAlign: 'center' }} />
                  <SortTh label="Lunch"      sortKey="l"          sortState={sortState} onSort={onSort} style={{ ...hStyleTintL, textAlign: 'center' }} />
                  <SortTh label="Supper"     sortKey="s"          sortState={sortState} onSort={onSort} style={{ ...hStyleTintS, textAlign: 'center' }} />
                  <SortTh label="Total"      sortKey="total"      sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
                      <Icon name="badge" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
                      {employees.length === 0
                        ? `No active employees recorded at ${currentSite?.name || 'this site'} yet`
                        : 'No employees match your filter'}
                    </td>
                  </tr>
                ) : sortedFiltered.map((emp, i) => {
                  const m    = entryState[emp.id] || { b: false, l: false, s: false }
                  const tot  = (m.b?1:0) + (m.l?1:0) + (m.s?1:0)
                  const isAny = tot > 0
                  const color = coColor(contractors, emp.contractor_id)
                  const isFocused = i === focusIdx

                  return (
                    <tr
                      key={emp.id}
                      onClick={() => setFocusIdx(i)}
                      style={{
                        borderBottom: `1px solid ${THEME.outlineVar}`,
                        background: isFocused ? THEME.primary + '0E' : THEME.surface,
                        boxShadow: isFocused ? `inset 3px 0 0 ${THEME.primary}` : 'none',
                        transition: 'background .1s, box-shadow .1s',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={e => { if (!isFocused) e.currentTarget.style.background = THEME.surfaceVar }}
                      onMouseLeave={e => { if (!isFocused) e.currentTarget.style.background = THEME.surface }}
                    >
                      {/* Row number */}
                      <td style={{ padding: '10px', textAlign: 'center', color: isFocused ? THEME.primary : THEME.textLow, fontSize: '11px', fontWeight: isFocused ? 700 : 400 }}>
                        {i + 1}
                      </td>

                      {/* Employee name */}
                      <td style={{ padding: '10px 14px', fontWeight: isAny ? 500 : 400, color: isAny ? THEME.text : THEME.textMed }}>
                        {emp.name}
                      </td>

                      {/* Contractor chip */}
                      <td style={{ padding: '10px', textAlign: 'center' }}>
                        {emp.contractor ? (
                          <span style={{
                            background: color + '18', color,
                            padding: '3px 10px', borderRadius: '8px',
                            fontSize: '11px', fontWeight: 500, whiteSpace: 'nowrap',
                          }}>
                            {emp.contractor.short_code || emp.contractor.name}
                          </span>
                        ) : (
                          <span style={{ color: THEME.textLow }}>—</span>
                        )}
                      </td>

                      {/* Meal tick cells */}
                      {['b','l','s'].map(meal => (
                        <td key={meal} style={{ padding: '8px', textAlign: 'center' }}>
                          <MealTick
                            on={!!m[meal]}
                            meal={meal}
                            editable={editable}
                            onClick={() => toggleMeal(emp.id, meal)}
                          />
                        </td>
                      ))}

                      {/* Total */}
                      <td style={{ padding: '10px', textAlign: 'center', fontWeight: 700, color: isAny ? THEME.primary : THEME.textLow }}>
                        {tot || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>

              {/* Grand total footer */}
              <tfoot>
                <tr style={{ background: THEME.surfaceVar, color: THEME.text, fontWeight: 600, borderTop: `2px solid ${THEME.outlineVar}` }}>
                  <td colSpan={3} style={{ padding: '12px 14px', fontSize: '13px' }}>
                    Grand Total ({sortedFiltered.length} employees shown)
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: THEME.breakfastClr }}>
                    {sortedFiltered.reduce((a,e) => a + (entryState[e.id]?.b ? 1 : 0), 0)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: THEME.lunchClr }}>
                    {sortedFiltered.reduce((a,e) => a + (entryState[e.id]?.l ? 1 : 0), 0)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px', color: THEME.supperClr }}>
                    {sortedFiltered.reduce((a,e) => a + (entryState[e.id]?.s ? 1 : 0), 0)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '16px', fontWeight: 700, color: THEME.primary }}>
                    {sortedFiltered.reduce((a,e) => {
                      const m = entryState[e.id] || {}
                      return a + (m.b?1:0) + (m.l?1:0) + (m.s?1:0)
                    }, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Meal tick — MD3 style checkbox ────────────────────────────────────────────
function MealTick({ on, meal, editable, onClick }) {
  const palette = {
    b: { active: THEME.breakfastClr, bg: THEME.statusWarningBg },
    l: { active: THEME.lunchClr,     bg: THEME.statusSuccessBg },
    s: { active: THEME.supperClr,    bg: THEME.statusTertiaryBg },
  }
  const p = palette[meal]

  return (
    <div
      onClick={editable ? onClick : undefined}
      title={editable ? (on ? 'Click to remove' : 'Click to mark') : ''}
      style={{
        width: '40px', height: '40px',
        cursor: editable ? 'pointer' : 'default',
        borderRadius: '10px',
        border: `2px solid ${on ? p.active : THEME.outline}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? p.bg : THEME.surface,
        margin: '0 auto',
        transition: 'all .15s cubic-bezier(.4,0,.2,1)',
        boxShadow: on ? `0 2px 8px ${p.active}33` : 'none',
      }}
    >
      {on && (
        <span
          className="material-symbols-rounded filled"
          style={{ fontSize: '20px', color: p.active }}
        >
          check_circle
        </span>
      )}
      {!on && editable && (
        <span
          className="material-symbols-rounded"
          style={{ fontSize: '20px', color: THEME.outlineVar }}
        >
          radio_button_unchecked
        </span>
      )}
    </div>
  )
}
