import { useState, useEffect, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const COMPLIANCE_META = {
  compliant:           { label: 'Compliant',           bg: '#E8F5E9', color: '#2E7D32', icon: 'check_circle' },
  partially_compliant: { label: 'Partially Compliant', bg: '#FFF8E1', color: '#F59E0B', icon: 'warning' },
  non_compliant:       { label: 'Non-Compliant',       bg: '#FFEBEE', color: '#D32F2F', icon: 'cancel' },
  not_assessed:        { label: 'Not Assessed',        bg: '#E3F2FD', color: '#1565C0', icon: 'help' },
}

const FILTER_TABS = ['all', 'compliant', 'partially_compliant', 'non_compliant', 'not_assessed']
const LEGISLATION_TYPES = ['act', 'regulation', 'standard', 'guideline', 'code_of_practice', 'bylaw', 'other']
const STATUS_OPTIONS = ['active', 'under_review', 'superseded', 'repealed']
const COMPLIANCE_OPTIONS = ['compliant', 'partially_compliant', 'non_compliant', 'not_assessed']

function fmtType(t) {
  if (!t) return '--'
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const textareaStyle = { ...inputStyle, minHeight: '70px', resize: 'vertical' }

function Badge({ status }) {
  const m = COMPLIANCE_META[status] || { label: status, bg: THEME.surfaceVar, color: THEME.textMed, icon: 'help' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      background: m.bg, color: m.color,
    }}>
      <Icon name={m.icon} size={11} style={{ color: 'inherit' }} />
      {m.label}
    </span>
  )
}

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

