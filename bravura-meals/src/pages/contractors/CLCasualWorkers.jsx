import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { useSite } from '../../contexts/SiteContext'
import { usePermissions } from '../../contexts/PermissionsContext'
import {
  Card, Icon, PageHeader, TableWrap, THead, Th, TRow, Td,
  Button, Modal, ConfirmModal, SectionLabel, Chip, showToast,
} from '../../components/ui'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.contractors

const EMPTY_FORM = {
  contractor_id: '', contract_id: '', employee_number: '', name: '',
  national_id: '', phone: '', emergency_contact: '', trade: '',
  skill_level: 'general', department_id: '', supervisor_id: '',
  rate_type: 'daily', rate: '', overtime_rate: '', night_shift_rate: '', weekend_rate: '',
  bank_name: '', bank_account: '', status: 'available', photo_url: '',
  medical_expiry: '', notes: '',
}

const SKILL_LEVELS = [
  { value: 'general', label: 'General' },
  { value: 'semi_skilled', label: 'Semi-Skilled' },
  { value: 'skilled', label: 'Skilled' },
  { value: 'specialist', label: 'Specialist' },
]

const RATE_TYPES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'shift', label: 'Per Shift' },
]

const STATUSES = [
  { value: 'available', label: 'Available', color: THEME.success },
  { value: 'working', label: 'Working', color: THEME.info },
  { value: 'inactive', label: 'Inactive', color: THEME.textLow },
  { value: 'suspended', label: 'Suspended', color: THEME.error },
  { value: 'blacklisted', label: 'Blacklisted', color: '#1A1A1A' },
]

