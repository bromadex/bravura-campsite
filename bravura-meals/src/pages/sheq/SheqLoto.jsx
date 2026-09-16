import { useState, useEffect, useMemo, useCallback } from 'react'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { supabase } from '../../supabaseClient'
import { Card, Icon, Button, PageHeader, showToast } from '../../components/ui'
import QuickNav, { SHEQ_PILLS } from '../../components/QuickNav'
import { exportCsv } from '../../utils/csv'

const ACCENT = MODULE_COLORS.sheq || '#D32F2F'

const ENERGY_SOURCES = ['electrical','mechanical','hydraulic','pneumatic','chemical','thermal','gravitational','stored_energy','other']
const ENERGY_LABELS = {
  electrical: 'Electrical', mechanical: 'Mechanical', hydraulic: 'Hydraulic',
  pneumatic: 'Pneumatic', chemical: 'Chemical', thermal: 'Thermal',
  gravitational: 'Gravitational', stored_energy: 'Stored Energy', other: 'Other',
}
const ENERGY_COLORS = {
  electrical: '#1565C0', mechanical: '#37474F', hydraulic: '#E65100',
  pneumatic: '#00838F', chemical: '#7B1FA2', thermal: '#D32F2F',
  gravitational: '#795548', stored_energy: '#F59E0B', other: '#9E9E9E',
}

const STATUSES = ['applied', 'verified', 'restored']
const STATUS_COLORS = { applied: '#E65100', verified: '#1565C0', restored: '#2E7D32' }
const STATUS_LABELS = { all: 'All', applied: 'Applied', verified: 'Verified', restored: 'Restored' }
const STATUS_TABS = ['all', 'applied', 'verified', 'restored']

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }
const lbl = { fontSize: '10px', fontWeight: 600, color: THEME.textMed, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '.05em' }

function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-block', padding: '3px 10px', borderRadius: '6px',
      fontSize: '11px', fontWeight: 600, background: color + '18', color,
    }}>
      {label}
    </span>
  )
}

function Field({ label, children, required }) {
  return (
    <div>
      <div style={lbl}>{label}{required && <span style={{ color: THEME.error }}> *</span>}</div>
      {children}
    </div>
  )
}

