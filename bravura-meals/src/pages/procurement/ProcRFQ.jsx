import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { usePermissions } from '../../contexts/PermissionsContext'
import { useSite } from '../../contexts/SiteContext'
import { useAuth } from '../../auth/AuthContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { Card, Icon, PageHeader, StatusBadge, showToast } from '../../components/ui'
import QuickNav from '../../components/QuickNav'
import { PROCUREMENT_PILLS } from './ProcDashboard'

const CLR = MODULE_COLORS.procurement

export default function ProcRFQ({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId, currentSite } = useSite()
  const { user } = useAuth()
  const [rfqs, setRfqs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ title: '', deadline: '', notes: '' })
  const [lines, setLines] = useState([{ description: '', quantity: '', unit: '' }])

  const fetchRfqs = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('rfqs')
      .select('*, rfq_lines(*), rfq_responses(*, supplier:procurement_suppliers(supplier_name))')
      .eq('site_id', currentSiteId)
      .order('created_at', { ascending: false })
    if (error) showToast('Failed to load RFQs', 'red')
    setRfqs(data || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { if (currentSiteId && can('procurement.view')) fetchRfqs() }, [currentSiteId, fetchRfqs])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rfqs
      .filter(r => statusFilter === 'all' || r.status === statusFilter)
      .filter(r => !q || r.title?.toLowerCase().includes(q) || r.rfq_number?.toLowerCase().includes(q))
  }, [rfqs, search, statusFilter])

  async function handleCreate() {
    if (!form.title.trim()) return showToast('Title is required', 'red')
    const validLines = lines.filter(l => l.description.trim() && l.quantity)
    if (validLines.length === 0) return showToast('Add at least one line item', 'red')
    setSaving(true)
    const rfqNumber = `RFQ-${Date.now().toString(36).toUpperCase()}`
    const { data: rfq, error } = await supabase.from('rfqs').insert({
      rfq_number: rfqNumber,
      site_id: currentSiteId,
      title: form.title.trim(),
      status: 'draft',
      deadline: form.deadline || null,
      notes: form.notes || null,
      created_by: user.id,
    }).select().single()
    if (error) { showToast(error.message, 'red'); setSaving(false); return }
    const lineInserts = validLines.map(l => ({ rfq_id: rfq.id, description: l.description.trim(), quantity: parseFloat(l.quantity), unit: l.unit || null }))
    await supabase.from('rfq_lines').insert(lineInserts)
    showToast('RFQ created')
    setShowForm(false)
    setForm({ title: '', deadline: '', notes: '' })
    setLines([{ description: '', quantity: '', unit: '' }])
    setSaving(false)
    fetchRfqs()
  }

  async function updateStatus(id, status) {
    const { error } = await supabase.from('rfqs').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) showToast(error.message, 'red')
    else { showToast(`RFQ ${status}`); fetchRfqs() }
  }

  if (!can('procurement.view')) return <Card style={{ textAlign: 'center', padding: 40 }}><Icon name="lock" size={28} style={{ color: THEME.textLow }} /></Card>

  return (
    <div>
      <QuickNav pills={PROCUREMENT_PILLS} setPage={setPage} current="proc_rfqs" />
      <PageHeader title="Requests for Quotation" site={currentSite} />

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search RFQs..." style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13 }}>
          <option value="all">All Statuses</option>
          {['draft','sent','responses_received','evaluated','awarded','cancelled'].map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        {can('procurement.create') && (
          <button onClick={() => setShowForm(!showForm)} style={{ padding: '8px 16px', borderRadius: 8, background: CLR, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
            <Icon name="add" size={14} style={{ color: '#fff', marginRight: 4 }} />New RFQ
          </button>
        )}
      </div>

      {showForm && (
        <Card style={{ marginBottom: 16, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: THEME.text }}>Create RFQ</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Title *" style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13 }} />
            <input type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13 }} />
          </div>
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes" rows={2} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 13, resize: 'vertical', marginBottom: 12 }} />
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: THEME.text }}>Line Items</div>
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr auto', gap: 8, marginBottom: 6 }}>
              <input value={l.description} onChange={e => { const n = [...lines]; n[i].description = e.target.value; setLines(n) }} placeholder="Description *" style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 12 }} />
              <input type="number" value={l.quantity} onChange={e => { const n = [...lines]; n[i].quantity = e.target.value; setLines(n) }} placeholder="Qty *" style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 12 }} />
              <input value={l.unit} onChange={e => { const n = [...lines]; n[i].unit = e.target.value; setLines(n) }} placeholder="Unit" style={{ padding: '6px 10px', borderRadius: 6, border: `1px solid ${THEME.outline}`, background: THEME.surface, color: THEME.text, fontSize: 12 }} />
              <button onClick={() => setLines(lines.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.error }}><Icon name="close" size={16} /></button>
            </div>
          ))}
          <button onClick={() => setLines([...lines, { description: '', quantity: '', unit: '' }])} style={{ background: 'none', border: 'none', cursor: 'pointer', color: CLR, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>+ Add Line</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleCreate} disabled={saving} style={{ padding: '8px 20px', borderRadius: 8, background: CLR, color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13, opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving...' : 'Create'}</button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 20px', borderRadius: 8, background: THEME.surface, color: THEME.text, border: `1px solid ${THEME.outline}`, fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>Cancel</button>
          </div>
        </Card>
      )}

      {loading ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textMed }}>Loading...</Card>
      ) : filtered.length === 0 ? (
        <Card style={{ textAlign: 'center', padding: 40, color: THEME.textLow }}>No RFQs found</Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map(r => (
            <Card key={r.id} style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, color: THEME.text }}>{r.title}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div style={{ fontSize: 12, color: THEME.textMed }}>
                    {r.rfq_number} · {r.rfq_lines?.length || 0} items · {r.rfq_responses?.length || 0} responses
                    {r.deadline && <span> · Due {new Date(r.deadline).toLocaleDateString()}</span>}
                  </div>
                  {r.rfq_responses?.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {r.rfq_responses.map(resp => (
                        <span key={resp.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: ACCENT + '14', color: ACCENT }}>
                          {resp.supplier?.supplier_name} — ${resp.total_amount?.toLocaleString()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {can('procurement.edit') && r.status === 'draft' && (
                  <button onClick={() => updateStatus(r.id, 'sent')} style={{ padding: '6px 12px', borderRadius: 6, background: CLR, color: '#fff', border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Send to Suppliers</button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
