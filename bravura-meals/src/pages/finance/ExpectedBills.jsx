import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { usePermissions } from '../../contexts/PermissionsContext'
import { friendlyError } from '../../utils/friendlyError'
import { FIN, finCard, finBtn, finBtn2, finInput, money } from '../../utils/financeTheme'

const FREQ = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }
const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

// Pay Suppliers tab (0269): bills that should arrive every period (rent, hire, internet, security …).
// A bill is "missing" when the period has started, the grace days have passed and nothing from that supplier was recorded.
// Finance editors are also told each morning (pg_cron expected-bills).
export default function ExpectedBills({ siteId }) {
  const { can } = usePermissions()
  const [rows, setRows] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [form, setForm] = useState(null)

  const load = useCallback(() => {
    if (!siteId) return
    supabase.rpc('expected_bills_status', { p_site: siteId }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'error')
      setRows(data || [])
    })
  }, [siteId])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!siteId) return
    supabase.from('procurement_suppliers').select('id, supplier_name').eq('site_id', siteId).order('supplier_name')
      .then(({ data }) => setSuppliers(data || []))
  }, [siteId])

  async function save() {
    const { error } = await supabase.from('expected_bills').insert({
      site_id: siteId, supplier_id: form.supplier_id, description: form.description.trim(), frequency: form.frequency,
      expected_amount: form.expected_amount ? Number(form.expected_amount) : null, grace_days: Number(form.grace_days) || 7,
      starts_on: form.starts_on,
    })
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Expected bill added'); setForm(null); load()
  }
  async function stop(r) {
    const { error } = await supabase.from('expected_bills').update({ is_active: !r.is_active }).eq('id', r.id).eq('site_id', siteId)
    if (error) return showToast(friendlyError(error), 'error')
    load()
  }

  const missing = (rows || []).filter(r => r.missing).length
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: FIN.muted }}>
          Bills that should come every period. {missing > 0 ? <b style={{ color: FIN.bad }}>{missing} missing.</b> : 'None missing.'}
        </div>
        {(can('finance.edit') || can('finance.create')) && !form &&
          <button onClick={() => setForm({ supplier_id: '', description: '', frequency: 'monthly', expected_amount: '', grace_days: 7, starts_on: new Date().toISOString().slice(0, 8) + '01' })} style={finBtn}>Add expected bill</button>}
      </div>

      {form && (
        <div style={{ ...finCard, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <label style={lbl}>Supplier<select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} style={finInput}>
            <option value="">Choose…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.supplier_name}</option>)}</select></label>
          <label style={{ ...lbl, flex: '2 1 220px' }}>What it is<input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Office rent, internet, crane hire" style={finInput} /></label>
          <label style={lbl}>How often<select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} style={finInput}>
            {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label style={lbl}>Usual amount $<input type="number" min="0" value={form.expected_amount} onChange={e => setForm({ ...form, expected_amount: e.target.value })} style={finInput} /></label>
          <label style={lbl}>Days allowed<input type="number" min="0" value={form.grace_days} onChange={e => setForm({ ...form, grace_days: e.target.value })} style={finInput} /></label>
          <label style={lbl}>First period starts<input type="date" value={form.starts_on} onChange={e => setForm({ ...form, starts_on: e.target.value })} style={finInput} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setForm(null)} style={finBtn2}>Cancel</button>
            <button onClick={save} disabled={!form.supplier_id || !form.description.trim()} style={finBtn}>Save</button>
          </div>
        </div>
      )}

      <div style={{ ...finCard, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>{['Supplier', 'What', 'How often', 'Usual', 'This period', 'Last bill', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {!rows ? <tr><td colSpan={7} style={td}>Loading…</td></tr> : rows.length === 0 ? <tr><td colSpan={7} style={{ ...td, color: FIN.muted }}>No expected bills yet.</td></tr> :
              rows.map(r => (
                <tr key={r.id} style={{ borderTop: `1px solid ${FIN.line}`, opacity: r.is_active ? 1 : 0.5 }}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.supplier}</td>
                  <td style={td}>{r.description}</td>
                  <td style={td}>{FREQ[r.frequency]}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{r.expected_amount ? '$' + money(r.expected_amount) : '—'}</td>
                  <td style={td}>{r.missing
                    ? <span style={{ color: FIN.bad, fontWeight: 600 }}>Missing — due by {fmt(r.due_by)}</span>
                    : <span style={{ color: FIN.muted }}>From {fmt(r.period_start)}</span>}</td>
                  <td style={td}>{r.last_bill_date ? `${fmt(r.last_bill_date)} · ${r.last_bill_no || ''} · $${money(r.last_bill_amount)}` : '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{can('finance.edit') &&
                    <button onClick={() => stop(r)} style={{ background: 'none', border: 'none', color: FIN.blue, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>{r.is_active ? 'Stop' : 'Restart'}</button>}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: FIN.muted, flex: '1 1 140px' }
const th = { padding: '10px 12px', textAlign: 'left', fontSize: 11, color: FIN.faint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }
const td = { padding: '10px 12px' }
