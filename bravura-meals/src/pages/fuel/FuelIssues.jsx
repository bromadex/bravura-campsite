import { useState, useMemo } from 'react'
import { useFuel } from '../../contexts/FuelContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { supabase } from '../../supabaseClient'
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

// Fuel transactions are IMMUTABLE — no edit or delete is permitted.
// If a correction is needed, record a new 'adjustment' transaction.

const ASSET_TYPES = ['vehicle', 'equipment', 'other']

const BLANK_FORM = {
  transaction_date: new Date().toISOString().slice(0, 10),
  tank_id:          '',
  litres:           '',
  asset_type:       'vehicle',
  vehicle_id:       '',
  equipment_id:     '',
  asset_description:'',
  docket_number:    '',
  notes:            '',
}

export default function FuelIssues({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const { tanks, issues, addTransaction, loading } = useFuel()

  const canIssue     = can('fuel.create')
  const canView      = can('fuel.view')
  const canAcknowledge = can('fuel.approve')

  const [modal,    setModal]    = useState(false)
  const [form,     setForm]     = useState(BLANK_FORM)
  const [saving,   setSaving]   = useState(false)
  const [filter,   setFilter]   = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [ackTarget, setAckTarget] = useState(null)
  const [ackNote,   setAckNote]   = useState('')
  const [ackBusy,   setAckBusy]   = useState(false)

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
    // useFuel context refreshes on next mount; force a soft refresh via reload for now
    setTimeout(() => window.location.reload(), 350)
  }

  if (!canView) return null

  function openAdd() {
    setForm({ ...BLANK_FORM, transaction_date: new Date().toISOString().slice(0, 10) })
    setModal(true)
  }

  function set(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value }
      // Clear sub-fields when asset type changes
      if (field === 'asset_type') {
        next.vehicle_id        = ''
        next.equipment_id      = ''
        next.asset_description = ''
      }
      return next
    })
  }

  async function save() {
    if (!form.tank_id) { showToast('Select a tank', 'red'); return }
    if (!form.litres || isNaN(form.litres) || Number(form.litres) <= 0) {
      showToast('Enter a valid quantity in litres', 'red'); return
    }
    if (form.asset_type === 'other' && !form.asset_description.trim()) {
      showToast('Enter a description for the fuel recipient', 'red'); return
    }

    const tank = tanks.find(t => t.id === form.tank_id)
    if (tank && Number(form.litres) > Number(tank.current_level_litres)) {
      showToast(`Insufficient stock — tank has only ${Number(tank.current_level_litres).toFixed(1)} L`, 'red')
      return
    }

    setSaving(true)
    try {
      await addTransaction({
        transaction_type:  'issuance',
        transaction_date:  form.transaction_date,
        tank_id:           form.tank_id,
        litres:            Number(form.litres),
        vehicle_id:        form.asset_type === 'vehicle'   ? form.vehicle_id   || null : null,
        equipment_id:      form.asset_type === 'equipment' ? form.equipment_id || null : null,
        asset_description: form.asset_type === 'other'     ? form.asset_description.trim() : null,
        docket_number:     form.docket_number.trim() || null,
        notes:             form.notes.trim() || null,
      })
      showToast('Fuel issuance recorded', 'green')
      setModal(false)
    } catch (err) {
      showToast(err.message || 'Failed to record issuance', 'red')
    } finally {
      setSaving(false)
    }
  }

  const tankName = id => tanks.find(t => t.id === id)?.name || '—'

  const filtered = issues.filter(i => {
    if (filter !== 'all' && i.asset_type !== filter) return false
    if (dateFrom && i.transaction_date < dateFrom) return false
    if (dateTo   && i.transaction_date > dateTo)   return false
    return true
  })

  // ── KPI strip ──────────────────────────────────────────────────────────
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

  const activeTanks = tanks.filter(t => t.status === 'active' && !t.is_archived)

  if (loading) return null

  return (
    <div style={{ maxWidth: '1200px' }}>
      <PageHeader
        title="Fuel Issuances"
        site={currentSite}
        actions={canIssue && (
          <Button onClick={() => setPage('fuel_issuance')} icon="output">New Issuance</Button>
        )}
      />

      {/* ── KPI strip ── */}
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
              <Th>Driver / Operator</Th>
              <Th>Purpose</Th>
              <Th>Authorised By</Th>
              <Th align="right">Litres</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {filtered.map((issue, idx) => {
                const parsed     = parseTxnNotes(issue.notes)
                const driver     = parsed.driver
                const purpose    = parsed.purpose || parsed.clean
                const authorised = issue.authorised_by_name || parsed.authorised
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
                    <Td style={{ color: driver ? THEME.text : THEME.textLow, textTransform: 'capitalize' }}>
                      {driver || '—'}
                    </Td>
                    <Td style={{ color: purpose ? THEME.textMed : THEME.textLow, maxWidth: '180px' }}>
                      <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {purpose || '—'}
                      </span>
                    </Td>
                    <Td style={{ color: authorised ? THEME.textMed : THEME.textLow }}>
                      {authorised || '—'}
                    </Td>
                    <Td align="right" style={{ fontWeight: 700, color: FUEL_CLR, whiteSpace: 'nowrap' }}>
                      {Number(issue.litres).toLocaleString(undefined, { maximumFractionDigits: 1 })} L
                    </Td>
                    <Td>
                      {(() => {
                        const status = issue.acknowledgement_status || 'not_required'
                        // Legacy imports carry 'not_required' but were never
                        // linked to a request — show a neutral Imported chip
                        // instead of the misleading "Linked to request".
                        const badge = parsed.legacy
                          ? { label: 'Imported',      bg: THEME.surfaceVar,      fg: THEME.textLow,          icon: 'history' }
                          : {
                              not_required: { label: 'Via request',  bg: THEME.statusInfoBg,    fg: THEME.statusInfoText,    icon: 'link' },
                              pending:      { label: 'Pending',      bg: THEME.statusWarningBg, fg: THEME.statusWarningText, icon: 'schedule' },
                              acknowledged: { label: 'Acknowledged', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText, icon: 'check_circle' },
                              queried:      { label: 'Queried',      bg: THEME.statusErrorBg,   fg: THEME.statusErrorText,   icon: 'help' },
                            }[status] || { label: status, bg: THEME.surfaceVar, fg: THEME.textMed, icon: 'info' }
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-start' }}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '4px',
                              padding: '3px 9px', borderRadius: '20px', fontSize: '10px', fontWeight: 600,
                              background: badge.bg, color: badge.fg, whiteSpace: 'nowrap',
                            }}>
                              <Icon name={badge.icon} size={11} style={{ color: badge.fg }} />
                              {badge.label}
                            </span>
                            {status === 'pending' && !parsed.legacy && canAcknowledge && (
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
                        )
                      })()}
                    </Td>
                  </TRow>
                )
              })}
            </tbody>
          </TableWrap>
        )}
      </Card>

      {/* Record Issuance Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title="Record Fuel Issuance"
        footer={
          <>
            <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Record Issuance'}</Button>
          </>
        }
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
          <div>
            <SectionLabel>Date</SectionLabel>
            <input
              type="date" value={form.transaction_date}
              onChange={e => set('transaction_date', e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <SectionLabel>Tank *</SectionLabel>
            <select value={form.tank_id} onChange={e => set('tank_id', e.target.value)} style={inputStyle}>
              <option value="">— Select tank —</option>
              {activeTanks.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({Number(t.current_level_litres).toFixed(0)} L available)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <SectionLabel>Litres Issued *</SectionLabel>
          <input
            type="number" min="0.1" step="0.1"
            value={form.litres}
            onChange={e => set('litres', e.target.value)}
            placeholder="e.g. 80"
            style={inputStyle}
          />
        </div>

        <div>
          <SectionLabel>Recipient Type *</SectionLabel>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            {ASSET_TYPES.map(type => (
              <button
                key={type}
                type="button"
                onClick={() => set('asset_type', type)}
                style={{
                  flex: 1, padding: '9px', borderRadius: '10px', fontSize: '13px', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                  border: `1.5px solid ${form.asset_type === type ? THEME.primary : THEME.outline}`,
                  background: form.asset_type === type ? THEME.surfaceVar : 'transparent',
                  color: form.asset_type === type ? THEME.primary : THEME.textMed,
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {form.asset_type === 'other' && (
          <div>
            <SectionLabel>Recipient Description *</SectionLabel>
            <input
              value={form.asset_description}
              onChange={e => set('asset_description', e.target.value)}
              placeholder="e.g. Site Generator #2, Welding equipment"
              style={inputStyle}
            />
          </div>
        )}

        {form.asset_type === 'vehicle' && (
          <div style={{ padding: '12px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '14px', fontSize: '13px', color: THEME.textMed }}>
            <Icon name="info" size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Vehicle registry coming soon. Use "Other" and enter the fleet number or registration for now.
          </div>
        )}

        {form.asset_type === 'equipment' && (
          <div style={{ padding: '12px', borderRadius: '10px', background: THEME.surfaceVar, marginBottom: '14px', fontSize: '13px', color: THEME.textMed }}>
            <Icon name="info" size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />
            Equipment registry coming soon. Use "Other" and enter the equipment number for now.
          </div>
        )}

        <div>
          <SectionLabel>Docket / Reference Number</SectionLabel>
          <input
            value={form.docket_number}
            onChange={e => set('docket_number', e.target.value)}
            placeholder="e.g. DOC-001"
            style={inputStyle}
          />
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Purpose, destination, driver name…"
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </div>
      </Modal>

      {/* Acknowledge / Query manual issuance */}
      <Modal
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
