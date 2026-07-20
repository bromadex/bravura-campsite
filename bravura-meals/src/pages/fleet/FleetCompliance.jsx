import { useState, useMemo } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { ModalOverlay } from '../../components/ui'
import { useFleet } from '../../contexts/FleetContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSite } from '../../contexts/SiteContext'
import FleetQuickNav from './FleetQuickNav'
import { supabase } from '../../supabaseClient'
import { useRealtimeRefresh } from '../../hooks/useRealtimeSubscription'

const color = MODULE_COLORS.fleet

const COMPLIANCE_TYPES = {
  vehicle_licence:   'Vehicle Licence',
  insurance:         'Insurance',
  roadworthy:        'Roadworthy',
  fitness_cert:      'Fitness Cert',
  operator_licence:  'Operator Licence',
  operator_medical:  'Operator Medical',
}

const TABS = [
  { key: 'all', label: 'All' },
  { key: 'vehicle_licence', label: 'Vehicle Licence' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'roadworthy', label: 'Roadworthy' },
  { key: 'fitness_cert', label: 'Fitness Cert' },
  { key: 'operator_licence', label: 'Operator Licence' },
  { key: 'operator_medical', label: 'Operator Medical' },
]

function expiryStatus(dateStr) {
  if (!dateStr) return 'none'
  const d = new Date(dateStr)
  const now = new Date()
  const diff = (d - now) / 86400000
  if (diff < 0) return 'expired'
  if (diff <= 7) return 'critical'
  if (diff <= 30) return 'warning'
  return 'ok'
}

const EXPIRY_COLORS = {
  expired:  { bg: '#fde8e8', text: '#b91c1c', border: '#b91c1c' },
  critical: { bg: '#fff3e0', text: '#c2410c', border: '#c2410c' },
  warning:  { bg: '#fffbeb', text: '#b45309', border: '#b45309' },
  ok:       { bg: THEME.statusSuccessBg, text: THEME.statusSuccessText, border: THEME.statusSuccessText },
  none:     { bg: THEME.surface, text: THEME.textLow, border: THEME.outlineVar },
}

const EMPTY_FORM = {
  asset_id: '',
  compliance_type: 'vehicle_licence',
  document_number: '',
  issue_date: '',
  expiry_date: '',
  issuing_authority: '',
  document_url: '',
  notes: '',
}

