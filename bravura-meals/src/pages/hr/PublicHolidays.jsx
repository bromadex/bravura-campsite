import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'

const ACCENT = MODULE_COLORS.workforce
const fieldStyle = { minHeight: '40px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit', fontSize: '14px' }
const btn = (bg, fg = '#fff') => ({ minHeight: '40px', padding: '8px 14px', borderRadius: '8px', border: 'none', background: bg, color: fg, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' })

export default function PublicHolidays() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { profile } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [rows, setRows] = useState(null)
  const [form, setForm] = useState({ date: '', name: '', siteOnly: false })

  const load = useCallback(async () => {
    if (!currentSiteId) return
    const { data, error } = await supabase.from('public_holidays').select('id, site_id, date, name')
      .eq('is_archived', false).or(`site_id.is.null,site_id.eq.${currentSiteId}`)
      .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`).order('date')
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [currentSiteId, year])
  useEffect(() => { load() }, [load])

  async function add() {
    if (!form.date || !form.name.trim()) { showToast('Enter the date and name', 'red'); return }
    const { error } = await supabase.from('public_holidays').insert({
      date: form.date, name: form.name.trim(), site_id: form.siteOnly ? currentSiteId : null, created_by: profile?.id,
    })
    if (error) { showToast(error.message, 'red'); return }
    showToast('Holiday added', 'green'); setForm({ date: '', name: '', siteOnly: false }); load()
  }
  async function archive(h) {
    if (!window.confirm(`Remove ${h.name} (${fmtDate(h.date)}) from the calendar?`)) return
    const { error } = await supabase.from('public_holidays').update({ is_archived: true }).eq('id', h.id)
    if (error) { showToast(error.message, 'red'); return }
    load()
  }

  const canEdit = can('hr.edit')
  return (
    <div style={{ maxWidth: '720px' }}>
      <PageHeader title="Public Holidays" subtitle="Approved overtime worked on these days is paid at the holiday rate (2×). National holidays apply to every site." />
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' }}>
        <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => setYear(y => y - 1)} aria-label="Previous year"><Icon name="chevron_left" size={18} /></button>
        <b style={{ fontSize: '16px', color: THEME.text, minWidth: '48px', textAlign: 'center' }}>{year}</b>
        <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => setYear(y => y + 1)} aria-label="Next year"><Icon name="chevron_right" size={18} /></button>
      </div>

      {canEdit && (
        <Card style={{ padding: '14px', marginBottom: '14px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input id="ph-date" aria-label="Date" type="date" style={fieldStyle} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <input id="ph-name" aria-label="Holiday name" placeholder="e.g. Heroes' Day" style={{ ...fieldStyle, flex: '1 1 200px' }} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <label htmlFor="ph-site" style={{ fontSize: '13px', color: THEME.textMed, display: 'flex', gap: '6px', alignItems: 'center' }}>
            <input id="ph-site" type="checkbox" checked={form.siteOnly} onChange={e => setForm({ ...form, siteOnly: e.target.checked })} /> This site only
          </label>
          <button style={btn(ACCENT)} onClick={add}>Add holiday</button>
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {!rows ? <div style={{ padding: '20px', color: THEME.textLow }}>Loading…</div> : rows.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No holidays set for {year}.</div>
        ) : rows.map((h, i) => (
          <div key={h.id} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '10px 14px', borderTop: i ? `1px solid ${THEME.outlineVar}` : 'none' }}>
            <span style={{ width: '110px', fontVariantNumeric: 'tabular-nums', color: THEME.text }}>{fmtDate(h.date)}</span>
            <span style={{ width: '40px', fontSize: '12px', color: THEME.textLow }}>{new Date(h.date + 'T00:00:00').toLocaleDateString([], { weekday: 'short' })}</span>
            <span style={{ flex: 1, color: THEME.text }}>{h.name}</span>
            <span style={{ fontSize: '11px', color: THEME.textLow }}>{h.site_id ? 'This site' : 'National'}</span>
            {canEdit && <button onClick={() => archive(h)} aria-label={`Remove ${h.name}`} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textLow, padding: '4px' }}><Icon name="close" size={18} /></button>}
          </div>
        ))}
      </Card>
    </div>
  )
}
