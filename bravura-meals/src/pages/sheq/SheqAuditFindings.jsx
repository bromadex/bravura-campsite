import { useState, useEffect } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, SectionLabel, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const FINDING_TYPES = {
  ncr_major: { label: 'NCR Major', bg: '#FFEBEE', color: '#D32F2F' },
  ncr_minor: { label: 'NCR Minor', bg: '#FFF3E0', color: '#E65100' },
  observation: { label: 'Observation', bg: '#E3F2FD', color: '#1565C0' },
  opportunity: { label: 'Opportunity', bg: '#F3E5F5', color: '#7B1FA2' },
  positive: { label: 'Positive', bg: '#E8F5E9', color: '#2E7D32' },
}

const STATUS_META = {
  open:        { label: 'Open',        bg: '#FFEBEE', color: '#D32F2F', icon: 'radio_button_checked' },
  in_progress: { label: 'In Progress', bg: '#FFF8E1', color: '#F59E0B', icon: 'pending' },
  closed:      { label: 'Closed',      bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  verified:    { label: 'Verified',    bg: '#F3E5F5', color: '#7B1FA2', icon: 'verified' },
}

const STATUS_FLOW = { open: 'in_progress', in_progress: 'closed', closed: 'verified' }

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const textareaStyle = { ...inputStyle, minHeight: '70px', resize: 'vertical' }

function Field({ label, children, required }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}{required && <span style={{ color: THEME.error }}> *</span>}
      </div>
      {children}
    </div>
  )
}

