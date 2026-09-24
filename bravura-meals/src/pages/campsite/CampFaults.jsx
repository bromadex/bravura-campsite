import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, showToast, fmtDate } from '../../components/ui'

const ACCENT = MODULE_COLORS.campsite
const CAT = { plumbing: 'Plumbing', electrical: 'Electrical', aircon_heating: 'Aircon / heating', door_lock: 'Door / lock', furniture: 'Furniture', cleaning: 'Cleaning', pests: 'Pests', other: 'Other' }
const NEXT = { open: [['in_progress', 'Start work']], in_progress: [['resolved', 'Mark fixed']], resolved: [['closed', 'Close'], ['open', 'Reopen']], closed: [] }
const btn = (bg, fg = '#fff') => ({ minHeight: '36px', padding: '6px 12px', borderRadius: '8px', border: 'none', background: bg, color: fg, fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer' })

export default function CampFaults() {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const [open, setOpen] = useState(true)
  const [rows, setRows] = useState(null)
  const [notes, setNotes] = useState({})

  const load = useCallback(async () => {
    if (!currentSiteId) return
    let q = supabase.from('camp_room_faults')
      .select('id, category, description, photo_path, status, resolution_notes, created_at, resolved_at, room:camp_rooms(room_number), employee:employees(name)')
      .eq('site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }).limit(300)
    q = open ? q.in('status', ['open', 'in_progress']) : q.in('status', ['resolved', 'closed'])
    const { data, error } = await q
    if (error) showToast(error.message, 'red')
    setRows(data || [])
  }, [currentSiteId, open])
  useEffect(() => { setRows(null); load() }, [load])

  async function update(f, status) {
    const { error } = await supabase.rpc('camp_update_fault', { p_fault_id: f.id, p_status: status, p_notes: notes[f.id] || null })
    if (error) { showToast(error.message, 'red'); return }
    showToast('Updated', 'green'); load()
  }
  async function viewPhoto(path) {
    const { data, error } = await supabase.storage.from('ess-uploads').createSignedUrl(path, 60)
    if (error) { showToast(error.message, 'red'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  return (
    <div>
      <PageHeader title="Room Faults" subtitle="Problems residents reported from My Camp." />
      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
        {[[true, 'Open'], [false, 'Fixed / closed']].map(([v, t]) => (
          <button key={t} onClick={() => setOpen(v)} aria-pressed={open === v} style={btn(open === v ? ACCENT : THEME.surfaceVar, open === v ? '#fff' : THEME.text)}>{t}</button>
        ))}
      </div>
      {!rows ? <div style={{ color: THEME.textLow }}>Loading…</div> : rows.length === 0 ? (
        <Card style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>No faults.</Card>
      ) : rows.map(f => (
        <Card key={f.id} style={{ padding: '12px 14px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 600, color: THEME.text }}>Room {f.room?.room_number || '—'} · {CAT[f.category] || f.category}</div>
            <div style={{ fontSize: '12px', color: THEME.textLow }}>{f.employee?.name} · {fmtDate(f.created_at.slice(0, 10))} · <span style={{ textTransform: 'capitalize' }}>{f.status.replace('_', ' ')}</span></div>
          </div>
          <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '4px' }}>{f.description}</div>
          {f.resolution_notes && <div style={{ fontSize: '12px', color: THEME.statusSuccessText, marginTop: '4px' }}>{f.resolution_notes}</div>}
          <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {f.photo_path && <button style={btn(THEME.surfaceVar, THEME.text)} onClick={() => viewPhoto(f.photo_path)}><Icon name="photo" size={16} style={{ verticalAlign: 'middle' }} /> Photo</button>}
            {can('accommodation.edit') && NEXT[f.status].length > 0 && <>
              <input id={`cf-note-${f.id}`} aria-label="Note" placeholder="Note (optional)" value={notes[f.id] || ''} onChange={e => setNotes({ ...notes, [f.id]: e.target.value })}
                style={{ flex: '1 1 200px', minHeight: '36px', padding: '6px 10px', borderRadius: '8px', border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit' }} />
              {NEXT[f.status].map(([s, t]) => <button key={s} style={btn(ACCENT)} onClick={() => update(f, s)}>{t}</button>)}
            </>}
          </div>
        </Card>
      ))}
    </div>
  )
}
