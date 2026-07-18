import { useState, useEffect, useMemo, Fragment } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { exportCsv } from '../../utils/csv'
import { nextCode } from '../../utils/autoCode'
import QuickNav, { CONTRACTOR_PILLS } from '../../components/QuickNav'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.contractors

const CONTRACTOR_TYPES = ['labour', 'service', 'plant_hire', 'civil', 'drilling', 'security', 'cleaning', 'transport', 'other']
const STATUSES = ['active', 'inactive', 'suspended', 'blacklisted']

const STATUS_COLORS = {
  active:      { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, label: 'Active' },
  inactive:    { bg: THEME.statusNeutralBg, text: THEME.statusNeutralText, label: 'Inactive' },
  suspended:   { bg: THEME.statusWarningBg, text: THEME.statusWarningText, label: 'Suspended' },
  blacklisted: { bg: THEME.statusErrorBg,   text: THEME.statusErrorText,   label: 'Blacklisted' },
}

function typeLabel(t) {
  if (!t) return '-'
  return t.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function expiryStatus(dateStr) {
  if (!dateStr) return 'none'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = (d - now) / 86400000
  if (diff < 0) return 'expired'
  if (diff <= 30) return 'warning'
  return 'ok'
}

const EXPIRY_COLORS = {
  expired: { border: THEME.statusErrorText, text: THEME.statusErrorText },
  warning: { border: THEME.statusWarningText, text: THEME.statusWarningText },
  ok:      { border: THEME.outlineVar, text: THEME.textMed },
  none:    { border: THEME.outlineVar, text: THEME.textLow },
}

const EMPTY_FORM = {
  name: '', short_code: '', contractor_type: 'service', contact_person: '', phone: '', email: '',
  registration_no: '', tax_number: '', vat_number: '', address: '', services_offered: '',
  bank_name: '', bank_account: '', bank_branch: '', insurance_expiry: '', safety_rating: '',
  notes: '', status: 'active',
}

export default function CLCompanies({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  useRealtimeSubscription('contractors', { column: 'site_id', value: currentSiteId }, fetchItems)

  const [items, setItems] = useState([])
  const [contractCounts, setContractCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function fetchItems() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('contractors')
      .select('*')
      .eq('is_archived', false)
      .order('name', { ascending: true })
    if (!err) {
      setItems(data || [])
      const ids = (data || []).map(d => d.id)
      if (ids.length && currentSiteId) {
        const { data: contracts } = await supabase
          .from('contractor_contracts')
          .select('id, contractor_id')
          .eq('site_id', currentSiteId)
          .in('contractor_id', ids)
        const counts = {}
        for (const c of contracts || []) counts[c.contractor_id] = (counts[c.contractor_id] || 0) + 1
        setContractCounts(counts)
      } else {
        setContractCounts({})
      }
    } else {
      showToast(err.message || 'Failed to load contractors', 'error')
    }
    setLoading(false)
  }

  useEffect(() => { fetchItems() }, [currentSiteId])

  const filtered = useMemo(() => {
    let list = items
    if (filterStatus !== 'all') list = list.filter(d => d.status === filterStatus)
    if (filterType !== 'all') list = list.filter(d => d.contractor_type === filterType)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(d =>
        (d.name || '').toLowerCase().includes(q) ||
        (d.short_code || '').toLowerCase().includes(q) ||
        (d.contact_person || '').toLowerCase().includes(q) ||
        (d.phone || '').toLowerCase().includes(q) ||
        (d.email || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [items, filterStatus, filterType, search])

  function openAdd() {
    setEditId(null)
    const short_code = nextCode(items.map(d => d.short_code), { prefix: 'CTR', pad: 3 })
    setForm({ ...EMPTY_FORM, short_code })
    setError('')
    setModalOpen(true)
  }

  function openEdit(item) {
    setEditId(item.id)
    const f = {}
    for (const k of Object.keys(EMPTY_FORM)) f[k] = item[k] ?? (k === 'contractor_type' ? 'service' : k === 'status' ? 'active' : '')
    setForm(f)
    setError('')
    setModalOpen(true)
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name) {
      setError('Company name is required')
      return
    }
    if (form.safety_rating && (isNaN(form.safety_rating) || form.safety_rating < 1 || form.safety_rating > 5)) {
      setError('Safety rating must be between 1 and 5')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name,
        short_code: form.short_code || null,
        contractor_type: form.contractor_type || null,
        contact_person: form.contact_person || null,
        phone: form.phone || null,
        email: form.email || null,
        registration_no: form.registration_no || null,
        tax_number: form.tax_number || null,
        vat_number: form.vat_number || null,
        address: form.address || null,
        services_offered: form.services_offered || null,
        bank_name: form.bank_name || null,
        bank_account: form.bank_account || null,
        bank_branch: form.bank_branch || null,
        insurance_expiry: form.insurance_expiry || null,
        safety_rating: form.safety_rating ? parseFloat(form.safety_rating) : null,
        notes: form.notes || null,
        status: form.status,
      }
      if (editId) {
        const { error: err } = await supabase.from('contractors').update(payload).eq('id', editId)
        if (err) throw err
        showToast('Contractor updated', 'success')
      } else {
        const { error: err } = await supabase.from('contractors').insert(payload)
        if (err) throw err
        showToast('Contractor created', 'success')
      }
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this contractor? It will be hidden but not permanently deleted.')) return
    try {
      const { error: err } = await supabase.from('contractors').update({
        is_archived: true, archived_at: new Date().toISOString(),
      }).eq('id', editId)
      if (err) throw err
      showToast('Contractor archived', 'success')
      await fetchItems()
      setModalOpen(false)
    } catch (err) {
      showToast(err.message || 'Archive failed', 'error')
    }
  }

  function handleExportCsv() {
    const headers = ['Name', 'Short Code', 'Type', 'Status', 'Contact Person', 'Phone', 'Email', 'Registration No', 'Tax Number', 'VAT Number', 'Address', 'Services Offered', 'Bank Name', 'Bank Account', 'Bank Branch', 'Insurance Expiry', 'Safety Rating', 'Contracts', 'Notes']
    const rows = filtered.map(d => [
      d.name, d.short_code || '', typeLabel(d.contractor_type), STATUS_COLORS[d.status]?.label || d.status,
      d.contact_person || '', d.phone || '', d.email || '', d.registration_no || '', d.tax_number || '',
      d.vat_number || '', d.address || '', d.services_offered || '', d.bank_name || '', d.bank_account || '',
      d.bank_branch || '', d.insurance_expiry || '', d.safety_rating ?? '', contractCounts[d.id] || 0, d.notes || '',
    ])
    exportCsv('contractor_companies.csv', headers, rows)
  }

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  function expiryInputStyle(dateStr) {
    const st = expiryStatus(dateStr)
    return { ...inp, borderColor: EXPIRY_COLORS[st].border }
  }

  const kpis = useMemo(() => ({
    total: items.length,
    active: items.filter(d => d.status === 'active').length,
    suspended: items.filter(d => d.status === 'suspended').length,
    blacklisted: items.filter(d => d.status === 'blacklisted').length,
  }), [items])

  const kpiCards = [
    { label: 'Total Companies', value: kpis.total, icon: 'business', bg: color + '14', fg: color },
    { label: 'Active', value: kpis.active, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
    { label: 'Suspended', value: kpis.suspended, icon: 'pause_circle', bg: THEME.statusWarningBg, fg: THEME.statusWarningText },
    { label: 'Blacklisted', value: kpis.blacklisted, icon: 'block', bg: THEME.statusErrorBg, fg: THEME.statusErrorText },
  ]

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {kpiCards.map(k => (
          <div key={k.label} style={{
            background: THEME.surface, borderRadius: '14px', padding: '18px',
            border: `1px solid ${THEME.outlineVar}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '12px',
                background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '20px', color: k.fg }}>{k.icon}</span>
              </div>
              <div>
                <div style={{ fontSize: '22px', fontWeight: 600, color: THEME.text }}>{k.value}</div>
                <div style={{ fontSize: '11px', color: THEME.textMed }}>{k.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Contractor Companies</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} compan{filtered.length !== 1 ? 'ies' : 'y'}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={handleExportCsv} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: THEME.surfaceVar, color: THEME.textMed,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>download</span>
            Export CSV
          </button>
          {can('contractors.edit') && (
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              Add Company
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search name, code, contact, phone, email..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '280px' }}
        />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inp, maxWidth: '160px' }}>
          <option value="all">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)} style={{ ...inp, maxWidth: '180px' }}>
          <option value="all">All Types</option>
          {CONTRACTOR_TYPES.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>business</span>
          <div style={{ fontSize: '14px' }}>No contractor companies found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new company</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '14px', border: `1px solid ${THEME.outlineVar}` }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: THEME.surfaceVar }}>
                {['Name', 'Code', 'Type', 'Status', 'Contact', 'Phone', 'Insurance', 'Safety', 'Contracts', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', whiteSpace: 'nowrap', borderBottom: `1px solid ${THEME.outlineVar}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const sc = STATUS_COLORS[d.status] || STATUS_COLORS.inactive
                const ec = EXPIRY_COLORS[expiryStatus(d.insurance_expiry)]
                const isExpanded = expandedId === d.id
                return (
                  <Fragment key={d.id}>
                    <tr
                      onClick={() => setExpandedId(isExpanded ? null : d.id)}
                      style={{ cursor: 'pointer', borderBottom: isExpanded ? 'none' : `1px solid ${THEME.outlineVar}`, background: isExpanded ? THEME.surfaceVar : 'transparent' }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = THEME.surfaceVar }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: THEME.text }}>{d.name}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.short_code || '-'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {d.contractor_type && (
                          <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: color + '14', color }}>{typeLabel(d.contractor_type)}</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 10px', borderRadius: '6px', background: sc.bg, color: sc.text }}>{sc.label}</span>
                      </td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.contact_person || '-'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{d.phone || '-'}</td>
                      <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: 600, color: ec.text }}>{d.insurance_expiry || '-'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{d.safety_rating != null ? `${d.safety_rating}/5` : '-'}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{contractCounts[d.id] || 0}</td>
                      <td style={{ padding: '10px 12px' }}>
                        {can('contractors.edit') && (
                          <button
                            onClick={e => { e.stopPropagation(); openEdit(d) }}
                            style={{
                              padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                              background: color + '14', color, border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                            }}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderBottom: `1px solid ${THEME.outlineVar}`, background: THEME.surfaceVar }}>
                        <td colSpan={10} style={{ padding: '4px 20px 18px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px 24px', paddingTop: '10px' }}>
                            <DetailField label="Email" value={d.email} />
                            <DetailField label="Registration No" value={d.registration_no} />
                            <DetailField label="Tax Number" value={d.tax_number} />
                            <DetailField label="VAT Number" value={d.vat_number} />
                            <DetailField label="Address" value={d.address} />
                            <DetailField label="Services Offered" value={d.services_offered} />
                            <DetailField label="Bank Name" value={d.bank_name} />
                            <DetailField label="Bank Account" value={d.bank_account} />
                            <DetailField label="Bank Branch" value={d.bank_branch} />
                            <DetailField label="Notes" value={d.notes} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,.45)',
        }} onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '680px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{ padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Contractor Company' : 'Add Contractor Company'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '10px' }}>Company Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Company Name *</label>
                  <input style={inp} value={form.name} onChange={e => set('name', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Short Code</label>
                  <input style={inp} value={form.short_code} onChange={e => set('short_code', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Contractor Type</label>
                  <select style={inp} value={form.contractor_type} onChange={e => set('contractor_type', e.target.value)}>
                    {CONTRACTOR_TYPES.map(t => <option key={t} value={t}>{typeLabel(t)}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Status</label>
                  <select style={inp} value={form.status} onChange={e => set('status', e.target.value)}>
                    {STATUSES.map(s => <option key={s} value={s}>{STATUS_COLORS[s]?.label || s}</option>)}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Safety Rating (1-5)</label>
                  <input style={inp} type="number" min="1" max="5" step="0.1" value={form.safety_rating} onChange={e => set('safety_rating', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Contact Person</label>
                  <input style={inp} value={form.contact_person} onChange={e => set('contact_person', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Phone</label>
                  <input style={inp} value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Email</label>
                  <input style={inp} type="email" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Address</label>
                  <input style={inp} value={form.address} onChange={e => set('address', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Services Offered</label>
                  <textarea style={{ ...inp, minHeight: '50px', resize: 'vertical' }} value={form.services_offered} onChange={e => set('services_offered', e.target.value)} />
                </div>
              </div>

              <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '14px 0 10px' }}>Registration & Compliance</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={fieldWrap}>
                  <label style={lbl}>Registration No</label>
                  <input style={inp} value={form.registration_no} onChange={e => set('registration_no', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Tax Number</label>
                  <input style={inp} value={form.tax_number} onChange={e => set('tax_number', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>VAT Number</label>
                  <input style={inp} value={form.vat_number} onChange={e => set('vat_number', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Insurance Expiry</label>
                  <input style={expiryInputStyle(form.insurance_expiry)} type="date" value={form.insurance_expiry} onChange={e => set('insurance_expiry', e.target.value)} />
                  {(() => {
                    const st = expiryStatus(form.insurance_expiry)
                    if (st === 'expired' || st === 'warning') return (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: EXPIRY_COLORS[st].text, fontWeight: 600 }}>
                        {st === 'expired' ? 'EXPIRED' : 'Expires within 30 days'}
                      </div>
                    )
                    return null
                  })()}
                </div>
              </div>

              <div style={{ fontSize: '11px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.04em', margin: '14px 0 10px' }}>Banking Details</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={fieldWrap}>
                  <label style={lbl}>Bank Name</label>
                  <input style={inp} value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Bank Account</label>
                  <input style={inp} value={form.bank_account} onChange={e => set('bank_account', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Bank Branch</label>
                  <input style={inp} value={form.bank_branch} onChange={e => set('bank_branch', e.target.value)} />
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Notes</label>
                  <textarea style={{ ...inp, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            </div>

            {error && (
              <div style={{ padding: '0 24px 12px', fontSize: '12px', color: THEME.error, fontWeight: 600 }}>
                {error}
              </div>
            )}

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                {editId && can('contractors.edit') && (
                  <button onClick={handleArchive} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Archive
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setModalOpen(false)} style={{
                  padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: THEME.surfaceVar, color: THEME.textMed,
                  border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
                }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving} style={{
                  padding: '8px 22px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: color, color: '#fff',
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.6 : 1, fontFamily: 'inherit',
                }}>
                  {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value }) {
  return (
    <div>
      <QuickNav pills={CONTRACTOR_PILLS} setPage={setPage} current="cl_companies" />
      <div style={{ fontSize: '10px', fontWeight: 700, color: THEME.textLow, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>{label}</div>
      <div style={{ fontSize: '13px', color: THEME.text }}>{value || '-'}</div>
    </div>
  )
}
