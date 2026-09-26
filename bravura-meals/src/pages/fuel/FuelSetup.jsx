import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import FinShell from '../../components/FinShell'
import Denied from '../../components/Denied'
import { FIN, finCard, finBtn, finInput } from '../../utils/financeTheme'
import { showToast } from '../../components/ui'
import { friendlyError } from '../../utils/friendlyError'

// FU20 — Fuel settings hub (issue #73, F5): General (old settings page), Rules (second fill, reorder, dip tolerance per tank),
// Fuel types — as tabs, like Fleet and Stores settings.
const FuelSettings = lazy(() => import('./FuelSettings'))
const FuelTypes = lazy(() => import('./FuelTypes'))

function Rules() {
  const { currentSiteId } = useSite()
  const [s, setS] = useState(null)
  const [tanks, setTanks] = useState([])
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!currentSiteId) return
    supabase.from('fuel_settings').select('id, second_fill_hours, reorder_days').eq('site_id', currentSiteId).maybeSingle()
      .then(({ data }) => setS(data || { second_fill_hours: 4, reorder_days: 5 }))
    supabase.from('fuel_tanks').select('id, name, capacity_litres, dip_tolerance_litres').eq('site_id', currentSiteId).eq('is_archived', false).order('name')
      .then(({ data }) => setTanks(data || []))
  }, [currentSiteId])

  const save = async () => {
    setSaving(true)
    const payload = { second_fill_hours: Number(s.second_fill_hours) || 4, reorder_days: Number(s.reorder_days) || 5 }
    const r1 = s.id ? await supabase.from('fuel_settings').update(payload).eq('site_id', currentSiteId)
                    : await supabase.from('fuel_settings').insert([{ ...payload, site_id: currentSiteId }])
    let err = r1.error
    for (const t of tanks) {
      if (err) break
      const { error } = await supabase.from('fuel_tanks').update({ dip_tolerance_litres: Number(t.dip_tolerance_litres) || 120 }).eq('id', t.id).eq('site_id', currentSiteId)
      err = error
    }
    setSaving(false)
    showToast(err ? friendlyError(err) : 'Saved', err ? 'red' : 'green')
  }

  if (!s) return <div style={{ ...finCard, color: FIN.faint }}>Loading…</div>
  const row = { display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 140px', gap: 12, alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${FIN.lineSoft}` }
  return (
    <div style={finCard}>
      <div style={row}><label htmlFor="r-second">Second fill of a machine needs a reason within (hours)</label>
        <input id="r-second" type="number" style={finInput} value={s.second_fill_hours} onChange={e => setS({ ...s, second_fill_hours: e.target.value })} /></div>
      <div style={row}><label htmlFor="r-reorder">Order fuel when a tank has fewer days of cover than</label>
        <input id="r-reorder" type="number" style={finInput} value={s.reorder_days} onChange={e => setS({ ...s, reorder_days: e.target.value })} /></div>
      <div style={{ fontSize: 13, color: FIN.muted, margin: '16px 0 4px' }}>Dip tolerance per tank — a gap bigger than this needs a reason and sign-off (about 2 dipstick marks).</div>
      {tanks.map(t => (
        <div key={t.id} style={row}><label htmlFor={`r-tol-${t.id}`}>{t.name} <span style={{ color: FIN.faint, fontSize: 12 }}>({Number(t.capacity_litres || 0).toLocaleString()} L)</span></label>
          <input id={`r-tol-${t.id}`} type="number" style={finInput} value={t.dip_tolerance_litres ?? 120}
            onChange={e => setTanks(ts => ts.map(x => x.id === t.id ? { ...x, dip_tolerance_litres: e.target.value } : x))} /></div>
      ))}
      <button style={{ ...finBtn, marginTop: 14 }} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save rules'}</button>
    </div>
  )
}

const TABS = [['general', 'General', FuelSettings], ['rules', 'Rules', Rules], ['types', 'Fuel types', FuelTypes]]

export default function FuelSetup({ setPage, initialTab = 'general' }) {
  const { can } = usePermissions()
  const [tab, setTab] = useState(TABS.some(t => t[0] === initialTab) ? initialTab : 'general')
  if (!can('fuel.edit')) return <Denied />
  const Comp = TABS.find(t => t[0] === tab)[2]
  return (
    <FinShell module="Fuel" homePage="fuel_dashboard" setPage={setPage} title="Settings"
      tabs={TABS.map(([key, label]) => ({ key, label }))} tab={tab} onTab={setTab}>
      <Suspense fallback={<div style={{ color: FIN.faint }}>Loading…</div>}><Comp setPage={setPage} /></Suspense>
    </FinShell>
  )
}
