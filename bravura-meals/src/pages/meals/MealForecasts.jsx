import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../hooks/usePermissions'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, Card, Button, showToast, fmtDate } from '../../components/ui'
import QuickNav, { MEALS_PILLS } from '../../components/QuickNav'

const CLR = MODULE_COLORS.meals

const PERIODS = [
  { key: 'b', label: 'Breakfast', icon: 'wb_sunny',   colKey: 'expected_b' },
  { key: 'l', label: 'Lunch',     icon: 'light_mode', colKey: 'expected_l' },
  { key: 's', label: 'Supper',    icon: 'bedtime',    colKey: 'expected_s' },
]

function todayISO() { return new Date().toISOString().slice(0, 10) }

// Kitchen readiness: coloured pill indicating how ready the forecast is
function readiness(sub, forecasts) {
  if (!forecasts.length) return { color: THEME.error,   label: 'No forecast', icon: 'error' }
  const missingPeriods = PERIODS.filter(p => forecasts.every(f => !f[p.colKey])).length
  if (missingPeriods === 3) return { color: THEME.error,   label: 'No forecast', icon: 'error' }
  if (missingPeriods > 0)   return { color: THEME.warning, label: 'Partial',      icon: 'warning' }
  return { color: THEME.success, label: 'Complete', icon: 'check_circle' }
}

