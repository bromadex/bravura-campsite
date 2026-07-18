import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../supabaseClient'
import { usePermissions } from '../../../contexts/PermissionsContext'
import { useSite } from '../../../contexts/SiteContext'
import { useAuth } from '../../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../../utils/permissions'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast, fmtDate } from '../../../components/ui'
import { useRealtimeRefresh } from '../../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce

const APPRAISAL_STATUS_META = {
  pending:          { label: 'Pending',          bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
  self_complete:    { label: 'Self Complete',    bg: THEME.statusWarningBg,  text: THEME.statusWarningText },
  manager_complete: { label: 'Manager Complete', bg: THEME.statusInfoBg,     text: THEME.statusInfoText },
  final:            { label: 'Final',            bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText },
}

const CYCLE_STATUS_META = {
  open:   { label: 'Open',   bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  closed: { label: 'Closed', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const RATINGS = ['Excellent', 'Good', 'Satisfactory', 'Needs Improvement', 'Unsatisfactory']

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

const selectStyle = { ...inputStyle, appearance: 'auto' }

const badgeStyle = (meta) => ({
  display: 'inline-block', padding: '3px 12px', borderRadius: '999px', fontSize: '12px', fontWeight: 600,
  background: meta.bg, color: meta.text,
})

const EMPTY_CYCLE = { name: '', period_start: '', period_end: '' }

export default function Appraisals() {
  const { profile } = useAuth()
  const { currentSiteId } = useSite()
  const { can } = usePermissions()
  const rt = useRealtimeRefresh('appraisals', { column: 'site_id', value: currentSiteId })

  const [cycles, setCycles] = useState([])
  const [loading, setLoading] = useState(true)
  const [cycleModal, setCycleModal] = useState(false)
  const [cycleForm, setCycleForm] = useState(EMPTY_CYCLE)
  const [saving, setSaving] = useState(false)
  const [expandedCycleId, setExpandedCycleId] = useState(null)
  const [appraisals, setAppraisals] = useState([])
  const [appraisalLoading, setAppraisalLoading] = useState(false)
  const [appraisalModal, setAppraisalModal] = useState(null) // holds the appraisal row
  const [appraisalForm, setAppraisalForm] = useState({})
  const [appraisalSaving, setAppraisalSaving] = useState(false)
  const [employees, setEmployees] = useState([])

  const canEdit = can('hr.edit')

  const loadCycles = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase.from('appraisal_cycles')
      .select('*')
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    if (error) { showToast('Failed to load appraisal cycles', 'red'); console.error(error) }
    setCycles(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { loadCycles() }, [loadCycles, rt])

  // Load employees for reference
  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('status', 'active').order('name')
      .then(({ data }) => setEmployees(data || []))
  }, [currentSiteId])

  const empMap = useMemo(() => Object.fromEntries(employees.map(e => [e.id, e.name])), [employees])

  const loadAppraisals = useCallback(async (cycleId) => {
    setAppraisalLoading(true)
    const { data, error } = await supabase.from('appraisals')
      .select('*')
      .eq('cycle_id', cycleId)
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: true })
    if (error) { showToast('Failed to load appraisals', 'red'); console.error(error) }
    setAppraisals(data || [])
    setAppraisalLoading(false)
  }, [currentSiteId])

  const toggleCycle = (id) => {
    if (expandedCycleId === id) { setExpandedCycleId(null); setAppraisals([]); return }
    setExpandedCycleId(id)
    loadAppraisals(id)
  }

  const saveCycle = async () => {
    if (!cycleForm.name || !cycleForm.period_start || !cycleForm.period_end) {
      showToast('All fields required', 'red'); return
    }
    setSaving(true)
    const { error } = await supabase.from('appraisal_cycles').insert({
      ...cycleForm, site_id: currentSiteId, status: 'open',
    })
    setSaving(false)
    if (error) { showToast('Failed to create cycle', 'red'); console.error(error); return }
    showToast('Cycle created', 'green')
    setCycleModal(false)
    setCycleForm(EMPTY_CYCLE)
    loadCycles()
  }

  const closeCycle = async (cycleId) => {
    const { error } = await supabase.from('appraisal_cycles')
      .update({ status: 'closed' })
      .eq('id', cycleId)
      .eq('site_id', currentSiteId)
    if (error) { showToast('Failed to close cycle', 'red'); console.error(error); return }
    showToast('Cycle closed', 'green')
    loadCycles()
  }

  const openAppraisalModal = (row) => {
    setAppraisalModal(row)
    setAppraisalForm({
      self_score: row.self_score || '',
      self_comments: row.self_comments || '',
      manager_score: row.manager_score || '',
      manager_comments: row.manager_comments || '',
      final_score: row.final_score || '',
      rating: row.rating || '',
    })
  }

  const saveAppraisal = async () => {
    setAppraisalSaving(true)
    let status = 'pending'
    if (appraisalForm.final_score && appraisalForm.rating) status = 'final'
    else if (appraisalForm.manager_score) status = 'manager_complete'
    else if (appraisalForm.self_score) status = 'self_complete'

    const { error } = await supabase.from('appraisals')
      .update({
        self_score: appraisalForm.self_score ? Number(appraisalForm.self_score) : null,
        self_comments: appraisalForm.self_comments || null,
        manager_score: appraisalForm.manager_score ? Number(appraisalForm.manager_score) : null,
        manager_comments: appraisalForm.manager_comments || null,
        final_score: appraisalForm.final_score ? Number(appraisalForm.final_score) : null,
        rating: appraisalForm.rating || null,
        status,
      })
      .eq('id', appraisalModal.id)
      .eq('site_id', currentSiteId)
    setAppraisalSaving(false)
    if (error) { showToast('Failed to save appraisal', 'red'); console.error(error); return }
    showToast('Appraisal updated', 'green')
    setAppraisalModal(null)
    loadAppraisals(expandedCycleId)
  }

  if (!can('hr.view')) return <div style={{ padding: 40, color: THEME.textLow }}>You do not have permission to view this page.</div>

  return (
    <div style={{ padding: '0 24px 40px' }}>
      <PageHeader title="Performance Appraisals" accent={ACCENT} />

      {canEdit && (
        <div style={{ marginBottom: 16 }}>
          <Button onClick={() => setCycleModal(true)} accent={ACCENT}>+ Add Cycle</Button>
        </div>
      )}

      {loading ? (
        <div style={{ color: THEME.textLow, padding: 24 }}>Loading...</div>
      ) : cycles.length === 0 ? (
        <div style={{ color: THEME.textLow, padding: 24 }}>No appraisal cycles found.</div>
      ) : (
        <TableWrap>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <THead><tr><Th>Name</Th><Th>Period Start</Th><Th>Period End</Th><Th>Status</Th><Th></Th></tr></THead>
            <tbody>
              {cycles.map(c => {
                const meta = CYCLE_STATUS_META[c.status] || CYCLE_STATUS_META.open
                return (
                  <React.Fragment key={c.id}>
                    <TRow onClick={() => toggleCycle(c.id)} style={{ cursor: 'pointer' }}>
                      <Td>{c.name}</Td>
                      <Td>{fmtDate(c.period_start)}</Td>
                      <Td>{fmtDate(c.period_end)}</Td>
                      <Td><span style={badgeStyle(meta)}>{meta.label}</span></Td>
                      <Td>
                        {canEdit && c.status === 'open' && (
                          <Button onClick={(e) => { e.stopPropagation(); closeCycle(c.id) }} accent={THEME.textLow} small>Close Cycle</Button>
                        )}
                      </Td>
                    </TRow>
                    {expandedCycleId === c.id && (
                      <tr><td colSpan={5} style={{ padding: '8px 16px 16px', background: THEME.surfaceVar }}>
                        {appraisalLoading ? <div style={{ color: THEME.textLow }}>Loading appraisals...</div> : appraisals.length === 0 ? (
                          <div style={{ color: THEME.textLow }}>No appraisals in this cycle.</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr>
                              <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 13, color: THEME.textMed }}>Employee</th>
                              <th style={{ textAlign: 'center', padding: '6px 10px', fontSize: 13, color: THEME.textMed }}>Self</th>
                              <th style={{ textAlign: 'center', padding: '6px 10px', fontSize: 13, color: THEME.textMed }}>Manager</th>
                              <th style={{ textAlign: 'center', padding: '6px 10px', fontSize: 13, color: THEME.textMed }}>Final</th>
                              <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 13, color: THEME.textMed }}>Rating</th>
                              <th style={{ textAlign: 'left', padding: '6px 10px', fontSize: 13, color: THEME.textMed }}>Status</th>
                            </tr></thead>
                            <tbody>
                              {appraisals.map(a => {
                                const aMeta = APPRAISAL_STATUS_META[a.status] || APPRAISAL_STATUS_META.pending
                                return (
                                  <tr key={a.id} onClick={() => canEdit && openAppraisalModal(a)} style={{ cursor: canEdit ? 'pointer' : 'default', borderBottom: `1px solid ${THEME.outlineVar}` }}>
                                    <td style={{ padding: '8px 10px', fontSize: 14 }}>{empMap[a.employee_id] || a.employee_id}</td>
                                    <td style={{ padding: '8px 10px', fontSize: 14, textAlign: 'center' }}>{a.self_score ?? '-'}</td>
                                    <td style={{ padding: '8px 10px', fontSize: 14, textAlign: 'center' }}>{a.manager_score ?? '-'}</td>
                                    <td style={{ padding: '8px 10px', fontSize: 14, textAlign: 'center' }}>{a.final_score ?? '-'}</td>
                                    <td style={{ padding: '8px 10px', fontSize: 14 }}>{a.rating || '-'}</td>
                                    <td style={{ padding: '8px 10px' }}><span style={badgeStyle(aMeta)}>{aMeta.label}</span></td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </td></tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </TableWrap>
      )}

      {/* Add Cycle Modal */}
      {cycleModal && (
        <Modal title="New Appraisal Cycle" onClose={() => setCycleModal(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <SectionLabel>Name</SectionLabel>
              <input style={inputStyle} value={cycleForm.name} onChange={e => setCycleForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Q3 2026 Review" />
            </div>
            <div>
              <SectionLabel>Period Start</SectionLabel>
              <input style={inputStyle} type="date" value={cycleForm.period_start} onChange={e => setCycleForm(p => ({ ...p, period_start: e.target.value }))} />
            </div>
            <div>
              <SectionLabel>Period End</SectionLabel>
              <input style={inputStyle} type="date" value={cycleForm.period_end} onChange={e => setCycleForm(p => ({ ...p, period_end: e.target.value }))} />
            </div>
            <Button onClick={saveCycle} accent={ACCENT} disabled={saving}>{saving ? 'Saving...' : 'Create Cycle'}</Button>
          </div>
        </Modal>
      )}

      {/* Appraisal Form Modal */}
      {appraisalModal && (
        <Modal title={`Appraisal - ${empMap[appraisalModal.employee_id] || 'Employee'}`} onClose={() => setAppraisalModal(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <SectionLabel>Self Assessment</SectionLabel>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: THEME.textMed }}>Score (1-5)</label>
                <input style={inputStyle} type="number" min={1} max={5} value={appraisalForm.self_score} onChange={e => setAppraisalForm(p => ({ ...p, self_score: e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: THEME.textMed }}>Comments</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={appraisalForm.self_comments} onChange={e => setAppraisalForm(p => ({ ...p, self_comments: e.target.value }))} />
            </div>

            <SectionLabel>Manager Assessment</SectionLabel>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: THEME.textMed }}>Score (1-5)</label>
                <input style={inputStyle} type="number" min={1} max={5} value={appraisalForm.manager_score} onChange={e => setAppraisalForm(p => ({ ...p, manager_score: e.target.value }))} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: THEME.textMed }}>Comments</label>
              <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={appraisalForm.manager_comments} onChange={e => setAppraisalForm(p => ({ ...p, manager_comments: e.target.value }))} />
            </div>

            <SectionLabel>Final Assessment</SectionLabel>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: THEME.textMed }}>Final Score (1-5)</label>
                <input style={inputStyle} type="number" min={1} max={5} value={appraisalForm.final_score} onChange={e => setAppraisalForm(p => ({ ...p, final_score: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: THEME.textMed }}>Rating</label>
                <select style={selectStyle} value={appraisalForm.rating} onChange={e => setAppraisalForm(p => ({ ...p, rating: e.target.value }))}>
                  <option value="">Select rating...</option>
                  {RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <Button onClick={saveAppraisal} accent={ACCENT} disabled={appraisalSaving}>{appraisalSaving ? 'Saving...' : 'Save Appraisal'}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
