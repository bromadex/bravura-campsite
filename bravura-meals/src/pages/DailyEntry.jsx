import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../auth/AuthContext'
import { can } from '../utils/permissions'
import { Card, Button, StatCard, StatusBadge, showToast, today, fmtDate } from '../components/ui'

export default function DailyEntry() {
  const { profile } = useAuth()
  const role = profile?.role
  const [date, setDate] = useState(today())
  const [employees, setEmployees] = useState([])
  const [entryState, setEntryState] = useState({})   // { empId: { b, l, s } }
  const [submission, setSubmission] = useState(null) // daily_submissions row
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [groupFilter, setGroupFilter] = useState('all')

  // Load employees once
  useEffect(() => {
    supabase
      .from('employees')
      .select('*')
      .eq('status', 'Active')
      .order('group_name').order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [])

  // Load entry state for selected date
  const loadDate = useCallback(async (d) => {
    setLoading(true)
    // Get or null submission
    const { data: sub } = await supabase
      .from('daily_submissions')
      .select('*')
      .eq('date', d)
      .maybeSingle()

    setSubmission(sub)

    // Get meal logs
    const { data: logs } = await supabase
      .from('meal_logs')
      .select('*')
      .eq('date', d)

    const state = {}
    if (logs) {
      logs.forEach(log => {
        state[log.employee_id] = {
          b: log.had_breakfast,
          l: log.had_lunch,
          s: log.had_supper,
          logId: log.id,
        }
      })
    }
    setEntryState(state)
    setLoading(false)
  }, [])

  useEffect(() => { loadDate(date) }, [date, loadDate])

  // Is this day editable?
  const isEditable = () => {
    if (!submission) return true                                        // new day
    if (submission.status === 'draft') return can.editDraft(role)
    if (submission.status === 'submitted') return can.editSubmitted(role)
    if (submission.status === 'approved') return can.editApproved(role)
    return false
  }

  function toggleMeal(empId, meal) {
    if (!isEditable()) return
    setEntryState(prev => ({
      ...prev,
      [empId]: {
        b: false, l: false, s: false,
        ...(prev[empId] || {}),
        [meal]: !(prev[empId]?.[meal] || false),
      },
    }))
  }

  function toggleAll(meal) {
    const visible = filteredEmps()
    const allOn = visible.every(e => entryState[e.id]?.[meal])
    setEntryState(prev => {
      const next = { ...prev }
      visible.forEach(e => {
        next[e.id] = { b: false, l: false, s: false, ...(prev[e.id] || {}), [meal]: !allOn }
      })
      return next
    })
  }

  async function saveEntries() {
    if (!isEditable()) { showToast('This day is locked', 'red'); return }
    setSaving(true)
    try {
      // Upsert daily_submissions
      let subId = submission?.id
      if (!subId) {
        const { data: newSub, error } = await supabase
          .from('daily_submissions')
          .insert({ date, status: 'draft', submitted_by: profile.id })
          .select()
          .single()
        if (error) throw error
        subId = newSub.id
        setSubmission(newSub)
      }

      // Upsert meal_logs for each employee
      const upserts = employees.map(e => ({
        submission_id: subId,
        date,
        employee_id: e.id,
        employee_name: e.name,
        had_breakfast: !!(entryState[e.id]?.b),
        had_lunch:     !!(entryState[e.id]?.l),
        had_supper:    !!(entryState[e.id]?.s),
        recorded_by:   profile.id,
        recorded_at:   new Date().toISOString(),
      }))

      const { error } = await supabase
        .from('meal_logs')
        .upsert(upserts, { onConflict: 'date,employee_id' })
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
    showToast('Submitted for approval ✓', 'green')
    loadDate(date)
  }

  function filteredEmps() {
    return employees.filter(e => {
      const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase())
      const matchGroup  = groupFilter === 'all' || e.group_name === groupFilter
      return matchSearch && matchGroup
    })
  }

  // Totals
  const totals = { b: 0, l: 0, s: 0 }
  employees.forEach(e => {
    const m = entryState[e.id] || {}
    if (m.b) totals.b++
    if (m.l) totals.l++
    if (m.s) totals.s++
  })

  const editable = isEditable()
  const visible  = filteredEmps()

  return (
    <div>
      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: '17px', fontWeight: 700, margin: 0 }}>Daily Meal Entry</h2>
          {submission && (
            <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusBadge status={submission.status} />
              {!editable && (
                <span style={{ fontSize: '12px', color: '#C00000', fontWeight: 600 }}>
                  🔒 This day is locked — {submission.status}
                </span>
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
              padding: '7px 10px', border: '1px solid #dde2ea', borderRadius: '8px',
              fontSize: '13px', fontFamily: 'inherit',
            }}
          />
          {editable && (
            <Button onClick={saveEntries} variant="success" disabled={saving}>
              {saving ? 'Saving…' : '💾 Save entries'}
            </Button>
          )}
          {submission?.status === 'draft' && can.submitForApproval(role) && (
            <Button onClick={submitForApproval} variant="primary" disabled={saving}>
              📤 Submit for approval
            </Button>
          )}
        </div>
      </div>

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '12px', marginBottom: '20px' }}>
        <StatCard label="Breakfasts" value={totals.b} color="#C55A11" />
        <StatCard label="Lunches"    value={totals.l} color="#00897B" />
        <StatCard label="Suppers"    value={totals.s} color="#5E35B1" />
        <StatCard label="Total meals" value={totals.b + totals.l + totals.s} color="#C00000" />
      </div>

      {/* Controls */}
      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="🔍 Filter employees…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1, minWidth: '200px', maxWidth: '320px',
              padding: '7px 12px', border: '1px solid #dde2ea', borderRadius: '8px',
              fontSize: '13px', fontFamily: 'inherit',
            }}
          />
          {['all', 'Main Site', 'Manhattan'].map(g => (
            <button
              key={g}
              onClick={() => setGroupFilter(g)}
              style={{
                padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                cursor: 'pointer', border: '1px solid #dde2ea', fontFamily: 'inherit',
                background: groupFilter === g ? '#1F3864' : 'transparent',
                color: groupFilter === g ? '#fff' : '#4a5568',
              }}
            >
              {g === 'all' ? 'All groups' : g}
            </button>
          ))}
          {editable && (
            <>
              <Button onClick={() => toggleAll('b')} variant="ghost" size="sm">All Breakfast</Button>
              <Button onClick={() => toggleAll('l')} variant="ghost" size="sm">All Lunch</Button>
              <Button onClick={() => toggleAll('s')} variant="ghost" size="sm">All Supper</Button>
            </>
          )}
        </div>
      </Card>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading…</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid #dde2ea' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#1F3864', color: '#fff' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '12px', width: '36px' }}>#</th>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '12px' }}>Employee</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', width: '60px' }}>Group</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', width: '80px', background: '#7e4a1a' }}>🌅 B'fast</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', width: '80px', background: '#0f6e56' }}>☀️ Lunch</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', width: '80px', background: '#3c3489' }}>🌙 Supper</th>
                <th style={{ padding: '10px 12px', textAlign: 'center', fontSize: '12px', width: '60px' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((emp, i) => {
                const m    = entryState[emp.id] || { b: false, l: false, s: false }
                const tot  = (m.b?1:0)+(m.l?1:0)+(m.s?1:0)
                const isAll = m.b && m.l && m.s
                const isAny = m.b || m.l || m.s
                return (
                  <tr
                    key={emp.id}
                    style={{
                      borderBottom: '1px solid #dde2ea',
                      background: isAll ? '#f0fff4' : isAny ? '#fffbf0' : '#fff',
                    }}
                  >
                    <td style={{ padding: '9px 12px', color: '#888', textAlign: 'center' }}>{i+1}</td>
                    <td style={{ padding: '9px 12px', fontWeight: isAny ? 600 : 400 }}>{emp.name}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      <span style={{
                        background: emp.group_name === 'Manhattan' ? '#E0F2F1' : '#D6E4F0',
                        color: emp.group_name === 'Manhattan' ? '#00897B' : '#1F3864',
                        padding: '1px 7px', borderRadius: '10px', fontSize: '10px', fontWeight: 700,
                      }}>
                        {emp.group_name === 'Manhattan' ? 'MTN' : 'MAIN'}
                      </span>
                    </td>
                    {['b','l','s'].map(meal => (
                      <td key={meal} style={{ padding: '9px 12px', textAlign: 'center' }}>
                        <MealTick
                          on={!!m[meal]}
                          meal={meal}
                          editable={editable}
                          onClick={() => toggleMeal(emp.id, meal)}
                        />
                      </td>
                    ))}
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, fontSize: '15px', color: isAny ? '#2F5496' : '#888' }}>
                      {tot || ''}
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

// ── Meal tick component ─────────────────────────────────────────────────────
function MealTick({ on, meal, editable, onClick }) {
  const colors = {
    b: { border: '#C55A11', bg: '#FCE4D6', color: '#C55A11' },
    l: { border: '#00897B', bg: '#E0F2F1', color: '#00897B' },
    s: { border: '#5E35B1', bg: '#EDE7F6', color: '#5E35B1' },
  }
  const c = colors[meal]
  return (
    <div
      onClick={editable ? onClick : undefined}
      style={{
        width: '36px', height: '36px',
        cursor: editable ? 'pointer' : 'default',
        border: `2px solid ${on ? c.border : '#dde2ea'}`,
        borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? c.bg : '#fff',
        color: on ? c.color : '#dde2ea',
        margin: '0 auto',
        transition: 'all .15s',
      }}
    >
      {on && (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
    </div>
  )
}
