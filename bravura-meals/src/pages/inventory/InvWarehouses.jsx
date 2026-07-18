import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, Button, Modal, SectionLabel, StatusBadge, PageHeader, showToast } from '../../components/ui'
import QuickNav, { INVENTORY_PILLS } from '../../components/QuickNav'

const ACCENT = MODULE_COLORS.inventory
const TYPES = ['main', 'workshop', 'electrical', 'kitchen', 'fuel_store', 'other']

export default function InvWarehouses({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ code: '', name: '', type: 'main' })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  const fetch = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('warehouses')
        .select('*')
        .eq('site_id', currentSiteId)
        .order('name')
      if (error) throw error
      setWarehouses(data || [])
    } catch (err) {
      showToast('Failed to load warehouses', 'red')
    }
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId) fetch() }, [currentSiteId, fetch])

  function genCode(name, type) {
    const prefix = (currentSite?.name || 'SITE').substring(0, 3).toUpperCase()
    const suffix = type.toUpperCase().replace('_', '')
    const seq = warehouses.filter(w => w.type === type).length + 1
    return `${prefix}-${suffix}${seq > 1 ? seq : ''}`
  }

  function openNew() {
    setEditId(null)
    setForm({ name: '', type: 'main' })
    setModal(true)
  }

  function openEdit(w) {
    setEditId(w.id)
    setForm({ name: w.name || '', type: w.type || 'main' })
    setModal(true)
  }

  async function save() {
    if (!form.name.trim()) { showToast('Name required', 'red'); return }
    setSaving(true)
    try {
      const row = {
        name: form.name.trim(),
        code: editId ? undefined : genCode(form.name, form.type),
        type: form.type,
        site_id: currentSiteId,
      }
      if (editId) delete row.code
      if (editId) {
        const { error } = await supabase.from('warehouses').update(row).eq('id', editId)
        if (error) throw error
        showToast('Warehouse updated', 'green')
      } else {
        const { error } = await supabase.from('warehouses').insert({ ...row, is_active: true })
        if (error) throw error
        showToast('Warehouse created', 'green')
      }
      setModal(false)
      fetch()
    } catch (err) {
      showToast(err.message, 'red')
    }
    setSaving(false)
  }

  async function toggleActive(w) {
    const { error } = await supabase.from('warehouses').update({ is_active: !w.is_active }).eq('id', w.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast(w.is_active ? 'Warehouse deactivated' : 'Warehouse activated', 'green')
    fetch()
  }

  if (!can('inventory.view')) {
    return (
      <Card style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="lock" size={28} style={{ color: THEME.textLow }} />
        <div style={{ marginTop: '10px', color: THEME.textMed, fontSize: '14px' }}>No access.</div>
      </Card>
    )
  }

  const th = { textAlign: 'left', padding: '8px 10px', color: THEME.textLow, fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: `1px solid ${THEME.outlineVar}`, whiteSpace: 'nowrap' }
  const inp = { width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', background: THEME.surface, color: THEME.text }

  return (
    <div>
      <QuickNav pills={INVENTORY_PILLS} setPage={setPage} current="inv_warehouses" />
      <PageHeader title="Warehouses" site={currentSite} actions={
        can('inventory.create') && <Button icon="add" variant="filled" onClick={openNew}>New Warehouse</Button>
      } />

      {loading ? (
        <Card style={{ textAlign: 'center', padding: '40px', color: THEME.textMed }}>Loading...</Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {warehouses.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '32px', color: THEME.textLow, gridColumn: '1 / -1' }}>
              No warehouses yet — create your first one
            </Card>
          ) : warehouses.map(w => (
            <Card key={w.id} style={{ padding: '18px', opacity: w.is_active ? 1 : 0.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '12px',
                    background: ACCENT + '18', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name="warehouse" size={20} style={{ color: ACCENT }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px', color: THEME.text }}>{w.name}</div>
                    {w.code && <div style={{ fontSize: '12px', color: THEME.textLow, fontFamily: 'monospace' }}>{w.code}</div>}
                  </div>
                </div>
                <StatusBadge status={w.is_active ? 'active' : 'inactive'} />
              </div>
              <div style={{ marginTop: '12px', fontSize: '12px', color: THEME.textMed }}>
                Type: <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{w.type?.replace('_', ' ')}</span>
              </div>
              {can('inventory.edit') && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                  <Button icon="edit" onClick={() => openEdit(w)}>Edit</Button>
                  <Button icon={w.is_active ? 'pause' : 'play_arrow'} onClick={() => toggleActive(w)}>
                    {w.is_active ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editId ? 'Edit Warehouse' : 'New Warehouse'}
        footer={<>
          <Button variant="text" onClick={() => setModal(false)}>Cancel</Button>
          <Button variant="filled" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <SectionLabel>Name *</SectionLabel>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={inp} />
          </div>
          <div>
            <SectionLabel>Type</SectionLabel>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} style={inp}>
              {TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>)}
            </select>
          </div>
        </div>
      </Modal>
    </div>
  )
}
