import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Icon, PageHeader, TableWrap, THead, Th, TRow, Td, Button, Modal, SectionLabel, showToast, fmtDate } from '../../components/ui'
import QuickNav, { HR_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.workforce

const STATUS_META = {
  pending:   { label: 'Pending',   bg: THEME.statusWarningBg, text: THEME.statusWarningText },
  completed: { label: 'Completed', bg: THEME.statusSuccessBg, text: THEME.statusSuccessText },
  cancelled: { label: 'Cancelled', bg: THEME.statusNeutralBg, text: THEME.statusNeutralText },
}

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}

const EMPTY = { employee_id: '', to_site_id: '', to_department_id: '', to_designation_id: '', transfer_date: new Date().toISOString().slice(0, 10), reason: '' }

export default function Transfers({ setPage }) {
  const { profile } = useAuth()
  const { currentSiteId, currentSite, allSites } = useSite()
  const { can } = usePermissions()

  const [rows, setRows] = useState([])
  const [employees, setEmployees] = useState([])
  const [destDepartments, setDestDepartments] = useState([])
  const [destDesignations, setDestDesignations] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [trRes, empRes] = await Promise.all([
      supabase.from('site_transfers')
        .select('*, employee:employees(id, name)')
        .or(`from_site_id.eq.${currentSiteId},to_site_id.eq.${currentSiteId}`)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, department_id, designation_id')
        .eq('site_id', currentSiteId).eq('status', 'active').order('name'),
    ])
    if (trRes.error) { console.error(trRes.error); showToast('Failed to load transfers', 'red') }
    setRows(trRes.data || [])
    setEmployees(empRes.data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { load() }, [load])

  // Destination lookups load when the target site changes
  useEffect(() => {
    if (!form.to_site_id) { setDestDepartments([]); setDestDesignations([]); return }
    let cancelled = false
    async function loadDest() {
      const [depRes, desRes] = await Promise.all([
        supabase.from('departments').select('id, name').or(`site_id.eq.${form.to_site_id},site_id.is.null`).order('name'),
        supabase.from('designations').select('id, name').eq('site_id', form.to_site_id).order('name'),
      ])
      if (!cancelled) {
        setDestDepartments(depRes.data || [])
        setDestDesignations(desRes.data || [])
      }
    }
    loadDest()
    return () => { cancelled = true }
  }, [form.to_site_id])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const siteName = id => allSites.find(s => s.id === id)?.name || '—'

  async function create() {
    if (!form.employee_id || !form.to_site_id || !form.reason.trim()) {
      showToast('Employee, destination site and reason are required', 'red'); return
    }
    if (form.to_site_id === currentSiteId) { showToast('Destination must be a different site', 'red'); return }
    setSaving(true)
    const emp = employees.find(e => e.id === form.employee_id)
    const { error } = await supabase.from('site_transfers').insert({
      employee_id: form.employee_id,
      from_site_id: currentSiteId,
      to_site_id: form.to_site_id,
      from_department_id: emp?.department_id || null,
      to_department_id: form.to_department_id || null,
      from_designation_id: emp?.designation_id || null,
      to_designation_id: form.to_designation_id || null,
      transfer_date: form.transfer_date,
      reason: form.reason.trim(),
      created_by: profile?.id || null,
    })
    setSaving(false)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Transfer created — pending approval', 'green')
    setModal(false); setForm(EMPTY); load()
  }

  async function complete(t) {
    if (!window.confirm(`Complete transfer of ${t.employee?.name} to ${siteName(t.to_site_id)}? Their records move to the new site.`)) return
    const { error } = await supabase.rpc('complete_site_transfer', { p_transfer_id: t.id })
    if (error) { showToast(error.message, 'red'); return }
    showToast('Transfer completed', 'green'); load()
  }

  async function cancel(t) {
    if (!window.confirm('Cancel this transfer?')) return
    const { error } = await supabase.from('site_transfers').update({ status: 'cancelled' }).eq('id', t.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast('Transfer cancelled', 'green'); load()
  }

  if (!can('hr.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to HR.</p>
    </div>
  )

  return (
    <div>
      <PageHeader title="Site Reassignment" site={currentSite}
        actions={can('hr.edit') && <Button icon="swap_horiz" onClick={() => { setForm(EMPTY); setModal(true) }}>New Reassignment</Button>} />

      {loading ? <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div> : (
        <TableWrap>
          <THead color={ACCENT}>
            <Th>Employee</Th><Th>From</Th><Th>To</Th><Th>Date</Th><Th>Reason</Th><Th align="center">Status</Th><Th></Th>
          </THead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: THEME.textLow }}>No transfers involving {currentSite?.name}.</td></tr>
            ) : rows.map(t => {
              const m = STATUS_META[t.status] || STATUS_META.pending
              const incoming = t.to_site_id === currentSiteId
              return (
                <TRow key={t.id}>
                  <Td style={{ fontWeight: 600 }}>{t.employee?.name || '—'}</Td>
                  <Td>{siteName(t.from_site_id)}</Td>
                  <Td style={{ fontWeight: incoming ? 700 : 400 }}>{siteName(t.to_site_id)}{incoming && ' ⬅'}</Td>
                  <Td>{fmtDate(t.transfer_date)}</Td>
                  <Td style={{ color: THEME.textMed, maxWidth: '220px' }}>{t.reason}</Td>
                  <Td align="center">
                    <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, background: m.bg, color: m.text }}>{m.label}</span>
                  </Td>
                  <Td align="right">
                    {t.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
      <QuickNav pills={HR_PILLS} setPage={setPage} current="wf_transfers" />
                        {can('hr.approve') && <Button icon="check" onClick={() => complete(t)}>Complete</Button>}
                        {can('hr.edit') && <Button variant="outlined" onClick={() => cancel(t)}>Cancel</Button>}
                      </div>
                    )}
                  </Td>
                </TRow>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title="New Site Reassignment"
        footer={
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="outlined" onClick={() => setModal(false)}>Cancel</Button>
            <Button icon="swap_horiz" onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Submit'}</Button>
          </div>
        }>
        <div style={{ display: 'grid', gap: '14px' }}>
          <div>
            <SectionLabel>Employee (from {currentSite?.name}) *</SectionLabel>
            <select style={inputStyle} value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
              <option value="">— Select —</option>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Destination Site *</SectionLabel>
            <select style={inputStyle} value={form.to_site_id} onChange={e => set('to_site_id', e.target.value)}>
              <option value="">— Select —</option>
              {allSites.filter(s => s.id !== currentSiteId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <SectionLabel>New Department (optional)</SectionLabel>
              <select style={inputStyle} value={form.to_department_id} onChange={e => set('to_department_id', e.target.value)} disabled={!form.to_site_id}>
                <option value="">— Keep current —</option>
                {destDepartments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <SectionLabel>New Designation (optional)</SectionLabel>
              <select style={inputStyle} value={form.to_designation_id} onChange={e => set('to_designation_id', e.target.value)} disabled={!form.to_site_id}>
                <option value="">— Keep current —</option>
                {destDesignations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <SectionLabel>Transfer Date *</SectionLabel>
            <input style={inputStyle} type="date" value={form.transfer_date} onChange={e => set('transfer_date', e.target.value)} />
          </div>
          <div>
            <SectionLabel>Reason *</SectionLabel>
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.reason} onChange={e => set('reason', e.target.value)} />
          </div>
          <div style={{ fontSize: '12px', color: THEME.textLow }}>
            Completing the transfer moves the employee's record to the destination site —
            they will disappear from this site's lists. Approval needs the HR approve
            permission on the destination site.
          </div>
        </div>
      </Modal>
    </div>
  )
}
