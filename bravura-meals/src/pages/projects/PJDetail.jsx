import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { showToast, Icon } from '../../components/ui'
import { KpiCard, DashCard, DonutGauge, ProgressRow, SectionTitle } from '../../components/dash'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.projects

const STATUS_COLORS = {
  planning:  { bg: '#E3F2FD', text: '#1565C0', label: 'Planning' },
  active:    { bg: '#E8F5E9', text: '#2E7D32', label: 'Active' },
  on_hold:   { bg: '#FFF3E0', text: '#E65100', label: 'On Hold' },
  completed: { bg: '#F3E5F5', text: '#6A1B9A', label: 'Completed' },
  cancelled: { bg: '#FFEBEE', text: '#B71C1C', label: 'Cancelled' },
}
const PHASE_STATUSES = ['pending', 'in_progress', 'completed', 'skipped']
const PHASE_STATUS_COLORS = {
  pending:     { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Pending' },
  in_progress: { bg: '#E3F2FD', text: '#1565C0', label: 'In Progress' },
  completed:   { bg: '#E8F5E9', text: '#2E7D32', label: 'Completed' },
  skipped:     { bg: '#FFF3E0', text: '#E65100', label: 'Skipped' },
}
const MEMBER_ROLES = ['owner', 'manager', 'engineer', 'supervisor', 'foreman', 'operator', 'labourer', 'viewer']
const PRIORITY_COLORS = { low: '#4CAF50', medium: '#FF9800', high: '#F44336', critical: '#9C27B0' }
const PRIORITIES = ['low', 'medium', 'high', 'critical']
const DEFAULT_COLUMNS = [
  { name: 'Backlog', position: 0 },
  { name: 'To Do', position: 1 },
  { name: 'In Progress', position: 2 },
  { name: 'Review', position: 3 },
  { name: 'Done', position: 4, is_done_column: true },
]

function fmtMoney(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function daysBetween(a, b) {
  if (!a) return 0
  return Math.max(0, Math.round((new Date(b || new Date()) - new Date(a)) / 86400000))
}

export default function PJDetail({ projectId, setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()

  const [project, setProject] = useState(null)
  const [phases, setPhases] = useState([])
  const [members, setMembers] = useState([])
  const [labels, setLabels] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  // Phase form
  const [phaseModal, setPhaseModal] = useState(false)
  const [editPhaseId, setEditPhaseId] = useState(null)
  const [phaseForm, setPhaseForm] = useState({ name: '', description: '', status: 'pending', start_date: '', end_date: '', budget_allocation: '', is_milestone: false, color: '' })
  const [phaseSaving, setPhaseSaving] = useState(false)

  // Member form
  const [memberModal, setMemberModal] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'viewer' })
  const [memberSaving, setMemberSaving] = useState(false)
  const [siteUsers, setSiteUsers] = useState([])

  // Label form
  const [labelModal, setLabelModal] = useState(false)
  const [labelForm, setLabelForm] = useState({ name: '', color: '#1565C0' })
  const [labelSaving, setLabelSaving] = useState(false)

  // Board state
  const [boardColumns, setBoardColumns] = useState([])
  const [boardTasks, setBoardTasks] = useState([])
  const [taskLabels, setTaskLabels] = useState([])
  const [taskChecklists, setTaskChecklists] = useState([])
  const [boardLoading, setBoardLoading] = useState(false)
  const [quickAddText, setQuickAddText] = useState({})
  const [taskModal, setTaskModal] = useState(null)
  const [taskForm, setTaskForm] = useState({})
  const [taskSaving, setTaskSaving] = useState(false)
  const [editColName, setEditColName] = useState(null)
  const [editColText, setEditColText] = useState('')
  const [addColName, setAddColName] = useState('')
  const [showAddCol, setShowAddCol] = useState(false)
  const [boardFilter, setBoardFilter] = useState({ label: '', assignee: '', priority: '' })
  const [checklistInput, setChecklistInput] = useState('')
  const [taskLabelPicker, setTaskLabelPicker] = useState(false)
  const dragItem = useRef(null)
  const dragOverCol = useRef(null)

  useRealtimeSubscription('project_phases', { column: 'project_id', value: projectId }, fetchAll)
  useRealtimeSubscription('project_members', { column: 'project_id', value: projectId }, fetchAll)

  async function fetchAll() {
    if (!projectId) return
    setLoading(true)
    const [pRes, phRes, mRes, lRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('project_phases').select('*').eq('project_id', projectId).order('sequence'),
      supabase.from('project_members').select('*, profile:user_id(email)').eq('project_id', projectId).eq('is_active', true),
      supabase.from('project_labels').select('*').eq('project_id', projectId).order('name'),
    ])
    if (pRes.error) showToast(pRes.error.message, 'red')
    setProject(pRes.data)
    setPhases(phRes.data || [])
    setMembers(mRes.data || [])
    setLabels(lRes.data || [])
    setLoading(false)
  }

  async function fetchSiteUsers() {
    if (!currentSiteId) return
    const { data } = await supabase.from('profiles').select('id, email, full_name').order('email')
    setSiteUsers(data || [])
  }

  useEffect(() => { fetchAll(); fetchSiteUsers() }, [projectId, currentSiteId])

  const phasePct = useMemo(() => {
    if (!phases.length) return 0
    const totalW = phases.reduce((s, p) => s + (p.weight || 1), 0)
    const doneW = phases.filter(p => p.status === 'completed').reduce((s, p) => s + (p.weight || 1), 0)
    return totalW > 0 ? Math.round((doneW / totalW) * 100) : 0
  }, [phases])

  // Phase CRUD
  function openAddPhase() {
    setEditPhaseId(null)
    setPhaseForm({ name: '', description: '', status: 'pending', start_date: '', end_date: '', budget_allocation: '', is_milestone: false, color: '' })
    setPhaseModal(true)
  }
  function openEditPhase(ph) {
    setEditPhaseId(ph.id)
    setPhaseForm({
      name: ph.name, description: ph.description || '', status: ph.status,
      start_date: ph.start_date || '', end_date: ph.end_date || '',
      budget_allocation: ph.budget_allocation || '', is_milestone: !!ph.is_milestone, color: ph.color || '',
    })
    setPhaseModal(true)
  }
  async function savePhase() {
    if (!phaseForm.name.trim()) return
    setPhaseSaving(true)
    try {
      const payload = {
        project_id: projectId,
        name: phaseForm.name.trim(),
        description: phaseForm.description || null,
        status: phaseForm.status,
        start_date: phaseForm.start_date || null,
        end_date: phaseForm.end_date || null,
        budget_allocation: phaseForm.budget_allocation ? parseFloat(phaseForm.budget_allocation) : null,
        is_milestone: phaseForm.is_milestone,
        color: phaseForm.color || null,
      }
      if (editPhaseId) {
        const { error } = await supabase.from('project_phases').update(payload).eq('id', editPhaseId)
        if (error) throw error
      } else {
        payload.sequence = phases.length + 1
        const { error } = await supabase.from('project_phases').insert(payload)
        if (error) throw error
      }
      showToast(editPhaseId ? 'Phase updated' : 'Phase added', 'green')
      await fetchAll()
      setPhaseModal(false)
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setPhaseSaving(false)
    }
  }
  async function deletePhase() {
    if (!confirm('Remove this phase?')) return
    await supabase.from('project_phases').delete().eq('id', editPhaseId)
    showToast('Phase removed', 'green')
    await fetchAll()
    setPhaseModal(false)
  }

  // Member CRUD
  async function addMember() {
    if (!memberForm.user_id) return
    setMemberSaving(true)
    try {
      const { error } = await supabase.from('project_members').insert({
        project_id: projectId, user_id: memberForm.user_id, role: memberForm.role,
      })
      if (error) throw error
      showToast('Member added', 'green')
      await fetchAll()
      setMemberModal(false)
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setMemberSaving(false)
    }
  }
  async function removeMember(id) {
    if (!confirm('Remove this member?')) return
    await supabase.from('project_members').update({ is_active: false, removed_date: new Date().toISOString().slice(0, 10) }).eq('id', id)
    showToast('Member removed', 'green')
    await fetchAll()
  }

  // Label CRUD
  async function addLabel() {
    if (!labelForm.name.trim()) return
    setLabelSaving(true)
    try {
      const { error } = await supabase.from('project_labels').insert({
        project_id: projectId, name: labelForm.name.trim(), color: labelForm.color,
      })
      if (error) throw error
      showToast('Label added', 'green')
      await fetchAll()
      setLabelModal(false)
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setLabelSaving(false)
    }
  }
  async function removeLabel(id) {
    if (!confirm('Remove this label?')) return
    await supabase.from('project_labels').delete().eq('id', id)
    showToast('Label removed', 'green')
    await fetchAll()
  }

  // ── Board data fetching ──────────────────────────────────────────────────
  const fetchBoard = useCallback(async () => {
    if (!projectId) return
    setBoardLoading(true)
    const [colRes, taskRes, tlRes, clRes] = await Promise.all([
      supabase.from('project_board_columns').select('*').eq('project_id', projectId).order('position'),
      supabase.from('project_tasks').select('*').eq('project_id', projectId).eq('is_archived', false).order('position'),
      supabase.from('project_task_labels').select('*, label:label_id(id,name,color)').in('task_id',
        (await supabase.from('project_tasks').select('id').eq('project_id', projectId).eq('is_archived', false)).data?.map(t => t.id) || ['00000000-0000-0000-0000-000000000000']
      ),
      supabase.from('project_task_checklist').select('*').in('task_id',
        (await supabase.from('project_tasks').select('id').eq('project_id', projectId).eq('is_archived', false)).data?.map(t => t.id) || ['00000000-0000-0000-0000-000000000000']
      ).order('position'),
    ])
    let cols = colRes.data || []
    // Auto-create default columns if none
    if (cols.length === 0) {
      const inserts = DEFAULT_COLUMNS.map(c => ({ project_id: projectId, ...c, is_done_column: c.is_done_column || false }))
      const { data: newCols, error } = await supabase.from('project_board_columns').insert(inserts).select()
      if (!error && newCols) cols = newCols.sort((a, b) => a.position - b.position)
    }
    setBoardColumns(cols)
    setBoardTasks(taskRes.data || [])
    setTaskLabels(tlRes.data || [])
    setTaskChecklists(clRes.data || [])
    setBoardLoading(false)
  }, [projectId])

  useEffect(() => { if (tab === 'board') fetchBoard() }, [tab, fetchBoard])

  // ── Board CRUD ──────────────────────────────────────────────────────────
  async function quickAddTask(colId) {
    const title = (quickAddText[colId] || '').trim()
    if (!title) return
    const maxPos = boardTasks.filter(t => t.column_id === colId).reduce((m, t) => Math.max(m, t.position), -1)
    const { error } = await supabase.from('project_tasks').insert({
      project_id: projectId, column_id: colId, title, position: maxPos + 1,
      priority: 'medium', created_by: profile?.id,
    })
    if (error) { showToast(error.message, 'red'); return }
    setQuickAddText(p => ({ ...p, [colId]: '' }))
    await fetchBoard()
  }

  async function addColumn() {
    const name = addColName.trim()
    if (!name) return
    const maxPos = boardColumns.reduce((m, c) => Math.max(m, c.position), -1)
    const { error } = await supabase.from('project_board_columns').insert({
      project_id: projectId, name, position: maxPos + 1,
    })
    if (error) showToast(error.message, 'red')
    else { setAddColName(''); setShowAddCol(false); await fetchBoard() }
  }

  async function renameColumn(colId) {
    const name = editColText.trim()
    if (!name) { setEditColName(null); return }
    await supabase.from('project_board_columns').update({ name }).eq('id', colId)
    setEditColName(null)
    await fetchBoard()
  }

  function openTaskModal(task) {
    const tl = taskLabels.filter(x => x.task_id === task.id).map(x => x.label_id)
    const cl = taskChecklists.filter(x => x.task_id === task.id)
    setTaskForm({
      ...task,
      _labels: tl,
      _checklist: cl,
    })
    setTaskLabelPicker(false)
    setChecklistInput('')
    setTaskModal(task.id)
  }

  async function saveTask() {
    setTaskSaving(true)
    try {
      const col = boardColumns.find(c => c.id === taskForm.column_id)
      const wasInDone = boardTasks.find(t => t.id === taskForm.id)
      const movingToDone = col?.is_done_column && !wasInDone?.completed_date
      const leavingDone = !col?.is_done_column && wasInDone?.completed_date

      const payload = {
        title: taskForm.title, description: taskForm.description || null,
        column_id: taskForm.column_id, phase_id: taskForm.phase_id || null,
        priority: taskForm.priority, assigned_to: taskForm.assigned_to || null,
        due_date: taskForm.due_date || null, start_date: taskForm.start_date || null,
        estimated_hours: taskForm.estimated_hours || null, actual_hours: taskForm.actual_hours || null,
      }
      if (movingToDone) payload.completed_date = new Date().toISOString()
      if (leavingDone) payload.completed_date = null

      const { error } = await supabase.from('project_tasks').update(payload).eq('id', taskForm.id)
      if (error) throw error

      // Sync labels
      const oldLabels = taskLabels.filter(x => x.task_id === taskForm.id).map(x => x.label_id)
      const newLabels = taskForm._labels || []
      const toAdd = newLabels.filter(l => !oldLabels.includes(l))
      const toRemove = oldLabels.filter(l => !newLabels.includes(l))
      if (toRemove.length) await supabase.from('project_task_labels').delete().eq('task_id', taskForm.id).in('label_id', toRemove)
      if (toAdd.length) await supabase.from('project_task_labels').insert(toAdd.map(l => ({ task_id: taskForm.id, label_id: l })))

      showToast('Task updated', 'green')
      setTaskModal(null)
      await fetchBoard()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setTaskSaving(false)
    }
  }

  async function archiveTask() {
    if (!confirm('Archive this task?')) return
    await supabase.from('project_tasks').update({ is_archived: true, archived_at: new Date().toISOString() }).eq('id', taskForm.id)
    showToast('Task archived', 'green')
    setTaskModal(null)
    await fetchBoard()
  }

  async function addChecklistItem() {
    const title = checklistInput.trim()
    if (!title || !taskForm.id) return
    const maxPos = (taskForm._checklist || []).reduce((m, c) => Math.max(m, c.position), -1)
    const { data, error } = await supabase.from('project_task_checklist').insert({
      task_id: taskForm.id, title, position: maxPos + 1,
    }).select().single()
    if (error) { showToast(error.message, 'red'); return }
    setChecklistInput('')
    setTaskForm(f => ({ ...f, _checklist: [...(f._checklist || []), data] }))
    await fetchBoard()
  }

  async function toggleChecklistItem(item) {
    await supabase.from('project_task_checklist').update({ checked: !item.checked }).eq('id', item.id)
    setTaskForm(f => ({
      ...f, _checklist: (f._checklist || []).map(c => c.id === item.id ? { ...c, checked: !c.checked } : c)
    }))
    await fetchBoard()
  }

  async function deleteChecklistItem(id) {
    await supabase.from('project_task_checklist').delete().eq('id', id)
    setTaskForm(f => ({ ...f, _checklist: (f._checklist || []).filter(c => c.id !== id) }))
    await fetchBoard()
  }

  // Drag and drop
  function handleDragStart(e, task) {
    dragItem.current = task
    e.dataTransfer.effectAllowed = 'move'
  }
  function handleDragOver(e, colId) {
    e.preventDefault()
    dragOverCol.current = colId
  }
  async function handleDrop(e, colId) {
    e.preventDefault()
    const task = dragItem.current
    if (!task) return
    dragItem.current = null
    if (task.column_id === colId) return
    const col = boardColumns.find(c => c.id === colId)
    const maxPos = boardTasks.filter(t => t.column_id === colId).reduce((m, t) => Math.max(m, t.position), -1)
    const updates = { column_id: colId, position: maxPos + 1 }
    if (col?.is_done_column && !task.completed_date) updates.completed_date = new Date().toISOString()
    if (!col?.is_done_column && task.completed_date) updates.completed_date = null
    await supabase.from('project_tasks').update(updates).eq('id', task.id)
    await fetchBoard()
  }

  // Filter tasks for board
  const filteredTasks = useMemo(() => {
    return boardTasks.filter(t => {
      if (boardFilter.priority && t.priority !== boardFilter.priority) return false
      if (boardFilter.assignee && t.assigned_to !== boardFilter.assignee) return false
      if (boardFilter.label) {
        const tl = taskLabels.filter(x => x.task_id === t.id).map(x => x.label_id)
        if (!tl.includes(boardFilter.label)) return false
      }
      return true
    })
  }, [boardTasks, boardFilter, taskLabels])

  function getInitials(userId) {
    const m = members.find(x => x.user_id === userId)
    if (!m) return '?'
    const name = m.profile?.full_name || m.profile?.email || ''
    if (!name) return '?'
    const parts = name.split(/[\s@]/)
    return (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
  }

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  if (loading || !project) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const sc = STATUS_COLORS[project.status] || STATUS_COLORS.planning
  const daysElapsed = daysBetween(project.start_date, project.actual_end_date)
  const daysRemaining = project.target_end_date ? daysBetween(new Date().toISOString().slice(0, 10), project.target_end_date) : null

  const LABEL_COLORS = ['#E53935', '#FB8C00', '#43A047', '#1E88E5', '#8E24AA', '#00897B', '#6D4C41', '#546E7A', '#D81B60', '#F4511E']

  const TABS = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'phases', label: 'Phases', icon: 'timeline' },
    { id: 'team', label: 'Team', icon: 'group' },
    { id: 'labels', label: 'Labels', icon: 'label' },
    { id: 'board', label: 'Board', icon: 'view_kanban' },
    { id: 'costs', label: 'Costs', icon: 'payments', disabled: true },
    { id: 'activity', label: 'Activity', icon: 'forum', disabled: true },
  ]

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* Back button */}
      <button onClick={() => setPage('pj_projects')} style={{ background: 'none', border: 'none', color: color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, marginBottom: '12px', padding: 0, fontFamily: 'inherit' }}>
        <span className="material-symbols-rounded" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>arrow_back</span>
        All Projects
      </button>

      {/* Header */}
      <div style={{ borderRadius: '14px', overflow: 'hidden', border: `1px solid ${THEME.outlineVar}`, marginBottom: '20px' }}>
        <div style={{ height: '8px', background: project.cover_color || color }} />
        <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ fontSize: '11px', color: THEME.textLow, fontWeight: 600, marginBottom: '4px' }}>{project.project_code}</div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, marginBottom: '6px' }}>{project.name}</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', background: sc.bg, color: sc.text }}>{sc.label}</span>
              <span style={{ fontSize: '11px', color: THEME.textMed }}>{project.project_type}</span>
              {project.client && <span style={{ fontSize: '11px', color: THEME.textLow }}>· {project.client}</span>}
              {project.location && <span style={{ fontSize: '11px', color: THEME.textLow }}>· {project.location}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Progress ring */}
            <div style={{ textAlign: 'center' }}>
              <svg width="56" height="56" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="24" fill="none" stroke={THEME.outlineVar} strokeWidth="4" />
                <circle cx="28" cy="28" r="24" fill="none" stroke={project.cover_color || color} strokeWidth="4"
                  strokeDasharray={`${(phasePct / 100) * 150.8} 150.8`}
                  strokeLinecap="round" transform="rotate(-90 28 28)" />
                <text x="28" y="32" textAnchor="middle" fill={THEME.text} fontSize="13" fontWeight="700">{phasePct}%</text>
              </svg>
            </div>
            {project.budget > 0 && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{fmtMoney(project.budget)}</div>
                <div style={{ fontSize: '10px', color: THEME.textLow, fontWeight: 600 }}>BUDGET</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => !t.disabled && setTab(t.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: tab === t.id ? color : THEME.surfaceVar,
            color: tab === t.id ? '#fff' : t.disabled ? THEME.textLow : THEME.textMed,
            border: 'none', cursor: t.disabled ? 'default' : 'pointer', fontFamily: 'inherit',
            opacity: t.disabled ? 0.5 : 1,
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>{t.icon}</span>
            {t.label}
            {t.disabled && <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '4px', background: THEME.outlineVar, color: THEME.textLow }}>Soon</span>}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ───────────────────────────────────────────── */}
      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <KpiCard label="Phases" value={phases.length} icon="timeline" accent={color} />
            <KpiCard label="Completed" value={phases.filter(p => p.status === 'completed').length} icon="task_alt" accent="#2E7D32" />
            <KpiCard label="Team" value={members.length} icon="group" accent="#1565C0" />
            <KpiCard label="Labels" value={labels.length} icon="label" accent="#6A1B9A" />
            <KpiCard label="Days Elapsed" value={daysElapsed} icon="schedule" accent="#E65100" />
            {daysRemaining !== null && (
              <KpiCard label="Days Left" value={Math.max(0, daysRemaining)} icon="timer" accent={daysRemaining < 0 ? '#C62828' : '#00838F'} />
            )}
          </div>

          {project.description && (
            <DashCard style={{ marginBottom: '16px' }}>
              <SectionTitle title="Description" />
              <div style={{ fontSize: '13px', color: THEME.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{project.description}</div>
            </DashCard>
          )}

          {/* Phase progress bars */}
          {phases.length > 0 && (
            <DashCard style={{ marginBottom: '16px' }}>
              <SectionTitle title="Phase Progress" subtitle={`${phasePct}% complete`} />
              {phases.map(ph => {
                const psc = PHASE_STATUS_COLORS[ph.status] || PHASE_STATUS_COLORS.pending
                const pct = ph.status === 'completed' ? 100 : ph.status === 'in_progress' ? 50 : 0
                return (
                  <ProgressRow key={ph.id} label={`${ph.is_milestone ? '◆ ' : ''}${ph.name}`} value={psc.label} pct={pct} color={ph.color || color} />
                )
              })}
            </DashCard>
          )}

          {/* Labels */}
          {labels.length > 0 && (
            <DashCard>
              <SectionTitle title="Labels" />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {labels.map(l => (
                  <span key={l.id} style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', background: l.color + '20', color: l.color }}>{l.name}</span>
                ))}
              </div>
            </DashCard>
          )}
        </>
      )}

      {/* ── PHASES TAB ─────────────────────────────────────────────── */}
      {tab === 'phases' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <SectionTitle title="Project Phases" subtitle={`${phases.length} phase${phases.length !== 1 ? 's' : ''}`} />
            {can('projects.edit') && (
              <button onClick={openAddPhase} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>
                Add Phase
              </button>
            )}
          </div>

          {phases.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>No phases yet. Add milestones and phases to track progress.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {phases.map((ph, i) => {
                const psc = PHASE_STATUS_COLORS[ph.status] || PHASE_STATUS_COLORS.pending
                return (
                  <DashCard key={ph.id} style={{ padding: '14px 18px', cursor: can('projects.edit') ? 'pointer' : 'default' }}
                    onClick={() => can('projects.edit') && openEditPhase(ph)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                        <div style={{
                          width: '32px', height: '32px', borderRadius: '10px',
                          background: (ph.color || color) + '18', color: ph.color || color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                          <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>{ph.is_milestone ? 'flag' : 'radio_button_checked'}</span>
                        </div>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{ph.name}</div>
                          <div style={{ fontSize: '11px', color: THEME.textLow }}>
                            {ph.start_date && ph.end_date ? `${ph.start_date} → ${ph.end_date}` : ph.start_date || 'No dates set'}
                            {ph.budget_allocation ? ` · ${fmtMoney(ph.budget_allocation)}` : ''}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', background: psc.bg, color: psc.text, whiteSpace: 'nowrap' }}>{psc.label}</span>
                    </div>
                  </DashCard>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── TEAM TAB ───────────────────────────────────────────────── */}
      {tab === 'team' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <SectionTitle title="Team Members" subtitle={`${members.length} member${members.length !== 1 ? 's' : ''}`} />
            {can('projects.edit') && (
              <button onClick={() => { setMemberForm({ user_id: '', role: 'viewer' }); setMemberModal(true) }} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>person_add</span>
                Add Member
              </button>
            )}
          </div>

          {members.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>No team members yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
              {members.map(m => (
                <DashCard key={m.id} style={{ padding: '14px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        background: color + '18', color: color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '16px', fontWeight: 700,
                      }}>
                        {(m.profile?.email || '?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{m.profile?.full_name || m.profile?.email || 'Unknown'}</div>
                        <div style={{ fontSize: '11px', color: THEME.textLow }}>{m.role}</div>
                      </div>
                    </div>
                    {can('projects.edit') && (
                      <button onClick={() => removeMember(m.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                      }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textLow }}>close</span>
                      </button>
                    )}
                  </div>
                </DashCard>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── LABELS TAB ─────────────────────────────────────────────── */}
      {tab === 'labels' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <SectionTitle title="Project Labels" subtitle="Tags for categorizing tasks" />
            {can('projects.edit') && (
              <button onClick={() => { setLabelForm({ name: '', color: '#1565C0' }); setLabelModal(true) }} style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>
                Add Label
              </button>
            )}
          </div>

          {labels.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow, fontSize: '13px' }}>No labels yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {labels.map(l => (
                <DashCard key={l.id} style={{ padding: '12px 18px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '24px', height: '24px', borderRadius: '6px', background: l.color }} />
                      <span style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{l.name}</span>
                    </div>
                    {can('projects.edit') && (
                      <button onClick={() => removeLabel(l.id)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                      }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textLow }}>delete</span>
                      </button>
                    )}
                  </div>
                </DashCard>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── BOARD TAB ──────────────────────────────────────────────── */}
      {tab === 'board' && (
        <>
          {/* Filter bar */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>Filter:</span>
            <select style={{ ...inp, width: 'auto', padding: '5px 10px', fontSize: '12px' }} value={boardFilter.priority} onChange={e => setBoardFilter(f => ({ ...f, priority: e.target.value }))}>
              <option value="">All Priorities</option>
              {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
            </select>
            <select style={{ ...inp, width: 'auto', padding: '5px 10px', fontSize: '12px' }} value={boardFilter.assignee} onChange={e => setBoardFilter(f => ({ ...f, assignee: e.target.value }))}>
              <option value="">All Assignees</option>
              {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email || 'Unknown'}</option>)}
            </select>
            <select style={{ ...inp, width: 'auto', padding: '5px 10px', fontSize: '12px' }} value={boardFilter.label} onChange={e => setBoardFilter(f => ({ ...f, label: e.target.value }))}>
              <option value="">All Labels</option>
              {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            {(boardFilter.priority || boardFilter.assignee || boardFilter.label) && (
              <button onClick={() => setBoardFilter({ label: '', assignee: '', priority: '' })} style={{ background: 'none', border: 'none', color: THEME.textLow, cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit' }}>Clear</button>
            )}
          </div>

          {boardLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
              <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '16px', minHeight: '400px', alignItems: 'flex-start' }}>
              {boardColumns.map(col => {
                const colTasks = filteredTasks.filter(t => t.column_id === col.id).sort((a, b) => a.position - b.position)
                const atLimit = col.wip_limit && colTasks.length >= col.wip_limit
                const overLimit = col.wip_limit && colTasks.length > col.wip_limit
                return (
                  <div key={col.id} style={{
                    minWidth: '270px', maxWidth: '300px', flex: '0 0 270px',
                    background: THEME.surfaceVar, borderRadius: '12px', padding: '10px',
                    display: 'flex', flexDirection: 'column', maxHeight: '75vh',
                  }}
                    onDragOver={e => handleDragOver(e, col.id)}
                    onDrop={e => handleDrop(e, col.id)}
                  >
                    {/* Column header */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: '10px', padding: '4px 6px', borderRadius: '8px',
                      background: overLimit ? '#FFEBEE' : atLimit ? '#FFF3E0' : 'transparent',
                    }}>
                      {editColName === col.id ? (
                        <input autoFocus style={{ ...inp, padding: '4px 8px', fontSize: '13px', fontWeight: 700 }}
                          value={editColText}
                          onChange={e => setEditColText(e.target.value)}
                          onBlur={() => renameColumn(col.id)}
                          onKeyDown={e => { if (e.key === 'Enter') renameColumn(col.id); if (e.key === 'Escape') setEditColName(null) }}
                        />
                      ) : (
                        <span style={{ fontSize: '13px', fontWeight: 700, color: THEME.text, cursor: can('projects.edit') ? 'pointer' : 'default' }}
                          onClick={() => { if (can('projects.edit')) { setEditColName(col.id); setEditColText(col.name) } }}
                        >{col.name}</span>
                      )}
                      <span style={{ fontSize: '11px', fontWeight: 600, color: overLimit ? '#C62828' : atLimit ? '#E65100' : THEME.textLow, marginLeft: '6px' }}>
                        {colTasks.length}{col.wip_limit ? `/${col.wip_limit}` : ''}
                      </span>
                    </div>

                    {/* Cards */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {colTasks.map(task => {
                        const tLabels = taskLabels.filter(x => x.task_id === task.id)
                        const tChecklist = taskChecklists.filter(x => x.task_id === task.id)
                        const checkedCount = tChecklist.filter(c => c.checked).length
                        const isOverdue = task.due_date && new Date(task.due_date) < new Date() && !task.completed_date
                        return (
                          <div key={task.id} draggable={can('projects.edit')} onDragStart={e => handleDragStart(e, task)}
                            onClick={() => openTaskModal(task)}
                            style={{
                              background: THEME.surface, borderRadius: '10px', padding: '10px 12px',
                              cursor: 'pointer', borderLeft: `4px solid ${PRIORITY_COLORS[task.priority] || '#999'}`,
                              boxShadow: '0 1px 3px rgba(0,0,0,0.08)', transition: 'box-shadow 0.15s',
                            }}
                          >
                            {/* Label chips */}
                            {tLabels.length > 0 && (
                              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                                {tLabels.map(tl => (
                                  <span key={tl.label_id} style={{
                                    fontSize: '9px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                                    background: (tl.label?.color || '#999') + '25', color: tl.label?.color || '#999',
                                  }}>{tl.label?.name}</span>
                                ))}
                              </div>
                            )}
                            {/* Title */}
                            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '6px', lineHeight: 1.3 }}>{task.title}</div>
                            {/* Meta row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              {task.due_date && (
                                <span style={{ fontSize: '10px', fontWeight: 600, color: isOverdue ? '#C62828' : THEME.textLow, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>calendar_today</span>
                                  {task.due_date}
                                </span>
                              )}
                              {tChecklist.length > 0 && (
                                <span style={{ fontSize: '10px', fontWeight: 600, color: checkedCount === tChecklist.length ? '#2E7D32' : THEME.textLow, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                  <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>checklist</span>
                                  {checkedCount}/{tChecklist.length}
                                </span>
                              )}
                              <div style={{ flex: 1 }} />
                              {task.assigned_to && (
                                <div style={{
                                  width: '22px', height: '22px', borderRadius: '50%',
                                  background: color + '20', color: color,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '9px', fontWeight: 700,
                                }}>{getInitials(task.assigned_to)}</div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Quick add */}
                    {can('projects.edit') && (
                      <div style={{ marginTop: '8px' }}>
                        <input style={{ ...inp, padding: '6px 10px', fontSize: '12px' }}
                          placeholder="+ Add card..."
                          value={quickAddText[col.id] || ''}
                          onChange={e => setQuickAddText(p => ({ ...p, [col.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') quickAddTask(col.id) }}
                        />
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Add column */}
              {can('projects.edit') && (
                <div style={{ minWidth: '250px', flex: '0 0 250px' }}>
                  {showAddCol ? (
                    <div style={{ background: THEME.surfaceVar, borderRadius: '12px', padding: '12px' }}>
                      <input autoFocus style={{ ...inp, marginBottom: '8px' }} placeholder="Column name"
                        value={addColName} onChange={e => setAddColName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') addColumn(); if (e.key === 'Escape') setShowAddCol(false) }}
                      />
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={addColumn} style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
                        <button onClick={() => setShowAddCol(false)} style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setShowAddCol(true)} style={{
                      width: '100%', padding: '12px', borderRadius: '12px', fontSize: '13px', fontWeight: 600,
                      background: THEME.surfaceVar, color: THEME.textMed, border: `2px dashed ${THEME.outlineVar}`,
                      cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    }}>
                      <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>
                      Add Column
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Placeholder tabs */}
      {(tab === 'costs' || tab === 'activity') && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>
            {tab === 'costs' ? 'payments' : 'forum'}
          </span>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>{tab === 'costs' ? 'Cost Tracking' : 'Activity Feed'}</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Coming in Phase {tab === 'costs' ? '5' : '3'}</div>
        </div>
      )}

      {/* ── TASK DETAIL MODAL ───────────────────────────────────────── */}
      {taskModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', background: 'rgba(0,0,0,.45)', paddingTop: '5vh', overflowY: 'auto' }}
          onClick={e => { if (e.target === e.currentTarget) setTaskModal(null) }}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '600px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px', marginBottom: '5vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>Task Details</div>
              <button onClick={() => setTaskModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: THEME.textLow }}>close</span>
              </button>
            </div>

            <div style={fieldWrap}><label style={lbl}>Title *</label>
              <input style={inp} value={taskForm.title || ''} onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div style={fieldWrap}><label style={lbl}>Description</label>
              <textarea style={{ ...inp, minHeight: '70px', resize: 'vertical' }} value={taskForm.description || ''} onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
              <div style={fieldWrap}><label style={lbl}>Column</label>
                <select style={inp} value={taskForm.column_id || ''} onChange={e => setTaskForm(f => ({ ...f, column_id: e.target.value }))}>
                  {boardColumns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div style={fieldWrap}><label style={lbl}>Phase</label>
                <select style={inp} value={taskForm.phase_id || ''} onChange={e => setTaskForm(f => ({ ...f, phase_id: e.target.value || null }))}>
                  <option value="">None</option>
                  {phases.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div style={fieldWrap}><label style={lbl}>Priority</label>
                <select style={inp} value={taskForm.priority || 'medium'} onChange={e => setTaskForm(f => ({ ...f, priority: e.target.value }))}>
                  {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>
              <div style={fieldWrap}><label style={lbl}>Assignee</label>
                <select style={inp} value={taskForm.assigned_to || ''} onChange={e => setTaskForm(f => ({ ...f, assigned_to: e.target.value || null }))}>
                  <option value="">Unassigned</option>
                  {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email || 'Unknown'}</option>)}
                </select>
              </div>
              <div style={fieldWrap}><label style={lbl}>Start Date</label>
                <input style={inp} type="date" value={taskForm.start_date || ''} onChange={e => setTaskForm(f => ({ ...f, start_date: e.target.value }))} />
              </div>
              <div style={fieldWrap}><label style={lbl}>Due Date</label>
                <input style={inp} type="date" value={taskForm.due_date || ''} onChange={e => setTaskForm(f => ({ ...f, due_date: e.target.value }))} />
              </div>
              <div style={fieldWrap}><label style={lbl}>Estimated Hours</label>
                <input style={inp} type="number" value={taskForm.estimated_hours || ''} onChange={e => setTaskForm(f => ({ ...f, estimated_hours: e.target.value }))} />
              </div>
              <div style={fieldWrap}><label style={lbl}>Actual Hours</label>
                <input style={inp} type="number" value={taskForm.actual_hours || ''} onChange={e => setTaskForm(f => ({ ...f, actual_hours: e.target.value }))} />
              </div>
            </div>

            {/* Labels */}
            <div style={fieldWrap}>
              <label style={lbl}>Labels</label>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' }}>
                {(taskForm._labels || []).map(lid => {
                  const l = labels.find(x => x.id === lid)
                  if (!l) return null
                  return (
                    <span key={lid} style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', background: l.color + '20', color: l.color, cursor: 'pointer' }}
                      onClick={() => setTaskForm(f => ({ ...f, _labels: (f._labels || []).filter(x => x !== lid) }))}>
                      {l.name} x
                    </span>
                  )
                })}
                <button onClick={() => setTaskLabelPicker(p => !p)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add</button>
              </div>
              {taskLabelPicker && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', padding: '8px', background: THEME.surfaceVar, borderRadius: '8px' }}>
                  {labels.filter(l => !(taskForm._labels || []).includes(l.id)).map(l => (
                    <span key={l.id} style={{ fontSize: '11px', fontWeight: 600, padding: '3px 8px', borderRadius: '6px', background: l.color + '20', color: l.color, cursor: 'pointer' }}
                      onClick={() => { setTaskForm(f => ({ ...f, _labels: [...(f._labels || []), l.id] })); setTaskLabelPicker(false) }}>
                      {l.name}
                    </span>
                  ))}
                  {labels.filter(l => !(taskForm._labels || []).includes(l.id)).length === 0 && (
                    <span style={{ fontSize: '11px', color: THEME.textLow }}>No more labels</span>
                  )}
                </div>
              )}
            </div>

            {/* Checklist */}
            <div style={fieldWrap}>
              <label style={lbl}>Checklist</label>
              {(taskForm._checklist || []).map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <input type="checkbox" checked={item.checked} onChange={() => toggleChecklistItem(item)}
                    style={{ width: '16px', height: '16px', accentColor: color }} />
                  <span style={{ fontSize: '13px', color: item.checked ? THEME.textLow : THEME.text, textDecoration: item.checked ? 'line-through' : 'none', flex: 1 }}>{item.title}</span>
                  <button onClick={() => deleteChecklistItem(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '14px', color: THEME.textLow }}>close</span>
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                <input style={{ ...inp, flex: 1, padding: '5px 10px', fontSize: '12px' }} placeholder="Add item..."
                  value={checklistInput} onChange={e => setChecklistInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addChecklistItem() }} />
                <button onClick={addChecklistItem} style={{ padding: '5px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Add</button>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
              <button onClick={archiveTask} style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.statusErrorBg, color: THEME.statusErrorText, border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>archive</span>Archive
              </button>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setTaskModal(null)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={saveTask} disabled={taskSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: taskSaving ? 0.6 : 1 }}>{taskSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PHASE MODAL ─────────────────────────────────────────── */}
      {phaseModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setPhaseModal(false) }}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '480px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>{editPhaseId ? 'Edit Phase' : 'Add Phase'}</div>
            <div style={fieldWrap}><label style={lbl}>Name *</label><input style={inp} value={phaseForm.name} onChange={e => setPhaseForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
              <div style={fieldWrap}><label style={lbl}>Status</label><select style={inp} value={phaseForm.status} onChange={e => setPhaseForm(f => ({ ...f, status: e.target.value }))}>
                {PHASE_STATUSES.map(s => <option key={s} value={s}>{PHASE_STATUS_COLORS[s]?.label || s}</option>)}
              </select></div>
              <div style={fieldWrap}><label style={lbl}>Budget</label><input style={inp} type="number" value={phaseForm.budget_allocation} onChange={e => setPhaseForm(f => ({ ...f, budget_allocation: e.target.value }))} /></div>
              <div style={fieldWrap}><label style={lbl}>Start</label><input style={inp} type="date" value={phaseForm.start_date} onChange={e => setPhaseForm(f => ({ ...f, start_date: e.target.value }))} /></div>
              <div style={fieldWrap}><label style={lbl}>End</label><input style={inp} type="date" value={phaseForm.end_date} onChange={e => setPhaseForm(f => ({ ...f, end_date: e.target.value }))} /></div>
            </div>
            <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" checked={phaseForm.is_milestone} onChange={e => setPhaseForm(f => ({ ...f, is_milestone: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: color }} />
              <label style={{ fontSize: '13px', color: THEME.text }}>This is a milestone</label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
              <div>{editPhaseId && <button onClick={deletePhase} style={{ padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.statusErrorBg, color: THEME.statusErrorText, border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit' }}>Remove</button>}</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setPhaseModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <button onClick={savePhase} disabled={phaseSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: phaseSaving ? 0.6 : 1 }}>{phaseSaving ? 'Saving...' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MEMBER MODAL ────────────────────────────────────────── */}
      {memberModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setMemberModal(false) }}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '400px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>Add Team Member</div>
            <div style={fieldWrap}><label style={lbl}>User</label><select style={inp} value={memberForm.user_id} onChange={e => setMemberForm(f => ({ ...f, user_id: e.target.value }))}>
              <option value="">-- Select --</option>
              {siteUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select></div>
            <div style={fieldWrap}><label style={lbl}>Role</label><select style={inp} value={memberForm.role} onChange={e => setMemberForm(f => ({ ...f, role: e.target.value }))}>
              {MEMBER_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setMemberModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={addMember} disabled={memberSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: memberSaving ? 0.6 : 1 }}>{memberSaving ? 'Adding...' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LABEL MODAL ─────────────────────────────────────────── */}
      {labelModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.45)' }}
          onClick={e => { if (e.target === e.currentTarget) setLabelModal(false) }}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '400px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>Add Label</div>
            <div style={fieldWrap}><label style={lbl}>Name</label><input style={inp} value={labelForm.name} onChange={e => setLabelForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Safety, Electrical, Urgent" /></div>
            <div style={fieldWrap}>
              <label style={lbl}>Color</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {LABEL_COLORS.map(c => (
                  <div key={c} onClick={() => setLabelForm(f => ({ ...f, color: c }))} style={{
                    width: '28px', height: '28px', borderRadius: '8px', background: c, cursor: 'pointer',
                    border: labelForm.color === c ? '3px solid ' + THEME.text : '2px solid transparent',
                  }} />
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setLabelModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={addLabel} disabled={labelSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: labelSaving ? 0.6 : 1 }}>{labelSaving ? 'Adding...' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
