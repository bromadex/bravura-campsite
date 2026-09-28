import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'

// Projects rewrite (#76): one status model for every task, shared by the workspace, board, drawer and home.
export const STATUS = {
  todo:        { label: 'To do',       color: '#5B6661', tint: '#EEF1EF' },
  in_progress: { label: 'In progress', color: '#1F4E8C', tint: '#EEF3FA' },
  review:      { label: 'Review',      color: '#7A4FB5', tint: '#F4EFFA' },
  blocked:     { label: 'Blocked',     color: '#B3261E', tint: '#FBEDEC' },
  done:        { label: 'Done',        color: '#2F7D4F', tint: '#F1F8F3' },
  cancelled:   { label: 'Cancelled',   color: '#8A948F', tint: '#F2F4F2' },
}
export const STATUS_ORDER = ['todo', 'in_progress', 'review', 'blocked', 'done']

export const PRIORITY = {
  urgent: { label: 'Urgent', color: '#B3261E' },
  high:   { label: 'High',   color: '#C8811E' },
  medium: { label: 'Medium', color: '#1F4E8C' },
  low:    { label: 'Low',    color: '#8A948F' },
}

export const HEALTH = {
  on_track:  { label: 'On track',  color: '#2F7D4F', tint: '#F1F8F3' },
  at_risk:   { label: 'At risk',   color: '#C8811E', tint: '#FFF6E8' },
  off_track: { label: 'Off track', color: '#B3261E', tint: '#FBEDEC' },
}

const DAY = 86400000
export function dueInfo(due, status) {
  if (!due) return null
  if (status === 'done' || status === 'cancelled') return { text: fmtDate(due), color: '#8A948F' }
  const d = Math.round((new Date(due + 'T00:00:00') - new Date(new Date().toDateString())) / DAY)
  if (d < 0) return { text: `${-d} d late`, color: '#B3261E', late: true }
  if (d === 0) return { text: 'Today', color: '#C8811E' }
  if (d === 1) return { text: 'Tomorrow', color: '#C8811E' }
  if (d < 7) return { text: new Date(due + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short' }), color: '#16211D' }
  return { text: fmtDate(due), color: '#5B6661' }
}
export function bucketOf(t) {
  if (t.status === 'done' || t.status === 'cancelled') return 'done'
  if (!t.due_date) return 'later'
  const d = Math.round((new Date(t.due_date + 'T00:00:00') - new Date(new Date().toDateString())) / DAY)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  if (d < 7) return 'week'
  return 'later'
}
export const fmtDate = d => d ? new Date(String(d).length === 10 ? d + 'T00:00:00' : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
export const ago = ts => {
  const s = (Date.now() - new Date(ts)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
export const daysSince = ts => ts ? Math.floor((Date.now() - new Date(ts)) / DAY) : 0

// people who can be given a task (logins)
let _people = null
export function usePeople() {
  const [people, setPeople] = useState(_people || [])
  useEffect(() => {
    if (_people) return
    supabase.from('profiles').select('id, full_name, username').not('is_suspended', 'is', true).order('full_name')
      .then(({ data }) => { _people = (data || []).map(p => ({ id: p.id, name: p.full_name || p.username })); setPeople(_people) })
  }, [])
  return people
}
export const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
const AV = ['#1F4E8C', '#982329', '#2F7D4F', '#7A4FB5', '#C8811E', '#0E7C86', '#5B6661']
export const avatarColor = s => AV[[...(s || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % AV.length]
