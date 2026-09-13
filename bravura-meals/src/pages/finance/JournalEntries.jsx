import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const color = MODULE_COLORS.finance || '#1565C0'

const STATUS_STYLES = {
  draft:  { bg: THEME.statusNeutralBg,  text: THEME.statusNeutralText,  label: 'Draft' },
  posted: { bg: THEME.statusSuccessBg,  text: THEME.statusSuccessText,  label: 'Posted' },
  void:   { bg: THEME.statusErrorBg,    text: THEME.statusErrorText,    label: 'Void' },
}

export default function JournalEntries({ setPage }) {
  const { can } = usePermissions()
  const { currentSite } = useSite()
  const currentSiteId = currentSite?.id

  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    let q = supabase
      .from('journal_entries')
      .select('*, journal_lines(id, account_id, debit, credit)')
      .eq('site_id', currentSiteId)
      .eq('is_archived', false)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)

    if (filterStatus) q = q.eq('status', filterStatus)
    if (dateFrom) q = q.gte('entry_date', dateFrom)
    if (dateTo) q = q.lte('entry_date', dateTo)

    const { data, error } = await q
    if (error) showToast('Failed to load journal entries', 'error')
    else setEntries(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId, filterStatus, dateFrom, dateTo])

  const filtered = useMemo(() => {
    if (!search) return entries
    const q = search.toLowerCase()
    return entries.filter(e =>
      e.entry_number.toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q) ||
      (e.source_module || '').toLowerCase().includes(q)
    )
  }, [entries, search])

  const stats = useMemo(() => ({
    draft:  entries.filter(e => e.status === 'draft').length,
    posted: entries.filter(e => e.status === 'posted').length,
    void:   entries.filter(e => e.status === 'void').length,
    total:  entries.length,
  }), [entries])

  async function handleNewEntry() {
    const { data: numData, error: numErr } = await supabase.rpc('finance_next_entry_number', { p_site_id: currentSiteId })
    if (numErr) { showToast('Failed to generate entry number', 'error'); return }
    const userId = (await supabase.auth.getUser()).data.user?.id
    const { data, error } = await supabase
      .from('journal_entries')
      .insert({ site_id: currentSiteId, entry_number: numData, status: 'draft', created_by: userId, updated_by: userId })
      .select()
      .single()
    if (error) { showToast(error.message, 'error'); return }
    setPage('fi_journal_detail:' + data.id)
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: THEME.text }}>Journal Entries</h1>
          <div style={{ fontSize: 13, color: THEME.textMed, marginTop: 2 }}>{stats.total} entries · {stats.draft} draft · {stats.posted} posted</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportCsv(filtered.map(e => ({ Number: e.entry_number, Date: e.entry_date, Description: e.description || '', Status: e.status, Debit: e.total_debit, Credit: e.total_credit, Source: e.source_module || '' })), 'journal_entries')} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>
            <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>download</span>Export
          </button>
          {can('finance.create') && (
            <button onClick={handleNewEntry} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: color, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' }}>
              <span className="material-symbols-rounded" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>add</span>New Journal
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search entries…" style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text, width: 220 }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }}>
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="void">Void</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
        <span style={{ color: THEME.textMed, fontSize: 13 }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: `1px solid ${THEME.outline}`, fontSize: 13, fontFamily: 'inherit', background: THEME.surface, color: THEME.text }} />
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: THEME.textMed }}>
          <span className="material-symbols-rounded" style={{ fontSize: 48, color: THEME.outline, display: 'block', marginBottom: 12 }}>receipt_long</span>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No journal entries</div>
          <div style={{ fontSize: 13 }}>Create your first journal entry to start recording transactions.</div>
        </div>
      ) : (
        <div style={{ background: THEME.surface, borderRadius: 10, border: `1px solid ${THEME.outline}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                  {['Number', 'Date', 'Description', 'Status', 'Lines', 'Debit', 'Credit', 'Source'].map(h => (
                    <th key={h} style={{ textAlign: h === 'Debit' || h === 'Credit' || h === 'Lines' ? 'right' : 'left', padding: '10px 14px', color: THEME.textMed, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.5px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => {
                  const st = STATUS_STYLES[e.status] || STATUS_STYLES.draft
                  return (
                    <tr key={e.id} onClick={() => setPage('fi_journal_detail:' + e.id)} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }} onMouseEnter={ev => ev.currentTarget.style.background = THEME.surfaceHover} onMouseLeave={ev => ev.currentTarget.style.background = ''}>
                      <td style={{ padding: '10px 14px', fontWeight: 600 }}>{e.entry_number}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{e.entry_date}</td>
                      <td style={{ padding: '10px 14px', color: THEME.text, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.description || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, background: st.bg, color: st.text }}>{st.label}</span>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{e.journal_lines?.length || 0}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${Number(e.total_debit || 0).toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>${Number(e.total_credit || 0).toLocaleString('en', { minimumFractionDigits: 2 })}</td>
                      <td style={{ padding: '10px 14px', color: THEME.textMed }}>{e.source_module || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
