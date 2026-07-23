import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { showToast, Icon, ModalOverlay } from '../../components/ui'
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
  const [siteEmployees, setSiteEmployees] = useState([])

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
  const [boardView, setBoardView] = useState('table')
  const [checklistInput, setChecklistInput] = useState('')
  const [taskLabelPicker, setTaskLabelPicker] = useState(false)
  const [taskDeps, setTaskDeps] = useState([])
  const [depPicker, setDepPicker] = useState(false)
  const dragItem = useRef(null)
  const dragOverCol = useRef(null)

  // Areas state
  const [projectAreas, setProjectAreas] = useState([])
  const [areaCodes, setAreaCodes] = useState([])
  const [areaModal, setAreaModal] = useState(false)
  const [areaForm, setAreaForm] = useState({ area_code_id: '', responsible_engineer_id: '', planned_budget: '', description: '', target_start_date: '', target_end_date: '' })
  const [editAreaId, setEditAreaId] = useState(null)
  const [areaSaving, setAreaSaving] = useState(false)

  // Activity state
  const [activity, setActivity] = useState([])
  const [activityLoading, setActivityLoading] = useState(false)

  // Cost/EVM state
  const [costItems, setCostItems] = useState([])
  const [changeOrders, setChangeOrders] = useState([])
  const [progressData, setProgressData] = useState([])
  const [evmResult, setEvmResult] = useState(null)
  const [evmLoading, setEvmLoading] = useState(false)
  const [costModal, setCostModal] = useState(false)
  const [editCostId, setEditCostId] = useState(null)
  const [costForm, setCostForm] = useState({ cbs_code: '', description: '', cost_type: 'direct', category: 'materials', budgeted_cost: '', committed_cost: '', actual_cost: '', estimate_to_complete: '' })
  const [costSaving, setCostSaving] = useState(false)
  const [coModal, setCoModal] = useState(false)
  const [editCoId, setEditCoId] = useState(null)
  const [coForm, setCoForm] = useState({ change_order_number: '', title: '', description: '', status: 'draft', impact_type: 'cost', cost_impact: '', schedule_impact_days: '', notes: '' })
  const [coSaving, setCoSaving] = useState(false)
  const [costTab, setCostTab] = useState('evm')

  // Schedule/CPM state
  const [baselines, setBaselines] = useState([])
  const [baselineModal, setBaselineModal] = useState(false)
  const [baselineName, setBaselineName] = useState('')
  const [baselineSaving, setBaselineSaving] = useState(false)
  const [cpmResult, setCpmResult] = useState(null)
  const [cpmLoading, setCpmLoading] = useState(false)
  const [selectedBaseline, setSelectedBaseline] = useState(null)
  const [baselineSnapshots, setBaselineSnapshots] = useState([])

  useRealtimeSubscription('project_phases', { column: 'project_id', value: projectId }, fetchAll)
  useRealtimeSubscription('project_members', { column: 'project_id', value: projectId }, fetchAll)

  async function fetchAll() {
    if (!projectId) return
    setLoading(true)
    const [pRes, phRes, mRes, lRes] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('project_phases').select('*').eq('project_id', projectId).order('sequence'),
      supabase.from('project_members').select('*').eq('project_id', projectId).eq('is_active', true),
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
    const [profRes, empRes] = await Promise.all([
      supabase.from('profiles').select('id, username, full_name').order('full_name'),
      supabase.from('employees').select('id, name, employee_number, position_title').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
    ])
    setSiteUsers(profRes.data || [])
    setSiteEmployees(empRes.data || [])
  }

  async function fetchAreas() {
    if (!projectId) return
    const [paRes, acRes] = await Promise.all([
      supabase.from('project_areas').select('*, area_code:area_codes(code, name, color, discipline), engineer:profiles!project_areas_responsible_engineer_id_fkey(full_name)').eq('project_id', projectId).order('sort_order'),
      supabase.from('area_codes').select('*').eq('is_active', true).order('sort_order').order('code'),
    ])
    setProjectAreas(paRes.data || [])
    setAreaCodes(acRes.data || [])
  }

  async function fetchActivity() {
    if (!projectId) return
    setActivityLoading(true)
    const { data } = await supabase.from('project_activity')
      .select('*, actor:profiles!project_activity_actor_id_fkey(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(100)
    setActivity(data || [])
    setActivityLoading(false)
  }

  async function fetchCostData() {
    if (!projectId) return
    const [ciRes, coRes, prRes] = await Promise.all([
      supabase.from('project_cost_items').select('*').eq('project_id', projectId).eq('is_archived', false).order('cbs_code'),
      supabase.from('project_change_orders').select('*, requester:profiles!project_change_orders_requested_by_fkey(full_name)').eq('project_id', projectId).eq('is_archived', false).order('created_at', { ascending: false }),
      supabase.from('project_progress').select('*').eq('project_id', projectId).order('reporting_date', { ascending: false }).limit(24),
    ])
    setCostItems(ciRes.data || [])
    setChangeOrders(coRes.data || [])
    setProgressData(prRes.data || [])
  }

  async function runEvm() {
    setEvmLoading(true)
    try {
      const { data, error } = await supabase.rpc('rpc_calculate_evm', { p_project_id: projectId })
      if (error) throw error
      setEvmResult(data)
      showToast('EVM calculated', 'green')
    } catch (err) { showToast(err.message, 'red') }
    setEvmLoading(false)
  }

  async function saveCostItem() {
    if (!costForm.cbs_code.trim() || !costForm.description.trim()) { showToast('CBS code and description required', 'red'); return }
    setCostSaving(true)
    try {
      const payload = {
        project_id: projectId, cbs_code: costForm.cbs_code.trim().toUpperCase(),
        description: costForm.description.trim(), cost_type: costForm.cost_type, category: costForm.category,
        budgeted_cost: parseFloat(costForm.budgeted_cost) || 0,
        committed_cost: parseFloat(costForm.committed_cost) || 0,
        actual_cost: parseFloat(costForm.actual_cost) || 0,
        estimate_to_complete: parseFloat(costForm.estimate_to_complete) || 0,
        estimate_at_completion: (parseFloat(costForm.actual_cost) || 0) + (parseFloat(costForm.estimate_to_complete) || 0),
      }
      if (editCostId) {
        const { error } = await supabase.from('project_cost_items').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editCostId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('project_cost_items').insert(payload)
        if (error) throw error
      }
      showToast(editCostId ? 'Cost item updated' : 'Cost item added', 'green')
      setCostModal(false)
      fetchCostData()
    } catch (err) { showToast(err.message, 'red') }
    setCostSaving(false)
  }

  async function archiveCostItem(id) {
    if (!confirm('Archive this cost item?')) return
    await supabase.from('project_cost_items').update({ is_archived: true }).eq('id', id)
    showToast('Cost item archived', 'green')
    fetchCostData()
  }

  async function saveChangeOrder() {
    if (!coForm.title.trim() || !coForm.change_order_number.trim()) { showToast('CO number and title required', 'red'); return }
    setCoSaving(true)
    try {
      const payload = {
        project_id: projectId, change_order_number: coForm.change_order_number.trim().toUpperCase(),
        title: coForm.title.trim(), description: coForm.description || null,
        status: coForm.status, impact_type: coForm.impact_type,
        cost_impact: parseFloat(coForm.cost_impact) || 0,
        schedule_impact_days: parseInt(coForm.schedule_impact_days) || 0,
        notes: coForm.notes || null,
        requested_by: editCoId ? undefined : profile?.id,
        requested_date: editCoId ? undefined : new Date().toISOString().slice(0, 10),
        approved_by: coForm.status === 'approved' ? profile?.id : null,
        approved_date: coForm.status === 'approved' ? new Date().toISOString().slice(0, 10) : null,
      }
      if (editCoId) {
        const { error } = await supabase.from('project_change_orders').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editCoId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('project_change_orders').insert(payload)
        if (error) throw error
      }
      showToast(editCoId ? 'Change order updated' : 'Change order created', 'green')
      setCoModal(false)
      fetchCostData()
    } catch (err) { showToast(err.message, 'red') }
    setCoSaving(false)
  }

  async function fetchBaselines() {
    if (!projectId) return
    const { data } = await supabase.from('project_baselines').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
    setBaselines(data || [])
  }

  async function saveBaseline() {
    if (!baselineName.trim()) { showToast('Name is required', 'red'); return }
    setBaselineSaving(true)
    try {
      const { data, error } = await supabase.rpc('rpc_save_baseline', { p_project_id: projectId, p_name: baselineName.trim() })
      if (error) throw error
      showToast('Baseline saved', 'green')
      setBaselineModal(false)
      setBaselineName('')
      fetchBaselines()
    } catch (err) { showToast(err.message, 'red') }
    setBaselineSaving(false)
  }

  async function runCpm() {
    setCpmLoading(true)
    try {
      const { data, error } = await supabase.rpc('rpc_calculate_cpm', { p_project_id: projectId })
      if (error) throw error
      setCpmResult(data)
      showToast(`CPM complete — ${data.critical_path?.length || 0} critical tasks, ${data.project_duration || 0} day duration`, 'green')
      await fetchBoard()
    } catch (err) { showToast(err.message, 'red') }
    setCpmLoading(false)
  }

  async function viewBaseline(bl) {
    setSelectedBaseline(bl)
    const { data } = await supabase.from('baseline_task_snapshots').select('*').eq('baseline_id', bl.id).order('task_id')
    setBaselineSnapshots(data || [])
  }

  function generateWbs(task) {
    const area = projectAreas.find(pa => pa.area_code_id === task.area_id)
    const areaCode = area?.area_code?.code || 'GEN'
    const siblings = boardTasks.filter(t => t.area_id === task.area_id && !t.parent_task_id && t.id !== task.id)
    if (task.parent_task_id) {
      const parent = boardTasks.find(t => t.id === task.parent_task_id)
      const parentWbs = parent?.wbs_code || areaCode
      const childSiblings = boardTasks.filter(t => t.parent_task_id === task.parent_task_id && t.id !== task.id)
      return `${parentWbs}.${String(childSiblings.length + 1).padStart(2, '0')}`
    }
    return `${areaCode}-${String(siblings.length + 1).padStart(3, '0')}`
  }

  useEffect(() => { fetchAll(); fetchSiteUsers(); fetchAreas() }, [projectId, currentSiteId])
  useEffect(() => { if (tab === 'activity') fetchActivity() }, [tab, projectId])
  useEffect(() => { if (tab === 'schedule') { fetchBaselines(); fetchBoard() } }, [tab, projectId])
  useEffect(() => { if (tab === 'costs') { fetchCostData(); runEvm() } }, [tab, projectId])

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

  useEffect(() => { if (tab === 'board' || tab === 'overview') fetchBoard() }, [tab, fetchBoard])

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

  async function openTaskModal(task) {
    const tl = taskLabels.filter(x => x.task_id === task.id).map(x => x.label_id)
    const cl = taskChecklists.filter(x => x.task_id === task.id)
    setTaskForm({
      ...task,
      _labels: tl,
      _checklist: cl,
    })
    setTaskLabelPicker(false)
    setChecklistInput('')
    setDepPicker(false)
    setTaskModal(task.id)
    const { data } = await supabase.from('project_task_dependencies').select('*').or(`task_id.eq.${task.id},depends_on_id.eq.${task.id}`)
    setTaskDeps(data || [])
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
        parent_task_id: taskForm.parent_task_id || null, area_id: taskForm.area_id || null,
        wbs_code: taskForm.wbs_code || generateWbs(taskForm),
        actual_start: taskForm.actual_start || null, actual_end: taskForm.actual_end || null,
        planned_duration: taskForm.planned_duration ? parseInt(taskForm.planned_duration) : null,
        percent_complete: taskForm.percent_complete ? parseInt(taskForm.percent_complete) : 0,
        is_milestone: !!taskForm.is_milestone,
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

  async function archiveProject() {
    if (!confirm('Archive this project? It will be hidden from the project list.')) return
    await supabase.from('projects').update({ is_archived: true, archived_at: new Date().toISOString() }).eq('id', projectId)
    showToast('Project archived', 'green')
    setPage('pj_projects')
  }

  function exportMSProjectXML() {
    const tasks = [...boardTasks].sort((a, b) => a.position - b.position)
    const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const fmtDate = d => d ? new Date(d).toISOString().replace('Z', '') : ''
    const fmtDur = days => `PT${(days || 1) * 8}H0M0S`

    let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`
    xml += `<Project xmlns="http://schemas.microsoft.com/project">\n`
    xml += `  <Name>${esc(project.name)}</Name>\n`
    xml += `  <StartDate>${fmtDate(project.start_date)}</StartDate>\n`
    xml += `  <FinishDate>${fmtDate(project.target_end_date)}</FinishDate>\n`
    xml += `  <CalendarUID>1</CalendarUID>\n`
    xml += `  <Calendars>\n`
    xml += `    <Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar></Calendar>\n`
    xml += `  </Calendars>\n`
    xml += `  <Tasks>\n`

    const assignees = new Map()
    tasks.forEach((t, i) => {
      const uid = i + 1
      const col = boardColumns.find(c => c.id === t.column_id)
      const pctDone = t.percent_complete || 0
      xml += `    <Task>\n`
      xml += `      <UID>${uid}</UID>\n`
      xml += `      <ID>${uid}</ID>\n`
      xml += `      <Name>${esc(t.title)}</Name>\n`
      xml += `      <Active>1</Active>\n`
      xml += `      <IsNull>0</IsNull>\n`
      if (t.wbs_code) xml += `      <WBS>${esc(t.wbs_code)}</WBS>\n`
      xml += `      <Start>${fmtDate(t.start_date || t.actual_start)}</Start>\n`
      xml += `      <Finish>${fmtDate(t.due_date || t.actual_end)}</Finish>\n`
      xml += `      <Duration>${fmtDur(t.planned_duration)}</Duration>\n`
      xml += `      <PercentComplete>${pctDone}</PercentComplete>\n`
      if (t.actual_start) xml += `      <ActualStart>${fmtDate(t.actual_start)}</ActualStart>\n`
      if (t.actual_end) xml += `      <ActualFinish>${fmtDate(t.actual_end)}</ActualFinish>\n`
      if (t.is_milestone) xml += `      <Milestone>1</Milestone>\n`
      if (t.is_critical) xml += `      <Critical>1</Critical>\n`
      if (t.priority) {
        const pMap = { low: 100, medium: 500, high: 700, critical: 900 }
        xml += `      <Priority>${pMap[t.priority] || 500}</Priority>\n`
      }
      if (t.notes) xml += `      <Notes>${esc(t.notes)}</Notes>\n`
      xml += `    </Task>\n`
      if (t.assigned_to && !assignees.has(t.assigned_to)) {
        assignees.set(t.assigned_to, assignees.size + 1)
      }
    })
    xml += `  </Tasks>\n`

    xml += `  <Resources>\n`
    assignees.forEach((rUid, aId) => {
      xml += `    <Resource><UID>${rUid}</UID><ID>${rUid}</ID><Name>${esc(userName(aId))}</Name></Resource>\n`
    })
    xml += `  </Resources>\n`

    xml += `  <Assignments>\n`
    tasks.forEach((t, i) => {
      if (t.assigned_to && assignees.has(t.assigned_to)) {
        xml += `    <Assignment><UID>${i + 1}</UID><TaskUID>${i + 1}</TaskUID><ResourceUID>${assignees.get(t.assigned_to)}</ResourceUID></Assignment>\n`
      }
    })
    xml += `  </Assignments>\n`
    xml += `</Project>`

    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.project_code || 'project'}_${project.name?.replace(/\s+/g, '_') || 'export'}.xml`
    a.click()
    URL.revokeObjectURL(url)
    showToast('MS Project XML exported', 'green')
  }

  function exportCSV() {
    const tasks = [...boardTasks].sort((a, b) => a.position - b.position)
    const col = id => boardColumns.find(c => c.id === id)?.name || ''
    const headers = ['#', 'Task', 'Status', 'Duration (days)', 'Start', 'Finish', 'Actual Start', 'Actual Finish', '% Complete', 'Assigned To', 'Priority', 'WBS']
    const rows = tasks.map((t, i) => [
      i + 1, `"${(t.title || '').replace(/"/g, '""')}"`, col(t.column_id),
      t.planned_duration || '', t.start_date || '', t.due_date || '',
      t.actual_start || '', t.actual_end || '', t.percent_complete || 0,
      `"${userName(t.assigned_to)}"`, t.priority || '', t.wbs_code || ''
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.project_code || 'project'}_tasks.csv`
    a.click()
    URL.revokeObjectURL(url)
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

  async function addDependency(depTaskId, type) {
    const { error } = await supabase.from('project_task_dependencies').insert({
      task_id: taskForm.id, depends_on_id: depTaskId, dependency_type: type,
    })
    if (error) { showToast(error.message, 'red'); return }
    const { data } = await supabase.from('project_task_dependencies').select('*').or(`task_id.eq.${taskForm.id},depends_on_id.eq.${taskForm.id}`)
    setTaskDeps(data || [])
    setDepPicker(false)
  }

  async function removeDependency(depId) {
    await supabase.from('project_task_dependencies').delete().eq('id', depId)
    setTaskDeps(prev => prev.filter(d => d.id !== depId))
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

  function userName(userId) {
    const u = siteUsers.find(x => x.id === userId)
    if (u) return u.full_name || u.username || 'Unknown'
    const e = siteEmployees.find(x => x.id === userId)
    return e?.name || 'Unknown'
  }

  function isEmployee(userId) {
    return siteEmployees.some(x => x.id === userId)
  }

  function getInitials(userId) {
    const name = userName(userId)
    if (name === 'Unknown') return '?'
    const parts = name.split(/\s/)
    return (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase()
  }

  // Area CRUD
  function openAddArea() {
    setEditAreaId(null)
    setAreaForm({ area_code_id: '', responsible_engineer_id: '', planned_budget: '', description: '', target_start_date: '', target_end_date: '' })
    setAreaModal(true)
  }
  function openEditArea(a) {
    setEditAreaId(a.id)
    setAreaForm({
      area_code_id: a.area_code_id, responsible_engineer_id: a.responsible_engineer_id || '',
      planned_budget: a.planned_budget || '', description: a.description || '',
      target_start_date: a.target_start_date || '', target_end_date: a.target_end_date || '',
    })
    setAreaModal(true)
  }
  async function saveArea() {
    if (!areaForm.area_code_id) { showToast('Select an area code', 'red'); return }
    setAreaSaving(true)
    try {
      const payload = {
        project_id: projectId, area_code_id: areaForm.area_code_id,
        responsible_engineer_id: areaForm.responsible_engineer_id || null,
        planned_budget: parseFloat(areaForm.planned_budget) || 0,
        current_budget: parseFloat(areaForm.planned_budget) || 0,
        description: areaForm.description || null,
        target_start_date: areaForm.target_start_date || null,
        target_end_date: areaForm.target_end_date || null,
        sort_order: projectAreas.length * 10,
      }
      if (editAreaId) {
        const { error } = await supabase.from('project_areas').update(payload).eq('id', editAreaId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('project_areas').insert(payload)
        if (error) throw error
      }
      showToast(editAreaId ? 'Area updated' : 'Area added', 'green')
      setAreaModal(false)
      fetchAreas()
    } catch (err) { showToast(err.message, 'red') }
    setAreaSaving(false)
  }
  async function removeArea(areaId) {
    if (!confirm('Remove this area from the project?')) return
    const { error } = await supabase.from('project_areas').delete().eq('id', areaId)
    if (error) showToast(error.message, 'red')
    else { showToast('Area removed', 'green'); fetchAreas() }
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
    { id: 'areas', label: 'Areas', icon: 'location_city' },
    { id: 'phases', label: 'Phases', icon: 'timeline' },
    { id: 'team', label: 'Team', icon: 'group' },
    { id: 'labels', label: 'Labels', icon: 'label' },
    { id: 'board', label: 'Board', icon: 'view_kanban' },
    { id: 'schedule', label: 'Schedule', icon: 'event_note' },
    { id: 'costs', label: 'Costs & EVM', icon: 'payments' },
    { id: 'activity', label: 'Activity', icon: 'forum' },
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            {can('projects.delete') && (
              <button onClick={archiveProject} title="Archive project" style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 600,
                background: '#FFEBEE', color: '#C62828', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>archive</span>
                Archive
              </button>
            )}
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
      {tab === 'overview' && (() => {
        const totalTasks = boardTasks.length
        const doneTasks = boardTasks.filter(t => t.percent_complete === 100 || boardColumns.find(c => c.id === t.column_id)?.is_done_column).length
        const inProgressTasks = boardTasks.filter(t => (t.percent_complete || 0) > 0 && (t.percent_complete || 0) < 100 && !boardColumns.find(c => c.id === t.column_id)?.is_done_column).length
        const overdueTasks = boardTasks.filter(t => t.due_date && new Date(t.due_date) < new Date() && !t.completed_date).length
        const avgPct = totalTasks > 0 ? Math.round(boardTasks.reduce((s, t) => s + (t.percent_complete || 0), 0) / totalTasks) : 0
        return (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '20px' }}>
            <KpiCard label="Total Tasks" value={totalTasks} icon="task" accent={color} />
            <KpiCard label="Completed" value={doneTasks} icon="task_alt" accent="#2E7D32" />
            <KpiCard label="In Progress" value={inProgressTasks} icon="pending" accent="#1565C0" />
            <KpiCard label="Overdue" value={overdueTasks} icon="warning" accent={overdueTasks > 0 ? '#C62828' : '#999'} />
            <KpiCard label="Avg Progress" value={`${avgPct}%`} icon="speed" accent="#E65100" />
            <KpiCard label="Days Elapsed" value={daysElapsed} icon="schedule" accent="#00838F" />
            {daysRemaining !== null && (
              <KpiCard label="Days Left" value={Math.max(0, daysRemaining)} icon="timer" accent={daysRemaining < 0 ? '#C62828' : '#6A1B9A'} />
            )}
          </div>

          {project.description && (
            <DashCard style={{ marginBottom: '16px' }}>
              <SectionTitle title="Description" />
              <div style={{ fontSize: '13px', color: THEME.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{project.description}</div>
            </DashCard>
          )}

          {/* Overall progress bar */}
          <DashCard style={{ marginBottom: '16px' }}>
            <SectionTitle title="Overall Progress" subtitle={`${doneTasks}/${totalTasks} tasks complete`} />
            <div style={{ height: '10px', borderRadius: '5px', background: THEME.outlineVar, overflow: 'hidden', marginBottom: '8px' }}>
              <div style={{ height: '100%', width: `${avgPct}%`, background: avgPct >= 100 ? '#2E7D32' : color, borderRadius: '5px', transition: 'width 0.3s' }} />
            </div>
          </DashCard>

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

          {/* Assignee summary */}
          {(() => {
            const assigneeMap = new Map()
            boardTasks.forEach(t => {
              if (!t.assigned_to) return
              if (!assigneeMap.has(t.assigned_to)) assigneeMap.set(t.assigned_to, { total: 0, done: 0 })
              const a = assigneeMap.get(t.assigned_to)
              a.total++
              if (t.percent_complete === 100 || boardColumns.find(c => c.id === t.column_id)?.is_done_column) a.done++
            })
            if (assigneeMap.size === 0) return null
            return (
              <DashCard>
                <SectionTitle title="By Assignee" />
                {[...assigneeMap.entries()].map(([aId, a]) => (
                  <ProgressRow key={aId} label={userName(aId)} value={`${a.done}/${a.total}`} pct={Math.round(a.done / a.total * 100)} color={color} />
                ))}
              </DashCard>
            )
          })()}
        </>
        )
      })()}

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
                        {userName(m.user_id)[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{userName(m.user_id)}</div>
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
          {/* Toolbar */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* View toggle */}
              <div style={{ display: 'flex', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${THEME.outlineVar}` }}>
                {[{ id: 'table', icon: 'table_rows', tip: 'Table' }, { id: 'board', icon: 'view_kanban', tip: 'Board' }].map(v => (
                  <button key={v.id} title={v.tip} onClick={() => setBoardView(v.id)} style={{
                    display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 10px', fontSize: '12px', fontWeight: 600,
                    background: boardView === v.id ? color : 'transparent', color: boardView === v.id ? '#fff' : THEME.textMed,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '15px' }}>{v.icon}</span>
                    {v.tip}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed }}>Filter:</span>
              <select style={{ ...inp, width: 'auto', padding: '5px 10px', fontSize: '12px' }} value={boardFilter.priority} onChange={e => setBoardFilter(f => ({ ...f, priority: e.target.value }))}>
                <option value="">All Priorities</option>
                {PRIORITIES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
              <select style={{ ...inp, width: 'auto', padding: '5px 10px', fontSize: '12px' }} value={boardFilter.assignee} onChange={e => setBoardFilter(f => ({ ...f, assignee: e.target.value }))}>
                <option value="">All Assignees</option>
                {siteEmployees.filter(e => boardTasks.some(t => t.assigned_to === e.id)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                {members.map(m => <option key={m.user_id} value={m.user_id}>{userName(m.user_id)}</option>)}
              </select>
              {(boardFilter.priority || boardFilter.assignee || boardFilter.label) && (
                <button onClick={() => setBoardFilter({ label: '', assignee: '', priority: '' })} style={{ background: 'none', border: 'none', color: THEME.textLow, cursor: 'pointer', fontSize: '11px', fontFamily: 'inherit' }}>Clear</button>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={exportCSV} style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px',
                fontSize: '11px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed,
                border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>download</span>CSV
              </button>
              <button onClick={exportMSProjectXML} style={{
                display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px',
                fontSize: '11px', fontWeight: 600, background: '#1B5E20', color: '#fff',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>file_download</span>MS Project
              </button>
            </div>
          </div>

          {boardLoading ? (
            <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
              <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
            </div>
          ) : boardView === 'table' ? (
            <DashCard>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                      {['#', 'Task Description', 'Status', 'Duration', 'Start', 'Finish', 'Actual Start', 'Actual Finish', '% Complete', 'Responsible Person'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: THEME.textMed, whiteSpace: 'nowrap', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.sort((a, b) => a.position - b.position).map((t, i) => {
                      const col = boardColumns.find(c => c.id === t.column_id)
                      const colName = col?.name || '—'
                      const isOverdue = t.due_date && new Date(t.due_date) < new Date() && !t.completed_date
                      const pct = t.percent_complete || 0
                      const statusColor = col?.is_done_column ? '#2E7D32' : pct > 0 ? '#1565C0' : isOverdue ? '#C62828' : THEME.textLow
                      return (
                        <tr key={t.id} onClick={() => openTaskModal(t)} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', background: col?.is_done_column ? '#F1F8E9' : isOverdue ? '#FFF8E1' : 'transparent' }}>
                          <td style={{ padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px' }}>{i + 1}</td>
                          <td style={{ padding: '8px 10px', color: THEME.text, fontWeight: 600, maxWidth: '300px' }}>{t.title}</td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: statusColor + '18', color: statusColor, whiteSpace: 'nowrap' }}>{colName}</span>
                          </td>
                          <td style={{ padding: '8px 10px', color: THEME.textMed, textAlign: 'center' }}>{t.planned_duration ? `${t.planned_duration}d` : '—'}</td>
                          <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.start_date || '—'}</td>
                          <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.due_date || '—'}</td>
                          <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.actual_start || '—'}</td>
                          <td style={{ padding: '8px 10px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{t.actual_end || '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: '80px' }}>
                              <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: THEME.outlineVar, overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? '#2E7D32' : pct >= 50 ? '#1565C0' : '#FF9800', borderRadius: '3px' }} />
                              </div>
                              <span style={{ fontSize: '11px', fontWeight: 700, color: pct >= 100 ? '#2E7D32' : THEME.text, minWidth: '30px' }}>{pct}%</span>
                            </div>
                          </td>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                            {t.assigned_to ? (
                              <span onClick={isEmployee(t.assigned_to) ? (e) => { e.stopPropagation(); setPage('wf_employee_detail', t.assigned_to) } : undefined}
                                style={{ fontSize: '12px', fontWeight: 600, color: isEmployee(t.assigned_to) ? color : THEME.text, cursor: isEmployee(t.assigned_to) ? 'pointer' : 'default', textDecoration: isEmployee(t.assigned_to) ? 'underline' : 'none' }}>
                                {userName(t.assigned_to)}
                              </span>
                            ) : <span style={{ color: THEME.textLow }}>—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: `2px solid ${THEME.outlineVar}`, fontWeight: 700 }}>
                      <td colSpan={3} style={{ padding: '8px 10px', color: THEME.text, fontSize: '12px' }}>Total: {filteredTasks.length} tasks</td>
                      <td style={{ padding: '8px 10px', color: THEME.textMed, textAlign: 'center', fontSize: '12px' }}>{filteredTasks.reduce((s, t) => s + (t.planned_duration || 0), 0)}d</td>
                      <td colSpan={4} />
                      <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: color }}>{filteredTasks.length > 0 ? Math.round(filteredTasks.reduce((s, t) => s + (t.percent_complete || 0), 0) / filteredTasks.length) : 0}%</span>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </DashCard>
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
                      {colTasks.filter(t => !t.parent_task_id).map(task => {
                        const subtasks = colTasks.filter(t => t.parent_task_id === task.id)
                        const renderCard = (t, indent) => {
                          const tLabels = taskLabels.filter(x => x.task_id === t.id)
                          const tChecklist = taskChecklists.filter(x => x.task_id === t.id)
                          const checkedCount = tChecklist.filter(c => c.checked).length
                          const isOverdue = t.due_date && new Date(t.due_date) < new Date() && !t.completed_date
                          const childCount = boardTasks.filter(bt => bt.parent_task_id === t.id).length
                          return (
                            <div key={t.id} draggable={can('projects.edit')} onDragStart={e => handleDragStart(e, t)}
                              onClick={() => openTaskModal(t)}
                              style={{
                                background: THEME.surface, borderRadius: '10px', padding: '10px 12px',
                                cursor: 'pointer', borderLeft: `4px solid ${PRIORITY_COLORS[t.priority] || '#999'}`,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.08)', transition: 'box-shadow 0.15s',
                                marginLeft: indent ? '16px' : '0',
                              }}
                            >
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
                              <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '6px', lineHeight: 1.3 }}>{t.title}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                {t.due_date && (
                                  <span style={{ fontSize: '10px', fontWeight: 600, color: isOverdue ? '#C62828' : THEME.textLow, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>calendar_today</span>
                                    {t.due_date}
                                  </span>
                                )}
                                {tChecklist.length > 0 && (
                                  <span style={{ fontSize: '10px', fontWeight: 600, color: checkedCount === tChecklist.length ? '#2E7D32' : THEME.textLow, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>checklist</span>
                                    {checkedCount}/{tChecklist.length}
                                  </span>
                                )}
                                {childCount > 0 && (
                                  <span style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, display: 'flex', alignItems: 'center', gap: '2px' }}>
                                    <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>account_tree</span>
                                    {childCount}
                                  </span>
                                )}
                                {t.is_critical && (
                                  <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: '#FFEBEE', color: '#C62828' }}>CP</span>
                                )}
                                <div style={{ flex: 1 }} />
                                {t.assigned_to && (
                                  <div
                                    title={userName(t.assigned_to)}
                                    onClick={isEmployee(t.assigned_to) ? (e) => { e.stopPropagation(); setPage('wf_employee_detail', t.assigned_to) } : undefined}
                                    style={{
                                      width: '22px', height: '22px', borderRadius: '50%',
                                      background: color + '20', color: color,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontSize: '9px', fontWeight: 700,
                                      cursor: isEmployee(t.assigned_to) ? 'pointer' : 'default',
                                    }}>{getInitials(t.assigned_to)}</div>
                                )}
                              </div>
                            </div>
                          )
                        }
                        return (
                          <div key={task.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {renderCard(task, false)}
                            {subtasks.map(st => renderCard(st, true))}
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

      {/* ── AREAS TAB ────────────────────────────────────────────── */}
      {tab === 'areas' && (
        <div>
          {can('projects.edit') && (
            <div style={{ marginBottom: '14px' }}>
              <button onClick={openAddArea} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '10px', border: `1px dashed ${THEME.outline}`, background: 'transparent', color, cursor: 'pointer', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span> Add Area
              </button>
            </div>
          )}
          {projectAreas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: THEME.textLow, fontSize: '14px' }}>No areas assigned. Add area codes to organize work by area.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {projectAreas.map(a => (
                <div key={a.id} onClick={() => can('projects.edit') && openEditArea(a)} style={{ background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', cursor: 'pointer' }}>
                  <div style={{ height: '5px', background: a.area_code?.color || color }} />
                  <div style={{ padding: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: (a.area_code?.color || color) + '18', color: a.area_code?.color || color, fontWeight: 800, fontSize: '12px' }}>{a.area_code?.code}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{a.area_code?.name}</div>
                        {a.area_code?.discipline && <div style={{ fontSize: '11px', color: THEME.textMed }}>{a.area_code.discipline}</div>}
                      </div>
                      {can('projects.edit') && <button onClick={e => { e.stopPropagation(); removeArea(a.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><span className="material-symbols-rounded" style={{ fontSize: '16px', color: THEME.textLow }}>close</span></button>}
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: THEME.textMed }}>
                      {a.engineer?.full_name && <span><span className="material-symbols-rounded" style={{ fontSize: '14px', verticalAlign: 'middle' }}>person</span> {a.engineer.full_name}</span>}
                      {a.planned_budget > 0 && <span><span className="material-symbols-rounded" style={{ fontSize: '14px', verticalAlign: 'middle' }}>payments</span> {fmtMoney(a.planned_budget)}</span>}
                    </div>
                    {(a.target_start_date || a.target_end_date) && (
                      <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '6px' }}>
                        {a.target_start_date || '?'} — {a.target_end_date || '?'}
                      </div>
                    )}
                    {a.percent_complete > 0 && (
                      <div style={{ marginTop: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: THEME.textMed, marginBottom: '3px' }}><span>Progress</span><span>{a.percent_complete}%</span></div>
                        <div style={{ height: '4px', borderRadius: '2px', background: THEME.outlineVar }}><div style={{ height: '100%', borderRadius: '2px', background: a.area_code?.color || color, width: `${a.percent_complete}%` }} /></div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {areaModal && (
            <ModalOverlay onClose={() => setAreaModal(false)} dirty={true}>
              <div style={{ background: THEME.surface, borderRadius: '18px', padding: '24px', width: '480px', maxWidth: '95vw', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
                <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '16px', color: THEME.text }}>{editAreaId ? 'Edit Area' : 'Add Area'}</div>
                <div style={fieldWrap}><label style={lbl}>Area Code *</label>
                  <select style={inp} value={areaForm.area_code_id} onChange={e => setAreaForm(f => ({ ...f, area_code_id: e.target.value }))}>
                    <option value="">— Select —</option>
                    {areaCodes.filter(ac => !projectAreas.some(pa => pa.area_code_id === ac.id) || ac.id === areaForm.area_code_id).map(ac => <option key={ac.id} value={ac.id}>{ac.code} — {ac.name}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}><label style={lbl}>Responsible Engineer</label>
                  <select style={inp} value={areaForm.responsible_engineer_id} onChange={e => setAreaForm(f => ({ ...f, responsible_engineer_id: e.target.value }))}>
                    <option value="">— None —</option>
                    {siteUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={fieldWrap}><label style={lbl}>Planned Budget</label><input type="number" style={inp} value={areaForm.planned_budget} onChange={e => setAreaForm(f => ({ ...f, planned_budget: e.target.value }))} /></div>
                  <div />
                  <div style={fieldWrap}><label style={lbl}>Start Date</label><input type="date" style={inp} value={areaForm.target_start_date} onChange={e => setAreaForm(f => ({ ...f, target_start_date: e.target.value }))} /></div>
                  <div style={fieldWrap}><label style={lbl}>End Date</label><input type="date" style={inp} value={areaForm.target_end_date} onChange={e => setAreaForm(f => ({ ...f, target_end_date: e.target.value }))} /></div>
                </div>
                <div style={fieldWrap}><label style={lbl}>Description</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={areaForm.description} onChange={e => setAreaForm(f => ({ ...f, description: e.target.value }))} /></div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                  <button onClick={() => setAreaModal(false)} style={{ padding: '8px 16px', borderRadius: '10px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px' }}>Cancel</button>
                  <button onClick={saveArea} disabled={areaSaving} style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', background: color, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, opacity: areaSaving ? 0.6 : 1 }}>{areaSaving ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            </ModalOverlay>
          )}
        </div>
      )}

      {/* ── ACTIVITY TAB ─────────────────────────────────────────── */}
      {tab === 'activity' && (
        <div>
          {activityLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</div>
          ) : activity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: THEME.textLow, fontSize: '14px' }}>No activity yet. Actions on this project will appear here automatically.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {activity.map((a, i) => {
                const prev = activity[i - 1]
                const dateStr = new Date(a.created_at).toLocaleDateString()
                const prevDateStr = prev ? new Date(prev.created_at).toLocaleDateString() : null
                const showDateHeader = dateStr !== prevDateStr
                return (
                  <div key={a.id}>
                    {showDateHeader && (
                      <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.textLow, padding: '12px 0 6px', borderBottom: `1px solid ${THEME.outlineVar}`, marginTop: i > 0 ? '8px' : '0' }}>{dateStr}</div>
                    )}
                    <div style={{ display: 'flex', gap: '10px', padding: '10px 0', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: color + '18', color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
                        {a.actor?.full_name ? a.actor.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '?'}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: THEME.text }}>
                          <span style={{ fontWeight: 600 }}>{a.actor?.full_name || 'System'}</span>{' '}
                          <span style={{ color: THEME.textMed }}>{a.message || a.action_type}</span>
                        </div>
                        <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>
                          {new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── SCHEDULE TAB ──────────────────────────────────────── */}
      {tab === 'schedule' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
            <SectionTitle title="Schedule & Gantt" subtitle="Interactive timeline, critical path analysis and baselines" />
            <div style={{ display: 'flex', gap: '8px' }}>
              {can('projects.edit') && (
                <button onClick={runCpm} disabled={cpmLoading} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: '#1565C0', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  opacity: cpmLoading ? 0.6 : 1,
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '16px', animation: cpmLoading ? 'spin 1s linear infinite' : 'none' }}>{cpmLoading ? 'progress_activity' : 'calculate'}</span>
                  {cpmLoading ? 'Calculating...' : 'Run CPM'}
                </button>
              )}
              {can('projects.edit') && (
                <button onClick={() => { setBaselineName(`Baseline ${baselines.length + 1}`); setBaselineModal(true) }} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>save</span>
                  Save Baseline
                </button>
              )}
            </div>
          </div>

          {/* ── Interactive Gantt Chart ──────────────────────────── */}
          {(() => {
            const tasks = [...boardTasks]
              .filter(t => t.start_date || t.end_date)
              .sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999') || a.position - b.position)
            if (tasks.length === 0) return (
              <DashCard style={{ marginBottom: '16px' }}>
                <SectionTitle title="Gantt Chart" subtitle="Add start/end dates to tasks to see the timeline" />
                <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow, fontSize: '13px' }}>
                  <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '8px', opacity: 0.3 }}>view_timeline</span>
                  No tasks with dates yet. Set start and end dates on tasks to generate the Gantt chart.
                </div>
              </DashCard>
            )

            const allDates = tasks.flatMap(t => [t.start_date, t.end_date].filter(Boolean))
            const minDate = new Date(allDates.reduce((a, b) => a < b ? a : b))
            const maxDate = new Date(allDates.reduce((a, b) => a > b ? a : b))
            minDate.setDate(minDate.getDate() - 3)
            maxDate.setDate(maxDate.getDate() + 7)
            const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / 86400000))
            const today = new Date().toISOString().slice(0, 10)
            const todayPos = Math.ceil((new Date(today) - minDate) / 86400000)

            const months = []
            const d = new Date(minDate)
            d.setDate(1)
            while (d <= maxDate) {
              const mStart = Math.max(0, Math.ceil((d - minDate) / 86400000))
              const nextM = new Date(d.getFullYear(), d.getMonth() + 1, 1)
              const mEnd = Math.min(totalDays, Math.ceil((nextM - minDate) / 86400000))
              months.push({ label: d.toLocaleString('default', { month: 'short', year: '2-digit' }), start: mStart, end: mEnd })
              d.setMonth(d.getMonth() + 1)
            }

            const weeks = []
            const wk = new Date(minDate)
            wk.setDate(wk.getDate() - wk.getDay() + 1)
            while (wk <= maxDate) {
              const ws = Math.max(0, Math.ceil((wk - minDate) / 86400000))
              weeks.push({ day: ws, label: `${wk.getDate()}` })
              wk.setDate(wk.getDate() + 7)
            }

            const ROW_H = 32, HEADER_H = 44, LABEL_W = 220
            const chartH = tasks.length * ROW_H + HEADER_H
            const ganttBarColor = (t) => {
              const isCritical = cpmResult?.tasks?.find(ct => ct.task_id === t.id)?.is_critical
              if (isCritical) return '#C62828'
              if (t.status === 'done') return '#2E7D32'
              if (t.status === 'in_progress') return '#1565C0'
              if (t.percent_complete >= 100) return '#2E7D32'
              const overdue = t.end_date && t.end_date < today && (t.percent_complete || 0) < 100
              if (overdue) return '#E65100'
              return color
            }

            return (
              <DashCard style={{ marginBottom: '16px', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 16px 0' }}>
                  <SectionTitle title="Gantt Chart" subtitle={`${tasks.length} tasks · ${totalDays} day span`} />
                </div>
                <div style={{ display: 'flex', borderTop: `1px solid ${THEME.outlineVar}`, overflow: 'hidden' }}>
                  {/* Left: task labels */}
                  <div style={{ minWidth: LABEL_W, maxWidth: LABEL_W, borderRight: `1px solid ${THEME.outlineVar}`, flexShrink: 0 }}>
                    <div style={{ height: HEADER_H, display: 'flex', alignItems: 'flex-end', padding: '0 10px 6px', fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outlineVar}` }}>Task</div>
                    {tasks.map((t, i) => (
                      <div key={t.id} style={{
                        height: ROW_H, display: 'flex', alignItems: 'center', padding: '0 10px', gap: '6px',
                        borderBottom: `1px solid ${THEME.outlineVar}08`,
                        background: i % 2 === 0 ? 'transparent' : THEME.surfaceVar + '40',
                      }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ganttBarColor(t), flexShrink: 0 }} />
                        <span style={{ fontSize: '11px', color: THEME.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{t.title}</span>
                      </div>
                    ))}
                  </div>
                  {/* Right: gantt bars */}
                  <div style={{ flex: 1, overflowX: 'auto', position: 'relative' }}>
                    <div style={{ minWidth: Math.max(totalDays * 4, 600), position: 'relative' }}>
                      {/* Month headers */}
                      <div style={{ height: 22, display: 'flex', borderBottom: `1px solid ${THEME.outlineVar}40` }}>
                        {months.map((m, i) => (
                          <div key={i} style={{
                            position: 'absolute', left: `${(m.start / totalDays) * 100}%`, width: `${((m.end - m.start) / totalDays) * 100}%`,
                            height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '10px', fontWeight: 700, color: THEME.textMed, borderRight: `1px solid ${THEME.outlineVar}30`,
                          }}>{m.label}</div>
                        ))}
                      </div>
                      {/* Week markers */}
                      <div style={{ height: 22, display: 'flex', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                        {weeks.map((w, i) => (
                          <div key={i} style={{
                            position: 'absolute', left: `${(w.day / totalDays) * 100}%`, width: `${(7 / totalDays) * 100}%`,
                            height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '9px', color: THEME.textLow, borderRight: `1px solid ${THEME.outlineVar}20`,
                          }}>{w.label}</div>
                        ))}
                      </div>
                      {/* Today line */}
                      {todayPos >= 0 && todayPos <= totalDays && (
                        <div style={{
                          position: 'absolute', left: `${(todayPos / totalDays) * 100}%`, top: 0, bottom: 0,
                          width: '2px', background: '#F44336', zIndex: 5, pointerEvents: 'none',
                        }}>
                          <div style={{ position: 'absolute', top: 0, left: '-10px', background: '#F44336', color: '#fff', fontSize: '8px', fontWeight: 700, padding: '1px 4px', borderRadius: '0 0 3px 3px', whiteSpace: 'nowrap' }}>Today</div>
                        </div>
                      )}
                      {/* Task bars */}
                      {tasks.map((t, i) => {
                        const start = t.start_date ? new Date(t.start_date) : null
                        const end = t.end_date ? new Date(t.end_date) : start
                        if (!start) return null
                        const barStart = Math.ceil((start - minDate) / 86400000)
                        const barDur = Math.max(1, Math.ceil(((end || start) - start) / 86400000))
                        const pct = t.percent_complete || 0
                        const isCrit = cpmResult?.tasks?.find(ct => ct.task_id === t.id)?.is_critical
                        const overdue = t.end_date && t.end_date < today && pct < 100
                        const barColor = ganttBarColor(t)
                        return (
                          <div key={t.id} className="gantt-row" style={{
                            position: 'relative', height: ROW_H, display: 'flex', alignItems: 'center',
                            background: i % 2 === 0 ? 'transparent' : THEME.surfaceVar + '40',
                            borderBottom: `1px solid ${THEME.outlineVar}08`,
                          }}>
                            {/* Background grid lines for weeks */}
                            {weeks.map((w, wi) => (
                              <div key={wi} style={{ position: 'absolute', left: `${(w.day / totalDays) * 100}%`, top: 0, bottom: 0, width: '1px', background: THEME.outlineVar + '15' }} />
                            ))}
                            {/* Bar container with tooltip */}
                            <div style={{
                              position: 'absolute',
                              left: `${(barStart / totalDays) * 100}%`,
                              width: `${(barDur / totalDays) * 100}%`,
                              height: 20, minWidth: '4px',
                            }}>
                              {/* Full bar background */}
                              <div style={{
                                position: 'absolute', inset: 0, borderRadius: '4px',
                                background: barColor + '30',
                                border: `1px solid ${barColor}60`,
                                cursor: 'pointer',
                                transition: 'transform 0.15s, box-shadow 0.15s',
                              }}
                              onMouseEnter={e => {
                                e.currentTarget.style.transform = 'scaleY(1.3)'
                                e.currentTarget.style.boxShadow = `0 2px 8px ${barColor}40`
                                e.currentTarget.style.zIndex = '10'
                                const tip = e.currentTarget.querySelector('.gantt-tip')
                                if (tip) tip.style.display = 'block'
                              }}
                              onMouseLeave={e => {
                                e.currentTarget.style.transform = 'scaleY(1)'
                                e.currentTarget.style.boxShadow = 'none'
                                e.currentTarget.style.zIndex = '1'
                                const tip = e.currentTarget.querySelector('.gantt-tip')
                                if (tip) tip.style.display = 'none'
                              }}
                              >
                                {/* Progress fill */}
                                <div style={{
                                  position: 'absolute', left: 0, top: 0, bottom: 0,
                                  width: `${Math.min(100, pct)}%`, borderRadius: '3px',
                                  background: barColor, opacity: 0.85,
                                }} />
                                {/* Percent label on bar */}
                                {barDur > 3 && (
                                  <span style={{
                                    position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                                    fontSize: '9px', fontWeight: 700, color: pct > 50 ? '#fff' : barColor,
                                    whiteSpace: 'nowrap', pointerEvents: 'none', textShadow: pct > 50 ? '0 0 2px rgba(0,0,0,0.3)' : 'none',
                                  }}>{pct}%</span>
                                )}
                                {/* Critical path marker */}
                                {isCrit && (
                                  <span style={{
                                    position: 'absolute', right: -8, top: -4, fontSize: '10px', color: '#C62828',
                                  }}>⚑</span>
                                )}
                                {/* Tooltip */}
                                <div className="gantt-tip" style={{
                                  display: 'none', position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)',
                                  marginBottom: '6px', background: '#1a1a2e', color: '#fff', borderRadius: '8px',
                                  padding: '10px 14px', fontSize: '11px', lineHeight: '1.5', whiteSpace: 'nowrap',
                                  zIndex: 50, boxShadow: '0 4px 16px rgba(0,0,0,0.3)', pointerEvents: 'none',
                                  minWidth: '180px',
                                }}>
                                  <div style={{ fontWeight: 700, fontSize: '12px', marginBottom: '4px', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px' }}>
                                    <span style={{ color: '#aaa' }}>Start:</span><span>{t.start_date || '—'}</span>
                                    <span style={{ color: '#aaa' }}>End:</span><span>{t.end_date || '—'}</span>
                                    <span style={{ color: '#aaa' }}>Duration:</span><span>{t.duration_days || barDur}d</span>
                                    <span style={{ color: '#aaa' }}>Progress:</span><span style={{ color: pct >= 100 ? '#66BB6A' : pct > 0 ? '#42A5F5' : '#aaa' }}>{pct}%</span>
                                    {t.assigned_to && <><span style={{ color: '#aaa' }}>Assigned:</span><span>{userName(t.assigned_to)}</span></>}
                                    <span style={{ color: '#aaa' }}>Status:</span>
                                    <span style={{ color: overdue ? '#FF8A65' : t.status === 'done' ? '#66BB6A' : '#42A5F5' }}>
                                      {overdue ? 'Overdue' : t.status === 'done' ? 'Complete' : t.status === 'in_progress' ? 'In Progress' : 'Not Started'}
                                    </span>
                                    {isCrit && <><span style={{ color: '#aaa' }}>Path:</span><span style={{ color: '#EF5350' }}>Critical</span></>}
                                  </div>
                                  <div style={{ position: 'absolute', bottom: '-4px', left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: '8px', height: '8px', background: '#1a1a2e' }} />
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {/* Legend */}
                <div style={{ display: 'flex', gap: '14px', padding: '10px 16px', borderTop: `1px solid ${THEME.outlineVar}`, flexWrap: 'wrap' }}>
                  {[
                    { c: color, l: 'On Track' }, { c: '#1565C0', l: 'In Progress' }, { c: '#2E7D32', l: 'Complete' },
                    { c: '#E65100', l: 'Overdue' }, { c: '#C62828', l: 'Critical Path' },
                  ].map(x => (
                    <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: THEME.textMed }}>
                      <div style={{ width: '14px', height: '8px', borderRadius: '2px', background: x.c + '30', border: `1px solid ${x.c}60` }}>
                        <div style={{ width: '60%', height: '100%', background: x.c, borderRadius: '1px', opacity: 0.85 }} />
                      </div>
                      {x.l}
                    </div>
                  ))}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px', color: THEME.textMed }}>
                    <div style={{ width: '2px', height: '10px', background: '#F44336' }} /> Today
                  </div>
                </div>
              </DashCard>
            )
          })()}

          {/* CPM Results */}
          {cpmResult && (
            <DashCard style={{ marginBottom: '16px' }}>
              <SectionTitle title="CPM Results" subtitle={`Project duration: ${cpmResult.project_duration || 0} days · ${cpmResult.critical_path?.length || 0} critical tasks`} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                <KpiCard label="Duration" value={`${cpmResult.project_duration || 0}d`} icon="schedule" accent="#1565C0" />
                <KpiCard label="Critical Tasks" value={cpmResult.critical_path?.length || 0} icon="warning" accent="#C62828" />
                <KpiCard label="Total Tasks" value={cpmResult.tasks?.length || 0} icon="task" accent={color} />
              </div>
              {cpmResult.tasks?.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                        {['Task', 'WBS', 'ES', 'EF', 'LS', 'LF', 'Float', 'Critical'].map(h => (
                          <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cpmResult.tasks.sort((a, b) => (a.es || 0) - (b.es || 0)).map(t => {
                        const task = boardTasks.find(bt => bt.id === t.task_id)
                        return (
                          <tr key={t.task_id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: t.is_critical ? '#FFF8E1' : 'transparent' }}>
                            <td style={{ padding: '6px 8px', color: THEME.text, fontWeight: t.is_critical ? 600 : 400, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task?.title || t.task_id}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textLow, fontFamily: 'monospace', fontSize: '11px' }}>{task?.wbs_code || '—'}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{t.es ?? '—'}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{t.ef ?? '—'}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{t.ls ?? '—'}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{t.lf ?? '—'}</td>
                            <td style={{ padding: '6px 8px', fontWeight: 600, color: t.total_float === 0 ? '#C62828' : THEME.text }}>{t.total_float ?? '—'}</td>
                            <td style={{ padding: '6px 8px' }}>{t.is_critical ? <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: '#FFEBEE', color: '#C62828' }}>YES</span> : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </DashCard>
          )}

          {/* Baselines */}
          <DashCard>
            <SectionTitle title="Baselines" subtitle={`${baselines.length} saved`} />
            {baselines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: THEME.textLow, fontSize: '13px' }}>No baselines saved yet. Save a baseline to snapshot the current schedule.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {baselines.map(bl => (
                  <div key={bl.id} onClick={() => viewBaseline(bl)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '10px', cursor: 'pointer',
                    background: selectedBaseline?.id === bl.id ? color + '12' : THEME.surfaceVar,
                    border: selectedBaseline?.id === bl.id ? `1px solid ${color}40` : `1px solid transparent`,
                  }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{bl.name}</div>
                      <div style={{ fontSize: '11px', color: THEME.textLow }}>{new Date(bl.created_at).toLocaleDateString()} · {bl.task_count || '?'} tasks</div>
                    </div>
                    <span className="material-symbols-rounded" style={{ fontSize: '18px', color: THEME.textLow }}>chevron_right</span>
                  </div>
                ))}
              </div>
            )}

            {/* Baseline snapshots detail */}
            {selectedBaseline && baselineSnapshots.length > 0 && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>
                  {selectedBaseline.name} — Task Snapshots
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                        {['Task', 'Planned Start', 'Planned End', 'Duration', '% Complete'].map(h => (
                          <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: THEME.textMed }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {baselineSnapshots.map(snap => {
                        const task = boardTasks.find(t => t.id === snap.task_id)
                        const startDrift = task?.start_date && snap.planned_start ? daysBetween(snap.planned_start, task.start_date) : null
                        return (
                          <tr key={snap.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                            <td style={{ padding: '6px 8px', color: THEME.text }}>{task?.title || snap.task_id}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{snap.planned_start || '—'}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{snap.planned_end || '—'}</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{snap.planned_duration || '—'}d</td>
                            <td style={{ padding: '6px 8px', color: THEME.textMed }}>{snap.percent_complete || 0}%
                              {startDrift != null && startDrift !== 0 && (
                                <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 600, color: startDrift > 0 ? '#C62828' : '#2E7D32' }}>
                                  {startDrift > 0 ? `+${startDrift}d late` : `${Math.abs(startDrift)}d early`}
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </DashCard>

          {/* Baseline save modal */}
          {baselineModal && (
            <ModalOverlay onClose={() => setBaselineModal(false)} dirty={true}>
              <div style={{ background: THEME.surface, borderRadius: '18px', width: '400px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }}>
                <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>Save Baseline</div>
                <div style={fieldWrap}><label style={lbl}>Baseline Name</label>
                  <input style={inp} value={baselineName} onChange={e => setBaselineName(e.target.value)} placeholder="e.g. Baseline 1 — Original Plan" />
                </div>
                <div style={{ fontSize: '12px', color: THEME.textMed, marginBottom: '12px' }}>
                  This will snapshot the current schedule (start/end dates, durations, % complete) for all tasks in this project.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                  <button onClick={() => setBaselineModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                  <button onClick={saveBaseline} disabled={baselineSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: baselineSaving ? 0.6 : 1 }}>{baselineSaving ? 'Saving...' : 'Save'}</button>
                </div>
              </div>
            </ModalOverlay>
          )}
        </div>
      )}

      {/* ── COSTS & EVM TAB ──────────────────────────────────── */}
      {tab === 'costs' && (
        <div>
          {/* Sub-tabs */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '16px' }}>
            {[{ id: 'evm', label: 'EVM Dashboard', icon: 'analytics' }, { id: 'breakdown', label: 'Cost Breakdown', icon: 'account_tree' }, { id: 'changes', label: 'Change Orders', icon: 'swap_horiz' }].map(t => (
              <button key={t.id} onClick={() => setCostTab(t.id)} style={{
                display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px',
                fontSize: '12px', fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: costTab === t.id ? color : THEME.surfaceVar, color: costTab === t.id ? '#fff' : THEME.textMed,
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>{t.icon}</span>{t.label}
              </button>
            ))}
          </div>

          {/* EVM Dashboard */}
          {costTab === 'evm' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <SectionTitle title="Earned Value Management" subtitle="Project performance metrics" />
                {can('projects.edit') && (
                  <button onClick={runEvm} disabled={evmLoading} style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '10px',
                    fontSize: '13px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    opacity: evmLoading ? 0.6 : 1,
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '16px', animation: evmLoading ? 'spin 1s linear infinite' : 'none' }}>{evmLoading ? 'progress_activity' : 'calculate'}</span>
                    {evmLoading ? 'Calculating...' : 'Recalculate'}
                  </button>
                )}
              </div>

              {evmResult ? (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                    <KpiCard label="BAC (Budget)" value={fmtMoney(evmResult.bac)} icon="account_balance" accent={color} />
                    <KpiCard label="BCWS (PV)" value={fmtMoney(evmResult.bcws)} icon="schedule" accent="#1565C0" />
                    <KpiCard label="BCWP (EV)" value={fmtMoney(evmResult.bcwp)} icon="trending_up" accent="#2E7D32" />
                    <KpiCard label="ACWP (AC)" value={fmtMoney(evmResult.acwp)} icon="payments" accent="#E65100" />
                  </div>

                  {/* Performance indices */}
                  <DashCard style={{ marginBottom: '16px' }}>
                    <SectionTitle title="Performance Indices" />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
                      {[
                        { label: 'SPI (Schedule)', value: evmResult.spi, good: evmResult.spi >= 1, desc: evmResult.spi >= 1 ? 'Ahead of schedule' : 'Behind schedule' },
                        { label: 'CPI (Cost)', value: evmResult.cpi, good: evmResult.cpi >= 1, desc: evmResult.cpi >= 1 ? 'Under budget' : 'Over budget' },
                        { label: 'TCPI', value: evmResult.tcpi, good: evmResult.tcpi <= 1, desc: evmResult.tcpi <= 1 ? 'Achievable target' : 'Challenging target' },
                      ].map(idx => (
                        <div key={idx.label} style={{ padding: '14px', borderRadius: '10px', background: THEME.surfaceVar }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', marginBottom: '6px' }}>{idx.label}</div>
                          <div style={{ fontSize: '28px', fontWeight: 800, color: idx.value == null ? THEME.textLow : idx.good ? '#2E7D32' : '#C62828', marginBottom: '2px' }}>
                            {idx.value != null ? idx.value.toFixed(2) : '—'}
                          </div>
                          <div style={{ fontSize: '11px', color: THEME.textMed }}>{idx.value != null ? idx.desc : 'No data'}</div>
                        </div>
                      ))}
                    </div>
                  </DashCard>

                  {/* Variances & forecasts */}
                  <DashCard style={{ marginBottom: '16px' }}>
                    <SectionTitle title="Variances & Forecasts" />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px' }}>
                      {[
                        { label: 'Schedule Variance (SV)', value: evmResult.sv, fmt: fmtMoney },
                        { label: 'Cost Variance (CV)', value: evmResult.cv, fmt: fmtMoney },
                        { label: 'EAC (Estimate at Completion)', value: evmResult.eac, fmt: fmtMoney },
                        { label: 'ETC (Estimate to Complete)', value: evmResult.etc, fmt: fmtMoney },
                        { label: 'VAC (Variance at Completion)', value: evmResult.vac, fmt: fmtMoney },
                        { label: 'Planned %', value: evmResult.percent_planned, fmt: v => `${v}%` },
                        { label: 'Actual %', value: evmResult.percent_actual, fmt: v => `${v}%` },
                      ].map(item => (
                        <div key={item.label} style={{ padding: '10px 14px', borderRadius: '8px', background: THEME.surfaceVar }}>
                          <div style={{ fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', marginBottom: '4px' }}>{item.label}</div>
                          <div style={{ fontSize: '16px', fontWeight: 700, color: item.value < 0 ? '#C62828' : item.value > 0 ? '#2E7D32' : THEME.text }}>
                            {item.value != null ? item.fmt(item.value) : '—'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </DashCard>

                  {/* S-Curve Chart */}
                  {(() => {
                    const pts = [...progressData].sort((a, b) => a.reporting_date.localeCompare(b.reporting_date))
                    if (pts.length < 2 && !evmResult.percent_planned) return null
                    const W = 560, H = 220, padL = 55, padR = 16, padT = 20, padB = 32
                    const aW = W - padL - padR, aH = H - padT - padB
                    const series = pts.length >= 2
                      ? [
                          { key: 'bcws', label: 'PV (Planned)', color: '#1565C0', vals: pts.map(p => Number(p.bcws || 0)) },
                          { key: 'bcwp', label: 'EV (Earned)', color: '#2E7D32', vals: pts.map(p => Number(p.bcwp || 0)) },
                          { key: 'acwp', label: 'AC (Actual)', color: '#E65100', vals: pts.map(p => Number(p.acwp || 0)) },
                        ]
                      : []
                    const allVals = series.flatMap(s => s.vals)
                    const maxV = Math.max(...allVals, evmResult.bac || 1, 1)
                    const n = pts.length
                    const xp = i => padL + (n > 1 ? (i / (n - 1)) * aW : aW / 2)
                    const yp = v => padT + aH - (v / maxV) * aH
                    const makePath = vals => {
                      let d = `M ${xp(0)} ${yp(vals[0])}`
                      for (let i = 1; i < vals.length; i++) {
                        const mx = (xp(i - 1) + xp(i)) / 2
                        d += ` C ${mx} ${yp(vals[i - 1])}, ${mx} ${yp(vals[i])}, ${xp(i)} ${yp(vals[i])}`
                      }
                      return d
                    }
                    const fmtK = v => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v.toFixed(0)
                    const labels = pts.map(p => { const d = new Date(p.reporting_date); return `${d.toLocaleString('default', { month: 'short' })} ${d.getDate()}` })
                    return (
                      <DashCard>
                        <SectionTitle title="S-Curve" subtitle="Planned Value vs Earned Value vs Actual Cost over time" />
                        {series.length > 0 ? (
                          <>
                            <div style={{ overflowX: 'auto' }}>
                              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: '400px', display: 'block' }}>
                                {[0.25, 0.5, 0.75, 1].map(f => (
                                  <g key={f}>
                                    <line x1={padL} x2={W - padR} y1={yp(f * maxV)} y2={yp(f * maxV)} stroke={THEME.outlineVar} strokeWidth="0.5" strokeDasharray="3 3" />
                                    <text x={padL - 6} y={yp(f * maxV) + 3} textAnchor="end" fontSize="8.5" fill={THEME.textLow} fontFamily="inherit">{fmtK(f * maxV)}</text>
                                  </g>
                                ))}
                                <line x1={padL} x2={W - padR} y1={padT + aH} y2={padT + aH} stroke={THEME.outlineVar} strokeWidth="1" />
                                {evmResult.bac > 0 && (
                                  <g>
                                    <line x1={padL} x2={W - padR} y1={yp(evmResult.bac)} y2={yp(evmResult.bac)} stroke="#9E9E9E" strokeWidth="1" strokeDasharray="6 3" />
                                    <text x={W - padR + 2} y={yp(evmResult.bac) + 3} fontSize="8" fill="#9E9E9E" fontFamily="inherit">BAC</text>
                                  </g>
                                )}
                                {series.map(s => (
                                  <path key={s.key} d={makePath(s.vals)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                                ))}
                                {series.map(s => s.vals.map((v, i) => (
                                  <circle key={`${s.key}-${i}`} cx={xp(i)} cy={yp(v)} r="2.5" fill={s.color} opacity="0.5" />
                                )))}
                                {labels.map((l, i) => (
                                  (n <= 12 || i % Math.ceil(n / 10) === 0) ? (
                                    <text key={i} x={xp(i)} y={padT + aH + 14} textAnchor="middle" fontSize="8" fill={THEME.textLow} fontFamily="inherit">{l}</text>
                                  ) : null
                                ))}
                              </svg>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', marginTop: '8px' }}>
                              {series.map(s => (
                                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: THEME.textMed }}>
                                  <div style={{ width: '16px', height: '3px', borderRadius: '2px', background: s.color }} />
                                  {s.label}
                                </div>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div style={{ textAlign: 'center', padding: '24px', color: THEME.textLow, fontSize: '12px' }}>
                            Add progress snapshots to see the S-curve. Record periodic BCWS/BCWP/ACWP data in the progress measurement table.
                          </div>
                        )}
                      </DashCard>
                    )
                  })()}

                  {/* Progress bars */}
                  {evmResult.percent_planned != null && (
                    <DashCard style={{ marginTop: '16px' }}>
                      <SectionTitle title="Progress Overview" />
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                          <span>Planned Progress</span><span>{evmResult.percent_planned}%</span>
                        </div>
                        <div style={{ height: '8px', borderRadius: '4px', background: THEME.outlineVar }}>
                          <div style={{ height: '100%', borderRadius: '4px', background: '#1565C0', width: `${Math.min(100, evmResult.percent_planned)}%`, transition: 'width 0.3s' }} />
                        </div>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                          <span>Actual Progress</span><span>{evmResult.percent_actual}%</span>
                        </div>
                        <div style={{ height: '8px', borderRadius: '4px', background: THEME.outlineVar }}>
                          <div style={{ height: '100%', borderRadius: '4px', background: '#2E7D32', width: `${Math.min(100, evmResult.percent_actual)}%`, transition: 'width 0.3s' }} />
                        </div>
                      </div>
                      {evmResult.bac > 0 && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: THEME.textMed, marginBottom: '4px' }}>
                            <span>Cost Spent</span><span>{Math.round((evmResult.acwp || 0) / evmResult.bac * 100)}% of budget</span>
                          </div>
                          <div style={{ height: '8px', borderRadius: '4px', background: THEME.outlineVar }}>
                            <div style={{ height: '100%', borderRadius: '4px', background: evmResult.acwp > evmResult.bac ? '#C62828' : '#E65100', width: `${Math.min(100, (evmResult.acwp || 0) / evmResult.bac * 100)}%`, transition: 'width 0.3s' }} />
                          </div>
                        </div>
                      )}
                    </DashCard>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '48px', color: THEME.textLow, fontSize: '13px' }}>
                  Click "Recalculate" to compute EVM metrics. Add cost items or set a project budget first.
                </div>
              )}
            </div>
          )}

          {/* Cost Breakdown */}
          {costTab === 'breakdown' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <SectionTitle title="Cost Breakdown Structure" subtitle={`${costItems.length} items · ${fmtMoney(costItems.reduce((s, c) => s + (c.budgeted_cost || 0), 0))} budgeted`} />
                {can('projects.edit') && (
                  <button onClick={() => {
                    setEditCostId(null)
                    setCostForm({ cbs_code: '', description: '', cost_type: 'direct', category: 'materials', budgeted_cost: '', committed_cost: '', actual_cost: '', estimate_to_complete: '' })
                    setCostModal(true)
                  }} style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '10px',
                    fontSize: '13px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>Add Cost Item
                  </button>
                )}
              </div>

              {costItems.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px', color: THEME.textLow, fontSize: '13px' }}>No cost items yet. Add items to build the cost breakdown structure.</div>
              ) : (
                <>
                  {/* Summary by category */}
                  <DashCard style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                      {['labour', 'materials', 'equipment', 'subcontract', 'other'].map(cat => {
                        const items = costItems.filter(c => c.category === cat)
                        const total = items.reduce((s, c) => s + (c.budgeted_cost || 0), 0)
                        const actual = items.reduce((s, c) => s + (c.actual_cost || 0), 0)
                        if (items.length === 0) return null
                        return (
                          <div key={cat} style={{ padding: '10px', borderRadius: '8px', background: THEME.surfaceVar }}>
                            <div style={{ fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', marginBottom: '4px' }}>{cat}</div>
                            <div style={{ fontSize: '14px', fontWeight: 700, color: THEME.text }}>{fmtMoney(total)}</div>
                            <div style={{ fontSize: '11px', color: actual > total ? '#C62828' : THEME.textMed }}>Actual: {fmtMoney(actual)}</div>
                          </div>
                        )
                      })}
                    </div>
                  </DashCard>

                  {/* Cost items table */}
                  <DashCard style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                          {['CBS Code', 'Description', 'Type', 'Category', 'Budget', 'Committed', 'Actual', 'ETC', 'EAC', ''].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 700, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {costItems.map(ci => {
                          const overBudget = ci.actual_cost > ci.budgeted_cost
                          return (
                            <tr key={ci.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: can('projects.edit') ? 'pointer' : 'default' }}
                              onClick={() => {
                                if (!can('projects.edit')) return
                                setEditCostId(ci.id)
                                setCostForm({ cbs_code: ci.cbs_code, description: ci.description, cost_type: ci.cost_type, category: ci.category || 'other', budgeted_cost: ci.budgeted_cost || '', committed_cost: ci.committed_cost || '', actual_cost: ci.actual_cost || '', estimate_to_complete: ci.estimate_to_complete || '' })
                                setCostModal(true)
                              }}>
                              <td style={{ padding: '6px 8px', fontFamily: 'monospace', color, fontWeight: 700 }}>{ci.cbs_code}</td>
                              <td style={{ padding: '6px 8px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ci.description}</td>
                              <td style={{ padding: '6px 8px', color: THEME.textMed, textTransform: 'capitalize' }}>{ci.cost_type}</td>
                              <td style={{ padding: '6px 8px', color: THEME.textMed, textTransform: 'capitalize' }}>{ci.category || '—'}</td>
                              <td style={{ padding: '6px 8px', color: THEME.text, fontWeight: 600 }}>{fmtMoney(ci.budgeted_cost)}</td>
                              <td style={{ padding: '6px 8px', color: THEME.textMed }}>{fmtMoney(ci.committed_cost)}</td>
                              <td style={{ padding: '6px 8px', color: overBudget ? '#C62828' : THEME.text, fontWeight: overBudget ? 700 : 400 }}>{fmtMoney(ci.actual_cost)}</td>
                              <td style={{ padding: '6px 8px', color: THEME.textMed }}>{fmtMoney(ci.estimate_to_complete)}</td>
                              <td style={{ padding: '6px 8px', color: THEME.text, fontWeight: 600 }}>{fmtMoney(ci.estimate_at_completion)}</td>
                              <td style={{ padding: '6px 8px' }}>
                                {can('projects.edit') && (
                                  <button onClick={e => { e.stopPropagation(); archiveCostItem(ci.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                                    <span className="material-symbols-rounded" style={{ fontSize: '14px', color: THEME.textLow }}>archive</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                        <tr style={{ borderTop: `2px solid ${THEME.outlineVar}`, fontWeight: 700 }}>
                          <td colSpan={4} style={{ padding: '8px', color: THEME.text }}>TOTAL</td>
                          <td style={{ padding: '6px 8px', color: THEME.text }}>{fmtMoney(costItems.reduce((s, c) => s + (c.budgeted_cost || 0), 0))}</td>
                          <td style={{ padding: '6px 8px', color: THEME.textMed }}>{fmtMoney(costItems.reduce((s, c) => s + (c.committed_cost || 0), 0))}</td>
                          <td style={{ padding: '6px 8px', color: THEME.text }}>{fmtMoney(costItems.reduce((s, c) => s + (c.actual_cost || 0), 0))}</td>
                          <td style={{ padding: '6px 8px', color: THEME.textMed }}>{fmtMoney(costItems.reduce((s, c) => s + (c.estimate_to_complete || 0), 0))}</td>
                          <td style={{ padding: '6px 8px', color: THEME.text }}>{fmtMoney(costItems.reduce((s, c) => s + (c.estimate_at_completion || 0), 0))}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </DashCard>
                </>
              )}

              {/* Cost item modal */}
              {costModal && (
                <ModalOverlay onClose={() => setCostModal(false)} dirty={true}>
                  <div style={{ background: THEME.surface, borderRadius: '18px', width: '520px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>{editCostId ? 'Edit Cost Item' : 'Add Cost Item'}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                      <div style={fieldWrap}><label style={lbl}>CBS Code *</label><input style={{ ...inp, textTransform: 'uppercase' }} value={costForm.cbs_code} onChange={e => setCostForm(f => ({ ...f, cbs_code: e.target.value }))} placeholder="01.01.01" /></div>
                      <div style={fieldWrap}><label style={lbl}>Category</label>
                        <select style={inp} value={costForm.category} onChange={e => setCostForm(f => ({ ...f, category: e.target.value }))}>
                          {['labour', 'materials', 'equipment', 'subcontract', 'other'].map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={fieldWrap}><label style={lbl}>Description *</label><input style={inp} value={costForm.description} onChange={e => setCostForm(f => ({ ...f, description: e.target.value }))} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                      <div style={fieldWrap}><label style={lbl}>Cost Type</label>
                        <select style={inp} value={costForm.cost_type} onChange={e => setCostForm(f => ({ ...f, cost_type: e.target.value }))}>
                          {['direct', 'indirect', 'contingency', 'management_reserve'].map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                        </select>
                      </div>
                      <div style={fieldWrap}><label style={lbl}>Budgeted Cost</label><input type="number" style={inp} value={costForm.budgeted_cost} onChange={e => setCostForm(f => ({ ...f, budgeted_cost: e.target.value }))} /></div>
                      <div style={fieldWrap}><label style={lbl}>Committed Cost</label><input type="number" style={inp} value={costForm.committed_cost} onChange={e => setCostForm(f => ({ ...f, committed_cost: e.target.value }))} /></div>
                      <div style={fieldWrap}><label style={lbl}>Actual Cost</label><input type="number" style={inp} value={costForm.actual_cost} onChange={e => setCostForm(f => ({ ...f, actual_cost: e.target.value }))} /></div>
                      <div style={fieldWrap}><label style={lbl}>Estimate to Complete</label><input type="number" style={inp} value={costForm.estimate_to_complete} onChange={e => setCostForm(f => ({ ...f, estimate_to_complete: e.target.value }))} /></div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                      <button onClick={() => setCostModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      <button onClick={saveCostItem} disabled={costSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: costSaving ? 0.6 : 1 }}>{costSaving ? 'Saving...' : 'Save'}</button>
                    </div>
                  </div>
                </ModalOverlay>
              )}
            </div>
          )}

          {/* Change Orders */}
          {costTab === 'changes' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <SectionTitle title="Change Orders" subtitle={`${changeOrders.length} orders · ${fmtMoney(changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + (c.cost_impact || 0), 0))} approved impact`} />
                {can('projects.edit') && (
                  <button onClick={() => {
                    setEditCoId(null)
                    setCoForm({ change_order_number: `CO-${String(changeOrders.length + 1).padStart(3, '0')}`, title: '', description: '', status: 'draft', impact_type: 'cost', cost_impact: '', schedule_impact_days: '', notes: '' })
                    setCoModal(true)
                  }} style={{
                    display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 16px', borderRadius: '10px',
                    fontSize: '13px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    <span className="material-symbols-rounded" style={{ fontSize: '16px' }}>add</span>New Change Order
                  </button>
                )}
              </div>

              {changeOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px', color: THEME.textLow, fontSize: '13px' }}>No change orders yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {changeOrders.map(co => {
                    const statusColors = {
                      draft: { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
                      submitted: { bg: '#FFF3E0', text: '#E65100' },
                      under_review: { bg: '#E3F2FD', text: '#1565C0' },
                      approved: { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
                      rejected: { bg: THEME.statusErrorBg, text: THEME.statusErrorText },
                      implemented: { bg: '#E8F5E9', text: '#1B5E20' },
                    }
                    const sc = statusColors[co.status] || statusColors.draft
                    return (
                      <DashCard key={co.id} style={{ padding: '14px 18px', cursor: can('projects.edit') ? 'pointer' : 'default' }}
                        onClick={() => {
                          if (!can('projects.edit')) return
                          setEditCoId(co.id)
                          setCoForm({ change_order_number: co.change_order_number, title: co.title, description: co.description || '', status: co.status, impact_type: co.impact_type || 'cost', cost_impact: co.cost_impact || '', schedule_impact_days: co.schedule_impact_days || '', notes: co.notes || '' })
                          setCoModal(true)
                        }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ fontFamily: 'monospace', fontSize: '12px', fontWeight: 700, color }}>{co.change_order_number}</span>
                              <span style={{ fontSize: '14px', fontWeight: 600, color: THEME.text }}>{co.title}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: THEME.textMed }}>
                              {co.cost_impact !== 0 && <span style={{ color: co.cost_impact > 0 ? '#C62828' : '#2E7D32', fontWeight: 600 }}>{co.cost_impact > 0 ? '+' : ''}{fmtMoney(co.cost_impact)}</span>}
                              {co.schedule_impact_days !== 0 && <span style={{ color: co.schedule_impact_days > 0 ? '#C62828' : '#2E7D32', fontWeight: 600 }}>{co.schedule_impact_days > 0 ? '+' : ''}{co.schedule_impact_days}d</span>}
                              {co.requester?.full_name && <span>by {co.requester.full_name}</span>}
                              {co.requested_date && <span>{co.requested_date}</span>}
                            </div>
                          </div>
                          <span style={{ fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px', background: sc.bg, color: sc.text, whiteSpace: 'nowrap' }}>{co.status.replace(/_/g, ' ')}</span>
                        </div>
                      </DashCard>
                    )
                  })}
                </div>
              )}

              {/* Change order modal */}
              {coModal && (
                <ModalOverlay onClose={() => setCoModal(false)} dirty={true}>
                  <div style={{ background: THEME.surface, borderRadius: '18px', width: '520px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>{editCoId ? 'Edit Change Order' : 'New Change Order'}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                      <div style={fieldWrap}><label style={lbl}>CO Number *</label><input style={{ ...inp, textTransform: 'uppercase' }} value={coForm.change_order_number} onChange={e => setCoForm(f => ({ ...f, change_order_number: e.target.value }))} /></div>
                      <div style={fieldWrap}><label style={lbl}>Status</label>
                        <select style={inp} value={coForm.status} onChange={e => setCoForm(f => ({ ...f, status: e.target.value }))}>
                          {['draft', 'submitted', 'under_review', 'approved', 'rejected', 'implemented'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={fieldWrap}><label style={lbl}>Title *</label><input style={inp} value={coForm.title} onChange={e => setCoForm(f => ({ ...f, title: e.target.value }))} /></div>
                    <div style={fieldWrap}><label style={lbl}>Description</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={coForm.description} onChange={e => setCoForm(f => ({ ...f, description: e.target.value }))} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 12px' }}>
                      <div style={fieldWrap}><label style={lbl}>Impact Type</label>
                        <select style={inp} value={coForm.impact_type} onChange={e => setCoForm(f => ({ ...f, impact_type: e.target.value }))}>
                          {['cost', 'schedule', 'scope', 'cost_and_schedule'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                        </select>
                      </div>
                      <div style={fieldWrap}><label style={lbl}>Cost Impact ($)</label><input type="number" style={inp} value={coForm.cost_impact} onChange={e => setCoForm(f => ({ ...f, cost_impact: e.target.value }))} /></div>
                      <div style={fieldWrap}><label style={lbl}>Schedule Impact (days)</label><input type="number" style={inp} value={coForm.schedule_impact_days} onChange={e => setCoForm(f => ({ ...f, schedule_impact_days: e.target.value }))} /></div>
                    </div>
                    <div style={fieldWrap}><label style={lbl}>Notes</label><textarea style={{ ...inp, resize: 'vertical' }} rows={2} value={coForm.notes} onChange={e => setCoForm(f => ({ ...f, notes: e.target.value }))} /></div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                      <button onClick={() => setCoModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                      <button onClick={saveChangeOrder} disabled={coSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: coSaving ? 0.6 : 1 }}>{coSaving ? 'Saving...' : 'Save'}</button>
                    </div>
                  </div>
                </ModalOverlay>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TASK DETAIL MODAL ───────────────────────────────────────── */}
      {taskModal && (
        <ModalOverlay onClose={() => setTaskModal(null)} dirty={true} style={{ alignItems: 'flex-start', paddingTop: '5vh', overflowY: 'auto' }}>
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
                  {siteEmployees.length > 0 && <optgroup label="Employees">
                    {siteEmployees.map(e => <option key={e.id} value={e.id}>{e.name}{e.position_title ? ` — ${e.position_title}` : ''}</option>)}
                  </optgroup>}
                  {members.length > 0 && <optgroup label="Project Members">
                    {members.map(m => <option key={m.user_id} value={m.user_id}>{userName(m.user_id)}</option>)}
                  </optgroup>}
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
              <div style={fieldWrap}><label style={lbl}>Area</label>
                <select style={inp} value={taskForm.area_id || ''} onChange={e => setTaskForm(f => ({ ...f, area_id: e.target.value || null }))}>
                  <option value="">None</option>
                  {projectAreas.map(pa => <option key={pa.id} value={pa.area_code_id}>{pa.area_code?.code} — {pa.area_code?.name}</option>)}
                </select>
              </div>
              <div style={fieldWrap}><label style={lbl}>Parent Task</label>
                <select style={inp} value={taskForm.parent_task_id || ''} onChange={e => setTaskForm(f => ({ ...f, parent_task_id: e.target.value || null }))}>
                  <option value="">None (top-level)</option>
                  {boardTasks.filter(t => t.id !== taskForm.id && !t.parent_task_id).map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
            </div>

            {/* Schedule fields */}
            <div style={{ padding: '10px 12px', background: THEME.surfaceVar, borderRadius: '10px', marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: THEME.textMed, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>event_note</span>Schedule
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                <div style={fieldWrap}><label style={lbl}>Actual Start</label>
                  <input style={inp} type="date" value={taskForm.actual_start || ''} onChange={e => setTaskForm(f => ({ ...f, actual_start: e.target.value }))} />
                </div>
                <div style={fieldWrap}><label style={lbl}>Actual End</label>
                  <input style={inp} type="date" value={taskForm.actual_end || ''} onChange={e => setTaskForm(f => ({ ...f, actual_end: e.target.value }))} />
                </div>
                <div style={fieldWrap}><label style={lbl}>Planned Duration (days)</label>
                  <input style={inp} type="number" value={taskForm.planned_duration || ''} onChange={e => setTaskForm(f => ({ ...f, planned_duration: e.target.value }))} />
                </div>
                <div style={fieldWrap}><label style={lbl}>% Complete</label>
                  <input style={inp} type="number" min="0" max="100" value={taskForm.percent_complete || ''} onChange={e => setTaskForm(f => ({ ...f, percent_complete: e.target.value }))} />
                </div>
                <div style={fieldWrap}><label style={lbl}>WBS Code</label>
                  <input style={inp} value={taskForm.wbs_code || ''} onChange={e => setTaskForm(f => ({ ...f, wbs_code: e.target.value }))} placeholder="Auto-generated" />
                </div>
                <div style={{ ...fieldWrap, display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '20px' }}>
                  <input type="checkbox" checked={!!taskForm.is_milestone} onChange={e => setTaskForm(f => ({ ...f, is_milestone: e.target.checked }))} style={{ width: '16px', height: '16px', accentColor: color }} />
                  <label style={{ fontSize: '12px', color: THEME.text }}>Milestone</label>
                </div>
              </div>
              {taskForm.total_float != null && (
                <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: THEME.textMed, marginTop: '4px' }}>
                  <span>Total Float: <strong style={{ color: taskForm.is_critical ? '#C62828' : THEME.text }}>{taskForm.total_float}d</strong></span>
                  <span>Free Float: <strong>{taskForm.free_float || 0}d</strong></span>
                  {taskForm.is_critical && <span style={{ fontWeight: 700, color: '#C62828' }}>CRITICAL PATH</span>}
                </div>
              )}
            </div>

            {/* Dependencies */}
            <div style={fieldWrap}>
              <label style={lbl}>Dependencies</label>
              {taskDeps.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                  {taskDeps.map(dep => {
                    const isBlocking = dep.task_id === taskForm.id
                    const otherTaskId = isBlocking ? dep.depends_on_id : dep.task_id
                    const otherTask = boardTasks.find(t => t.id === otherTaskId)
                    const typeLabel = dep.dependency_type === 'blocks' ? (isBlocking ? 'Blocks' : 'Blocked by') : dep.dependency_type === 'is_blocked_by' ? (isBlocking ? 'Blocked by' : 'Blocks') : 'Related to'
                    return (
                      <div key={dep.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px', background: THEME.surfaceVar, borderRadius: '6px', fontSize: '12px' }}>
                        <span className="material-symbols-rounded" style={{ fontSize: '14px', color: dep.dependency_type === 'related_to' ? THEME.textLow : '#E65100' }}>
                          {dep.dependency_type === 'related_to' ? 'link' : 'block'}
                        </span>
                        <span style={{ color: THEME.textMed, fontWeight: 600, minWidth: '70px' }}>{typeLabel}</span>
                        <span style={{ flex: 1, color: THEME.text }}>{otherTask?.title || 'Unknown'}</span>
                        {can('projects.edit') && (
                          <button onClick={() => removeDependency(dep.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
                            <span className="material-symbols-rounded" style={{ fontSize: '14px', color: THEME.textLow }}>close</span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {can('projects.edit') && (
                <>
                  <button onClick={() => setDepPicker(p => !p)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>+ Add Dependency</button>
                  {depPicker && (
                    <div style={{ marginTop: '6px', padding: '8px', background: THEME.surfaceVar, borderRadius: '8px' }}>
                      <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                        {['blocks', 'is_blocked_by', 'related_to'].map(dt => (
                          <span key={dt} style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '4px', background: (depPicker === dt ? color : THEME.outlineVar), color: depPicker === dt ? '#fff' : THEME.textMed, cursor: 'pointer' }}
                            onClick={() => setDepPicker(dt)}>{dt === 'blocks' ? 'Blocks' : dt === 'is_blocked_by' ? 'Blocked by' : 'Related to'}</span>
                        ))}
                      </div>
                      {typeof depPicker === 'string' && (
                        <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {boardTasks.filter(t => t.id !== taskForm.id && !taskDeps.some(d => (d.task_id === taskForm.id && d.depends_on_id === t.id) || (d.depends_on_id === taskForm.id && d.task_id === t.id))).map(t => (
                            <div key={t.id} onClick={() => addDependency(t.id, depPicker)} style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', color: THEME.text, background: 'transparent' }}
                              onMouseEnter={e => e.currentTarget.style.background = THEME.outlineVar}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                              {t.title}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
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
        </ModalOverlay>
      )}

      {/* ── PHASE MODAL ─────────────────────────────────────────── */}
      {phaseModal && (
        <ModalOverlay onClose={() => setPhaseModal(false)} dirty={true}>
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
        </ModalOverlay>
      )}

      {/* ── MEMBER MODAL ────────────────────────────────────────── */}
      {memberModal && (
        <ModalOverlay onClose={() => setMemberModal(false)} dirty={true}>
          <div style={{ background: THEME.surface, borderRadius: '18px', width: '400px', maxWidth: '95vw', boxShadow: THEME.shadow3, padding: '24px' }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '16px' }}>Add Team Member</div>
            <div style={fieldWrap}><label style={lbl}>User</label><select style={inp} value={memberForm.user_id} onChange={e => setMemberForm(f => ({ ...f, user_id: e.target.value }))}>
              <option value="">-- Select --</option>
              {siteUsers.map(u => <option key={u.id} value={u.id}>{u.full_name || u.username}</option>)}
            </select></div>
            <div style={fieldWrap}><label style={lbl}>Role</label><select style={inp} value={memberForm.role} onChange={e => setMemberForm(f => ({ ...f, role: e.target.value }))}>
              {MEMBER_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
              <button onClick={() => setMemberModal(false)} style={{ padding: '8px 16px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: THEME.surfaceVar, color: THEME.textMed, border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={addMember} disabled={memberSaving} style={{ padding: '8px 18px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit', opacity: memberSaving ? 0.6 : 1 }}>{memberSaving ? 'Adding...' : 'Add'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── LABEL MODAL ─────────────────────────────────────────── */}
      {labelModal && (
        <ModalOverlay onClose={() => setLabelModal(false)} dirty={true}>
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
        </ModalOverlay>
      )}
    </div>
  )
}
