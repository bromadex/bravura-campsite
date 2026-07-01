import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../auth/AuthContext'
import { useSite } from '../../contexts/SiteContext'
import { THEME, MODULE_COLORS } from '../../utils/permissions'
import { PageHeader, Icon, Card, Button, TextField, StatusBadge, Chip, showToast } from '../../components/ui'

const CLR = MODULE_COLORS.feedback

const KINDS = [
  { id: 'bug',        label: 'Bug',        icon: 'bug_report',     color: THEME.error },
  { id: 'suggestion', label: 'Suggestion', icon: 'lightbulb',      color: THEME.warning },
  { id: 'removal',    label: 'Remove',     icon: 'delete_sweep',   color: THEME.info },
  { id: 'other',      label: 'Other',      icon: 'chat_bubble',    color: THEME.textMed },
]

const MODULES = [
  { id: '',          label: 'Any module' },
  { id: 'meals',     label: 'Meal Management' },
  { id: 'campsite',  label: 'Campsite' },
  { id: 'fuel',      label: 'Fuel Management' },
  { id: 'workforce', label: 'HR Management' },
  { id: 'fleet',     label: 'Fleet Management' },
  { id: 'admin',     label: 'Administration' },
  { id: 'other',     label: 'Something else' },
]

function relTime(ts) {
  const age = Date.now() - new Date(ts).getTime()
  if (age < 60_000)      return 'just now'
  if (age < 3_600_000)   return `${Math.floor(age / 60_000)}m ago`
  if (age < 86_400_000)  return `${Math.floor(age / 3_600_000)}h ago`
  if (age < 604_800_000) return `${Math.floor(age / 86_400_000)}d ago`
  return new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

export default function FeedbackBoard() {
  const { profile } = useAuth()
  const { currentSite, currentSiteId } = useSite()

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  // ── Form state
  const [kind, setKind]         = useState('bug')
  const [moduleId, setModuleId] = useState('')
  const [title, setTitle]       = useState('')
  const [body, setBody]         = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    supabase
      .from('feedback_submissions')
      .select('id, module, kind, title, body, status, created_at')  // NOTE: submitter_id intentionally never selected
      .order('created_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setItems(data || [])
        setLoading(false)
      })
  }, [])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!title.trim()) { showToast('Please give it a short title', 'red'); return }
    setSubmitting(true)
    const { error } = await supabase.from('feedback_submissions').insert({
      site_id:      currentSiteId || null,
      module:       moduleId || null,
      kind,
      title:        title.trim(),
      body:         body.trim() || null,
      submitter_id: profile?.id || null,
    })
    setSubmitting(false)
    if (error) { showToast(error.message || 'Could not submit — try again', 'red'); return }
    showToast('Submitted anonymously — thank you', 'green')
    setTitle(''); setBody(''); setKind('bug'); setModuleId('')
    load()
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.kind === filter)

  const counts = KINDS.reduce((acc, k) => {
    acc[k.id] = items.filter(i => i.kind === k.id).length
    return acc
  }, {})

  return (
    <div style={{ maxWidth: '1050px', margin: '0 auto' }}>
      <PageHeader title="Feedback" site={currentSite}>
        <div style={{ fontSize: '12px', color: THEME.textMed }}>
          Bravura is still under active development. Report bugs, suggest features, or flag anything that should be removed. <b>Your name is never shown</b> on the board — submissions are anonymous.
        </div>
      </PageHeader>

      {/* ── Anonymity notice */}
      <Card style={{ marginBottom: '18px', padding: '14px 18px', background: CLR + '08', borderColor: CLR + '35' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <div style={{ width: '34px', height: '34px', borderRadius: '9px', background: CLR + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="visibility_off" size={18} style={{ color: CLR }} />
          </div>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.text }}>Submissions are anonymous</div>
            <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '3px', lineHeight: 1.55 }}>
              The system does not display who submitted a piece of feedback. We record your ID internally only to prevent spam and never show it on the board.
            </div>
          </div>
        </div>
      </Card>

      {/* ── Submit form + Board side by side on desktop, stacked on mobile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: '18px', alignItems: 'flex-start' }}>

        {/* Submit form */}
        <Card style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: THEME.textMed, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="add_comment" size={15} style={{ color: CLR }} />
            Submit Feedback
          </div>

          {/* Kind picker */}
          <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Type</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '14px' }}>
            {KINDS.map(k => (
              <button
                key={k.id}
                onClick={() => setKind(k.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-start',
                  padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
                  border: `1px solid ${kind === k.id ? k.color : THEME.outlineVar}`,
                  background: kind === k.id ? k.color + '12' : THEME.surface,
                  color: kind === k.id ? k.color : THEME.textMed,
                  fontFamily: 'inherit', fontSize: '12px', fontWeight: 600,
                  transition: 'all .12s',
                }}
              >
                <Icon name={k.icon} size={15} style={{ color: kind === k.id ? k.color : THEME.textLow }} />
                {k.label}
              </button>
            ))}
          </div>

          {/* Module */}
          <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Module (optional)</div>
          <select
            value={moduleId}
            onChange={e => setModuleId(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px', borderRadius: '6px',
              border: `1px solid ${THEME.outline}`, background: THEME.surface,
              color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
              height: '36px', marginBottom: '14px',
            }}
          >
            {MODULES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>

          <TextField
            label="Title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Short summary"
          />

          <div style={{ fontSize: '11px', fontWeight: 600, color: THEME.textMed, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Details</div>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="What happened? What did you expect? Any steps to reproduce?"
            rows={5}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: '6px',
              border: `1px solid ${THEME.outline}`, background: THEME.surface,
              color: THEME.text, fontSize: '13px', fontFamily: 'inherit',
              resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              marginBottom: '14px', lineHeight: 1.5,
            }}
            onFocus={e => { e.target.style.borderColor = CLR; e.target.style.boxShadow = `0 0 0 3px ${CLR}1E` }}
            onBlur={e => { e.target.style.borderColor = THEME.outline; e.target.style.boxShadow = 'none' }}
          />

          <Button variant="filled" icon="send" onClick={submit} disabled={submitting} style={{ background: CLR, borderColor: CLR, width: '100%' }}>
            {submitting ? 'Submitting…' : 'Submit anonymously'}
          </Button>
        </Card>

        {/* Board */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <Chip active={filter === 'all'} onClick={() => setFilter('all')}>All ({items.length})</Chip>
            {KINDS.map(k => (
              <Chip key={k.id} active={filter === k.id} onClick={() => setFilter(k.id)} color={k.color}>
                {k.label} ({counts[k.id] || 0})
              </Chip>
            ))}
          </div>

          {loading ? (
            <Card style={{ textAlign: 'center', padding: '40px' }}>
              <Icon name="progress_activity" size={22} style={{ color: THEME.textLow, animation: 'spin 1s linear infinite' }} />
            </Card>
          ) : filtered.length === 0 ? (
            <Card style={{ textAlign: 'center', padding: '40px' }}>
              <Icon name="forum" size={40} style={{ color: THEME.outline, display: 'block', margin: '0 auto 12px' }} />
              <div style={{ fontSize: '13px', color: THEME.textMed }}>No submissions yet. Be the first to send feedback.</div>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filtered.map(i => {
                const k = KINDS.find(x => x.id === i.kind) || KINDS[3]
                const mod = MODULES.find(x => x.id === (i.module || ''))
                return (
                  <Card key={i.id} style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: k.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name={k.icon} size={16} style={{ color: k.color }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <div style={{ fontSize: '13.5px', fontWeight: 600, color: THEME.text }}>{i.title}</div>
                          <StatusBadge status={i.status} />
                        </div>
                        {i.body && (
                          <div style={{ fontSize: '12px', color: THEME.textMed, marginTop: '4px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                            {i.body}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', fontSize: '11px', color: THEME.textLow }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            <Icon name="visibility_off" size={11} /> Anonymous
                          </span>
                          {mod && mod.id && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                              <Icon name="widgets" size={11} /> {mod.label}
                            </span>
                          )}
                          <span>·</span>
                          <span>{relTime(i.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
