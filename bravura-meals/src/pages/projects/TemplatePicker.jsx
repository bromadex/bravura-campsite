import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { showToast } from '../../components/ui'
import { useSite } from '../../contexts/SiteContext'
import { friendlyError } from '../../utils/friendlyError'
import { FIN, finBtn, finBtn2, finInput, finCard } from '../../utils/financeTheme'

// New project from a template (#76): phases, tasks, checklists and links are copied, dates shift to the new start.
export default function TemplatePicker({ onClose, setPage }) {
  const { currentSiteId } = useSite()
  const [list, setList] = useState(null)
  const [pick, setPick] = useState(null)
  const [form, setForm] = useState({ name: '', code: '', start: new Date().toISOString().slice(0, 10), budget: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!currentSiteId) return
    supabase.rpc('pj_templates', { p_site: currentSiteId }).then(({ data, error }) => {
      if (error) showToast(friendlyError(error), 'error')
      setList(data || [])
    })
  }, [currentSiteId])

  async function create() {
    setBusy(true)
    const { data, error } = await supabase.rpc('pj_project_from_template', { p_template: pick.id, p_name: form.name, p_code: form.code || null,
      p_start: form.start, p_site: currentSiteId, p_manager: null, p_budget: form.budget ? Number(form.budget) : null })
    setBusy(false)
    if (error) return showToast(friendlyError(error), 'error')
    showToast('Project created from ' + pick.name)
    onClose(); setPage('pj_detail_' + data)
  }

  return (
    <div role="dialog" aria-modal="true" onMouseDown={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(22,33,29,.35)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ ...finCard, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto', fontFamily: FIN.sans, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>New project from a template</div>
        {!list ? <div style={{ color: FIN.faint }}>Loading…</div> : list.length === 0 ? (
          <div style={{ fontSize: 14, color: FIN.muted }}>No templates yet. Open a finished project and press <b>Save as template</b>.</div>
        ) : !pick ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {list.map(t => (
              <button key={t.id} onClick={() => { setPick(t); setForm(f => ({ ...f, name: t.name.replace(/\s*\(template\)\s*$/i, '') })) }}
                style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: `1px solid ${FIN.line}`, background: '#fff', cursor: 'pointer', fontFamily: FIN.sans }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: FIN.ink }}>{t.name}</div>
                <div style={{ fontSize: 12, color: FIN.muted }}>{t.tasks} tasks · {t.phases} phases{t.days ? ` · about ${t.days} days` : ''}</div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, color: FIN.muted }}>From <b style={{ color: FIN.ink }}>{pick.name}</b> — {pick.tasks} tasks, dates moved to your start date.</div>
            <label style={lbl}>Project name<input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} style={finInput} /></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ ...lbl, flex: '1 1 160px' }}>Code (optional)<input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="e.g. KAM-CW-002" style={finInput} /></label>
              <label style={{ ...lbl, flex: '1 1 140px' }}>Starts<input type="date" value={form.start} onChange={e => setForm({ ...form, start: e.target.value })} style={finInput} /></label>
              <label style={{ ...lbl, flex: '1 1 120px' }}>Budget $ (optional)<input type="number" min="0" value={form.budget} onChange={e => setForm({ ...form, budget: e.target.value })} style={finInput} /></label>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {pick && <button onClick={() => setPick(null)} style={finBtn2}>Back</button>}
          <button onClick={onClose} style={finBtn2}>Cancel</button>
          {pick && <button onClick={create} disabled={busy || !form.name.trim()} style={finBtn}>Create project</button>}
        </div>
      </div>
    </div>
  )
}
const lbl = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: FIN.muted }
