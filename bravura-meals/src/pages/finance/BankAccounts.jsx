import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast, ModalOverlay } from '../../components/ui'

const color = MODULE_COLORS.finance || '#1565C0'

export default function BankAccounts({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [banks, setBanks] = useState([])
  const [glAccounts, setGlAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ account_name: '', account_number: '', bank_name: '', branch: '', currency: 'USD', gl_account_id: '', opening_balance: 0 })

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [bankRes, acctRes] = await Promise.all([
      supabase.from('bank_accounts').select('*, accounts(code, name)').eq('site_id', currentSiteId).eq('is_archived', false).order('account_name'),
      supabase.from('accounts').select('id, code, name').eq('site_id', currentSiteId).eq('is_archived', false).in('account_type', ['Asset']).order('code'),
    ])
    if (bankRes.error) showToast('Failed to load bank accounts', 'error')
    else setBanks(bankRes.data || [])
    setGlAccounts(acctRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const totalBalance = useMemo(() => banks.reduce((s, b) => s + Number(b.current_balance || 0), 0), [banks])

  function openAdd() {
    setEditing(null)
    setForm({ account_name: '', account_number: '', bank_name: '', branch: '', currency: 'USD', gl_account_id: '', opening_balance: 0 })
    setShowModal(true)
  }

  function openEdit(b) {
    setEditing(b)
    setForm({ account_name: b.account_name, account_number: b.account_number || '', bank_name: b.bank_name || '', branch: b.branch || '', currency: b.currency, gl_account_id: b.gl_account_id || '', opening_balance: b.opening_balance })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.account_name.trim()) { showToast('Account name required', 'error'); return }
    setSaving(true)
    const userId = (await supabase.auth.getUser()).data.user?.id
    const payload = {
      account_name: form.account_name.trim(),
      account_number: form.account_number || null,
      bank_name: form.bank_name || null,
      branch: form.branch || null,
      currency: form.currency,
      gl_account_id: form.gl_account_id || null,
      opening_balance: Number(form.opening_balance) || 0,
      site_id: currentSiteId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    }
    let error
    if (editing) {
      ;({ error } = await supabase.from('bank_accounts').update(payload).eq('id', editing.id))
    } else {
      payload.created_by = userId
      payload.current_balance = payload.opening_balance
      ;({ error } = await supabase.from('bank_accounts').insert(payload))
    }
    if (error) showToast(error.message, 'error')
    else { showToast(editing ? 'Bank account updated' : 'Bank account created', 'success'); setShowModal(false); load() }
    setSaving(false)
  }

  async function handleArchive(b) {
    if (!confirm(`Archive bank account "${b.account_name}"?`)) return
    const { error } = await supabase.from('bank_accounts').update({ is_archived: true, updated_at: new Date().toISOString() }).eq('id', b.id)
    if (error) showToast(error.message, 'error')
    else { showToast('Bank account archived', 'success'); load() }
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Bank Accounts</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{banks.length} accounts · Total balance: ${totalBalance.toLocaleString('en', { minimumFractionDigits: 2 })}</div>
        </div>
        {can('finance.create') && (
          <button onClick={openAdd} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: color, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</span>New Bank Account
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : banks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', marginBottom: 12 }}>account_balance</span>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No bank accounts yet</div>
          <div style={{ fontSize: 13 }}>Add your first bank account to start tracking balances and reconciling statements.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14 }}>
          {banks.map(b => (
            <div key={b.id} style={{ background: THEME.surface, borderRadius: 12, border: `1px solid ${THEME.outline}`, padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: THEME.text }}>{b.account_name}</div>
                  <div style={{ fontSize: 12, color: THEME.textMed, marginTop: 2 }}>{b.bank_name || 'No bank'}{b.branch ? ` · ${b.branch}` : ''}</div>
                </div>
                <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: b.is_active ? THEME.statusSuccessBg : THEME.statusNeutralBg, color: b.is_active ? THEME.statusSuccessText : THEME.statusNeutralText }}>{b.is_active ? 'Active' : 'Inactive'}</span>
              </div>

              {b.account_number && (
                <div style={{ fontSize: 12, color: THEME.textMed }}>Acct: {b.account_number}</div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ padding: '10px 12px', borderRadius: 8, background: THEME.surfaceHover }}>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginBottom: 2 }}>Opening Balance</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>${Number(b.opening_balance).toLocaleString('en', { minimumFractionDigits: 2 })}</div>
                </div>
                <div style={{ padding: '10px 12px', borderRadius: 8, background: THEME.surfaceHover }}>
                  <div style={{ fontSize: 11, color: THEME.textMed, marginBottom: 2 }}>Current Balance</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: Number(b.current_balance) >= 0 ? '#2E7D32' : '#C62828', fontVariantNumeric: 'tabular-nums' }}>${Math.abs(Number(b.current_balance)).toLocaleString('en', { minimumFractionDigits: 2 })}{Number(b.current_balance) < 0 ? ' DR' : ''}</div>
                </div>
              </div>

              {b.accounts && (
                <div style={{ fontSize: 12, color: THEME.textMed }}>GL: {b.accounts.code} — {b.accounts.name}</div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button onClick={() => setPage('fi_reconciliation:' + b.id)} style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: `1px solid ${color}`, background: 'transparent', color: color, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>Reconcile</button>
                {can('finance.edit') && (
                  <button onClick={() => openEdit(b)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Edit</button>
                )}
                {can('finance.delete') && (
                  <button onClick={() => handleArchive(b)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.textMed, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Archive</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ModalOverlay onClose={() => setShowModal(false)}>
          <div style={{ background: THEME.surface, borderRadius: 14, padding: 24, width: 440, maxWidth: '95vw' }}>
            <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700, color: THEME.text }}>{editing ? 'Edit Bank Account' : 'New Bank Account'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Account Name *</label>
                <input value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} placeholder="Main Operating Account" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Bank Name</label>
                  <input value={form.bank_name} onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))} placeholder="CBZ Bank" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Branch</label>
                  <input value={form.branch} onChange={e => setForm(f => ({ ...f, branch: e.target.value }))} placeholder="Harare" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Account Number</label>
                  <input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} placeholder="1234567890" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Currency</label>
                  <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
                    <option value="USD">USD</option>
                    <option value="ZWG">ZWG</option>
                    <option value="ZAR">ZAR</option>
                    <option value="BWP">BWP</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Linked GL Account</label>
                  <select value={form.gl_account_id} onChange={e => setForm(f => ({ ...f, gl_account_id: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
                    <option value="">— None —</option>
                    {glAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Opening Balance</label>
                  <input type="number" step="0.01" value={form.opening_balance} onChange={e => setForm(f => ({ ...f, opening_balance: e.target.value }))} style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
                </div>
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
