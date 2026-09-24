import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, showToast } from '../../components/ui'

export const ME_COLOR = MODULE_COLORS.me || '#00897B'
export const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export const usd = n => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function useMe() {
  const [me, setMe] = useState(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase.rpc('ess_me')
    if (error) showToast(error.message, 'red')
    setMe(data || { linked: false })
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  return { me, loading, reload: load }
}

export function Loading() {
  return <div style={{ padding: '48px', textAlign: 'center' }}><Icon name="progress_activity" size={24} style={{ color: ME_COLOR }} /></div>
}

export function NotLinked() {
  return (
    <Card style={{ padding: '32px 20px', textAlign: 'center' }}>
      <Icon name="link_off" size={36} style={{ color: THEME.outline, marginBottom: '8px' }} />
      <div style={{ fontWeight: 600, color: THEME.text, marginBottom: '6px' }}>Your login isn't linked to an employee record yet</div>
      <div style={{ fontSize: '13px', color: THEME.textMed, maxWidth: '420px', margin: '0 auto' }}>
        Ask HR or an administrator to link it (Admin → Employee Links). Once linked, your payslips, leave and attendance appear here.
      </div>
    </Card>
  )
}

export const STATUS_STYLE = {
  draft:     { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Draft' },
  pending:   { bg: THEME.statusWarningBg, color: THEME.statusWarningText, label: 'Pending' },
  submitted: { bg: THEME.statusWarningBg, color: THEME.statusWarningText, label: 'Waiting for approval' },
  approved:  { bg: THEME.statusSuccessBg, color: THEME.statusSuccessText, label: 'Approved' },
  paid:      { bg: THEME.statusInfoBg,    color: THEME.statusInfoText,    label: 'Paid' },
  rejected:  { bg: THEME.statusErrorBg,   color: THEME.statusErrorText,   label: 'Rejected' },
  cancelled: { bg: THEME.statusNeutralBg, color: THEME.statusNeutralText, label: 'Cancelled' },
}

export function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.draft
  return <span style={{ padding: '3px 9px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</span>
}

// Receipts live in the private expense-receipts bucket under <site_id>/<user_id>/.
export async function uploadReceipt(file, siteId, userId) {
  if (!file) return null
  if (file.size > 10 * 1024 * 1024) throw new Error('Receipt is larger than 10 MB')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${siteId}/${userId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('expense-receipts').upload(path, file, { contentType: file.type })
  if (error) throw error
  return path
}

export async function openReceipt(path) {
  const { data, error } = await supabase.storage.from('expense-receipts').createSignedUrl(path, 120)
  if (error) { showToast('Could not open receipt', 'red'); return }
  window.open(data.signedUrl, '_blank', 'noopener')
}

export const bigBtn = (bg, fg = '#fff') => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  minHeight: '44px', padding: '10px 16px', borderRadius: '10px', border: 'none',
  background: bg, color: fg, fontSize: '14px', fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
})

export const field = {
  width: '100%', minHeight: '44px', padding: '10px 12px', borderRadius: '10px', fontSize: '15px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text,
  fontFamily: 'inherit', boxSizing: 'border-box',
}
export const label = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
