import { useState, useEffect, useMemo, useRef } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
function parseCsv(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.replace(/^"|"$/g, '').trim())
    const obj = {}
    headers.forEach((h, i) => { obj[h] = vals[i] || '' })
    return obj
  })
}

const color = MODULE_COLORS.finance || '#1565C0'

export default function BankReconciliation({ setPage, bankAccountId }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [bankAccount, setBankAccount] = useState(null)
  const [lines, setLines] = useState([])
  const [journals, setJournals] = useState([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [filterReconciled, setFilterReconciled] = useState('unreconciled')
  const fileRef = useRef(null)

  async function load() {
    if (!bankAccountId || !currentSiteId) return
    setLoading(true)
    const [baRes, linesRes, jeRes] = await Promise.all([
      supabase.from('bank_accounts').select('*').eq('id', bankAccountId).single(),
      supabase.from('bank_statement_lines').select('*').eq('bank_account_id', bankAccountId).eq('is_archived', false).order('transaction_date', { ascending: false }).limit(500),
      supabase.from('journal_entries').select('id, entry_number, entry_date, description, total_debit').eq('site_id', currentSiteId).eq('status', 'posted').is('is_archived', false).order('entry_date', { ascending: false }).limit(200),
    ])
    if (baRes.error) { showToast('Failed to load bank account', 'error'); setLoading(false); return }
    setBankAccount(baRes.data)
    setLines(linesRes.data || [])
    setJournals(jeRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [bankAccountId, currentSiteId])

  const filtered = useMemo(() => {
    if (filterReconciled === 'all') return lines
    if (filterReconciled === 'reconciled') return lines.filter(l => l.is_reconciled)
    return lines.filter(l => !l.is_reconciled)
  }, [lines, filterReconciled])

  const stats = useMemo(() => ({
    total: lines.length,
    reconciled: lines.filter(l => l.is_reconciled).length,
    unreconciled: lines.filter(l => !l.is_reconciled).length,
    unreconciledTotal: lines.filter(l => !l.is_reconciled).reduce((s, l) => s + Number(l.debit || 0) - Number(l.credit || 0), 0),
  }), [lines])

  async function handleImportCsv(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      if (!rows.length) { showToast('No data found in CSV', 'error'); setImporting(false); return }

      const headers = Object.keys(rows[0]).map(h => h.toLowerCase().trim())
      const dateCol = headers.find(h => h.includes('date'))
      const descCol = headers.find(h => h.includes('desc') || h.includes('particular') || h.includes('narration'))
      const refCol = headers.find(h => h.includes('ref') || h.includes('cheque'))
      const debitCol = headers.find(h => h === 'debit' || h.includes('debit') || h.includes('withdrawal'))
      const creditCol = headers.find(h => h === 'credit' || h.includes('credit') || h.includes('deposit'))
      const balCol = headers.find(h => h.includes('balance'))

      if (!dateCol) { showToast('CSV must have a date column', 'error'); setImporting(false); return }

      const headerMap = {}
      Object.keys(rows[0]).forEach(h => { headerMap[h.toLowerCase().trim()] = h })

      const batch = new Date().toISOString()
      const userId = (await supabase.auth.getUser()).data.user?.id
      const inserts = rows.map(r => {
        const raw = {}
        Object.keys(r).forEach(k => { raw[k.toLowerCase().trim()] = r[k] })
        const parseNum = v => { const n = parseFloat(String(v || '0').replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n }
        return {
          bank_account_id: bankAccountId,
          transaction_date: raw[dateCol] || new Date().toISOString().slice(0, 10),
          description: descCol ? raw[descCol] : null,
          reference: refCol ? raw[refCol] : null,
          debit: debitCol ? parseNum(raw[debitCol]) : 0,
          credit: creditCol ? parseNum(raw[creditCol]) : 0,
          balance: balCol ? parseNum(raw[balCol]) : null,
          import_batch: batch,
          created_by: userId,
        }
      }).filter(r => r.transaction_date && (r.debit > 0 || r.credit > 0))

      if (!inserts.length) { showToast('No valid transactions found', 'error'); setImporting(false); return }

      const { error } = await supabase.from('bank_statement_lines').insert(inserts)
      if (error) showToast(error.message, 'error')
      else { showToast(`Imported ${inserts.length} transactions`, 'success'); load() }
    } catch (err) {
      showToast('Failed to parse CSV: ' + err.message, 'error')
    }
    setImporting(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleMatch(lineId, journalId) {
    const userId = (await supabase.auth.getUser()).data.user?.id
    const { error } = await supabase.from('bank_statement_lines').update({
      is_reconciled: true,
      reconciled_at: new Date().toISOString(),
      reconciled_by: userId,
      matched_journal_id: journalId,
    }).eq('id', lineId)
    if (error) showToast(error.message, 'error')
    else { showToast('Transaction reconciled', 'success'); load() }
  }

  async function handleUnmatch(lineId) {
    const { error } = await supabase.from('bank_statement_lines').update({
      is_reconciled: false,
      reconciled_at: null,
      reconciled_by: null,
      matched_journal_id: null,
    }).eq('id', lineId)
    if (error) showToast(error.message, 'error')
    else { showToast('Reconciliation removed', 'success'); load() }
  }

  async function handleAutoMatch() {
    const unmatched = lines.filter(l => !l.is_reconciled)
    let matched = 0
    for (const line of unmatched) {
      const amount = Number(line.debit || 0) - Number(line.credit || 0)
      const absAmt = Math.abs(amount)
      const candidates = journals.filter(j => {
        const jAmt = Number(j.total_debit || 0)
        return Math.abs(jAmt - absAmt) < 0.01
      })
      if (candidates.length === 1) {
        const dayDiff = Math.abs(new Date(line.transaction_date) - new Date(candidates[0].entry_date)) / 86400000
        if (dayDiff <= 7) {
          await handleMatch(line.id, candidates[0].id)
          matched++
        }
      }
    }
    if (matched > 0) showToast(`Auto-matched ${matched} transactions`, 'success')
    else showToast('No auto-matches found', 'info')
    load()
  }

  if (loading) return <div style={{ padding: 60, textAlign: 'center', color: THEME.textMed }}>Loading…</div>
  if (!bankAccount) return <div style={{ padding: 60, textAlign: 'center', color: THEME.textMed }}>Bank account not found</div>

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>
      <button onClick={() => setPage('fi_bank_accounts')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: color, fontSize: 13, fontFamily: 'inherit', padding: 0, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
        <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span> Back to Bank Accounts
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Reconcile: {bankAccount.account_name}</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{bankAccount.bank_name}{bankAccount.account_number ? ` · ${bankAccount.account_number}` : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {can('finance.edit') && (
            <button onClick={handleAutoMatch} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${color}`, background: 'transparent', color: color, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>auto_fix_high</span>Auto-Match
            </button>
          )}
          {can('finance.create') && (
            <>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleImportCsv} hidden />
              <button onClick={() => fileRef.current?.click()} disabled={importing} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: color, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', opacity: importing ? 0.6 : 1 }}>
                <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>upload_file</span>{importing ? 'Importing…' : 'Import CSV'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        <div style={{ padding: '12px 14px', borderRadius: 8, background: THEME.surface, border: `1px solid ${THEME.outline}`, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text }}>{stats.total}</div>
          <div style={{ fontSize: 11, color: THEME.textMed }}>Total Lines</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 8, background: THEME.surface, border: `1px solid ${THEME.outline}`, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#2E7D32' }}>{stats.reconciled}</div>
          <div style={{ fontSize: 11, color: THEME.textMed }}>Reconciled</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 8, background: THEME.surface, border: `1px solid ${THEME.outline}`, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#E65100' }}>{stats.unreconciled}</div>
          <div style={{ fontSize: 11, color: THEME.textMed }}>Unreconciled</div>
        </div>
        <div style={{ padding: '12px 14px', borderRadius: 8, background: THEME.surface, border: `1px solid ${THEME.outline}`, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>${Math.abs(stats.unreconciledTotal).toLocaleString('en', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: THEME.textMed }}>Unreconciled Amount</div>
        </div>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {['unreconciled', 'reconciled', 'all'].map(f => (
          <button key={f} onClick={() => setFilterReconciled(f)} style={{ padding: '6px 14px', borderRadius: 6, border: `1px solid ${filterReconciled === f ? color : THEME.outline}`, background: filterReconciled === f ? color : THEME.surface, color: filterReconciled === f ? '#fff' : THEME.text, cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', textTransform: 'capitalize' }}>{f}</button>
        ))}
      </div>

      {/* Statement lines table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', marginBottom: 12 }}>receipt</span>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No statement lines</div>
          <div style={{ fontSize: 13 }}>Import a bank statement CSV to get started.</div>
        </div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  {['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: ['Debit', 'Credit', 'Balance'].includes(h) ? 'right' : 'left', padding: '10px 12px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(line => (
                  <tr key={line.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}>
                    <td style={{ padding: '8px 12px', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{line.transaction_date}</td>
                    <td style={{ padding: '8px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line.description || '—'}</td>
                    <td style={{ padding: '8px 12px', color: THEME.textMed }}>{line.reference || '—'}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#C62828' }}>{Number(line.debit) > 0 ? `$${Number(line.debit).toLocaleString('en', { minimumFractionDigits: 2 })}` : ''}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#2E7D32' }}>{Number(line.credit) > 0 ? `$${Number(line.credit).toLocaleString('en', { minimumFractionDigits: 2 })}` : ''}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{line.balance != null ? `$${Number(line.balance).toLocaleString('en', { minimumFractionDigits: 2 })}` : '—'}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600, background: line.is_reconciled ? THEME.statusSuccessBg : THEME.statusWarningBg, color: line.is_reconciled ? THEME.statusSuccessText : THEME.statusWarningText }}>{line.is_reconciled ? 'Matched' : 'Open'}</span>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {line.is_reconciled ? (
                        can('finance.edit') && <button onClick={() => handleUnmatch(line.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMed, fontSize: 12, fontFamily: 'inherit' }}>Unmatch</button>
                      ) : can('finance.edit') && (
                        <select onChange={e => { if (e.target.value) handleMatch(line.id, e.target.value); e.target.value = '' }} defaultValue="" style={{ padding: '4px 6px', borderRadius: 6, border: `1px solid ${THEME.outline}`, fontSize: 11, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, maxWidth: 160 }}>
                          <option value="">Match to JV…</option>
                          {journals.map(j => <option key={j.id} value={j.id}>{j.entry_number} · {j.entry_date} · ${Number(j.total_debit).toLocaleString('en', { minimumFractionDigits: 2 })}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
