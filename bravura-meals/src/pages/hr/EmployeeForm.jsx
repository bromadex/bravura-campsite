import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import { Card, Icon, PageHeader, Button, SectionLabel, showToast } from '../../components/ui'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const ACCENT = MODULE_COLORS.workforce

const EMPTY = {
  name: '', date_of_birth: '', gender: '', national_id: '', passport_number: '',
  phone: '', email: '',
  employee_number: '', start_date: new Date().toISOString().slice(0, 10),
  department_id: '', designation_id: '', employment_type_id: '', manager_id: '',
  contractor_id: '',
}
const EMPTY_CONTACT = { name: '', relationship: '', phone: '', email: '' }

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
}
const errStyle = { fontSize: '11px', color: THEME.error, marginTop: '4px' }

function Section({ icon, title, open, onToggle, children }) {
  return (
    <Card style={{ marginBottom: '14px', padding: 0, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{
        display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px',
        cursor: 'pointer', background: THEME.surfaceVar,
      }}>
        <Icon name={icon} size={18} style={{ color: ACCENT }} />
        <span style={{ fontWeight: 700, fontSize: '14px', color: THEME.text, flex: 1 }}>{title}</span>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={18} style={{ color: THEME.textLow }} />
      </div>
      {open && <div style={{ padding: '18px' }}>{children}</div>}
    </Card>
  )
}

export default function EmployeeForm({ setPage, employeeId }) {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()
  const [reloadKey, setReloadKey] = useState(0)
  const onRealtime = useCallback(() => setReloadKey(k => k + 1), [])
  useRealtimeSubscription('employees', { column: 'site_id', value: currentSiteId }, onRealtime)
  const isEdit = !!employeeId

  const [form, setForm] = useState(EMPTY)
  const [contacts, setContacts] = useState([{ ...EMPTY_CONTACT }])
  const [wantAccount, setWantAccount] = useState(false)
  const [errors, setErrors] = useState({})
  const [open, setOpen] = useState({ personal: true, employment: true, contacts: true, account: false })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)

  const [departments, setDepartments] = useState([])
  const [designations, setDesignations] = useState([])
  const [employmentTypes, setEmploymentTypes] = useState([])
  const [contractors, setContractors] = useState([])
  const [managers, setManagers] = useState([])
  const [settings, setSettings] = useState({})

  // Lookups + settings + (edit mode) existing record
  useEffect(() => {
    if (!currentSiteId) return
    let cancelled = false
    async function load() {
      const [depRes, desRes, etRes, coRes, mgRes, setRes] = await Promise.all([
        supabase.from('departments').select('id, name').or(`site_id.eq.${currentSiteId},site_id.is.null`).eq('is_archived', false).order('name'),
        supabase.from('designations').select('id, name, department_id').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
        supabase.from('employment_types').select('id, name').eq('is_archived', false).order('name'),
        supabase.from('contractors').select('id, name').eq('status', 'Active').order('name'),
        supabase.from('employees').select('id, name').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
        supabase.from('module_settings').select('key, value').eq('site_id', currentSiteId).eq('module', 'hr'),
      ])
      if (cancelled) return
      setDepartments(depRes.data || [])
      setDesignations(desRes.data || [])
      setEmploymentTypes(etRes.data || [])
      setContractors(coRes.data || [])
      setManagers(mgRes.data || [])
      const s = {}
      for (const row of setRes.data || []) s[row.key] = row.value
      setSettings(s)

      if (isEdit) {
        const [{ data: emp, error }, { data: ecs }] = await Promise.all([
          supabase.from('employees').select('*').eq('id', employeeId).eq('site_id', currentSiteId).maybeSingle(),
          supabase.from('emergency_contacts').select('*').eq('employee_id', employeeId).order('is_primary', { ascending: false }),
        ])
        if (error || !emp) { showToast('Employee not found', 'red'); setPage('wf_employees'); return }
        if (!cancelled) {
          setForm({
            name: emp.name || '', date_of_birth: emp.date_of_birth || '', gender: emp.gender || '',
            national_id: emp.national_id || '', passport_number: emp.passport_number || '',
            phone: emp.phone || '', email: emp.email || '',
            employee_number: emp.employee_number || '',
            start_date: emp.start_date || '',
            department_id: emp.department_id || '', designation_id: emp.designation_id || '',
            employment_type_id: emp.employment_type_id || '', manager_id: emp.manager_id || '',
            contractor_id: emp.contractor_id || '',
          })
          setContacts((ecs && ecs.length > 0) ? ecs.map(c => ({ ...c })) : [{ ...EMPTY_CONTACT }])
          setLoading(false)
        }
      } else {
        // Auto-generate the next employee number from prefix + max suffix
        const prefix = s.employee_number_prefix || 'BRA'
        const padding = Number(s.employee_number_padding) || 4
        const { data: existing } = await supabase.from('employees')
          .select('employee_number').eq('site_id', currentSiteId)
          .like('employee_number', `${prefix}%`)
        let maxN = 0
        for (const r of existing || []) {
          const n = parseInt((r.employee_number || '').slice(prefix.length), 10)
          if (!isNaN(n) && n > maxN) maxN = n
        }
        if (!cancelled) {
          setForm(f => ({
            ...f,
            employee_number: `${prefix}${String(maxN + 1).padStart(padding, '0')}`,
            employment_type_id: s.default_employment_type || '',
          }))
        }
      }
    }
    load()
    return () => { cancelled = true }
  }, [currentSiteId, employeeId, isEdit, setPage, reloadKey])

  const set = (k, v) => {
    setForm(f => {
      const next = { ...f, [k]: v }
      if (k === 'department_id') next.designation_id = ''   // reset dependent dropdown
      return next
    })
    setErrors(e => ({ ...e, [k]: undefined }))
  }

  const setContact = (i, k, v) => setContacts(cs => cs.map((c, idx) => idx === i ? { ...c, [k]: v } : c))
  const addContact = () => setContacts(cs => [...cs, { ...EMPTY_CONTACT }])
  const removeContact = i => setContacts(cs => cs.filter((_, idx) => idx !== i))

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Full name is required'
    if (!form.start_date) e.start_date = 'Start date is required'
    if (!form.contractor_id) e.contractor_id = 'Select a contractor'
    if (wantAccount && !form.email.trim()) e.email = 'Email is required for a system account'
    const requireEc = settings.require_emergency_contact !== false
    const validContacts = contacts.filter(c => c.name.trim() && c.relationship.trim() && c.phone.trim())
    if (requireEc && !isEdit && validContacts.length === 0) e.contacts = 'At least one complete emergency contact is required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) { showToast('Fix the highlighted fields', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
        national_id: form.national_id.trim() || null,
        passport_number: form.passport_number.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        employee_number: form.employee_number.trim() || null,
        start_date: form.start_date || null,
        department_id: form.department_id || null,
        designation_id: form.designation_id || null,
        employment_type_id: form.employment_type_id || null,
        manager_id: form.manager_id || null,
        contractor_id: form.contractor_id,
        group_name: contractors.find(c => c.id === form.contractor_id)?.name || '',
      }

      let empId = employeeId
      if (isEdit) {
        const { error } = await supabase.from('employees').update(payload).eq('id', employeeId).eq('site_id', currentSiteId)
        if (error) throw error
      } else {
        const { data: row, error } = await supabase.from('employees')
          .insert({ ...payload, site_id: currentSiteId, status: 'active' })
          .select('id').single()
        if (error) throw error
        empId = row.id
        // Status history row is written automatically by the DB trigger.
      }

      // Emergency contacts: update existing (edit), insert new
      const valid = contacts.filter(c => c.name.trim() && c.relationship.trim() && c.phone.trim())
      for (let i = 0; i < valid.length; i++) {
        const c = valid[i]
        const row = {
          name: c.name.trim(), relationship: c.relationship.trim(),
          phone: c.phone.trim(), email: (c.email || '').trim() || null,
          is_primary: i === 0,
        }
        if (c.id) {
          await supabase.from('emergency_contacts').update(row).eq('id', c.id)
        } else {
          await supabase.from('emergency_contacts').insert({ ...row, employee_id: empId, site_id: currentSiteId })
        }
      }

      if (wantAccount && !isEdit) {
        showToast(`Account request noted — ask an administrator to send the Supabase invite to ${form.email.trim()}`, '')
      }

      showToast(isEdit ? 'Employee updated' : 'Employee created', 'green')
      setPage('wf_employee_detail:' + empId)
    } catch (err) {
      console.error(err)
      showToast(err.message || 'Save failed', 'red')
    } finally {
      setSaving(false)
    }
  }

  const allowed = isEdit ? can('hr.edit') : can('hr.create')
  if (!allowed) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have permission to {isEdit ? 'edit' : 'create'} employees.</p>
    </div>
  )
  if (loading) return <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>Loading…</div>

  const filteredDesignations = designations.filter(d => !form.department_id || !d.department_id || d.department_id === form.department_id)
  const showAccountSection = !isEdit && can('hr.edit') && settings.account_creation_enabled !== false

  return (
    <div style={{ maxWidth: '860px' }}>
      <PageHeader
        title={isEdit ? 'Edit Employee' : 'New Employee'}
        site={currentSite}
        actions={<Button variant="outlined" icon="arrow_back" onClick={() => setPage(isEdit ? 'wf_employee_detail:' + employeeId : 'wf_employees')}>Back</Button>}
      />

      {/* 1 · Personal */}
      <Section icon="person" title="Personal Information" open={open.personal} onToggle={() => setOpen(o => ({ ...o, personal: !o.personal }))}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <SectionLabel>Full Name *</SectionLabel>
            <input style={{ ...inputStyle, borderColor: errors.name ? THEME.error : THEME.outline }} value={form.name} onChange={e => set('name', e.target.value)} />
            {errors.name && <div style={errStyle}>{errors.name}</div>}
          </div>
          <div>
            <SectionLabel>Date of Birth</SectionLabel>
            <input style={inputStyle} type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} />
          </div>
          <div>
            <SectionLabel>Gender</SectionLabel>
            <select style={inputStyle} value={form.gender} onChange={e => set('gender', e.target.value)}>
              <option value="">—</option><option>Male</option><option>Female</option><option>Other</option>
            </select>
          </div>
          <div>
            <SectionLabel>National ID</SectionLabel>
            <input style={inputStyle} value={form.national_id} onChange={e => set('national_id', e.target.value)} />
          </div>
          <div>
            <SectionLabel>Passport Number</SectionLabel>
            <input style={inputStyle} value={form.passport_number} onChange={e => set('passport_number', e.target.value)} />
          </div>
          <div>
            <SectionLabel>Phone</SectionLabel>
            <input style={inputStyle} value={form.phone} onChange={e => set('phone', e.target.value)} />
          </div>
          <div>
            <SectionLabel>Email{wantAccount ? ' *' : ''}</SectionLabel>
            <input style={{ ...inputStyle, borderColor: errors.email ? THEME.error : THEME.outline }} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
            {errors.email && <div style={errStyle}>{errors.email}</div>}
          </div>
        </div>
      </Section>

      {/* 2 · Employment */}
      <Section icon="work" title="Employment Details" open={open.employment} onToggle={() => setOpen(o => ({ ...o, employment: !o.employment }))}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <div>
            <SectionLabel>Employee Number</SectionLabel>
            <input style={{ ...inputStyle, fontFamily: 'monospace' }} value={form.employee_number} onChange={e => set('employee_number', e.target.value)} />
          </div>
          <div>
            <SectionLabel>Start Date *</SectionLabel>
            <input style={{ ...inputStyle, borderColor: errors.start_date ? THEME.error : THEME.outline }} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            {errors.start_date && <div style={errStyle}>{errors.start_date}</div>}
          </div>
          <div>
            <SectionLabel>Department</SectionLabel>
            <select style={inputStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
              <option value="">—</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Designation</SectionLabel>
            <select style={inputStyle} value={form.designation_id} onChange={e => set('designation_id', e.target.value)}>
              <option value="">—</option>
              {filteredDesignations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Employment Type</SectionLabel>
            <select style={inputStyle} value={form.employment_type_id} onChange={e => set('employment_type_id', e.target.value)}>
              <option value="">—</option>
              {employmentTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Direct Manager</SectionLabel>
            <select style={inputStyle} value={form.manager_id} onChange={e => set('manager_id', e.target.value)}>
              <option value="">—</option>
              {managers.filter(m => m.id !== employeeId).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Contractor *</SectionLabel>
            <select style={{ ...inputStyle, borderColor: errors.contractor_id ? THEME.error : THEME.outline }} value={form.contractor_id} onChange={e => set('contractor_id', e.target.value)}>
              <option value="">— Select —</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.contractor_id && <div style={errStyle}>{errors.contractor_id}</div>}
          </div>
          <div>
            <SectionLabel>Site</SectionLabel>
            <input style={{ ...inputStyle, background: THEME.surfaceVar }} value={currentSite?.name || ''} disabled />
          </div>
        </div>
      </Section>

      {/* 3 · Emergency contacts */}
      <Section icon="emergency" title="Emergency Contacts" open={open.contacts} onToggle={() => setOpen(o => ({ ...o, contacts: !o.contacts }))}>
        {errors.contacts && <div style={{ ...errStyle, marginBottom: '10px' }}>{errors.contacts}</div>}
        {contacts.map((c, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '10px', marginBottom: '10px', alignItems: 'end' }}>
            <div>
              <SectionLabel>{i === 0 ? 'Name (primary)' : 'Name'}</SectionLabel>
              <input style={inputStyle} value={c.name} onChange={e => setContact(i, 'name', e.target.value)} />
            </div>
            <div>
              <SectionLabel>Relationship</SectionLabel>
              <input style={inputStyle} value={c.relationship} onChange={e => setContact(i, 'relationship', e.target.value)} placeholder="Spouse, parent…" />
            </div>
            <div>
              <SectionLabel>Phone</SectionLabel>
              <input style={inputStyle} value={c.phone} onChange={e => setContact(i, 'phone', e.target.value)} />
            </div>
            <div>
              <SectionLabel>Email</SectionLabel>
              <input style={inputStyle} value={c.email || ''} onChange={e => setContact(i, 'email', e.target.value)} />
            </div>
            <button onClick={() => removeContact(i)} disabled={contacts.length === 1} style={{
              background: 'transparent', border: 'none', cursor: contacts.length === 1 ? 'default' : 'pointer',
              color: contacts.length === 1 ? THEME.outlineVar : THEME.error, padding: '10px 4px',
            }}>
              <Icon name="delete" size={18} style={{ color: 'inherit' }} />
            </button>
          </div>
        ))}
        <Button variant="outlined" icon="add" onClick={addContact}>Add another contact</Button>
      </Section>

      {/* 4 · System account */}
      {showAccountSection && (
        <Section icon="key" title="System Account" open={open.account} onToggle={() => setOpen(o => ({ ...o, account: !o.account }))}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: THEME.text }}>
            <input type="checkbox" checked={wantAccount} onChange={e => setWantAccount(e.target.checked)} />
            Create a system account for this employee
          </label>
          {wantAccount && (
            <div style={{ marginTop: '12px', padding: '12px 14px', borderRadius: '10px', background: THEME.statusInfoBg, color: THEME.statusInfoText, fontSize: '12px', lineHeight: 1.6 }}>
              An invitation will be arranged for <b>{form.email || '(enter an email above)'}</b>.
              The invite email is sent by an administrator from Supabase — this notes the request.
            </div>
          )}
        </Section>
      )}

      <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
        <Button icon="save" onClick={save} disabled={saving}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create employee'}</Button>
        <Button variant="outlined" onClick={() => setPage(isEdit ? 'wf_employee_detail:' + employeeId : 'wf_employees')}>Cancel</Button>
      </div>
    </div>
  )
}
