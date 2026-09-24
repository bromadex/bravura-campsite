import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Icon } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { useMe, Loading, NotLinked, ME_COLOR, MONTHS, usd } from './shared'

// Each app: [page, label, icon, tint]. Tints keep icons distinguishable at a glance.
const APPS = [
  ['me_attendance', 'Clock in',     'schedule',          '#2E7D32'],
  ['me_leave',      'Leave',        'beach_access',      '#0277BD'],
  ['me_payslips',   'Payslips',     'payments',          '#6A1B9A'],
  ['me_safety',     'Safety',       'health_and_safety', '#E65100'],
  ['me_expenses',   'Expenses',     'receipt_long',      '#00838F'],
  ['me_advances',   'Advances',     'savings',           '#AD1457'],
  ['me_camp',       'Camp & meals', 'bed',               '#5D4037'],
  ['me_documents',  'Policies',     'description',       '#283593'],
  ['me_details',    'My details',   'badge',             '#455A64'],
  ['me_tax',        'Tax (ITF16)',  'account_balance',   '#558B2F'],
]

function App({ icon, label, tint, badge, onClick }) {
  return (
    <button onClick={onClick} aria-label={badge ? `${label} (${badge} waiting)` : label} style={{
      background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', fontFamily: 'inherit',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', position: 'relative', minWidth: 0,
    }}>
      <span style={{ width: '56px', height: '56px', borderRadius: '16px', background: tint, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,.15)' }}>
        <Icon name={icon} size={28} />
      </span>
      {badge > 0 && (
        <span style={{ position: 'absolute', top: 0, right: 'calc(50% - 34px)', minWidth: '20px', height: '20px', padding: '0 5px',
          borderRadius: '10px', background: '#D32F2F', color: '#fff', fontSize: '11px', fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${THEME.surface}` }}>{badge > 99 ? '99+' : badge}</span>
      )}
      <span style={{ fontSize: '12px', color: THEME.text, textAlign: 'center', lineHeight: 1.2 }}>{label}</span>
    </button>
  )
}

export default function MeHome({ setPage }) {
  const { me, loading } = useMe()
  const { profile } = useAuth()
  const [unread, setUnread] = useState(0)
  const [toApprove, setToApprove] = useState(0)
  const [leave, setLeave] = useState(null)
  const [team, setTeam] = useState(null)

  useEffect(() => {
    if (!me?.linked) return
    supabase.rpc('ess_my_leave').then(({ data }) => setLeave(data))
    supabase.rpc('ess_team_today').then(({ data }) => setTeam(data))
  }, [me?.linked])

  useEffect(() => {
    if (!profile?.id) return
    supabase.from('notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', profile.id).eq('is_read', false).then(({ count }) => setUnread(count || 0))
    supabase.rpc('approval_inbox').then(({ data }) => setToApprove((data || []).length))
  }, [profile?.id])

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />

  const annual = (leave?.balances || []).find(b => /annual/i.test(b.leave_type)) || (leave?.balances || [])[0]
  const slip = me.last_payslip
  const isLead = (team?.members || []).length > 0
  const teamWaiting = (team?.timesheets?.length || 0) + (team?.leave?.length || 0)
  const onSite = (team?.members || []).filter(m => m.state === 'a_on_site').length

  return (
    <div style={{ maxWidth: '520px', margin: '0 auto' }}>
      <div style={{ marginBottom: '14px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, textWrap: 'balance' }}>Hello, {me.name?.split(' ')[0]}</div>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '2px' }}>
          {[me.designation, me.site_name].filter(Boolean).join(' · ')}
          {me.employee_number && <> · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{me.employee_number}</span></>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', fontSize: '12px', color: THEME.textMed, flexWrap: 'wrap' }}>
        <span style={{ padding: '6px 10px', borderRadius: '999px', background: THEME.surfaceVar }}>
          Last pay <b style={{ color: THEME.text }}>{slip ? `${usd(slip.net)} · ${MONTHS[slip.period_month - 1]}` : '—'}</b>
        </span>
        <span style={{ padding: '6px 10px', borderRadius: '999px', background: THEME.surfaceVar }}>
          Leave left <b style={{ color: THEME.text }}>{annual ? `${Number(annual.remaining).toFixed(1)} days` : '—'}</b>
        </span>
        {isLead && (
          <span style={{ padding: '6px 10px', borderRadius: '999px', background: THEME.surfaceVar }}>
            Team on site <b style={{ color: THEME.text }}>{onSite}/{team.members.length}</b>
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', rowGap: '18px', columnGap: '6px' }}>
        {isLead && <App icon="groups" label="My team" tint={ME_COLOR} badge={teamWaiting} onClick={() => setPage('me_team')} />}
        {APPS.map(([page, label, icon, tint]) => (
          <App key={page} icon={icon} label={label} tint={tint} badge={page === 'me_leave' ? me.pending_leave : 0} onClick={() => setPage(page)} />
        ))}
        <App icon="notifications" label="Notifications" tint="#F57C00" badge={unread} onClick={() => setPage('me_notifications')} />
        <App icon="approval" label="Approvals" tint="#37474F" badge={toApprove} onClick={() => setPage('me_approvals')} />
      </div>

      {me.manager && <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '20px', textAlign: 'center' }}>Your line manager: {me.manager}</div>}
    </div>
  )
}