export default function FleetCompliance({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('fleet_compliance', { column: 'site_id', value: currentSiteId })
  const { assets, compliance, expiringCompliance, loading, fetchAll } = useFleet()

  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const kpis = useMemo(() => {
    const all = compliance || []
    const now = new Date()
    const in30 = new Date()
    in30.setDate(in30.getDate() + 30)
    let expired = 0, expiring = 0, valid = 0
    all.forEach(c => {
      const st = expiryStatus(c.expiry_date)
      if (st === 'expired') expired++
      else if (st === 'critical' || st === 'warning') expiring++
      else valid++
    })
    return { total: all.length, expired, expiring, valid }
  }, [compliance])

  const filtered = useMemo(() => {
    let list = compliance || []
    if (activeTab !== 'all') list = list.filter(c => c.compliance_type === activeTab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        (c.document_number || '').toLowerCase().includes(q) ||
        (c.issuing_authority || '').toLowerCase().includes(q) ||
        (c.fleet_assets?.asset_number || '').toLowerCase().includes(q) ||
        (c.fleet_assets?.description || '').toLowerCase().includes(q) ||
        (COMPLIANCE_TYPES[c.compliance_type] || '').toLowerCase().includes(q)
      )
    }
    list = [...list].sort((a, b) => {
      const da = a.expiry_date || '9999-12-31'
      const db = b.expiry_date || '9999-12-31'
      return da.localeCompare(db)
    })
    return list
  }, [compliance, activeTab, search])

  function openAdd() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setError('')
    setModalOpen(true)
  }

  function openEdit(record) {
    setEditId(record.id)
    setForm({
      asset_id: record.asset_id || '',
      compliance_type: record.compliance_type || 'vehicle_licence',
      document_number: record.document_number || '',
      issue_date: record.issue_date || '',
      expiry_date: record.expiry_date || '',
      issuing_authority: record.issuing_authority || '',
      document_url: record.document_url || '',
      notes: record.notes || '',
    })
    setError('')
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.compliance_type || !form.expiry_date) {
      setError('Compliance type and expiry date are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        site_id: currentSiteId,
        asset_id: form.asset_id || null,
        compliance_type: form.compliance_type,
        document_number: form.document_number || null,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date,
        issuing_authority: form.issuing_authority || null,
        document_url: form.document_url || null,
        notes: form.notes || null,
      }
      if (editId) {
        const { error: err } = await supabase.from('fleet_compliance').update(payload).eq('id', editId)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('fleet_compliance').insert(payload)
        if (err) throw err
      }
      await fetchAll()
      setModalOpen(false)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this compliance record?')) return
    try {
      const { error: err } = await supabase.from('fleet_compliance')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('id', editId)
      if (err) throw err
      await fetchAll()
      setModalOpen(false)
    } catch (err) {
      alert(err.message)
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const inp = {
    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '13px',
    border: `1px solid ${THEME.outlineVar}`, background: THEME.surface,
    color: THEME.text, fontFamily: 'inherit', boxSizing: 'border-box',
  }
  const lbl = { fontSize: '12px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', display: 'block' }
  const fieldWrap = { marginBottom: '12px' }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px', color: THEME.textLow }}>
        <span className="material-symbols-rounded" style={{ fontSize: '32px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
      </div>
    )
  }

  const kpiCards = [
    { label: 'Total Records', value: kpis.total, icon: 'folder_open', bg: color + '14', fg: color },
    { label: 'Expired', value: kpis.expired, icon: 'error', bg: EXPIRY_COLORS.expired.bg, fg: EXPIRY_COLORS.expired.text },
    { label: 'Expiring Soon', value: kpis.expiring, icon: 'warning', bg: EXPIRY_COLORS.warning.bg, fg: EXPIRY_COLORS.warning.text },
    { label: 'Valid', value: kpis.valid, icon: 'check_circle', bg: THEME.statusSuccessBg, fg: THEME.statusSuccessText },
  ]

  function formatDate(d) {
    if (!d) return '-'
    return new Date(d).toLocaleDateString()
  }

  function statusLabel(st) {
    if (st === 'expired') return 'Expired'
    if (st === 'critical') return 'Critical'
    if (st === 'warning') return 'Expiring'
    if (st === 'ok') return 'Valid'
    return '-'
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      <FleetQuickNav setPage={setPage} current="fleet_compliance" />

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
          <div style={{ fontSize: '20px', fontWeight: 500, color: THEME.text }}>Compliance Records</div>
          <div style={{ fontSize: '12px', color: THEME.textMed }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => {
            const rows = filtered.map(c => ({
              Asset: c.fleet_assets?.asset_number || '',
              Description: c.fleet_assets?.description || '',
              Type: COMPLIANCE_TYPES[c.compliance_type] || c.compliance_type,
              'Document #': c.document_number || '',
              'Issue Date': c.issue_date || '',
              'Expiry Date': c.expiry_date || '',
              Status: expiryStatus(c.expiry_date) === 'expired' ? 'Expired' : expiryStatus(c.expiry_date) === 'critical' ? 'Critical' : expiryStatus(c.expiry_date) === 'warning' ? 'Warning' : 'Valid',
              Authority: c.issuing_authority || '',
            }))
            if (!rows.length) return
            const headers = Object.keys(rows[0])
            const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${(r[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n')
            const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = `fleet-compliance-${new Date().toISOString().slice(0,10)}.csv`
            a.click(); URL.revokeObjectURL(url)
          }} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
            background: THEME.surfaceVar, color: THEME.textMed,
            border: `1px solid ${THEME.outlineVar}`, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>download</span>
            Export CSV
          </button>
          {can('fleet.create') && (
            <button onClick={openAdd} style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              padding: '8px 18px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
              background: color, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}>
              <span className="material-symbols-rounded" style={{ fontSize: '18px' }}>add</span>
              Add Record
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <input
          placeholder="Search compliance..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, maxWidth: '260px' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: `1px solid ${THEME.outlineVar}`, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '8px 14px', fontSize: '12px', fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              color: activeTab === t.key ? color : THEME.textMed,
              borderBottom: activeTab === t.key ? `2px solid ${color}` : '2px solid transparent',
              marginBottom: '-1px', fontFamily: 'inherit',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: THEME.textLow }}>
          <span className="material-symbols-rounded" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: THEME.outline }}>verified_user</span>
          <div style={{ fontSize: '14px' }}>No compliance records found</div>
          <div style={{ fontSize: '12px', marginTop: '4px' }}>Try adjusting filters or add a new record</div>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                {['Asset/Operator', 'Type', 'Document #', 'Issue Date', 'Expiry Date', 'Authority', 'Status'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: '11px', fontWeight: 600, color: THEME.textMed, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const st = expiryStatus(c.expiry_date)
                const ec = EXPIRY_COLORS[st]
                return (
                  <tr
                    key={c.id}
                    onClick={() => can('fleet.edit') ? openEdit(c) : null}
                    style={{
                      borderBottom: `1px solid ${THEME.outlineVar}`,
                      cursor: can('fleet.edit') ? 'pointer' : 'default',
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontWeight: 500, color: THEME.text }}>
                      {c.fleet_assets?.asset_number || c.fleet_assets?.description || '-'}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        display: 'inline-block', fontSize: '11px', fontWeight: 600,
                        padding: '2px 10px', borderRadius: '999px',
                        background: color + '18', color,
                      }}>
                        {COMPLIANCE_TYPES[c.compliance_type] || c.compliance_type}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{c.document_number || '-'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{formatDate(c.issue_date)}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: ec.text, background: ec.bg, borderRadius: '0' }}>
                      {formatDate(c.expiry_date)}
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{c.issuing_authority || '-'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{
                        display: 'inline-block', fontSize: '11px', fontWeight: 600,
                        padding: '2px 10px', borderRadius: '999px',
                        background: ec.bg, color: ec.text,
                      }}>
                        {statusLabel(st)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <ModalOverlay onClose={() => setModalOpen(false)} dirty={true}>
          <div style={{
            background: THEME.surface, borderRadius: '18px', width: '560px', maxWidth: '95vw',
            maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: THEME.shadow3,
          }}>
            <div style={{
              padding: '20px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ fontSize: '18px', fontWeight: 600, color: THEME.text }}>
                {editId ? 'Edit Compliance Record' : 'Add Compliance Record'}
              </div>
              <button onClick={() => setModalOpen(false)} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
              }}>
                <span className="material-symbols-rounded" style={{ fontSize: '22px', color: THEME.textMed }}>close</span>
              </button>
            </div>

            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
                <div style={fieldWrap}>
                  <label style={lbl}>Asset (optional)</label>
                  <select style={inp} value={form.asset_id} onChange={e => set('asset_id', e.target.value)}>
                    <option value="">-- None --</option>
                    {(assets || []).map(a => (
                      <option key={a.id} value={a.id}>{a.asset_number} - {a.description}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Compliance Type *</label>
                  <select style={inp} value={form.compliance_type} onChange={e => set('compliance_type', e.target.value)}>
                    {Object.entries(COMPLIANCE_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Document Number</label>
                  <input style={inp} value={form.document_number} onChange={e => set('document_number', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Issuing Authority</label>
                  <input style={inp} value={form.issuing_authority} onChange={e => set('issuing_authority', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Issue Date</label>
                  <input style={inp} type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
                </div>
                <div style={fieldWrap}>
                  <label style={lbl}>Expiry Date *</label>
                  <input style={{ ...inp, borderColor: EXPIRY_COLORS[expiryStatus(form.expiry_date)].border }} type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} />
                  {(() => {
                    const st = expiryStatus(form.expiry_date)
                    const ec = EXPIRY_COLORS[st]
                    if (st !== 'none' && st !== 'ok') return (
                      <div style={{ fontSize: '11px', marginTop: '4px', color: ec.text, fontWeight: 600 }}>
                        {st === 'expired' ? 'EXPIRED' : st === 'critical' ? 'Expires within 7 days' : 'Expires within 30 days'}
                      </div>
                    )
                    return null
                  })()}
                </div>
                <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
                  <label style={lbl}>Document URL</label>
                  <input style={inp} value={form.document_url} onChange={e => set('document_url', e.target.value)} placeholder="https://..." />
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

            <div style={{
              padding: '16px 24px', borderTop: `1px solid ${THEME.outlineVar}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                {editId && can('fleet.delete') && (
                  <button onClick={handleDelete} style={{
                    padding: '8px 16px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                    background: THEME.statusErrorBg, color: THEME.statusErrorText,
                    border: `1px solid ${THEME.statusErrorText}`, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                    Delete
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
        </ModalOverlay>
      )}
    </div>
  )
}
