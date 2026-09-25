import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { FIN } from '../../utils/financeTheme'
import { useFinEmbedded } from '../../components/finEmbed'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { Card, Button, PageHeader, showToast, fmtDate } from '../../components/ui'
import Denied from '../../components/Denied'

const FI = FIN.maroon  // finance design: maroon actions (issue #49)
const CONDITIONS = ['good', 'fair', 'poor', 'damaged']
const pill = (on, color) => ({ minHeight: '36px', padding: '6px 12px', borderRadius: '999px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '12px',
  fontWeight: 600, border: `1px solid ${on ? color : THEME.outlineVar}`, background: on ? color : THEME.surface, color: on ? '#fff' : THEME.textMed })

export default function AssetVerification() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [counts, setCounts] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')

  const loadCounts = useCallback(async () => {
    if (!currentSiteId) return
    const { data } = await supabase.from('asset_verifications').select('*').eq('site_id', currentSiteId).order('created_at', { ascending: false })
    setCounts(data || [])
    const open = (data || []).find(c => c.status === 'open')
    if (open && !openId) setOpenId(open.id)
  }, [currentSiteId, openId])
  useEffect(() => { loadCounts() }, [loadCounts])

  const loadItems = useCallback(async () => {
    if (!openId) { setItems([]); return }
    const { data } = await supabase.from('asset_verification_items')
      .select('*, asset:fixed_assets(asset_code, name, location, serial_number)').eq('verification_id', openId)
    setItems((data || []).sort((a, b) => (a.asset?.asset_code || '').localeCompare(b.asset?.asset_code || '')))
  }, [openId])
  useEffect(() => { loadItems() }, [loadItems])

  if (!can('assets.view')) return <Denied />

  const current = (counts || []).find(c => c.id === openId)
  const editable = current?.status === 'open' && can('assets.create')

  async function start() {
    const name = window.prompt('Name this count', `Asset count ${new Date().toLocaleDateString([], { month: 'long', year: 'numeric' })}`)
    if (name === null) return
    const { data, error } = await supabase.rpc('fa_start_verification', { p_site_id: currentSiteId, p_name: name })
    if (error) { showToast(error.message, 'red'); return }
    setOpenId(data); loadCounts()
  }
  async function mark(it, found, condition = null) {
    const { error } = await supabase.rpc('fa_verify_item', { p_item_id: it.id, p_found: found, p_condition: condition || it.condition || (found ? 'good' : null),
      p_location: it.location_seen || it.asset?.location || null, p_notes: it.notes || null })
    if (error) { showToast(error.message, 'red'); return }
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, found, condition: found ? (condition || x.condition || 'good') : null } : x))
  }
  async function close() {
    const unchecked = items.filter(i => i.found === null).length
    if (!window.confirm(unchecked ? `${unchecked} asset(s) haven't been checked. Close the count anyway?` : 'Close this count?')) return
    const { data, error } = await supabase.rpc('fa_close_verification', { p_id: openId })
    if (error) { showToast(error.message, 'red'); return }
    showToast(`Closed — ${data.found} found, ${data.missing} missing${data.missing ? ' (asset managers notified)' : ''}`, data.missing ? 'red' : 'green')
    loadCounts(); loadItems()
  }

  const done = items.filter(i => i.found !== null).length
  const missing = items.filter(i => i.found === false).length
  const shown = items.filter(i => !q || `${i.asset?.asset_code} ${i.asset?.name} ${i.asset?.serial_number || ''} ${i.asset?.location || ''}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div style={{ maxWidth: '900px' }}>
      <PageHeader title="Asset Counts" actions={can('assets.create') && !(counts || []).some(c => c.status === 'open')
        ? <Button icon="fact_check" onClick={start}>Start a count</Button> : null} />

      {(counts || []).length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {counts.map(c => (
            <button key={c.id} onClick={() => setOpenId(c.id)} style={pill(c.id === openId, FI)}>
              {c.name}{c.status === 'open' ? ' · open' : ` · ${fmtDate(c.closed_at?.slice(0, 10))}`}
            </button>
          ))}
        </div>
      )}

      {!current ? (
        <Card style={{ padding: '28px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>
          Start a count to check every asset on the register is physically there. Mark each one found (with its condition) or missing, then close the count.
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '14px', color: THEME.text }}><b>{done}</b> of {items.length} checked{missing ? <span style={{ color: THEME.error }}> · {missing} missing</span> : ''}</div>
            <div style={{ flex: 1, height: '8px', minWidth: '120px', borderRadius: '4px', background: THEME.surfaceVar, overflow: 'hidden' }}>
              <div style={{ width: `${items.length ? done / items.length * 100 : 0}%`, height: '100%', background: FI }} />
            </div>
            <input id="av-search" aria-label="Search" placeholder="Search" value={q} onChange={e => setQ(e.target.value)}
              style={{ minHeight: '36px', padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }} />
            {editable && can('assets.edit') && <Button onClick={close}>Close count</Button>}
          </div>
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            {shown.map((it, i) => (
              <div key={it.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 14px', flexWrap: 'wrap',
                borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none', background: it.found === false ? THEME.statusErrorBg : 'transparent' }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontSize: '14px', color: THEME.text }}><b>{it.asset?.asset_code}</b> {it.asset?.name}</div>
                  <div style={{ fontSize: '12px', color: THEME.textLow }}>{[it.asset?.serial_number, it.asset?.location].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                {editable ? (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {CONDITIONS.map(c => <button key={c} onClick={() => mark(it, true, c)} style={pill(it.found && it.condition === c, THEME.statusSuccessText)}>{c}</button>)}
                    <button onClick={() => mark(it, false)} style={pill(it.found === false, THEME.error)}>Missing</button>
                  </div>
                ) : (
                  <span style={{ fontSize: '12px', fontWeight: 600, color: it.found ? THEME.statusSuccessText : it.found === false ? THEME.error : THEME.textLow, textTransform: 'capitalize' }}>
                    {it.found ? `Found · ${it.condition}` : it.found === false ? 'Missing' : 'Not checked'}
                  </span>
                )}
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  )
}
