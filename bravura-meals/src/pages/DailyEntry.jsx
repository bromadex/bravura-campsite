import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { can, THEME } from '../utils/permissions'
import { Card, Button, StatCard, StatusBadge, Icon, SortTh, useSortState, showToast, today, fmtDate } from '../components/ui'

// Contractor colour pool — same as Reports
const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457','#00838F']
function coColor(contractors, id) {
  const idx = contractors.findIndex(c => c.id === id)
  return CO_COLORS[Math.max(idx, 0) % CO_COLORS.length]
}

export default function DailyEntry() {
  const { profile } = useAuth()
  const role = profile?.role

  const [date,        setDate]        = useState(today())
  const [employees,   setEmployees]   = useState([])
  const [contractors, setContractors] = useState([])
  const [entryState,  setEntryState]  = useState({})
  const [submission,  setSubmission]  = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [search,      setSearch]      = useState('')
  const [coFilter,    setCoFilter]    = useState('all')

  // Sortable columns
  const [sortState, onSort] = useSortState('name', 'asc')

  // Load employees + contractors once
  useEffect(() => {
    supabase
      .from('employees')
      .select('*, contractor:contractors(id,name,short_code)')
      .eq('status', 'Active')
      .order('name')
      .then(({ data }) => setEmployees(data || []))

    supabase
      .from('contractors')
      .select('*')
      .order('name')
      .then(({ data }) => setContractors(data || []))
  }, [])

  // Load submission + meal logs for selected date
  const loadDate = useCallback(async (d) => {
    setLoading(true)
    const [{ data: sub }, { data: logs }] = await Promise.all([
      supabase.from('daily_submissions').select('*').eq('date', d).maybeSingle(),
      supabase.from('meal_logs').select('*').eq('date', d),
    ])
    setSubmission(sub)
    const state = {}
    logs?.forEach(log => {
      state[log.employee_id] = { b: log.had_breakfast, l: log.had_lunch, s: log.had_supper }
    })
    setEntryState(state)
    setLoading(false)
  }, [])

  useEffect(() => { loadDate(date) }, [date, loadDate])

  // Editable check
  const isEditable = () => {
    if (!submission) return true
    if (submission.status === 'draft')     return can.editDraft(role)
    if (submission.status === 'submitted') return can.editSubmitted(role)
    if (submission.status === 'approved')  return can.editApproved(role)
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

  async function saveEntries() {
    if (!isEditable()) { showToast('This day is locked', 'red'); return }
    setSaving(true)
    try {
      let subId = submission?.id
      if (!subId) {
        const { data: newSub, error } = await supabase
          .from('daily_submissions')
          .insert({ date, status: 'draft', submitted_by: profile.id })
          .select().single()
        if (error) throw error
        subId = newSub.id
        setSubmission(newSub)
      }
      const upserts = employees.map(e => ({
        submission_id: subId,
        date,
        employee_id:   e.id,
        employee_name: e.name,
        had_breakfast: !!(entryState[e.id]?.b),
        had_lunch:     !!(entryState[e.id]?.l),
        had_supper:    !!(entryState[e.id]?.s),
        recorded_by:   profile.id,
        recorded_at:   new Date().toISOString(),
      }))
      const { error } = await supabase.from('meal_logs').upsert(upserts, { onConflict: 'date,employee_id' })
      if (error) throw error
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
    const { error } = await supabase
      .from('daily_submissions')
      .update({ status: 'submitted', submitted_by: profile.id, submitted_at: new Date().toISOString() })
      .eq('id', submission.id)
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

  const hStyle = { background: THEME.primary }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: 0 }}>Daily Meal Entry</h2>
          {submission && (
            <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusBadge status={submission.status} />
              {!editable && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: THEME.error, fontWeight: 500 }}>
                  <Icon name="lock" size={14} style={{ color: THEME.error }} />
                  Locked — {submission.status}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
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
          {submission?.status === 'draft' && can.submitForApproval(role) && (
            <Button onClick={submitForApproval} variant="tonal" icon="send" disabled={saving}>
              Submit for approval
            </Button>
          )}
        </div>
      </div>

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
                <tr style={{ background: THEME.primary, color: '#fff' }}>
                  {/* # */}
                  <th style={{ ...hStyle, padding: '12px 10px', width: '40px', textAlign: 'center', fontWeight: 400, fontSize: '11px', color: 'rgba(255,255,255,.5)' }}>
                    #
                  </th>
                  {/* Sortable: Employee */}
                  <SortTh label="Employee"   sortKey="name"       sortState={sortState} onSort={onSort} style={hStyle} />
                  {/* Sortable: Contractor */}
                  <SortTh label="Contractor" sortKey="contractor" sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
                  {/* Sortable: meal columns */}
                  <SortTh label="Breakfast"  sortKey="b"          sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center', background: THEME.breakfastClr }} />
                  <SortTh label="Lunch"      sortKey="l"          sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center', background: THEME.lunchClr }} />
                  <SortTh label="Supper"     sortKey="s"          sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center', background: THEME.supperClr }} />
                  <SortTh label="Total"      sortKey="total"      sortState={sortState} onSort={onSort} style={{ ...hStyle, textAlign: 'center' }} />
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((emp, i) => {
                  const m    = entryState[emp.id] || { b: false, l: false, s: false }
                  const tot  = (m.b?1:0) + (m.l?1:0) + (m.s?1:0)
                  const isAny = tot > 0
                  const color = coColor(contractors, emp.contractor_id)

                  return (
                    <tr
                      key={emp.id}
                      style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: '#fff', transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                    >
                      {/* Row number */}
                      <td style={{ padding: '10px', textAlign: 'center', color: THEME.textLow, fontSize: '11px' }}>
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
                <tr style={{ background: THEME.primary, color: '#fff', fontWeight: 600 }}>
                  <td colSpan={3} style={{ padding: '12px 14px', fontSize: '13px' }}>
                    Grand Total ({sortedFiltered.length} employees shown)
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>
                    {sortedFiltered.reduce((a,e) => a + (entryState[e.id]?.b ? 1 : 0), 0)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>
                    {sortedFiltered.reduce((a,e) => a + (entryState[e.id]?.l ? 1 : 0), 0)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '14px' }}>
                    {sortedFiltered.reduce((a,e) => a + (entryState[e.id]?.s ? 1 : 0), 0)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '16px', fontWeight: 700 }}>
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
    b: { active: THEME.breakfastClr, bg: '#FFF3E0' },
    l: { active: THEME.lunchClr,     bg: '#E8F5E9' },
    s: { active: THEME.supperClr,    bg: '#EDE7F6' },
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
        background: on ? p.bg : '#fff',
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
