import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Button, Icon, PageHeader, showToast, TableWrap, THead, Th, TRow, Td, ModalOverlay } from '../../components/ui'
import QuickNav, { ADMIN_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.admin

const inp = {
  width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
  border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
  color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function EmployeeLinks({ setPage }) {
  const { can } = usePermissions()
  const canEdit = can('users.edit')
  useRealtimeSubscription('profiles', null, fetchAll)

  const [profiles, setProfiles] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [linkModal, setLinkModal] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [pRes, eRes] = await Promise.all([
      supabase.from('profiles').select('id, username, full_name, employee_id, employee:employees(id, name, employee_number, position_title, department:departments(name))').order('username'),
      supabase.from('employees').select('id, name, employee_number, position_title, department:departments(name)').eq('status', 'active').order('name'),
    ])
    setProfiles(pRes.data || [])
    setEmployees(eRes.data || [])
    setLoading(false)
  }

  const linkedEmployeeIds = useMemo(() => new Set(profiles.map(p => p.employee_id).filter(Boolean)), [profiles])
  const unlinkedEmployees = useMemo(() => employees.filter(e => !linkedEmployeeIds.has(e.id)), [employees, linkedEmployeeIds])

  const filtered = useMemo(() => {
    let list = profiles
    if (filter === 'linked') list = list.filter(p => p.employee_id)
    else if (filter === 'unlinked') list = list.filter(p => !p.employee_id)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(p =>
        (p.full_name || '').toLowerCase().includes(q) ||
        (p.username || '').toLowerCase().includes(q) ||
        (p.employee?.name || '').toLowerCase().includes(q) ||
        (p.employee?.employee_number || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [profiles, search, filter])

  const stats = useMemo(() => ({
    total: profiles.length,
    linked: profiles.filter(p => p.employee_id).length,
    unlinked: profiles.filter(p => !p.employee_id).length,
  }), [profiles])

  async function handleLink(profileId, employeeId) {
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles').update({ employee_id: employeeId || null }).eq('id', profileId)
      if (error) throw error
      showToast(employeeId ? 'Employee linked' : 'Employee unlinked', 'green')
      setLinkModal(null)
      await fetchAll()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  if (!can('users.view')) {
    return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>You do not have permission to view this page.</div>
  }

  return (
    <div>
      <PageHeader title="Employee Links" />
      <QuickNav pills={ADMIN_PILLS} setPage={setPage} current="admin_employee_links" />

      <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Total Users', value: stats.total, icon: 'group', accent: color },
          { label: 'Linked', value: stats.linked, icon: 'link', accent: '#2E7D32' },
          { label: 'Not Linked', value: stats.unlinked, icon: 'link_off', accent: '#E65100' },
        ].map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '18px', flex: '0 0 auto',
            display: 'flex', alignItems: 'center', gap: '14px', border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '50%', display: 'flex',
              alignItems: 'center', justifyContent: 'center', background: k.accent + '22',
            }}>
              <Icon name={k.icon} size={20} style={{ color: k.accent }} />
            </div>
            <div>
              <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
              <div style={{ fontSize: '12px', color: THEME.textMed }}>{k.label}</div>
            </div>
          </div>
        ))}
      </div>

      <Card style={{ marginBottom: '16px', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users or employees…" style={{ ...inp, flex: '1 1 220px', minWidth: '180px' }} />
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ ...inp, flex: '0 0 auto', width: 'auto' }}>
            <option value="all">All Users</option>
            <option value="linked">Linked</option>
            <option value="unlinked">Not Linked</option>
          </select>
        </div>
      </Card>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color }} />
        </div>
      ) : (
        <TableWrap>
          <THead color={color}>
            {['User Account', 'Linked Employee', 'Employee #', 'Position', 'Department', 'Actions'].map(h => <Th key={h}>{h}</Th>)}
          </THead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: THEME.textLow }}>No matching users</td></tr>
            ) : filtered.map(p => (
              <TRow key={p.id}>
                <Td>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{p.full_name || p.username}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow }}>@{p.username}</div>
                </Td>
                <Td>
                  {p.employee ? (
                    <span style={{ fontWeight: 600, color: THEME.text }}>{p.employee.name}</span>
                  ) : (
                    <span style={{ padding: '2px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 500, background: THEME.statusWarningBg, color: THEME.statusWarningText }}>Not linked</span>
                  )}
                </Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{p.employee?.employee_number || '—'}</Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{p.employee?.position_title || '—'}</Td>
                <Td style={{ fontSize: '12px', color: THEME.textMed }}>{p.employee?.department?.name || '—'}</Td>
                <Td>
                  {canEdit && (
                    p.employee ? (
                      <Button size="sm" onClick={() => handleLink(p.id, null)} disabled={saving} style={{ fontSize: '11px', background: THEME.statusErrorBg, color: THEME.statusErrorText, border: 'none' }}>
                        <Icon name="link_off" size={14} /> Unlink
                      </Button>
                    ) : (
                      <Button size="sm" onClick={() => setLinkModal(p)} style={{ fontSize: '11px', background: color, color: '#fff' }}>
                        <Icon name="link" size={14} /> Link
                      </Button>
                    )
                  )}
                </Td>
              </TRow>
            ))}
          </tbody>
        </TableWrap>
      )}

      {linkModal && (
        <ModalOverlay onClose={() => setLinkModal(null)} dirty={false}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', padding: '24px', width: '480px', maxWidth: '90vw',
            maxHeight: '80vh', overflowY: 'auto', boxShadow: THEME.shadow3,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text, marginBottom: '4px' }}>
              Link Employee
            </div>
            <div style={{ fontSize: '13px', color: THEME.textMed, marginBottom: '16px' }}>
              Select an employee to link to <strong>{linkModal.full_name || linkModal.username}</strong>
            </div>

            <input
              id="empSearch"
              placeholder="Search employees…"
              style={{ ...inp, marginBottom: '12px' }}
              onChange={e => {
                const q = e.target.value.toLowerCase()
                document.querySelectorAll('[data-emp-row]').forEach(el => {
                  el.style.display = el.dataset.empRow.toLowerCase().includes(q) ? '' : 'none'
                })
              }}
            />

            <div style={{ maxHeight: '360px', overflowY: 'auto', border: `1px solid ${THEME.outlineVar}`, borderRadius: '8px' }}>
              {unlinkedEmployees.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: THEME.textLow, fontSize: '13px' }}>All employees are already linked</div>
              ) : unlinkedEmployees.map(e => (
                <div key={e.id} data-emp-row={`${e.name} ${e.employee_number} ${e.position_title || ''}`}
                  onClick={() => handleLink(linkModal.id, e.id)}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${THEME.outlineVar}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={ev => ev.currentTarget.style.background = THEME.surfaceVar}
                  onMouseLeave={ev => ev.currentTarget.style.background = ''}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>{e.name}</div>
                    <div style={{ fontSize: '11px', color: THEME.textLow }}>{e.employee_number} · {e.position_title || 'No position'} · {e.department?.name || '—'}</div>
                  </div>
                  <Icon name="link" size={16} style={{ color, opacity: 0.5 }} />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <Button onClick={() => setLinkModal(null)} style={{ background: THEME.surfaceVar, color: THEME.text }}>Cancel</Button>
            </div>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
