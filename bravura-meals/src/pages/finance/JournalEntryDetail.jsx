import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast, ModalOverlay } from '../../components/ui'

const color = MODULE_COLORS.finance || '#1565C0'

const STATUS_STYLES = {
  draft:  { bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText,  label: 'Draft' },
  posted: { bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  label: 'Posted' },
  void:   { bg: THEME.statusErrorBg,    text: THEME.statusErrorText,    label: 'Void' },
}

export default function JournalEntryDetail({ setPage, entryId }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [entry, setEntry] = useState(null)
  const [lines, setLines] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showVoidModal, setShowVoidModal] = useState(false)
  const [voidReason, setVoidReason] = useState('')

  async function load() {
    if (!entryId || !currentSiteId) return
    setLoading(true)
    const [jeRes, lineRes, acctRes] = await Promise.all([
      supabase.from('journal_entries').select('*').eq('id', entryId).single(),
      supabase.from('journal_lines').select('*').eq('journal_id', entryId).order('line_order'),
      supabase.from('accounts').select('id, code, name, account_type').eq('site_id', currentSiteId).eq('is_archived', false).order('code'),
    ])
    if (jeRes.error) { showToast('Failed to load journal entry', 'error'); setLoading(false); return }
    setEntry(jeRes.data)
    setLines(lineRes.data || [])
    setAccounts(acctRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [entryId, currentSiteId])

  const totals = useMemo(() => ({
    debit: lines.reduce((s, l) => s + Number(l.debit || 0), 0),
    credit: lines.reduce((s, l) => s + Number(l.credit || 0), 0),
  }), [lines])

  const isBalanced = Math.abs(totals.debit - totals.credit) < 0.005

  const acctMap = useMemo(() => {
    const m = {}
    accounts.forEach(a => { m[a.id] = a })
    return m
  }, [accounts])

  async function updateHeader(fields) {
    const userId = (await supabase.auth.getUser()).data.user?.id
    const { error } = await supabase.from('journal_entries').update({ ...fields, updated_by: userId, updated_at: new Date().toISOString() }).eq('id', entryId)
    if (error) showToast(error.message, 'error')
    else load()
  }

  async function addLine() {
    if (!accounts.length) { showToast('Create accounts first', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('journal_lines').insert({
      journal_id: entryId,
      account_id: accounts[0].id,
      debit: 0, credit: 0,
      line_order: lines.length,
    })
    if (error) showToast(error.message, 'error')
    else load()
    setSaving(false)
  }

  async function updateLine(lineId, fields) {
    const { error } = await supabase.from('journal_lines').update(fields).eq('id', lineId)
    if (error) showToast(error.message, 'error')
    else load()
  }

  async function removeLine(lineId) {
    const { error } = await supabase.from('journal_lines').delete().eq('id', lineId)
    if (error) showToast(error.message, 'error')
    else load()
  }

  async function handlePost() {
    if (!isBalanced) { showToast('Debits must equal credits', 'error'); return }
    if (lines.length === 0) { showToast('Add at least one line', 'error'); return }
    setSaving(true)
    const { data, error } = await supabase.rpc('finance_post_journal', { p_journal_id: entryId })
    if (error) showToast(error.message, 'error')
    else if (!data?.ok) showToast(data?.error || 'Post failed', 'error')
    else { showToast('Journal posted successfully', 'success'); load() }
    setSaving(false)
  }

  async function handleVoid() {
    setSaving(true)
    const { data, error } = await supabase.rpc('finance_void_journal', { p_journal_id: entryId, p_reason: voidReason || 'Voided' })
    if (error) showToast(error.message, 'error')
    else if (!data?.ok) showToast(data?.error || 'Void failed', 'error')
    else { showToast('Journal voided', 'success'); setShowVoidModal(false); load() }
    setSaving(false)
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: THEME.textMed }}>Loading…</div>
  if (!entry) return <div style={{ padding: 60, textAlign: 'center', color: THEME.textMed }}>Entry not found</div>

  const st = STATUS_STYLES[entry.status] || STATUS_STYLES.draft
  const isDraft = entry.status === 'draft'
  const isPosted = entry.status === 'posted'

  return (
    <div style={{ padding: '24px', maxWidth: 1000, margin: '0 auto' }}>
      {/* Back + header */}
      <button onClick={() => setPage('fi_journal_entries')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: color, fontSize: 13, fontFamily: 'inherit', padding: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span> Back to Journal Entries
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>{entry.entry_number}</h1>
            <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: st.bg, color: st.text }}>{st.label}</span>
          </div>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 4 }}>{entry.entry_date}{entry.source_module ? ` · Source: ${entry.source_module}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isDraft && can('finance.approve') && (
            <button onClick={handlePost} disabled={saving || !isBalanced} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#2E7D32', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: saving || !isBalanced ? 0.5 : 1 }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>check_circle</span>Post
            </button>
          )}
          {isPosted && can('finance.approve') && (
            <button onClick={() => setShowVoidModal(true)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid #C62828`, background: 'transparent', color: '#C62828', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>block</span>Void
            </button>
          )}
        </div>
      </div>

      {/* Description */}
      <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, padding: 16, marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 6 }}>Description</label>
        {isDraft && can('finance.edit') ? (
          <input
            value={entry.description || ''} onChange={e => setEntry(prev => ({ ...prev, description: e.target.value }))}
            onBlur={e => updateHeader({ description: e.target.value })}
            placeholder="Enter description…"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }}
          />
        ) : (
          <div style={{ fontSize: 14, color: THEME.text }}>{entry.description || '—'}</div>
        )}
      </div>

      {/* Lines */}
      <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${THEME.outline}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: THEME.text }}>Journal Lines</span>
          {isDraft && can('finance.create') && (
            <button onClick={addLine} disabled={saving} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: color, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 3 }}>add</span>Add Line
            </button>
          )}
        </div>

        {lines.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: THEME.textMed, fontSize: 13 }}>No lines yet. Add a line to start building this journal entry.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', minWidth: 200 }}>Account</th>
                  <th style={{ textAlign: 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px' }}>Description</th>
                  <th style={{ textAlign: 'right', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', width: 120 }}>Debit</th>
                  <th style={{ textAlign: 'right', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', width: 120 }}>Credit</th>
                  {isDraft && <th style={{ width: 50 }} />}
                </tr>
              </thead>
              <tbody>
                {lines.map(line => {
                  const acct = acctMap[line.account_id]
                  return (
                    <tr key={line.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                      <td style={{ padding: '8px 14px' }}>
                        {isDraft && can('finance.edit') ? (
                          <select value={line.account_id} onChange={e => updateLine(line.id, { account_id: e.target.value })} style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${THEME.outline}`, fontSize: 12, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                          </select>
                        ) : (
                          <span>{acct ? `${acct.code} — ${acct.name}` : line.account_id}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 14px' }}>
                        {isDraft && can('finance.edit') ? (
                          <input value={line.description || ''} onChange={e => { const v = e.target.value; setLines(ls => ls.map(l => l.id === line.id ? { ...l, description: v } : l)) }} onBlur={e => updateLine(line.id, { description: e.target.value })} placeholder="Line description…" style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: `1px solid ${THEME.outline}`, fontSize: 12, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, boxSizing: 'border-box' }} />
                        ) : (
                          <span style={{ color: THEME.text }}>{line.description || '—'}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                        {isDraft && can('finance.edit') ? (
                          <input type="number" step="0.01" min="0" value={line.debit || ''} onChange={e => { const v = e.target.value; setLines(ls => ls.map(l => l.id === line.id ? { ...l, debit: v } : l)) }} onBlur={e => updateLine(line.id, { debit: Number(e.target.value) || 0, credit: Number(e.target.value) > 0 ? 0 : line.credit })} style={{ width: 100, padding: '6px 8px', borderRadius: 6, border: `1px solid ${THEME.outline}`, fontSize: 12, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, textAlign: 'right' }} />
                        ) : (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(line.debit) > 0 ? `$${Number(line.debit).toLocaleString('en', { minimumFractionDigits: 2 })}` : ''}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 14px', textAlign: 'right' }}>
                        {isDraft && can('finance.edit') ? (
                          <input type="number" step="0.01" min="0" value={line.credit || ''} onChange={e => { const v = e.target.value; setLines(ls => ls.map(l => l.id === line.id ? { ...l, credit: v } : l)) }} onBlur={e => updateLine(line.id, { credit: Number(e.target.value) || 0, debit: Number(e.target.value) > 0 ? 0 : line.debit })} style={{ width: 100, padding: '6px 8px', borderRadius: 6, border: `1px solid ${THEME.outline}`, fontSize: 12, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, textAlign: 'right' }} />
                        ) : (
                          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(line.credit) > 0 ? `$${Number(line.credit).toLocaleString('en', { minimumFractionDigits: 2 })}` : ''}</span>
                        )}
                      </td>
                      {isDraft && (
                        <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                          <button onClick={() => removeLine(line.id)} title="Remove line" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: THEME.textMed }}>
                            <span className="material-symbols-rounded" style={{ fontSize: 18 }}>close</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${THEME.outline}` }}>
                  <td colSpan={2} style={{ padding: '10px 14px', fontWeight: 700, textAlign: 'right' }}>Totals</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>${totals.debit.toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>${totals.credit.toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                  {isDraft && <td />}
                </tr>
                {!isBalanced && lines.length > 0 && (
                  <tr>
                    <td colSpan={isDraft ? 5 : 4} style={{ padding: '8px 14px', color: '#C62828', fontSize: 12, fontWeight: 600 }}>
                      <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>warning</span>
                      Out of balance by ${Math.abs(totals.debit - totals.credit).toLocaleString('en', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Posted/void info */}
      {entry.posted_at && (
        <div style={{ fontSize: 12, color: THEME.textMed, marginBottom: 8 }}>
          Posted on {new Date(entry.posted_at).toLocaleDateString()}
        </div>
      )}
      {entry.voided_at && (
        <div style={{ fontSize: 12, color: '#C62828', marginBottom: 8 }}>
          Voided on {new Date(entry.voided_at).toLocaleDateString()}{entry.void_reason ? ` — ${entry.void_reason}` : ''}
        </div>
      )}

      {/* Void modal */}
      {showVoidModal && (
        <ModalOverlay onClose={() => setShowVoidModal(false)}>
          <div style={{ background: THEME.surface, borderRadius: 14, padding: 24, width: 400, maxWidth: '95vw' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700, color: '#C62828' }}>Void Journal Entry</h2>
            <p style={{ fontSize: 13, color: THEME.textMed, margin: '0 0 16px' }}>This will reverse all account balance updates from {entry.entry_number}. This cannot be undone.</p>
            <label style={{ fontSize: 12, fontWeight: 600, color: THEME.textMed, display: 'block', marginBottom: 4 }}>Reason</label>
            <textarea value={voidReason} onChange={e => setVoidReason(e.target.value)} rows={3} placeholder="Reason for voiding…" style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, resize: 'vertical', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setShowVoidModal(false)} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={handleVoid} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#C62828', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: saving ? 0.6 : 1 }}>{saving ? 'Voiding…' : 'Void Entry'}</button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
