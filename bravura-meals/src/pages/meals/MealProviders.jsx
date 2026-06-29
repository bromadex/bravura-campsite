import { useState, useEffect } from 'react'
import { supabase } from '../../supabaseClient'
import { useSite } from '../../contexts/SiteContext'
import { THEME } from '../../utils/permissions'
import { Card, Button, Modal, ConfirmModal, Icon, SectionLabel, showToast, PageHeader } from '../../components/ui'

// Deliberately simple, per the actual requirement: each site can have one
// or more catering providers, and the Meals module should be able to show
// which provider is responsible for the current site. No pricing tie-in,
// no scheduling, no per-provider menus — just "who caters here."
export default function MealProviders() {
  const { currentSiteId, currentSite } = useSite()

  const [providers, setProviders] = useState([])
  const [loading,   setLoading]   = useState(true)

  const [modal,    setModal]    = useState(false)
  const [editing,  setEditing]  = useState(null)
  const [name,     setName]     = useState('')
  const [saving,   setSaving]   = useState(false)

  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting,     setDeleting]     = useState(false)

  useEffect(() => { if (currentSiteId) fetchProviders() }, [currentSiteId])

  async function fetchProviders() {
    setLoading(true)
    const { data } = await supabase
      .from('meal_providers')
      .select('*')
      .eq('site_id', currentSiteId)
      .order('name')
    setProviders(data || [])
    setLoading(false)
  }

  function openAdd() { setEditing(null); setName(''); setModal(true) }
  function openEdit(p) { setEditing(p); setName(p.name); setModal(true) }

  async function save() {
    if (!name.trim()) { showToast('Please enter a provider name', 'red'); return }
    setSaving(true)
    try {
      if (editing) {
        const { error } = await supabase.from('meal_providers').update({ name: name.trim() }).eq('id', editing.id)
        if (error) throw error
        showToast('Provider updated', 'green')
      } else {
        // Stamped with the currently selected site — same pattern used
        // everywhere a new record gets created in this project.
        const { error } = await supabase.from('meal_providers').insert({ name: name.trim(), site_id: currentSiteId })
        if (error) throw error
        showToast('Provider added', 'green')
      }
      setModal(false)
      fetchProviders()
    } catch (err) {
      showToast(err.message, 'red')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(p) {
    const { error } = await supabase.from('meal_providers').update({ is_active: !p.is_active }).eq('id', p.id)
    if (error) { showToast(error.message, 'red'); return }
    showToast(`${p.name} → ${p.is_active ? 'Inactive' : 'Active'}`, 'green')
    fetchProviders()
  }

  async function doDelete() {
    setDeleting(true)
    const { error } = await supabase.from('meal_providers').delete().eq('id', deleteTarget.id)
    setDeleting(false)
    if (error) { showToast('Cannot delete: ' + error.message, 'red'); setDeleteTarget(null); return }
    showToast(`${deleteTarget.name} removed`, 'red')
    setDeleteTarget(null)
    fetchProviders()
  }

  const activeProviders = providers.filter(p => p.is_active)

  return (
    <div>
      <PageHeader title="Meal Providers" site={currentSite} actions={<Button onClick={openAdd} variant="filled" icon="add">Add Provider</Button>} />

      {!loading && activeProviders.length > 0 && (
        <Card style={{ marginBottom: '16px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', background: THEME.surfaceVar }}>
          <Icon name="restaurant" size={18} style={{ color: THEME.primary, flexShrink: 0 }} />
          <div style={{ fontSize: '13px', color: THEME.text }}>
            Catering at {currentSite?.name}: <strong>{activeProviders.map(p => p.name).join(', ')}</strong>
          </div>
        </Card>
      )}

      {loading ? (
        <div style={{ padding: '48px', textAlign: 'center', color: THEME.textLow }}>
          <Icon name="progress_activity" size={24} style={{ color: THEME.primary }} />
        </div>
      ) : providers.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '32px', color: THEME.textLow }}>
            <Icon name="restaurant" size={32} style={{ color: THEME.outline, display: 'block', margin: '0 auto 10px' }} />
            No meal providers recorded for {currentSite?.name || 'this site'} yet.
          </div>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '14px' }}>
          {providers.map(p => (
            <Card key={p.id} style={{ padding: '16px', opacity: p.is_active ? 1 : 0.6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: THEME.primary, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700 }}>
                    {p.name.slice(0,2).toUpperCase()}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '14px', color: THEME.text }}>{p.name}</div>
                </div>
                <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 600, background: p.is_active ? '#E8F5E9' : THEME.surfaceVar, color: p.is_active ? '#1B5E20' : THEME.textLow }}>
                  {p.is_active ? 'ACTIVE' : 'INACTIVE'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <Button onClick={() => openEdit(p)} variant="outlined" size="sm" icon="edit">Edit</Button>
                <Button onClick={() => toggleActive(p)} variant="outlined" size="sm" icon={p.is_active ? 'block' : 'check_circle'}>
                  {p.is_active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button onClick={() => setDeleteTarget(p)} variant="outlined" size="sm" icon="delete" style={{ color: THEME.error, borderColor: '#f5b8b8' }}>
                  Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Add / Edit Modal */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editing ? `Edit — ${editing.name}` : 'Add Meal Provider'}
        footer={<>
          <Button onClick={() => setModal(false)} variant="text">Cancel</Button>
          <Button onClick={save} variant="filled" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Add Provider'}</Button>
        </>}
      >
        <SectionLabel>Provider Name *</SectionLabel>
        <input
          type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. Bravura Catering" autoFocus
          onKeyDown={e => e.key === 'Enter' && save()}
          style={{ width: '100%', padding: '10px 14px', border: `1px solid ${THEME.outline}`, borderRadius: '12px', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
        />
        <div style={{ marginTop: '10px', fontSize: '11px', color: THEME.textLow }}>
          This provider will be linked to {currentSite?.name || 'the current site'} specifically — switch sites first if you meant to add it elsewhere.
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={doDelete}
        title="Remove Meal Provider?"
        message={`Remove "${deleteTarget?.name}" from ${currentSite?.name || 'this site'}? This cannot be undone.`}
        confirmLabel={deleting ? 'Removing…' : 'Remove'}
        danger
      />
    </div>
  )
}
