import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { supabase } from '../../supabaseClient'
import FuelQuickNav from './FuelQuickNav'
import {
  PageHeader, Card, Button, Modal, Icon, SectionLabel,
  showToast, fmtDate, TableWrap, THead, Th, TRow, Td,
} from '../../components/ui'
import { parseTxnNotes } from './fuelDisplay'

const FUEL_CLR = MODULE_COLORS.fuel

const ASSET_ICON = {
  vehicle:   'directions_car',
  equipment: 'precision_manufacturing',
  other:     'category',
}

const ASSET_TYPES = ['vehicle', 'equipment', 'other']

export default function FuelIssues({ setPage }) {
  const { can } = usePermissions()
  const { currentSite, currentSiteId } = useSite()
  const { tanks, issues, updateTransaction, softDeleteTransaction, loading } = useFuel()

  const canIssue     = can('fuel.create')
  const canEdit      = can('fuel.edit')
  const canDelete    = can('fuel.delete')
  const canView      = can('fuel.view')
  const canAcknowledge = can('fuel.approve')

  const [filter,   setFilter]   = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [ackTarget, setAckTarget] = useState(null)
  const [ackNote,   setAckNote]   = useState('')
  const [ackBusy,   setAckBusy]   = useState(false)

  // Edit state
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editReason, setEditReason] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteReason, setDeleteReason] = useState('')
  const [deleteSaving, setDeleteSaving] = useState(false)

  // Audit trail
  const [auditTarget, setAuditTarget] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)

  async function submitAck(query) {
    if (!ackTarget) return
    setAckBusy(true)
    const { error } = await supabase.rpc('acknowledge_fuel_issuance', {
      p_transaction_id: ackTarget.id,
      p_note:           ackNote.trim() || null,
      p_query:          !!query,
    })
    setAckBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(query ? 'Query raised' : 'Issuance acknowledged', 'green')
    setAckTarget(null); setAckNote('')
    setTimeout(() => window.location.reload(), 350)
  }

  if (!canView) return null

  function openEdit(issue) {
    setEditTarget(issue)
    setEditForm({
      transaction_date: issue.transaction_date,
      litres: issue.litres,
      docket_number: issue.docket_number || '',
      notes: issue.notes || '',
    })
    setEditReason('')
  }

  async function saveEdit() {
    if (!editReason.trim()) { showToast('Please provide a reason for this edit', 'red'); return }
    if (!editForm.litres || Number(editForm.litres) <= 0) { showToast('Enter valid litres', 'red'); return }
    setEditSaving(true)
    try {
      await updateTransaction(editTarget.id, {
        transaction_date: editForm.transaction_date,
        litres: Number(editForm.litres),
        docket_number: editForm.docket_number.trim() || null,
        notes: editForm.notes.trim() || null,
        edit_reason: editReason.trim(),
      })
      showToast('Transaction updated', 'green')
      setEditTarget(null)
    } catch (err) {
      showToast(err.message || 'Failed to update', 'red')
    } finally {
      setEditSaving(false)
    }
  }

  function openDelete(issue) {
    setDeleteTarget(issue)
    setDeleteReason('')
  }

  async function confirmDelete() {
    if (!deleteReason.trim()) { showToast('Please provide a reason for deletion', 'red'); return }
    setDeleteSaving(true)
    try {
      await softDeleteTransaction(deleteTarget.id, deleteReason.trim())
      showToast('Transaction deleted', 'green')
      setDeleteTarget(null)
    } catch (err) {
      showToast(err.message || 'Failed to delete', 'red')
    } finally {
      setDeleteSaving(false)
    }
  }

  async function openAudit(issue) {
    setAuditTarget(issue)
    setAuditLoading(true)
    const { data, error } = await supabase
      .from('fuel_edit_log')
      .select('*, changed_by_profile:profiles!fuel_edit_log_changed_by_fkey(id, full_name)')
      .eq('record_id', issue.id)
      .eq('site_id', currentSiteId)
      .order('changed_at', { ascending: false })
    setAuditLoading(false)
    if (error) {
      showToast('Could not load audit trail', 'red')
      setAuditLogs([])
    } else {
      setAuditLogs(data || [])
    }
  }

  const tankName = id => tanks.find(t => t.id === id)?.name || '—'

  const filtered = issues.filter(i => {
    if (filter !== 'all' && i.asset_type !== filter) return false
    if (dateFrom && i.transaction_date < dateFrom) return false
    if (dateTo   && i.transaction_date > dateTo)   return false
    return true
  })

  const kpis = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10)
    const monthStart = today.slice(0, 8) + '01'
    let todayL = 0, monthL = 0, monthCount = 0
    const byRecipient = {}
    for (const i of issues) {
      const l = Number(i.litres) || 0
      if (i.transaction_date === today) todayL += l
      if (i.transaction_date >= monthStart) {
        monthL += l; monthCount++
        const key = i.asset_name || 'Unknown'
        byRecipient[key] = (byRecipient[key] || 0) + l
      }
    }
    const top = Object.entries(byRecipient).sort((a, b) => b[1] - a[1])[0]
    return { todayL, monthL, monthCount, topName: top?.[0] || '—', topL: top?.[1] || 0 }
  }, [issues])

  if (loading) return null

  return (
    <div style={{ maxWidth: '1200px' }}>
      <FuelQuickNav setPage={setPage} current="fuel_issues" />
      <PageHeader
        title="Issuance History"
        site={currentSite}
        actions={canIssue && (
          <Button onClick={() => setPage('fuel_issuance')} icon="output">New Issuance</Button>
        )}
      />

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <Kpi icon="today"       label="Issued today"      value={`${kpis.todayL.toLocaleString()} L`} color={FUEL_CLR} />
        <Kpi icon="bar_chart"   label="Issued this month" value={`${kpis.monthL.toLocaleString()} L`} color={THEME.info}  sub={`${kpis.monthCount} issuance${kpis.monthCount === 1 ? '' : 's'}`} />
        <Kpi icon="trending_up" label="Top consumer (month)" value={kpis.topName} color={THEME.error} sub={kpis.topL ? `${kpis.topL.toLocaleString()} L` : null} small />
        <Kpi icon="receipt_long" label="Total records"    value={issues.length.toLocaleString()} color={THEME.success} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {['all', ...ASSET_TYPES].map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            style={{
              padding: '5px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 500,
              cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${filter === type ? THEME.primary : THEME.outline}`,
              background: filter === type ? THEME.surfaceVar : 'transparent',
              color: filter === type ? THEME.primary : THEME.textMed,
            }}
          >
            {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
            <span style={{ marginLeft: '4px', opacity: .6 }}>
              ({type === 'all' ? issues.length : issues.filter(i => i.asset_type === type).length})
            </span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={filterInputStyle} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 500, color: THEME.textLow, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.04em' }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={filterInputStyle} />
        </div>
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo('') }} style={clearBtnStyle}>Clear</button>
        )}
      </div>

      <Card style={{ padding: 0 }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: THEME.textLow }}>
            <Icon name="output" size={40} style={{ display: 'block', margin: '0 auto 10px', color: THEME.outline }} />
            <p style={{ fontSize: '14px', margin: 0 }}>
              {issues.length === 0 ? 'No fuel issuances recorded yet.' : 'No records match the current filters.'}
            </p>
          </div>
        ) : (
          <TableWrap>
            <THead>
              <Th>Date</Th>
              <Th>Recipient</Th>
              <Th>Tank</Th>
              <Th>Driver / Operator</Th>
              <Th>Authorised By</Th>
              <Th align="right">Litres</Th>
              <Th>Status</Th>
              {(canEdit || canDelete) && <Th align="center">Actions</Th>}
            </THead>
            <tbody>
              {filtered.map((issue, idx) => {
                const parsed     = parseTxnNotes(issue.notes)
                const driver     = parsed.driver || issue.operator_name
                const authorised = issue.approved_by_name || issue.authorised_by_name || parsed.authorised
                const hasEdits   = !!issue.updated_at
                return (
                  <TRow key={issue.id} last={idx === filtered.length - 1}>
                    <Td style={{ whiteSpace: 'nowrap' }}>{fmtDate(issue.transaction_date)}</Td>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: '8px', flexShrink: 0,
                          background: FUEL_CLR + '14',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon
                            name={issue.asset_type === 'equipment' && /generator/i.test(issue.asset_name || '') ? 'bolt' : (ASSET_ICON[issue.asset_type] || 'category')}
                            size={16} style={{ color: FUEL_CLR }}
                          />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: THEME.text, fontSize: '13px' }}>
                            {issue.asset_reg || issue.asset_name}
                          </div>
                          {issue.asset_reg && issue.asset_name && issue.asset_reg !== issue.asset_name && (
                            <div style={{ fontSize: '11px', color: THEME.textLow }}>{issue.asset_name}</div>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td style={{ fontSize: '12px', color: THEME.textMed }}>{tankName(issue.tank_id)}</Td>
                    <Td style={{ color: driver ? THEME.text : THEME.textLow, textTransform: 'capitalize' }}>
                      {driver || '—'}
                    </Td>
                    <Td style={{ color: authorised ? THEME.textMed : THEME.textLow }}>
                      {authorised || '—'}
                    </Td>
                    <Td align="right" style={{ fontWeight: 700, color: FUEL_CLR, whiteSpace: 'nowrap' }}>
                      {Number(issue.litres).toLocaleString(undefined, { maximumFractionDigits: 1 })} L
                    </Td>
                    <Td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                        {(() => {
                          const status = issue.acknowledgement_status || 'not_required'
                          const badge = parsed.legacy
                            ? { label: 'Imported', bg: THEME.surfaceVar, fg: THEME.textLow, icon: 'history' }
                            : {
                                not_required: { label: 'Via request',  bg: THEME.statusInfoBg,    fg: THEME.statusInfoText,    icon: 'link' },
                                pending:      { label: 'Pending',      bg: THEME.statusWarningBg, fg: THEME.statusWarningText, icon: 'schedule' },
                                acknowledged: { label: 'Acknowledged', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText, icon: 'check_circle' },
                                queried:      { label: 'Queried',      bg: THEME.statusErrorBg,   fg: THEME.statusErrorText,   icon: 'help' },
                              }[status] || { label: status, bg: THEME.surfaceVar, fg: THEME.textMed, icon: 'info' }
                          return (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '3px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
                              background: badge.bg, color: badge.fg, whiteSpace: 'nowrap',
                            }}>
                              <Icon name={badge.icon} size={11} style={{ color: badge.fg }} />
                              {badge.label}
                            </span>
                          )
                        })()}
                        {hasEdits && (
                          <button
                            onClick={() => openAudit(issue)}
                            style={{
                              padding: '2px 7px', borderRadius: '10px', fontSize: '9px', fontWeight: 600,
                              background: THEME.statusWarningBg, color: THEME.statusWarningText,
                              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                              display: 'inline-flex', alignItems: 'center', gap: '3px',
                            }}
                          >
                            <Icon name="edit_note" size={10} style={{ color: THEME.statusWarningText }} />
                            Edited
                          </button>
                        )}
                        {(issue.acknowledgement_status || 'not_required') === 'pending' && !parsed.legacy && canAcknowledge && (
                          <button
                            onClick={() => { setAckTarget(issue); setAckNote('') }}
                            style={{
                              padding: '3px 10px', borderRadius: '6px', border: 'none',
                              background: THEME.primary, color: '#fff',
                              fontSize: '10px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            Acknowledge
                          </button>
                        )}
                      </div>
                    </Td>
                    {(canEdit || canDelete) && (
                      <Td align="center">
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          {canEdit && (
                            <button onClick={() => openEdit(issue)} style={actionBtnStyle} title="Edit transaction">
                              <Icon name="edit" size={15} style={{ color: THEME.info }} />
                            </button>
                          )}
                          <button onClick={() => openAudit(issue)} style={actionBtnStyle} title="View audit trail">
                            <Icon name="history" size={15} style={{ color: THEME.textMed }} />
                          </button>
                          {canDelete && (
                            <button onClick={() => openDelete(issue)} style={actionBtnStyle} title="Delete transaction">
                              <Icon name="delete" size={15} style={{ color: THEME.error }} />
                            </button>
                          )}
                        </div>
                      </Td>
                    )}
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* ── Edit Transaction Modal ── */}
      <Modal dirty={true}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title="Edit Transaction"
        footer={
          <>
            <Button onClick={() => setEditTarget(null)} variant="text">Cancel</Button>
            <Button onClick={saveEdit} disabled={editSaving}>{editSaving ? 'Saving…' : 'Save Changes'}</Button>
          </>
        }
      >
        {editTarget && (
          <div style={{ fontSize: '13px' }}>
            <div style={{ padding: '10px 14px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>{editTarget.asset_reg || editTarget.asset_name}</div>
              <div style={{ color: THEME.textMed, fontSize: '12px', marginTop: '2px' }}>
                Tank: {tankName(editTarget.tank_id)} — Original: {Number(editTarget.litres).toFixed(1)} L
              </div>
            </div>

            <SectionLabel>Date</SectionLabel>
            <input
              type="date" value={editForm.transaction_date || ''}
              onChange={e => setEditForm(p => ({ ...p, transaction_date: e.target.value }))}
              style={inputStyle}
            />

            <SectionLabel>Litres *</SectionLabel>
            <input
              type="number" min="0.1" step="0.1"
              value={editForm.litres || ''}
              onChange={e => setEditForm(p => ({ ...p, litres: e.target.value }))}
              style={inputStyle}
            />

            <SectionLabel>Docket / Reference</SectionLabel>
            <input
              value={editForm.docket_number || ''}
              onChange={e => setEditForm(p => ({ ...p, docket_number: e.target.value }))}
              style={inputStyle}
            />

            <SectionLabel>Notes</SectionLabel>
            <textarea
              value={editForm.notes || ''}
              onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />

            <SectionLabel style={{ color: THEME.error }}>Reason for edit *</SectionLabel>
            <textarea
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              placeholder="Explain why this transaction is being modified…"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical', borderColor: !editReason.trim() ? THEME.error : THEME.outline }}
            />
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '-10px', marginBottom: '8px' }}>
              This reason will be recorded in the audit trail.
            </div>
          </div>
        )}
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal dirty={true}
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Transaction"
        footer={
          <>
            <Button onClick={() => setDeleteTarget(null)} variant="text">Cancel</Button>
            <Button
              onClick={confirmDelete}
              disabled={deleteSaving}
              style={{ background: THEME.error, color: '#fff' }}
            >
              {deleteSaving ? 'Deleting…' : 'Delete Transaction'}
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div style={{ fontSize: '13px' }}>
            <div style={{
              padding: '14px', borderRadius: '10px', marginBottom: '16px',
              background: THEME.statusErrorBg, border: `1px solid ${THEME.error}20`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Icon name="warning" size={18} style={{ color: THEME.error }} />
                <span style={{ fontWeight: 600, color: THEME.statusErrorText }}>This action cannot be undone</span>
              </div>
              <div style={{ color: THEME.text }}>
                You are about to delete an issuance of <strong>{Number(deleteTarget.litres).toFixed(1)} L</strong> to{' '}
                <strong>{deleteTarget.asset_reg || deleteTarget.asset_name}</strong> on {fmtDate(deleteTarget.transaction_date)}.
              </div>
            </div>

            <SectionLabel style={{ color: THEME.error }}>Reason for deletion *</SectionLabel>
            <textarea
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              placeholder="Explain why this transaction is being deleted…"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', borderColor: !deleteReason.trim() ? THEME.error : THEME.outline }}
            />
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '-10px' }}>
              This reason will be permanently recorded in the audit trail.
            </div>
          </div>
        )}
      </Modal>

      {/* ── Audit Trail Modal ── */}
      <Modal dirty={true}
        open={!!auditTarget}
        onClose={() => { setAuditTarget(null); setAuditLogs([]) }}
        title="Audit Trail"
      >
        {auditTarget && (
          <div style={{ fontSize: '13px' }}>
            <div style={{ padding: '10px 14px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '16px' }}>
              <div style={{ fontWeight: 600 }}>{auditTarget.asset_reg || auditTarget.asset_name}</div>
              <div style={{ color: THEME.textMed, fontSize: '12px', marginTop: '2px' }}>
                {Number(auditTarget.litres).toFixed(1)} L — {fmtDate(auditTarget.transaction_date)}
              </div>
            </div>

            {auditLoading ? (
              <div style={{ textAlign: 'center', padding: '30px', color: THEME.textLow }}>Loading…</div>
            ) : auditLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: THEME.textLow }}>
                <Icon name="verified" size={32} style={{ display: 'block', margin: '0 auto 8px', color: THEME.outline }} />
                No modifications recorded. This transaction has not been edited.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {auditLogs.map(log => {
                  const actionLabel = {
                    update: 'Edited',
                    soft_delete: 'Deleted',
                    delete: 'Hard Deleted',
                  }[log.action] || log.action
                  const actionColor = {
                    update: THEME.statusWarningText,
                    soft_delete: THEME.statusErrorText,
                    delete: THEME.statusErrorText,
                  }[log.action] || THEME.textMed
                  const actionBg = {
                    update: THEME.statusWarningBg,
                    soft_delete: THEME.statusErrorBg,
                    delete: THEME.statusErrorBg,
                  }[log.action] || THEME.surfaceVar
                  const actionIcon = {
                    update: 'edit',
                    soft_delete: 'delete',
                    delete: 'delete_forever',
                  }[log.action] || 'info'

                  const changedBy = log.changed_by_profile?.full_name || 'Unknown user'
                  const changedAt = new Date(log.changed_at)
                  const dateStr = changedAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                  const timeStr = changedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

                  const changes = []
                  if (log.old_values && log.new_values) {
                    const fields = ['litres', 'transaction_date', 'docket_number', 'notes', 'tank_id']
                    for (const f of fields) {
                      const ov = log.old_values[f], nv = log.new_values[f]
                      if (ov !== nv && (ov != null || nv != null)) {
                        let oldLabel = String(ov ?? '—')
                        let newLabel = String(nv ?? '—')
                        if (f === 'tank_id') {
                          oldLabel = tankName(ov)
                          newLabel = tankName(nv)
                        }
                        if (f === 'litres') {
                          oldLabel = `${Number(ov || 0).toFixed(1)} L`
                          newLabel = `${Number(nv || 0).toFixed(1)} L`
                        }
                        changes.push({ field: f.replace(/_/g, ' '), from: oldLabel, to: newLabel })
                      }
                    }
                  }

                  return (
                    <div key={log.id} style={{
                      border: `1px solid ${THEME.outlineVar}`,
                      borderRadius: '10px', padding: '12px 14px',
                      background: THEME.surface,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '3px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
                          background: actionBg, color: actionColor,
                        }}>
                          <Icon name={actionIcon} size={11} style={{ color: actionColor }} />
                          {actionLabel}
                        </span>
                        <span style={{ fontSize: '12px', color: THEME.textMed, fontWeight: 500 }}>
                          {changedBy}
                        </span>
                        <span style={{ marginLeft: 'auto', fontSize: '11px', color: THEME.textLow }}>
                          {dateStr} {timeStr}
                        </span>
                      </div>

                      {log.reason && (
                        <div style={{
                          padding: '8px 12px', borderRadius: '8px', marginBottom: '8px',
                          background: THEME.surfaceVar, fontStyle: 'italic', color: THEME.textMed,
                          fontSize: '12px', borderLeft: `3px solid ${actionColor}`,
                        }}>
                          "{log.reason}"
                        </div>
                      )}

                      {changes.length > 0 && (
                        <div style={{ fontSize: '12px' }}>
                          {changes.map((c, i) => (
                            <div key={i} style={{ display: 'flex', gap: '6px', padding: '3px 0', color: THEME.textMed }}>
                              <span style={{ fontWeight: 600, textTransform: 'capitalize', minWidth: '90px' }}>{c.field}:</span>
                              <span style={{ textDecoration: 'line-through', color: THEME.textLow }}>{c.from}</span>
                              <Icon name="arrow_forward" size={12} style={{ color: THEME.textLow }} />
                              <span style={{ fontWeight: 500, color: THEME.text }}>{c.to}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Acknowledge / Query manual issuance */}
      <Modal dirty={true}
        open={!!ackTarget}
        onClose={() => { setAckTarget(null); setAckNote('') }}
        title="Acknowledge fuel issuance"
        footer={
          <>
            <Button onClick={() => { setAckTarget(null); setAckNote('') }} variant="text">Cancel</Button>
            <Button onClick={() => submitAck(true)}  variant="outlined" disabled={ackBusy}>Query</Button>
            <Button onClick={() => submitAck(false)} disabled={ackBusy}>{ackBusy ? 'Saving…' : 'Acknowledge'}</Button>
          </>
        }
      >
        {ackTarget && (
          <div style={{ fontSize: '13px', color: THEME.text }}>
            <div style={{ padding: '10px 14px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '14px' }}>
              <div><strong>{Number(ackTarget.litres).toFixed(1)} L</strong> issued on {fmtDate(ackTarget.transaction_date)}</div>
              <div style={{ marginTop: '4px', color: THEME.textMed }}>
                Authorised by <strong>{ackTarget.authorised_by_name || '—'}</strong>
              </div>
              {ackTarget.authorisation_reason && (
                <div style={{ marginTop: '4px', color: THEME.textMed, fontStyle: 'italic' }}>
                  "{ackTarget.authorisation_reason}"
                </div>
              )}
            </div>
            <SectionLabel>Note (optional)</SectionLabel>
            <textarea
              value={ackNote}
              onChange={e => setAckNote(e.target.value)}
              placeholder="Any comment for the audit trail…"
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
            <div style={{ fontSize: '11px', color: THEME.textLow }}>
              Choose <strong>Acknowledge</strong> to confirm you authorised this issuance,
              or <strong>Query</strong> to flag it for follow-up.
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Kpi({ icon, label, value, sub, color, small }) {
  return (
    <div style={{
      background: THEME.surface, border: `1px solid ${THEME.outlineVar}`,
      borderRadius: '12px', padding: '14px 16px',
      display: 'flex', gap: '12px', alignItems: 'flex-start',
      boxShadow: '0 1px 2px rgba(0,0,0,.03)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '10px', flexShrink: 0,
        background: color + '16',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={18} style={{ color }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: '3px' }}>
          {label}
        </div>
        <div style={{
          fontSize: small ? '14px' : '20px', fontWeight: small ? 600 : 700,
          color: THEME.text, lineHeight: 1.15,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value}
        </div>
        {sub && <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '2px' }}>{sub}</div>}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface, marginBottom: '14px', display: 'block',
}

const filterInputStyle = {
  padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', background: THEME.surface,
}

const clearBtnStyle = {
  background: 'none', border: `1px solid ${THEME.outline}`, borderRadius: '8px',
  padding: '9px 14px', cursor: 'pointer', fontSize: '12px', color: THEME.textMed,
  fontFamily: 'inherit', alignSelf: 'flex-end',
}

const actionBtnStyle = {
  width: 30, height: 30, borderRadius: '8px', border: 'none',
  background: 'transparent', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