const inputStyle = {
  width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`,
  borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
  background: THEME.surface, color: THEME.text,
}

function money(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n))
}

function StatusPill({ status }) {
  const s = STATUSES.find(x => x.value === status) || { label: status, color: THEME.textLow }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 9px', borderRadius: '5px', fontSize: '11px', fontWeight: 600, letterSpacing: '.01em',
      background: s.color + '18', color: s.color, border: `1px solid ${s.color}33`,
    }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color, flexShrink: 0 }} />
      {s.label}
    </span>
  )
}

function medicalTone(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  const diffDays = Math.floor((d - now) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { color: THEME.error, label: `Expired ${dateStr}` }
  if (diffDays <= 30) return { color: THEME.warning, label: `Expires ${dateStr}` }
  return { color: THEME.textLow, label: dateStr }
}

export default function CLCasualWorkers() {
  const { currentSiteId, currentSite } = useSite()
  const { can } = usePermissions()

  const [workers, setWorkers] = useState([])
  const [contractors, setContractors] = useState([])
  const [contracts, setContracts] = useState([])
  const [departments, setDepartments] = useState([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [tradeFilter, setTradeFilter] = useState('')
  const [contractorFilter, setContractorFilter] = useState('')

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)

  useEffect(() => {
    if (currentSiteId) fetchAll()
  }, [currentSiteId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchAll() {
    setLoading(true)
    try {
      const [workersRes, contractorsRes, contractsRes, deptRes] = await Promise.all([
        supabase.from('casual_workers')
          .select('*, contractor:contractors(id, name)')
          .eq('site_id', currentSiteId)
          .eq('is_archived', false)
          .order('name'),
        supabase.from('contractors')
          .select('id, name')
          .eq('is_archived', false)
          .order('name'),
        supabase.from('contractor_contracts')
          .select('id, contract_number, contractor_id')
          .eq('site_id', currentSiteId)
          .order('contract_number'),
        supabase.from('departments')
          .select('id, name')
          .or('site_id.eq.' + currentSiteId + ',site_id.is.null')
          .order('name'),
      ])
      if (workersRes.error) throw workersRes.error
      if (contractorsRes.error) throw contractorsRes.error
      if (contractsRes.error) throw contractsRes.error
      if (deptRes.error) throw deptRes.error
      setWorkers(workersRes.data || [])
      setContractors(contractorsRes.data || [])
      setContracts(contractsRes.data || [])
      setDepartments(deptRes.data || [])
    } catch (err) {
      console.error(err)
      showToast('Failed to load casual workers', 'red')
    } finally {
      setLoading(false)
    }
  }

  if (!can('contractors.view')) return (
    <div style={{ textAlign: 'center', padding: '80px 24px', color: THEME.textLow }}>
      <Icon name="lock" size={48} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
      <p>You don't have access to this section.</p>
    </div>
  )

  const canEdit = can('contractors.edit')

  const deptById = {}
  departments.forEach(d => { deptById[d.id] = d })

  const trades = [...new Set(workers.map(w => w.trade).filter(Boolean))].sort()

  const contractsForContractor = (contractorId) =>
    contracts.filter(c => c.contractor_id === contractorId)

  const q = search.trim().toLowerCase()
  const visible = workers.filter(w => {
    if (statusFilter && w.status !== statusFilter) return false
    if (tradeFilter && w.trade !== tradeFilter) return false
    if (contractorFilter && w.contractor_id !== contractorFilter) return false
    if (q) {
      const hay = [w.name, w.employee_number, w.national_id, w.phone, w.trade, w.contractor?.name]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setModal(true)
  }

  function openEdit(w) {
    if (!canEdit) return
    setEditing(w)
    setForm({
      contractor_id: w.contractor_id || '',
      contract_id: w.contract_id || '',
      employee_number: w.employee_number || '',
      name: w.name || '',
      national_id: w.national_id || '',
      phone: w.phone || '',
      emergency_contact: w.emergency_contact || '',
      trade: w.trade || '',
      skill_level: w.skill_level || 'general',
      department_id: w.department_id || '',
      supervisor_id: w.supervisor_id || '',
      rate_type: w.rate_type || 'daily',
      rate: w.rate ?? '',
      overtime_rate: w.overtime_rate ?? '',
      night_shift_rate: w.night_shift_rate ?? '',
      weekend_rate: w.weekend_rate ?? '',
      bank_name: w.bank_name || '',
      bank_account: w.bank_account || '',
      status: w.status || 'available',
      photo_url: w.photo_url || '',
      medical_expiry: w.medical_expiry || '',
      notes: w.notes || '',
    })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { showToast('Please enter a worker name', 'red'); return }
    if (!form.contractor_id) { showToast('Please select a contractor', 'red'); return }
    setSaving(true)
    try {
      const payload = {
        contractor_id: form.contractor_id || null,
        contract_id: form.contract_id || null,
        employee_number: form.employee_number.trim() || null,
        name: form.name.trim(),
        national_id: form.national_id.trim() || null,
        phone: form.phone.trim() || null,
        emergency_contact: form.emergency_contact.trim() || null,
        trade: form.trade.trim() || null,
        skill_level: form.skill_level || null,
        department_id: form.department_id || null,
        supervisor_id: form.supervisor_id || null,
        rate_type: form.rate_type || null,
        rate: form.rate === '' ? null : Number(form.rate),
        overtime_rate: form.overtime_rate === '' ? null : Number(form.overtime_rate),
        night_shift_rate: form.night_shift_rate === '' ? null : Number(form.night_shift_rate),
        weekend_rate: form.weekend_rate === '' ? null : Number(form.weekend_rate),
        bank_name: form.bank_name.trim() || null,
        bank_account: form.bank_account.trim() || null,
        status: form.status || 'available',
        photo_url: form.photo_url.trim() || null,
        medical_expiry: form.medical_expiry || null,
        notes: form.notes.trim() || null,
      }
      if (editing) {
        const { error } = await supabase.from('casual_workers')
          .update(payload)
          .eq('id', editing.id)
          .eq('site_id', currentSiteId)
        if (error) throw error
        showToast('Casual worker updated', 'green')
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        const { error } = await supabase.from('casual_workers')
          .insert({ ...payload, site_id: currentSiteId, created_by: user?.id || null })
        if (error) throw error
        showToast('Casual worker added', 'green')
      }
      setModal(false)
      fetchAll()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function archive() {
    if (!editing) return
    setSaving(true)
    try {
      const { error } = await supabase.from('casual_workers')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('id', editing.id)
        .eq('site_id', currentSiteId)
      if (error) throw error
      showToast('Casual worker archived', 'green')
      setConfirmArchive(false)
      setModal(false)
      fetchAll()
    } catch (err) {
      console.error(err)
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  function handleExport() {
    const headers = ['Employee #', 'Name', 'Contractor', 'Trade', 'Skill Level', 'Rate Type', 'Rate', 'Status', 'Medical Expiry', 'Phone']
    const rows = visible.map(w => [
      w.employee_number || '', w.name || '', w.contractor?.name || '', w.trade || '',
      w.skill_level || '', w.rate_type || '', w.rate ?? '', w.status || '', w.medical_expiry || '', w.phone || '',
    ])
    exportCsv(`casual_workers_${currentSite?.name || 'site'}.csv`, headers, rows)
  }

  return (
    <div>
      <PageHeader
        title="Casual Workers"
        site={currentSite?.name}
        actions={<>
          <Button onClick={handleExport} variant="tonal" icon="download">Export CSV</Button>
          {canEdit && <Button onClick={openAdd} variant="filled" icon="add">Add Worker</Button>}
        </>}
      >
        <div style={{ fontSize: '13px', color: THEME.textLow }}>Registry of casual / contracted workers engaged through contractor agreements.</div>
      </PageHeader>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input
          type="text" value={search} placeholder="Search name, ID, phone, trade…"
          onChange={e => setSearch(e.target.value)}
          style={{ ...inputStyle, width: '260px', padding: '8px 12px', borderRadius: '8px' }}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ ...inputStyle, width: 'auto', padding: '8px 12px', borderRadius: '8px' }}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={tradeFilter} onChange={e => setTradeFilter(e.target.value)}
          style={{ ...inputStyle, width: 'auto', padding: '8px 12px', borderRadius: '8px' }}>
          <option value="">All trades</option>
          {trades.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={contractorFilter} onChange={e => setContractorFilter(e.target.value)}
          style={{ ...inputStyle, width: 'auto', padding: '8px 12px', borderRadius: '8px' }}>
          <option value="">All contractors</option>
          {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: ACCENT }} />
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '40px', color: THEME.textLow }}>
            <Icon name="engineering" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
            No casual workers found.
          </div>
        </Card>
      ) : (
        <TableWrap>
          <THead>
            <Th>Name</Th>
            <Th>Contractor</Th>
            <Th>Trade</Th>
            <Th>Skill Level</Th>
            <Th align="right">Rate</Th>
            <Th>Status</Th>
            <Th>Medical</Th>
            <Th>Phone</Th>
          </THead>
          {visible.map((w, i) => {
            const med = medicalTone(w.medical_expiry)
            return (
              <TRow key={w.id} last={i === visible.length - 1} onClick={() => openEdit(w)}>
                <Td>
                  <div style={{ fontWeight: 600, color: THEME.text }}>{w.name}</div>
                  <div style={{ fontSize: '11px', color: THEME.textLow }}>{w.employee_number || '—'}</div>
                </Td>
                <Td>{w.contractor?.name || '—'}</Td>
                <Td>{w.trade || '—'}</Td>
                <Td>{SKILL_LEVELS.find(s => s.value === w.skill_level)?.label || w.skill_level || '—'}</Td>
                <Td align="right">
                  {money(w.rate)}
                  {w.rate_type && <span style={{ fontSize: '11px', color: THEME.textLow }}> /{RATE_TYPES.find(r => r.value === w.rate_type)?.label.toLowerCase() || w.rate_type}</span>}
                </Td>
                <Td><StatusPill status={w.status} /></Td>
                <Td>
                  {med ? <span style={{ fontSize: '12px', color: med.color, fontWeight: med.color === THEME.error ? 600 : 400 }}>{med.label}</span> : '—'}
                </Td>
                <Td>{w.phone || '—'}</Td>
              </TRow>
            )
          })}
        </TableWrap>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add Casual Worker'}
        footer={<>
          {editing && canEdit && (
            <Button onClick={() => setConfirmArchive(true)} variant="text" disabled={saving} style={{ color: THEME.error, marginRight: 'auto' }} icon="archive">Archive</Button>
          )}
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          {canEdit && (
            <Button onClick={save} variant="filled" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add Worker'}
            </Button>
          )}
        </>}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input type="text" value={form.name} autoFocus
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Full name" style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Employee Number</SectionLabel>
            <input type="text" value={form.employee_number}
              onChange={e => setForm(f => ({ ...f, employee_number: e.target.value }))}
              placeholder="e.g. CW-0012" style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Contractor *</SectionLabel>
            <select value={form.contractor_id}
              onChange={e => setForm(f => ({ ...f, contractor_id: e.target.value, contract_id: '' }))}
              style={inputStyle}>
              <option value="">— Select —</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Contract</SectionLabel>
            <select value={form.contract_id}
              onChange={e => setForm(f => ({ ...f, contract_id: e.target.value }))}
              style={inputStyle}>
              <option value="">— None —</option>
              {contractsForContractor(form.contractor_id).map(c => (
                <option key={c.id} value={c.id}>{c.contract_number}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>National ID</SectionLabel>
            <input type="text" value={form.national_id}
              onChange={e => setForm(f => ({ ...f, national_id: e.target.value }))}
              style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Phone</SectionLabel>
            <input type="text" value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Emergency Contact</SectionLabel>
          <input type="text" value={form.emergency_contact}
            onChange={e => setForm(f => ({ ...f, emergency_contact: e.target.value }))}
            placeholder="Name and phone" style={inputStyle} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Trade</SectionLabel>
            <input type="text" value={form.trade}
              onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}
              placeholder="e.g. Carpenter" style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Skill Level</SectionLabel>
            <select value={form.skill_level}
              onChange={e => setForm(f => ({ ...f, skill_level: e.target.value }))}
              style={inputStyle}>
              {SKILL_LEVELS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Department</SectionLabel>
            <select value={form.department_id}
              onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
              style={inputStyle}>
              <option value="">— None —</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Status</SectionLabel>
            <select value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={inputStyle}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Rate Type</SectionLabel>
            <select value={form.rate_type}
              onChange={e => setForm(f => ({ ...f, rate_type: e.target.value }))}
              style={inputStyle}>
              {RATE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <SectionLabel>Rate</SectionLabel>
            <input type="number" step="0.01" value={form.rate}
              onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
              style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Overtime Rate</SectionLabel>
            <input type="number" step="0.01" value={form.overtime_rate}
              onChange={e => setForm(f => ({ ...f, overtime_rate: e.target.value }))}
              style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Weekend Rate</SectionLabel>
            <input type="number" step="0.01" value={form.weekend_rate}
              onChange={e => setForm(f => ({ ...f, weekend_rate: e.target.value }))}
              style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Night Shift Rate</SectionLabel>
            <input type="number" step="0.01" value={form.night_shift_rate}
              onChange={e => setForm(f => ({ ...f, night_shift_rate: e.target.value }))}
              style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Medical Expiry</SectionLabel>
            <input type="date" value={form.medical_expiry}
              onChange={e => setForm(f => ({ ...f, medical_expiry: e.target.value }))}
              style={inputStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <div>
            <SectionLabel>Bank Name</SectionLabel>
            <input type="text" value={form.bank_name}
              onChange={e => setForm(f => ({ ...f, bank_name: e.target.value }))}
              style={inputStyle} />
          </div>
          <div>
            <SectionLabel>Bank Account</SectionLabel>
            <input type="text" value={form.bank_account}
              onChange={e => setForm(f => ({ ...f, bank_account: e.target.value }))}
              style={inputStyle} />
          </div>
        </div>

        <div style={{ marginBottom: '14px' }}>
          <SectionLabel>Photo URL</SectionLabel>
          <input type="text" value={form.photo_url}
            onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))}
            placeholder="https://…" style={inputStyle} />
        </div>

        <div>
          <SectionLabel>Notes</SectionLabel>
          <textarea value={form.notes} rows={3}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            style={{ ...inputStyle, resize: 'vertical' }} />
        </div>
      </Modal>

      <ConfirmModal
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        onConfirm={archive}
        title="Archive Casual Worker"
        message={`Archive "${editing?.name}"? This hides them from active lists but keeps their history for reporting.`}
        confirmLabel="Archive"
        danger
      />
    </div>
  )
}
