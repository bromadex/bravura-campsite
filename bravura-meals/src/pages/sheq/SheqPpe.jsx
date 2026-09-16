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

const CATEGORIES = {
  head: 'Head Protection', eye: 'Eye Protection', ear: 'Hearing Protection',
  respiratory: 'Respiratory', hand: 'Hand Protection', foot: 'Foot Protection',
  body: 'Body Protection', fall_protection: 'Fall Protection',
  high_visibility: 'High Visibility', welding: 'Welding', chemical: 'Chemical',
  electrical: 'Electrical', other: 'Other',
}

const CONDITIONS = { new: 'New', good: 'Good', fair: 'Fair' }
const RETURN_CONDITIONS = { good: 'Good', fair: 'Fair', damaged: 'Damaged', destroyed: 'Destroyed' }

const inputStyle = {
  width: '100%', padding: '9px 12px', border: `1px solid ${THEME.outline}`,
  borderRadius: '10px', fontSize: '13px', color: THEME.text,
  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  background: THEME.surface,
}
const selectStyle = { ...inputStyle, cursor: 'pointer' }

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

function ItemModal({ item, siteId, onClose, onSaved }) {
  const isEdit = !!item
  const [form, setForm] = useState(() => {
    if (item) return {
      name: item.name || '', category: item.category || '', description: item.description || '',
      standard: item.standard || '', supplier: item.supplier || '',
      unit_cost: item.unit_cost ?? '', reorder_level: item.reorder_level ?? 0,
      current_stock: item.current_stock ?? 0, shelf_life_months: item.shelf_life_months ?? '',
      is_active: item.is_active !== false,
    }
    return { name: '', category: '', description: '', standard: '', supplier: '', unit_cost: '', reorder_level: 0, current_stock: 0, shelf_life_months: '', is_active: true }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.name || !form.category) { showToast('Please fill required fields', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name, category: form.category, description: form.description || null,
        standard: form.standard || null, supplier: form.supplier || null,
        unit_cost: form.unit_cost !== '' ? Number(form.unit_cost) : null,
        reorder_level: Number(form.reorder_level) || 0,
        current_stock: Number(form.current_stock) || 0,
        shelf_life_months: form.shelf_life_months !== '' ? Number(form.shelf_life_months) : null,
        is_active: form.is_active,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_ppe_items').update(payload).eq('id', item.id).eq('site_id', siteId)
        if (error) throw error
        showToast('PPE item updated')
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'PPE', p_table: 'sheq_ppe_items' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.ppe_code = num
        const { error } = await supabase.from('sheq_ppe_items').insert(payload)
        if (error) throw error
        showToast(`PPE item ${num} created`)
      }
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${item.ppe_code}` : 'New PPE Item'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Name" required><input style={inputStyle} value={form.name} onChange={e => set('name', e.target.value)} placeholder="PPE item name" /></Field>
          <Field label="Category" required>
            <select style={selectStyle} value={form.category} onChange={e => set('category', e.target.value)}>
              <option value="">Select...</option>
              {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Description"><input style={inputStyle} value={form.description} onChange={e => set('description', e.target.value)} /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Standard"><input style={inputStyle} value={form.standard} onChange={e => set('standard', e.target.value)} placeholder="e.g. EN166" /></Field>
            <Field label="Supplier"><input style={inputStyle} value={form.supplier} onChange={e => set('supplier', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Unit Cost ($)"><input style={inputStyle} type="number" step="0.01" value={form.unit_cost} onChange={e => set('unit_cost', e.target.value)} /></Field>
            <Field label="Current Stock"><input style={inputStyle} type="number" value={form.current_stock} onChange={e => set('current_stock', e.target.value)} /></Field>
            <Field label="Reorder Level"><input style={inputStyle} type="number" value={form.reorder_level} onChange={e => set('reorder_level', e.target.value)} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <Field label="Shelf Life (months)"><input style={inputStyle} type="number" value={form.shelf_life_months} onChange={e => set('shelf_life_months', e.target.value)} /></Field>
            <Field label="Active">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: THEME.text }}>
                <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} /> Active
              </label>
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

function IssueModal({ issue, ppeItems, profiles, siteId, userId, onClose, onSaved }) {
  const isEdit = !!issue
  const [form, setForm] = useState(() => {
    if (issue) return {
      issue_date: issue.issue_date || '', ppe_item_id: issue.ppe_item_id || '',
      issued_to: issue.issued_to || '', quantity: issue.quantity ?? 1,
      size: issue.size || '', condition_on_issue: issue.condition_on_issue || 'new',
      expiry_date: issue.expiry_date || '', notes: issue.notes || '',
      returned_date: issue.returned_date || '', return_condition: issue.return_condition || '',
    }
    return { issue_date: new Date().toISOString().slice(0, 10), ppe_item_id: '', issued_to: '', quantity: 1, size: '', condition_on_issue: 'new', expiry_date: '', notes: '', returned_date: '', return_condition: '' }
  })
  const [saving, setSaving] = useState(false)
  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSave() {
    if (!form.ppe_item_id || !form.issued_to) { showToast('Please fill required fields', 'error'); return }
    setSaving(true)
    try {
      const payload = {
        issue_date: form.issue_date, ppe_item_id: form.ppe_item_id,
        issued_to: form.issued_to, quantity: Number(form.quantity) || 1,
        size: form.size || null, condition_on_issue: form.condition_on_issue,
        expiry_date: form.expiry_date || null, notes: form.notes || null,
        returned_date: form.returned_date || null,
        return_condition: form.returned_date ? (form.return_condition || null) : null,
      }
      if (isEdit) {
        const { error } = await supabase.from('sheq_ppe_issues').update(payload).eq('id', issue.id).eq('site_id', siteId)
        if (error) throw error
        showToast('Issue updated')
      } else {
        const { data: num, error: numErr } = await supabase.rpc('sheq_next_number', { p_site_id: siteId, p_prefix: 'ISS', p_table: 'sheq_ppe_issues' })
        if (numErr) throw numErr
        payload.site_id = siteId
        payload.issue_number = num
        payload.issued_by = userId
        const { error } = await supabase.from('sheq_ppe_issues').insert(payload)
        if (error) throw error
        showToast(`Issue ${num} created`)
      }
      onSaved()
    } catch (err) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ width: '520px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', background: THEME.surface, borderRadius: '16px', padding: '28px', boxShadow: THEME.shadow3 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>{isEdit ? `Edit ${issue.issue_number}` : 'New PPE Issue'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="close" size={20} style={{ color: THEME.textMed }} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Issue Date" required><input style={inputStyle} type="date" value={form.issue_date} onChange={e => set('issue_date', e.target.value)} /></Field>
          <Field label="PPE Item" required>
            <select style={selectStyle} value={form.ppe_item_id} onChange={e => set('ppe_item_id', e.target.value)}>
              <option value="">Select item...</option>
              {ppeItems.map(p => <option key={p.id} value={p.id}>{p.ppe_code} — {p.name}</option>)}
            </select>
          </Field>
          <Field label="Issued To" required>
            <select style={selectStyle} value={form.issued_to} onChange={e => set('issued_to', e.target.value)}>
              <option value="">Select person...</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <Field label="Quantity"><input style={inputStyle} type="number" min="1" value={form.quantity} onChange={e => set('quantity', e.target.value)} /></Field>
            <Field label="Size"><input style={inputStyle} value={form.size} onChange={e => set('size', e.target.value)} placeholder="e.g. L, XL" /></Field>
            <Field label="Condition">
              <select style={selectStyle} value={form.condition_on_issue} onChange={e => set('condition_on_issue', e.target.value)}>
                {Object.entries(CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Expiry Date"><input style={inputStyle} type="date" value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} /></Field>
          {isEdit && (
            <>
              <SectionLabel>Return</SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <Field label="Returned Date"><input style={inputStyle} type="date" value={form.returned_date} onChange={e => set('returned_date', e.target.value)} /></Field>
                <Field label="Return Condition">
                  <select style={selectStyle} value={form.return_condition} onChange={e => set('return_condition', e.target.value)}>
                    <option value="">Select...</option>
                    {Object.entries(RETURN_CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
              </div>
            </>
          )}
          <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={e => set('notes', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update' : 'Create'}</Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqPpe({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const { user } = useAuth()
  const [tab, setTab] = useState('items')
  const [items, setItems] = useState([])
  const [issues, setIssues] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')

  async function load() {
    if (!currentSiteId) return
    setLoading(true)
    const [itemsRes, issuesRes, profilesRes] = await Promise.all([
      supabase.from('sheq_ppe_items').select('*').eq('site_id', currentSiteId).eq('is_archived', false).order('name'),
      supabase.from('sheq_ppe_issues').select('*, sheq_ppe_items(name, ppe_code), profiles!sheq_ppe_issues_issued_to_fkey(full_name)').eq('site_id', currentSiteId).eq('is_archived', false).order('issue_date', { ascending: false }).limit(500),
      supabase.from('profiles').select('id, full_name'),
    ])
    if (itemsRes.error) showToast(itemsRes.error.message, 'error')
    if (issuesRes.error) showToast(issuesRes.error.message, 'error')
    setItems(itemsRes.data || [])
    setIssues(issuesRes.data || [])
    setProfiles(profilesRes.data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [currentSiteId])

  const filteredItems = items.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return (r.ppe_code || '').toLowerCase().includes(s) || (r.name || '').toLowerCase().includes(s)
  })

  const filteredIssues = issues.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    return (r.issue_number || '').toLowerCase().includes(s) || (r.sheq_ppe_items?.name || '').toLowerCase().includes(s) || (r.profiles?.full_name || '').toLowerCase().includes(s)
  })

  async function handleArchiveItem(r) {
    if (!confirm(`Archive PPE item ${r.ppe_code}?`)) return
    const { error } = await supabase.from('sheq_ppe_items').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  async function handleArchiveIssue(r) {
    if (!confirm(`Archive issue ${r.issue_number}?`)) return
    const { error } = await supabase.from('sheq_ppe_issues').update({ is_archived: true }).eq('id', r.id).eq('site_id', currentSiteId)
    if (error) showToast(error.message, 'error')
    else { showToast('Archived'); load() }
  }

  if (!can('sheq.view')) return <div style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>You do not have permission to view PPE register.</div>

  const lowStockCount = items.filter(i => i.is_active && i.current_stock <= i.reorder_level).length

  return (
    <div style={{ padding: '0 0 40px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_ppe" />
      <PageHeader title="PPE Register" subtitle={`${items.length} items · ${issues.length} issues${lowStockCount ? ` · ${lowStockCount} low stock` : ''}`} icon="health_and_safety" accentColor={ACCENT} />

      <div style={{ display: 'flex', gap: '0', marginBottom: '18px' }}>
        {[{ id: 'items', label: 'PPE Items', icon: 'inventory_2' }, { id: 'issues', label: 'PPE Issues', icon: 'assignment_ind' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            padding: '10px 20px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
            background: tab === t.id ? ACCENT : 'transparent', color: tab === t.id ? '#fff' : THEME.textMed,
            border: `1px solid ${tab === t.id ? ACCENT : THEME.outline}`, cursor: 'pointer',
            borderRadius: t.id === 'items' ? '10px 0 0 10px' : '0 10px 10px 0',
          }}>
            <Icon name={t.icon} size={16} style={{ color: 'inherit' }} /> {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input style={{ ...inputStyle, paddingLeft: '32px' }} placeholder={`Search ${tab}...`} value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {can('sheq.create') && (
          <Button style={{ background: ACCENT, color: '#fff' }} onClick={() => setModal(tab === 'items' ? 'newItem' : 'newIssue')}>
            <Icon name="add" size={16} style={{ color: '#fff' }} /> {tab === 'items' ? 'New Item' : 'New Issue'}
          </Button>
        )}
        <Button variant="ghost" onClick={() => exportCsv(tab === 'items' ? filteredItems : filteredIssues, `ppe_${tab}_${currentSiteId}`)}>
          <Icon name="download" size={16} /> Export
        </Button>
      </div>

      {tab === 'items' ? (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar }}>
                  {['Code', 'Name', 'Category', 'Stock', 'Reorder', 'Unit Cost', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
                ) : filteredItems.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No PPE items found</td></tr>
                ) : filteredItems.map(r => {
                  const lowStock = r.is_active && r.current_stock <= r.reorder_level
                  return (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}`, background: lowStock ? '#FFF8F0' : 'transparent' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.ppe_code}</td>
                      <td style={{ padding: '10px 12px', color: THEME.text }}>{r.name}</td>
                      <td style={{ padding: '10px 12px', color: THEME.text }}>{CATEGORIES[r.category] || r.category}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: lowStock ? '#D32F2F' : THEME.text }}>{r.current_stock}{lowStock && <Icon name="warning" size={12} style={{ color: '#E65100', marginLeft: '4px', verticalAlign: 'middle' }} />}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.reorder_level}</td>
                      <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.unit_cost != null ? `$${Number(r.unit_cost).toFixed(2)}` : '--'}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: r.is_active ? '#E8F5E9' : '#FFEBEE', color: r.is_active ? '#2E7D32' : '#D32F2F' }}>
                          {r.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          {can('sheq.edit') && <button onClick={() => setModal({ type: 'editItem', data: r })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                          {can('sheq.delete') && <button onClick={() => handleArchiveItem(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="archive" size={16} style={{ color: THEME.textMed }} /></button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: THEME.surfaceVar }}>
                  {['Issue #', 'Date', 'PPE Item', 'Issued To', 'Qty', 'Size', 'Condition', 'Expiry', 'Returned', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: THEME.textMed, fontSize: '11px', textTransform: 'uppercase', borderBottom: `1px solid ${THEME.outline}` }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>Loading...</td></tr>
                ) : filteredIssues.length === 0 ? (
                  <tr><td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: THEME.textMed }}>No PPE issues found</td></tr>
                ) : filteredIssues.map(r => (
                  <tr key={r.id} style={{ borderBottom: `1px solid ${THEME.outline}` }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: ACCENT }}>{r.issue_number}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.issue_date}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.sheq_ppe_items?.name || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.profiles?.full_name || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text }}>{r.quantity}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.size || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{CONDITIONS[r.condition_on_issue] || r.condition_on_issue}</td>
                    <td style={{ padding: '10px 12px', color: r.expiry_date && new Date(r.expiry_date) < new Date() ? '#D32F2F' : THEME.textMed }}>{r.expiry_date || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {r.returned_date ? (
                        <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: '#E8F5E9', color: '#2E7D32' }}>{r.returned_date}</span>
                      ) : (
                        <span style={{ padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, background: '#FFF8E1', color: '#F59E0B' }}>Outstanding</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {can('sheq.edit') && <button onClick={() => setModal({ type: 'editIssue', data: r })} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="edit" size={16} style={{ color: THEME.textMed }} /></button>}
                        {can('sheq.delete') && <button onClick={() => handleArchiveIssue(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}><Icon name="archive" size={16} style={{ color: THEME.textMed }} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(modal === 'newItem' || modal?.type === 'editItem') && (
        <ItemModal
          item={modal?.data || null}
          siteId={currentSiteId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}

      {(modal === 'newIssue' || modal?.type === 'editIssue') && (
        <IssueModal
          issue={modal?.data || null}
          ppeItems={items}
          profiles={profiles}
          siteId={currentSiteId}
          userId={user?.id}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}
