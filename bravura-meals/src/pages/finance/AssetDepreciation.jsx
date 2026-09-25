import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { FIN } from '../../utils/financeTheme'
import { useFinEmbedded } from '../../components/finEmbed'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, PageHeader, showToast } from '../../components/ui'
import Denied from '../../components/Denied'
import { exportCsv } from '../../utils/csv'

const FI = FIN.maroon  // finance design: maroon actions (issue #49)
const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const monthLabel = p => new Date(p + 'T00:00:00').toLocaleDateString([], { month: 'long', year: 'numeric' })

export default function AssetDepreciation() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.from('asset_depreciation')
      .select('*, asset:fixed_assets(asset_code, name)').eq('site_id', currentSiteId)
      .order('period', { ascending: false }).limit(2000)
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [currentSiteId])
  useEffect(() => { load() }, [load])

  const byMonth = useMemo(() => {
    const m = {}
    for (const r of rows || []) {
      const k = r.period
      m[k] = m[k] || { period: k, count: 0, total: 0, unposted: 0, items: [] }
      m[k].count++; m[k].total += Number(r.amount); if (!r.journal_id) m[k].unposted++; m[k].items.push(r)
    }
    return Object.values(m).sort((a, b) => b.period.localeCompare(a.period))
  }, [rows])
  const [open, setOpen] = useState(null)

  if (!can('assets.view')) return <Denied />

  async function run() {
    if (!window.confirm(`Post depreciation for ${monthLabel(month + '-01')}? Assets already done for that month are skipped.`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('fa_run_depreciation', { p_site_id: currentSiteId, p_period: month + '-01' })
    setBusy(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast(data.assets ? `${data.assets} asset${data.assets > 1 ? 's' : ''} depreciated — ${usd(data.total)}` : 'Nothing to depreciate for that month', 'green')
    load()
  }

  return (
    <div style={{ maxWidth: '900px' }}>
      <PageHeader title="Depreciation" />
      {can('assets.approve') && (
        <Card style={{ padding: '14px', marginBottom: '14px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label htmlFor="dep-month" style={{ fontSize: '13px', color: THEME.textMed }}>Month</label>
          <input id="dep-month" type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}
            style={{ minHeight: '40px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }} />
          <Button icon="play_arrow" onClick={run} disabled={busy}>Run depreciation</Button>
          <span style={{ fontSize: '12px', color: THEME.textLow, flex: '1 1 260px' }}>
            Each asset in use is charged once per month and posted to the ledger through the "Monthly depreciation" posting rule.
          </span>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {!rows ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : byMonth.length === 0 ? (
          <div style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No depreciation posted yet.</div>
        ) : byMonth.map((m, i) => (
          <div key={m.period} style={{ borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none' }}>
            <button onClick={() => setOpen(open === m.period ? null : m.period)} aria-expanded={open === m.period} style={{
              width: '100%', display: 'flex', gap: '12px', alignItems: 'center', padding: '12px 14px', background: 'none', border: 'none',
              cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: THEME.text, fontSize: '14px' }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{monthLabel(m.period)}</span>
              <span style={{ color: THEME.textMed, fontSize: '13px' }}>{m.count} asset{m.count > 1 ? 's' : ''}</span>
              {m.unposted > 0 && <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.statusWarningText }}>{m.unposted} not in ledger</span>}
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, minWidth: '110px', textAlign: 'right' }}>{usd(m.total)}</span>
            </button>
            {open === m.period && (
              <div style={{ padding: '0 14px 12px' }}>
                <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                  <tbody>{m.items.map(r => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${THEME.outlineVar}`, color: THEME.text }}>
                      <td style={{ padding: '5px 0' }}>{r.asset?.asset_code} {r.asset?.name}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{usd(r.amount)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: THEME.textMed }}>book {usd(r.book_value_after)}</td>
                    </tr>))}</tbody>
                </table>
                <div style={{ marginTop: '8px' }}>
                  <Button variant="text" icon="download" onClick={() => exportCsv(`depreciation_${m.period.slice(0, 7)}.csv`, ['Asset', 'Name', 'Charge', 'Accumulated', 'Book value', 'Posted'],
                    m.items.map(r => [r.asset?.asset_code, r.asset?.name, r.amount, r.accumulated_after, r.book_value_after, r.journal_id ? 'yes' : 'no']))}>CSV</Button>
                </div>
                {m.unposted > 0 && <div style={{ fontSize: '12px', color: THEME.statusWarningText }}>Set up the "Monthly depreciation" rule in Posting Rules (FI13) so future runs reach the ledger.</div>}
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  )
}
