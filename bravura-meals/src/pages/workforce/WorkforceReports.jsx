import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, fmtDate } from '../../components/ui'

const CO_COLORS = ['#9C2A2A','#1A6B52','#4A3C8C','#1558A6','#BF5400','#2E7D32','#AD1457']

export default function WorkforceReports() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { supabase } = await import('../../supabaseClient')
      const [empRes, coRes] = await Promise.all([
        supabase.from('employees').select('*, contractor:contractors(id,name,short_code)').order('name'),
        supabase.from('contractors').select('*').order('name'),
      ])
      const employees   = empRes.data || []
      const contractors = coRes.data  || []
      setData({ employees, contractors })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return (
    <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
      <Icon name="progress_activity" size={24} style={{ color: MODULE_COLORS.workforce }} />
    </div>
  )

  const { employees, contractors } = data
  const active      = employees.filter(e => e.status === 'active')
  const inactive    = employees.filter(e => e.status === 'terminated')
  const onLeave     = employees.filter(e => e.status === 'on_leave' || e.status === 'long_leave')
  const shortLeave  = employees.filter(e => e.status === 'on_leave')
  const longLeave   = employees.filter(e => e.status === 'long_leave')

  const byContractor = contractors.map((c, i) => ({
    ...c,
    color:    CO_COLORS[i % CO_COLORS.length],
    active:   active.filter(e => e.contractor_id === c.id).length,
    inactive: inactive.filter(e => e.contractor_id === c.id).length,
    total:    employees.filter(e => e.contractor_id === c.id).length,
  })).filter(c => c.total > 0)

  const maxByContractor = Math.max(...byContractor.map(c => c.total), 1)

  return (
    <div>
      <h2 style={{ fontSize: '22px', fontWeight: 400, color: THEME.text, margin: '0 0 20px' }}>Employee Reports</h2>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Employees',  v: employees.length,  c: MODULE_COLORS.workforce },
          { label: 'Active',           v: active.length,      c: THEME.success },
          { label: 'Inactive',         v: inactive.length,    c: THEME.textLow },
          { label: 'On Leave',         v: onLeave.length,     c: THEME.warning },
          { label: 'Contractors',      v: contractors.length, c: THEME.info },
        ].map(s => (
          <div key={s.label} style={{ background: THEME.surface, border: `1px solid ${THEME.outlineVar}`, borderRadius: '16px', padding: '16px', textAlign: 'center', borderTop: `4px solid ${s.c}` }}>
            <div style={{ fontSize: '32px', fontWeight: 300, color: s.c }}>{s.v}</div>
            <div style={{ fontSize: '11px', color: THEME.textLow, marginTop: '4px' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
        {/* By contractor */}
        <Card elevated>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Icon name="business" size={18} style={{ color: MODULE_COLORS.workforce }} />
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Headcount by Contractor</div>
          </div>
          {byContractor.map(c => (
            <div key={c.id} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ fontSize: '13px', fontWeight: 500 }}>{c.name}</span>
                <div style={{ fontSize: '12px', color: THEME.textMed }}>
                  <span style={{ color: THEME.success, fontWeight: 600 }}>{c.active}</span>
                  <span style={{ color: THEME.textLow }}> / {c.total}</span>
                </div>
              </div>
              <div style={{ height: '8px', background: THEME.outlineVar, borderRadius: '4px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(c.total / maxByContractor) * 100}%`, background: c.color, borderRadius: '4px', transition: 'width .4s' }} />
              </div>
            </div>
          ))}
        </Card>

        {/* Leave breakdown */}
        <Card elevated>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Icon name="flight_takeoff" size={18} style={{ color: MODULE_COLORS.workforce }} />
            <div style={{ fontSize: '14px', fontWeight: 500 }}>Leave Status</div>
          </div>
          {[
            { label: 'Active on Site', v: active.length,                                            c: THEME.success,  icon: 'check_circle' },
            { label: 'Short Leave',    v: shortLeave.length,                                        c: THEME.warning,  icon: 'schedule' },
            { label: 'Long Leave',     v: longLeave.length,                                         c: THEME.statusTertiaryText,      icon: 'flight_takeoff' },
            { label: 'Inactive',       v: inactive.length,                                          c: THEME.textLow,  icon: 'person_off' },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: THEME.surfaceVar, borderRadius: '12px', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name={row.icon} size={16} style={{ color: row.c }} />
                <span style={{ fontSize: '13px', fontWeight: 500, color: THEME.text }}>{row.label}</span>
              </div>
              <span style={{ fontSize: '18px', fontWeight: 600, color: row.c }}>{row.v}</span>
            </div>
          ))}
        </Card>
      </div>

      {/* Full employee table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 18px 12px', fontWeight: 500, fontSize: '14px', borderBottom: `1px solid ${THEME.outlineVar}` }}>
          All Employees
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.primary, color: '#fff' }}>
                {['#','Name','Contractor','Status','Leave Status'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 500, fontSize: '12px' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp, i) => {
                const lc = { active: { bg: THEME.statusSuccessBg, c: THEME.statusSuccessText }, on_leave: { bg: THEME.statusWarningBg, c: THEME.statusWarningText }, long_leave: { bg: THEME.statusTertiaryBg, c: THEME.statusTertiaryText } }[emp.status] || { bg: THEME.statusNeutralBg, c: THEME.statusNeutralText }
                const sc = emp.status === 'active' ? { bg: THEME.statusSuccessBg, c: THEME.statusSuccessText } : { bg: THEME.statusNeutralBg, c: THEME.statusNeutralText }
                return (
                  <tr key={emp.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}` }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = '#fff'}>
                    <td style={{ padding: '10px 14px', color: THEME.textLow, fontSize: '11px' }}>{i+1}</td>
                    <td style={{ padding: '10px 14px', fontWeight: 500 }}>{emp.name}</td>
                    <td style={{ padding: '10px 14px', color: THEME.textMed }}>{emp.contractor?.name || '—'}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: sc.bg, color: sc.c }}>{emp.status}</span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 500, background: lc.bg, color: lc.c }}>
                        {{ active: 'Active', on_leave: 'On Leave', long_leave: 'Long Leave', temporary_assignment: 'Temporary Assignment', transferred: 'Transferred', terminated: 'Terminated' }[emp.status] || emp.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