function FindingModal({ finding, audits, profiles, siteId, userId, onClose, onSaved }) {
  const isEdit = !!finding
  const [form, setForm] = useState(() => {
    if (finding) return {
      audit_id: finding.audit_id || '', clause: finding.clause || '',
      finding_type: finding.finding_type || '', description: finding.description || '',
      evidence: finding.evidence || '', root_cause: finding.root_cause || '',
      corrective_action: finding.corrective_action || '',
      responsible_id: finding.responsible_id || '', due_date: finding.due_date || '',
      status: finding.status || 'open',
    }
    return { audit_id: '', clause: '', finding_type: '', description: '', evidence: '', root_cause: '', corrective_action: '', responsible_id: '', due_date: '', status: 'open' }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.audit_id || !form.finding_type || !form.description) { showToast('Audit, type, and description are required', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        audit_id: form.audit_id, clause: form.clause || null,
        finding_type: form.finding_type, description: form.description,
        evidence: form.evidence || null, root_cause: form.root_cause || null,
        corrective_action: form.corrective_action || null,
        responsible_id: form.responsible_id || null,
        due_date: form.due_date || null, status: form.status,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_audit_findings').update(payload).eq('id', finding.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Finding updated')
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'AFN', p_table: 'sheq_audit_findings' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.finding_number = num
        const { error } = await supabase.from('sheq_audit_findings').insert(payload)
        if (error) throw error
        showToast(`Finding ${num} created`)
      }
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '620px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${finding.finding_number}` : 'New Audit Finding'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Audit" required>
              <select style={selectStyle} value={form.audit_id} onChange={e => set('audit_id', e.target.value)}>
                <option value="">Select audit...</option>
                {audits.map(a => <option key={a.id} value={a.id}>{a.audit_number} — {a.title}</option>)}
              </select>
            </Field>
            <Field label="Finding Type" required>
              <select style={selectStyle} value={form.finding_type} onChange={e => set('finding_type', e.target.value)}>
                <option value="">Select...</option>
                {Object.entries(FINDING_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Clause / Reference"><input style={inputStyle} value={form.clause} onChange={e => set('clause', e.target.value)} placeholder="e.g. ISO 45001 §6.1.2" /></Field>
          <Field label="Description" required><textarea style={textareaStyle} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe the finding..." /></Field>
          <Field label="Evidence"><textarea style={textareaStyle} value={form.evidence} onChange={e => set('evidence', e.target.value)} placeholder="Objective evidence..." /></Field>
          <Field label="Root Cause"><textarea style={textareaStyle} value={form.root_cause} onChange={e => set('root_cause', e.target.value)} /></Field>
          <Field label="Corrective Action"><textarea style={textareaStyle} value={form.corrective_action} onChange={e => set('corrective_action', e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Responsible">
              <select style={selectStyle} value={form.responsible_id} onChange={e => set('responsible_id', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
            <Field label="Due Date"><input style={inputStyle} type="date" value={form.due_date} onChange={e => set('due_date', e.target.value)} /></Field>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqAuditFindings({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [audits, setAudits] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [findRes, audRes, profRes] = await Promise.all([
      supabase.from('sheq_audit_findings').select('*, sheq_audits(audit_number, title), profiles!sheq_audit_findings_responsible_id_fkey(full_name)').eq('site_id', currentSiteId).eq('is_archived', false).order('created_at', { ascending: false }).limit(500),
      supabase.from('sheq_audits').select('id, audit_number, title').eq('site_id', currentSiteId).eq('is_archived', false),
      supabase.from('profiles').select('id, full_name').eq('site_id', currentSiteId),
    ])
    if (findRes.error) showToast(findRes.error.message, 'error')
    setRows(findRes.data || [])
    setAudits(audRes.data || [])
    setProfiles(profRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const filtered = rows.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterType !== 'all' && r.finding_type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      return (r.finding_number || '').toLowerCase().includes(s) || (r.description || '').toLowerCase().includes(s) || (r.sheq_audits?.audit_number || '').toLowerCase().includes(s)
    }
    return true
  })

  async function handleArchive(r) {
    if (!confirm(`Archive finding ${r.finding_number}?`)) return
    const { error } = await supabase.from('sheq_audit_findings').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  async function handleAdvance(r) {
    const next = STATUS_FLOW[r.status]
    if (!next) return
    const upd = { status: next }
    if (next === 'closed') { upd.closed_at = new Date().toISOString(); upd.closed_by = user?.id }
    const { error } = await supabase.from('sheq_audit_findings').update(upd).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast(`Advanced to ${STATUS_META[next]?.label}`); load() }
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view audit findings.</div>

  const openCount = rows.filter(r => r.status === 'open' || r.status === 'in_progress').length

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_audit_findings" />
      <PageHeader title="Audit Findings" subtitle={`${rows.length} findings · ${openCount} open`} icon="find_in_page" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search findings..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...selectStyle, width: 'auto', minWidth: '120px' }} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="all">All Types</option>
          {Object.entries(FINDING_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select style={{ ...selectStyle, width: 'auto', minWidth: '120px' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        {can('sheq.create') && <Button style={{ background: ACCENT, color: '#fff' }} onClick={() => setModal('new')}><Icon name="add" size={16} style={{ color: '#fff' }} /> New Finding</Button>}
        <Button variant="ghost" onClick={() => exportCsv(filtered, `audit_findings_${currentSiteId}`)}><Icon name="download" size={16} /> Export</Button>
      </div>

      <Card style={{ overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Finding #', 'Audit', 'Type', 'Description', 'Responsible', 'Due', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No findings found</td></tr>
              ) : filtered.map(r => {
                const ft = FINDING_TYPES[r.finding_type] || { label: r.finding_type, bg: THEME.surfaceVar, color: THEME.textMed }
                const overdue = r.due_date && r.status !== 'closed' && r.status !== 'verified' && new Date(r.due_date) < new Date()
                return (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}`, background: overdue ? '#FFF8F8' : 'transparent' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.finding_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.sheq_audits?.audit_number || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: ft.bg, color: ft.color }}>{ft.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.profiles?.full_name || '--'}</td>
                    <td style={{ padding: '10px 12px', color: overdue ? '#D32F2F' : THEME.textMed, fontWeight: overdue ? 600 : 400 }}>{r.due_date || '--'}{overdue && <Icon name="warning" size={12} style={{ color: '#D32F2F', marginLeft: '4px', verticalAlign: 'middle' }} />}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: STATUS_META[r.status]?.bg, color: STATUS_META[r.status]?.color }}>
                        <Icon name={STATUS_META[r.status]?.icon || 'help'} size={11} style={{ color: 'inherit' }} /> {STATUS_META[r.status]?.label || r.status}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {can('sheq.edit') && STATUS_FLOW[r.status] && <button onClick={() => handleAdvance(r)} title={`Advance to ${STATUS_META[STATUS_FLOW[r.status]]?.label}`} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="arrow_forward" size={16} style={{ color: '#1565C0' }} /></button>}
                        {can('sheq.edit') && <button onClick={() => setModal(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                        {can('sheq.delete') && <button onClick={() => handleArchive(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="archive" size={16} style={{ color: THEME.textMed }} /></button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {modal && (
        <FindingModal
          finding={modal === 'new' ? null : modal}
          audits={audits} profiles={profiles}
          siteId={currentSiteId} userId={user?.id}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