function fmtDatetime(d) {
  if (!d) return '--'
  const dt = new Date(d)
  return dt.toLocaleDateString() + ' ' + dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// ── Create/Edit Modal ───────────────────────────────────────────────────────

function LotoModal({ loto, permits, profiles, siteId, userId, canApprove, onClose, onSaved }) {
  const isEdit = !!loto
  const [form, setForm] = useState(() => {
    if (loto) return {
      equipment_name: loto.equipment_name || '',
      equipment_id_tag: loto.equipment_id_tag || '',
      energy_source: loto.energy_source || 'electrical',
      isolation_point: loto.isolation_point || '',
      isolation_method: loto.isolation_method || '',
      lock_number: loto.lock_number || '',
      tag_number: loto.tag_number || '',
      permit_id: loto.permit_id || '',
      notes: loto.notes || '',
    }
    return {
      equipment_name: '', equipment_id_tag: '', energy_source: 'electrical',
      isolation_point: '', isolation_method: '', lock_number: '', tag_number: '',
      permit_id: '', notes: '',
    }
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.equipment_name || !form.lock_number || !form.tag_number) {
      showToast('Equipment name, lock number, and tag number are required', 'error'); return
    }
    setSaving(true)
    try {
      if (isEdit) {
        const update = {
          equipment_name: form.equipment_name,
          equipment_id_tag: form.equipment_id_tag || null,
          energy_source: form.energy_source,
          isolation_point: form.isolation_point || null,
          isolation_method: form.isolation_method || null,
          lock_number: form.lock_number,
          tag_number: form.tag_number,
          permit_id: form.permit_id || null,
          notes: form.notes || null,
          updated_at: new Date().toISOString(),
        }
        const { error } = await supabase.from('sheq_loto_isolations').update(update).eq('id', loto.id).eq('site_id', siteId)
        if (error) throw error
        showToast('LOTO isolation updated')
      } else {
        const { data: numData, error: numErr } = await supabase.rpc('sheq_next_number', {
          p_site_id: siteId, p_prefix: 'LOTO', p_table: 'sheq_loto_isolations',
        })
        if (numErr) throw numErr
        const { error } = await supabase.from('sheq_loto_isolations').insert({
          site_id: siteId,
          isolation_number: numData,
          equipment_name: form.equipment_name,
          equipment_id_tag: form.equipment_id_tag || null,
          energy_source: form.energy_source,
          isolation_point: form.isolation_point || null,
          isolation_method: form.isolation_method || null,
          lock_number: form.lock_number,
          tag_number: form.tag_number,
          permit_id: form.permit_id || null,
          notes: form.notes || null,
          status: 'applied',
          applied_by: userId,
          applied_at: new Date().toISOString(),
        })
        if (error) throw error
        showToast('LOTO isolation created')
      }
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleVerify() {
    setSaving(true)
    try {
      const { error } = await supabase.from('sheq_loto_isolations').update({
        status: 'verified',
        verified_by: userId,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', loto.id).eq('site_id', siteId)
      if (error) throw error
      showToast('Isolation verified')
      onSaved()
    } catch (err) {
      showToast(err.message || 'Verify failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRestore() {
    setSaving(true)
    try {
      const { error } = await supabase.from('sheq_loto_isolations').update({
        status: 'restored',
        restored_by: userId,
        restored_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', loto.id).eq('site_id', siteId)
      if (error) throw error
      showToast('Isolation restored')
      onSaved()
    } catch (err) {
      showToast(err.message || 'Restore failed', 'error')
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
          width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? `Edit ${loto.isolation_number}` : 'New LOTO Isolation'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Equipment section */}
          <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '14px', border: `1px solid ${THEME.outlineVar}` }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', marginBottom: '10px' }}>
              Equipment
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <Field label="Equipment Name" required>
                <input style={inputStyle} value={form.equipment_name} onChange={e => set('equipment_name', e.target.value)} />
              </Field>
              <Field label="Equipment ID / Tag">
                <input style={inputStyle} value={form.equipment_id_tag} onChange={e => set('equipment_id_tag', e.target.value)} />
              </Field>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
              <Field label="Energy Source" required>
                <select style={selectStyle} value={form.energy_source} onChange={e => set('energy_source', e.target.value)}>
                  {ENERGY_SOURCES.map(s => <option key={s} value={s}>{ENERGY_LABELS[s]}</option>)}
                </select>
              </Field>
              <Field label="Isolation Point">
                <input style={inputStyle} value={form.isolation_point} onChange={e => set('isolation_point', e.target.value)} />
              </Field>
            </div>
            <div style={{ marginTop: '12px' }}>
              <Field label="Isolation Method">
                <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.isolation_method} onChange={e => set('isolation_method', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Lock/Tag section */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Lock Number" required>
              <input style={inputStyle} value={form.lock_number} onChange={e => set('lock_number', e.target.value)} />
            </Field>
            <Field label="Tag Number" required>
              <input style={inputStyle} value={form.tag_number} onChange={e => set('tag_number', e.target.value)} />
            </Field>
          </div>

          {/* Context section */}
          <Field label="Linked Permit (PTW)">
            <select style={selectStyle} value={form.permit_id} onChange={e => set('permit_id', e.target.value)}>
              <option value="">None</option>
              {permits.map(p => <option key={p.id} value={p.id}>{p.permit_number} - {p.work_description?.slice(0, 40) || 'No description'}</option>)}
            </select>
          </Field>

          <Field label="Notes">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </Field>

          {/* Status info for existing records */}
          {isEdit && (
            <div style={{ background: THEME.surfaceVar, borderRadius: '10px', padding: '14px', border: `1px solid ${THEME.outlineVar}` }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', marginBottom: '8px' }}>
                Status: <Badge label={STATUS_LABELS[loto.status]} color={STATUS_COLORS[loto.status]} />
              </div>
              <div style={{ fontSize: '12px', color: THEME.textMed, lineHeight: 1.8 }}>
                {profileMap[loto.applied_by] && <div>Applied by: {profileMap[loto.applied_by]} at {fmtDatetime(loto.applied_at)}</div>}
                {profileMap[loto.verified_by] && <div>Verified by: {profileMap[loto.verified_by]} at {fmtDatetime(loto.verified_at)}</div>}
                {profileMap[loto.restored_by] && <div>Restored by: {profileMap[loto.restored_by]} at {fmtDatetime(loto.restored_at)}</div>}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          {isEdit && loto.status === 'applied' && canApprove && (
            <Button variant="ghost" onClick={handleVerify} disabled={saving} icon="verified">
              Verify Isolation
            </Button>
          )}
          {isEdit && loto.status === 'verified' && canApprove && (
            <Button variant="ghost" onClick={handleRestore} disabled={saving} icon="lock_open">
              Restore (Remove Lock)
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {(!isEdit || loto.status === 'applied') && (
            <Button onClick={handleSave} disabled={saving} icon="save">
              {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Isolation'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function SheqLoto({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [permits, setPermits] = useState([])

  const canView = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit = can('sheq.edit')
  const canApprove = can('sheq.approve')

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data, error }, { data: profs }, { data: perms }] = await Promise.all([
      supabase
        .from('sheq_loto_isolations')
        .select('*')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('created_at', { ascending: false }),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase
        .from('sheq_permits')
        .select('id, permit_number, work_description')
        .eq('site_id', currentSiteId)
        .in('status', ['approved', 'active'])
        .is('is_archived', false)
        .order('permit_number', { ascending: false }),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setProfiles(profs || [])
    setPermits(perms || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData])

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  // KPI calculations
  const kpis = useMemo(() => {
    const active = rows.filter(r => r.status === 'applied' || r.status === 'verified').length
    const verified = rows.filter(r => r.status === 'verified').length
    const today = new Date().toISOString().slice(0, 10)
    const restoredToday = rows.filter(r => r.status === 'restored' && r.restored_at?.slice(0, 10) === today).length
    return { active, verified, restoredToday, total: rows.length }
  }, [rows])

  // Filtering
  const filtered = useMemo(() => {
    let list = rows
    if (statusFilter !== 'all') {
      list = list.filter(r => r.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        r.isolation_number?.toLowerCase().includes(q) ||
        r.equipment_name?.toLowerCase().includes(q) ||
        r.lock_number?.toLowerCase().includes(q) ||
        r.tag_number?.toLowerCase().includes(q)
      )
    }
    return list
  }, [rows, statusFilter, search])

  const counts = useMemo(() => {
    const c = { all: rows.length, applied: 0, verified: 0, restored: 0 }
    rows.forEach(r => { if (c[r.status] !== undefined) c[r.status]++ })
    return c
  }, [rows])

  function handleExport() {
    const headers = ['Isolation #', 'Equipment', 'ID/Tag', 'Energy Source', 'Isolation Point', 'Lock #', 'Tag #', 'Applied By', 'Applied At', 'Status']
    const csvRows = filtered.map(r => [
      r.isolation_number, r.equipment_name, r.equipment_id_tag || '',
      ENERGY_LABELS[r.energy_source] || r.energy_source, r.isolation_point || '',
      r.lock_number, r.tag_number,
      profileMap[r.applied_by] || '', r.applied_at ? fmtDatetime(r.applied_at) : '',
      STATUS_LABELS[r.status] || r.status,
    ])
    exportCsv(`sheq-loto-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm(`Archive isolation ${row.isolation_number}?`)) return
    const { error } = await supabase.from('sheq_loto_isolations').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Isolation archived')
    fetchData()
  }

  function onSaved() {
    setShowCreate(false)
    setEditRow(null)
    fetchData()
  }

  if (!canView) {
    return (
      <div style={{ padding: '32px 24px' }}>
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_loto" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view LOTO records.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_loto" />

      <PageHeader
        title="LOTO Isolation Register"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Isolation</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Active Locks', value: kpis.active, icon: 'lock', color: '#E65100' },
          { label: 'Verified', value: kpis.verified, icon: 'verified', color: '#1565C0' },
          { label: 'Restored Today', value: kpis.restoredToday, icon: 'lock_open', color: '#2E7D32' },
          { label: 'Total Records', value: kpis.total, icon: 'list_alt', color: ACCENT },
        ].map(k => (
          <Card key={k.label} style={{ padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Icon name={k.icon} size={18} style={{ color: k.color }} />
              <span style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase' }}>{k.label}</span>
            </div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: THEME.text }}>{k.value}</div>
          </Card>
        ))}
      </div>

      {/* Status tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {STATUS_TABS.map(tab => {
          const active = statusFilter === tab
          const clr = STATUS_COLORS[tab] || ACCENT
          return (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none',
                fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                background: active ? clr : THEME.surfaceVar,
                color: active ? '#fff' : THEME.textMed,
                transition: 'all .15s',
              }}
            >
              {STATUS_LABELS[tab]} ({counts[tab] || 0})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div style={{ marginBottom: '16px', maxWidth: '320px' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            style={{ ...inputStyle, paddingLeft: '32px' }}
            placeholder="Search by isolation #, equipment, lock, tag..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading LOTO records...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No LOTO isolation records yet.' : 'No records match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Isolation #', 'Equipment', 'ID/Tag', 'Energy Source', 'Isolation Point', 'Lock #', 'Tag #', 'Applied By', 'Applied At', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr
                    key={r.id}
                    style={{ borderBottom: `1px solid ${THEME.outlineVar}`, cursor: 'pointer' }}
                    onClick={() => canEdit ? setEditRow(r) : null}
                    onMouseEnter={e => e.currentTarget.style.background = THEME.surfaceVar}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 500, color: THEME.text }}>{r.isolation_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.equipment_name}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.equipment_id_tag || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={ENERGY_LABELS[r.energy_source] || r.energy_source} color={ENERGY_COLORS[r.energy_source] || '#9E9E9E'} />
                    </td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.isolation_point || '--'}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: THEME.text }}>{r.lock_number}</td>
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: THEME.text }}>{r.tag_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.applied_by] || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed, whiteSpace: 'nowrap' }}>{fmtDatetime(r.applied_at)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={STATUS_LABELS[r.status]} color={STATUS_COLORS[r.status]} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && r.status === 'applied' && (
                          <button onClick={e => { e.stopPropagation(); setEditRow(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Edit">
                            <Icon name="edit" size={16} style={{ color: THEME.textMed }} />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={e => { e.stopPropagation(); handleArchive(r) }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} title="Archive">
                            <Icon name="archive" size={16} style={{ color: THEME.textLow }} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(showCreate || editRow) && (
        <LotoModal
          loto={editRow}
          permits={permits}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          canApprove={canApprove}
          onClose={() => { setShowCreate(false); setEditRow(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
