import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import { useFuel } from '../../contexts/FuelContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'

const COLOR = MODULE_COLORS.fuel

const Icon = ({ name, size = 18, style = {} }) => (
  <span className="material-symbols-rounded" style={{ fontSize: size, lineHeight: 1, userSelect: 'none', color: 'inherit', ...style }}>{name}</span>
)

const btn = (extra = {}) => ({
  border: 'none', borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
  fontWeight: 600, fontSize: '13px', padding: '8px 16px',
  display: 'inline-flex', alignItems: 'center', gap: '6px', transition: 'opacity .15s',
  ...extra,
})

const inputStyle = {
  padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`,
  background: THEME.surfaceVar, color: THEME.text, fontSize: '13px',
  fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
}

const STATUS_META = {
  draft:     { label: 'Draft',     bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText  },
  submitted: { label: 'Submitted', bg: THEME.statusInfoBg,     text: THEME.statusInfoText     },
  approved:  { label: 'Approved',  bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText  },
  queried:   { label: 'Queried',   bg: THEME.statusWarningBg,  text: THEME.statusWarningText  },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.draft
  return (
    <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, background: m.bg, color: m.text }}>
      {m.label}
    </span>
  )
}

const Field = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
    <label style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed }}>{label}</label>
    {children}
  </div>
)

function varianceColor(pct) {
  if (pct == null) return THEME.textMed
  const abs = Math.abs(pct)
  if (abs <= 2) return THEME.success
  if (abs <= 5) return THEME.warning
  return THEME.error
}

function varianceBg(pct) {
  if (pct == null) return THEME.surfaceVar
  const abs = Math.abs(pct)
  if (abs <= 2) return THEME.statusSuccessBg
  if (abs <= 5) return THEME.statusWarningBg
  return THEME.statusErrorBg
}

// ── New Reconciliation Form ───────────────────────────────────────────────────
function NewReconciliationForm({ tanks, currentSiteId, profileId, onSaved, onCancel }) {
  const [tankId, setTankId] = useState(tanks[0]?.id || '')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10)
  })
  const [calc, setCalc] = useState(null)
  const [calculating, setCalculating] = useState(false)
  const [closingActual, setClosingActual] = useState('')
  const [varianceNotes, setVarianceNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [reconNo, setReconNo] = useState('')

  // Auto-suggest period start from last reconciliation
  useEffect(() => {
    if (!tankId || !currentSiteId) return
    supabase.from('fuel_reconciliations')
      .select('period_end, reconciliation_number')
      .eq('site_id', currentSiteId)
      .eq('tank_id', tankId)
      .order('period_end', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.length) {
          const d = new Date(data[0].period_end + 'T00:00:00')
          d.setDate(d.getDate() + 1)
          setPeriodStart(d.toISOString().slice(0, 10))
        } else {
          setPeriodStart('')
        }
      })

    // Generate reconciliation number
    supabase.from('fuel_reconciliations')
      .select('reconciliation_number')
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data?.length) {
          const num = parseInt(data[0].reconciliation_number.replace(/\D/g, ''), 10)
          setReconNo(`RC-${String(num + 1).padStart(4, '0')}`)
        } else {
          setReconNo('RC-0001')
        }
      })
  }, [tankId, currentSiteId])

  const calculate = async () => {
    if (!tankId || !periodStart || !periodEnd) return
    setCalculating(true)
    setCalc(null)

    // Opening level: closing of previous recon, or current tank level as fallback
    const { data: prevRecon } = await supabase.from('fuel_reconciliations')
      .select('closing_level_actual')
      .eq('site_id', currentSiteId)
      .eq('tank_id', tankId)
      .lt('period_end', periodStart)
      .order('period_end', { ascending: false })
      .limit(1)

    let openingLevel = prevRecon?.[0]?.closing_level_actual ?? null

    if (openingLevel == null) {
      // Fall back to earliest dip reading in or before period
      const { data: dip } = await supabase.from('fuel_dip_readings')
        .select('level_litres')
        .eq('site_id', currentSiteId)
        .eq('tank_id', tankId)
        .lte('reading_date', periodStart)
        .order('reading_date', { ascending: false })
        .limit(1)
      openingLevel = dip?.[0]?.level_litres ?? 0
    }

    // Aggregate transactions in period
    const { data: txns } = await supabase.from('fuel_transactions')
      .select('transaction_type, litres')
      .eq('site_id', currentSiteId)
      .eq('is_deleted', false)
      .eq('tank_id', tankId)
      .gte('transaction_date', periodStart)
      .lte('transaction_date', periodEnd)

    let delivered = 0, issued = 0, adjustments = 0
    for (const t of txns || []) {
      if (t.transaction_type === 'delivery')   delivered    += Number(t.litres) || 0
      if (t.transaction_type === 'issuance')   issued       += Number(t.litres) || 0
      if (t.transaction_type === 'adjustment') adjustments  += Number(t.litres) || 0
    }

    const expected = openingLevel + delivered - issued + adjustments

    // Latest dip reading as suggested closing actual
    const { data: latestDip } = await supabase.from('fuel_dip_readings')
      .select('level_litres, reading_date')
      .eq('site_id', currentSiteId)
      .eq('tank_id', tankId)
      .lte('reading_date', periodEnd)
      .gte('reading_date', periodStart)
      .order('reading_date', { ascending: false })
      .limit(1)

    const suggestedActual = latestDip?.[0]?.level_litres ?? null

    setCalc({ openingLevel, delivered, issued, adjustments, expected, suggestedActual })
    if (suggestedActual != null) setClosingActual(String(suggestedActual))
    setCalculating(false)
  }

  const closingActualNum = parseFloat(closingActual)
  const variance = calc && !isNaN(closingActualNum) ? closingActualNum - calc.expected : null
  const variancePct = variance != null && calc?.openingLevel > 0
    ? (variance / calc.openingLevel) * 100 : null
  const highVariance = variancePct != null && Math.abs(variancePct) > 5
  const canSubmit = calc && !isNaN(closingActualNum) && (!highVariance || varianceNotes.trim())

  const saveDraft = async (submit = false) => {
    if (!calc || isNaN(closingActualNum)) return
    setSaving(true)
    const payload = {
      site_id: currentSiteId,
      reconciliation_number: reconNo,
      tank_id: tankId,
      period_start: periodStart,
      period_end: periodEnd,
      opening_level_litres: calc.openingLevel,
      total_delivered_litres: calc.delivered,
      total_issued_litres: calc.issued,
      total_adjustments_litres: calc.adjustments,
      closing_level_expected: calc.expected,
      closing_level_actual: closingActualNum,
      variance_litres: variance,
      variance_percent: variancePct,
      variance_notes: varianceNotes || null,
      status: submit ? 'submitted' : 'draft',
      submitted_by: submit ? profileId : null,
      submitted_at: submit ? new Date().toISOString() : null,
      created_by: profileId,
    }
    const { error } = await supabase.from('fuel_reconciliations').insert(payload)
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'

  return (
    <div style={{ background: THEME.surface, borderRadius: '10px', border: `1px solid ${THEME.outlineVar}`, boxShadow: THEME.shadow2, marginBottom: '24px' }}>
      <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>New Reconciliation</div>
          <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>Ref: {reconNo}</div>
        </div>
        <button onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="close" size={20} /></button>
      </div>

      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Field label="Tank">
          <select value={tankId} onChange={e => { setTankId(e.target.value); setCalc(null) }} style={inputStyle}>
            {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Field label="Period Start">
            <input type="date" value={periodStart} onChange={e => { setPeriodStart(e.target.value); setCalc(null) }} style={inputStyle} />
          </Field>
          <Field label="Period End">
            <input type="date" value={periodEnd} onChange={e => { setPeriodEnd(e.target.value); setCalc(null) }} style={inputStyle} />
          </Field>
        </div>

        <button
          onClick={calculate}
          disabled={!tankId || !periodStart || !periodEnd || calculating}
          style={{ ...btn({ background: COLOR + '18', color: COLOR, border: `1px solid ${COLOR}44`, alignSelf: 'flex-start', opacity: (!tankId || !periodStart || !periodEnd) ? 0.5 : 1 }) }}
        >
          <Icon name="calculate" size={15} />
          {calculating ? 'Calculating…' : 'Calculate'}
        </button>

        {calc && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Calculation breakdown */}
            <div style={{ background: THEME.surfaceVar, borderRadius: '12px', padding: '16px 20px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: '12px' }}>Calculation Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
                {[
                  { label: 'Opening Level', value: fmt(calc.openingLevel) + ' L', highlight: false },
                  { label: '+ Total Delivered', value: '+' + fmt(calc.delivered) + ' L', highlight: false },
                  { label: '− Total Issued', value: '−' + fmt(calc.issued) + ' L', highlight: false },
                  { label: '± Adjustments', value: (calc.adjustments >= 0 ? '+' : '') + fmt(calc.adjustments) + ' L', highlight: false },
                  { label: '= Expected Closing', value: fmt(calc.expected) + ' L', highlight: true },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: r.highlight ? '8px' : 0, borderTop: r.highlight ? `1px solid ${THEME.outline}` : 'none' }}>
                    <span style={{ color: THEME.textMed, fontWeight: r.highlight ? 600 : 400 }}>{r.label}</span>
                    <span style={{ color: r.highlight ? THEME.text : THEME.textMed, fontWeight: r.highlight ? 700 : 400 }}>{r.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Actual closing level */}
            <Field label={`Actual Closing Level (litres)${calc.suggestedActual != null ? ' — pre-filled from latest dip reading' : ''}`}>
              <input
                type="number" step="0.001"
                value={closingActual}
                onChange={e => { setClosingActual(e.target.value) }}
                placeholder="Enter actual dip reading"
                style={inputStyle}
              />
            </Field>

            {/* Variance summary */}
            {variance !== null && (
              <div style={{ background: varianceBg(variancePct), border: `1px solid ${varianceColor(variancePct)}44`, borderRadius: '12px', padding: '16px 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: varianceColor(variancePct) }}>Variance</span>
                  <div style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '20px', fontWeight: 700, color: varianceColor(variancePct) }}>
                      {variance >= 0 ? '+' : ''}{fmt(variance)} L
                    </span>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: varianceColor(variancePct) }}>
                      ({variancePct >= 0 ? '+' : ''}{Number(variancePct).toFixed(2)}%)
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: '12px', color: THEME.textMed }}>
                  {Math.abs(variancePct) <= 2 ? 'Within acceptable tolerance (±2%)' :
                   Math.abs(variancePct) <= 5 ? 'Within warning threshold (±5%)' :
                   'Exceeds tolerance — explanation required'}
                </div>
              </div>
            )}

            {highVariance && (
              <Field label="Variance Explanation (required)">
                <textarea
                  value={varianceNotes}
                  onChange={e => setVarianceNotes(e.target.value)}
                  rows={3}
                  placeholder="Explain the variance (theft, evaporation, meter error, etc.)"
                  style={{ ...inputStyle, resize: 'vertical', border: `1px solid ${!varianceNotes.trim() ? THEME.error : THEME.outline}` }}
                />
              </Field>
            )}
          </div>
        )}
      </div>

      {calc && (
        <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onCancel} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>Cancel</button>
          <button onClick={() => saveDraft(false)} disabled={!canSubmit || saving} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.text, border: `1px solid ${THEME.outline}`, opacity: (!canSubmit || saving) ? 0.5 : 1 }) }}>
            <Icon name="save" size={15} /> Save Draft
          </button>
          <button onClick={() => saveDraft(true)} disabled={!canSubmit || saving} style={{ ...btn({ background: COLOR, color: '#fff', opacity: (!canSubmit || saving) ? 0.5 : 1 }) }}>
            <Icon name="send" size={15} /> Submit
          </button>
        </div>
      )}
    </div>
  )
}

// ── Approve / Query Modal ─────────────────────────────────────────────────────
function ReviewModal({ recon, profileId, onClose, onSaved }) {
  const [queryNotes, setQueryNotes] = useState('')
  const [mode, setMode] = useState('approve') // 'approve' | 'query'
  const [saving, setSaving] = useState(false)

  const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'

  const submit = async () => {
    setSaving(true)
    const update = mode === 'approve'
      ? { status: 'approved', approved_by: profileId, approved_at: new Date().toISOString() }
      : { status: 'queried', query_notes: queryNotes }
    const { error } = await supabase.from('fuel_reconciliations').update(update).eq('id', recon.id)
    setSaving(false)
    if (error) { alert(error.message); return }
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: THEME.surface, borderRadius: '10px', width: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: THEME.shadow3 }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: THEME.text }}>Review Reconciliation</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '2px' }}>{recon.reconciliation_number} — {recon.tank?.name}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="close" size={20} /></button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Summary */}
          <div style={{ background: THEME.surfaceVar, borderRadius: '12px', padding: '16px 20px', fontSize: '13px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: THEME.textMed }}>Period</span>
                <span style={{ color: THEME.text, fontWeight: 500 }}>
                  {new Date(recon.period_start + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – {new Date(recon.period_end + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
              {[
                ['Opening Level', fmt(recon.opening_level_litres) + ' L'],
                ['Total Delivered', '+' + fmt(recon.total_delivered_litres) + ' L'],
                ['Total Issued', '−' + fmt(recon.total_issued_litres) + ' L'],
                ['Adjustments', (Number(recon.total_adjustments_litres) >= 0 ? '+' : '') + fmt(recon.total_adjustments_litres) + ' L'],
                ['Expected Closing', fmt(recon.closing_level_expected) + ' L'],
                ['Actual Closing (dip)', fmt(recon.closing_level_actual) + ' L'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: THEME.textMed }}>{k}</span>
                  <span style={{ color: THEME.text }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Variance */}
          <div style={{ background: varianceBg(recon.variance_percent), border: `1px solid ${varianceColor(recon.variance_percent)}44`, borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: varianceColor(recon.variance_percent) }}>Variance</span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: varianceColor(recon.variance_percent) }}>
              {Number(recon.variance_litres) >= 0 ? '+' : ''}{fmt(recon.variance_litres)} L &nbsp;({Number(recon.variance_percent) >= 0 ? '+' : ''}{Number(recon.variance_percent).toFixed(2)}%)
            </span>
          </div>

          {recon.variance_notes && (
            <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '12px 16px', fontSize: '13px', color: THEME.textMed }}>
              <div style={{ fontSize: '11px', fontWeight: 600, marginBottom: '4px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.08em' }}>Variance Notes</div>
              {recon.variance_notes}
            </div>
          )}

          {/* Approve / Query toggle */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {['approve', 'query'].map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                ...btn({ padding: '7px 16px', fontSize: '12px' }),
                background: mode === m ? (m === 'approve' ? THEME.statusSuccessBg : THEME.statusWarningBg) : THEME.surfaceVar,
                color: mode === m ? (m === 'approve' ? THEME.success : THEME.warning) : THEME.textMed,
                border: `1px solid ${mode === m ? (m === 'approve' ? THEME.success + '44' : THEME.warning + '44') : THEME.outline}`,
              }}>
                <Icon name={m === 'approve' ? 'check_circle' : 'help'} size={14} />
                {m === 'approve' ? 'Approve' : 'Query'}
              </button>
            ))}
          </div>

          {mode === 'query' && (
            <Field label="Query Notes (required)">
              <textarea
                value={queryNotes}
                onChange={e => setQueryNotes(e.target.value)}
                rows={4}
                placeholder="Describe the issue or what needs clarification"
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </Field>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button onClick={onClose} style={{ ...btn({ background: THEME.surfaceVar, color: THEME.textMed }) }}>Cancel</button>
          <button
            onClick={submit}
            disabled={(mode === 'query' && !queryNotes.trim()) || saving}
            style={{
              ...btn({
                background: mode === 'approve' ? THEME.success : THEME.warning,
                color: '#fff',
                opacity: ((mode === 'query' && !queryNotes.trim()) || saving) ? 0.5 : 1,
              })
            }}
          >
            <Icon name={mode === 'approve' ? 'check_circle' : 'help'} size={15} />
            {mode === 'approve' ? 'Approve' : 'Send Query'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Reconciliation() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { tanks: allTanks, profile } = useFuel()
  // Dip-variance reconciliation only makes sense for tanks that are actually
  // dipped — drums/containers on an issuance running balance have no dips.
  const tanks = useMemo(() => allTanks.filter(t => t.level_tracking_method !== 'issuance'), [allTanks])

  const [reconciliations, setReconciliations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [reviewTarget, setReviewTarget] = useState(null)
  const [filterTank, setFilterTank] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('fuel_reconciliations')
      .select('*, tank:fuel_tanks(name), submitter:profiles!submitted_by(full_name), approver:profiles!approved_by(full_name)')
      .eq('site_id', currentSiteId)
      .order('period_end', { ascending: false })
    if (filterTank) q = q.eq('tank_id', filterTank)
    if (filterStatus) q = q.eq('status', filterStatus)
    if (filterFrom) q = q.gte('period_end', filterFrom)
    if (filterTo) q = q.lte('period_end', filterTo)
    const { data } = await q
    setReconciliations(data || [])
    setLoading(false)
  }, [currentSiteId, filterTank, filterStatus, filterFrom, filterTo])

  useEffect(() => { load() }, [load])

  const fmt = (n, dec = 1) => n != null ? Number(n).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—'
  const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  const selStyle = { padding: '7px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surfaceVar, color: THEME.text, fontSize: '12px', fontFamily: 'inherit' }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 400, color: THEME.text }}>Tank Reconciliation</h2>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: THEME.textMed }}>Period-end stock reconciliation — compare system vs physical dip</p>
        </div>
        {can('fuel.create') && !showNew && (
          <button onClick={() => setShowNew(true)} style={{ ...btn({ background: COLOR, color: '#fff' }) }}>
            <Icon name="add" size={15} /> New Reconciliation
          </button>
        )}
      </div>

      {showNew && (
        <NewReconciliationForm
          tanks={tanks}
          currentSiteId={currentSiteId}
          profileId={profile?.id}
          onSaved={() => { setShowNew(false); load() }}
          onCancel={() => setShowNew(false)}
        />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px', padding: '14px 16px', background: THEME.surfaceVar, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}` }}>
        <select value={filterTank} onChange={e => setFilterTank(e.target.value)} style={selStyle}>
          <option value="">All Tanks</option>
          {tanks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={selStyle}>
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="queried">Queried</option>
        </select>
        <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} style={selStyle} />
        <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} style={selStyle} />
        {(filterTank || filterStatus || filterFrom || filterTo) && (
          <button onClick={() => { setFilterTank(''); setFilterStatus(''); setFilterFrom(''); setFilterTo('') }}
            style={{ ...btn({ background: 'transparent', color: THEME.textMed, border: `1px solid ${THEME.outline}` }) }}>
            <Icon name="close" size={13} /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: THEME.surface, borderRadius: '12px', border: `1px solid ${THEME.outlineVar}`, overflow: 'hidden', boxShadow: THEME.shadow1 }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>
        ) : reconciliations.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <Icon name="balance" size={40} style={{ color: THEME.textLow, display: 'block', margin: '0 auto 12px' }} />
            <div style={{ fontSize: '14px', color: THEME.textMed }}>No reconciliations yet</div>
            {can('fuel.create') && !showNew && (
              <button onClick={() => setShowNew(true)} style={{ ...btn({ background: COLOR, color: '#fff', marginTop: '16px' }) }}>
                <Icon name="add" size={15} /> New Reconciliation
              </button>
            )}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  {['Ref #', 'Tank', 'Period', 'Expected Closing', 'Actual Closing', 'Variance', 'Status', 'Submitted By', ''].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reconciliations.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 14px', color: COLOR, fontWeight: 600 }}>{r.reconciliation_number}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{r.tank?.name || '—'}</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, whiteSpace: 'nowrap', fontSize: '12px' }}>
                      {fmtDate(r.period_start)}<br />
                      <span style={{ color: THEME.textMed }}>to {fmtDate(r.period_end)}</span>
                    </td>
                    <td style={{ padding: '10px 14px', color: THEME.text }}>{fmt(r.closing_level_expected)} L</td>
                    <td style={{ padding: '10px 14px', color: THEME.text, fontWeight: 500 }}>{fmt(r.closing_level_actual)} L</td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.variance_percent != null ? (
                        <span style={{ color: varianceColor(r.variance_percent), fontWeight: 600, fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          {Number(r.variance_litres) >= 0 ? '+' : ''}{fmt(r.variance_litres)} L
                          <span style={{ fontSize: '11px' }}>({Number(r.variance_percent) >= 0 ? '+' : ''}{Number(r.variance_percent).toFixed(1)}%)</span>
                          {Math.abs(r.variance_percent) > 5 && <Icon name="warning" size={13} style={{ color: varianceColor(r.variance_percent) }} />}
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}><StatusBadge status={r.status} /></td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed, fontSize: '12px' }}>
                      {r.submitter?.full_name || '—'}
                      {r.submitted_at && <div style={{ fontSize: '10px', color: THEME.textLow }}>{fmtDate(r.submitted_at?.slice(0, 10))}</div>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {r.status === 'submitted' && can('fuel.approve') && (
                        <button onClick={() => setReviewTarget(r)} style={{ ...btn({ background: THEME.statusInfoBg, color: THEME.info, padding: '5px 10px', fontSize: '11px' }) }}>
                          <Icon name="rate_review" size={13} /> Review
                        </button>
                      )}
                      {r.query_notes && (
                        <div style={{ fontSize: '11px', color: THEME.warning, marginTop: '4px', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.query_notes}>
                          <Icon name="help" size={11} style={{ color: THEME.warning }} /> {r.query_notes}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {reviewTarget && (
        <ReviewModal
          recon={reviewTarget}
          profileId={profile?.id}
          onClose={() => setReviewTarget(null)}
          onSaved={() => { setReviewTarget(null); load() }}
        />
      )}
    </div>
  )
}
