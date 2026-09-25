import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { FIN } from '../../utils/financeTheme'
import { useFinEmbedded } from '../../components/finEmbed'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast, ModalOverlay } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const color = FIN.maroon  // finance design: maroon actions (issue #49)

const ACCOUNT_TYPES = ['Asset', 'Liability', 'Equity', 'Revenue', 'Expense']
const SUB_TYPES = {
  Asset:     ['Current Asset', 'Fixed Asset', 'Bank', 'Cash', 'Receivable', 'Other Asset'],
  Liability: ['Current Liability', 'Long-term Liability', 'Payable', 'Other Liability'],
  Equity:    ['Retained Earnings', 'Share Capital', 'Other Equity'],
  Revenue:   ['Sales', 'Service Revenue', 'Other Income'],
  Expense:   ['Cost of Sales', 'Operating Expense', 'Administrative', 'Depreciation', 'Interest', 'Other Expense'],
}

const TYPE_COLORS = {
  Asset:     { bg: '#E8F5E9', text: '#2E7D32' },
  Liability: { bg: '#FFF3E0', text: '#E65100' },
  Equity:    { bg: '#E3F2FD', text: '#1565C0' },
  Revenue:   { bg: '#E8F5E9', text: '#1B5E20' },
  Expense:   { bg: '#FFEBEE', text: '#C62828' },
}

export default function ChartOfAccounts({ setPage }) {
  const embedded = useFinEmbedded()
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', account_type: 'Asset', sub_type: '', description: '', parent_id: null })

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('accounts')
      .select('*')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('code')
    if (error) showToast('Failed to load accounts', 'error')
    else setAccounts(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = accounts
    if (filterType) list = list.filter(a => a.account_type === filterType)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(a => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
    }
    return list
  }, [accounts, search, filterType])

  const grouped = useMemo(() => {
    const map = {}
    ACCOUNT_TYPES.forEach(t => { map[t] = filtered.filter(a => a.account_type === t) })
    return map
  }, [filtered])

  function openAdd() {
    setEditing(null)
    setForm({ code: '', name: '', account_type: 'Asset', sub_type: '', description: '', parent_id: null })
    setShowModal(true)
  }

  function openEdit(acct) {
    setEditing(acct)
    setForm({ code: acct.code, name: acct.name, account_type: acct.account_type, sub_type: acct.sub_type || '', description: acct.description || '', parent_id: acct.parent_id })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.code.trim() || !form.name.trim()) { showToast('Code and name required', 'error'); return }
    setSaving(true)
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      account_type: form.account_type,
      sub_type: form.sub_type || null,
      description: form.description || null,
      parent_id: form.parent_id || null,
      site_id: currentSiteId,
      updated_by: (await supabase.auth.getUser()).data.user?.id,
    }
    let error
    if (editing) {
      ;({ error } = await supabase.from('accounts').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id))
    } else {
      payload.created_by = payload.updated_by
      ;({ error } = await supabase.from('accounts').insert(payload))
    }
    if (error) showToast(error.message, 'error')
    else { showToast(editing ? 'Account updated' : 'Account created', 'success'); setShowModal(false); load() }
    setSaving(false)
  }

  async function handleArchive(acct) {
    if (!confirm(`Archive account ${acct.code} — ${acct.name}?`)) return
    const { error } = await supabase.from('accounts').update({ is_archived: true, updated_at: new Date().toISOString() }).eq('id', acct.id)
    if (error) showToast(error.message, 'error')
    else { showToast('Account archived', 'success'); load() }
  }

  const summary = useMemo(() => {
    const s = {}
    ACCOUNT_TYPES.forEach(t => { s[t] = accounts.filter(a => a.account_type === t).length })
    s.total = accounts.length
    return s
  }, [accounts])

  return (
    <div style={embedded ? {} : { padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          {!embedded && <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Chart of Accounts</h1>}
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{summary.total} accounts</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => exportCsv(filtered.map(a => ({ Code: a.code, Name: a.name, Type: a.account_type, 'Sub Type': a.sub_type || '', Balance: a.balance, Description: a.description || '' })), 'chart_of_accounts')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>Export
          </button>
          {can('finance.create') && (
            <button onClick={openAdd} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: color, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</span>New Account
            </button>
          )}
        </div>
      </div>

      {/* Summary tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
        {ACCOUNT_TYPES.map(t => (
          <div key={t} onClick={() => setFilterType(filterType === t ? '' : t)} style={{ padding: '12px 14px', borderRadius: 8, background: filterType === t ? TYPE_COLORS[t].text : THEME.surface, border: `1px solid ${THEME.outline}`, cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: filterType === t ? '#fff' : TYPE_COLORS[t].text }}>{summary[t]}</div>
            <div style={{ fontSize: 11, color: filterType === t ? '#ffffffcc' : THEME.textMed, fontWeight: 500 }}>{t}s</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by code or name…"
          style={{ width: '100%', maxWidth: 360, padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : accounts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', marginBottom: 12 }}>account_balance</span>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No accounts yet</div>
          <div style={{ fontSize: 13 }}>Create your first account to get started with the Chart of Accounts.</div>
        </div>
      ) : (
        ACCOUNT_TYPES.filter(t => grouped[t].length > 0).map(t => (
          <div key={t} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: TYPE_COLORS[t].text }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: THEME.text }}>{t}s</span>
              <span style={{ fontSize: 12, color: THEME.textMed }}>({grouped[t].length})</span>
            </div>
            <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                    <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Code</th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Name</th>
                    <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Sub Type</th>
                    <th style={{ textAlign: 'right', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Balance</th>
                    <th style={{ width: 80, padding: '10px 14px' }} />
                  </tr>
                </thead>
                <tbody>
                  {grouped[t].map(acct => (
                    <tr key={acct.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '10px 14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{acct.code}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text }}>{acct.name}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{acct.sub_type || '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, color: acct.balance < 0 ? '#C62828' : THEME.text }}>
                        ${Math.abs(acct.balance).toLocaleString('en', { minimumFractionDigits: 2 })}
                        {acct.balance < 0 ? ' CR' : ''}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          {can('finance.edit') && (
                            <button onClick={() => openEdit(acct)} title="Edit" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: THEME.textMed }}>
                              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>edit</span>
                            </button>
                          )}
                          {can('finance.delete') && (
                            <button onClick={() => handleArchive(acct)} title="Archive" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: THEME.textMed }}>
                              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>archive</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: THEME.surface, borderRadius: 14, padding: 24, width: 440, maxWidth: '95vw' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: THEME.text }}>{editing ? 'Edit Account' : 'New Account'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Code *</label>
                  <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="1000" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Cash at Bank" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Account Type *</label>
                  <select value={form.account_type} onChange={e => setForm(f => ({ ...f, account_type: e.target.value, sub_type: '' }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
                    {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Sub Type</label>
                  <select value={form.sub_type} onChange={e => setForm(f => ({ ...f, sub_type: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
                    <option value="">— None —</option>
                    {(SUB_TYPES[form.account_type] || []).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Parent Account</label>
                <select value={form.parent_id || ''} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value || null }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
                  <option value="">— None (top level) —</option>
                  {accounts.filter(a => a.account_type === form.account_type && a.id !== editing?.id).map(a => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, resize: 'vertical', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: color, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
