import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { THEME } from '../../utils/permissions'
import { Card, Icon } from '../../components/ui'
import { useMe, Loading, NotLinked, ME_COLOR, MONTHS, usd } from './shared'

function Tile({ icon, label, value, sub, onClick }) {
  return (
    <button onClick={onClick} style={{
      textAlign: 'left', border: `1px solid ${THEME.outlineVar}`, borderRadius: '14px', padding: '16px',
      background: THEME.surface, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', flexDirection: 'column', gap: '6px',
      minHeight: '112px',
    }}>
      <Icon name={icon} size={22} style={{ color: ME_COLOR }} />
      <span style={{ fontSize: '12px', color: THEME.textMed }}>{label}</span>
      <span style={{ fontSize: '20px', fontWeight: 700, color: THEME.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontSize: '12px', color: THEME.textLow }}>{sub}</span>}
    </button>
  )
}

export default function MeHome({ setPage }) {
  const { me, loading } = useMe()
  const navigate = useNavigate()
  const [leave, setLeave] = useState(null)
  const [advances, setAdvances] = useState([])

  useEffect(() => {
    if (!me?.linked) return
    supabase.rpc('ess_my_leave').then(({ data }) => setLeave(data))
    supabase.rpc('ess_my_open_advances').then(({ data }) => setAdvances(data || []))
  }, [me?.linked])

  if (loading) return <Loading />
  if (!me?.linked) return <NotLinked />

  const annual = (leave?.balances || []).find(b => /annual/i.test(b.leave_type)) || (leave?.balances || [])[0]
  const openAdv = advances.reduce((s, a) => s + Number(a.outstanding || 0), 0)
  const slip = me.last_payslip

  return (
    <div style={{ maxWidth: '720px' }}>
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700, color: THEME.text, textWrap: 'balance' }}>Hello, {me.name?.split(' ')[0]}</div>
        <div style={{ fontSize: '13px', color: THEME.textMed, marginTop: '2px' }}>
          {[me.designation, me.department, me.site_name].filter(Boolean).join(' · ')}
          {me.employee_number && <> · <span style={{ fontVariantNumeric: 'tabular-nums' }}>{me.employee_number}</span></>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        <Tile icon="payments" label="Last payslip" onClick={() => setPage('me_payslips')}
          value={slip ? usd(slip.net) : '—'} sub={slip ? `${MONTHS[slip.period_month - 1]} ${slip.period_year}` : 'None yet'} />
        <Tile icon="beach_access" label={annual ? `${annual.leave_type} left` : 'Leave'} onClick={() => setPage('me_leave')}
          value={annual ? `${Number(annual.remaining).toFixed(1)} d` : '—'}
          sub={me.pending_leave > 0 ? `${me.pending_leave} request${me.pending_leave > 1 ? 's' : ''} waiting` : 'Nothing pending'} />
        <Tile icon="receipt_long" label="Advances to account for" onClick={() => setPage('me_expenses')}
          value={usd(openAdv)} sub={advances.length ? `${advances.length} open` : 'All settled'} />
        <Tile icon="schedule" label="Attendance" onClick={() => setPage('me_attendance')} value="View" sub="This month" />
      </div>

      <Card style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text, marginBottom: '10px' }}>Quick actions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
          {[
            ['event_available', 'Request leave', 'me_leave'],
            ['add_card', 'Claim expenses', 'me_expenses'],
            ['request_quote', 'Ask for an advance', 'me_expenses'],
            ['approval', 'My approvals inbox', null],
          ].map(([icon, text, page]) => (
            <button key={text} onClick={() => page ? setPage(page) : navigate('/notifications/approvals_inbox')}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '48px', padding: '10px 12px', borderRadius: '10px',
                border: `1px solid ${THEME.outlineVar}`, background: THEME.surface, color: THEME.text, fontFamily: 'inherit',
                fontSize: '14px', cursor: 'pointer', textAlign: 'left' }}>
              <Icon name={icon} size={20} style={{ color: ME_COLOR }} /> {text}
            </button>
          ))}
        </div>
      </Card>
      {me.manager && <div style={{ fontSize: '12px', color: THEME.textLow, marginTop: '12px' }}>Your line manager: {me.manager}</div>}
    </div>
  )
}
