import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { Card, Button, Icon, PageHeader, showToast } from '../../components/ui'
import DimensionPicker from '../../components/DimensionPicker'

const ACCENT = MODULE_COLORS.procurement
const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inp = { width: '100%', minHeight: '40px', padding: '8px 12px', borderRadius: '8px', fontSize: '14px', border: `1px solid ${THEME.outlineVar}`,
  background: THEME.surface, color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box' }

export default function ProcBudgets() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ cost_centre_id: null, project_id: null, amount: '' })

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.rpc('proc_budget_status', { p_site_id: currentSiteId, p_year: year })
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [currentSiteId, year])
  useEffect(() => { load() }, [load])

  async function add() {
    const cc = form.cost_centre_id || null, pj = form.project_id || null
    if (!!cc === !!pj) { showToast('Pick either a cost centre or a project (one budget each)', 'red'); return }
    if (!(Number(form.amount) >= 0) || form.amount === '') { showToast('Enter the budget amount', 'red'); return }
    const { error } = await supabase.from('procurement_budgets').insert({ site_id: currentSiteId, fiscal_year: year, cost_centre_id: cc,
      project_id: pj, amount: Number(form.amount), created_by: profile?.id })
    if (error) { showToast(error.message.includes('uq_proc_budget') ? 'That already has a budget for this year — change it instead' : error.message, 'red'); return }
    setForm({ cost_centre_id: null, project_id: null, amount: '' }); load()
  }
  async function change(b) {
    const v = window.prompt(`New ${year} budget for ${b.dim_name}`, b.amount)
    if (v === null || v === '' || isNaN(Number(v))) return
    const { error } = await supabase.from('procurement_budgets').update({ amount: Number(v) }).eq('id', b.id)
    if (error) { showToast(error.message, 'red'); return }
    load()
  }
  async function remove(b) {
    if (!window.confirm(`Remove the ${year} budget for ${b.dim_name}? Orders will no longer be checked against it.`)) return
    const { error } = await supabase.from('procurement_budgets').update({ is_archived: true }).eq('id', b.id)
    if (error) { showToast(error.message, 'red'); return }
    load()
  }

  const canEdit = can('procurement.approve')
  return (
    <div style={{ maxWidth: '900px' }}>
      <PageHeader title="Purchasing Budgets" />
      <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '12px' }}>
        A purchase order tagged with a cost centre or project can't be sent if it would take that budget over. Committed = orders sent this year (not drafts or cancelled). Someone with procurement approval can override with a reason.
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
        <Button variant="outlined" onClick={() => setYear(y => y - 1)}><Icon name="chevron_left" size={18} /></Button>
        <b style={{ fontSize: '16px', color: THEME.text, minWidth: '48px', textAlign: 'center' }}>{year}</b>
        <Button variant="outlined" onClick={() => setYear(y => y + 1)}><Icon name="chevron_right" size={18} /></Button>
      </div>

      {canEdit && (
        <Card style={{ padding: '14px', marginBottom: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', alignItems: 'end' }}>
          <DimensionPicker idPrefix="bud" value={form} onChange={v => setForm({ ...form, ...v })} inputStyle={inp} />
          <div>
            <label htmlFor="bud-amt" style={{ fontSize: '12px', fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: '4px' }}>Budget (USD)</label>
            <input id="bud-amt" type="number" step="0.01" style={inp} value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} />
          </div>
          <Button icon="add" onClick={add}>Add budget</Button>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {!rows ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No budgets for {year}.</div>
        ) : rows.map((b, i) => {
          const pct = b.amount > 0 ? Math.min(100, Number(b.committed) / Number(b.amount) * 100) : 100
          const over = Number(b.remaining) < 0
          return (
            <div key={b.id} style={{ padding: '12px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, fontSize: '14px', fontWeight: 600, color: THEME.text }}>{b.dim_code ? `${b.dim_code} · ` : ''}{b.dim_name}
                  <span style={{ fontSize: '11px', fontWeight: 400, color: THEME.textLow }}> {b.project_id ? 'project' : 'cost centre'}</span></span>
                <span style={{ fontSize: '13px', color: THEME.textMed, fontVariantNumeric: 'tabular-nums' }}>{usd(b.committed)} of {usd(b.amount)} · {b.po_count} order{Number(b.po_count) === 1 ? '' : 's'}</span>
                <span style={{ fontSize: '13px', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: over ? THEME.error : THEME.statusSuccessText, minWidth: '120px', textAlign: 'right' }}>
                  {over ? `${usd(-b.remaining)} over` : `${usd(b.remaining)} left`}</span>
                {canEdit && <>
                  <button onClick={() => change(b)} aria-label={`Change budget for ${b.dim_name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="edit" size={16} /></button>
                  <button onClick={() => remove(b)} aria-label={`Remove budget for ${b.dim_name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed }}><Icon name="close" size={16} /></button>
                </>}
              </div>
              <div style={{ height: '8px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden', marginTop: '8px' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: over ? THEME.error : pct > 85 ? THEME.statusWarningText : ACCENT }} />
              </div>
            </div>
          )
        })}
      </Card>
    </div>
  )
}
