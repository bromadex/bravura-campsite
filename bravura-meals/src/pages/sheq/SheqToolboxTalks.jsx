import { useState, useEffect, useMemo, useCallback } from 'react'
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

function TalkModal({ rec, profiles, departments, siteId, userId, onClose, onSaved }) {
  const isEdit = !!rec
  const [form, setForm] = useState(() => {
    if (rec) return {
      title: rec.title || '',
      topic_category: rec.topic_category || '',
      conducted_by: rec.conducted_by || '',
      talk_date: rec.talk_date || new Date().toISOString().slice(0, 10),
      duration_minutes: rec.duration_minutes || '',
      location: rec.location || '',
      description: rec.description || '',
      key_points: rec.key_points || '',
      department_id: rec.department_id || '',
    }
    return {
      title: '', topic_category: '', conducted_by: '',
      talk_date: new Date().toISOString().slice(0, 10), duration_minutes: '',
      location: '', description: '', key_points: '', department_id: '',
    }
  })
  const [saving, setSaving] = useState(false)
  const [attendees, setAttendees] = useState([])
  const [newAttendee, setNewAttendee] = useState('')

  // Load existing attendees for edit
  useEffect(() => {
    if (!rec?.id) return
    supabase.from('sheq_toolbox_attendees').select('employee_id').eq('toolbox_talk_id', rec.id)
      .then(({ data }) => { if (data) setAttendees(data.map(a => a.employee_id)) })
  }, [rec?.id])

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  function addAttendee() {
    if (newAttendee && !attendees.includes(newAttendee)) {
      setAttendees(prev => [...prev, newAttendee])
    }
    setNewAttendee('')
  }

  function removeAttendee(id) {
    setAttendees(prev => prev.filter(a => a !== id))
  }

  async function handleSave() {
    if (!form.title || !form.talk_date) {
      showToast('Title and date are required', 'error'); return
    }
    setSaving(true)
    try {
      const payload = {
        title: form.title,
        topic_category: form.topic_category || null,
        conducted_by: form.conducted_by || null,
        talk_date: form.talk_date,
        duration_minutes: form.duration_minutes ? parseInt(form.duration_minutes) : null,
        location: form.location || null,
        description: form.description || null,
        key_points: form.key_points || null,
        department_id: form.department_id || null,
      }

      let talkId = rec?.id
      if (isEdit) {
        const { error } = await supabase.from('sheq_toolbox_talks').update(payload).eq('id', rec.id).eq('site_id', siteId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('sheq_toolbox_talks').insert({ ...payload, site_id: siteId, created_by: userId }).select('id').single()
        if (error) throw error
        talkId = data.id
      }

      // Sync attendees: delete old, insert new
      if (talkId) {
        await supabase.from('sheq_toolbox_attendees').delete().eq('toolbox_talk_id', talkId)
        if (attendees.length > 0) {
          const rows = attendees.map(eid => ({ toolbox_talk_id: talkId, employee_id: eid }))
          const { error: aErr } = await supabase.from('sheq_toolbox_attendees').insert(rows)
          if (aErr) console.error('Attendee save error:', aErr.message)
        }
      }

      showToast(isEdit ? 'Toolbox talk updated' : 'Toolbox talk created')
      onSaved()
    } catch (err) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          width: '580px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
          background: THEME.surface, borderRadius: '16px', padding: '28px',
          boxShadow: THEME.shadow3,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, color: THEME.text }}>
            {isEdit ? 'Edit Toolbox Talk' : 'New Toolbox Talk'}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }}>
            <Icon name="close" size={20} style={{ color: THEME.textMed }} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Field label="Title" required>
            <input style={inputStyle} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Toolbox talk title" />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Topic Category">
              <input style={inputStyle} value={form.topic_category} onChange={e => set('topic_category', e.target.value)} placeholder="e.g. PPE, Fire Safety" />
            </Field>
            <Field label="Department">
              <select style={selectStyle} value={form.department_id} onChange={e => set('department_id', e.target.value)}>
                <option value="">Select...</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Conducted By">
              <select style={selectStyle} value={form.conducted_by} onChange={e => set('conducted_by', e.target.value)}>
                <option value="">Select...</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Talk Date" required>
              <input style={inputStyle} type="date" value={form.talk_date} onChange={e => set('talk_date', e.target.value)} />
            </Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Field label="Duration (minutes)">
              <input style={inputStyle} type="number" value={form.duration_minutes} onChange={e => set('duration_minutes', e.target.value)} placeholder="e.g. 30" />
            </Field>
            <Field label="Location">
              <input style={inputStyle} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Muster Point A" />
            </Field>
          </div>

          <Field label="Description">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.description} onChange={e => set('description', e.target.value)} />
          </Field>

          <Field label="Key Points">
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} value={form.key_points} onChange={e => set('key_points', e.target.value)} placeholder="Key takeaways from the talk" />
          </Field>

          {/* Attendees section */}
          <div>
            <div style={lbl}>Attendees ({attendees.length})</div>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <select style={{ ...selectStyle, flex: 1 }} value={newAttendee} onChange={e => setNewAttendee(e.target.value)}>
                <option value="">Add employee...</option>
                {profiles.filter(p => !attendees.includes(p.id)).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <Button onClick={addAttendee} disabled={!newAttendee} icon="add">Add</Button>
            </div>
            {attendees.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {attendees.map(id => (
                  <span key={id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
                    background: ACCENT + '18', color: ACCENT,
                  }}>
                    {profileMap[id] || id}
                    <button onClick={() => removeAttendee(id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0', lineHeight: 1, color: ACCENT }}>
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '24px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving} icon="save">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Talk'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function SheqToolboxTalks({ setPage }) {
  const { can } = usePermissions()
  const { currentSiteId } = useSite()
  const rt = useRealtimeRefresh('sheq_toolbox_talks', { column: 'site_id', value: currentSiteId })
  const { user } = useAuth()

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editRow, setEditRow] = useState(null)
  const [profiles, setProfiles] = useState([])
  const [departments, setDepartments] = useState([])

  const canView = can('sheq.view')
  const canCreate = can('sheq.create')
  const canEdit = can('sheq.edit')

  const profileMap = useMemo(() => { const m = {}; profiles.forEach(p => { m[p.id] = p.name }); return m }, [profiles])

  const fetchData = useCallback(async () => {
    if (!currentSiteId) return
    setLoading(true)
    const [{ data, error }, { data: emps }, { data: depts }] = await Promise.all([
      supabase
        .from('sheq_toolbox_talks')
        .select('*, sheq_toolbox_attendees(employee_id)')
        .eq('site_id', currentSiteId)
        .is('is_archived', false)
        .order('talk_date', { ascending: false }),
      supabase.from('employees').select('id, name, employee_number').eq('site_id', currentSiteId).eq('status', 'active').order('name'),
      supabase.from('departments').select('id, name').eq('site_id', currentSiteId).order('name'),
    ])
    if (error) showToast(error.message, 'error')
    else setRows(data || [])
    setProfiles(emps || [])
    setDepartments(depts || [])
    setLoading(false)
  }, [currentSiteId])

  useEffect(() => { fetchData() }, [fetchData, rt])

  const kpis = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const thisMonth = rows.filter(r => r.talk_date >= monthStart)
    const totalAttendees = rows.reduce((sum, r) => sum + (r.sheq_toolbox_attendees?.length || 0), 0)
    const avgAttendance = rows.length > 0 ? (totalAttendees / rows.length).toFixed(1) : '0'
    return { total: rows.length, thisMonth: thisMonth.length, totalAttendees, avgAttendance }
  }, [rows])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      r.title?.toLowerCase().includes(q) ||
      r.topic_category?.toLowerCase().includes(q) ||
      r.location?.toLowerCase().includes(q) ||
      profileMap[r.conducted_by]?.toLowerCase().includes(q)
    )
  }, [rows, search, profileMap])

  function handleExport() {
    const headers = ['Title', 'Topic', 'Conducted By', 'Date', 'Duration (min)', 'Location', 'Attendees']
    const csvRows = filtered.map(r => [
      r.title || '', r.topic_category || '', profileMap[r.conducted_by] || '',
      r.talk_date || '', r.duration_minutes || '', r.location || '',
      r.sheq_toolbox_attendees?.length || 0,
    ])
    exportCsv(`sheq-toolbox-talks-${new Date().toISOString().slice(0, 10)}.csv`, headers, csvRows)
    showToast('CSV exported')
  }

  async function handleArchive(row) {
    if (!confirm('Archive this toolbox talk?')) return
    const { error } = await supabase.from('sheq_toolbox_talks').update({ is_archived: true }).eq('id', row.id).eq('site_id', currentSiteId)
    if (error) { showToast(error.message, 'error'); return }
    showToast('Toolbox talk archived')
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
        <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_toolbox" />
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="lock" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>You do not have permission to view toolbox talks.</p>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 24px' }}>
      <QuickNav pills={SHEQ_PILLS} setPage={setPage} current="sq_toolbox" />

      <PageHeader
        title="Toolbox Talks"
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {canCreate && <Button onClick={() => setShowCreate(true)} icon="add">New Toolbox Talk</Button>}
            <Button variant="ghost" onClick={handleExport} icon="download">Export</Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total Talks', value: kpis.total, icon: 'groups', color: ACCENT },
          { label: 'This Month', value: kpis.thisMonth, icon: 'calendar_month', color: '#1565C0' },
          { label: 'Total Attendees', value: kpis.totalAttendees, icon: 'people', color: '#2E7D32' },
          { label: 'Avg Attendance', value: kpis.avgAttendance, icon: 'trending_up', color: '#E65100' },
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

      {/* Search */}
      <div style={{ marginBottom: '16px', maxWidth: '320px' }}>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: THEME.textLow }} />
          <input
            style={{ ...inputStyle, paddingLeft: '32px' }}
            placeholder="Search toolbox talks..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <div style={{ color: THEME.textMed, fontSize: '14px' }}>Loading toolbox talks...</div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card style={{ padding: '40px', textAlign: 'center' }}>
          <Icon name="groups" size={48} style={{ color: THEME.textLow }} />
          <p style={{ color: THEME.textMed, marginTop: '12px', fontSize: '14px' }}>
            {rows.length === 0 ? 'No toolbox talks yet.' : 'No talks match current filters.'}
          </p>
        </Card>
      ) : (
        <Card style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${THEME.outlineVar}` }}>
                  {['Title', 'Topic', 'Conducted By', 'Date', 'Duration', 'Location', 'Attendees', ''].map(h => (
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
                    <td style={{ padding: '10px 12px', color: THEME.text, fontWeight: 600 }}>{r.title}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.topic_category || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{profileMap[r.conducted_by] || '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.text, whiteSpace: 'nowrap' }}>{r.talk_date}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.duration_minutes ? `${r.duration_minutes} min` : '--'}</td>
                    <td style={{ padding: '10px 12px', color: THEME.textMed }}>{r.location || '--'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <Badge label={`${r.sheq_toolbox_attendees?.length || 0}`} color={ACCENT} />
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        {canEdit && (
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
        <TalkModal
          rec={editRow}
          profiles={profiles}
          departments={departments}
          siteId={currentSiteId}
          userId={user?.id}
          onClose={() => { setShowCreate(false); setEditRow(null) }}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}