export default function MealForecasts({ setPage }) {
  const { profile } = useAuth()
  const { can }     = usePermissions()
  const { currentSite, currentSiteId } = useSite()

  const [date, setDate]         = useState(todayISO())
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [contractors, setContractors] = useState([])
  const [rows, setRows]         = useState({})     // { [contractorId]: { b, l, s, notes } }
  const [existingIds, setIds]   = useState({})     // { [contractorId]: forecastRowId }
  const [submission, setSubmission] = useState(null)

  const canEdit = can('meals.create') || can('meals.edit')

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data: cs }, { data: fs }, { data: sub }] = await Promise.all([
      supabase.from('contractors').select('id, name').order('name'),
      supabase.from('meal_forecasts').select('*').eq('site_id', currentSiteId).eq('forecast_date', date),
      supabase.from('daily_submissions').select('id, status, kitchen_count_b, kitchen_count_l, kitchen_count_s').eq('site_id', currentSiteId).eq('date', date).maybeSingle(),
    ])
    const contractors = (cs || [])
    setContractors(contractors)
    setSubmission(sub || null)

    const nextRows = {}
    const nextIds  = {}
    for (const c of contractors) {
      const f = (fs || []).find(x => x.contractor_id === c.id)
      nextRows[c.id] = {
        b: f?.expected_b ?? '',
        l: f?.expected_l ?? '',
        s: f?.expected_s ?? '',
        notes: f?.notes || '',
      }
      if (f?.id) nextIds[c.id] = f.id
    }
    setRows(nextRows)
    setIds(nextIds)
    setLoading(false)
  }, [currentSiteId, date])

  useEffect(() => { load() }, [load])

  function updateCell(contractorId, key, value) {
    setRows(prev => ({ ...prev, [contractorId]: { ...prev[contractorId], [key]: value } }))
  }

  async function saveAll() {
    if (!canEdit) return
    setSaving(true)
    const upserts = contractors
      .map(c => {
        const r = rows[c.id] || {}
        const b = parseInt(r.b) || 0
        const l = parseInt(r.l) || 0
        const s = parseInt(r.s) || 0
        // Skip rows with no data unless one already exists
        if (b === 0 && l === 0 && s === 0 && !(r.notes || '').trim() && !existingIds[c.id]) return null
        return {
          site_id:       currentSiteId,
          forecast_date: date,
          contractor_id: c.id,
          expected_b:    b,
          expected_l:    l,
          expected_s:    s,
          notes:         (r.notes || '').trim() || null,
          submitted_by:  profile?.id || null,
          submitted_at:  new Date().toISOString(),
        }
      })
      .filter(Boolean)

    if (!upserts.length) { setSaving(false); showToast('Nothing to save', 'red'); return }

    const { error } = await supabase
      .from('meal_forecasts')
      .upsert(upserts, { onConflict: 'site_id,forecast_date,contractor_id' })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`Forecast saved for ${upserts.length} contractor${upserts.length === 1 ? '' : 's'}`, 'green')
    load()
  }

  const totals = useMemo(() => {
    let b = 0, l = 0, s = 0
    for (const r of Object.values(rows)) {
      b += parseInt(r.b) || 0
      l += parseInt(r.l) || 0
      s += parseInt(r.s) || 0
    }
    return { b, l, s, total: b + l + s }
  }, [rows])

  const inp = {
    width: '100%', padding: '6px 10px', border: `1px solid ${THEME.outline}`,
    borderRadius: '6px', fontSize: '13px', color: THEME.text, fontFamily: 'inherit',
    outline: 'none', boxSizing: 'border-box', textAlign: 'center', height: '32px',
    background: THEME.surface,
  }

  const isTodayOrFuture = date >= todayISO()

  return (
    <div style={{ maxWidth: '1050px', margin: '0 auto' }}>
      <PageHeader
        title="Meal Forecast"
        site={currentSite}
        actions={
          <>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: '6px', border: `1px solid ${THEME.outline}`, fontSize: '13px', fontFamily: 'inherit', height: '36px' }}
            />
            {canEdit && (
              <Button variant="filled" icon="save" onClick={saveAll} disabled={saving || loading} style={{ background: CLR, borderColor: CLR }}>
                {saving ? 'Saving…' : 'Save forecast'}
              </Button>
            )}
          </>
        }
      >
        <div style={{ fontSize: '12px', color: THEME.textMed }}>
          Tell the kitchen how many people you expect for each meal — <b>{fmtDate(date)}</b>. Kitchen uses this to plan how much to prepare, and waste is measured against it.
        </div>
      </PageHeader>

      {/* Totals strip — big number kitchens read at a glance */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '18px' }}>
        <TotalCard icon="restaurant" label="Total portions" value={totals.total} color={CLR} />
        {PERIODS.map(p => (
          <TotalCard key={p.key} icon={p.icon} label={p.label} value={totals[p.key]} color={CLR} />
        ))}
      </div>

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px' }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.textLow, animation: 'spin 1s linear infinite' }} />
        </Card>
      ) : contractors.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: '40px' }}>
          <Icon name="business" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
          <div style={{ fontSize: '13px', color: THEME.textMed }}>No contractors on record yet. Add contractors in HR Management first.</div>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar, borderBottom: `1px solid ${THEME.outlineVar}` }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: THEME.textMed }}>Contractor</th>
                  {PERIODS.map(p => (
                    <th key={p.key} style={{ padding: '10px 14px', textAlign: 'center', fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: THEME.textMed, width: '110px' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <Icon name={p.icon} size={13} style={{ color: THEME.textLow }} />
                        {p.label}
                      </div>
                    </th>
                  ))}
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: THEME.textMed }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c, i) => {
                  const r = rows[c.id] || {}
                  const rowTotal = (parseInt(r.b) || 0) + (parseInt(r.l) || 0) + (parseInt(r.s) || 0)
                  return (
                    <tr key={c.id} style={{ borderBottom: i === contractors.length - 1 ? 'none' : `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 14px', color: THEME.text }}>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: '10.5px', color: THEME.textLow, marginTop: '2px' }}>{rowTotal} portions</div>
                      </td>
                      {PERIODS.map(p => (
                        <td key={p.key} style={{ padding: '8px 8px' }}>
                          <input
                            type="number" min={0}
                            value={r[p.key]}
                            disabled={!canEdit}
                            onChange={e => updateCell(c.id, p.key, e.target.value)}
                            style={inp}
                          />
                        </td>
                      ))}
                      <td style={{ padding: '8px 14px' }}>
                        <input
                          type="text"
                          value={r.notes}
                          disabled={!canEdit}
                          onChange={e => updateCell(c.id, 'notes', e.target.value)}
                          placeholder="Optional"
                          style={{ ...inp, textAlign: 'left', padding: '6px 10px' }}
                        />
                      </td>
                    </tr>
                  )
                })}
                <tr style={{ background: THEME.surfaceVar, borderTop: `2px solid ${THEME.outlineVar}` }}>
                  <td style={{ padding: '10px 14px', fontWeight: 700, color: THEME.text }}>Total</td>
                  {PERIODS.map(p => (
                    <td key={p.key} style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: CLR }}>{totals[p.key]}</td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Retro view — if we're looking at a past day, show what was actually served vs forecast */}
      {!isTodayOrFuture && submission && (
        <Card style={{ marginTop: '18px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="fact_check" size={15} style={{ color: CLR }} />
            Forecast vs actual
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {PERIODS.map(p => {
              const forecast = totals[p.key]
              const actual = submission[`kitchen_count_${p.key}`] || 0
              const diff = actual - forecast
              const diffColor = Math.abs(diff) < forecast * 0.1 ? THEME.success : diff > 0 ? THEME.warning : THEME.error
              return (
                <div key={p.key} style={{ padding: '12px', background: THEME.surfaceVar, borderRadius: '8px' }}>
                  <div style={{ fontSize: '11px', color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>{p.label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginTop: '4px' }}>
                    <span style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>{actual}</span>
                    <span style={{ fontSize: '11px', color: THEME.textLow }}>of {forecast}</span>
                    <span style={{ fontSize: '11px', color: diffColor, fontWeight: 700, marginLeft: 'auto' }}>
                      {diff >= 0 ? '+' : ''}{diff}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}

function TotalCard({ icon, label, value, color }) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
      <QuickNav pills={MEALS_PILLS} setPage={setPage} current="meals_forecasts" />
        <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
        <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: color + '14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name={icon} size={15} style={{ color }} />
        </div>
      </div>
      <div style={{ fontSize: '26px', fontWeight: 600, color: THEME.text, marginTop: '4px', letterSpacing: '-.01em' }}>{value}</div>
    </Card>
  )
}