function LegalModal({ item, profiles, siteId, userId, onClose, onSaved }) {
  const isEdit = !!item

  const [form, setForm] = useState(() => {
    if (item) return {
      title: item.title || '',
      legislation_type: item.legislation_type || '',
      jurisdiction: item.jurisdiction || '',
      issuing_body: item.issuing_body || '',
      effective_date: item.effective_date || '',
      review_date: item.review_date || '',
      status: item.status || 'active',
      compliance_status: item.compliance_status || 'not_assessed',
      applicable_areas: item.applicable_areas || '',
      requirements_summary: item.requirements_summary || '',
      responsible_id: item.responsible_id || '',
      notes: item.notes || '',
    }
    return {
      title: '', legislation_type: '', jurisdiction: '', issuing_body: '',
      effective_date: '', review_date: '', status: 'active',
      compliance_status: 'not_assessed', applicable_areas: '',
      requirements_summary: '', responsible_id: '', notes: '',
    }
  })

  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.title || !form.legislation_type) {
      showToast('Please fill required fields', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        legislation_type: form.legislation_type,
        jurisdiction: form.jurisdiction || null,
        issuing_body: form.issuing_body || null,
        effective_date: form.effective_date || null,
        review_date: form.review_date || null,
        status: form.status,
        compliance_status: form.compliance_status,
        applicable_areas: form.applicable_areas || null,
        requirements_summary: form.requirements_summary || null,
        responsible_id: form.responsible_id || null,
        notes: form.notes || null,
      }

      if (isEdit) {
        const { error } = await supabase
          .from('sheq_legal_register')
          .update(payload)
          .eq('id', item.id)
          .eq('site_id', siteId)
        if (error) throw error
        showToast('Legal register entry updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'LEG', p_table: 'sheq_legal_register',
        })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.reference_number = numData
        payload.created_by = userId
        const { error } = await supabase.from('sheq_legal_register').insert(payload)
        if (error) throw error
        showToast(`Legal entry ${numData} created`)
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '660px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${item.reference_number}` : 'New Legal Register Entry'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Legislation title" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Legislation Type" required>
              <select style={selectStyle} value={form.legislation_type} onChange={e => set('legislation_type', e.target.value)}>
                <option value="">Select...</option>
                {LEGISLATION_TYPES.map(t => <option key={t} value={t}>{fmtType(t)}</option>)}
              </select>
            </Field>
            <Field label="Jurisdiction">
              <input style={inputStyle} value={form.jurisdiction} onChange={e => set('jurisdiction', e.target.value)} placeholder="e.g. Zimbabwe" />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Issuing Body">
              <input style={inputStyle} value={form.issuing_body} onChange={e => set('issuing_body', e.target.value)} placeholder="e.g. Ministry of Mines" />
            </Field>
            <Field label="Responsible Person">
              <select style={selectStyle} value={form.responsible_id} onChange={e => set('responsible_id', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Effective Date">
              <input style={inputStyle} type="date" value={form.effective_date} onChange={e => set('effective_date', e.target.value)} />
            </Field>
            <Field label="Review Date">
              <input style={inputStyle} type="date" value={form.review_date} onChange={e => set('review_date', e.target.value)} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Status">
              <select style={selectStyle} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
              </select>
            </Field>
            <Field label="Compliance Status">
              <select style={selectStyle} value={form.compliance_status} onChange={e => set('compliance_status', e.target.value)}>
                {COMPLIANCE_OPTIONS.map(s => <option key={s} value={s}>{fmtType(s)}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Applicable Areas">
            <input style={inputStyle} value={form.applicable_areas} onChange={e => set('applicable_areas', e.target.value)} placeholder="e.g. Mining operations, Environmental" />
          </Field>
          <Field label="Requirements Summary">
            <textarea style={textareaStyle} value={form.requirements_summary} onChange={e => set('requirements_summary', e.target.value)} placeholder="Summary of key requirements..." />
          </Field>
          <Field label="Notes">
            <textarea style={textareaStyle} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional notes..." />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Entry'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqLegalRegister({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_legal_register', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [items, setItems] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editItem, setEditItem] = useState(null)

  const canView = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit = can('sheq.edit')

  const profileMap = useMemo(() => {
    const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m
  }, [profiles])

  async function fetchData() {
    if (!currentSiteId) return
    setLoading(true); setError(null)
    try {
      const [{ data, error: err }, { data: emp }] = await Promise.all([
        supabase.from('sheq_legal_register').select('*').eq('site_id', currentSiteId).is('is_archived', false).order('created_at', { ascending: false }),
        supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      ])
      if (err) throw err
      setItems(data || [])
      setProfiles(emp || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData() }, [currentSiteId, rt])

  const filtered = useMemo(() => {
    let list = items
    if (tab !== 'all') list = list.filter(r => r.compliance_status === tab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.reference_number?.toLowerCase().includes(q) ||
        r.title?.toLowerCase().includes(q) ||
        r.jurisdiction?.toLowerCase().includes(q)
      )
    }
    return list
  }, [items, tab, search])

  const counts = useMemo(() => {
    const c = { all: items.length, compliant: 0, partially_compliant: 0, non_compliant: 0, not_assessed: 0 }
    items.forEach(r => { if (c[r.compliance_status] !== undefined) c[r.compliance_status]++ })
    return c
  }, [items])

  function handleExport() {
    const headers = ['Ref #', 'Title', 'Type', 'Jurisdiction', 'Effective Date', 'Review Date', 'Status', 'Compliance', 'Responsible']
    const rows = filtered.map(r => [
      r.reference_number, r.title || '', fmtType(r.legislation_type), r.jurisdiction || '',
      r.effective_date || '', r.review_date || '', fmtType(r.status),
      fmtType(r.compliance_status), profileMap[r.responsible_id] || '',
    ])
    exportCsv(`sheq-legal-register-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
    showToast('CSV exported')
  }

  async function handleArchive(item) {
    if (!confirm(`Archive ${item.reference_number}?`)) return
    const { error: err } = await supabase
      .from('sheq_legal_register')
      .update({ is_archived: true })
      .eq('id', item.id)
      .eq('site_id', currentSiteId)
    if (err) { showToast(err.message, 'error'); return }
    showToast('Entry archived')
    fetchData()
  }

  function onSaved() {
    setShowCreate(false)
    setEditItem(null)
    fetchData()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_legal" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view the legal register.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_legal" />

      <PageHeader
        title="Legal Register"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Entry</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Total Entries', value: counts.all, icon: 'gavel', color: '#1565C0' },
          { label: 'Compliant', value: counts.compliant, icon: 'check_circle', color: '#2E7D32' },
          { label: 'Partially Compliant', value: counts.partially_compliant, icon: 'warning', color: '#F59E0B' },
          { label: 'Non-Compliant', value: counts.non_compliant, icon: 'cancel', color: '#D32F2F' },
        ].map(kpi => (
          <Card key={kpi.label} style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: kpi.color + '14', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={kpi.icon} size={20} style={{ color: kpi.color }} />
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: THEME.text }}>{kpi.value}</div>
              <div style={{ fontSize: '11px', color: THEME.textMed }}>{kpi.label}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {FILTER_TABS.map(t => {
          const active = tab === t
          const meta = COMPLIANCE_META[t]
          return (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '6px 14px', borderRadius: '8px', border: 'none',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              background: active ? (meta?.color || ACCENT) : THEME.surfaceVar,
              color: active ? '#fff' : THEME.textMed, transition: 'all .15s',
            }}>
              {t === 'all' ? 'All' : meta?.label || t} ({counts[t] || 0})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', maxWidth: '320px', flex: 1 }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder="Search legal register..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {error && (
        <Card style={{ padding: '20px', borderColor: THEME.error }}>
          <div style={{ color: THEME.error, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="error" size={18} style={{ color: THEME.error }} />{error}
          </div>
        </Card>
      )}

      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading legal register...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="gavel" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {items.length === 0 ? 'No legal register entries yet.' : 'No entries match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Ref #', 'Title', 'Type', 'Jurisdiction', 'Effective Date', 'Review Date', 'Status', 'Compliance', 'Responsible', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit && setEditItem(r)}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.reference_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{fmtType(r.legislation_type)}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.jurisdiction || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.effective_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{r.review_date || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{fmtType(r.status)}</td>
                    <td style={{ padding: '10px 12px' }}><Badge status={r.compliance_status} /></td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.responsible_id] || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && <button onClick={e => { e.stopPropagation(); setEditItem(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Edit"><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                        {canEdit && <button onClick={e => { e.stopPropagation(); handleArchive(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Archive"><Icon name="archive" size={16} style={{ color: THEME.textLow }} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(showCreate || editItem) && (
        <LegalModal item={editItem} profiles={profiles} siteId={currentSiteId} userId={user?.id} onClose={() => { setShowCreate(false); setEditItem(null) }} onSaved={onSaved} />
      )}
    </div>
  )
}
