import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { nextCode } from '../../utils/autoCode'

const color = MODULE_COLORS.contractors

const PAYMENT_METHODS = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'shift', label: 'Shift' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'fixed_price', label: 'Fixed Price' },
  { value: 'per_ton', label: 'Per Ton' },
  { value: 'per_km', label: 'Per Km' },
]

const STATUS_MAP = {
  active:    { label: 'Active',    bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText },
  completed: { label: 'Completed', bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText },
  expired:   { label: 'Expired',   bg: THEME.statusErrorBg,    text: THEME.statusErrorText },
  suspended: { label: 'Suspended', bg: THEME.statusWarningBg,  text: THEME.statusWarningText },
  cancelled: { label: 'Cancelled', bg: THEME.statusErrorBg,    text: THEME.statusErrorText },
}

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.active
  return (
    <span style={{
      display: 'inline-block', fontSize: '11px', fontWeight: 600,
      padding: '2px 10px', borderRadius: '999px',
      background: s.bg, color: s.text, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function fmtCurrency(v) {
  if (v == null || v === '') return '$0.00'
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  return Math.ceil((d - now) / 86400000)
}

function isExpiringSoon(dateStr, status) {
  if (!dateStr || status !== 'active') return false
  const d = daysUntil(dateStr)
  return d != null && d >= 0 && d <= 30
}

const EMPTY_FORM = {
  contractor_id: '', contract_number: '', description: '',
  start_date: '', end_date: '', payment_method: 'monthly',
  agreed_rate: '', contract_value: '', spent_to_date: '',
  retention_pct: '', status: 'active', notes: '',
}

export default function CLContracts() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const canEdit = can('contractors.edit')

  const [contracts, setContracts] = useState([])
  const [contractors, setContractors] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const [{ data: contractsData, error: cErr }, { data: contractorsData, error: coErr }] = await Promise.all([
        supabase
          .from('contractor_contracts')
          .select('*, contractor:contractors(id, name, short_code)')
          .eq('site_id', currentSiteId)
          .order('created_at', { ascending: false }),
        supabase
          .from('contractors')
          .select('id, name, short_code')
          .order('name'),
      ])
      if (cErr) throw cErr
      if (coErr) throw coErr
      setContracts(contractsData || [])
      setContractors(contractorsData || [])
    } catch (err) {
      showToast(err.message || 'Failed to load contracts', 'error')
    } finally {
      setLoading(false)
    }
  }, [currentSiteId])

  useEffect(() => { loadData() }, [loadData])

  const filtered = useMemo(() => {
    let list = contracts || []
    if (filterStatus !== 'all') list = list.filter(c => c.status === filterStatus)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        (c.contract_number || '').toLowerCase().includes(q) ||
        (c.description || '').toLowerCase().includes(q) ||
        (c.contractor?.name || '').toLowerCase().includes(q) ||
        (c.contractor?.short_code || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [contracts, filterStatus, search])

  const kpis = useMemo(() => {
    const all = contracts || []
    const expiringSoon = all.filter(c => isExpiringSoon(c.end_date, c.status)).length
    const totalValue = all.reduce((s, c) => s + (Number(c.contract_value) || 0), 0)
    const totalSpent = all.reduce((s, c) => s + (Number(c.spent_to_date) || 0), 0)
    return {
      total: all.length,
      active: all.filter(c => c.status === 'active').length,
      expiringSoon,
      totalValue,
      totalSpent,
    }
  }, [contracts])

  function openAdd() {
    setEditId(null)
    const contract_number = nextCode(contracts.map(c => c.contract_number), { prefix: 'CON', pad: 4 })
    setForm({ ...EMPTY_FORM, contract_number })
    setError('')
    setModalOpen(true)
  }

  function openEdit(c) {
    setEditId(c.id)
    setForm({
      contractor_id: c.contractor_id || '',
      contract_number: c.contract_number || '',
      description: c.description || '',
      start_date: c.start_date || '',
      end_date: c.end_date || '',
      payment_method: c.payment_method || 'monthly',
      agreed_rate: c.agreed_rate ?? '',
      contract_value: c.contract_value ?? '',
      spent_to_date: c.spent_to_date ?? '',
      retention_pct: c.retention_pct ?? '',
      status: c.status || 'active',
      notes: c.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.contractor_id || !form.contract_number || !form.start_date) {
      setError('Contractor, contract number and start date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        contractor_id: form.contractor_id,
        contract_number: form.contract_number,
        description: form.description || null,
        start_date: form.start_date,
        end_date: form.end_date || null,
        payment_method: form.payment_method,
        agreed_rate: form.agreed_rate !== '' ? Number(form.agreed_rate) : null,
        contract_value: form.contract_value !== '' ? Number(form.contract_value) : null,
        spent_to_date: form.spent_to_date !== '' ? Number(form.spent_to_date) : 0,
        retention_pct: form.retention_pct !== '' ? Number(form.retention_pct) : null,
        status: form.status,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: upErr } = await supabase
          .from('contractor_contracts')
          .update(payload)
          .eq('id', editId)
          .eq('site_id', currentSiteId)
        if (upErr) throw upErr
        showToast('Contract updated', 'success')
      } else {
        const { error: insErr } = await supabase
          .from('contractor_contracts')
          .insert(payload)
        if (insErr) throw insErr
        showToast('Contract created', 'success')
      }
      setModalOpen(false)
      loadData()
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleExport() {
    const headers = ['Contract #', 'Contractor', 'Description', 'Start Date', 'End Date', 'Payment Method', 'Agreed Rate', 'Contract Value', 'Spent to Date', 'Retention %', 'Status']
    const rows = filtered.map(c => [
      c.contract_number,
      c.contractor?.name || '',
      c.description || '',
      c.start_date || '',
      c.end_date || '',
      c.payment_method || '',
      c.agreed_rate ?? '',
      c.contract_value ?? '',
      c.spent_to_date ?? '',
      c.retention_pct ?? '',
      c.status || '',
    ])
    exportCsv('contractor_contracts.csv', headers, rows)
  }

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  const kpiCards = [
    { label: 'Total Contracts', value: kpis.total, icon: 'assignment', bg: color + '14', fg: color },
    { label: 'Active', value: kpis.active, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Expiring Soon', value: kpis.expiringSoon, icon: 'schedule', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Total Value', value: fmtCurrency(kpis.totalValue), icon: 'payments', bg: color + '14', fg: color },
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '18px',
            border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: k.fg }}>{k.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Contracts</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} contract{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={handleExport} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: THEME.surfaceVar, color: THEME.textMed,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>download</span>
            Export CSV
          </button>
          {canEdit && (
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              Add Contract
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search contracts..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '180px' }}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px', color: THEME.textLow,
          background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
        }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>assignment</span>
          <div style={{ fontSize: '14px' }}>No contracts found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new contract</div>
        </div>
      ) : (
        <div style={{
          background: THEME.surface, borderRadius: '14px', border: `1px solid ${THEME.outlineVar}`,
          overflow: 'hidden',
        }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar }}>
                  {['Contract #', 'Contractor', 'Description', 'Dates', 'Payment', 'Value / Spent', 'Status'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left', padding: '10px 14px', fontSize: '11px', fontWeight: 700,
                      color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.03em',
                      borderBottom: `1px solid ${THEME.outlineVar}`,
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const expiringSoon = isExpiringSoon(c.end_date, c.status)
                  const value = Number(c.contract_value) || 0
                  const spent = Number(c.spent_to_date) || 0
                  const pct = value > 0 ? Math.min(100, (spent / value) * 100) : 0
                  const overBudget = value > 0 && spent > value
                  return (
                    <tr
                      key={c.id}
                      onClick={() => canEdit ? openEdit(c) : null}
                      style={{
                        cursor: canEdit ? 'pointer' : 'default',
                        background: expiringSoon ? THEME.statusWarningBg : 'transparent',
                        borderBottom: `1px solid ${THEME.outlineVar}`,
                      }}
                      onMouseEnter={e => { if (!expiringSoon) e.currentTarget.style.background = THEME.surfaceHover }}
                      onMouseLeave={e => { e.currentTarget.style.background = expiringSoon ? THEME.statusWarningBg : 'transparent' }}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: THEME.text }}>
                        {c.contract_number}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.text }}>
                        {c.contractor?.name || '—'}
                        {c.contractor?.short_code ? (
                          <span style={{ color: THEME.textMed, fontSize: '11px' }}> ({c.contractor.short_code})</span>
                        ) : null}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.description || '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, whiteSpace: 'nowrap' }}>
                        <div>{c.start_date || '—'} → {c.end_date || 'Open'}</div>
                        {expiringSoon && (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: 600, color: THEME.statusWarningText, marginTop: '2px' }}>
                            <span className="material-symbols-rounded" style={{ fontSize: '12px' }}>warning</span>
                            Expires in {daysUntil(c.end_date)}d
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                        {(PAYMENT_METHODS.find(p => p.value === c.payment_method) || {}).label || c.payment_method}
                        {c.agreed_rate != null && (
                          <div style={{ fontSize: '11px', color: THEME.textLow }}>{fmtCurrency(c.agreed_rate)}</div>
                        )}
                      </td>
                      <td style={{ padding: '10px 14px', minWidth: '160px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: THEME.textMed, marginBottom: '3px' }}>
                          <span>{fmtCurrency(spent)}</span>
                          <span>{fmtCurrency(value)}</span>
                        </div>
                        <div style={{ height: '6px', borderRadius: '999px', background: THEME.surfaceVar, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${pct}%`, borderRadius: '999px',
                            background: overBudget ? THEME.statusErrorText : color,
                          }} />
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <StatusBadge status={c.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '620px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Contract' : 'Add Contract'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={fieldWrap}>
                  <label style={lbl}>Contractor *</label>
                  <select style={inp} value={form.contractor_id} onChange={e => set('contractor_id', e.target.value)}>
                    <option value="">-- Select --</option>
                    {contractors.map(co => (
                      <option key={co.id} value={co.id}>{co.name}{co.short_code ? ` (${co.short_code})` : ''}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Contract Number *</label>
                  <input style={inp} value={form.contract_number} onChange={e => set('contract_number', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Description</label>
                  <input style={inp} value={form.description} onChange={e => set('description', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Start Date *</label>
                  <input style={inp} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>End Date</label>
                  <input style={inp} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Payment Method</label>
                  <select style={inp} value={form.payment_method} onChange={e => set('payment_method', e.target.value)}>
                    {PAYMENT_METHODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Agreed Rate</label>
                  <input style={inp} type="number" step="0.01" value={form.agreed_rate} onChange={e => set('agreed_rate', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Contract Value</label>
                  <input style={inp} type="number" step="0.01" value={form.contract_value} onChange={e => set('contract_value', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Spent to Date</label>
                  <input style={inp} type="number" step="0.01" value={form.spent_to_date} onChange={e => set('spent_to_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Retention %</label>
                  <input style={inp} type="number" step="0.01" value={form.retention_pct} onChange={e => set('retention_pct', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                    {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea
                    style={{ ...inp, minHeight: '70px', resize: 'vertical' }}
                    value={form.notes}
                    onChange={e => set('notes', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{
              padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setModalOpen(false)} style={{
                  padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff',
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
                }}>
                  {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
